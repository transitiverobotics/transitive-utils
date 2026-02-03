const URL = require('node:url');
const _ = require('lodash');
const waitPort = require('wait-port');
const { createClient } = require('@clickhouse/client');

const { topicToPath, topicMatch } = require('@transitive-sdk/datacache');

// Default TTL in days for mqtt_history table
const DEFAULT_TTL_DAYS = 30;

// Shared multi-tenant schema components used by createTable and enableHistory
const MULTI_TENANT_SCHEMA = {
  // Column definitions for OrgId and DeviceId
  columns: [
    'OrgId LowCardinality(String) CODEC(ZSTD(1))',
    'DeviceId LowCardinality(String) CODEC(ZSTD(1))'
  ],
  // Bloom filter indexes for efficient filtering
  indexes: [
    'INDEX idx_orgid (OrgId) TYPE bloom_filter(0.01) GRANULARITY 1',
    'INDEX idx_deviceid (DeviceId) TYPE bloom_filter(0.01) GRANULARITY 1'
  ]
};

/** Given a Topic path (array), return an array of conditions to use in a
 * WHERE clause. */
const path2where = (path) => {
  const where = [];
  const wildIndices = [];
  _.forEach(path, (value, i) => {
    if (!['+','#'].includes(value[0])) {
      // it's a constant, filter by it
      where.push(`TopicParts[${i + 1}] = '${value}'`);
      // Note that ClickHouse/SQL index starting at 1, not 0
    } else {
      wildIndices.push(i);
    }
  });
  return {where, wildIndices};
};


/** Singleton ClickHouse client wrapper with multi-tenant table support */
class ClickHouse {

  _client = null;

  mqttHistoryTable = null; // name of the table used for MQTT history, if used
  topics = {}; // list of topics registered for storage, as object for de-duplication

  /** Create the client, connecting to Clickhouse */
  async init({ url, dbName, user, password } = {}) {

    const _url = url || process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
    const _dbName = dbName || process.env.CLICKHOUSE_DB || 'default';
    const _user = user || process.env.CLICKHOUSE_USER || 'default';

    const {hostname, port} = URL.parse(_url);
    const interval = 200;
    await waitPort({ host: hostname, port: Number(port || 80), interval }, 10000);
    await new Promise(done => setTimeout(done, 200));

    // console.debug(`Creating ClickHouse client for URL: ${_url}, DB: ${_dbName}, User: ${_user}`);

    this._client = createClient({
      url: _url,
      max_open_connections: 10,
      database: _dbName,
      username: _user,
      password: password || process.env.CLICKHOUSE_PASSWORD || '',
      clickhouse_settings: {
        // https://clickhouse.com/docs/en/operations/settings/settings#async-insert
        async_insert: 1,
        // https://clickhouse.com/docs/en/operations/settings/settings#wait-for-async-insert
        wait_for_async_insert: 1,
        // https://clickhouse.com/docs/en/operations/settings/settings#async-insert-max-data-size
        async_insert_max_data_size: '1000000',
        // https://clickhouse.com/docs/en/operations/settings/settings#async-insert-busy-timeout-ms
        async_insert_busy_timeout_ms: 1000,
        // Allows to insert serialized JS Dates (such as '2023-12-06T10:54:48.000Z')
        date_time_input_format: 'best_effort',
        // Include MATERILIZED columns in query results
        // https://clickhouse.com/docs/operations/settings/settings#asterisk_include_materialized_columns
        // asterisk_include_materialized_columns: 1
      },
    });

    await this._client.query({ query: 'SELECT 1' });
  }

  /** Get the Clickhouse client (from @clickhouse/client) */
  get client() {
    if (this._client == undefined) {
      console.warn('Cannot access ClickHouse client before init() is called');
      throw new Error('ClickHouse client not initialized');
    }
    return this._client;
  }

  /* sets up default row level security policies in ClickHouse */
  async ensureDefaultPermissions() {
    const cmd = 'CREATE ROW POLICY IF NOT EXISTS';
    for (let query of [
      `${cmd} default_users ON default.* USING OrgId = splitByString('_', currentUser())[2] TO ALL`,
      `${cmd} default_admin ON default.* USING 1 TO ${process.env.CLICKHOUSE_USER || 'default'}`
    ]) await this.client.command({ query });
  }

  /** Create a table if it does not already exist adding OrgId and DeviceId
   * columns to the schema for multi-tenancy support.
   * @param {string} tableName - name of the table to create
   * @param {Array<string>} columns - array of column definitions and indexes, e.g. ['Timestamp DateTime CODEC(ZSTD(1))', 'Value Float32 CODEC(ZSTD(1))']
   * @param {Array<string>} settings - array of table settings, e.g. ['ENGINE = MergeTree()', 'ORDER BY (Timestamp)']
   */
  async createTable(tableName, columns, settings = ['ORDER BY (OrgId, DeviceId)']) {
    const fullSchema = [
      ...columns,
      ...MULTI_TENANT_SCHEMA.columns,
      ...MULTI_TENANT_SCHEMA.indexes
    ];
    const query = `CREATE TABLE IF NOT EXISTS ${tableName}
      (${fullSchema.join(', ')})
      ${settings.join(' ')}`;

    try {
      return await this.client.exec({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1,
        }
      });
    } catch (error) {
      console.error('Error executing query:', error.message);
      console.debug('Query was:', query);
      throw error;
    }
  }

  /** Insert rows into a multi-tenant table, adding OrgId and DeviceId to each row
   * @param {string} tableName - name of the table to insert into
   * @param {Array<Object>} rows - array of row objects to insert (JSON each item)
   * @param {string} orgId - organization ID to add to each row
   * @param {string} deviceId - device ID to add to each row
   */
  async insert(tableName, rows, orgId, deviceId) {
    // assert that orgId and deviceId are provided
    if (!orgId || !deviceId) {
      throw new Error('Both orgId and deviceId must be provided for multi-tenant insert');
    }

    // Augment each row with OrgId and DeviceId
    const rowsWithIds = rows.map(row => ({
      ...row,
      OrgId: orgId,
      DeviceId: deviceId
    }));

    return await this.client.insert({
      table: tableName,
      values: rowsWithIds,
      format: 'JSONEachRow'
    });
  }

  /* Enable history recording. Ensure the mqtt_history table exists with the
   * correct schema, set dataCache, and subscribe to changes.
   * @param {object} options = {dataCache, tableName, ttlDays}
   */
  async enableHistory(options) {
    const { dataCache, tableName = 'mqtt_history' } = options;

    if (this.mqttHistoryTable != tableName) {
      console.warn(`creating or altering mqtt history table ${tableName}`);
    }

    // Check if table already exists before creating
    const tableExists = await this.client.query({
      query: `SELECT name	FROM system.tables WHERE name = '${this.mqttHistoryTable}' AND database = currentDatabase()`,
      format: 'JSONEachRow'
    });
    const tables = await tableExists.json();

    if (tables.length == 0) {
      // Create the table
      const columns = [
        // High-precision event time; Delta + ZSTD is a common combo for time-series
        'Timestamp DateTime64(6) CODEC(Delta, ZSTD(1))',
        // Raw MQTT topic split into parts; kept as Array(String) for flexibility
        'TopicParts Array(String) CODEC(ZSTD(1))',
        // Org/device fields materialized from TopicParts (always computed, not overridable)
        'OrgId LowCardinality(String) MATERIALIZED TopicParts[1] CODEC(ZSTD(1))',
        'DeviceId LowCardinality(String) MATERIALIZED TopicParts[2] CODEC(ZSTD(1))',
        // 'Scope LowCardinality(String) MATERIALIZED TopicParts[3] CODEC(ZSTD(1))',
        // 'CapabilityName LowCardinality(String) MATERIALIZED TopicParts[4] CODEC(ZSTD(1))',
        // 'CapabilityVersion LowCardinality(String) MATERIALIZED TopicParts[5] CODEC(ZSTD(1))',
        // Remaining topic segments stored as an array for less-structured suffixes
        // 'SubTopic Array(String) MATERIALIZED arraySlice(TopicParts, 6) CODEC(ZSTD(1))',
        // Payload stored as a String, compressed with ZSTD(1). This allows us to
        // store atomic values (still stringified) as opposed to only JSON objects,
        // as the JSON type would require.
        'Payload String CODEC(ZSTD(1))',
        // Bloom filter indexes (shared multi-tenant indexes)
        ...MULTI_TENANT_SCHEMA.indexes,
        // 'INDEX idx_scope (Scope) TYPE bloom_filter(0.01) GRANULARITY 1',
        // 'INDEX idx_capability (CapabilityName) TYPE bloom_filter(0.01) GRANULARITY 1'
        'INDEX idx_scope (TopicParts[3]) TYPE bloom_filter(0.01) GRANULARITY 1',
        'INDEX idx_capability (TopicParts[4]) TYPE bloom_filter(0.01) GRANULARITY 1'
      ];

      const query = [
          `CREATE TABLE IF NOT EXISTS default.${tableName} (${columns.join(', ')})`,
          'ENGINE = MergeTree()',
          'PARTITION BY toYYYYMMDD(Timestamp)',
          'ORDER BY (OrgId, toUnixTimestamp64Micro(Timestamp), TopicParts)',
          'SETTINGS',
          '  index_granularity = 8192,',
          '  ttl_only_drop_parts = 1'
        ].join('\n');
      // Note: PRIMARY KEY is not needed because we want it to be the same as
      // ORDER BY, which is what ClickHouse does automatically.

      await this.client.command({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1,
        }
      });

      // grant capabilities read-access to their namespace
      await this.client.command({ query:
        `CREATE ROW POLICY IF NOT EXISTS default_capabilities
        ON default.${tableName}
        USING TopicParts[3] = splitByString('_', currentUser())[2]
        AND TopicParts[4] = splitByString('_', currentUser())[3] TO ALL`,
        clickhouse_settings: {
          wait_end_of_query: 1,
        }
      });

      // Subscribe to changes to the data cache. On each change, check whether
      // it matches any of the registered topics (this avoid duplicate triggers),
      // then store to ClickHouse with current timestamp.
      dataCache.subscribe((changes) => {
        _.forEach(changes, async (value, topic) => {

          const matched =
            _.some(this.topics, (_true, selector) => topicMatch(selector, topic));

          if (!matched) return;

          const row = {
            Timestamp: new Date(),
            TopicParts: topicToPath(topic), // topic as array
          };

          if (value !== null && value !== undefined) {
            row.Payload = JSON.stringify(value);
          } // else: omit

          try {
            await this.client.insert({
              table: this.mqttHistoryTable,
              values: [row],
              format: 'JSONEachRow'
            });
          } catch (error) {
            console.error('Error inserting MQTT message into ClickHouse:', error.message);
          }
        })
      });


    }

    this.mqttHistoryTable = tableName;
  }

  /* Register an MQTT topic for storage in ClickHouse subscribes to the topic
  * and stores incoming messages JSON.stringify'd in a ClickHouse table.
  * Retrieve using `queryMQTTHistory`, or, when quering directly, e.g., from
  * Grafana, use the ClickHouse built-in functionality for parsing JSON, e.g.,
  * after inserting `{ x: 1 }` use
  * `select JSON_VALUE(Payload, '$.x') AS x FROM default.mqtt_history`.
  * NOTE: `ensureMqttHistoryTable` must be called before registering topics
  * @param {string} topic - MQTT topic to register
  */
  async registerMqttTopicForStorage(selector, ttlDays = DEFAULT_TTL_DAYS) {

    const path = topicToPath(selector);

    if (path.length < 4) {
      // underspecified, don't set TTL
      console.warn('Not registering topic as it is too short', selector);
      return;
    }

    this.topics[selector] = true;

    // ---------------------------------------------------------------
    // Set/update TTL for this capability and sub-topic

    // Derive WHERE conditions for TTL expression from non-wildcards
    const { where } = path2where(path);

    if (where.length == 0) {
      // underspecified, don't set TTL
      console.warn('Not setting TTL as topic is under specified', selector);
      return;
    }

    const tableExists = await this.client.query({
      query: `SELECT name, create_table_query	FROM system.tables WHERE name = '${
      this.mqttHistoryTable}'`,
      format: 'JSONEachRow'
    });

    const tables = await tableExists.json();
    const originalCreateQuery = tables[0].create_table_query;
    const matched = originalCreateQuery.match(/TTL (.*) SETTINGS/);
    const ttls = matched ? matched[1].split(',').map(x => x.trim()) : [];

    const whereStatement = `WHERE ${where.join(' AND ')}`;
    const newTTLStatement =
      `toDateTime(Timestamp) + toIntervalDay(${ttlDays}) ${whereStatement}`;

    const currentIndex =
      ttls.findIndex(ttl => ttl.replace(/[()]/g, '').endsWith(whereStatement));

    if (currentIndex >= 0) {
      // replace existing
      ttls[currentIndex] = newTTLStatement;
    } else {
      // add new
      ttls.push(newTTLStatement);
    }

    await this.client.command({
      query: `ALTER TABLE ${this.mqttHistoryTable} MODIFY TTL ${ttls.join(',')}`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      }
    });
  }

  /** Query historic MQTT payloads based on topic selector (with the usual
  * wildcards), as well as a time range. Does the inverse transform of the
  * payload of registerMqttTopicForStorage. */
  async queryMQTTHistory(options = {}) {

    const {
      topicSelector,
      since = undefined,
      until = undefined,
      // if provided, extract this sub-value of the payload-json, requires type
      path = undefined,
      // type of element to extract using `path`: for available types, see https://clickhouse.com/docs/sql-reference/data-types
      type = 'String',
      orderBy = 'time DESC',
      limit = 1000, // end result limit (i.e., after grouping)

      bins = undefined, // into how many bins to aggregate (if given, requires since)
      // Aggregation function to use (if aggSeconds or bins is given)
      // if `bins` or `aggregateSeconds` is given, which operator to use to compute
      // aggregate value. Default is `count` (which works for any data type).
      // See https://clickhouse.com/docs/sql-reference/aggregate-functions/reference.
      agg = 'count',
    } = options;

    let {
      // how many seconds to group together (alternative to bins + time interval)
      aggSeconds
    } = options;

    /* some useful queries we'd like to support:

    # get avg `i` value for each minute of the last hour (limit: 60)
    ```sql
    select toStartOfInterval(Timestamp, INTERVAL 60 SECOND) as time,
      avg(JSONExtractInt(Payload,'i')) as agg
    from mqtt_history_tests
    GROUP BY (time)
    ORDER BY time
    LIMIT 60
    ```
    ->
    ```js
    { aggregateSeconds: 60, path: ['i'], type: 'Int', agg: 'avg', limit: 60 }
    ```
    */

    const pathSelector = topicToPath(topicSelector);

    // interpret wildcards
    const { where } = path2where(pathSelector);
    since && where.push(`Timestamp >= fromUnixTimestamp64Milli(${since.getTime()})`);
    until && where.push(`Timestamp <= fromUnixTimestamp64Milli(${until.getTime()})`);
    const whereStatement = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const extractValue = path && type
      ? `JSONExtract(Payload, ${path.map(s => `'${s}'`).join(', ')}, '${type}')`
      : 'Payload';

    let select = [`${extractValue} as value`, 'Payload', 'TopicParts',
      'Timestamp', 'Timestamp as time'];

    let group = '';
    if (bins > 1 && since) {
      // compute aggSeconds from desired number of bins and `since`
      const duration = (until || Date.now()) - since.getTime();
      aggSeconds = Math.floor((duration/1000)/(bins - 1));
    }

    // if aggregation is requested, build the GROUP BY expression and update SELECT
    if (aggSeconds) {
      // SQL sub-string to extract the desired value from the JSON payload
      // const wildParts = wildIndices.map(i => `TopicParts[${i + 1}]`);
      // update SELECT statement with aggregations

      select = [
        // Cast `count` result to Float64 to avoid UInt64 which ClickHouse turns
        // into a string in JSON.
        agg == 'count' ? `CAST(${agg}(${extractValue}), 'Float64') as aggValue`
        : `${agg}(${extractValue}) as aggValue`,
        // ...wildParts,
        'TopicParts',
        `toStartOfInterval(Timestamp, INTERVAL ${aggSeconds} SECOND) as time`
      ];
      // group = `GROUP BY (time,${wildParts.join(',')})`
      group = `GROUP BY (time,TopicParts)`
    }

    const query = `SELECT ${select.join(',')} FROM default.${this.mqttHistoryTable} ${
      whereStatement} ${group} ORDER BY ${orderBy} ${limit ? ` LIMIT ${limit}` : ''}`;
    // console.log(query);
    const result = await this.client.query({ query, format: 'JSONEachRow' });
    const rows = await result.json();

    // map payloads back from JSON; this is the inverse of what we do in
    // registerMqttTopicForStorage
    return rows.map(row => {
      row.Payload = row.Payload ? JSON.parse(row.Payload) : null;
      row.Timestamp = new Date(`${row.time}Z`);
      row.OrgId = row.TopicParts[0];
      row.DeviceId = row.TopicParts[1];
      row.Scope = row.TopicParts[2];
      row.CapabilityName = row.TopicParts[3];
      row.CapabilityVersion = row.TopicParts[4];
      row.SubTopic = row.TopicParts.slice(5);
      return row;
    });
  }
}

const instance = new ClickHouse();
module.exports = instance;

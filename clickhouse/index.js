const _ = require('lodash');
const { createClient } = require('@clickhouse/client');
const { topicToPath } = require('@transitive-sdk/datacache');

// Default TTL in days for mqtt_history table
const DEFAULT_TTL_DAYS = 30;

// Shared multi-tenant schema components used by createTable and ensureMqttHistoryTable
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

/** Singleton ClickHouse client wrapper with multi-tenant table support */
class ClickHouse {

  _client = null;
  _alreadyEnsuredHistoryTable = false;

  /** Create the client, connecting to Clickhouse */
  init({ url, dbName, user, password } = {}) {
    const _url = url || process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
    const _dbName = dbName || process.env.CLICKHOUSE_DB || 'default';
    const _user = user || process.env.CLICKHOUSE_USER || 'default';

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
  }

  /** Get the Clickhouse client (from @clickhouse/client) */
  get client() {
    if (this._client == undefined) {
      console.warn('Cannot access ClickHouse client before init() is called');
      throw new Error('ClickHouse client not initialized');
    }
    return this._client;
  }

  /** Create a table if it does not already exist adding OrgId and DeviceId
   * columns to the schema for multi-tenancy support.
   * @param {string} tableName - name of the table to create
   * @param {Array<string>} columns - array of column definitions and indexes, e.g. ['Timestamp DateTime CODEC(ZSTD(1))', 'Value Float32 CODEC(ZSTD(1))']
   * @param {Array<string>} settings - array of table settings, e.g. ['ENGINE = MergeTree()', 'ORDER BY (Timestamp)']
   */
  async createTable(tableName, columns, settings = []) {
    const fullSchema = [
      ...columns,
      ...MULTI_TENANT_SCHEMA.columns,
      ...MULTI_TENANT_SCHEMA.indexes
    ];
    const query = `CREATE TABLE IF NOT EXISTS ${tableName} (${fullSchema.join(', ')}) ${settings.join(' ')}`;

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

  /** Update the TTL for the mqtt_history table
   * @param {number} ttlDays - TTL in days
   */
  async updateMqttHistoryTTL(ttlDays) {
    // console.log(`updating ttl to ${ttlDays}`);
    await this.client.command({
      query: `ALTER TABLE mqtt_history MODIFY TTL toDateTime(Timestamp) + toIntervalDay(${ttlDays})`,
      clickhouse_settings: {
        wait_end_of_query: 1,
      }
    });
  }

  /** Ensure the mqtt_history table exists with the correct schema
   * @param {number} ttlDays - TTL in days (default: 30)
   */
  async ensureMqttHistoryTable(ttlDays = DEFAULT_TTL_DAYS) {
    const columns = [
      // High-precision event time; Delta+ZSTD is a common combo for time-series
      'Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1))',
      // Raw MQTT topic split into parts; kept as Array(String) for flexibility
      'TopicParts Array(String) CODEC(ZSTD(1))',
      // Org/device fields materialized from TopicParts (always computed, not overridable)
      'OrgId LowCardinality(String) MATERIALIZED TopicParts[1] CODEC(ZSTD(1))',
      'DeviceId LowCardinality(String) MATERIALIZED TopicParts[2] CODEC(ZSTD(1))',
      'Scope LowCardinality(String) MATERIALIZED TopicParts[3] CODEC(ZSTD(1))',
      'CapabilityName LowCardinality(String) MATERIALIZED TopicParts[4] CODEC(ZSTD(1))',
      'CapabilityVersion LowCardinality(String) MATERIALIZED TopicParts[5] CODEC(ZSTD(1))',
      // Remaining topic segments stored as an array for less-structured suffixes
      'SubTopic Array(String) MATERIALIZED arraySlice(TopicParts, 6) CODEC(ZSTD(1))',
      // Payload stored as a String, compressed with ZSTD(1). This allows us to
      // store atomic values (still stringified) as opposed to only JSON objects,
      // as the JSON type would require.
      'Payload String CODEC(ZSTD(1))',
      // Bloom filter indexes (shared multi-tenant indexes)
      ...MULTI_TENANT_SCHEMA.indexes,
      'INDEX idx_scope (Scope) TYPE bloom_filter(0.01) GRANULARITY 1',
      'INDEX idx_capability (CapabilityName) TYPE bloom_filter(0.01) GRANULARITY 1'
    ];

    const ttlExpression = `TTL toDateTime(Timestamp) + toIntervalDay(${ttlDays})`;

    const query = `CREATE TABLE IF NOT EXISTS mqtt_history (${columns.join(', ')})
      ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(Timestamp)
      PRIMARY KEY (Timestamp, OrgId, DeviceId, Scope, CapabilityName, CapabilityVersion, SubTopic)
      ORDER BY (Timestamp, OrgId, DeviceId, Scope, CapabilityName, CapabilityVersion, SubTopic)
      ${ttlExpression}
      SETTINGS
        index_granularity = 8192,
        ttl_only_drop_parts = 1`;

    // Check if table already exists before creating
    const tableExists = await this.client.query({
      query: "SELECT name, create_table_query	FROM system.tables WHERE name = 'mqtt_history' AND database = currentDatabase()",
      format: 'JSONEachRow'
    });
    const tables = await tableExists.json();

    if (tables.length > 0) {
      // table already exists, verify TTL
      const originalCreateQuery = tables[0].create_table_query;

      // Update table if it differs
      if (!originalCreateQuery.includes(ttlExpression)) {
        await this.updateMqttHistoryTTL(ttlDays);
      }
    } else {
      // Create the table
      await this.client.command({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1,
        }
      });
    }

    this._alreadyEnsuredHistoryTable = true;
  }

  /** Register an MQTT topic for storage in ClickHouse subscribes to the topic
  * and stores incoming messages JSON.stringify'd in a ClickHouse table.
  * Retrieve using `queryMQTTHistory`, or, when quering directly, e.g., from
  * Grafana, use the ClickHouse built-in functionality for parsing JSON, e.g.,
  * after inserting `{ x: 1 }` use
  * `select JSON_VALUE(Payload, '$.x') AS x FROM default.mqtt_history`.
  * NOTE: `ensureMqttHistoryTable` must be called before registering topics
  * @param {Object} dataCache - DataCache instance to use for subscribing
  * @param {string} topic - MQTT topic to register
  */
  registerMqttTopicForStorage(dataCache, topic) {
    if (!this._alreadyEnsuredHistoryTable) {
      throw new Error('ensureMqttHistoryTable must be called before registerMqttTopicForStorage');
    }

    // Subscribe to the topic
    dataCache.subscribePath(topic, async (value, topicString) => {
      const row = {
        Timestamp: new Date(),
        TopicParts: topicToPath(topicString), // topic as array
      };

      if (value !== null && value !== undefined) {
        row.Payload = JSON.stringify(value);
      } // else: omit

      try {
        await this.client.insert({
          table: 'mqtt_history',
          values: [row],
          format: 'JSONEachRow'
        });
      } catch (error) {
        console.error('Error inserting MQTT message into ClickHouse:', error.message);
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
      orderBy = 'Timestamp ASC',
      limit = 1000
    } = options;

    const [OrgId, DeviceId, Scope, CapabilityName, CapabilityVersion, ...subPath]
      = topicToPath(topicSelector);
    // store as objects so we can refer to them by column name
    const fields = { OrgId, DeviceId, Scope, CapabilityName, CapabilityVersion };

    const selectors = ['Payload', 'TopicParts', 'Timestamp', 'SubTopic'];
    const where = [];

    // interpret wildcards
    _.forEach(fields, (value, field) => {
      if (value.startsWith('+')) {
        // it's a wild card, add to selectors
        selectors.push(field);
      } else {
        // it's a constant, filter by it
        where.push(`${field} = '${value}'`);
      }
    });

    // special WHERE conditions for SubPath (if given)
    subPath?.forEach((value, i) =>
      !value.startsWith('+') && where.push(`SubTopic[${i}] = '${value}'`));

    since && where.push(`Timestamp >= fromUnixTimestamp64Milli(${since.getTime()})`);
    until && where.push(`Timestamp <= fromUnixTimestamp64Milli(${until.getTime()})`);

    const whereStatement = where.length > 0
      ? `WHERE ${where.join(' AND ')}`
      : '';

    const result = await this.client.query({
      query: `SELECT ${selectors.join(',')} FROM mqtt_history ${whereStatement
        } ORDER BY ${orderBy} ${limit ? ` LIMIT ${limit}` : ''}`,
      format: 'JSONEachRow'
    });

    const rows = await result.json();

    // map payloads back from JSON; this is the inverse of what we do in
    // registerMqttTopicForStorage
    return rows.map(row => {
      row.Payload = row.Payload ? JSON.parse(row.Payload) : null;
      row.Timestamp = new Date(row.Timestamp);
      return row;
    });
  }
}

const instance = new ClickHouse();
module.exports = instance;

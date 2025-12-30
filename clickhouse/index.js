const { createClient } = require('@clickhouse/client');

/** Singleton ClickHouse client wrapper with multi-tenant table support */
class ClickHouse {
  init({ url, dbName, user, password } = {}) {
    const _url = url || process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
    const _dbName = dbName || process.env.CLICKHOUSE_DB || 'default';
    const _user = user || process.env.CLICKHOUSE_USER || 'default';
    const _password = password || process.env.CLICKHOUSE_PASSWORD || '';
    this._alreadyEnsuredHistoryTable = false;
    console.debug(`Creating ClickHouse client for URL: ${_url}, DB: ${_dbName}, User: ${_user}`);
    this._client = createClient({
      url: _url,
      max_open_connections: 10,
      database: _dbName,
      username: _user,
      password: _password,
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
      },
    });
  }

  get client() {
    if (this._client == undefined) {
      console.warn('Cannot access ClickHouse client before init() is called');
      throw new Error('ClickHouse client not initialized');
    }
    return this._client;
  }

  /** Create a table if it does not already exist
   * adding OrgId and DeviceId columns to the schema
   * for multi-tenancy support.
   * @param {string} tableName - name of the table to create
   * @param {Array<string>} columns - array of column definitions and indexes, e.g. ['Timestamp DateTime CODEC(ZSTD(1))', 'Value Float32 CODEC(ZSTD(1))']
   * @param {Array<string>} settings - array of table settings, e.g. ['ENGINE = MergeTree()', 'ORDER BY (Timestamp)']
   */
  async createTable(tableName, columns, settings = []) {
    const fullSchema = [
      ...columns,
      'OrgId String CODEC(ZSTD(1))',    // TODO: This should be LowCardinality for better performance
      'DeviceId String CODEC(ZSTD(1))', // But we'll need a schema migration
      'INDEX idx_orgid (OrgId) TYPE bloom_filter(0.01) GRANULARITY 1',
      'INDEX idx_deviceid (DeviceId) TYPE bloom_filter(0.01) GRANULARITY 1'
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

  /** Ensure the mqtt_history table exists with the correct schema
   */
  async ensureMqttHistoryTable() {
    if (this._alreadyEnsuredHistoryTable) {
      return;
    }
    // ensure mqtt_history table exists
    // Note: DEFAULT must come before CODEC in ClickHouse syntax
    // TopicParts is filtered to remove empty strings, so indices are 1-based
    const query = `CREATE TABLE IF NOT EXISTS mqtt_history (
        -- High‑precision event time; Delta+ZSTD is a common combo for time-series
        -- (mirrors observability schemas like otel_logs/otel_traces).
        Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),

        -- Raw MQTT topic split into parts; kept as Array(String) for flexibility.
        TopicParts Array(String) CODEC(ZSTD(1)),

        -- Org/device/name/capability fields are materialized from TopicParts.
        -- Using LowCardinality(String) follows the pattern used for ServiceName,
        -- SeverityText, etc. in OTel schemas to improve compression and speed.
        OrgId LowCardinality(String) DEFAULT TopicParts[1] CODEC(ZSTD(1)),
        DeviceId LowCardinality(String) DEFAULT TopicParts[2] CODEC(ZSTD(1)),
        Scope LowCardinality(String) DEFAULT TopicParts[3] CODEC(ZSTD(1)),
        CapabilityName LowCardinality(String) DEFAULT TopicParts[4] CODEC(ZSTD(1)),
        CapabilityVersion LowCardinality(String) DEFAULT TopicParts[5] CODEC(ZSTD(1)),

        -- Remaining topic segments stored as an array for less-structured suffixes.
        SubTopic Array(String) DEFAULT arraySlice(TopicParts, 6) CODEC(ZSTD(1)),

        -- Payload stored as String with ZSTD(1), similar to log Body in OTel schemas.
        Payload String CODEC(ZSTD(1)),

        -- Bloom filter indices: pattern borrowed from OTel/logging schemas where
        -- bloom filters are applied to frequently-filtered dimensions. Effectiveness
        -- depends on correlation with ORDER BY and actual query patterns.
        INDEX idx_orgid (OrgId) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_deviceid (DeviceId) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_scope (Scope) TYPE bloom_filter(0.01) GRANULARITY 1,
        INDEX idx_capability (CapabilityName) TYPE bloom_filter(0.01) GRANULARITY 1
    )
    ENGINE = MergeTree()
    -- Partition by day, matching the time-based TTL. This is the same pattern used
    -- in observability/log schemas to make dropping expired data efficient.
    PARTITION BY toYYYYMMDD(Timestamp)

    -- Primary key defines the sparse index; putting OrgId and DeviceId first
    -- optimizes for queries scoped by org/device, then narrowed by time.
    PRIMARY KEY (OrgId, DeviceId, Timestamp)

    -- ORDER BY controls on-disk sort and primary index layout. This order is
    -- tuned for access patterns like "all messages for org+device over time",
    -- similar to (ServiceName, Timestamp, ...) in OTel examples.
    ORDER BY (OrgId, DeviceId, Timestamp)

    -- Table-level TTL: automatically removes data 30 days after Timestamp.
    -- This follows the same pattern as otel_logs/otel_traces TTL definitions.
    TTL toDateTime(Timestamp) + toIntervalDay(30)

    SETTINGS
      -- Default granularity used in the observability examples; balances index
      -- size and skipping efficiency.
      index_granularity = 8192,

      -- Recommended for TTL-based retention: drop whole parts when all rows
      -- are expired, avoiding expensive row-level TTL mutations.
      ttl_only_drop_parts = 1`;

    try {
      await this.client.exec({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1,
        }
      });
      this._alreadyEnsuredHistoryTable = true;
    } catch (error) {
      console.error('Error executing query:', error.message);
      console.debug('Query was:', query);
      throw error;
    }
  }

  /** Register an MQTT topic for storage in ClickHouse
   * subscribes to the topic and stores incoming messages
   * in a ClickHouse table.
   * @param {Object} dataCache - DataCache instance to use for subscribing
   * @param {string} topic - MQTT topic to register
   */
  async registerMqttTopicForStorage(dataCache, topic) {
    await this.ensureMqttHistoryTable();
    // Subscribe to the topic using subscribePath to get objects as-is (not flattened to leaves)
    dataCache.subscribePath(topic, async (value, topic, matched, tags) => {
      const timestamp = new Date();
      // Remove leading empty string caused by topic starting with '/'
      const topicParts = topic.replace(/^\//, '').split('/');
      const payload = value == null ? null : (typeof value === 'string' ? value : JSON.stringify(value));
      const row = {
        Timestamp: timestamp.toISOString(),
        TopicParts: topicParts,
        Payload: payload,
      };
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
}

const instance = new ClickHouse();
module.exports = instance;
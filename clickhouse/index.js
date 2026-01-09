const { createClient } = require('@clickhouse/client');
const { topicToPath } = require('../common/datacache/tools');

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
  init({ url, dbName, user, password } = {}) {
    const _url = url || process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
    const _dbName = dbName || process.env.CLICKHOUSE_DB || 'default';
    const _user = user || process.env.CLICKHOUSE_USER || 'default';
    const _password = password || process.env.CLICKHOUSE_PASSWORD || '';
    this._alreadyEnsuredHistoryTable = false;
    this._currentTtlDaysForHistoryTable = null;
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
    const query = `ALTER TABLE mqtt_history MODIFY TTL toDateTime(Timestamp) + toIntervalDay(${ttlDays})`;
    try {
      await this.client.exec({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1,
        }
      });
      this._currentTtlDaysForHistoryTable = ttlDays;
      console.debug(`Updated mqtt_history TTL to ${ttlDays} days`);
    } catch (error) {
      console.error('Error updating TTL:', error.message);
      throw error;
    }
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
      // Org/device fields derived from TopicParts
      'OrgId LowCardinality(String) DEFAULT TopicParts[1] CODEC(ZSTD(1))',
      'DeviceId LowCardinality(String) DEFAULT TopicParts[2] CODEC(ZSTD(1))',
      // Capability-specific fields materialized from TopicParts
      'Scope LowCardinality(String) DEFAULT TopicParts[3] CODEC(ZSTD(1))',
      'CapabilityName LowCardinality(String) DEFAULT TopicParts[4] CODEC(ZSTD(1))',
      'CapabilityVersion LowCardinality(String) DEFAULT TopicParts[5] CODEC(ZSTD(1))',
      // Remaining topic segments stored as an array for less-structured suffixes
      'SubTopic Array(String) DEFAULT arraySlice(TopicParts, 6) CODEC(ZSTD(1))',
      // Payload stored as String with ZSTD(1)
      'Payload String CODEC(ZSTD(1))',
      // Bloom filter indexes (shared multi-tenant indexes)
      ...MULTI_TENANT_SCHEMA.indexes,
      'INDEX idx_scope (Scope) TYPE bloom_filter(0.01) GRANULARITY 1',
      'INDEX idx_capability (CapabilityName) TYPE bloom_filter(0.01) GRANULARITY 1'
    ];

    const query = `CREATE TABLE IF NOT EXISTS mqtt_history (${columns.join(', ')})
      ENGINE = MergeTree()
      PARTITION BY toYYYYMMDD(Timestamp)
      PRIMARY KEY (OrgId, DeviceId, Timestamp, TopicParts)
      ORDER BY (OrgId, DeviceId, Timestamp, TopicParts)
      TTL toDateTime(Timestamp) + toIntervalDay(${ttlDays})
      SETTINGS
        index_granularity = 8192,
        ttl_only_drop_parts = 1`;

    try {
      await this.client.exec({
        query,
        clickhouse_settings: {
          wait_end_of_query: 1,
        }
      });

      // If table already existed (or was just created), update TTL if different
      if (this._alreadyEnsuredHistoryTable && this._currentTtlDaysForHistoryTable !== ttlDays) {
        await this.updateMqttHistoryTTL(ttlDays);
      } else if (!this._alreadyEnsuredHistoryTable) {
        // First time - check if table existed with different TTL and update if needed
        // We can't easily detect the current TTL, so we always update it to be safe
        await this.updateMqttHistoryTTL(ttlDays);
      }

      this._alreadyEnsuredHistoryTable = true;
      this._currentTtlDaysForHistoryTable = ttlDays;
    } catch (error) {
      console.error('Error executing query:', error.message);
      console.debug('Query was:', query);
      throw error;
    }
  }

  /** Register an MQTT topic for storage in ClickHouse
   * subscribes to the topic and stores incoming messages
   * in a ClickHouse table.
   * NOTE: ensureMqttHistoryTable must be called before registering topics
   * @param {Object} dataCache - DataCache instance to use for subscribing
   * @param {string} topic - MQTT topic to register
   */
  registerMqttTopicForStorage(dataCache, topic) {
    if (!this._alreadyEnsuredHistoryTable) {
      throw new Error('ensureMqttHistoryTable must be called before registerMqttTopicForStorage');
    }

    // Subscribe to the topic using subscribePath to get objects as-is (not flattened to leaves)
    dataCache.subscribePath(topic, async (value, topicString) => {
      const timestamp = new Date();
      // Use topicToPath from transitive-utils which properly handles URL-encoded elements
      const topicParts = topicToPath(topicString);
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

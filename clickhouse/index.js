const { createClient } = require('@clickhouse/client');

/** Singleton ClickHouse client wrapper with multi-tenant table support */
class ClickHouse {
  init({url, dbName, user, password} = {}) {
    const _url = url || process.env.CLICKHOUSE_URL || 'http://clickhouse:8123';
    const _dbName = dbName || process.env.CLICKHOUSE_DB || 'default';
    const _user = user || process.env.CLICKHOUSE_USER || 'default';
    const _password = password || process.env.CLICKHOUSE_PASSWORD || '';
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
      'OrgId String CODEC(ZSTD(1))',
      'DeviceId String CODEC(ZSTD(1))',
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
}

const instance = new ClickHouse();
module.exports = instance;
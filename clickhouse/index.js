const { createClient } = require('@clickhouse/client');

/** Singleton ClickHouse client wrapper with multi-tenant table support */
class ClickHouse {
  init({url, dbName, user, password}) {
    console.debug(`Creating ClickHouse client for URL:`, url, `Database:`, dbName, `User:`, user);
    this._client = createClient({
      url: url,
      max_open_connections: 10,
      database: dbName,
      username: user,
      password: password,
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
  async createMultitenantTable(tableName, columns, settings = []) {
    const fullSchema = [
      ...columns,
      'OrgId String CODEC(ZSTD(1))',
      'DeviceId String CODEC(ZSTD(1))',
      'INDEX idx_orgid (OrgId) TYPE bloom_filter(0.01) GRANULARITY 1',
      'INDEX idx_deviceid (DeviceId) TYPE bloom_filter(0.01) GRANULARITY 1'
    ];
    const query = `CREATE TABLE IF NOT EXISTS ${tableName} (${fullSchema.join(', ')}) ${settings.join(' ')}`;
    
    try {
      return await this._client.exec({
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
  async insertIntoMultitenantTable(tableName, rows, orgId, deviceId) {
    const rowsWithIds = rows.map(row => ({
      ...row,
      OrgId: orgId,
      DeviceId: deviceId
    }));
    return await this._client.insert({
      table: tableName,
      values: rowsWithIds,
      format: 'JSONEachRow'
    });
  }
}

/** Ensure ClickHouse database and user exist for a capability
 * Only used with admin ClickHouse user credentials.
 * @param {Object} params - parameters object
 * @param {string} params.url - ClickHouse server URL
 * @param {string} params.dbName - name of the database to create/use
 * @param {string} params.adminUser - admin username for ClickHouse
 * @param {string} params.adminPassword - admin password for ClickHouse
 * @param {string} [params.user] - optional username for the capability to use (will be created if not exists)
 * @param {string} [params.password] - optional password for the capability user (will be generated if not provided)
 * @param {Collection} mongoCredentialsCollection - MongoDB collection to store/retrieve credentials
 * @returns {Object} - object containing `user` and `password`
 */
const setupCapabilityDB = async ({url,dbName, adminUser, adminPassword, user, password, mongoCredentialsCollection}) => {
  console.debug(`Setting up ClickHouse database: ${dbName}`);
  const clickhouseClient = createClient({
    url: url,
    username: adminUser,
    password: adminPassword,
    // TODO: pass admin user and password
    clickhouse_settings: {
      // https://clickhouse.com/docs/en/operations/settings/settings#async-insert
      async_insert: 1,
      // https://clickhouse.com/docs/en/operations/settings/settings#wait-for-async-insert
      wait_for_async_insert: 1,
    },
  });

  console.debug('Ensuring clickhouse database exists', dbName);
  await clickhouseClient.exec({
    query: `CREATE DATABASE IF NOT EXISTS ${dbName}`
  });

  const _user = user || `${dbName}_user`;
  console.debug(`ensuring clickhouse user ${_user} for database ${dbName}`);
  // Check if user exists
  const userExists = await clickhouseClient.query({
    query: `SELECT name FROM system.users WHERE name = '${_user}'`,
    format: 'JSONEachRow'
  });

  const users = await userExists.json();
  if (users.length > 0) {
    // retrieve password from mongo
    const userDoc = await mongoCredentialsCollection.findOne({ user: _user, db: dbName });
    if (userDoc) {
      console.debug(`ClickHouse user ${_user} for database ${dbName} already exists`);
      return {
        user: _user,
        password: userDoc.password
      }
    }
  }

  // Generate new password if user doesn't exist
  const _password = password || Math.random().toString(36).slice(-12);

  // store user and password in mongo
  // const usersCollection = Mongo.db.collection('clickhouse_users');
  await mongoCredentialsCollection.updateOne(
    { user: _user, db: dbName },
    { $set: { password: _password } },
    { upsert: true }
  );

  // create database user if needed
  await clickhouseClient.exec({
    query: `CREATE USER IF NOT EXISTS ${_user} IDENTIFIED WITH plaintext_password BY '${_password}'`
  });

  // grant all privileges on the cap database to the user
  await clickhouseClient.exec({
    query: `GRANT ALL ON ${dbName}.* TO ${_user}`
  });

  console.debug(`ClickHouse user ${_user} for database ${dbName} created`);

  return {
    user: _user,
    password: _password
  };
}

const instance = new ClickHouse();
module.exports = {
  ClickHouse: instance,
  setupCapabilityDB
};
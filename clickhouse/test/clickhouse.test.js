const assert = require('assert');
const clickhouse = require('../index');
const { DataCache } = require('../../common/datacache');

const CLICKHOUSE_URL = 'http://clickhouse.azeroth.local';
const CLICKHOUSE_USER = 'truser';
const CLICKHOUSE_PASSWORD = 'transitive';

const STANDARD_TOPIC_PATTERN = '/+org/+device/+scope/+cap/+version/#';

/** Wrap client.insert to track when N inserts complete */
function interceptInserts(expectedCount) {
  let insertCount = 0;
  let resolve;
  const done = new Promise(r => resolve = r);

  const originalInsert = clickhouse.client.insert.bind(clickhouse.client);
  clickhouse.client.insert = async (...args) => {
    const result = await originalInsert(...args);
    if (++insertCount >= expectedCount) resolve();
    return result;
  };

  const restore = () => { clickhouse.client.insert = originalInsert; };
  return { done, restore };
}

/** Query mqtt_history rows for a given org */
async function queryRowsByOrg(org, options = {}) {
  const { orderBy = 'Timestamp ASC', limit } = options;
  const result = await clickhouse.client.query({
    query: `SELECT * FROM mqtt_history WHERE OrgId = {org:String} ORDER BY ${orderBy}${limit ? ` LIMIT ${limit}` : ''}`,
    query_params: { org },
    format: 'JSONEachRow'
  });
  return result.json();
}

/** Generate unique org ID for test isolation */
function testOrg(suffix) {
  return `test_${suffix}_${Date.now()}`;
}

describe('ClickHouse', function() {
  this.timeout(10000);

  before(function() {
    clickhouse.init({
      url: CLICKHOUSE_URL,
      user: CLICKHOUSE_USER,
      password: CLICKHOUSE_PASSWORD,
    });
  });

  after(async function() {
    await clickhouse.client.exec({
      query: `ALTER TABLE mqtt_history DELETE WHERE OrgId LIKE 'test_%'`,
      clickhouse_settings: { wait_end_of_query: 1 }
    });
  });

  describe('ensureMqttHistoryTable', function() {
    it('should create the mqtt_history table', async function() {
      await clickhouse.ensureMqttHistoryTable();

      const result = await clickhouse.client.query({
        query: "SELECT name FROM system.tables WHERE name = 'mqtt_history'",
        format: 'JSONEachRow'
      });
      const tables = await result.json();

      assert(tables.length > 0, 'mqtt_history table should exist');
    });
  });

  describe('registerMqttTopicForStorage', function() {
    it('should insert MQTT messages into ClickHouse', async function() {
      const dataCache = new DataCache({});
      const org = testOrg('insert');
      const { done, restore } = interceptInserts(1);

      await clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@robot', 'test-cap', '1.0.0', 'data'], 42.5);

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.OrgId, org);
      assert.strictEqual(row.DeviceId, 'device1');
      assert.strictEqual(row.Scope, '@robot');
      assert.strictEqual(row.CapabilityName, 'test-cap');
      assert.strictEqual(row.CapabilityVersion, '1.0.0');
      assert.deepStrictEqual(row.SubTopic, ['data']);
      assert.strictEqual(row.Payload, '42.5');
    });

    it('should store string payloads as-is', async function() {
      const dataCache = new DataCache({});
      const org = testOrg('string');
      const { done, restore } = interceptInserts(1);

      await clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@robot', 'cap', '1.0.0', 'msg'], 'hello world');

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Payload, 'hello world');
    });

    it('should store null values as empty string', async function() {
      const dataCache = new DataCache({});
      const org = testOrg('null');
      const { done, restore } = interceptInserts(2);

      await clickhouse.registerMqttTopicForStorage(dataCache, '/+org/+device/#');
      dataCache.update([org, 'device1', 'data'], 'initial');
      dataCache.update([org, 'device1', 'data'], null);

      await done;
      restore();

      const rows = await queryRowsByOrg(org);

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].Payload, 'initial');
      assert.strictEqual(rows[1].Payload, '');
    });

    it('should store object payloads as JSON', async function() {
      const dataCache = new DataCache({});
      const org = testOrg('object');
      const { done, restore } = interceptInserts(1);
      const payload = { sensor: 'temp', value: 25.5, nested: { a: 1 } };

      await clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@robot', 'cap', '1.0.0', 'readings'], payload);

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.deepStrictEqual(JSON.parse(row.Payload), payload);
      assert.deepStrictEqual(row.SubTopic, ['readings']);
    });

    it('should parse nested subtopics correctly', async function() {
      const dataCache = new DataCache({});
      const org = testOrg('subtopic');
      const { done, restore } = interceptInserts(1);

      await clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@cloud', 'cap', '2.0.0', 'level1', 'level2'], 'value');

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Scope, '@cloud');
      assert.strictEqual(row.CapabilityVersion, '2.0.0');
      assert.deepStrictEqual(row.SubTopic, ['level1', 'level2']);
    });

    it('should handle multiple updates to different subtopics', async function() {
      const dataCache = new DataCache({});
      const org = testOrg('multi');
      const { done, restore } = interceptInserts(2);

      await clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@robot', 'cap', '1.0.0', 'battery'], 85);
      dataCache.update([org, 'device1', '@robot', 'cap', '1.0.0', 'temperature'], 42);

      await done;
      restore();

      const rows = await queryRowsByOrg(org);

      assert.strictEqual(rows.length, 2);
      const subtopics = rows.map(r => r.SubTopic[0]).sort();
      const payloads = Object.fromEntries(rows.map(r => [r.SubTopic[0], r.Payload]));
      assert.deepStrictEqual(subtopics, ['battery', 'temperature']);
      assert.strictEqual(payloads['battery'], '85');
      assert.strictEqual(payloads['temperature'], '42');
    });

    it('should work with unnamed wildcards', async function() {
      const dataCache = new DataCache({});
      const org = testOrg('unnamed');
      const { done, restore } = interceptInserts(1);

      await clickhouse.registerMqttTopicForStorage(dataCache, '/+/+/+/+/+/#');
      dataCache.update([org, 'device1', '@robot', 'cap', '1.0.0', 'data'], { x: 1 });

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.OrgId, org);
      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepStrictEqual(JSON.parse(row.Payload), { x: 1 });
    });
  });
});

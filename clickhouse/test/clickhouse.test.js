const assert = require('assert');
const dotenv = require('dotenv');
const { DataCache } = require('@transitive-sdk/datacache');

const clickhouse = require('../index');

dotenv.config({path: '~transitive/.env'});
const CLICKHOUSE_URL = 'http://clickhouse.localhost';
const STANDARD_TOPIC_PATTERN = '/+org/+device/+scope/+cap/+version/#';

/** Wrap client.insert to track when N inserts complete */
const interceptInserts = (expectedCount) => {
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
const queryRowsByOrg = async (org, options = {}) =>
  await clickhouse.queryMQTTHistory({
    topicSelector: `/${org}/+/+/+/+/+`
  });

/** Generate unique org ID for test isolation */
const testOrg = (suffix) => `clickhouse_test_${suffix}_${Date.now()}`;


describe('ClickHouse', function() {
  this.timeout(10000);

  before(function() {
    clickhouse.init({ url: CLICKHOUSE_URL });
  });

  after(async () => {
    await clickhouse.client.exec({
      query: `ALTER TABLE mqtt_history DELETE WHERE OrgId LIKE 'clickhouse_test_%'`,
      clickhouse_settings: { wait_end_of_query: 1 }
    });
  });

  describe('ensureMqttHistoryTable', () => {
    it('should create the mqtt_history table', async () => {
      await clickhouse.ensureMqttHistoryTable(31);

      const result = await clickhouse.client.query({
        query: "SELECT name FROM system.tables WHERE name = 'mqtt_history'",
        format: 'JSONEachRow'
      });
      const tables = await result.json();

      assert(tables.length > 0, 'mqtt_history table should exist');
    });
  });

  describe('registerMqttTopicForStorage', () => {
    before(async () => {
      await clickhouse.ensureMqttHistoryTable(32);
    });

    it('should insert MQTT messages into ClickHouse', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('insert');
      const { done, restore } = interceptInserts(1);

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'test-cap', '1.0.0', 'data'], 42.5);

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.DeviceId, 'device1');
      assert.strictEqual(row.Scope, '@myscope');
      assert.strictEqual(row.CapabilityName, 'test-cap');
      assert.strictEqual(row.CapabilityVersion, '1.0.0');
      assert.deepStrictEqual(row.SubTopic, ['data']);
      assert.strictEqual(row.Payload, 42.5);
    });

    it('should store string payloads as-is', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('string');
      const { done, restore } = interceptInserts(1);

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'msg'], 'hello world');

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Payload, 'hello world');
    });

    it('should store null values as NULL (omitted)', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('null');
      const { done, restore } = interceptInserts(2);

      clickhouse.registerMqttTopicForStorage(dataCache, '/+org/+device/#');
      dataCache.update([org, 'device1', 'data'], 'initial');
      // Small delay to ensure timestamp ordering
      await new Promise(resolve => setTimeout(resolve, 10));
      dataCache.update([org, 'device1', 'data'], null);

      await done;
      restore();

      const rows = await queryRowsByOrg(org);

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].Payload, 'initial');
      assert.strictEqual(rows[1].Payload, null);
    });

    it('should store object payloads as JSON', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('object');
      const { done, restore } = interceptInserts(1);
      const payload = { sensor: 'temp', value: 25.5, nested: { a: 1 } };

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'readings'], payload);

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.deepStrictEqual(row.Payload, payload);
      assert.deepStrictEqual(row.SubTopic, ['readings']);
    });

    it('should parse nested subtopics correctly', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('subtopic');
      const { done, restore } = interceptInserts(1);

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '2.0.0', 'level1', 'level2'], 'value');

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Scope, '@myscope');
      assert.strictEqual(row.CapabilityVersion, '2.0.0');
      assert.deepStrictEqual(row.SubTopic, ['level1', 'level2']);
    });

    it('should handle multiple updates to different subtopics', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('multi');
      const { done, restore } = interceptInserts(2);

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'battery'], 85);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'temperature'], 42);

      await done;
      restore();

      const rows = await queryRowsByOrg(org);

      assert.strictEqual(rows.length, 2);
      const subtopics = rows.map(r => r.SubTopic[0]).sort();
      const payloads = Object.fromEntries(rows.map(r => [r.SubTopic[0], r.Payload]));
      assert.deepStrictEqual(subtopics, ['battery', 'temperature']);
      assert.strictEqual(payloads['battery'], 85);
      assert.strictEqual(payloads['temperature'], 42);
    });

    it('should work with unnamed wildcards', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('unnamed');
      const { done, restore } = interceptInserts(1);

      clickhouse.registerMqttTopicForStorage(dataCache, '/+/+/+/+/+/#');
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data'], { x: 1 });

      await done;
      restore();

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepStrictEqual(row.Payload, { x: 1 });
    });
  });
});

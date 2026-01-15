const assert = require('assert');
const { EventEmitter, once } = require('node:events');
const dotenv = require('dotenv');
const { DataCache } = require('@transitive-sdk/datacache');

const clickhouse = require('../index');

dotenv.config({path: '~transitive/.env'});
const CLICKHOUSE_URL = 'http://clickhouse.localhost';
const STANDARD_TOPIC_PATTERN = '/+org/+device/+scope/+cap/+version/#';

/** Wrap client.insert in an event emitter so we can get notified of insert
 * events. */
const interceptInserts = () => {
  const emitter = new EventEmitter();

  const originalInsert = clickhouse.client.insert.bind(clickhouse.client);
  clickhouse.client.insert = async (...args) => {
    const result = await originalInsert(...args);
    emitter.emit('insert');
    return result;
  };

  return emitter;
}


/** Query mqtt_history rows for a given org */
const queryRowsByOrg = async (org, options = {}) =>
  await clickhouse.queryMQTTHistory({ topicSelector: `/${org}/+/+/+/+/+` });

/** Generate unique org ID for test isolation */
const testOrg = (suffix) => `clickhouse_test_${suffix}_${Date.now()}`;


describe('ClickHouse', function() {
  this.timeout(10000);

  let emitter;

  before(() => {
    clickhouse.init({ url: CLICKHOUSE_URL });
    /* Register for `insert` events on ClickHouse client */
    emitter = interceptInserts();
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

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'test-cap', '1.0.0', 'data'], 42.5);
      await once(emitter, 'insert');

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

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'msg'], 'hello world');
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Payload, 'hello world');
    });

    it('should store null values as NULL (omitted)', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('null');
      // const done = interceptInserts(2);

      clickhouse.registerMqttTopicForStorage(dataCache, '/+org/+device/#');
      dataCache.update([org, 'device1', 'data'], 'initial');
      // Small delay to ensure timestamp ordering
      await new Promise(resolve => setTimeout(resolve, 10));
      dataCache.update([org, 'device1', 'data'], null);
      await once(emitter, 'insert');
      await once(emitter, 'insert');

      const rows = await queryRowsByOrg(org);

      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].Payload, 'initial');
      assert.strictEqual(rows[1].Payload, null);
    });

    it('should store object payloads as JSON', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('object');
      const payload = { sensor: 'temp', value: 25.5, nested: { a: 1 } };

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'readings'], payload);
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.deepStrictEqual(row.Payload, payload);
      assert.deepStrictEqual(row.SubTopic, ['readings']);
    });

    it('should parse nested subtopics correctly', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('subtopic');

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '2.0.0', 'level1', 'level2'], 'value');
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Scope, '@myscope');
      assert.strictEqual(row.CapabilityVersion, '2.0.0');
      assert.deepStrictEqual(row.SubTopic, ['level1', 'level2']);
    });

    it('should handle multiple updates to different subtopics', async () => {
      const dataCache = new DataCache({});
      const org = testOrg('multi');

      clickhouse.registerMqttTopicForStorage(dataCache, STANDARD_TOPIC_PATTERN);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'battery'], 85);
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'temperature'], 42);
      await once(emitter, 'insert');

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

      clickhouse.registerMqttTopicForStorage(dataCache, '/+/+/+/+/+/#');
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data'], { x: 1 });
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepStrictEqual(row.Payload, { x: 1 });
    });
  });


  describe('queryMQTTHistory', () => {

    const dataCache = new DataCache({});
    const org = testOrg('query');

    before(async () => {
      clickhouse.registerMqttTopicForStorage(dataCache, '#');
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data'], { x: 1 });
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data2'], { y: 2 });
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0',
        'data', 'sub2', 'sub3'],
        { isSub: 3, data: {string: 'some string'} });
      await once(emitter, 'insert');
    });

    it('queries with wild cards', async () => {
      const [row] = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/+` });
      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepEqual(row.SubTopic, ['data']);
      assert.deepStrictEqual(row.Payload, { x: 1 });
    });

    it('queries with multiple selectors', async () => {
      const [row] = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/cap/+/+` });
      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepEqual(row.SubTopic, ['data']);
      assert.deepStrictEqual(row.Payload, { x: 1 });
    });


    it('queries based on sub-topic selectors', async () => {
      const [row] = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/+/data2` });
      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepStrictEqual(row.Payload, { y: 2 });
    });

    it('queries based on sub-topic selectors with wildcards', async () => {
      const [row] = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/+/+/sub2/+` });
      assert.deepStrictEqual(row.SubTopic[2], 'sub3');
    });

    it('queries based on multiple sub-topic selectors with wildcards', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/+/data/+/+` });
      assert.deepStrictEqual(rows[0].SubTopic.length, 1);
      assert.deepStrictEqual(rows[1].SubTopic[2], 'sub3');
    });

  });

});

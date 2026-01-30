const assert = require('assert');
const { EventEmitter, once } = require('node:events');
const { describe, it, before, after, beforeEach } = require('node:test');
const dotenv = require('dotenv');
const { DataCache } = require('@transitive-sdk/datacache');
const { wait } = require('../../index');

const clickhouse = require('../index');

dotenv.config({path: '~transitive/.env'});
const CLICKHOUSE_URL = 'http://clickhouse.localhost';
const STANDARD_TOPIC_PATTERN = '/+org/+device/+scope/+cap/+version/#';

const TABLE_NAME = 'mqtt_history_tests';

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
  await clickhouse.queryMQTTHistory({
    topicSelector: `/${org}/+/+/+/+/+`,
    ...options
  });

/** Generate unique org ID for test isolation */
const testOrg = (suffix) => `clickhouse_test_${suffix}_${Date.now()}`;


describe('ClickHouse', function() {
  // this.timeout(10000);

  let emitter;
  const dataCache = new DataCache({});

  before(async () => {
    await clickhouse.init({ url: CLICKHOUSE_URL });
    /* Register for `insert` events on ClickHouse client */
    emitter = interceptInserts();

    for (let query of [
      `DROP TABLE IF EXISTS ${TABLE_NAME}`,
      `DROP ROW POLICY IF EXISTS row_policy ON ${TABLE_NAME}`
    ]) await clickhouse.client.command({
      query,
      clickhouse_settings: { wait_end_of_query: 1 }
    });

    await clickhouse.enableHistory({
      dataCache,
      tableName: TABLE_NAME
    });

    await clickhouse.registerMqttTopicForStorage(STANDARD_TOPIC_PATTERN);
  });

  describe('basics', () => {
    it('creates tables without crashing', async () => {
      const result = await clickhouse.createTable('test_tmp',
        ['text String']);

      // clean up
      await clickhouse.client.command({
        query: `DROP TABLE IF EXISTS test_tmp`,
        clickhouse_settings: { wait_end_of_query: 1 }
      })
    });
  });

  describe('enableHistory', () => {
    it('should create the mqtt_history table', async () => {
      const result = await clickhouse.client.query({
        query: `SELECT name FROM system.tables WHERE name = '${TABLE_NAME}'`,
        format: 'JSONEachRow'
      });
      const tables = await result.json();

      assert(tables.length > 0, 'mqtt_history table should exist');
    });
  });

  describe('registerMqttTopicForStorage', () => {
    it('should insert MQTT messages into ClickHouse', async () => {
      const org = testOrg('insert');

      dataCache.update([org, 'device1', '@myscope', 'test-cap', '1.0.0', 'data'], 42.5);
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });
      assert(!!row);
      assert.strictEqual(row.DeviceId, 'device1');
      assert.strictEqual(row.Scope, '@myscope');
      assert.strictEqual(row.CapabilityName, 'test-cap');
      assert.strictEqual(row.CapabilityVersion, '1.0.0');
      assert.deepStrictEqual(row.SubTopic, ['data']);
      assert.strictEqual(row.Payload, 42.5);
    });

    it('should store string payloads as-is', async () => {
      const org = testOrg('string');

      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'msg'], 'hello world');
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Payload, 'hello world');
    });

    it('should store null values as NULL (omitted)', async () => {
      const org = testOrg('null');

      // clickhouse.registerMqttTopicForStorage('/+org/+device/#');
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
      const org = testOrg('object');
      const payload = { sensor: 'temp', value: 25.5, nested: { a: 1 } };

      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'readings'], payload);
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.deepStrictEqual(row.Payload, payload);
      assert.deepStrictEqual(row.SubTopic, ['readings']);
    });

    it('should parse nested subtopics correctly', async () => {
      const org = testOrg('subtopic');

      dataCache.update([org, 'device1', '@myscope', 'cap', '2.0.0', 'level1', 'level2'], 'value');
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.Scope, '@myscope');
      assert.strictEqual(row.CapabilityVersion, '2.0.0');
      assert.deepStrictEqual(row.SubTopic, ['level1', 'level2']);
    });

    it('should handle multiple updates to different subtopics', async () => {
      const org = testOrg('multi');

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
      const org = testOrg('unnamed');

      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data'], { x: 1 });
      await once(emitter, 'insert');

      const [row] = await queryRowsByOrg(org, { limit: 1 });

      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepStrictEqual(row.Payload, { x: 1 });
    });


    it('should avoid duplicates', async () => {
      const org = testOrg('multi');

      // register multiple overlapping topics, want to see only one insertion
      await clickhouse.registerMqttTopicForStorage('/+org/+/+/+/+/#');
      await clickhouse.registerMqttTopicForStorage('/+/+device/+/+/+/#');
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data'], { x: 1 });
      await once(emitter, 'insert');
      const rows = await queryRowsByOrg(org);
      assert.equal(rows.length, 1);
    });

    it('updates TTL without crashing', async () => {
      await clickhouse.registerMqttTopicForStorage('/+/+/myscope/+/+/#', 13);
      await clickhouse.registerMqttTopicForStorage('/+/+/myscope/+/+/#', 15);
    });
  });


  describe('queryMQTTHistory', () => {

    const org = testOrg('query');

    before(async () => {
      // clear
      await clickhouse.client.command({
        query: `TRUNCATE TABLE ${TABLE_NAME}`,
        clickhouse_settings: { wait_end_of_query: 1 }
      });

      await clickhouse.registerMqttTopicForStorage('#');
      dataCache.update([org, 'device1', '@myscope', 'nullcap', '1.0.0', 'willBeNull'], 1234);
      dataCache.update([org, 'device1', '@myscope', 'capdata', '1.0.0', 'data'], { x: 1 });
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data2'], { y: 2 });
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0',
        'sub1', 'sub2', 'sub3.1'],
        { isSub: 3.1, data: {string: 'some string'} });
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0',
        'sub1', 'sub2', 'sub3.2'],
        { isSub: 3.3, data: {aNumber: 1234} });
      await once(emitter, 'insert');
      await wait(100);
      // another value, after a delay
      dataCache.update([org, 'device1', '@myscope', 'cap', '1.0.0', 'data'], { x: 2 });
      dataCache.update([org, 'device1', '@myscope', 'nullcap', '1.0.0', 'willBeNull'], null);

      await once(emitter, 'insert');
    });

    it('queries with wild cards', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/+` });
      assert(rows.length > 0);
    });

    it('queries with multiple selectors', async () => {
      const [row] = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/capdata/+/+` });
      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepEqual(row.SubTopic, ['data']);
      assert.deepStrictEqual(row.Payload, { x: 1 });
    });


    it('queries based on sub-topic selectors', async () => {
      const [row] = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/data2` });
      assert.strictEqual(row.DeviceId, 'device1');
      assert.deepStrictEqual(row.Payload, { y: 2 });
    });

    it('queries based on sub-topic selectors with wildcards', async () => {
      const [row] = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/+/sub2/+` });
      assert.deepStrictEqual(row.SubTopic[2], 'sub3.1');
    });

    it('queries based on multiple sub-topic selectors with wildcards', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/sub1/+/+` });
      assert.strictEqual(rows[0].SubTopic.length, 3);
      assert.strictEqual(rows[0].SubTopic[2], 'sub3.1');
      assert.strictEqual(rows[1].SubTopic[2], 'sub3.2');
    });

    it('returns the history', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/data/+/+` });
      assert.deepStrictEqual(rows.length, 2);
      assert.deepStrictEqual(rows[0].Payload, {x: 1});
      assert.deepStrictEqual(rows[1].Payload, {x: 2});
      assert(rows[0].Timestamp < rows[1].Timestamp);
    });

    it('handles null values', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/${org}/+/+/+/+/willBeNull` });
      assert.strictEqual(rows.at(-1).Payload, null);
    });
  });

  /** Test performance of the table (index). */
  describe('performance', {timeout: 10000}, () => {

    const ROWS = 1_000_000; // number of rows to insert (mock)
    // time gap between inserted values (to stretch over several partitions):
    const GAP = 1_000;
    const now = Date.now();

    before(async () => {
      // clear
      await clickhouse.client.exec({
        query: `TRUNCATE TABLE ${TABLE_NAME}`,
        clickhouse_settings: { wait_end_of_query: 1 }
      });

      const rows = [];
      for (let i = 0; i < ROWS; i++) {
       rows.push({
          Timestamp: new Date(now + i * GAP), // use current date to avoid immediate TTL cleanup
          TopicParts: [`org${i % 50}`, `device${i % 1000}`, '@myscope',
            `cap${i % 100}`, `1.${i % 100}.0`, `data_${i % 1000}`, i],
          Payload: { i },
       })
      }

      await clickhouse.client.insert({
        table: TABLE_NAME,
        values: [rows],
        format: 'JSONEachRow',
        clickhouse_settings: { wait_end_of_query: 1 }
      });

      console.log(`inserted ${rows.length} rows into ${TABLE_NAME}`);
    });

    let start;
    beforeEach(() => {
      start = performance.now();
    });

    /** Assert that no more than limit ms have passed since start of test case. */
    const assertTimelimit = (limit) => {
      assert(performance.now() - start < limit, `Less than ${limit} ms`);
    }

    it('returns the entire history in reasonable time', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/+/+/+/+/+/+`,
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, ROWS);
      assert(rows[0].Timestamp < rows[1].Timestamp);
      assertTimelimit(ROWS / 100);
    });

    it('quickly filters by OrgId', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/org42/+/+/+/+/+`,
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, ROWS / 50);
      assertTimelimit(ROWS / 1000);
    });

    it('quickly filters by DeviceId', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/+/device123/+/+/+/+`,
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, ROWS / 1000);
      assertTimelimit(ROWS / 1000);
    });

    it('quickly filters by CapabilityName', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/+/+/+/cap34/+/+`,
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, ROWS / 100);
      assertTimelimit(ROWS / 1000);
    });

    it('quickly filters by SubTopic', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/+/+/+/+/+/data_123`,
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, ROWS / 1000);
      assertTimelimit(ROWS / 1000);
    });

    it('quickly filters by time: since', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/+/+/+/+/+/+`,
        since: new Date(now + (ROWS - 400) * GAP),
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, 400);
      assertTimelimit(ROWS / 10000);
    });

    it('quickly filters by time: until', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/+/+/+/+/+/+`,
        until: new Date(now + 400 * GAP),
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, 401);
      assertTimelimit(ROWS / 10000);
    });

    it('quickly filters by org and time: since', async () => {
      const rows = await clickhouse.queryMQTTHistory({
        topicSelector: `/org23/+/+/+/+/+`,
        since: new Date(now + (ROWS - 400) * GAP),
        limit: 2 * ROWS,
      });
      assert.equal(rows.length, 8);
      assertTimelimit(ROWS / 10000);
    });
  });

});

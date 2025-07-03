const MongoClient = require('mongodb').MongoClient;

/** A tiny convenience (singleton) class for using MongoDB */
class Mongo {

  init(onConnect, {dbUrl, dbName} = {}) {
    const url = dbUrl || process.env.MONGO_URL || 'mongodb://localhost';
    const name = dbName || process.env.MONGO_DB || 'transitive';

    this.client = new MongoClient(url, {useUnifiedTopology: true});

    // Use connect method to connect to the server
    this.client.connect((err) => {
      if (!err) {
        this._db = this.client.db(name);
        console.log(`Connected successfully to mongodb server ${url}, db: ${name}`);
        onConnect?.(this);
      } else {
        console.error('Error connecting to mongodb', err);
      }
    });
  }

  close() {
    this.client.close();
  }

  get db() {
    if (this._db == undefined) {
      console.warn('Cannot access DB before init() is called');
    }
    return this._db;
  }
}

const instance = new Mongo;
module.exports = instance;

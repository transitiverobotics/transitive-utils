const Aedes = require('aedes');
const mqtt = require('mqtt');
const express = require('express');
const cors = require('cors');
const http = require('http');
const ws = require('websocket-stream');

const MqttSync = require('../../common/MqttSync');
const { loglevel, getLogger } = require('../..');

const log = getLogger('server');
log.setLevel('debug');
// loglevel.setAll('debug');

const port = 8888;
const mqttPort = port + 1;
const mqttURL = `mqtt://localhost:${mqttPort}`;


const Spinner = class {
  states = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  index = 0;

  tick() {
    this.index = (this.index + 1) % this.states.length;
    return this.states[this.index];
  }
};

/** fire up a small mqtt broker over websocket, using aedes, for testing */
const startServer = () => {
  log.debug('starting server');

  const app = express();
  const httpServer = http.createServer(app);

  // MQTT server
  const aedes = Aedes();
  ws.createServer({ server: httpServer }, aedes.handle);

  require('net').createServer(aedes.handle).listen(mqttPort, () =>
    log.debug('mqtt server started and listening on port ', port));

  aedes.authorizeSubscribe = (client, sub, callback) => {
    // prohibited to subscribe '/forbidden'
    log.debug('sub', sub);
    callback(null, sub.topic.startsWith('/forbidden') ? null : sub)
  };


  // App routes
  app.use(express.static('test/dist'));
  app.use(cors(), express.static('test/static'));

  app.get('/json1', (_, response) => {
    response.json({msg: 'json1'});
  });

  app.get('/unauthorized', (_, response) => {
    response.status(401).json({error: 'you are not authorized!'});
  });

  // Start listening
  httpServer.listen(port, function () {
    log.debug('websocket server listening on port ', port);
    // const client = mqtt.connect('ws://localhost:8888');

    const spinner = new Spinner();
    const ping = () => {
      process.stdout.write(`\r${spinner.tick()}`);
      aedes.publish({
        topic: '/test/ping',
        payload: JSON.stringify(new Date()),
        retain: true
      });
      // client.publish('/test/ping', JSON.stringify(new Date()), {retain: true});
    };

    setInterval(ping, 1000);
  });

  // start mqttSync
  const mqttClient = mqtt.connect(mqttURL);
  mqttClient.on('connect', () => {
    log.debug('connected');
    const client = new MqttSync({mqttClient: mqttClient, ignoreRetain: true});
    client.subscribe('/web');
    client.publish('/server');

    // pretend a mock capability is running:
    client.publish('/mockUser');
    client.data.update(
      '/mockUser/d_mock/@transitive-robotics/_robot-agent/0.0.1/status/runningPackages/@transitive-robotics/mock/1.0.0',
      '1.0.0');

    const update = () => {
      client.data.update('/server/time', String(new Date()));
      // publish some mock data for the mock capability
      client.data.update('/mockUser/d_mock/@transitive-robotics/mock/1.0.0/data',
        {some: 'object', with: {data: Date.now()}});
    };
    update();
    setInterval(() => update(), 3000);

    // publish a large amount of data for testing
    client.data.update('/server/large', Object.fromEntries(
      Array(1000).fill(1).map((ignore, i) => [`id${i}`, {i, randomData}])));

  });
  mqttClient.on('message', (topic, value) =>
    log.debug(topic, value == null ? null : value.toString().slice(0,80)));

  log.debug(`open http://localhost:${port}`);
};

module.exports = startServer;

const randomData = (i) => ({
  "status": "failed",
  "failure": true,
  "exitReason": "disconnected unexpectedly",
  "device": "d_f7fb2c8d5f",
  "version": "0.10.4",
  "session": "7pl9xs33xug",
  "start": 167881100 + i * 1000,
  "duration": 7316.255,
  "tracks": 3,
  "log": {
    "requested": 1678811008990,
    "connected": 1678811009861,
    "exit": 1678818303257,
    "iceDisconnected": 1678818326115,
    "cleanup": 1678818326119
  },
  "request": {
    "useDefault": true,
    "port": "12001",
    "bitrate": 300,
    "streams": [
      {
        "videoSource": {
          "type": "rtsp",
        },
        "complete": true
      },
      {
        "videoSource": {
          "type": "rtsp",
        },
        "complete": true
      },
      {
        "videoSource": {
          "type": "rtsp",
        },
        "complete": true
      }
    ]
  },
  "freezePercentage": 0.08869747341137417,
  "avgLatency": 0.12598762036290817,
  "bytes": 2209366311,
  "stats": {
    "tracks": {
      "webrtctransceiver6": {
        "track": {
          "id": "DEPRECATED_TI4",
          "timestamp": 1678818325219.341,
          "type": "track",
          "trackIdentifier": "webrtctransceiver6",
          "remoteSource": true,
          "ended": false,
          "detached": false,
          "kind": "video",
          "jitterBufferDelay": 7542.018,
          "jitterBufferEmittedCount": 109173,
          "frameWidth": 1920,
          "frameHeight": 1080,
          "framesReceived": 109174,
          "framesDecoded": 109174,
          "framesDropped": 0
        },
        "inbound-rtp": {
          "id": "ITvideo01V348632215",
          "timestamp": 1678818325219.341,
          "type": "inbound-rtp",
          "ssrc": 348632215,
          "kind": "video",
          "trackId": "DEPRECATED_TI4",
          "transportId": "Tvideo01",
          "codecId": "CITvideo01_104_level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
          "mediaType": "video",
          "jitter": 0.018,
          "packetsLost": 129,
          "trackIdentifier": "webrtctransceiver6",
          "mid": "video0",
          "packetsReceived": 1955581,
          "bytesReceived": 691164627,
          "headerBytesReceived": 23466972,
          "lastPacketReceivedTimestamp": 1678818289168,
          "jitterBufferDelay": 7542.018,
          "jitterBufferEmittedCount": 109173,
          "framesReceived": 109174,
          "frameWidth": 1920,
          "frameHeight": 1080,
          "framesDecoded": 109174,
          "keyFramesDecoded": 455,
          "framesDropped": 0,
          "totalDecodeTime": 341.940723,
          "totalProcessingDelay": 6462.228391,
          "totalAssemblyTime": 607.987765,
          "framesAssembledFromMultiplePackets": 109174,
          "totalInterFrameDelay": 7279.069000001808,
          "totalSquaredInterFrameDelay": 513.4523009997941,
          "pauseCount": 0,
          "totalPausesDuration": 0,
          "freezeCount": 17,
          "totalFreezesDuration": 8.742,
          "firCount": 0,
          "pliCount": 3,
          "nackCount": 3017,
          "qpSum": 1520366
        }
      },
      "webrtctransceiver7": {
        "track": {
          "id": "DEPRECATED_TI5",
          "timestamp": 1678818325219.341,
          "type": "track",
          "trackIdentifier": "webrtctransceiver7",
          "remoteSource": true,
          "ended": false,
          "detached": false,
          "kind": "video",
          "jitterBufferDelay": 7235.077,
          "jitterBufferEmittedCount": 109197,
          "frameWidth": 1920,
          "frameHeight": 1080,
          "framesReceived": 109201,
          "framesDecoded": 109196,
          "framesDropped": 2
        },
        "inbound-rtp": {
          "id": "ITvideo01V348632219",
          "timestamp": 1678818325219.341,
          "type": "inbound-rtp",
          "ssrc": 348632219,
          "kind": "video",
          "trackId": "DEPRECATED_TI5",
          "transportId": "Tvideo01",
          "codecId": "CITvideo01_107_level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
          "mediaType": "video",
          "jitter": 0.016,
          "packetsLost": 171,
          "trackIdentifier": "webrtctransceiver7",
          "mid": "video1",
          "packetsReceived": 1956350,
          "bytesReceived": 685188789,
          "headerBytesReceived": 23476200,
          "lastPacketReceivedTimestamp": 1678818289132,
          "jitterBufferDelay": 7235.077,
          "jitterBufferEmittedCount": 109197,
          "framesReceived": 109201,
          "frameWidth": 1920,
          "frameHeight": 1080,
          "framesDecoded": 109196,
          "keyFramesDecoded": 460,
          "framesDropped": 2,
          "totalDecodeTime": 345.643502,
          "totalProcessingDelay": 6173.511756999999,
          "totalAssemblyTime": 584.11479,
          "framesAssembledFromMultiplePackets": 109196,
          "totalInterFrameDelay": 7279.216000001792,
          "totalSquaredInterFrameDelay": 505.3165939997959,
          "pauseCount": 0,
          "totalPausesDuration": 0,
          "freezeCount": 14,
          "totalFreezesDuration": 6.159,
          "firCount": 0,
          "pliCount": 4,
          "nackCount": 2901,
          "qpSum": 2569981
        }
      },
      "webrtctransceiver8": {
        "track": {
          "id": "DEPRECATED_TI6",
          "timestamp": 1678818325219.341,
          "type": "track",
          "trackIdentifier": "webrtctransceiver8",
          "remoteSource": true,
          "ended": false,
          "detached": false,
          "kind": "video",
          "jitterBufferDelay": 7615.876,
          "jitterBufferEmittedCount": 109206,
          "frameWidth": 1920,
          "frameHeight": 1080,
          "framesReceived": 109207,
          "framesDecoded": 109207,
          "framesDropped": 0
        },
        "inbound-rtp": {
          "id": "ITvideo01V348632223",
          "timestamp": 1678818325219.341,
          "type": "inbound-rtp",
          "ssrc": 348632223,
          "kind": "video",
          "trackId": "DEPRECATED_TI6",
          "transportId": "Tvideo01",
          "codecId": "CITvideo01_110_level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
          "mediaType": "video",
          "jitter": 0.015,
          "packetsLost": 94,
          "trackIdentifier": "webrtctransceiver8",
          "mid": "video2",
          "packetsReceived": 1916293,
          "bytesReceived": 686403820,
          "headerBytesReceived": 22995516,
          "lastPacketReceivedTimestamp": 1678818289138,
          "jitterBufferDelay": 7615.876,
          "jitterBufferEmittedCount": 109206,
          "framesReceived": 109207,
          "frameWidth": 1920,
          "frameHeight": 1080,
          "framesDecoded": 109207,
          "keyFramesDecoded": 459,
          "framesDropped": 0,
          "totalDecodeTime": 366.824396,
          "totalProcessingDelay": 6693.347173,
          "totalAssemblyTime": 635.1105319999999,
          "framesAssembledFromMultiplePackets": 109207,
          "totalInterFrameDelay": 7279.170000001882,
          "totalSquaredInterFrameDelay": 502.6515799997662,
          "pauseCount": 0,
          "totalPausesDuration": 0,
          "freezeCount": 11,
          "totalFreezesDuration": 4.567,
          "firCount": 0,
          "pliCount": 3,
          "nackCount": 2750,
          "qpSum": 2023021
        }
      }
    },
    "certificate": {
      "id": "CF77:8F:5D:9D:33:74:01:85:E8:1C:D9:32:F1:B1:76:33:4E:E2:7D:57:6F:05:0B:A8:50:AE:0C:B6:CE:BF:BE:51",
      "timestamp": 1678818325219.341,
      "type": "certificate",
      "fingerprint": "77:8F:5D:9D:33:74:01:85:E8:1C:D9:32:F1:B1:76:33:4E:E2:7D:57:6F:05:0B:A8:50:AE:0C:B6:CE:BF:BE:51",
      "fingerprintAlgorithm": "sha-256",
      "base64Certificate": "MIIBFTCBvaADAgECAgkAmxZOQ+86734wCgYIKoZIzj0EAwIwETEPMA0GA1UEAwwGV2ViUlRDMB4XDTIzMDMxMzE2MjMyOVoXDTIzMDQxMzE2MjMyOVowETEPMA0GA1UEAwwGV2ViUlRDMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEEti1lC7Zb4TxYFcrqeROXXS2dRHqtBT2dfwEkoVVjA74reTE8ClsQaXMAzzjKg1kpnpZr6Ovt6RjEUPkwBjuxTAKBggqhkjOPQQDAgNHADBEAiBQSpjB/eCG3BzQjxOSQPWd/m/ccCC6GYNqb87XKx0pDwIgVQGAP1A3Q7pOTGKhv+GJ0147wuOeGfln2JJiNM8abew="
    },
    "codec": {
      "id": "CITvideo01_110_level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f",
      "timestamp": 1678818325219.341,
      "type": "codec",
      "transportId": "Tvideo01",
      "payloadType": 110,
      "mimeType": "video/H264",
      "clockRate": 90000,
      "sdpFmtpLine": "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f"
    },
    "candidate-pair": {
      "id": "CP4yBZAkmr_GQMk6AWa",
      "timestamp": 1678818325219.341,
      "type": "candidate-pair",
      "transportId": "Tvideo01",
      "localCandidateId": "I4yBZAkmr",
      "remoteCandidateId": "IGQMk6AWa",
      "state": "in-progress",
      "priority": 7205761601876540000,
      "nominated": true,
      "writable": true,
      "packetsSent": 59383,
      "packetsReceived": 5883050,
      "bytesSent": 5083042,
      "bytesReceived": 2209366311,
      "totalRoundTripTime": 158.477,
      "currentRoundTripTime": 0.056,
      "availableOutgoingBitrate": 300000,
      "requestsReceived": 1,
      "requestsSent": 2827,
      "responsesReceived": 2750,
      "responsesSent": 1,
      "consentRequestsSent": 2825,
      "packetsDiscardedOnSend": 0,
      "bytesDiscardedOnSend": 0,
      "lastPacketReceivedTimestamp": 1678818315794,
      "lastPacketSentTimestamp": 1678818324807
    },
    "data-channel": {
      "id": "D2",
      "timestamp": 1678818325219.341,
      "type": "data-channel",
      "label": "_control",
      "protocol": "",
      "dataChannelIdentifier": 1,
      "state": "open",
      "messagesSent": 1,
      "bytesSent": 6,
      "messagesReceived": 1,
      "bytesReceived": 34
    },
    "stream": {
      "id": "DEPRECATED_Smsid:user2080227467@host-5370b6b4",
      "timestamp": 1678818325219.341,
      "type": "stream",
      "streamIdentifier": "msid:user2080227467@host-5370b6b4",
      "trackIds": [
        "DEPRECATED_TI4",
        "DEPRECATED_TI5",
        "DEPRECATED_TI6"
      ]
    },
    "local-candidate": {
      "id": "Is4GWAp00",
      "timestamp": 1678818325219.341,
      "type": "local-candidate",
      "transportId": "Tvideo01",
      "isRemote": false,
      "networkType": "unknown",
      "ip": "54.184.68.133",
      "address": "54.184.68.133",
      "port": 34158,
      "protocol": "udp",
      "relayProtocol": "udp",
      "candidateType": "relay",
      "priority": 33562623,
      "url": "turn:transitiverobotics.com:3478?transport=udp",
      "foundation": "3331418901",
      "relatedAddress": "68.3.4.101",
      "relatedPort": 60080,
      "usernameFragment": "VSHx"
    },
    "remote-candidate": {
      "id": "IGQMk6AWa",
      "timestamp": 1678818325219.341,
      "type": "remote-candidate",
      "transportId": "Tvideo01",
      "isRemote": true,
      "ip": "24.4.128.136",
      "address": "24.4.128.136",
      "port": 48528,
      "protocol": "udp",
      "candidateType": "srflx",
      "priority": 1677722111,
      "foundation": "7",
      "relatedAddress": "192.168.1.222",
      "relatedPort": 48528,
      "usernameFragment": "ZsXPfv5K15tk7HfsSGt6d2/1l4csjofw"
    },
    "peer-connection": {
      "id": "P",
      "timestamp": 1678818325219.341,
      "type": "peer-connection",
      "dataChannelsOpened": 1,
      "dataChannelsClosed": 0
    },
    "transport": {
      "id": "Tvideo01",
      "timestamp": 1678818325219.341,
      "type": "transport",
      "bytesSent": 5083042,
      "packetsSent": 59383,
      "bytesReceived": 2209366311,
      "packetsReceived": 5883050,
      "dtlsState": "connected",
      "selectedCandidatePairId": "CP4yBZAkmr_GQMk6AWa",
      "localCertificateId": "CF77:8F:5D:9D:33:74:01:85:E8:1C:D9:32:F1:B1:76:33:4E:E2:7D:57:6F:05:0B:A8:50:AE:0C:B6:CE:BF:BE:51",
      "remoteCertificateId": "CF58:92:4C:51:32:F6:20:3D:79:A6:B0:15:82:E5:E4:29:D3:18:A7:5C:F5:BB:04:68:64:D8:76:99:36:35:40:2A",
      "tlsVersion": "FEFD",
      "dtlsCipher": "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
      "dtlsRole": "client",
      "srtpCipher": "AES_CM_128_HMAC_SHA1_80",
      "selectedCandidatePairChanges": 1,
      "iceRole": "controlled",
      "iceLocalUsernameFragment": "VSHx",
      "iceState": "connected"
    }
  }
});
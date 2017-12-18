const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const fs = require('fs');
const Log = require('log');
const _ = require('lodash');
const uuidv4 = require('uuid/v4');
const Ajv = require('ajv');

const log = new Log();
const app = express();

var server;

if (process.env.DUMMY_HTTPS) {
  log.debug('Initializing dummy HTTPS server');

  const httpsOptions = {
    key: fs.readFileSync('./keys/key.pem'),
    cert: fs.readFileSync('./keys/cert.pem')
  };

  server = https.createServer(httpsOptions, app);
} else {
  server = http.createServer(app);
}

const wsServer = new WebSocket.Server({
  server: server,
  clientTracking: true
});

app.use(express.static('public'));

/**
 * Sends a request to the Xirsys API to retrieve a set of ICE servers credentials.
 * @return {Promise}
 */
function requestXirsysIceServers() {
  return new Promise(function (resolve, reject) {
    const user = process.env.XIRSYS_USER;
    const passwd = process.env.XIRSYS_PASSWD;

    if (!user || !passwd) {
      resolve([]);
      return;
    }

    const authStr = new Buffer(user + ':' + passwd).toString('base64');

    const reqOptions = {
      host: 'global.xirsys.net',
      path: '/_turn/simple-webrtc-server',
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + authStr
      }
    };

    const httpreq = https.request(reqOptions, function (httpres) {
      var rawRes = '';

      httpres.on('data', function (data) {
        rawRes += data;
      });

      httpres.on('error', function (e) {
        reject(e);
      });

      httpres.on('end', function () {
        const parsedRes = JSON.parse(rawRes);

        if (parsedRes.s !== 'ok') {
          reject(new Error(parsedRes.v));
          return;
        }

        const iceServers = _.map(parsedRes.v.iceServers, function (iceServer) {
          return _.mapKeys(iceServer, function (value, key) {
            return key === 'url' ? 'urls' : key;
          });
        });

        resolve(iceServers);
      });
    });

    httpreq.end();
  });
}

/**
 * Endpoint to retrieve ICE servers configuration.
 */
app.get('/iceservers', function (req, res, next) {
  requestXirsysIceServers()
      .then(function (iceServers) {
        res.json(iceServers);
      })
      .catch(function (err) {
        next(err);
      });
});

/**
 * Express default error handler.
 */
app.use(function (err, req, res, next) {
  log.warning(err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500);
  res.json({ error: _.toString(err) });
});

const rooms = {};

const msgTypeCandidate = 'candidate';
const msgTypeSdp = 'sdp';
const msgTypeJoin = 'join';
const msgTypeJoinAck = 'join_ack';

/**
 * Parses and validates a WS JSON message.
 * @param rawMsg
 * @return {Object|undefined}
 */
function parseMessage(rawMsg) {
  var parsed;

  try {
    parsed = JSON.parse(rawMsg);
  } catch (err) {
    return;
  }

  const ajv = new Ajv();

  const validateMessage = ajv.compile({
    type: 'object',
    properties: {
      msgType: {
        type: 'string',
        enum: [
          msgTypeCandidate,
          msgTypeSdp,
          msgTypeJoin,
          msgTypeJoinAck
        ]
      },
      to: { type: 'string' },
      from: { type: 'string' },
      err: { type: 'string' },
      data: {}
    },
    required: ['msgType']
  });

  if (!validateMessage(parsed)) {
    return;
  }

  return parsed;
}

/**
 * Returns the WS client that matches the given ID.
 * @param id
 * @return {WebSocket}
 */
function getWSClient(id) {
  return _.find(Array.from(wsServer.clients), function (ws) {
    return ws.id === id;
  });
}

/**
 * Iterates over the room connections object removing
 * all WS clients that have been disconnected.
 */
function cleanRooms() {
  _.each(rooms, function (ids, name) {
    _.each(ids, function (id) {
      if (!getWSClient(id)) {
        log.debug('Cleaning WS client %s from room: %s', id, name);
        _.pull(rooms[name], id);
      }
    });
  });
}

/**
 * Joins the room with the given name and returns the ID of the
 * peer WS client that is already present if there is one.
 * @param name
 * @param id
 * @return {*}
 */
function joinRoom(name, id) {
  cleanRooms();

  name = _.toString(name);

  if (!name) {
    throw new Error('Invalid room name: ' + name);
  }

  rooms[name] = rooms[name] || [];

  if (rooms[name].length >= 2) {
    throw new Error('This room is full: ' + name);
  }

  const peerId = _.head(rooms[name]);
  rooms[name].push(id);

  return peerId;
}

wsServer.on('error', function (err) {
  log.error('Server error: %s', err);
});

wsServer.on('connection', function (ws, req) {
  ws.id = uuidv4();

  log.debug('Connection: %s', ws.id);

  ws.on('message', function (rawMsg) {
    const message = parseMessage(rawMsg);

    if (!message) {
      log.debug('Invalid message: %s', message);
      return;
    }

    const handleJoin = function () {
      try {
        log.debug('Client %s joing room: %s', ws.id, message.data);

        const peerId = joinRoom(message.data, ws.id);

        ws.send(JSON.stringify({
          msgType: msgTypeJoinAck,
          data: {
            peerId: peerId,
            room: message.data
          }
        }));
      } catch (err) {
        log.debug('Error joining room: %s', err);

        ws.send(JSON.stringify({
          msgType: msgTypeJoinAck,
          err: _.toString(err)
        }));
      }
    };

    const forwardMessage = function () {
      const wsTo = getWSClient(message.to);

      if (!wsTo) {
        log.warning('WS destination client not found: %s', message.to);
        return;
      }

      wsTo.send(JSON.stringify({
        from: ws.id,
        msgType: message.msgType,
        data: message.data
      }));
    };

    if (message.msgType === msgTypeJoin) {
      handleJoin();
    } else {
      forwardMessage();
    }
  });
});

server.listen(process.env.PORT || 80);

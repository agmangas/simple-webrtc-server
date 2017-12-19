const express = require('express');
const http = require('http');
const https = require('https');
const SocketIO = require('socket.io');
const fs = require('fs');
const Log = require('log');
const _ = require('lodash');
const validateJsonSchema = require('jsonschema').validate;
const xirsys = require('./xirsys');
const ioUtils = require('./ioutils');
const msgSchemas = require('./schemas');

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

const io = SocketIO(server);

const defaultPort = 80;
server.listen(process.env.PORT || defaultPort);

app.use(express.static('public'));

/**
 * Endpoint to retrieve ICE servers configuration.
 */
app.get('/iceservers', function (req, res, next) {
  const user = process.env.XIRSYS_USER;
  const passwd = process.env.XIRSYS_PASSWD;

  if (user && passwd) {
    xirsys.requestXirsysIceServers(user, passwd)
        .then(function (iceServers) {
          res.json(iceServers);
        })
        .catch(function (err) {
          next(err);
        });
  } else {
    res.json(null);
  }
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

io.on('connection', function (socket) {
  log.debug('Connection: %s', socket.id);

  /**
   * Handler for socket disconnections.
   */
  socket.on('disconnect', function () {
    log.debug('Disconnect: %s', socket.id);

    _.each(_.keys(socket.rooms), function (room) {
      io.to(room).emit('leave', socket.id);
    });
  });

  /**
   * Handler for messages to join a room.
   */
  socket.on('join', function (room, callback) {
    room = _.toString(room);

    if (!room) {
      log.info('Socket %s attempted to join room with undefined name', socket.id);
      callback && callback(new Error('Undefined room name'));
      return;
    }

    if (ioUtils.isRoomFull(io, room)) {
      log.info('Socket %s attempted to join full room %s', socket.id, room);
      callback && callback(new Error('The room is at full capacity'));
      return;
    }

    log.debug('Socket %s joined room %s', socket.id, room);

    const roomSockets = ioUtils.getRoomSocketIds(io, room);
    callback && callback(null, roomSockets);

    socket.join(room);
  });

  /**
   * Handler for messages to exchange ICE candidates.
   */
  socket.on('candidate', function (data) {
    _.assign(data, { from: socket.id });

    if (!validateJsonSchema(data, msgSchemas.schemaCandidate).valid) {
      log.warning('Invalid "candidate" message: %s', JSON.stringify(data));
      return;
    }

    const socketPeer = ioUtils.getPeerSocket(io, socket, data.to);

    if (!socketPeer) {
      log.warning('Peer not found: %s', data.to);
      return;
    }

    socketPeer.emit('candidate', data);
  });

  /**
   * Handler for messages to exchange SDP session descriptions.
   */
  socket.on('sdp', function (data) {
    _.assign(data, { from: socket.id });

    if (!validateJsonSchema(data, msgSchemas.schemaSdp).valid) {
      log.warning('Invalid "sdp" message: %s', JSON.stringify(data));
      return;
    }

    const socketPeer = ioUtils.getPeerSocket(io, socket, data.to);

    if (!socketPeer) {
      log.warning('Peer not found: %s', data.to);
      return;
    }

    socketPeer.emit('sdp', data);
  });
});

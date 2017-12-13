const express = require('express');
const http = require('http');
const https = require('https');
const SocketIO = require('socket.io');
const fs = require('fs');
const Log = require('log');
const _ = require('lodash');

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
 * Returns all sockets connected to the given room.
 * @param room
 * @return {Array}
 */
function getRoomSockets(room) {
  return _.filter(_.values(io.sockets.connected), function (socket) {
    return _.includes(socket.rooms, room);
  });
}

/**
 * Returns an array of socket IDs that are connected to the given room.
 * @param room
 * @return {Array}
 */
function getRoomSocketIds(room) {
  return _.map(getRoomSockets(room), function (socket) {
    return socket.id;
  });
}

/**
 * Returns true if the given room is full.
 * @param room
 * @return {boolean}
 */
function isRoomFull(room) {
  return getRoomSockets(room).length >= 2;
}

const ERR_ROOM_FULL = 'room_full';

io.on('connection', function (socket) {
  log.debug('Connection: %s', socket.id);

  socket.on('disconnect', function () {
    log.debug('Disconnect: %s', socket.id);

    _.each(_.keys(socket.rooms), function (room) {
      io.to(room).emit('leave', socket.id);
    });
  });

  socket.on('join', function (room, callback) {
    if (isRoomFull(room)) {
      log.info('Socket %s attempted to join full room %s', socket.id, room);
      callback && callback(ERR_ROOM_FULL);
      return;
    }

    log.debug('Socket %s joined room %s', socket.id, room);

    const roomSockets = getRoomSocketIds(room);
    callback && callback(null, roomSockets);

    socket.join(room);
  });

  socket.on('candidate', function (data) {
    _.assign(data, { from: socket.id });

    _.each(socket.rooms, function (room) {
      socket.broadcast.to(room).emit('candidate', data);
    });
  });

  socket.on('sdp', function (data) {
    _.assign(data, { from: socket.id });

    _.each(socket.rooms, function (room) {
      socket.broadcast.to(room).emit('sdp', data);
    });
  });
});
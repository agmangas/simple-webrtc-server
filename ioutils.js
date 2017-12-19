const _ = require('lodash');

/**
 * Returns all sockets connected to the given room.
 * @param io
 * @param room
 * @return {Array}
 */
function getRoomSockets(io, room) {
  return _.filter(_.values(io.sockets.connected), function (socket) {
    return _.includes(socket.rooms, room);
  });
}

/**
 * Returns an array of socket IDs that are connected to the given room.
 * @param io
 * @param room
 * @return {Array}
 */
function getRoomSocketIds(io, room) {
  return _.map(getRoomSockets(io, room), function (socket) {
    return socket.id;
  });
}

/**
 * Returns true if the given room is full.
 * @param io
 * @param room
 * @return {boolean}
 */
function isRoomFull(io, room) {
  return getRoomSockets(io, room).length >= 2;
}

/**
 * Returns the socket with ID idTo if that socket shares a room with socketFrom.
 * @param io
 * @param socketFrom
 * @param idTo
 */
function getPeerSocket(io, socketFrom, idTo) {
  const peerSockets = _.flatMap(socketFrom.rooms, function (fromRoom) {
    return getRoomSockets(io, fromRoom);
  });

  return _.find(peerSockets, function (socket) {
    return socket.id === idTo;
  });
}

exports.getRoomSockets = getRoomSockets;
exports.getRoomSocketIds = getRoomSocketIds;
exports.isRoomFull = isRoomFull;
exports.getPeerSocket = getPeerSocket;

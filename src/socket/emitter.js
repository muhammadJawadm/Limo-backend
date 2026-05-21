// socket/emitter.js
'use strict';

let _io = null;

// Called once from server.js after io is created
function setIo(io) {
  _io = io;
}

/**
 * Emit a notification to a specific user.
 * Falls back silently if the user is offline — that's fine,
 * the DB record is already saved and they'll see it on next load.
 *
 * @param {string} userId
 * @param {'message'|'booking'|'alert'|'info'} type
 * @param {string} title
 * @param {string} body
 * @param {object} [meta]  - any extra data (bookingId, rideId, etc.)
 */
function emitToUser(userId, type, title, body, meta = {}) {
  if (!_io) return;
  _io.to(`user_${userId}`).emit('notification', {
    type,
    title,
    body,
    meta,
    timestamp: Date.now(),
  });
}

function emitToRoom(room, event, data) {
  if (!_io) return;
  _io.to(room).emit(event, data);
}

function emitToAll(event, data) {
  if (!_io) return;
  _io.emit(event, data);
}

module.exports = { setIo, emitToUser, emitToRoom, emitToAll };
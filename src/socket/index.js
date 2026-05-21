// socket/index.js
'use strict';

const jwt    = require('jsonwebtoken');
const { prisma }     = require('../config/db');
const { JWT_SECRET } = require('../utils/jwt');
const { createNotificationRecord } = require('../utils/notificationHelpers');

// userId → Set of socketIds (one user can have multiple tabs)
const userSocketMap = new Map();

function getSocketIds(userId) {
  return userSocketMap.get(String(userId)) || new Set();
}

function initSocket(io) {
  // ── AUTH MIDDLEWARE ──────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query.token;

      if (!token) return next(new Error('No token provided'));

      const decoded  = jwt.verify(token, JWT_SECRET);
      socket.userId  = String(decoded.userId || decoded.id);

      const user = await prisma.user.findUnique({ where: { id: socket.userId } });
      if (!user) return next(new Error('User not found'));

      socket.userRole = user.role;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  // ── CONNECTION ───────────────────────────────────────────────
  io.on('connection', (socket) => {
    const { userId, userRole } = socket;
    console.log(`Socket connected: ${socket.id} | User: ${userId}`);

    // Track socket → user mapping
    if (!userSocketMap.has(userId)) userSocketMap.set(userId, new Set());
    userSocketMap.get(userId).add(socket.id);

    // Personal rooms
    socket.join(`driver_${userId}`);
    socket.join(`user_${userId}`);

    // ── EVENTS ──────────────────────────────────────────────────

    socket.on('join_ride', (data) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        socket.join(`ride_${parsed.rideId}`);
        console.log(`User ${userId} joined ride_${parsed.rideId}`);
      } catch (e) {
        console.error('join_ride error:', e.message);
      }
    });

    socket.on('join_admin', () => {
      if (userRole === 'admin') {
        socket.join('admin_panel');
        console.log(`Admin ${userId} joined admin_panel`);
      }
    });

    socket.on('send_message', async (data) => {
      try {
        const { rideId, text } = data;
        const booking = await prisma.booking.findUnique({
          where: { id: rideId },
          select: {
            id: true,
            userId: true,
            assignedDriverId: true,
            confNumber: true,
          },
        });

        if (!booking) {
          throw new Error('Ride not found');
        }

        const message = await prisma.message.create({
          data: {
            bookingId:  rideId,
            senderId:   userId,
            senderRole: userRole || 'customer',
            text,
          },
        });
        io.to(`ride_${rideId}`).emit('new_message', message);

        const recipientUserId = userRole === 'driver'
          ? booking.userId
          : booking.assignedDriverId;

        if (recipientUserId && recipientUserId !== userId) {
          await createNotificationRecord({
            recipientRole: userRole === 'driver' ? 'customer' : 'driver',
            recipientUserId,
            title: `New message on ride ${booking.confNumber || rideId}`,
            message: text,
            type: 'message',
            meta: {
              rideId,
              senderId: userId,
              senderRole: userRole,
            },
          });
        }
      } catch (err) {
        console.error('send_message error:', err.message);
      }
    });

    // Admin <-> Driver chat (persistent)
    socket.on('admin_send_message', async (data) => {
      try {
        const { driverUserId, text } = data;
        if (!driverUserId || !text) throw new Error('driverUserId and text are required');

        const adminMessage = await prisma.adminMessage.create({
          data: {
            driverUserId: String(driverUserId),
            senderId: socket.userId,
            senderRole: socket.userRole || 'driver',
            text,
          },
          include: { sender: { select: { id: true, firstName: true, lastName: true, role: true } } },
        });

        // Emit to the driver (if connected) and to admin panel
        io.to(`driver_${driverUserId}`).emit('admin_new_message', adminMessage);
        io.to('admin_panel').emit('admin_new_message', adminMessage);
      } catch (err) {
        console.error('admin_send_message error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
      const ids = userSocketMap.get(userId);
      if (ids) {
        ids.delete(socket.id);
        if (ids.size === 0) userSocketMap.delete(userId);
      }
    });
  });
}

module.exports = { initSocket, getSocketIds };
'use strict';

const { prisma } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError, requireAdminGuard } = require('../utils/apiResponse');
const { createNotificationRecord } = require('../utils/notificationHelpers');

// GET messages for a driver (admin)
exports.getMessagesForDriver = asyncHandler(async (req, res) => {
  if (!requireAdminGuard(req, res)) return;
  const { driverUserId } = req.params;
  const messages = await prisma.adminMessage.findMany({
    where: { driverUserId },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, firstName: true, lastName: true, role: true } } },
  });
  return sendSuccess(res, 200, { count: messages.length, data: messages });
});

// GET messages for current driver (driver)
exports.getMyMessages = asyncHandler(async (req, res) => {
  if (!req.user || req.user.role !== 'driver') return sendError(res, 403, 'Forbidden: driver access required');
  const driverUserId = req.user.id;
  const messages = await prisma.adminMessage.findMany({
    where: { driverUserId },
    orderBy: { createdAt: 'asc' },
    include: { sender: { select: { id: true, firstName: true, lastName: true, role: true } } },
  });
  return sendSuccess(res, 200, { count: messages.length, data: messages });
});

// Admin posts a message to a driver
exports.postMessageToDriver = asyncHandler(async (req, res) => {
  if (!requireAdminGuard(req, res)) return;
  const { driverUserId } = req.params;
  const { text } = req.body;
  if (!text) return sendError(res, 400, 'text is required');

  const adminMessage = await prisma.adminMessage.create({
    data: {
      driverUserId: String(driverUserId),
      senderId: req.user.id,
      senderRole: req.user.role,
      text,
    },
    include: { sender: { select: { id: true, firstName: true, lastName: true, role: true } } },
  });

  // Create notification for driver
  await createNotificationRecord({
    recipientRole: 'driver',
    recipientUserId: driverUserId,
    title: 'New message from admin',
    message: text,
    type: 'admin_message',
    meta: { senderId: req.user.id, senderRole: req.user.role },
  });

  return sendSuccess(res, 201, { data: adminMessage });
});

// Driver posts message to admin
exports.postMessageFromDriver = asyncHandler(async (req, res) => {
  if (!req.user || req.user.role !== 'driver') return sendError(res, 403, 'Forbidden: driver access required');
  const driverUserId = req.user.id;
  const { text } = req.body;
  if (!text) return sendError(res, 400, 'text is required');

  const adminMessage = await prisma.adminMessage.create({
    data: {
      driverUserId,
      senderId: req.user.id,
      senderRole: req.user.role,
      text,
    },
    include: { sender: { select: { id: true, firstName: true, lastName: true, role: true } } },
  });

  // Notify admin panel (no single recipient id)
  await createNotificationRecord({
    recipientRole: 'admin',
    title: 'Driver message',
    message: text,
    type: 'admin_message',
    meta: { driverUserId, senderId: req.user.id, senderRole: req.user.role },
  });

  return sendSuccess(res, 201, { data: adminMessage });
});
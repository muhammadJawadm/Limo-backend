const { prisma } = require('../config/db');
const {
    allowedNotificationRoles,
    buildNotificationScopeWhere,
    isAllowedNotificationRole,
} = require('../utils/notificationHelpers');

const notificationInclude = {
    recipient: {
        select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
        },
    },
};

const formatNotification = (notification) => {
    if (!notification) return null;

    return {
        ...notification,
        recipient: notification.recipient || null,
    };
};

const requireAdmin = (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ success: false, message: 'Forbidden: admin access required' });
        return false;
    }

    return true;
};

const validateNotificationPayload = async (payload) => {
    const recipientRole = payload.recipientRole;
    if (!isAllowedNotificationRole(recipientRole)) {
        return 'recipientRole must be driver or customer';
    }

    if (!payload.title || !payload.title.trim()) {
        return 'title is required';
    }

    if (!payload.message || !payload.message.trim()) {
        return 'message is required';
    }

    if (payload.recipientUserId) {
        const recipient = await prisma.user.findUnique({
            where: { id: payload.recipientUserId },
            select: { id: true, role: true },
        });

        if (!recipient) {
            return 'recipientUserId not found';
        }

        if (recipient.role !== recipientRole) {
            return 'recipientUserId does not match recipientRole';
        }
    }

    return null;
};

exports.getDriverNotifications = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'driver') {
            return res.status(403).json({ success: false, message: 'Forbidden: driver access required' });
        }

        const where = buildNotificationScopeWhere('driver', req.user.id);

        const notifications = await prisma.notification.findMany({
            where,
            include: notificationInclude,
            orderBy: { createdAt: 'desc' },
        });

        return res.status(200).json({
            success: true,
            role: 'driver',
            count: notifications.length,
            data: notifications.map(formatNotification),
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getCustomerNotifications = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'customer') {
            return res.status(403).json({ success: false, message: 'Forbidden: customer access required' });
        }

        const where = buildNotificationScopeWhere('customer', req.user.id);

        const notifications = await prisma.notification.findMany({
            where,
            include: notificationInclude,
            orderBy: { createdAt: 'desc' },
        });

        return res.status(200).json({
            success: true,
            role: 'customer',
            count: notifications.length,
            data: notifications.map(formatNotification),
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.createNotification = async (req, res) => {
    try {
        // if (!requireAdmin(req, res)) return;

        const payload = {
            recipientRole: req.body.recipientRole,
            recipientUserId: req.body.recipientUserId || null,
            title: req.body.title,
            message: req.body.message,
            type: req.body.type || 'general',
            isRead: req.body.isRead === true,
        };

        const validationError = await validateNotificationPayload(payload);
        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        const notification = await prisma.notification.create({
            data: payload,
            include: notificationInclude,
        });

        return res.status(201).json({ success: true, data: formatNotification(notification) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.updateNotification = async (req, res) => {
    try {
        if (!requireAdmin(req, res)) return;

        const { id } = req.params;
        const existing = await prisma.notification.findUnique({ where: { id } });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        const nextRecipientRole = req.body.recipientRole !== undefined ? req.body.recipientRole : existing.recipientRole;
        if (!isAllowedNotificationRole(nextRecipientRole)) {
            return res.status(400).json({ success: false, message: 'recipientRole must be driver or customer' });
        }

        const nextRecipientUserId = req.body.recipientUserId !== undefined ? req.body.recipientUserId : existing.recipientUserId;
        const nextTitle = req.body.title !== undefined ? req.body.title : existing.title;
        const nextMessage = req.body.message !== undefined ? req.body.message : existing.message;
        const nextType = req.body.type !== undefined ? req.body.type : existing.type;
        const nextIsRead = req.body.isRead !== undefined ? req.body.isRead : existing.isRead;

        const validationError = await validateNotificationPayload({
            recipientRole: nextRecipientRole,
            recipientUserId: nextRecipientUserId,
            title: nextTitle,
            message: nextMessage,
        });

        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        const notification = await prisma.notification.update({
            where: { id },
            data: {
                recipientRole: nextRecipientRole,
                recipientUserId: nextRecipientUserId,
                title: nextTitle,
                message: nextMessage,
                type: nextType,
                isRead: nextIsRead,
            },
            include: notificationInclude,
        });

        return res.status(200).json({ success: true, data: formatNotification(notification) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        // if (!requireAdmin(req, res)) return;

        const { id } = req.params;
        const existing = await prisma.notification.findUnique({ where: { id } });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        await prisma.notification.delete({ where: { id } });

        return res.status(200).json({ success: true, message: 'Notification deleted' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.allowedNotificationRoles = allowedNotificationRoles;
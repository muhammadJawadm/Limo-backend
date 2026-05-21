const { prisma } = require('../config/db');
const { emitToUser } = require('../socket/emitter');

const allowedNotificationRoles = ['driver', 'customer'];

const isAllowedNotificationRole = (role) => allowedNotificationRoles.includes(role);

const buildNotificationScopeWhere = (recipientRole, userId, extraWhere = {}) => ({
    AND: [
        extraWhere,
        {
            recipientRole,
            OR: [
                { recipientUserId: null },
                { recipientUserId: userId },
            ],
        },
    ],
});

const createNotificationRecord = async ({
    recipientRole,
    recipientUserId = null,
    title,
    message,
    type = 'general',
    isRead = false,
    meta = {},
}) => {
    if (!isAllowedNotificationRole(recipientRole)) {
        throw new Error('recipientRole must be driver or customer');
    }

    return prisma.notification.create({
        data: {
            recipientRole,
            recipientUserId,
            title,
            message,
            type,
            isRead,
        },
    }).then((notification) => {
        if (notification?.recipientUserId) {
            emitToUser(notification.recipientUserId, notification.type, notification.title, notification.message, {
                notificationId: notification.id,
                recipientRole: notification.recipientRole,
                ...meta,
            });
        }

        return notification;
    });
};

module.exports = {
    allowedNotificationRoles,
    isAllowedNotificationRole,
    buildNotificationScopeWhere,
    createNotificationRecord,
};
const { prisma } = require('../config/db');

const adminUserSelect = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    location: true,
    role: true,
    companyName: true,
    isVerified: true,
    onboardingCompleted: true,
    createdAt: true,
    updatedAt: true,
    customerProfile: {
        select: {
            id: true,
            preferredVehicleClass: true,
            specialRequirements: true,
            createdAt: true,
            updatedAt: true,
        },
    },
};

const adminDriverInclude = {
    user: {
        select: adminUserSelect,
    },
    requiredDocuments: true,
    vehicles: {
        orderBy: { createdAt: 'desc' },
    },
};

const adminBookingInclude = {
    user: {
        select: adminUserSelect,
    },
    assignedDriver: {
        select: adminUserSelect,
    },
    vehicleCategory: true,
    stopLocations: true,
    messages: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
            sender: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    phone: true,
                    role: true,
                },
            },
        },
    },
};

const adminNotificationInclude = {
    recipient: {
        select: adminUserSelect,
    },
};

exports.getAllUsers = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: adminUserSelect,
        });

        return res.status(200).json({
            success: true,
            count: users.length,
            data: users,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllDrivers = async (req, res) => {
    try {
        const drivers = await prisma.driver.findMany({
            orderBy: { createdAt: 'desc' },
            include: adminDriverInclude,
        });

        return res.status(200).json({
            success: true,
            count: drivers.length,
            data: drivers,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllVehicleCategories = async (req, res) => {
    try {
        const categories = await prisma.vehicleCategory.findMany({
            orderBy: { name: 'asc' },
        });

        return res.status(200).json({
            success: true,
            count: categories.length,
            data: categories,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllBookings = async (req, res) => {
    try {
        const bookings = await prisma.booking.findMany({
            orderBy: { createdAt: 'desc' },
            include: adminBookingInclude,
        });

        return res.status(200).json({
            success: true,
            count: bookings.length,
            data: bookings,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllNotifications = async (req, res) => {
    try {
        const notifications = await prisma.notification.findMany({
            orderBy: { createdAt: 'desc' },
            include: adminNotificationInclude,
        });

        return res.status(200).json({
            success: true,
            count: notifications.length,
            data: notifications,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

exports.getAllPayments = async (req, res) => {
    try {
        // Payments are stored on bookings (flattened payment fields)
        const payments = await prisma.booking.findMany({
            where: {
                // include any booking that has a payment intent or is not pending
                OR: [
                    { paymentIntentId: { not: null } },
                    { paymentStatus: { not: 'pending' } },
                ],
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                confNumber: true,
                userId: true,
                assignedDriverId: true,
                paymentStatus: true,
                paymentIntentId: true,
                totalAmount: true,
                platformFee: true,
                driverAmount: true,
                createdAt: true,
                updatedAt: true,
                vehicleCategory: true,
            },
        });

        return res.status(200).json({ success: true, count: payments.length, data: payments });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

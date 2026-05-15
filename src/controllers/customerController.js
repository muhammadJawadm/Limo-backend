const { prisma } = require('../config/db');
const { buildRideFilter } = require('../utils/rideFilters');
const { createNotificationRecord } = require('../utils/notificationHelpers');

// ─── GET MY PROFILE ───────────────────────────────────────────────────────────
exports.getMyProfile = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: {
                id: true, firstName: true, lastName: true, email: true,
                phone: true, location: true, role: true, companyName: true,
                isVerified: true, onboardingCompleted: true,
                createdAt: true, updatedAt: true,
                // password intentionally excluded
            },
        });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        return res.status(200).json({ success: true, data: user });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE MY PROFILE ──────────────────────────────────────────────────────
exports.updateMyProfile = async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            phone,
            location,
            companyName,
            preferredVehicleClass,
            specialRequirements,
        } = req.body;

        const userData = {};
        if (firstName !== undefined) userData.firstName = firstName;
        if (lastName !== undefined) userData.lastName = lastName;
        if (phone !== undefined) userData.phone = phone;
        if (location !== undefined) userData.location = location;
        if (companyName !== undefined) userData.companyName = companyName;

        const profileData = {};
        if (preferredVehicleClass !== undefined) profileData.preferredVehicleClass = preferredVehicleClass;
        if (specialRequirements !== undefined) profileData.specialRequirements = specialRequirements;

        const [user, profile] = await Promise.all([
            Object.keys(userData).length
                ? prisma.user.update({ where: { id: req.user.id }, data: userData })
                : prisma.user.findUnique({ where: { id: req.user.id } }),
            Object.keys(profileData).length
                ? prisma.customerProfile.upsert({
                    where: { userId: req.user.id },
                    update: profileData,
                    create: { userId: req.user.id, ...profileData },
                })
                : prisma.customerProfile.findUnique({ where: { userId: req.user.id } }),
        ]);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        return res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    location: user.location,
                    role: user.role,
                    companyName: user.companyName,
                    isVerified: user.isVerified,
                    onboardingCompleted: user.onboardingCompleted,
                    createdAt: user.createdAt,
                    updatedAt: user.updatedAt,
                },
                preferences: profile
                    ? {
                        preferredVehicleClass: profile.preferredVehicleClass,
                        specialRequirements: profile.specialRequirements,
                    }
                    : null,
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET MY RIDES (paginated, tabbed, searchable) ─────────────────────────────
exports.getMyRides = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
        const skip = (page - 1) * limit;

        const tab = req.query.tab || 'upcoming';

        // buildRideFilter returns a Prisma-compatible where clause
        // (make sure your utils/rideFilters.js returns Prisma syntax)
        const tabFilter = buildRideFilter(tab);

        // Base where: owned by user + tab filter
        let where = {
            userId: req.user.id,
            ...tabFilter,
        };

        // Optional search: confNumber, pickupLocation, dropoffLocation
        if (req.query.search && req.query.search.trim()) {
            const search = req.query.search.trim();
            where = {
                AND: [
                    { userId: req.user.id, ...tabFilter },
                    {
                        OR: [
                            { confNumber: { contains: search, mode: 'insensitive' } },
                            { pickupLocation: { contains: search, mode: 'insensitive' } },
                            { dropoffLocation: { contains: search, mode: 'insensitive' } },
                        ],
                    },
                ],
            };
        }

        const orderBy = tab === 'past'
            ? [{ date: 'desc' }, { createdAt: 'desc' }]
            : [{ date: 'asc' }, { createdAt: 'desc' }];

        const [rides, total] = await Promise.all([
            prisma.booking.findMany({
                where,
                include: {
                    vehicleCategory: true,
                    stopLocations: true,
                    assignedDriver: {
                        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
                    },
                },
                orderBy,
                skip,
                take: limit,
            }),
            prisma.booking.count({ where }),
        ]);

        return res.status(200).json({
            success: true,
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            tripCount: total,
            data: rides,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CANCEL MY RIDE ───────────────────────────────────────────────────────────
exports.cancelMyRide = async (req, res) => {
    try {
        const { id } = req.params;

        // Find ride owned by this user
        const ride = await prisma.booking.findFirst({
            where: { id, userId: req.user.id },
        });
        if (!ride) {
            return res.status(404).json({ success: false, message: 'Ride not found' });
        }

        if (ride.rideStatus === 'completed' || ride.rideStatus === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a ride that is already ${ride.rideStatus}`,
            });
        }

        const updatedRide = await prisma.booking.update({
            where: { id },
            data: { rideStatus: 'cancelled' },
            include: {
                vehicleCategory: true,
                stopLocations: true,
                assignedDriver: {
                    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
                },
            },
        });

        // Socket.io notifications
        const io = req.app.get('io');
        if (io) {
            io.to(`ride_${id}`).emit('ride_status_updated', {
                rideId: id,
                status: 'cancelled',
                ride: updatedRide,
            });
            if (ride.assignedDriverId) {
                io.to(`driver_${ride.assignedDriverId}`).emit('ride_cancelled_by_user', { rideId: id });
            }
            io.to('admin_panel').emit('ride_cancelled_by_user', { rideId: id, user: req.user.id });
        }

        const notifications = [
            createNotificationRecord({
                recipientRole: 'customer',
                recipientUserId: req.user.id,
                title: 'Ride cancelled',
                message: `Your ride ${ride.confNumber || id} was cancelled successfully.`,
                type: 'ride_cancelled',
            }),
        ];

        if (ride.assignedDriverId) {
            notifications.push(createNotificationRecord({
                recipientRole: 'driver',
                recipientUserId: ride.assignedDriverId,
                title: 'Ride cancelled by customer',
                message: `Ride ${ride.confNumber || id} was cancelled by the customer.`,
                type: 'ride_cancelled',
            }));
        }

        await Promise.all(notifications);

        return res.status(200).json({
            success: true,
            message: 'Ride cancelled successfully',
            data: updatedRide,
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

const { prisma } = require('../config/db');
const { buildRideFilter } = require('../utils/rideFilters');
const { transferDriverPayoutForBooking } = require('./paymentController');

const sanitizeBookingInput = (payload, options = {}) => {
    const data = { ...payload };

    if (data.type === 'ptop') {
        delete data.hours;
    }

    // Strip fields that should never be set by the user directly
    delete data.userId;
    if (!options.allowGuest) {
        delete data.isGuest;
    }
    delete data.paymentStatus;
    delete data.paymentIntentId;
    delete data.assignedDriverId;
    delete data.totalAmount;

    return data;
};

const generateConfNumber = () => {
    const timePart = Date.now().toString().slice(-6);
    const randomPart = Math.floor(100 + Math.random() * 900).toString();
    return `CNF-${timePart}${randomPart}`;
};

const normalizeStopLocations = (payload) => {
    const stopLocations = payload.stopLocations || payload.stopLocation || [];
    delete payload.stopLocations;
    delete payload.stopLocation;
    return Array.isArray(stopLocations) ? stopLocations : [stopLocations];
};

const ensureCanEditBooking = (req, booking) => {
    if (req.user) {
        const isOwner = booking.userId === req.user.id;
        const isAssignedDriver = booking.assignedDriverId === req.user.id;
        if (!isOwner && !isAssignedDriver && req.user.role !== 'admin') {
            return { allowed: false, status: 403, message: 'Forbidden: Not authorized to update this booking' };
        }
        return { allowed: true };
    }

    if (!booking.isGuest) {
        return { allowed: false, status: 401, message: 'Authorization required for this booking' };
    }

    return { allowed: true };
};

const validateStep1Payload = (raw) => {
    if (!raw.type) return 'type is required';
    if (!raw.pickupLocation) return 'pickupLocation is required';
    if (!raw.dropoffLocation) return 'dropoffLocation is required';
    if (!raw.date) return 'date is required';
    if (!raw.time) return 'time is required';

    if (raw.type === 'hourly' && (raw.hours === undefined || raw.hours === null)) {
        return 'hours is required for hourly bookings';
    }

    return null;
};

const assertStep1Complete = (booking) => {
    if (!booking.type || !booking.pickupLocation || !booking.dropoffLocation || !booking.date || !booking.time) {
        return 'Step 1 is incomplete';
    }
    if (booking.type === 'hourly' && (booking.hours === null || booking.hours === undefined)) {
        return 'Step 1 is incomplete: hours missing';
    }
    return null;
};

const assertStep2Complete = (booking) => {
    const step1Error = assertStep1Complete(booking);
    if (step1Error) return step1Error;
    if (!booking.vehicleCategoryId) return 'Step 2 is incomplete: vehicleCategoryId missing';
    return null;
};

const validatePassengerDetails = (raw) => {
    const details = raw.passengerDetails || {};
    const firstName = raw.passengerFirstName || details.firstName;
    const lastName = raw.passengerLastName || details.lastName;
    const email = raw.passengerEmail || details.email;
    const phone = raw.passengerPhone || details.phone;

    if (!firstName || !lastName || !email || !phone) {
        return 'passengerDetails.firstName, passengerDetails.lastName, passengerDetails.email, passengerDetails.phone are required';
    }

    return null;
};

const validateBookerDetails = (raw) => {
    const details = raw.bookerDetails || {};
    const firstName = raw.bookerFirstName || details.firstName;
    const lastName = raw.bookerLastName || details.lastName;
    const email = raw.bookerEmail || details.email;
    const phone = raw.bookerPhone || details.phone;

    if (!firstName || !lastName || !email || !phone) {
        return 'bookerDetails.firstName, bookerDetails.lastName, bookerDetails.email, bookerDetails.phone are required for guest booking';
    }

    return null;
};

const assertStep4Complete = (booking) => {
    if (!booking.passengerFirstName || !booking.passengerLastName || !booking.passengerEmail || !booking.passengerPhone) {
        return 'Step 4 is incomplete: passenger details missing';
    }

    if (booking.isGuest) {
        if (!booking.bookerFirstName || !booking.bookerLastName || !booking.bookerEmail || !booking.bookerPhone) {
            return 'Step 4 is incomplete: booker details missing';
        }
    }

    return null;
};

// Helper: build Prisma-friendly data object from request payload
// Maps nested Mongoose fields to flat Prisma columns
const buildBookingData = (payload) => {
    const data = {};

    const directFields = [
        'type', 'pickupLocation', 'dropoffLocation', 'date', 'time',
        'hours', 'vehicleCategoryId', 'assignedDriverId', 'confNumber',
        'rideStatus', 'totalAmount', 'flightNumber', 'noOfPassengers',
        'luggage', 'childSeatRequired', 'isGuest', 'userId',
        'specialInstructions', 'paymentStatus', 'paymentIntentId',
        'platformFee', 'driverAmount',
        // already-flat payment fields
        'cardHolderName', 'cardNumberLast4', 'expiryDate', 'billingAddress',
        // already-flat charge fields
        'tripPrice', 'childSeatsFee', 'otherFees',
        // already-flat child seat fields
        'childSeatInfant', 'childSeatToddler', 'childSeatBooster',
        // already-flat passenger/booker fields
        'passengerFirstName', 'passengerLastName', 'passengerEmail', 'passengerPhone',
        'bookerFirstName', 'bookerLastName', 'bookerEmail', 'bookerPhone',
    ];

    for (const field of directFields) {
        if (payload[field] !== undefined) data[field] = payload[field];
    }

    // Map nested Mongoose objects → flat Prisma columns
    if (payload.childSeats) {
        if (payload.childSeats.infant !== undefined) data.childSeatInfant = payload.childSeats.infant;
        if (payload.childSeats.toddler !== undefined) data.childSeatToddler = payload.childSeats.toddler;
        if (payload.childSeats.booster !== undefined) data.childSeatBooster = payload.childSeats.booster;
    }
    if (payload.passengerDetails) {
        if (payload.passengerDetails.firstName !== undefined) data.passengerFirstName = payload.passengerDetails.firstName;
        if (payload.passengerDetails.lastName !== undefined) data.passengerLastName = payload.passengerDetails.lastName;
        if (payload.passengerDetails.email !== undefined) data.passengerEmail = payload.passengerDetails.email;
        if (payload.passengerDetails.phone !== undefined) data.passengerPhone = payload.passengerDetails.phone;
    }
    if (payload.bookerDetails) {
        if (payload.bookerDetails.firstName !== undefined) data.bookerFirstName = payload.bookerDetails.firstName;
        if (payload.bookerDetails.lastName !== undefined) data.bookerLastName = payload.bookerDetails.lastName;
        if (payload.bookerDetails.email !== undefined) data.bookerEmail = payload.bookerDetails.email;
        if (payload.bookerDetails.phone !== undefined) data.bookerPhone = payload.bookerDetails.phone;
    }
    if (payload.chargesAndFees) {
        if (payload.chargesAndFees.tripPrice !== undefined) data.tripPrice = payload.chargesAndFees.tripPrice;
        if (payload.chargesAndFees.childSeatsFee !== undefined) data.childSeatsFee = payload.chargesAndFees.childSeatsFee;
        if (payload.chargesAndFees.otherFees !== undefined) data.otherFees = payload.chargesAndFees.otherFees;
    }
    if (payload.paymentInfo) {
        if (payload.paymentInfo.cardHolderName !== undefined) data.cardHolderName = payload.paymentInfo.cardHolderName;
        if (payload.paymentInfo.cardNumberLast4 !== undefined) data.cardNumberLast4 = payload.paymentInfo.cardNumberLast4;
        if (payload.paymentInfo.expiryDate !== undefined) data.expiryDate = payload.paymentInfo.expiryDate;
        if (payload.paymentInfo.billingAddress !== undefined) data.billingAddress = payload.paymentInfo.billingAddress;
    }

    return data;
};

// Helper: format a booking with nested structure for API response
// (restores the nested shape the frontend expects)
const formatBooking = (booking) => {
    if (!booking) return null;
    return {
        ...booking,
        childSeats: {
            infant: booking.childSeatInfant,
            toddler: booking.childSeatToddler,
            booster: booking.childSeatBooster,
        },
        passengerDetails: {
            firstName: booking.passengerFirstName,
            lastName: booking.passengerLastName,
            email: booking.passengerEmail,
            phone: booking.passengerPhone,
        },
        bookerDetails: {
            firstName: booking.bookerFirstName,
            lastName: booking.bookerLastName,
            email: booking.bookerEmail,
            phone: booking.bookerPhone,
        },
        chargesAndFees: {
            tripPrice: booking.tripPrice,
            childSeatsFee: booking.childSeatsFee,
            otherFees: booking.otherFees,
        },
        paymentInfo: {
            cardHolderName: booking.cardHolderName,
            cardNumberLast4: booking.cardNumberLast4,
            expiryDate: booking.expiryDate,
            billingAddress: booking.billingAddress,
        },
        // Expose stopLocations as a clean array of strings
        stopLocations: booking.stopLocations?.map((s) => s.location) || [],
    };
};

const bookingInclude = {
    vehicleCategory: true,
    stopLocations: true,
    assignedDriver: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    },
    user: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    },
};

// ─── STEP 1: CREATE BOOKING (guest or logged-in) ────────────────────────────
exports.createBookingStep1 = async (req, res) => {
    try {
        const raw = sanitizeBookingInput(req.body, { allowGuest: true });
        const stopLocations = normalizeStopLocations(raw);

        const step1Error = validateStep1Payload(raw);
        if (step1Error) {
            return res.status(400).json({ success: false, message: step1Error });
        }

        if (!req.user && !raw.isGuest) {
            return res.status(400).json({ success: false, message: 'isGuest must be true for unauthenticated step 1' });
        }

        const data = buildBookingData(raw);
        data.userId = req.user ? req.user.id : undefined;
        data.isGuest = req.user ? false : true;
        data.rideStatus = data.rideStatus || 'upcoming';
        data.confNumber = data.confNumber || generateConfNumber();

        const booking = await prisma.booking.create({
            data: {
                ...data,
                stopLocations: {
                    create: stopLocations.map((loc) => ({ location: loc })),
                },
            },
            include: bookingInclude,
        });

        return res.status(201).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── STEP 2: ADD VEHICLE CATEGORY ───────────────────────────────────────────
exports.updateBookingStep2 = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.booking.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const auth = ensureCanEditBooking(req, existing);
        if (!auth.allowed) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const step1Error = assertStep1Complete(existing);
        if (step1Error) {
            return res.status(400).json({ success: false, message: step1Error });
        }

        const raw = sanitizeBookingInput(req.body);
        const vehicleCategoryId = raw.vehicleCategory || raw.vehicleCategoryId;
        delete raw.vehicleCategory;

        if (!vehicleCategoryId) {
            return res.status(400).json({ success: false, message: 'vehicleCategoryId is required' });
        }

        if (raw.noOfPassengers === undefined || raw.noOfPassengers === null) {
            return res.status(400).json({ success: false, message: 'noOfPassengers is required' });
        }

        if (raw.luggage === undefined || raw.luggage === null) {
            return res.status(400).json({ success: false, message: 'luggage is required' });
        }

        const category = await prisma.vehicleCategory.findUnique({ where: { id: vehicleCategoryId } });
        if (!category) {
            return res.status(404).json({ success: false, message: 'Vehicle category not found' });
        }

        const data = buildBookingData(raw);
        data.vehicleCategoryId = vehicleCategoryId;
        data.totalAmount = typeof raw.totalAmount === 'number' ? raw.totalAmount : category.baseFare;

        const booking = await prisma.booking.update({
            where: { id },
            data,
            include: bookingInclude,
        });

        return res.status(200).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── STEP 3: ADD CHILD SEATS ────────────────────────────────────────────────
exports.updateBookingStep3 = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.booking.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const auth = ensureCanEditBooking(req, existing);
        if (!auth.allowed) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const step2Error = assertStep2Complete(existing);
        if (step2Error) {
            return res.status(400).json({ success: false, message: step2Error });
        }

        const raw = sanitizeBookingInput(req.body);
        const childSeats = raw.childSeats || {};

        const hasChildSeatsData = raw.childSeatRequired !== undefined
            || raw.childSeatInfant !== undefined
            || raw.childSeatToddler !== undefined
            || raw.childSeatBooster !== undefined
            || childSeats.infant !== undefined
            || childSeats.toddler !== undefined
            || childSeats.booster !== undefined;

        if (!hasChildSeatsData) {
            return res.status(400).json({ success: false, message: 'childSeats info is required' });
        }

        const data = buildBookingData(raw);

        const booking = await prisma.booking.update({
            where: { id },
            data,
            include: bookingInclude,
        });

        return res.status(200).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── STEP 4: ADD PASSENGER/BOOKER DETAILS ───────────────────────────────────
exports.updateBookingStep4 = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.booking.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const auth = ensureCanEditBooking(req, existing);
        if (!auth.allowed) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const step2Error = assertStep2Complete(existing);
        if (step2Error) {
            return res.status(400).json({ success: false, message: step2Error });
        }

        const raw = sanitizeBookingInput(req.body);

        const passengerError = validatePassengerDetails(raw);
        if (passengerError) {
            return res.status(400).json({ success: false, message: passengerError });
        }

        if (existing.isGuest) {
            const bookerError = validateBookerDetails(raw);
            if (bookerError) {
                return res.status(400).json({ success: false, message: bookerError });
            }
        }

        const data = buildBookingData(raw);

        const booking = await prisma.booking.update({
            where: { id },
            data,
            include: bookingInclude,
        });

        return res.status(200).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── STEP 5: ADD PAYMENT INFO + COMPLETE ────────────────────────────────────
exports.updateBookingStep5 = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.booking.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const auth = ensureCanEditBooking(req, existing);
        if (!auth.allowed) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const step2Error = assertStep2Complete(existing);
        if (step2Error) {
            return res.status(400).json({ success: false, message: step2Error });
        }

        const step4Error = assertStep4Complete(existing);
        if (step4Error) {
            return res.status(400).json({ success: false, message: step4Error });
        }

        const raw = sanitizeBookingInput(req.body);
        const paymentInfo = raw.paymentInfo || {};

        const cardHolderName = raw.cardHolderName || paymentInfo.cardHolderName;
        const cardNumberLast4 = raw.cardNumberLast4 || paymentInfo.cardNumberLast4;
        const expiryDate = raw.expiryDate || paymentInfo.expiryDate;
        const billingAddress = raw.billingAddress || paymentInfo.billingAddress;

        if (!cardHolderName || !cardNumberLast4 || !expiryDate || !billingAddress) {
            return res.status(400).json({
                success: false,
                message: 'paymentInfo.cardHolderName, paymentInfo.cardNumberLast4, paymentInfo.expiryDate, paymentInfo.billingAddress are required',
            });
        }

        const data = buildBookingData(raw);
        data.isComplete = true;

        const booking = await prisma.booking.update({
            where: { id },
            data,
            include: bookingInclude,
        });

        return res.status(200).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CREATE BOOKING (logged-in user) ─────────────────────────────────────────
exports.createBooking = async (req, res) => {
    try {
        const raw = sanitizeBookingInput(req.body);
        const stopLocations = raw.stopLocations || raw.stopLocation || [];
        delete raw.stopLocations;
        delete raw.stopLocation;

        const vehicleCategoryId = raw.vehicleCategory || raw.vehicleCategoryId;
        delete raw.vehicleCategory;

        if (!vehicleCategoryId) {
            return res.status(400).json({ success: false, message: 'vehicleCategory is required' });
        }

        const category = await prisma.vehicleCategory.findUnique({ where: { id: vehicleCategoryId } });
        if (!category) {
            return res.status(404).json({ success: false, message: 'Vehicle category not found' });
        }

        const data = buildBookingData(raw);
        data.userId = req.user.id;
        data.isGuest = false;
        data.vehicleCategoryId = vehicleCategoryId;
        data.totalAmount = typeof raw.totalAmount === 'number' ? raw.totalAmount : category.baseFare;
        data.rideStatus = data.rideStatus || 'upcoming';
        data.confNumber = data.confNumber || generateConfNumber();

        const booking = await prisma.booking.create({
            data: {
                ...data,
                stopLocations: {
                    create: stopLocations.map((loc) => ({ location: loc })),
                },
            },
            include: bookingInclude,
        });

        return res.status(201).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CREATE GUEST BOOKING ────────────────────────────────────────────────────
exports.createGuestBooking = async (req, res) => {
    try {
        const raw = sanitizeBookingInput(req.body);
        const stopLocations = raw.stopLocations || raw.stopLocation || [];
        delete raw.stopLocations;
        delete raw.stopLocation;

        const vehicleCategoryId = raw.vehicleCategory || raw.vehicleCategoryId;
        delete raw.vehicleCategory;

        if (!vehicleCategoryId) {
            return res.status(400).json({ success: false, message: 'vehicleCategory is required' });
        }

        // Validate booker details for guest
        const bookerEmail = raw.bookerEmail || raw.bookerDetails?.email;
        const bookerPhone = raw.bookerPhone || raw.bookerDetails?.phone;
        if (!bookerEmail || !bookerPhone) {
            return res.status(400).json({ success: false, message: 'bookerDetails.email and bookerDetails.phone are required for guest booking' });
        }

        const category = await prisma.vehicleCategory.findUnique({ where: { id: vehicleCategoryId } });
        if (!category) {
            return res.status(404).json({ success: false, message: 'Vehicle category not found' });
        }

        const data = buildBookingData(raw);
        data.isGuest = true;
        data.userId = undefined;
        data.vehicleCategoryId = vehicleCategoryId;
        data.totalAmount = typeof raw.totalAmount === 'number' ? raw.totalAmount : category.baseFare;
        data.rideStatus = data.rideStatus || 'upcoming';
        data.confNumber = data.confNumber || generateConfNumber();

        const booking = await prisma.booking.create({
            data: {
                ...data,
                stopLocations: {
                    create: stopLocations.map((loc) => ({ location: loc })),
                },
            },
            include: bookingInclude,
        });

        return res.status(201).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET MY BOOKINGS ──────────────────────────────────────────────────────────
exports.getMyBookings = async (req, res) => {
    try {
        const tab = req.query.tab || 'upcoming';
        const where = { userId: req.user.id, ...buildRideFilter(tab) };

        const bookings = await prisma.booking.findMany({
            where,
            include: bookingInclude,
            orderBy: { createdAt: 'desc' },
        });

        return res.status(200).json({
            success: true,
            tab,
            count: bookings.length,
            data: bookings.map(formatBooking),
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET BOOKING BY ID ────────────────────────────────────────────────────────
exports.getBookingById = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await prisma.booking.findUnique({
            where: { id },
            include: bookingInclude,
        });
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const isOwner = booking.userId === req.user.id;
        const isAssignedDriver = booking.assignedDriverId === req.user.id;
        if (!isOwner && !isAssignedDriver && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden: Not authorized to view this booking' });
        }

        return res.status(200).json({ success: true, data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE BOOKING ───────────────────────────────────────────────────────────
exports.updateBooking = async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await prisma.booking.findUnique({ where: { id } });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const isOwner = existing.userId === req.user.id;
        const isAssignedDriver = existing.assignedDriverId === req.user.id;
        if (!isOwner && !isAssignedDriver && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden: Not authorized to update this booking' });
        }

        const raw = sanitizeBookingInput(req.body);
        const stopLocations = raw.stopLocations || raw.stopLocation;
        delete raw.stopLocations;
        delete raw.stopLocation;

        if (raw.vehicleCategory) {
            raw.vehicleCategoryId = raw.vehicleCategory;
            delete raw.vehicleCategory;
        }

        const data = buildBookingData(raw);

        // If stop locations are being updated, replace them
        const updatePayload = {
            data: {
                ...data,
                ...(stopLocations !== undefined && {
                    stopLocations: {
                        deleteMany: {},
                        create: stopLocations.map((loc) => ({ location: loc })),
                    },
                }),
            },
            where: { id },
            include: bookingInclude,
        };

        const booking = await prisma.booking.update(updatePayload);

        return res.status(200).json({ success: true, message: 'Booking updated', data: formatBooking(booking) });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── ASSIGN DRIVER (admin only) ─────────────────────────────────────────────
exports.assignDriverToBooking = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden: Only admin can assign drivers' });
        }

        const { id } = req.params;
        const { driverId } = req.body;

        if (!driverId) {
            return res.status(400).json({ success: false, message: 'driverId is required' });
        }

        const booking = await prisma.booking.findUnique({ where: { id } });
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const driver = await prisma.driver.findUnique({ where: { id: driverId } });
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        const updated = await prisma.booking.update({
            where: { id },
            data: { assignedDriverId: driver.userId },
            include: bookingInclude,
        });

        let payout = { transferred: false, reason: 'booking_not_paid' };
        if (updated.paymentStatus === 'paid') {
            payout = await transferDriverPayoutForBooking(updated.id);
        }

        return res.status(200).json({ success: true, data: formatBooking(updated), payout });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DELETE BOOKING ───────────────────────────────────────────────────────────
exports.deleteBooking = async (req, res) => {
    try {
        const { id } = req.params;

        const booking = await prisma.booking.findUnique({ where: { id } });
        if (!booking) {
            return res.status(404).json({ success: false, message: 'Booking not found' });
        }

        const isOwner = booking.userId === req.user.id;
        const isAssignedDriver = booking.assignedDriverId === req.user.id;
        if (!isOwner && !isAssignedDriver && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Forbidden: Not authorized to delete this booking' });
        }

        await prisma.booking.delete({ where: { id } });

        return res.status(200).json({ success: true, message: 'Booking deleted' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

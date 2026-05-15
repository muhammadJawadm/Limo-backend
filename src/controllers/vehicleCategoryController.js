const { prisma } = require('../config/db');
const { uploadToCloudinary } = require('../utils/cloudinaryUpload');

const ensureAdminRole = (req, res) => {
    if (!req.user || req.user.role !== 'admin') {
        res.status(403).json({ success: false, message: 'Forbidden: Only admins can modify vehicle categories' });
        return false;
    }
    return true;
};

const validateCapacityFields = (capacity, bodyLuggage, bodyPassengers) => {
    const luggageCapacity = capacity?.luggage ?? bodyLuggage;
    const passengerCapacity = capacity?.passengers ?? bodyPassengers;

    if (!Number.isInteger(luggageCapacity) || luggageCapacity < 0) {
        return { valid: false, message: 'luggageCapacity must be a non-negative integer' };
    }

    if (!Number.isInteger(passengerCapacity) || passengerCapacity < 0) {
        return { valid: false, message: 'passengerCapacity must be a non-negative integer' };
    }

    return { valid: true, luggageCapacity, passengerCapacity };
};

// ─── CREATE ───────────────────────────────────────────────────────────────────
exports.createVehicleCategory = async (req, res) => {
    try {
        if (!ensureAdminRole(req, res)) return;

        const { name, type, classification, capacity, baseFare, perMileRate, picture } = req.body;

        // Validate required fields
        if (!name || !type || !classification) {
            return res.status(400).json({ success: false, message: 'name, type, and classification are required' });
        }

        // Validate and extract capacity fields
        const capacityValidation = validateCapacityFields(capacity, req.body.luggageCapacity, req.body.passengerCapacity);
        if (!capacityValidation.valid) {
            return res.status(400).json({ success: false, message: capacityValidation.message });
        }

        if (baseFare === undefined || baseFare === null) {
            return res.status(400).json({ success: false, message: 'baseFare is required' });
        }

        if (perMileRate === undefined || perMileRate === null) {
            return res.status(400).json({ success: false, message: 'perMileRate is required' });
        }

        let pictureUrl = picture;
        if (req.file) {
            const uploadResult = await uploadToCloudinary(req.file.buffer, 'vehicle_categories');
            pictureUrl = uploadResult.secure_url;
        }

        if (!pictureUrl) {
            return res.status(400).json({ success: false, message: 'picture is required (either as file upload or URL string)' });
        }

        const category = await prisma.vehicleCategory.create({
            data: {
                name,
                type,
                classification,
                luggageCapacity: capacityValidation.luggageCapacity,
                passengerCapacity: capacityValidation.passengerCapacity,
                baseFare: parseFloat(baseFare),
                perMileRate: parseFloat(perMileRate),
                picture: pictureUrl,
            },
        });

        return res.status(201).json({ success: true, data: category });
    } catch (error) {
        console.error('Create vehicle category error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET ALL (with optional filters) ─────────────────────────────────────────
exports.getVehicleCategories = async (req, res) => {
    try {
        const { classification, type, name } = req.query;

        const where = {};
        if (classification) where.classification = classification;
        if (type) where.type = { equals: type, mode: 'insensitive' };
        if (name) where.name = { contains: name, mode: 'insensitive' };

        const categories = await prisma.vehicleCategory.findMany({
            where,
            orderBy: { name: 'asc' },
        });

        return res.status(200).json({ success: true, count: categories.length, data: categories });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── GET BY ID ────────────────────────────────────────────────────────────────
exports.getVehicleCategoryById = async (req, res) => {
    try {
        const { id } = req.params;

        const category = await prisma.vehicleCategory.findUnique({ where: { id } });
        if (!category) {
            return res.status(404).json({ success: false, message: 'Vehicle category not found' });
        }

        return res.status(200).json({ success: true, data: category });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────
exports.updateVehicleCategory = async (req, res) => {
    try {
        // if (!ensureAdminRole(req, res)) return;

        const { id } = req.params;
        const { name, type, classification, capacity, baseFare, perMileRate, picture } = req.body;

        const data = {};
        if (name !== undefined) data.name = name;
        if (type !== undefined) data.type = type;
        if (classification !== undefined) data.classification = classification;
        if (baseFare !== undefined) data.baseFare = parseFloat(baseFare);
        if (perMileRate !== undefined) data.perMileRate = parseFloat(perMileRate);

        // Handle capacity fields with validation
        if (capacity || req.body.luggageCapacity !== undefined || req.body.passengerCapacity !== undefined) {
            const capacityValidation = validateCapacityFields(capacity, req.body.luggageCapacity, req.body.passengerCapacity);
            if (!capacityValidation.valid) {
                return res.status(400).json({ success: false, message: capacityValidation.message });
            }
            data.luggageCapacity = capacityValidation.luggageCapacity;
            data.passengerCapacity = capacityValidation.passengerCapacity;
        }

        if (req.file) {
            const uploadResult = await uploadToCloudinary(req.file.buffer, 'vehicle_categories');
            data.picture = uploadResult.secure_url;
        } else if (picture !== undefined) {
            data.picture = picture;
        }

        const category = await prisma.vehicleCategory.update({
            where: { id },
            data,
        });

        return res.status(200).json({ success: true, message: 'Vehicle category updated', data: category });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Vehicle category not found' });
        }
        console.error('Update vehicle category error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────
exports.deleteVehicleCategory = async (req, res) => {
    try {
        if (!ensureAdminRole(req, res)) return;

        const { id } = req.params;

        await prisma.vehicleCategory.delete({ where: { id } });

        return res.status(200).json({ success: true, message: 'Vehicle category deleted' });
    } catch (error) {
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Vehicle category not found' });
        }
        return res.status(500).json({ success: false, message: error.message });
    }
};

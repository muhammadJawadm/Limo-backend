// ============================================================
// chatController.js
// ============================================================
const { prisma } = require('../config/db');

exports.getRideMessages = async (req, res) => {
    try {
        const { rideId } = req.params;

        const messages = await prisma.message.findMany({
            where: { bookingId: rideId },
            orderBy: { createdAt: 'asc' },
            take: 100,
        });

        return res.status(200).json({ success: true, data: messages });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

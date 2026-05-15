const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");

const protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "No token provided. Authorization denied." });
        }

        const token = authHeader.split(" ")[1];
        const secret = process.env.JWT_SECRET || "change-me-in-env";
        const decoded = jwt.verify(token, secret);
        const userId = decoded.userId || decoded.id;

        // Prisma: fetch only the fields we need — never expose password
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, isVerified: true },
        });

        if (!user) {
            return res.status(401).json({ success: false, message: "User not found. Token is invalid." });
        }

        req.user = {
            id: user.id,           // plain UUID string — no .toString() needed
            role: user.role,
            isVerified: user.isVerified,
        };

        return next();
    } catch (error) {
        return res.status(401).json({ success: false, message: "Token is invalid or expired." });
    }
};

const protectOptional = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return next();
        }

        const token = authHeader.split(" ")[1];
        const secret = process.env.JWT_SECRET || "change-me-in-env";
        const decoded = jwt.verify(token, secret);
        const userId = decoded.userId || decoded.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, isVerified: true },
        });

        if (!user) {
            return res.status(401).json({ success: false, message: "User not found. Token is invalid." });
        }

        req.user = {
            id: user.id,
            role: user.role,
            isVerified: user.isVerified,
        };

        return next();
    } catch (error) {
        return res.status(401).json({ success: false, message: "Token is invalid or expired." });
    }
};

const requireAdmin = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Forbidden: admin access required' });
    }

    return next();
};

module.exports = { protect, protectOptional, requireAdmin };

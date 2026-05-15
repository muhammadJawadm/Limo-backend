const { prisma } = require('../config/db');
const bcrypt = require('bcrypt');
const generateToken = require('../utils/jwt');
const otpGenerator = require('otp-generator');
const sendEmail = require('../utils/sendEmail');

// Helper: generate 6-digit numeric OTP
const generateOtp = () =>
    otpGenerator.generate(6, {
        digits: true,
        lowerCaseAlphabets: false,
        upperCaseAlphabets: false,
        specialChars: false,
    });

// ─── REGISTER ────────────────────────────────────────────────────────────────
exports.register = async (req, res) => {
    let { firstName, lastName, email, phone, password, role, location } = req.body;
    try {
        if (!email || !phone || !password || !location || !firstName || !lastName) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
        }
        if(role && !['customer', 'driver'].includes(role)) {
            return res.status(400).json({ success: false, message: 'your role must be customer or driver' });
        }
        email = email.toLowerCase();

        // Check existing email or phone
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        const existingPhone = await prisma.user.findUnique({ where: { phone } });
        if (existingPhone) {
            return res.status(400).json({ success: false, message: 'Phone number already exists' });
        }

        // Hash password manually (no pre-save hook in Prisma)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await prisma.user.create({
            data: { firstName, lastName, email, phone, password: hashedPassword, role, location },
        });

        const otp = generateOtp();
        const otpExpiry = new Date(Date.now() + 300000); // 5 minutes

        await prisma.otp.create({ data: { userId: newUser.id, otp, otpExpiry } });
        await sendEmail(email, otp);

        const token = generateToken(newUser.id);
        const destination = newUser.role === 'driver'
            ? '/driver/partner-onboarding'
            : '/customer/dashboard';

        return res.status(201).json({
            success: true,
            message: 'User registered successfully. Please check your email for the OTP.',
            token,
            destination,
            user: {
                id: newUser.id,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                email: newUser.email,
                phone: newUser.phone,
                location: newUser.location,
                role: newUser.role,
                isVerified: newUser.isVerified,
                onboardingCompleted: newUser.onboardingCompleted,
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── VERIFY OTP ──────────────────────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
    let { email, otp } = req.body;
    try {
        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        email = email.toLowerCase();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // findFirst since a user may have one OTP at a time
        const otpEntry = await prisma.otp.findFirst({ where: { userId: user.id } });
        if (!otpEntry) {
            return res.status(400).json({ success: false, message: 'OTP not found or already expired' });
        }

        // Check expiry BEFORE value
        if (otpEntry.otpExpiry < new Date()) {
            await prisma.otp.deleteMany({ where: { userId: user.id } });
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }
        if (otpEntry.otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        await prisma.user.update({ where: { id: user.id }, data: { isVerified: true } });
        await prisma.otp.deleteMany({ where: { userId: user.id } });

        const destination = user.role === 'driver'
            ? (user.onboardingCompleted ? '/driver/dashboard' : '/driver/partner-onboarding')
            : '/customer/dashboard';

        return res.status(200).json({
            success: true,
            message: 'Email verified successfully',
            destination,
            user: {
                id: user.id,
                role: user.role,
                onboardingCompleted: user.onboardingCompleted,
                isVerified: true,
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── RESEND OTP ───────────────────────────────────────────────────────────────
exports.resendOtp = async (req, res) => {
    let { email } = req.body;
    try {
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        email = email.toLowerCase();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (user.isVerified) {
            return res.status(400).json({ success: false, message: 'User is already verified' });
        }

        await prisma.otp.deleteMany({ where: { userId: user.id } });

        const otp = generateOtp();
        const otpExpiry = new Date(Date.now() + 300000);

        await prisma.otp.create({ data: { userId: user.id, otp, otpExpiry } });
        await sendEmail(email, otp);

        return res.status(200).json({ success: true, message: 'OTP resent successfully' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
    let { email } = req.body;
    try {
        if (!email) {
            return res.status(400).json({ success: false, message: 'Email is required' });
        }

        email = email.toLowerCase();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        await prisma.otp.deleteMany({ where: { userId: user.id } });

        const otp = generateOtp();
        const otpExpiry = new Date(Date.now() + 300000);

        await prisma.otp.create({ data: { userId: user.id, otp, otpExpiry } });
        await sendEmail(email, otp);

        return res.status(200).json({ success: true, message: 'Password reset OTP sent to your email' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── VERIFY RESET OTP ────────────────────────────────────────────────────────
exports.verifyResetOtp = async (req, res) => {
    let { email, otp } = req.body;
    try {
        if (!email || !otp) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        email = email.toLowerCase();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const otpEntry = await prisma.otp.findFirst({ where: { userId: user.id } });
        if (!otpEntry) {
            return res.status(400).json({ success: false, message: 'OTP not found or already expired' });
        }

        if (otpEntry.otpExpiry < new Date()) {
            await prisma.otp.deleteMany({ where: { userId: user.id } });
            return res.status(400).json({ success: false, message: 'OTP has expired' });
        }
        if (otpEntry.otp !== otp) {
            return res.status(400).json({ success: false, message: 'Invalid OTP' });
        }

        // Mark OTP as reset-verified
        await prisma.otp.update({ where: { id: otpEntry.id }, data: { isResetVerified: true } });

        return res.status(200).json({ success: true, message: 'OTP verified. You may now reset your password.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── RESET PASSWORD ───────────────────────────────────────────────────────────
exports.resetPassword = async (req, res) => {
    let { email, password, confirmPassword } = req.body;
    try {
        if (!email || !password || !confirmPassword) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Passwords do not match' });
        }

        email = email.toLowerCase();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const otpEntry = await prisma.otp.findFirst({ where: { userId: user.id } });
        if (!otpEntry) {
            return res.status(400).json({ success: false, message: 'Please verify OTP first before resetting password' });
        }
        if (!otpEntry.isResetVerified) {
            return res.status(403).json({ success: false, message: 'OTP not verified. Please complete OTP verification first' });
        }
        if (otpEntry.otpExpiry < new Date()) {
            await prisma.otp.deleteMany({ where: { userId: user.id } });
            return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
        }

        // Hash new password manually
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } });
        await prisma.otp.deleteMany({ where: { userId: user.id } });

        return res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── LOGIN ────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
    let { email, password } = req.body;
    try {
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        email = email.toLowerCase();

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        if (!user.isVerified) {
            return res.status(403).json({ success: false, message: 'Please verify your email before logging in' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Invalid password' });
        }

        const token = generateToken(user.id);
        const destination = user.role === 'driver'
            ? (user.onboardingCompleted ? '/driver/dashboard' : '/driver/partner-onboarding')
            : '/customer/dashboard';

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            destination,
            user: {
                id: user.id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.phone,
                location: user.location,
                role: user.role,
                isVerified: user.isVerified,
                onboardingCompleted: user.onboardingCompleted,
            },
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

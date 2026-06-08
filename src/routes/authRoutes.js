const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');

const router = express.Router();

// 20 requests per 15 minutes per IP for general auth actions
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many requests from this IP, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// 5 requests per 15 minutes per IP for OTP and password reset actions
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many OTP requests from this IP, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post('/register',         authLimiter, authController.register);
router.post('/verify-otp',       otpLimiter,  authController.verifyOtp);
router.post('/resend-otp',       otpLimiter,  authController.resendOtp);
router.post('/forgot-password',  otpLimiter,  authController.forgotPassword);
router.post('/verify-reset-otp', otpLimiter,  authController.verifyResetOtp);
router.post('/reset-password',   otpLimiter,  authController.resetPassword);
router.post('/login',            authLimiter, authController.login);

module.exports = router;

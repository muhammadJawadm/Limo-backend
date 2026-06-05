'use strict';

const nodemailer = require('nodemailer');
const { prisma } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { validateSupportRequest } = require('../utils/validators');

// ─── QUERY SHAPES ─────────────────────────────────────────────────────────────

const supportRequestSelect = {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    description: true,
    isRead: true,
    createdAt: true,
    updatedAt: true,
};

// ─── MAIL HELPERS ─────────────────────────────────────────────────────────────

const getMailTransporter = () => {
    if (!process.env.MAIL_HOST || !process.env.MAIL_USER || !process.env.MAIL_PASS) {
        throw new Error('SMTP configuration is missing');
    }

    return nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: Number(process.env.MAIL_PORT || 587),
        secure: Number(process.env.MAIL_PORT) === 465,
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
        },
    });
};

const escapeHtml = (value = '') => {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

const sendSupportRequestEmail = async (supportRequest) => {
    const transporter = getMailTransporter();

    const fullName = `${supportRequest.firstName} ${supportRequest.lastName}`.trim();

    await transporter.sendMail({
        from: process.env.MAIL_USER || `"Prvyn Support" <${process.env.MAIL_USER}>`,
        to: 'fhashmani@prvyn.com', // Change to your support email
        replyTo: supportRequest.email,
        subject: `New Support Request from ${fullName}`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111;">
                <h2 style="margin-bottom: 16px;">New Support Request</h2>

                <p><strong>Name:</strong> ${escapeHtml(fullName)}</p>
                <p><strong>Email:</strong> ${escapeHtml(supportRequest.email)}</p>
                <p><strong>Phone:</strong> ${escapeHtml(supportRequest.phone)}</p>

                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

                <p><strong>Description:</strong></p>
                <p style="white-space: pre-line;">${escapeHtml(supportRequest.description)}</p>

                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />

                <p style="font-size: 12px; color: #666;">
                    Support Request ID: ${escapeHtml(supportRequest.id)}
                </p>
            </div>
        `,
    });
};

// ─── HANDLERS ─────────────────────────────────────────────────────────────────

exports.createSupportRequest = asyncHandler(async (req, res) => {
    const payload = {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        phone: req.body.phone,
        description: req.body.description,
    };

    const validationError = validateSupportRequest(payload);
    if (validationError) {
        return sendError(res, 400, validationError);
    }

    const supportRequest = await prisma.supportRequest.create({
        data: {
            firstName: payload.firstName.trim(),
            lastName: payload.lastName.trim(),
            email: payload.email.trim().toLowerCase(),
            phone: payload.phone.trim(),
            description: payload.description.trim(),
        },
        select: supportRequestSelect,
    });

    try {
        await sendSupportRequestEmail(supportRequest);
    } catch (error) {
        console.error('Support request email failed:', error.message);

        return sendSuccess(res, 201, {
            data: supportRequest,
            warning: 'Support request saved, but email notification failed.',
        });
    }

    return sendSuccess(res, 201, {
        data: supportRequest,
        message: 'Support request submitted successfully.',
    });
});

exports.getSupportRequestById = asyncHandler(async (req, res) => {
    const supportRequest = await prisma.supportRequest.findUnique({
        where: { id: req.params.id },
        select: supportRequestSelect,
    });

    if (!supportRequest) {
        return sendError(res, 404, 'Support request not found');
    }

    return sendSuccess(res, 200, { data: supportRequest });
});

exports.getAllSupportRequests = asyncHandler(async (req, res) => {
    const supportRequests = await prisma.supportRequest.findMany({
        orderBy: { createdAt: 'desc' },
        select: supportRequestSelect,
    });

    return sendSuccess(res, 200, {
        count: supportRequests.length,
        data: supportRequests,
    });
});

exports.markSupportRequestAsRead = asyncHandler(async (req, res) => {
    const existing = await prisma.supportRequest.findUnique({
        where: { id: req.params.id },
        select: { id: true },
    });

    if (!existing) {
        return sendError(res, 404, 'Support request not found');
    }

    const supportRequest = await prisma.supportRequest.update({
        where: { id: req.params.id },
        data: { isRead: true },
        select: supportRequestSelect,
    });

    return sendSuccess(res, 200, { data: supportRequest });
});
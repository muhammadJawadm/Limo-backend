const { prisma } = require('../config/db');
const returnUrl = `${process.env.FRONTEND_URL}/driver/onboarding?step=9`
const refreshUrl = `${process.env.FRONTEND_URL}/driver/onboarding?step=9`

const getStripe = () => {
    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    return require('stripe')(process.env.STRIPE_SECRET_KEY);
};

const platformFeePercent = () => parseFloat(process.env.STRIPE_PLATFORM_FEE_PERCENT) || 20;

const calculateSplitAmounts = (totalAmount) => {
    const feePercent = platformFeePercent();
    const platformFee = (totalAmount * feePercent) / 100;
    const driverAmount = totalAmount - platformFee;
    return { platformFee, driverAmount, feePercent };
};

const transferDriverPayoutForBooking = async (bookingId) => {
    const stripe = getStripe();

    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) {
        return { transferred: false, reason: 'booking_not_found' };
    }

    if (booking.paymentStatus !== 'paid') {
        return { transferred: false, reason: 'booking_not_paid' };
    }

    if (!booking.assignedDriverId) {
        return { transferred: false, reason: 'driver_not_assigned' };
    }

    if (!booking.paymentIntentId) {
        return { transferred: false, reason: 'missing_payment_intent' };
    }

    const driver = await prisma.driver.findUnique({ where: { userId: booking.assignedDriverId } });
    if (!driver || !driver.stripeAccountId || !driver.stripeOnboarded) {
        return { transferred: false, reason: 'driver_not_ready' };
    }

    const totalAmount = booking.totalAmount || 0;
    if (totalAmount <= 0) {
        return { transferred: false, reason: 'invalid_total_amount' };
    }

    const { platformFee, driverAmount } = calculateSplitAmounts(totalAmount);
    if (driverAmount <= 0) {
        return { transferred: false, reason: 'invalid_driver_amount' };
    }

    const transferGroup = `booking_${booking.id}`;
    const existingTransfers = await stripe.transfers.list({ transfer_group: transferGroup, limit: 10 });
    if (existingTransfers.data.length > 0) {
        return { transferred: false, reason: 'already_transferred', transferId: existingTransfers.data[0].id };
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
    const chargeId = typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id;

    if (!chargeId) {
        return { transferred: false, reason: 'missing_charge_for_transfer' };
    }

    const transfer = await stripe.transfers.create(
        {
            amount: Math.round(driverAmount * 100),
            currency: 'usd',
            destination: driver.stripeAccountId,
            source_transaction: chargeId,
            transfer_group: transferGroup,
            metadata: {
                bookingId: booking.id,
                driverUserId: booking.assignedDriverId,
            },
        },
        {
            idempotencyKey: `booking_${booking.id}_driver_payout`,
        },
    );

    await prisma.booking.update({
        where: { id: booking.id },
        data: {
            platformFee,
            driverAmount,
        },
    });

    return { transferred: true, transferId: transfer.id };
};
// ─── DRIVER CONNECT (Stripe Express onboarding) ───────────────────────────────
const driverConnect = async (req, res) => {
    try {
        const stripe = getStripe();

        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
        if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

        let accountId = driver.stripeAccountId;
        if (!accountId) {
            const account = await stripe.accounts.create({ type: 'express' });
            accountId = account.id;
            await prisma.driver.update({
                where: { id: driver.id },
                data: { stripeAccountId: accountId },
            });
        }

        const accountLink = await stripe.accountLinks.create({
            account: accountId,
            refresh_url: refreshUrl,
            return_url: returnUrl,
            type: 'account_onboarding',
        });

        return res.json({ success: true, url: accountLink.url });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── DRIVER CONNECT STATUS ────────────────────────────────────────────────────
const driverConnectStatus = async (req, res) => {
    try {
        const stripe = getStripe();

        const driver = await prisma.driver.findUnique({ where: { userId: req.user.id } });
        if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

        if (!driver.stripeAccountId) {
            return res.json({ success: true, onboarded: false });
        }

        const account = await stripe.accounts.retrieve(driver.stripeAccountId);
        const isOnboarded = account.details_submitted;

        if (driver.stripeOnboarded !== isOnboarded) {
            await prisma.driver.update({
                where: { id: driver.id },
                data: { stripeOnboarded: isOnboarded },
            });
        }

        return res.json({ success: true, onboarded: isOnboarded });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CREATE PAYMENT INTENT ────────────────────────────────────────────────────
const createPaymentIntent = async (req, res) => {
    try {
        const stripe = getStripe();
        const { bookingId } = req.body;

        const booking = await prisma.booking.findUnique({
            where: { id: bookingId },
            include: {
                assignedDriver: true, // User model
            },
        });
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        const totalAmount = booking.totalAmount || 0;
        if (totalAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Booking total amount must be greater than zero' });
        }

        const { platformFee, driverAmount } = calculateSplitAmounts(totalAmount);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(totalAmount * 100),
            currency: 'usd',
            metadata: { bookingId: booking.id },
        });

        await prisma.booking.update({
            where: { id: bookingId },
            data: {
                platformFee,
                driverAmount,
                paymentIntentId: paymentIntent.id,
            },
        });

        return res.json({ success: true, clientSecret: paymentIntent.client_secret });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── CONFIRM PAYMENT ──────────────────────────────────────────────────────────
const confirmPayment = async (req, res) => {
    try {
        const stripe = getStripe();
        const { bookingId, paymentIntentId } = req.body;

        const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (paymentIntent.status === 'succeeded') {
            const updated = await prisma.booking.update({
                where: { id: bookingId },
                data: { paymentStatus: 'paid', paymentIntentId },
            });

            let payout = { transferred: false, reason: 'driver_not_assigned' };
            if (updated.assignedDriverId) {
                payout = await transferDriverPayoutForBooking(updated.id);
            }

            return res.json({
                success: true,
                message: 'Payment confirmed successfully',
                status: updated.paymentStatus,
                payout,
            });
        } else {
            return res.status(400).json({ success: false, message: 'Payment not successful', status: paymentIntent.status });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─── STRIPE WEBHOOK ───────────────────────────────────────────────────────────
const webhook = async (req, res) => {
    const stripe = getStripe();
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('Webhook Error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'payment_intent.succeeded': {
                const pi = event.data.object;
                if (pi.metadata?.bookingId) {
                    const booking = await prisma.booking.update({
                        where: { id: pi.metadata.bookingId },
                        data: { paymentStatus: 'paid' },
                    });

                    if (booking.assignedDriverId) {
                        await transferDriverPayoutForBooking(booking.id);
                    }
                }
                break;
            }
            case 'payment_intent.payment_failed': {
                const pi = event.data.object;
                if (pi.metadata?.bookingId) {
                    await prisma.booking.update({
                        where: { id: pi.metadata.bookingId },
                        data: { paymentStatus: 'failed' },
                    });
                }
                break;
            }
            case 'account.updated': {
                const account = event.data.object;
                // findFirst because stripeAccountId is not @unique in schema
                await prisma.driver.updateMany({
                    where: { stripeAccountId: account.id },
                    data: { stripeOnboarded: account.details_submitted },
                });
                break;
            }
            default:
                console.log(`Unhandled event type ${event.type}`);
        }
        return res.json({ received: true });
    } catch (error) {
        console.error('Webhook handler error:', error);
        return res.status(500).send('Internal Server Error');
    }
};

// ─── REFUND PAYMENT ───────────────────────────────────────────────────────────
const refundPayment = async (req, res) => {
    try {
        const stripe = getStripe();
        const { bookingId } = req.body;

        const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        const isOwner = booking.userId === req.user.id;
        if (!isOwner && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to refund this booking' });
        }
        if (!booking.paymentIntentId) {
            return res.status(400).json({ success: false, message: 'No payment associated with this booking' });
        }
        if (booking.paymentStatus === 'refunded') {
            return res.status(400).json({ success: false, message: 'This booking has already been refunded' });
        }

        const refund = await stripe.refunds.create({ payment_intent: booking.paymentIntentId });

        await prisma.booking.update({
            where: { id: bookingId },
            data: { paymentStatus: 'refunded' },
        });

        return res.json({ success: true, message: 'Payment refunded successfully', refund });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    driverConnect,
    driverConnectStatus,
    createPaymentIntent,
    confirmPayment,
    webhook,
    refundPayment,
    transferDriverPayoutForBooking,
};

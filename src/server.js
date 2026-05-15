const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { prisma } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const driverRoutes = require('./routes/driverRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const vehicleCategoryRoutes = require('./routes/vehicleCategoryRoutes');
const chatRoutes = require('./routes/chatRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const customerRoutes = require('./routes/customerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { webhook } = require('./controllers/paymentController');

const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();

const port = process.env.PORT || 5000;

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
    },
});

app.set('io', io);

// ─────────────────────────────────────────────────────────────
// SOCKET.IO JWT AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────────────

io.use(async (socket, next) => {
    try {
        const token =
            socket.handshake.auth?.token ||
            socket.handshake.query.token;

        if (!token) {
            return next(
                new Error('Authentication error: No token provided')
            );
        }

        const secret =
            process.env.JWT_SECRET || 'change-me-in-env';

        const decoded = jwt.verify(token, secret);

        socket.userId = decoded.userId || decoded.id;

        // PRISMA VERSION
        const user = await prisma.user.findUnique({
            where: {
                id: socket.userId,
            },
        });

        if (!user) {
            return next(
                new Error('Authentication error: User not found')
            );
        }

        socket.userRole = user.role;

        next();
    } catch (err) {
        next(
            new Error('Authentication error: Invalid token')
        );
    }
});

// ─────────────────────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
    console.log(
        `Socket connected: ${socket.id}, User: ${socket.userId}`
    );

    socket.join(`driver_${socket.userId}`);
    socket.join(`user_${socket.userId}`);

    // JOIN RIDE ROOM
    socket.on('join_ride', (data) => {
        try {
            const parsed =
                typeof data === 'string'
                    ? JSON.parse(data)
                    : data;

            const rideId = parsed.rideId;

            socket.join(`ride_${rideId}`);

            console.log(
                `User ${socket.userId} joined ride_${rideId}`
            );
        } catch (e) {
            console.error(
                'join_ride parse error:',
                e.message
            );
        }
    });

    // JOIN ADMIN ROOM
    socket.on('join_admin', () => {
        if (socket.userRole === 'admin') {
            socket.join('admin_panel');

            console.log(
                `Admin ${socket.userId} joined admin_panel`
            );
        }
    });

    // SEND MESSAGE
    socket.on('send_message', async (data) => {
        try {
            const { rideId, text } = data;

            // PRISMA VERSION
            const message = await prisma.message.create({
                data: {
                    bookingId: rideId,  // Message model uses 'bookingId', not 'rideId'
                    senderId: socket.userId,
                    senderRole:
                        socket.userRole || 'customer',
                    text,
                },
            });

            io.to(`ride_${rideId}`).emit(
                'new_message',
                message
            );
        } catch (error) {
            console.error(
                'Socket send_message error:',
                error
            );
        }
    });

    socket.on('disconnect', () => {
        console.log(
            `Socket disconnected: ${socket.id}`
        );
    });
});

// ─────────────────────────────────────────────────────────────
// HTTP MIDDLEWARE
// ─────────────────────────────────────────────────────────────

app.use(cors());

// Stripe webhook MUST use raw body
app.post(
    '/api/payments/webhook',
    express.raw({ type: 'application/json' }),
    webhook
);

app.use(
    express.json({
        limit: '10kb',
    })
);

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({
        success: true,
        message:
            'PRVYN Limo App Backend is running',
    });
});

// HEALTH CHECK
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'ok',
        uptime: process.uptime(),
    });
});

app.use('/api/auth', authRoutes);

app.use('/api/driver', driverRoutes);

app.use('/api/bookings', bookingRoutes);

app.use('/api/customer',customerRoutes);

app.use('/api/vehicle-categories',vehicleCategoryRoutes);

app.use('/api/chat', chatRoutes);

app.use('/api/payments', paymentRoutes);

app.use('/api/notifications', notificationRoutes);

app.use('/api/admin', adminRoutes);

// ─────────────────────────────────────────────────────────────
// 404 HANDLER
// ─────────────────────────────────────────────────────────────

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
    });
});

// ─────────────────────────────────────────────────────────────
// GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
    console.error(err.stack);

    res.status(err.status || 500).json({
        success: false,
        message:
            process.env.NODE_ENV === 'production'
                ? 'Internal Server Error'
                : err.message,
    });
});

// ─────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────

process.on('SIGTERM', async () => {
    console.log(
        'SIGTERM received — shutting down gracefully'
    );

    server.close(async () => {
        // PRISMA DISCONNECT
        await prisma.$disconnect();

        process.exit(0);
    });
});

// ─────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────

async function startServer() {
    try {
        // TEST DATABASE CONNECTION
        await prisma.$connect();

        console.log(
            'PostgreSQL connected successfully'
        );

        server.listen(port, () => {
            console.log(
                `Server is running on port ${port}`
            );
        });
    } catch (error) {
        console.error(
            'Database connection failed:',
            error.message
        );

        process.exit(1);
    }
}

startServer();
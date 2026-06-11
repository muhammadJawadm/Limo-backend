const buildRideFilter = (tab) => {
    const now = new Date();

    const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    );

    if (tab === 'cancelled') {
        return {
            rideStatus: 'cancelled',
        };
    }

    if (tab === 'past') {
        return {
            OR: [
                {
                    rideStatus: 'completed',
                },
                {
                    date: {
                        lt: startOfToday,
                    },
                    rideStatus: {
                        notIn: ['cancelled', 'pending_payment'],
                    },
                },
            ],
        };
    }

    // Default: upcoming
    return {
        date: {
            gte: startOfToday,
        },
        rideStatus: {
            notIn: ['completed', 'cancelled', 'pending_payment'],
        },
    };
};

module.exports = { buildRideFilter };
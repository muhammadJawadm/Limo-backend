const express = require('express');
const customerController = require('../controllers/customerController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/profile', customerController.getMyProfile);
router.patch('/profile', customerController.updateMyProfile);
router.get('/rides', customerController.getMyRides);
router.patch('/rides/:id/cancel', customerController.cancelMyRide);

module.exports = router;
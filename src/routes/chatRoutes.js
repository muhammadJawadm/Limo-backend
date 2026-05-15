const express = require('express');
const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/:rideId', protect, chatController.getRideMessages);

module.exports = router;
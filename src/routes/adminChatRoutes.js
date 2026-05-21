const express = require('express');
const adminChatController = require('../controllers/adminChatController');
const { protect, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect, requireAdmin);

router.get('/driver/:driverUserId/messages', adminChatController.getMessagesForDriver);
router.post('/driver/:driverUserId/messages', adminChatController.postMessageToDriver);

module.exports = router;

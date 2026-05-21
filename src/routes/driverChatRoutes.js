const express = require('express');
const adminChatController = require('../controllers/adminChatController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/messages', adminChatController.getMyMessages);
router.post('/messages', adminChatController.postMessageFromDriver);

module.exports = router;

const express = require('express');
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

router.get('/driver', notificationController.getDriverNotifications);
router.get('/customer', notificationController.getCustomerNotifications);
router.post('/', notificationController.createNotification);
router.patch('/:id', notificationController.updateNotification);
router.delete('/:id', notificationController.deleteNotification);

module.exports = router;
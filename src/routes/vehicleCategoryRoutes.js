const express = require('express');
const vehicleCategoryController = require('../controllers/vehicleCategoryController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../utils/multer');

const router = express.Router();

router.get('/', vehicleCategoryController.getVehicleCategories);
router.get('/:id', vehicleCategoryController.getVehicleCategoryById);

router.post('/', protect, upload.single('picture'), vehicleCategoryController.createVehicleCategory);
router.patch('/:id', protect, upload.single('picture'), vehicleCategoryController.updateVehicleCategory);
router.delete('/:id', protect, vehicleCategoryController.deleteVehicleCategory);

module.exports = router;

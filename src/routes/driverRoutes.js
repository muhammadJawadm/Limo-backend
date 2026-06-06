const express = require('express');
const driverController = require('../controllers/driverController');
const { protect } = require('../middleware/authMiddleware');
const upload = require('../utils/multer');

const router = express.Router();

router.use(protect);

router.get('/profile', driverController.getMyProfile);
router.patch('/profile', driverController.updateMyPersonalInfo);
router.get('/onboarding', driverController.getMyOnboarding);
router.get('/onboarding/:step', driverController.getMyOnboardingStep);
router.patch('/onboarding', driverController.updateOnboardingFields);
router.patch('/onboarding/company-information', driverController.updateCompanyInformation);
router.patch('/onboarding/fleet-information', driverController.updateFleetInformation);
router.patch('/onboarding/first-chauffeur-information', driverController.updateFirstChauffeurInformation);
router.patch('/onboarding/first-vehicle-information', driverController.updateFirstVehicleInformation);
router.patch('/onboarding/required-documents', driverController.updateRequiredDocuments);
router.patch('/onboarding/partner-training', driverController.updatePartnerTraining);
router.patch('/onboarding/contract-agreement', driverController.updateContractAgreement);
router.patch('/onboarding/payment-information', driverController.updatePaymentInformation);
router.patch('/onboarding/availability', driverController.updateAvailability);
router.post('/onboarding/upload', upload.single('file'), driverController.uploadOnboardingFile);
router.post('/onboarding/submit', driverController.submitOnboarding);

router.get('/rides', driverController.getDriverRides);
router.get('/rides/:id', driverController.getDriverRideById);
router.get('/rides/:id/details', driverController.getDriverRideDetails);
// router.patch('/rides/:id/assign', driverController.assignRideToMe);
router.patch('/rides/:id/status', driverController.updateMyRideStatus);
router.patch('/rides/:id/confirm-pickup', driverController.confirmPickup);
router.patch('/rides/:id/cancel-trip', driverController.cancelTrip);

router.post('/rides/:id/accept', driverController.acceptAssignedRide);
router.post('/rides/:id/decline', driverController.declineAssignedRide);

router.patch('/drivers/:driverId/verify', driverController.adminVerifyDriver)
router.get('/drivers/:driverId',  driverController.adminGetDriverById)

module.exports = router;

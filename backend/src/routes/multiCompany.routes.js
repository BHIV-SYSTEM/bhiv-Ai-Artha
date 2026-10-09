import express from 'express';
import multiCompanyController from '../controllers/multiCompany.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

// Super admin only (enforced in the controller) - technical platform view.
router.get('/platform-stats', authorize('admin'), multiCompanyController.getPlatformStats);

router.post('/companies', authorize('admin'), multiCompanyController.createCompany);
router.get('/companies', authorize('admin', 'accountant', 'viewer'), multiCompanyController.getCompanies);
router.get('/companies/:id', authorize('admin', 'accountant', 'viewer'), multiCompanyController.getCompany);
router.put('/companies/:id', authorize('admin'), multiCompanyController.updateCompany);

router.post('/companies/:companyId/branches', authorize('admin'), multiCompanyController.createBranch);
router.get('/companies/:companyId/branches', authorize('admin', 'accountant', 'viewer'), multiCompanyController.getBranches);

router.post('/companies/:companyId/consolidated-report', authorize('admin'), multiCompanyController.getConsolidatedReport);
router.post('/consolidated-trial-balance', authorize('admin', 'accountant'), multiCompanyController.getConsolidatedTrialBalance);

router.post('/cost-centres', authorize('admin'), multiCompanyController.createCostCentre);
router.get('/cost-centres', authorize('admin', 'accountant', 'viewer'), multiCompanyController.getCostCentres);

export default router;

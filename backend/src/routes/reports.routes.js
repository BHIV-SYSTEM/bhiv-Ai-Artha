import express from 'express';
import { exportGeneralLedger } from '../controllers/pdf.controller.js';
import {
  getProfitLoss,
  getBalanceSheet,
  getCashFlow,
  getTrialBalance,
  getAgedReceivables,
  getDashboardSummary,
  getReportPeriodContext,
  getGSTSummaryReport,
  getTDSSummaryReport,
  getKPIs,
  exportProfitLossPDF,
  exportBalanceSheetPDF,
  exportCashFlowPDF,
  exportTrialBalancePDF,
  getRevenueExpensesChart,
  getExpenseBreakdown,
  getBankTransactionTimeline,
} from '../controllers/reports.controller.js';
import { protect, authorize } from '../middleware/auth.js';

const router = express.Router();

router.use(protect);

router.route('/general-ledger').get(authorize('admin', 'accountant', 'viewer'), exportGeneralLedger);
router.route('/profit-loss').get(authorize('admin', 'accountant', 'viewer'), getProfitLoss);
router.route('/profit-loss/export').get(authorize('admin', 'accountant', 'viewer'), exportProfitLossPDF);
router.route('/balance-sheet').get(authorize('admin', 'accountant', 'viewer'), getBalanceSheet);
router.route('/balance-sheet/export').get(authorize('admin', 'accountant', 'viewer'), exportBalanceSheetPDF);
router.route('/cash-flow').get(authorize('admin', 'accountant', 'viewer'), getCashFlow);
router.route('/cash-flow/export').get(authorize('admin', 'accountant', 'viewer'), exportCashFlowPDF);
router.route('/trial-balance').get(authorize('admin', 'accountant', 'viewer'), getTrialBalance);
router.route('/trial-balance/export').get(authorize('admin', 'accountant', 'viewer'), exportTrialBalancePDF);
router.route('/aged-receivables').get(authorize('admin', 'accountant', 'viewer'), getAgedReceivables);
router.route('/dashboard').get(authorize('admin', 'accountant', 'viewer'), getDashboardSummary);
router.route('/period-context').get(authorize('admin', 'accountant', 'viewer'), getReportPeriodContext);
router.route('/gst-summary').get(authorize('admin', 'accountant', 'viewer'), getGSTSummaryReport);
router.route('/tds-summary').get(authorize('admin', 'accountant', 'viewer'), getTDSSummaryReport);
router.route('/kpis').get(authorize('admin', 'accountant', 'viewer'), getKPIs);
router.route('/revenue-expenses-chart').get(authorize('admin', 'accountant', 'viewer'), getRevenueExpensesChart);
router.route('/expense-breakdown').get(authorize('admin', 'accountant', 'viewer'), getExpenseBreakdown);
router.route('/bank-transaction-timeline').get(authorize('admin', 'accountant', 'viewer'), getBankTransactionTimeline);

export default router;
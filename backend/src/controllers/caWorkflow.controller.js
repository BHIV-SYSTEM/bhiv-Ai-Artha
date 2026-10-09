import caWorkflowService from '../services/caWorkflow.service.js';
import Expense from '../models/Expense.js';
import JournalEntry from '../models/JournalEntry.js';
import Invoice from '../models/Invoice.js';
import BankStatement from '../models/BankStatement.js';
import GSTReturn from '../models/GSTReturn.js';
import TDSEntry from '../models/TDSEntry.js';
import logger from '../config/logger.js';

class CAWorkflowController {
  async getPeriods(req, res) {
    try {
      const periods = await caWorkflowService.getPeriods(req.query);
      res.json({ success: true, data: periods });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  }

  async getOrCreatePeriod(req, res) {
    try {
      const period = await caWorkflowService.getOrCreatePeriod(req.body);
      res.json({ success: true, data: period });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async monthClose(req, res) {
    try {
      const period = await caWorkflowService.monthClose(req.params.periodId, req.user._id);
      res.json({ success: true, data: period, message: 'Month closed successfully' });
    } catch (err) {
      logger.error('Month close error:', err);
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async quarterClose(req, res) {
    try {
      const period = await caWorkflowService.quarterClose(req.params.periodId, req.user._id);
      res.json({ success: true, data: period, message: 'Quarter closed successfully' });
    } catch (err) {
      logger.error('Quarter close error:', err);
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async annualClose(req, res) {
    try {
      const period = await caWorkflowService.annualClose(req.params.periodId, req.user._id);
      res.json({ success: true, data: period, message: 'Annual close completed' });
    } catch (err) {
      logger.error('Annual close error:', err);
      res.status(400).json({ success: false, message: err.message });
    }
  }

  async generateTrialBalance(req, res) {
    try {
      const trialBalance = await caWorkflowService.generateTrialBalance(req.params.periodId);
      res.json({ success: true, data: trialBalance });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  }

  /**
   * GET /action-items — real work queue for accountants/CAs: pending approvals,
   * unposted drafts, overdue invoices, reconciliation mismatches, filing status
   * and statutory deadlines (rule-based due dates, previous filing period).
   */
  async getActionItems(req, res) {
    try {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // An upload still pending/processing after 1 hour is stuck.
      const stuckCutoff = new Date(now.getTime() - 60 * 60 * 1000);
      const unusableDocFilter = {
        $or: [
          { status: 'failed' },
          { status: { $in: ['pending', 'processing'] }, createdAt: { $lt: stuckCutoff } },
        ],
      };

      const [
        pendingExpenseCount,
        pendingExpenses,
        awaitingPostCount,
        overdueInvoiceCount,
        gstDraftCount,
        tdsDepositedCount,
        tdsDeductedCount,
        recentStatements,
        unusableDocCount,
        unusableDocs,
      ] = await Promise.all([
        Expense.countDocuments({ status: 'pending' }),
        Expense.find({ status: 'pending' }).sort({ date: -1 }).limit(5)
          .select('vendor totalAmount date description').lean(),
        JournalEntry.countDocuments({ status: { $in: ['DRAFT', 'draft', 'VALIDATED', 'validated'] } }),
        Invoice.countDocuments({ status: { $in: ['sent', 'partial', 'overdue'] }, dueDate: { $lt: startOfToday } }),
        GSTReturn.countDocuments({ status: 'draft' }),
        TDSEntry.countDocuments({ status: 'deposited' }),
        TDSEntry.countDocuments({ status: 'deducted' }),
        BankStatement.find({ status: 'completed' }).sort({ createdAt: -1 }).limit(5)
          .select('statementNumber transactions').lean(),
        BankStatement.countDocuments(unusableDocFilter),
        BankStatement.find(unusableDocFilter).sort({ createdAt: -1 }).limit(5)
          .select('statementNumber status').lean(),
      ]);

      const unmatchedByStatement = recentStatements
        .map((s) => ({
          statementNumber: s.statementNumber,
          unmatched: (s.transactions || []).filter((t) => !t.matched).length,
        }))
        .filter((s) => s.unmatched > 0);
      const unmatchedTotal = unmatchedByStatement.reduce((sum, s) => sum + s.unmatched, 0);

      // Statutory due dates for the previous calendar month's filings
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevLabel = `${prevStart.toLocaleString('en', { month: 'short' })} ${prevStart.getFullYear()}`;
      const mkDeadline = (label, due) => {
        const daysLeft = Math.ceil((due - startOfToday) / 86400000);
        return {
          label,
          dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`,
          daysLeft,
          state: due < startOfToday ? 'overdue' : daysLeft <= 7 ? 'due_soon' : 'upcoming',
        };
      };

      const deadlines = [
        mkDeadline(`GSTR-1 for ${prevLabel}`, new Date(now.getFullYear(), now.getMonth(), 11)),
        mkDeadline(`GSTR-3B for ${prevLabel}`, new Date(now.getFullYear(), now.getMonth(), 20)),
        mkDeadline(`TDS deposit for ${prevLabel}`, new Date(now.getFullYear(), now.getMonth(), 7)),
      ];
      // Quarterly TDS return (26Q): due last day of month after quarter end
      const prevMonthIndex = now.getMonth() - 1;
      if ([2, 5, 8, 11].includes(prevMonthIndex < 0 ? prevMonthIndex + 12 : prevMonthIndex)) {
        deadlines.push(
          mkDeadline(`TDS 26Q for quarter ending ${prevLabel}`, new Date(now.getFullYear(), now.getMonth() + 1, 0))
        );
      }

      const items = [];
      if (overdueInvoiceCount > 0) {
        items.push({ type: 'overdue_invoices', priority: 'high', title: `${overdueInvoiceCount} invoice(s) overdue`, detail: 'Collect receivables or issue reminders', count: overdueInvoiceCount, link: '/reports/aged-receivables' });
      }
      if (unusableDocCount > 0) {
        items.push({
          type: 'missing_documents',
          priority: 'high',
          title: `${unusableDocCount} uploaded document(s) failed or stuck`,
          detail: unusableDocs.map((s) => `${s.statementNumber || 'unknown'} (${s.status})`).join(', '),
          count: unusableDocCount,
          link: '/statements',
        });
      }
      if (unmatchedTotal > 0) {
        items.push({ type: 'reconciliation_mismatch', priority: 'high', title: `${unmatchedTotal} unmatched bank transaction(s)`, detail: unmatchedByStatement.map((s) => `${s.statementNumber}: ${s.unmatched}`).join(', '), count: unmatchedTotal, link: '/statements' });
      }
      if (pendingExpenseCount > 0) {
        items.push({ type: 'pending_approvals', priority: 'medium', title: `${pendingExpenseCount} expense(s) awaiting approval`, detail: pendingExpenses.map((e) => `${e.vendor || 'Vendor'} ₹${Number(e.totalAmount || 0).toLocaleString('en-IN')}`).join(', '), count: pendingExpenseCount, link: '/expenses/approval' });
      }
      if (awaitingPostCount > 0) {
        items.push({ type: 'unposted_drafts', priority: 'medium', title: `${awaitingPostCount} journal entr(y/ies) not posted`, detail: 'Draft/validated entries require accountant review before posting', count: awaitingPostCount, link: '/journal-entries' });
      }
      if (gstDraftCount > 0) {
        items.push({ type: 'gst_filing', priority: 'medium', title: `${gstDraftCount} GST return(s) in draft`, detail: 'Prepare, validate and download filing packet', count: gstDraftCount, link: '/gst' });
      }
      if (tdsDeductedCount > 0) {
        items.push({ type: 'tds_deposit', priority: 'medium', title: `${tdsDeductedCount} TDS deduction(s) awaiting challan deposit`, detail: 'Deposit tax and record the challan', count: tdsDeductedCount, link: '/tds' });
      }
      if (tdsDepositedCount > 0) {
        items.push({ type: 'tds_filing', priority: 'low', title: `${tdsDepositedCount} deposited TDS entry(ies) awaiting filing acknowledgement`, detail: 'File on TRACES and record the acknowledgement number', count: tdsDepositedCount, link: '/tds' });
      }

      res.json({
        success: true,
        data: { items, deadlines, generatedAt: now.toISOString() },
      });
    } catch (err) {
      logger.error('Action items error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
}

export default new CAWorkflowController();

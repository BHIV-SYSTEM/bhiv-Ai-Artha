import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

import ErrorBoundary from './components/common/ErrorBoundary';
import Layout from './components/layout/Layout';
import AuthLayout from './components/layout/AuthLayout';

import Login from './pages/auth/Login';

import FinancialIntelligenceDashboard from './pages/dashboard/FinancialIntelligenceDashboard';
import TallyConnect from './pages/tally/TallyConnect';

import InvoiceList from './pages/invoices/InvoiceList';
import InvoiceCreate from './pages/invoices/InvoiceCreate';
import InvoiceView from './pages/invoices/InvoiceView';

import ExpenseList from './pages/expenses/ExpenseList';
import ExpenseCreate from './pages/expenses/ExpenseCreate';
import ExpenseApproval from './pages/expenses/ExpenseApproval';

import ChartOfAccounts from './pages/accounting/ChartOfAccounts';
import JournalEntries from './pages/accounting/JournalEntries';
import JournalEntryCreate from './pages/accounting/JournalEntryCreate';
import LedgerIntegrity from './pages/accounting/LedgerIntegrity';

import ProfitLoss from './pages/reports/ProfitLoss';
import BalanceSheet from './pages/reports/BalanceSheet';
import CashFlow from './pages/reports/CashFlow';
import TrialBalance from './pages/reports/TrialBalance';
import AgedReceivables from './pages/reports/AgedReceivables';

import GSTDashboard from './pages/compliance/GSTDashboard';
import TDSManagement from './pages/compliance/TDSManagement';
import SignalDashboard from './pages/compliance/SignalDashboard';

import StatementsList from './pages/statements/StatementsList';
import StatementsUpload from './pages/statements/StatementsUpload';
import StatementDetail from './pages/statements/StatementDetail';

import DataIngestion from './pages/ingestion/DataIngestion';

import DealerList from './pages/dealers/DealerList';
import DealerDetail from './pages/dealers/DealerDetail';
const StoreAccountStatement = lazy(() => import('./pages/dealers/StoreAccountStatement'));
import SalesAgentList from './pages/agents/SalesAgentList';
import SalesAgentDetail from './pages/agents/SalesAgentDetail';

import CompanySettings from './pages/settings/CompanySettings';
import UserManagement from './pages/settings/UserManagement';

import NotificationsPage from './pages/notifications/NotificationsPage';

const LazyLoad = ({ children }) => (
  <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
    {children}
  </Suspense>
);

const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
};

const RoleProtectedRoute = ({ children, allowedRoles }) => {
  const { user, isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const rawRoles = user.roles || (user.role ? [user.role] : []);
  // Sub-admin (client company admin) gets admin + accountant page access.
  const userRoles = rawRoles.includes('sub_admin')
    ? [...new Set([...rawRoles, 'admin', 'accountant'])]
    : rawRoles;
  const hasAccess = allowedRoles.some(r => userRoles.includes(r));

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center p-8 bg-card rounded-2xl shadow-xl max-w-md border border-border/30">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-foreground font-display mb-2">Access Denied</h2>
          <p className="text-muted-foreground mb-4">
            You don't have permission to access this page.
            Required role: <span className="font-semibold">{allowedRoles.join(' or ')}</span>
          </p>
          <button
            onClick={() => window.history.back()}
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all duration-300 font-medium"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return children;
};

const PublicRoute = ({ children }) => {
  const { isAuthenticated } = useAuthStore();

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

function App() {
  const { checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        </Route>

        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<FinancialIntelligenceDashboard />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route path="/tally" element={<TallyConnect />} />

          <Route path="/invoices" element={<InvoiceList />} />
          <Route path="/invoices/new" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><InvoiceCreate /></RoleProtectedRoute>} />
          <Route path="/invoices/:id" element={<InvoiceView />} />
          <Route path="/invoices/:id/edit" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><InvoiceCreate /></RoleProtectedRoute>} />

          <Route path="/expenses" element={<ExpenseList />} />
          <Route path="/expenses/new" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><ExpenseCreate /></RoleProtectedRoute>} />
          <Route path="/expenses/:id/edit" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><ExpenseCreate /></RoleProtectedRoute>} />
          <Route path="/expenses/approval" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><ExpenseApproval /></RoleProtectedRoute>} />

          <Route path="/accounts" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><ChartOfAccounts /></RoleProtectedRoute>} />
          <Route path="/journal-entries" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><JournalEntries /></RoleProtectedRoute>} />
          <Route path="/journal-entries/new" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><JournalEntryCreate /></RoleProtectedRoute>} />
          <Route path="/journal-entries/:id/edit" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><JournalEntryCreate /></RoleProtectedRoute>} />
          <Route path="/ledger-integrity" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><LedgerIntegrity /></RoleProtectedRoute>} />

          <Route path="/reports/profit-loss" element={<ProfitLoss />} />
          <Route path="/reports/balance-sheet" element={<BalanceSheet />} />
          <Route path="/reports/cash-flow" element={<CashFlow />} />
          <Route path="/reports/trial-balance" element={<TrialBalance />} />
          <Route path="/reports/aged-receivables" element={<AgedReceivables />} />

          <Route path="/gst" element={<GSTDashboard />} />
          <Route path="/tds" element={<TDSManagement />} />
          <Route path="/signals" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><SignalDashboard /></RoleProtectedRoute>} />

          <Route path="/ingestion" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><DataIngestion /></RoleProtectedRoute>} />

          <Route path="/dealers" element={<DealerList />} />
          <Route path="/dealers/new" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><DealerList /></RoleProtectedRoute>} />
          <Route path="/dealers/:id" element={<DealerDetail />} />
          <Route path="/dealers/:id/edit" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><DealerDetail /></RoleProtectedRoute>} />
          <Route path="/dealers/:id/statement" element={<LazyLoad><StoreAccountStatement /></LazyLoad>} />
          <Route path="/agents" element={<SalesAgentList />} />
          <Route path="/agents/new" element={<RoleProtectedRoute allowedRoles={['admin']}><SalesAgentList /></RoleProtectedRoute>} />
          <Route path="/agents/:id" element={<SalesAgentDetail />} />

          <Route path="/statements" element={<StatementsList />} />
          <Route path="/statements/upload" element={<RoleProtectedRoute allowedRoles={['admin', 'accountant']}><StatementsUpload /></RoleProtectedRoute>} />
          <Route path="/statements/:id" element={<StatementDetail />} />

          <Route path="/settings/company" element={<RoleProtectedRoute allowedRoles={['admin']}><CompanySettings /></RoleProtectedRoute>} />
          <Route path="/settings/users" element={<RoleProtectedRoute allowedRoles={['admin']}><UserManagement /></RoleProtectedRoute>} />

          <Route path="/notifications" element={<NotificationsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;

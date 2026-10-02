import api from './api';

// Invoice Services
export const invoiceService = {
  getAll: (params) => api.get('/invoices', { params }),
  getById: (id) => api.get(`/invoices/${id}`),
  getShared: (id) => api.get(`/invoices/${id}/shared`),
  getSharedList: () => api.get('/invoices/shared'),
  create: (data) => api.post('/invoices', data),
  update: (id, data) => api.put(`/invoices/${id}`, data),
  delete: (id) => api.delete(`/invoices/${id}`),
  send: (id) => api.post(`/invoices/${id}/send`),
  recordPayment: (id, data) => api.post(`/invoices/${id}/payment`, data),
  downloadPdf: (id) => api.get(`/invoices/${id}/pdf`, { responseType: 'blob' }),
};

// Expense Services
export const expenseService = {
  getAll: (params) => api.get('/expenses', { params }),
  getById: (id) => api.get(`/expenses/${id}`),
  create: (data) => api.post('/expenses', data),
  update: (id, data) => api.put(`/expenses/${id}`, data),
  delete: (id) => api.delete(`/expenses/${id}`),
  approve: (id) => api.post(`/expenses/${id}/approve`),
  reject: (id, reason) => api.post(`/expenses/${id}/reject`, { reason }),
  getPending: () => api.get('/expenses/pending'),
  scanReceipt: (file) => {
    const formData = new FormData();
    formData.append('receipt', file);
    return api.post('/expenses/ocr', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Account/Ledger Services
export const accountService = {
  getAll: () => api.get('/accounts'),
  getById: (id) => api.get(`/accounts/${id}`),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  delete: (id) => api.delete(`/accounts/${id}`),
};

export const ledgerService = {
  getEntries: (params) => api.get('/ledger/entries', { params }),
  getEntryById: (id) => api.get(`/ledger/entries/${id}`),
  createEntry: (data) => api.post('/ledger/entries', data),
  updateEntry: (id, data) => api.put(`/ledger/entries/${id}`, data),
  postEntry: (id) => api.post(`/ledger/entries/${id}/post`),
  verifyIntegrity: () => api.get('/ledger/verify'),
};

// GST Services
export const gstService = {
  getSummary: (params) => api.get('/gst/summary', { params }),
  getGSTR1: (period) => api.get(`/gst/gstr1/${period}`),
  getGSTR3B: (period) => api.get(`/gst/gstr3b/${period}`),
  fileReturn: (data) => api.post('/gst/file-return', data),
  downloadGSTR1: (period) => api.get(`/gst/gstr1/${period}/download`, { responseType: 'blob' }),
};

// TDS Services
export const tdsService = {
  getSummary: (params) => api.get('/tds/summary', { params }),
  getEntries: (params) => api.get('/tds/entries', { params }),
  createEntry: (data) => api.post('/tds/entries', data),
  payTDS: (id, data) => api.post(`/tds/pay/${id}`, data),
  downloadForm: (form, params) => api.get(`/tds/forms/${form}`, { params, responseType: 'blob' }),
};

// Report Services
export const reportService = {
  getPeriodContext: () => api.get('/reports/period-context'),
  getProfitLoss: (params) => api.get('/reports/profit-loss', { params }),
  getBalanceSheet: (params) => api.get('/reports/balance-sheet', { params }),
  getCashFlow: (params) => api.get('/reports/cash-flow', { params }),
  getTrialBalance: (params) => api.get('/reports/trial-balance', { params }),
  getAgedReceivables: () => api.get('/reports/aged-receivables'),
  getAgedPayables: () => api.get('/reports/aged-payables'),
  exportReport: (type, params) => api.get(`/reports/${type}/export`, { params, responseType: 'blob' }),
};

// Dashboard Services (uses reports/invoices/expenses endpoints)
export const dashboardService = {
  getStats: () => api.get('/reports/dashboard'),
  getInvoiceStats: () => api.get('/invoices/stats'),
  getExpenseStats: () => api.get('/expenses/stats'),
  getRecentInvoices: () => api.get('/invoices', { params: { limit: 5, sortBy: 'invoiceDate', sortOrder: 'desc' } }),
  getRecentExpenses: () => api.get('/expenses', { params: { limit: 5, sortBy: 'date', sortOrder: 'desc' } }),
  getBankTransactionTimeline: (params) => api.get('/reports/bank-transaction-timeline', { params }),
  getRevenueChart: (params) => api.get('/reports/revenue-expenses-chart', { params }),
  getExpenseChart: (params) => api.get('/reports/expense-breakdown', { params }),
  getPendingApprovals: () => api.get('/expenses', { params: { status: 'pending', limit: 10 } }),
};

// Settings Services
export const settingsService = {
  getCompany: () => api.get('/settings/company'),
  updateCompany: (data) => api.put('/settings/company', data),
  uploadLogo: (file) => {
    const formData = new FormData();
    formData.append('logo', file);
    return api.post('/settings/company/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// User Services
export const userService = {
  getAll: () => api.get('/users'),
  getById: (id) => api.get(`/users/${id}`),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
  changePassword: (id, data) => api.post(`/users/${id}/change-password`, data),
  getProfile: () => api.get('/users/me'),
  updateProfile: (data) => api.put('/users/me', data),
};

// Smart Upload Services
export const smartUploadService = {
  upload: (file, metadata = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    Object.keys(metadata).forEach(key => {
      if (metadata[key]) formData.append(key, metadata[key]);
    });
    return api.post('/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  uploadBatch: (files, metadata = {}) => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    Object.keys(metadata).forEach(key => {
      if (metadata[key]) formData.append(key, metadata[key]);
    });
    return api.post('/upload/batch', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// Tally Import/Export Services
export const tallyService = {
  importVouchers: (data) => api.post('/tally/import/vouchers', data),
  importMasters: (data) => api.post('/tally/import/masters', data),
  importFile: (file, options = {}) => {
    const formData = new FormData();
    formData.append('file', file);
    Object.keys(options).forEach(key => {
      if (options[key] !== undefined && options[key] !== null) {
        formData.append(key, options[key]);
      }
    });
    return api.post('/tally/import/file', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  previewFile: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/tally/import/file/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  exportVouchers: (data) => api.post('/tally/export/vouchers', data),
  exportMasters: (data) => api.post('/tally/export/masters', data),
  exportOpeningBalances: (data) => api.post('/tally/export/opening-balances', data),
  exportGSTData: (data) => api.post('/tally/export/gst-data', data),
  validateMigration: (data) => api.post('/tally/validate-migration', data),
  getImportHistory: (params = {}) => api.get('/tally/import/history', { params }),
};

// Bank Statement Services
export const bankStatementService = {
  upload: (file, data) => {
    const formData = new FormData();
    formData.append('statement', file);
    Object.keys(data).forEach(key => {
      formData.append(key, data[key]);
    });
    return api.post('/statements/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  getAll: (params) => api.get('/statements', { params }),
  getById: (id) => api.get(`/statements/${id}`),
  process: (id) => api.post(`/statements/${id}/process`),
  matchTransactions: (id) => api.post(`/statements/${id}/match`),
  createExpenses: (id, transactionIds) => api.post(`/statements/${id}/create-expenses`, { transactionIds }),
  extract: (file) => {
    const formData = new FormData();
    formData.append('statement', file);
    return api.post('/statements/extract', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((res) => res.data.data);
  },
  delete: (id) => api.delete(`/statements/${id}`),
};

// Mitra AI Services
export const mitraService = {
  chat: (message) => api.post('/mitra/chat', { message }),
  analyze: (query) => api.post('/mitra/analyze', { query }),
  getInsights: () => api.get('/mitra/insights'),
  analyzeStatement: (message, statementId) => api.post('/mitra/analyze-statement', { message, statementId }),
  getCapabilities: () => api.get('/mitra/capabilities'),
  health: () => api.get('/mitra/health'),
};

// Dealer Services
export const dealerService = {
  getAll: (params) => api.get('/dealers', { params }),
  getById: (id) => api.get(`/dealers/${id}`),
  create: (data) => api.post('/dealers', data),
  update: (id, data) => api.put(`/dealers/${id}`, data),
  delete: (id) => api.delete(`/dealers/${id}`),
  getSummary: (id) => api.get(`/dealers/${id}/summary`),
  syncFromTally: () => api.post('/dealers/sync-tally'),
  syncOutstanding: () => api.post('/dealers/sync-outstanding'),
  getStats: () => api.get('/dealers/stats'),
  getRegions: () => api.get('/dealers/regions'),
  getCities: () => api.get('/dealers/cities'),
};

// Sales Agent Services
export const salesAgentService = {
  getAll: (params) => api.get('/sales-agents', { params }),
  getById: (id) => api.get(`/sales-agents/${id}`),
  create: (data) => api.post('/sales-agents', data),
  update: (id, data) => api.put(`/sales-agents/${id}`, data),
  delete: (id) => api.delete(`/sales-agents/${id}`),
  getDashboard: (id) => api.get(`/sales-agents/${id}/dashboard`),
  getPerformance: (id, params) => api.get(`/sales-agents/${id}/performance`, { params }),
  assignDealer: (agentId, dealerId) => api.post(`/sales-agents/${agentId}/assign-dealer/${dealerId}`),
  unassignDealer: (agentId, dealerId) => api.delete(`/sales-agents/${agentId}/unassign-dealer/${dealerId}`),
  getMap: () => api.get('/sales-agents/map'),
};

// Notification Services
export const notificationService = {
  send: (data) => api.post('/notifications/send', data),
  sendBulk: (data) => api.post('/notifications/send-bulk', data),
  getAll: (params) => api.get('/notifications', { params }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markRead: (id) => api.put(`/notifications/${id}/read`),
  markAllRead: () => api.put('/notifications/read-all'),
  registerDeviceToken: (data) => api.post('/notifications/device-token', data),
  removeDeviceToken: (token) => api.delete(`/notifications/device-token/${token}`),
};


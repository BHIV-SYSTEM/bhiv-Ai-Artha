/**
 * FinancialIntelligenceDashboard.jsx
 *
 * Professional financial dashboard with ALL live data from backend.
 * - Revenue vs Expenses bar chart (monthly)
 * - Bank Transaction Timeline area chart
 * - Expense Breakdown pie chart
 * - Balance Sheet, Bank Flow, Invoice Status
 * - Compact signal alerts sidebar
 * ALL data is live from /api/v1/reports/* endpoints — no seeding.
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  WifiOff,
  IndianRupee,
  Receipt,
  Wallet,
  CreditCard,
  FileText,
  PiggyBank,
  TrendingUp,
  ListChecks,
  CalendarClock,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, Loading, Badge } from '../../components/common';
import SignalStackPanel from '../../components/intelligence/SignalStackPanel';
import SignalDetailEngine from '../../components/intelligence/SignalDetailEngine';
import RuntimeModeBanner from '../../components/intelligence/RuntimeModeBanner';
import { useRuntimeMode, RUNTIME_MODES } from '../../hooks/useRuntimeMode';
import { useSignals, SIGNAL_SOURCE } from '../../hooks/useSignals';
import { dashboardService, reportService } from '../../services';
import { formatCurrency } from '../../utils/formatters';
import api from '../../services/api';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const fmt = (n) => {
  const num = Number(n || 0);
  if (Math.abs(num) >= 10000000) return `₹${(num / 10000000).toFixed(2)}Cr`;
  if (Math.abs(num) >= 100000) return `₹${(num / 100000).toFixed(2)}L`;
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

// ─── Map DB signals for display (deduplicated by type) ───────────────────────
function mapDbSignals(rawSignals) {
  if (!rawSignals.length) return [];
  const seen = new Set();
  return rawSignals
    .filter(sig => {
      const type = sig.type || sig.signal_type;
      if (seen.has(type)) return false;
      seen.add(type);
      return true;
    })
    .map((sig, i) => ({
      id: sig.signal_id || sig._id || `db_${i}`,
      signal_id: sig.signal_id,
      signal_type: sig.type || sig.signal_type || 'UNKNOWN',
      type: sig.type || sig.signal_type,
      label: sig.context?.label || sig.type?.replace(/_/g, ' ').toLowerCase() || 'Signal',
      severity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(sig.severity) ? sig.severity : 'LOW',
      reason: sig.context?.reason || sig.recommendation || '',
      recommendation: typeof sig.recommendation === 'string'
        ? sig.recommendation.replace(/^\[[^\]]+\]\s*/, '')
        : '',
      variance_pct: Number(sig.context?.variance_pct || 0),
      trace_id: sig.trace_id,
      created_at: sig.created_at,
      context: sig.context,
    }));
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
const COLOR_MAP = {
  primary: { bg: 'bg-primary/10', text: 'text-primary' },
  success: { bg: 'bg-success/10', text: 'text-success' },
  destructive: { bg: 'bg-destructive/10', text: 'text-destructive' },
  warning: { bg: 'bg-warning/10', text: 'text-warning' },
};

const KpiCard = ({ icon: Icon, label, value, subValue, color = 'primary' }) => {
  const colors = COLOR_MAP[color] || COLOR_MAP.primary;
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
          <p className="text-xl font-bold text-foreground">{value}</p>
          {subValue && <p className="text-xs text-muted-foreground">{subValue}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${colors.bg}`}>
          <Icon className={`w-5 h-5 ${colors.text}`} />
        </div>
      </div>
    </Card>
  );
};

// ─── BackendUnavailableState ─────────────────────────────────────────────────
const BackendUnavailableState = ({ onRetry }) => (
  <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
    <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
      <WifiOff className="w-8 h-8 text-destructive" />
    </div>
    <div className="text-center">
      <p className="text-base font-semibold text-foreground">Backend Unavailable</p>
      <p className="text-sm text-muted-foreground mt-1">
        Cannot reach the Artha API. Check that the backend is running.
      </p>
    </div>
    <button
      onClick={onRetry}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
    >
      <RefreshCw className="w-4 h-4" />
      Retry Connection
    </button>
  </div>
);

// ─── Main Dashboard ──────────────────────────────────────────────────────────
const INVOICE_STATUS_COLORS = {
  success: { card: 'bg-success/5 border-success/20', text: 'text-success' },
  warning: { card: 'bg-warning/5 border-warning/20', text: 'text-warning' },
  destructive: { card: 'bg-destructive/5 border-destructive/20', text: 'text-destructive' },
};

const FinancialIntelligenceDashboard = () => {
  const navigate = useNavigate();
  const { mode, lastChecked, recheck } = useRuntimeMode();
  const { signals: rawSignals, source, loading: signalsLoading, error: signalsError, fetchSignals } = useSignals();
  const [selectedSignal, setSelectedSignal] = useState(null);

  // Financial data states
  const [dashboardData, setDashboardData] = useState(null);
  const [revenueExpensesChart, setRevenueExpensesChart] = useState([]);
  const [expenseBreakdown, setExpenseBreakdown] = useState([]);
  const [bankTimeline, setBankTimeline] = useState([]);
  const [actionItems, setActionItems] = useState({ items: [], deadlines: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch ALL live data from backend
  useEffect(() => {
    if (mode === RUNTIME_MODES.BACKEND_CONNECTED || mode === RUNTIME_MODES.BACKEND_DEGRADED) {
      const controller = new AbortController();
      fetchAllData(controller.signal);
      fetchSignals();
      return () => controller.abort();
    }
  }, [mode, fetchSignals]);

  const fetchAllData = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      const firstDayOfYear = new Date(today.getFullYear(), 0, 1);
      const lastDayOfYear = new Date(today.getFullYear(), 11, 31);
      const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

      const [dashResult, chartResult, breakdownResult, timelineResult, actionsResult] = await Promise.allSettled([
        dashboardService.getStats(),
        api.get(`/reports/revenue-expenses-chart?year=${today.getFullYear()}`, { signal }),
        api.get(`/reports/expense-breakdown?startDate=${firstDayOfYear.toISOString().split('T')[0]}&endDate=${lastDayOfYear.toISOString().split('T')[0]}`, { signal }),
        dashboardService.getBankTransactionTimeline({
          startDate: firstDayOfMonth.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0],
        }),
        api.get('/ca-workflow/action-items', { signal }),
      ]);

      if (signal?.aborted) return;

      setDashboardData(dashResult.status === 'fulfilled' ? dashResult.value.data.data : null);
      setRevenueExpensesChart(chartResult.status === 'fulfilled' ? chartResult.value.data.data : []);
      setExpenseBreakdown(breakdownResult.status === 'fulfilled' ? breakdownResult.value.data.data : []);
      setBankTimeline(timelineResult.status === 'fulfilled' ? timelineResult.value.data.data : []);
      setActionItems(
        actionsResult.status === 'fulfilled'
          ? actionsResult.value.data.data || { items: [], deadlines: [] }
          : { items: [], deadlines: [] }
      );
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') return;
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Map signals (deduplicated)
  const signals = useMemo(() => {
    if (!rawSignals.length) return [];
    if (source === SIGNAL_SOURCE.LIVE_LIST) return mapDbSignals(rawSignals);
    return [];
  }, [rawSignals, source]);

  const groupedSignals = useMemo(() => {
    const groups = { HIGH: [], MEDIUM: [], LOW: [] };
    signals.forEach(s => {
      const bucket = s.severity === 'CRITICAL' ? 'HIGH' : s.severity;
      if (groups[bucket]) groups[bucket].push(s);
    });
    return groups;
  }, [signals]);

  useEffect(() => {
    if (signals.length && !selectedSignal) setSelectedSignal(signals[0]);
  }, [signals, selectedSignal]);

  const d = dashboardData;

  // ── Render states ──
  if (mode === RUNTIME_MODES.MOCK_MODE) {
    return (
      <div className="space-y-4">
        <RuntimeModeBanner mode={mode} />
        <Card className="p-6 border-secondary/30 bg-secondary/5">
          <p className="text-sm font-semibold text-secondary">MOCK DEVELOPMENT MODE</p>
          <p className="text-xs text-muted-foreground mt-1">Set VITE_MOCK_MODE=false in frontend/.env</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      <RuntimeModeBanner mode={mode} lastChecked={lastChecked} onRecheck={recheck} />

      {mode === RUNTIME_MODES.BACKEND_UNAVAILABLE && (
        <Card className="p-4 border-destructive/30 bg-destructive/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-destructive" />
              <p className="text-xs font-semibold text-destructive">Backend unavailable — showing cached or empty data</p>
            </div>
            <button onClick={recheck} className="text-xs text-primary hover:underline font-medium">Retry</button>
          </div>
        </Card>
      )}

      {(signalsError || error) && (
        <Card className="p-3 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-xs font-semibold text-destructive">{signalsError?.message || error || 'Data fetch error'}</p>
          </div>
        </Card>
      )}

      {/* KPI Row — Real Financial Data */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Card key={i} className="p-4"><Loading size="sm" /></Card>)}
        </div>
      ) : d ? (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={IndianRupee} label="Revenue (Month)" value={fmt(d.profitLoss?.income)} subValue={`${fmt(d.yearToDate?.income)} YTD`} color="success" />
          <KpiCard icon={Receipt} label="Expenses (Month)" value={fmt(d.profitLoss?.expenses)} subValue={`${fmt(d.yearToDate?.expenses)} YTD`} color="destructive" />
          <KpiCard icon={Wallet} label="Net Income" value={fmt(d.profitLoss?.netIncome)} subValue={`${fmt(d.yearToDate?.netIncome)} YTD`} color={Number(d.profitLoss?.netIncome) >= 0 ? 'success' : 'destructive'} />
          <KpiCard icon={CreditCard} label="Outstanding" value={fmt(d.summary?.totalOutstanding)} subValue={`${d.invoices?.overdue?.count || 0} overdue invoices`} color="warning" />
        </section>
      ) : null}

      {/* Pending Actions & Statutory Deadlines — from CA workflow queue */}
      {!loading && (actionItems.items.length > 0 || actionItems.deadlines.length > 0) && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card className="lg:col-span-2 p-5">
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Pending Actions</h2>
            </div>
            <div className="space-y-2">
              {actionItems.items.length === 0 && (
                <p className="text-sm text-muted-foreground">Nothing pending — all caught up.</p>
              )}
              {actionItems.items.map((item) => (
                <button
                  key={item.type}
                  onClick={() => navigate(item.link)}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-muted hover:bg-muted/70 text-left transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                    {item.detail && (
                      <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                    )}
                  </div>
                  <Badge
                    variant={
                      item.priority === 'high'
                        ? 'danger'
                        : item.priority === 'medium'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {item.count}
                  </Badge>
                </button>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <CalendarClock className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-semibold text-foreground">Statutory Deadlines</h2>
            </div>
            <div className="space-y-2">
              {actionItems.deadlines.length === 0 && (
                <p className="text-sm text-muted-foreground">No upcoming deadlines.</p>
              )}
              {actionItems.deadlines.map((dl) => (
                <div
                  key={dl.label}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{dl.label}</p>
                    <p className="text-xs text-muted-foreground">Due {dl.dueDate}</p>
                  </div>
                  <Badge
                    variant={
                      dl.state === 'overdue'
                        ? 'danger'
                        : dl.state === 'due_soon'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {dl.state === 'overdue'
                      ? `${Math.abs(dl.daysLeft)}d late`
                      : dl.daysLeft === 0
                        ? 'Today'
                        : `${dl.daysLeft}d`}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* Charts Row — Revenue vs Expenses + Expense Breakdown */}
      {!loading && (
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Revenue vs Expenses Bar Chart */}
          <Card className="lg:col-span-2 p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Revenue vs Expenses</h2>
            <p className="text-xs text-muted-foreground mb-4">Monthly comparison for {new Date().getFullYear()}</p>
            {revenueExpensesChart.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revenueExpensesChart}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: '#6B7280', fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Legend />
                  <Bar dataKey="revenue" fill="#10b981" name="Revenue" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" fill="#ef4444" name="Expenses" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
                No journal entry data yet. Create invoices and expenses to see charts.
              </div>
            )}
          </Card>

          {/* Expense Breakdown Pie Chart */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-foreground mb-1">Expense Breakdown</h2>
            <p className="text-xs text-muted-foreground mb-4">By category (YTD)</p>
            {expenseBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={expenseBreakdown}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ category, percentage }) => `${category}: ${percentage}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="amount"
                  >
                    {expenseBreakdown.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground text-sm">
                No approved expenses yet. Add expenses to see breakdown.
              </div>
            )}
          </Card>
        </section>
      )}

      {/* Bank Transaction Timeline */}
      {!loading && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-foreground mb-1">Bank Transaction Timeline</h2>
          <p className="text-xs text-muted-foreground mb-4">Daily credits and debits from uploaded bank statements</p>
          {bankTimeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={bankTimeline}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: '#6B7280', fontSize: 12 }} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fill: '#6B7280', fontSize: 12 }} />
                <Tooltip formatter={(v, name) => [formatCurrency(v), name]} labelFormatter={(_, p) => p?.[0]?.payload?.date || ''} />
                <Legend />
                <Area type="monotone" dataKey="credits" stroke="#10b981" fill="#10b981" fillOpacity={0.25} name="Credits" />
                <Area type="monotone" dataKey="debits" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} name="Debits" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
              No bank statements uploaded. Upload a bank statement to see transaction timeline.
            </div>
          )}
        </Card>
      )}

      {/* Main Content Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">

        {/* Left: Balance Sheet + Recent Activity */}
        <div className="xl:col-span-5 space-y-5">
          {d && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Balance Sheet</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <PiggyBank className="w-4 h-4 text-primary" />
                    <span className="text-sm text-foreground">Total Assets</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmt(d.balanceSheet?.assets)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-destructive" />
                    <span className="text-sm text-foreground">Total Liabilities</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmt(d.balanceSheet?.liabilities)}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-success" />
                    <span className="text-sm text-foreground">Equity</span>
                  </div>
                  <span className="text-sm font-semibold text-foreground">{fmt(d.balanceSheet?.equity)}</span>
                </div>
              </div>
            </Card>
          )}

          {d?.recentEntries?.length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Recent Activity</h2>
              <div className="space-y-2">
                {d.recentEntries.slice(0, 5).map((entry, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{entry.entryNumber}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]">{entry.description || 'No description'}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {entry.date ? new Date(entry.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : ''}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {d?.invoices && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Invoice Status</h2>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Paid', count: d.invoices.paid?.count || 0, amount: d.invoices.paid?.totalAmount || '0', color: 'success' },
                  { label: 'Pending', count: (d.invoices.sent?.count || 0) + (d.invoices.partial?.count || 0), amount: Number(d.invoices.sent?.totalDue || 0) + Number(d.invoices.partial?.totalDue || 0), color: 'warning' },
                  { label: 'Overdue', count: d.invoices.overdue?.count || 0, amount: d.invoices.overdue?.totalDue || '0', color: 'destructive' },
                ].map(item => {
                  const itemColors = INVOICE_STATUS_COLORS[item.color] || INVOICE_STATUS_COLORS.warning;
                  return (
                    <div key={item.label} className={`p-3 rounded-lg ${itemColors.card}`}>
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className={`text-lg font-bold ${itemColors.text}`}>{item.count}</p>
                      <p className="text-xs text-muted-foreground">{fmt(item.amount)}</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>

        {/* Center: Bank Flow + YTD */}
        <div className="xl:col-span-4 space-y-5">
          {d && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Bank Flow (This Month)</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-success/5 border border-success/20">
                  <p className="text-xs text-muted-foreground">Credits</p>
                  <p className="text-lg font-bold text-success">{fmt(d.bankFlow?.monthCredits)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{d.bankFlow?.monthTransactions || 0} transactions</p>
                </div>
                <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <p className="text-xs text-muted-foreground">Debits</p>
                  <p className="text-lg font-bold text-destructive">{fmt(d.bankFlow?.monthDebits)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{d.bankFlow?.monthStatements || 0} statements</p>
                </div>
              </div>
              <div className="mt-3 p-3 rounded-lg bg-muted/30">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Net Flow</span>
                  <span className={`text-sm font-semibold ${Number(d.bankFlow?.monthNetFlow) >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {fmt(d.bankFlow?.monthNetFlow)}
                  </span>
                </div>
              </div>
            </Card>
          )}

          {d?.expensesByStatus && Object.keys(d.expensesByStatus).length > 0 && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Expense Approval Status</h2>
              <div className="space-y-2">
                {Object.entries(d.expensesByStatus).map(([status, data]) => (
                  <div key={status} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                    <span className="text-sm text-foreground capitalize">{status}</span>
                    <div className="text-right">
                      <span className="text-sm font-medium text-foreground">{data.count}</span>
                      <span className="text-xs text-muted-foreground ml-2">{fmt(data.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {d?.yearToDate && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-foreground mb-4">Year to Date</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2">
                  <span className="text-sm text-muted-foreground">Income</span>
                  <span className="text-sm font-semibold text-success">{fmt(d.yearToDate.income)}</span>
                </div>
                <div className="flex items-center justify-between p-2">
                  <span className="text-sm text-muted-foreground">Expenses</span>
                  <span className="text-sm font-semibold text-destructive">{fmt(d.yearToDate.expenses)}</span>
                </div>
                <div className="border-t border-border/40 pt-2 flex items-center justify-between p-2">
                  <span className="text-sm font-medium text-foreground">Net Income</span>
                  <span className={`text-sm font-bold ${Number(d.yearToDate.netIncome) >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {fmt(d.yearToDate.netIncome)}
                  </span>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right: Signals */}
        <div className="xl:col-span-3 space-y-5">
          {!signalsLoading && signals.length > 0 && (
            <SignalStackPanel
              groupedSignals={groupedSignals}
              selectedSignalId={selectedSignal?.id}
              onSelectSignal={setSelectedSignal}
            />
          )}
          {!signalsLoading && signals.length === 0 && (
            <Card className="p-4">
              <p className="text-xs text-muted-foreground text-center">No active compliance alerts.</p>
            </Card>
          )}
          {selectedSignal && <SignalDetailEngine selectedSignal={selectedSignal} />}
        </div>
      </section>
    </div>
  );
};

export default FinancialIntelligenceDashboard;

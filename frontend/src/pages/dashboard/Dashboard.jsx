import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp,
  DollarSign,
  FileText,
  Receipt,
  CreditCard,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Eye,
  Shield,
  Calculator,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { Card, Button, Badge, Loading } from '../../components/common';
import { useAuthStore } from '../../store/authStore';
import { dashboardService } from '../../services';
import { formatCurrency, formatDate } from '../../utils/formatters';
import api from '../../services/api';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

const roleConfig = {
  admin: {
    label: 'Super Admin',
    color: 'red',
    icon: Shield,
    description: 'You have full access to all features and settings.',
    bgGradient: 'from-red-500 to-red-600',
  },
  sub_admin: {
    label: 'Admin',
    color: 'red',
    icon: Shield,
    description: 'You have full access to your company and employees.',
    bgGradient: 'from-red-500 to-red-600',
  },
  accountant: {
    label: 'Accountant',
    color: 'blue',
    icon: Calculator,
    description: 'You can manage invoices, expenses, and financial records.',
    bgGradient: 'from-blue-500 to-blue-600',
  },
  viewer: {
    label: 'Viewer',
    color: 'gray',
    icon: Eye,
    description: 'You have read-only access to view reports and data.',
    bgGradient: 'from-gray-500 to-gray-600',
  },
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState({
    stats: null,
    invoiceStats: null,
    expenseStats: null,
    recentInvoices: [],
    recentExpenses: [],
    revenueExpensesChart: [],
    expenseBreakdown: [],
    bankTimelineChart: [],
  });

  // Sub-admin (client company admin) gets admin-level dashboard widgets.
  const rawRole = user?.role || 'viewer';
  const userRole = rawRole;
  const currentRoleConfig = roleConfig[userRole] || roleConfig.viewer;
  const RoleIcon = currentRoleConfig.icon;

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const today = new Date();

      const [statsResp, invoiceStats, expenseStats, recentInvoices, recentExpenses] = await Promise.allSettled([
        dashboardService.getStats(),
        dashboardService.getInvoiceStats(),
        dashboardService.getExpenseStats(),
        dashboardService.getRecentInvoices(),
        dashboardService.getRecentExpenses(),
      ]);

      const stats = statsResp.status === 'fulfilled' ? statsResp.value.data.data : null;
      const dataYear = stats?.dataYear || today.getFullYear();

      const firstDayOfYear = new Date(dataYear, 0, 1);
      const lastDayOfYear = new Date(dataYear, 11, 31);
      const firstDayOfMonth = new Date(dataYear, today.getMonth(), 1);

      const [revenueExpensesChart, expenseBreakdown, bankTimeline] = await Promise.allSettled([
        api.get(`/reports/revenue-expenses-chart?year=${dataYear}`),
        api.get(`/reports/expense-breakdown?startDate=${firstDayOfYear.toISOString().split('T')[0]}&endDate=${lastDayOfYear.toISOString().split('T')[0]}`),
        dashboardService.getBankTransactionTimeline({
          startDate: firstDayOfMonth.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0],
        }),
      ]);

      setDashboardData({
        stats,
        invoiceStats: invoiceStats.status === 'fulfilled' ? invoiceStats.value.data.data : null,
        expenseStats: expenseStats.status === 'fulfilled' ? expenseStats.value.data.data : null,
        recentInvoices: recentInvoices.status === 'fulfilled' ? recentInvoices.value.data.data : [],
        recentExpenses: recentExpenses.status === 'fulfilled' ? recentExpenses.value.data.data : [],
        revenueExpensesChart: revenueExpensesChart.status === 'fulfilled' ? revenueExpensesChart.value.data.data : [],
        expenseBreakdown: expenseBreakdown.status === 'fulfilled' ? expenseBreakdown.value.data.data : [],
        bankTimelineChart: bankTimeline.status === 'fulfilled' ? bankTimeline.value.data.data : [],
      });
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const colorMap = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
    yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600' },
    green: { bg: 'bg-green-100', text: 'text-green-600' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
    gray: { bg: 'bg-gray-100', text: 'text-gray-600' },
  };

  const kpiCards = [
    {
      title: 'Total Revenue',
      value: parseFloat(dashboardData.stats?.summary?.totalRevenue || dashboardData.stats?.yearToDate?.income || 0),
      change: dashboardData.stats?.summary?.revenueChange || 0,
      changeType: (dashboardData.stats?.summary?.revenueChange || 0) >= 0 ? 'increase' : 'decrease',
      icon: DollarSign,
      color: 'blue',
    },
    {
      title: 'Total Expenses',
      value: parseFloat(dashboardData.stats?.summary?.totalExpenses || dashboardData.stats?.yearToDate?.expenses || 0),
      change: dashboardData.stats?.summary?.expenseChange || 0,
      changeType: (dashboardData.stats?.summary?.expenseChange || 0) >= 0 ? 'increase' : 'decrease',
      icon: CreditCard,
      color: 'red',
    },
    {
      title: 'Pending Invoices',
      value: (dashboardData.invoiceStats?.sent?.count || 0) + (dashboardData.invoiceStats?.partial?.count || 0),
      change: 0,
      changeType: 'decrease',
      icon: FileText,
      color: 'yellow',
      isCurrency: false,
    },
    {
      title: 'Outstanding Amount',
      value: parseFloat(dashboardData.stats?.summary?.totalOutstanding || 0) ||
             (parseFloat(dashboardData.invoiceStats?.sent?.due || 0) + parseFloat(dashboardData.invoiceStats?.partial?.due || 0)),
      change: 0,
      changeType: 'decrease',
      icon: Receipt,
      color: 'green',
    },
  ];

  const getStatusBadge = (status) => {
    const variants = {
      paid: 'success',
      approved: 'success',
      sent: 'warning',
      pending: 'warning',
      overdue: 'danger',
      draft: 'default',
      rejected: 'danger',
      recorded: 'success',
      partial: 'warning',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Welcome, {user?.name || 'User'}!</h1>
          <p className="text-muted-foreground mt-1">Here's your financial overview</p>
        </div>
        <div className="flex gap-3">
          {(userRole === 'admin' || userRole === 'accountant') && (
            <>
              <Button variant="secondary" onClick={() => navigate('/invoices/new')}>
                <Plus className="w-4 h-4 mr-2" />
                New Invoice
              </Button>
              <Button onClick={() => navigate('/expenses/new')}>
                <Plus className="w-4 h-4 mr-2" />
                New Expense
              </Button>
            </>
          )}
          {userRole === 'viewer' && (
            <Button variant="secondary" onClick={() => navigate('/reports/profit-loss')}>
              <Eye className="w-4 h-4 mr-2" />
              View Reports
            </Button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpiCards.map((kpi, index) => (
          <Card key={index} className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{kpi.title}</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {kpi.isCurrency === false
                    ? kpi.value
                    : formatCurrency(kpi.value)}
                </p>
              </div>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colorMap[kpi.color]?.bg || 'bg-gray-100'}`}>
                <kpi.icon className={`w-5 h-5 ${colorMap[kpi.color]?.text || 'text-gray-600'}`} />
              </div>
            </div>
            {kpi.change !== 0 && (
              <div className="flex items-center mt-4">
                {kpi.changeType === 'increase' ? (
                  <ArrowUpRight className="w-4 h-4 text-green-500" />
                ) : (
                  <ArrowDownRight className="w-4 h-4 text-red-500" />
                )}
                <span
                  className={`text-sm font-medium ${
                    kpi.changeType === 'increase' ? 'text-green-600' : 'text-red-600'
                  }`}
                >
                  {Math.abs(kpi.change)}%
                </span>
                <span className="text-sm text-muted-foreground ml-1">vs last month</span>
              </div>
            )}
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue vs Expenses Chart */}
        <Card>
          <Card.Title>Revenue vs Expenses</Card.Title>
          <p className="text-sm text-muted-foreground mb-4">Monthly comparison for the current year</p>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dashboardData.revenueExpensesChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(value) => formatCurrency(value)} />
              <Legend />
              <Bar dataKey="revenue" fill="#10b981" name="Revenue" />
              <Bar dataKey="expenses" fill="#ef4444" name="Expenses" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <Card.Title>Bank Transaction Timeline</Card.Title>
          <p className="text-sm text-muted-foreground mb-4">Daily credits and debits from uploaded bank statements</p>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={dashboardData.bankTimelineChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value, name) => [formatCurrency(value), name]}
                labelFormatter={(_, payload) => payload?.[0]?.payload?.date || ''}
              />
              <Legend />
              <Area type="monotone" dataKey="credits" stroke="#10b981" fill="#10b981" fillOpacity={0.25} name="Credits" />
              <Area type="monotone" dataKey="debits" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} name="Debits" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        {/* Expense Breakdown Chart */}
        <Card>
          <Card.Title>Expense Breakdown</Card.Title>
          <p className="text-sm text-muted-foreground mb-4">By category</p>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={dashboardData.expenseBreakdown}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ category, percentage }) => `${category}: ${percentage}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="amount"
              >
                {dashboardData.expenseBreakdown.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => formatCurrency(value)} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <Card padding={false}>
          <Card.Header className="flex items-center justify-between">
            <div>
              <Card.Title>Recent Invoices</Card.Title>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/invoices')}>
              View all
            </Button>
          </Card.Header>
          <div className="divide-y divide-border">
            {dashboardData.recentInvoices.length > 0 ? (
              dashboardData.recentInvoices.map((invoice) => (
                <div
                  key={invoice._id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-muted/50 cursor-pointer transition-colors duration-200"
                  onClick={() => navigate(`/invoices/${invoice._id}`)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{invoice.customerName}</p>
                      <p className="text-xs text-muted-foreground">{invoice.invoiceNumber}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(invoice.totalAmount)}
                    </p>
                    {getStatusBadge(invoice.status)}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-center text-muted-foreground">
                No recent invoices
              </div>
            )}
          </div>
        </Card>

        {/* Recent Expenses */}
        <Card padding={false}>
          <Card.Header className="flex items-center justify-between">
            <div>
              <Card.Title>Recent Expenses</Card.Title>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/expenses')}>
              View all
            </Button>
          </Card.Header>
          <div className="divide-y divide-border">
            {dashboardData.recentExpenses.length > 0 ? (
              dashboardData.recentExpenses.map((expense) => (
                <div
                  key={expense._id}
                  className="px-6 py-4 flex items-center justify-between hover:bg-muted/50 cursor-pointer transition-colors duration-200"
                  onClick={() => navigate(`/expenses/${expense._id}`)}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-success/10 rounded-lg flex items-center justify-center">
                      <Receipt className="w-5 h-5 text-success" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{expense.description}</p>
                      <p className="text-xs text-muted-foreground">{expense.category}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(expense.totalAmount)}
                    </p>
                    {getStatusBadge(expense.status)}
                  </div>
                </div>
              ))
            ) : (
              <div className="px-6 py-8 text-center text-muted-foreground">
                No recent expenses
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Quick Actions */}
      {(userRole === 'admin' || userRole === 'accountant') && (
        <Card>
          <Card.Title className="mb-4">Quick Actions</Card.Title>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => navigate('/invoices/new')}
              className="flex flex-col items-center justify-center p-4 bg-blue-50 rounded-xl hover:bg-blue-100 transition-colors"
            >
              <FileText className="w-8 h-8 text-blue-600 mb-2" />
              <span className="text-sm font-medium text-blue-900">Create Invoice</span>
            </button>
            <button
              onClick={() => navigate('/expenses/new')}
              className="flex flex-col items-center justify-center p-4 bg-green-50 rounded-xl hover:bg-green-100 transition-colors"
            >
              <Receipt className="w-8 h-8 text-green-600 mb-2" />
              <span className="text-sm font-medium text-green-900">Add Expense</span>
            </button>
            <button
              onClick={() => navigate('/journal-entries/new')}
              className="flex flex-col items-center justify-center p-4 bg-purple-50 rounded-xl hover:bg-purple-100 transition-colors"
            >
              <Plus className="w-8 h-8 text-purple-600 mb-2" />
              <span className="text-sm font-medium text-purple-900">Journal Entry</span>
            </button>
            <button
              onClick={() => navigate('/reports/profit-loss')}
              className="flex flex-col items-center justify-center p-4 bg-yellow-50 rounded-xl hover:bg-yellow-100 transition-colors"
            >
              <TrendingUp className="w-8 h-8 text-yellow-600 mb-2" />
              <span className="text-sm font-medium text-yellow-900">View Reports</span>
            </button>
          </div>
        </Card>
      )}
    </div>
  );
};

export default Dashboard;

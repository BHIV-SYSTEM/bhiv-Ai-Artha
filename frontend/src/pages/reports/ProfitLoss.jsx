import { useState, useEffect } from 'react';
import {
  Download,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ChevronDown,
  ChevronRight,
  FileText,
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
  Legend,
} from 'recharts';
import {
  PageHeader,
  Card,
  Button,
  Select,
  Loading,
} from '../../components/common';
import api, { API_BASE_URL } from '../../services/api';
import toast from 'react-hot-toast';
import { formatCurrency, getFinancialYear, exportReportPDF } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const getPeriodDates = (period, reportContext, statementMonth) => {
  if (period === 'statement_month' && statementMonth && reportContext?.availableMonths?.length) {
    const selectedMonth = reportContext.availableMonths.find(month => month.value === statementMonth);
    if (selectedMonth) {
      return {
        startDate: selectedMonth.startDate,
        endDate: selectedMonth.endDate,
      };
    }
  }

  if (reportContext?.presets?.[period]) {
    return reportContext.presets[period];
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  
  switch (period) {
    case 'current_fy':
      const fyStart = currentMonth >= 3 ? currentYear : currentYear - 1;
      return {
        startDate: `${fyStart}-04-01`,
        endDate: `${fyStart + 1}-03-31`
      };
    case 'previous_fy':
      const prevFyStart = currentMonth >= 3 ? currentYear - 1 : currentYear - 2;
      return {
        startDate: `${prevFyStart}-04-01`,
        endDate: `${prevFyStart + 1}-03-31`
      };
    case 'current_quarter':
      const quarterStart = new Date(currentYear, Math.floor(currentMonth / 3) * 3, 1);
      const quarterEnd = new Date(currentYear, Math.floor(currentMonth / 3) * 3 + 3, 0);
      return {
        startDate: quarterStart.toISOString().split('T')[0],
        endDate: quarterEnd.toISOString().split('T')[0]
      };
    case 'ytd':
      return {
        startDate: `${currentYear}-01-01`,
        endDate: now.toISOString().split('T')[0]
      };
    default:
      return {
        startDate: `${currentYear}-01-01`,
        endDate: now.toISOString().split('T')[0]
      };
  }
};

const ProfitLoss = () => {
  const can = useCan();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('current_fy');
  const [reportContext, setReportContext] = useState(null);
  const [statementMonth, setStatementMonth] = useState('');
  const [data, setData] = useState(null);
  const [expandedSections, setExpandedSections] = useState(['income', 'expenses']);

  useEffect(() => {
    fetchReportContext();
  }, []);

  useEffect(() => {
    fetchProfitLoss();
  }, [period, reportContext, statementMonth]);

  const fetchReportContext = async () => {
    try {
      const response = await api.get('/reports/period-context');
      const context = response.data?.data || null;

      setReportContext(context);

      if (context?.availableMonths?.length > 0) {
        setStatementMonth(context.availableMonths[0].value);
      }
    } catch (error) {
      console.error('Failed to fetch report context:', error);
    }
  };

  const fetchProfitLoss = async () => {
    if (period === 'statement_month' && !statementMonth && reportContext?.availableMonths?.length) {
      return;
    }

    setLoading(true);
    try {
      const { startDate, endDate } = getPeriodDates(period, reportContext, statementMonth);
      const [plResponse, chartResponse] = await Promise.all([
        api.get(`/reports/profit-loss?startDate=${startDate}&endDate=${endDate}`),
        api.get(`/reports/revenue-expenses-chart?year=${new Date(endDate).getFullYear()}`)
      ]);
      
      const rawData = plResponse.data.data;
      const chartData = chartResponse.data.data || [];
      
      // Transform backend data to frontend format
      const totalIncome = parseFloat(rawData.income?.total || 0);
      const totalExpenses = parseFloat(rawData.expenses?.total || 0);
      const ledgerIncome = parseFloat(rawData.income?.ledgerTotal || 0);
      const ledgerExpenses = parseFloat(rawData.expenses?.ledgerTotal || 0);
      const fetchedCredits = parseFloat(rawData.income?.fetchedCredits || 0);
      const fetchedDebits = parseFloat(rawData.expenses?.fetchedDebits || 0);
      const netProfit = parseFloat(rawData.netIncome || 0);
      const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
      
      setData({
        period: `${startDate} to ${endDate}`,
        income: {
          total: totalIncome,
          ledgerTotal: ledgerIncome,
          fetchedCredits,
          items: (rawData.income?.accounts || []).map(acc => ({
            name: acc.name,
            amount: parseFloat(acc.amount || 0)
          }))
        },
        expenses: {
          total: totalExpenses,
          ledgerTotal: ledgerExpenses,
          fetchedDebits,
          items: (rawData.expenses?.accounts || []).map(acc => ({
            name: acc.name,
            amount: parseFloat(acc.amount || 0)
          }))
        },
        bankFlow: {
          credits: parseFloat(rawData.bankFlow?.totalCredits || 0),
          debits: parseFloat(rawData.bankFlow?.totalDebits || 0),
          net: parseFloat(rawData.bankFlow?.netFlow || 0),
        },
        netProfit,
        profitMargin,
        monthlyData: chartData.map(item => ({
          month: item.month,
          income: item.revenue,
          expenses: item.expenses
        }))
      });
    } catch (error) {
      console.error('Failed to fetch P&L:', error);
      toast.error('Failed to load Profit & Loss report');
      setData({
        income: { total: 0, items: [] },
        expenses: { total: 0, items: [] },
        bankFlow: { credits: 0, debits: 0, net: 0 },
        netProfit: 0,
        profitMargin: 0,
        monthlyData: []
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const { startDate, endDate } = getPeriodDates(period, reportContext, statementMonth);
      await exportReportPDF(
        api,
        '/reports/profit-loss/export',
        { startDate, endDate },
        `profit-loss-${startDate}-to-${endDate}.pdf`
      );
      toast.success('Report exported successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export report. Please try again.');
    }
  };

  const periodOptions = [
    ...(reportContext?.availableMonths?.length
      ? [{ value: 'statement_month', label: 'Statement Month' }]
      : []),
    { value: 'current_fy', label: `Current FY (${reportContext?.defaultFinancialYear || getFinancialYear()})` },
    { value: 'previous_fy', label: 'Previous FY' },
    { value: 'current_quarter', label: 'Current Quarter' },
    { value: 'ytd', label: 'Year to Date' },
    ...(reportContext?.presets?.latest_statement_month
      ? [{ value: 'latest_statement_month', label: 'Latest Statement Month' }]
      : []),
  ];

  const statementMonthOptions = (reportContext?.availableMonths || []).map(month => ({
    value: month.value,
    label: month.label,
  }));

  const toggleSection = (section) => {
    setExpandedSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    );
  };

  if (loading) {
    return <Loading.Page />;
  }

  const isProfit = data?.netProfit >= 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Profit & Loss Statement"
        description="Income statement showing revenues, expenses, and profitability"
        action={
          <div className="flex items-center gap-3">
            <Select
              options={periodOptions}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-48"
            />
            {period === 'statement_month' && statementMonthOptions.length > 0 && (
              <Select
                options={statementMonthOptions}
                value={statementMonth}
                onChange={(e) => setStatementMonth(e.target.value)}
                className="w-56"
              />
            )}
            {can(['admin']) && (
              <Button variant="secondary" icon={Download} onClick={handleExport}>
                Export PDF
              </Button>
            )}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Income</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.income?.total || 0)}
              </p>
              <p className="text-xs text-muted-foreground">
                Fetched credits: {formatCurrency(data?.income?.fetchedCredits || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <TrendingDown className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Expenses</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.expenses?.total || 0)}
              </p>
              <p className="text-xs text-muted-foreground">
                Fetched debits: {formatCurrency(data?.expenses?.fetchedDebits || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isProfit ? 'bg-blue-100' : 'bg-orange-100'
            }`}>
              <DollarSign className={`w-6 h-6 ${isProfit ? 'text-blue-600' : 'text-orange-600'}`} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Net {isProfit ? 'Profit' : 'Loss'}</p>
              <p className={`text-xl font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(Math.abs(data?.netProfit || 0))}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <FileText className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Profit Margin</p>
              <p className={`text-xl font-bold ${data?.profitMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {data?.profitMargin?.toFixed(2) || 0}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Chart - Monthly Trend */}
      {data?.monthlyData?.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-foreground mb-4">Monthly Trend</h2>
          <div className="h-80">
            <ResponsiveContainer>
              <AreaChart data={data.monthlyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 12 }} />
                <YAxis
                  tick={{ fill: '#6B7280', fontSize: 12 }}
                  tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}K`}
                />
                <Tooltip
                  formatter={(value) => formatCurrency(value)}
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #E5E7EB',
                    borderRadius: '8px',
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="income"
                  name="Income"
                  stroke="#10B981"
                  fill="#D1FAE5"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  name="Expenses"
                  stroke="#EF4444"
                  fill="#FEE2E2"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Detailed Statement */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">Detailed Statement</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Income Section */}
          <div>
            <button
              onClick={() => toggleSection('income')}
              className="w-full flex items-center justify-between p-4 bg-green-50 hover:bg-green-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {expandedSections.includes('income') ? (
                  <ChevronDown className="w-5 h-5 text-green-600" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-green-600" />
                )}
                <span className="font-semibold text-green-800">Income</span>
              </div>
              <span className="font-bold text-green-800">
                {formatCurrency(data?.income?.total || 0)}
              </span>
            </button>
            {expandedSections.includes('income') && (
              <div className="border-t border-green-200">
                {data?.income?.items?.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 ml-8"
                  >
                    <span className="text-foreground">{item.name}</span>
                    <span className="font-medium text-foreground">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expenses Section */}
          <div>
            <button
              onClick={() => toggleSection('expenses')}
              className="w-full flex items-center justify-between p-4 bg-red-50 hover:bg-red-100 transition-colors border-t border-border"
            >
              <div className="flex items-center gap-2">
                {expandedSections.includes('expenses') ? (
                  <ChevronDown className="w-5 h-5 text-red-600" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-red-600" />
                )}
                <span className="font-semibold text-red-800">Expenses</span>
              </div>
              <span className="font-bold text-red-800">
                {formatCurrency(data?.expenses?.total || 0)}
              </span>
            </button>
            {expandedSections.includes('expenses') && (
              <div className="border-t border-red-200">
                {data?.expenses?.items?.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-4 py-3 border-b border-border/50 last:border-0 ml-8"
                  >
                    <span className="text-foreground">{item.name}</span>
                    <span className="font-medium text-foreground">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Net Result */}
          <div className={`flex items-center justify-between p-4 ${
            isProfit ? 'bg-blue-50' : 'bg-orange-50'
          } border-t-2 border-border`}>
            <span className={`font-bold ${isProfit ? 'text-blue-800' : 'text-orange-800'}`}>
              Net {isProfit ? 'Profit' : 'Loss'}
            </span>
            <span className={`text-xl font-bold ${isProfit ? 'text-blue-800' : 'text-orange-800'}`}>
              {formatCurrency(Math.abs(data?.netProfit || 0))}
            </span>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ProfitLoss;

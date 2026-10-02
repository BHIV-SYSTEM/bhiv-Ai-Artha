import { useState, useEffect } from 'react';
import {
  Download,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  TrendingUp,
  Building2,
  Banknote,
  Landmark,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import {
  PageHeader,
  Card,
  Button,
  Select,
  Loading,
  Badge,
} from '../../components/common';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatCurrency, getFinancialYear } from '../../utils/formatters';
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

const CashFlow = () => {
  const can = useCan();
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('current_fy');
  const [reportContext, setReportContext] = useState(null);
  const [statementMonth, setStatementMonth] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchReportContext();
  }, []);

  useEffect(() => {
    fetchCashFlow();
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

  const fetchCashFlow = async () => {
    if (period === 'statement_month' && !statementMonth && reportContext?.availableMonths?.length) {
      return;
    }

    setLoading(true);
    try {
      const { startDate, endDate } = getPeriodDates(period, reportContext, statementMonth);
      const response = await api.get(`/reports/cash-flow?startDate=${startDate}&endDate=${endDate}`);
      const rawData = response.data.data;
      
      // Transform backend data to frontend format
      const operatingTotal = parseFloat(rawData.operating?.netCashFlow || 0);
      const investingTotal = parseFloat(rawData.investing?.netCashFlow || 0);
      const financingTotal = parseFloat(rawData.financing?.netCashFlow || 0);
      const bankInflow = parseFloat(rawData.bankFlow?.totalCredits || 0);
      const bankOutflow = parseFloat(rawData.bankFlow?.totalDebits || 0);
      const bankNetFlow = parseFloat(rawData.bankFlow?.netCashFlow || 0);
      const netChange = parseFloat(rawData.netCashChange || 0);
      
      setData({
        period: `${startDate} to ${endDate}`,
        openingBalance: 0, // Backend doesn't provide this yet
        closingBalance: netChange,
        netChange,
        ledgerNetChange: parseFloat(rawData.ledgerNetCashChange || 0),
        operations: {
          total: operatingTotal,
          items: (rawData.operating?.activities || []).map(act => ({
            name: act.description || act.account,
            amount: parseFloat(act.amount || 0),
            type: parseFloat(act.amount || 0) >= 0 ? 'inflow' : 'outflow'
          }))
        },
        investing: {
          total: investingTotal,
          items: (rawData.investing?.activities || []).map(act => ({
            name: act.description || act.account,
            amount: parseFloat(act.amount || 0),
            type: parseFloat(act.amount || 0) >= 0 ? 'inflow' : 'outflow'
          }))
        },
        financing: {
          total: financingTotal,
          items: (rawData.financing?.activities || []).map(act => ({
            name: act.description || act.account,
            amount: parseFloat(act.amount || 0),
            type: parseFloat(act.amount || 0) >= 0 ? 'inflow' : 'outflow'
          }))
        },
        bankFlow: {
          total: bankNetFlow,
          inflow: bankInflow,
          outflow: bankOutflow,
          statementCount: rawData.bankFlow?.statementCount || 0,
          items: [
            { name: 'Fetched Credits', amount: bankInflow, type: 'inflow' },
            { name: 'Fetched Debits', amount: -bankOutflow, type: 'outflow' },
          ],
        },
        monthlyData: [] // Backend doesn't provide monthly breakdown yet
      });
    } catch (error) {
      console.error('Failed to fetch cash flow:', error);
      toast.error('Failed to load Cash Flow report');
      setData({
        openingBalance: 0,
        closingBalance: 0,
        netChange: 0,
        ledgerNetChange: 0,
        operations: { total: 0, items: [] },
        investing: { total: 0, items: [] },
        financing: { total: 0, items: [] },
        bankFlow: { total: 0, inflow: 0, outflow: 0, statementCount: 0, items: [] },
        monthlyData: []
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const { startDate, endDate } = getPeriodDates(period, reportContext, statementMonth);
      const response = await api.get(
        `/reports/cash-flow/export?startDate=${startDate}&endDate=${endDate}`,
        { responseType: 'blob' }
      );

      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `cash-flow-${startDate}-to-${endDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
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

  if (loading) {
    return <Loading.Page />;
  }

  const colorMap = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600' },
    red: { bg: 'bg-red-100', text: 'text-red-600' },
    yellow: { bg: 'bg-yellow-100', text: 'text-yellow-600' },
    green: { bg: 'bg-green-100', text: 'text-green-600' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600' },
    orange: { bg: 'bg-orange-100', text: 'text-orange-600' },
    gray: { bg: 'bg-gray-100', text: 'text-gray-600' },
  };

  const categories = [
    { key: 'operations', label: 'Operating Activities', icon: Building2, data: data?.operations, color: 'blue' },
    { key: 'investing', label: 'Investing Activities', icon: TrendingUp, data: data?.investing, color: 'purple' },
    { key: 'financing', label: 'Financing Activities', icon: Banknote, data: data?.financing, color: 'orange' },
    { key: 'bankFlow', label: 'Bank Statement Flow', icon: Landmark, data: data?.bankFlow, color: 'green' },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Cash Flow Statement"
        description="Movement of cash from operations, investing, and financing activities"
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
            <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Opening Balance</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.openingBalance || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              (data?.netChange || 0) >= 0 ? 'bg-green-100' : 'bg-red-100'
            }`}>
              {(data?.netChange || 0) >= 0 ? (
                <ArrowUpRight className="w-6 h-6 text-green-600" />
              ) : (
                <ArrowDownRight className="w-6 h-6 text-red-600" />
              )}
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Net Change</p>
              <p className={`text-xl font-bold ${
                (data?.netChange || 0) >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {formatCurrency(data?.netChange || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Closing Balance</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.closingBalance || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <p className="text-sm text-blue-100">Period</p>
          <p className="text-xl font-bold">{data?.period}</p>
          <p className="text-sm text-blue-200 mt-1">Cash Flow Statement</p>
        </Card>
      </div>

      {/* Monthly Chart - Hidden until backend provides monthly data */}
      {data?.monthlyData?.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold text-foreground mb-4">Monthly Cash Flow</h2>
          <div className="h-80">
            <ResponsiveContainer>
              <BarChart data={data.monthlyData}>
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
                <ReferenceLine y={0} stroke="#9CA3AF" />
                <Bar dataKey="operations" name="Operations" fill="#3B82F6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="investing" name="Investing" fill="#8B5CF6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="financing" name="Financing" fill="#F59E0B" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Activity Categories */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {categories.map((category) => (
          <Card key={category.key} className="p-6">
            <div className={`flex items-center gap-3 mb-4 pb-4 border-b border-border`}>
              <div className={`w-10 h-10 ${colorMap[category.color]?.bg || 'bg-gray-100'} rounded-lg flex items-center justify-center`}>
                <category.icon className={`w-5 h-5 ${colorMap[category.color]?.text || 'text-gray-600'}`} />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">{category.label}</h3>
              </div>
              <span className={`text-lg font-bold ${
                (category.data?.total || 0) >= 0 ? 'text-green-600' : 'text-red-600'
              }`}>
                {formatCurrency(category.data?.total || 0)}
              </span>
            </div>
            <div className="space-y-3">
              {category.data?.items?.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={item.type === 'inflow' ? 'success' : 'danger'}
                      className="text-xs"
                    >
                      {item.type === 'inflow' ? 'IN' : 'OUT'}
                    </Badge>
                    <span className={`text-sm font-medium ${
                      item.amount >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {formatCurrency(Math.abs(item.amount))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Summary */}
      <Card className="bg-muted">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">Net Cash Position</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Cash changed by {formatCurrency(Math.abs(data?.netChange || 0))} 
              {(data?.netChange || 0) >= 0 ? ' (increase)' : ' (decrease)'}
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{formatCurrency(data?.openingBalance || 0)}</span>
              <ArrowUpRight className={`w-4 h-4 ${
                (data?.netChange || 0) >= 0 ? 'text-green-500' : 'text-red-500 rotate-90'
              }`} />
              <span className="text-xl font-bold text-foreground">
                {formatCurrency(data?.closingBalance || 0)}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default CashFlow;

import { useState, useEffect } from 'react';
import {
  Download,
  Wallet,
  CreditCard,
  Scale,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import {
  PageHeader,
  Card,
  Button,
  Select,
  Loading,
} from '../../components/common';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate, exportReportPDF } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const BalanceSheet = () => {
  const can = useCan();
  const [loading, setLoading] = useState(true);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState(null);
  const [expandedSections, setExpandedSections] = useState(['assets', 'liabilities', 'equity']);

  useEffect(() => {
    loadDefaultAsOfDate();
  }, []);

  useEffect(() => {
    fetchBalanceSheet();
  }, [asOfDate]);

  const loadDefaultAsOfDate = async () => {
    try {
      const response = await api.get('/reports/period-context');
      const latestStatementDate = response.data?.data?.latestStatementDate;

      if (latestStatementDate) {
        setAsOfDate(latestStatementDate);
      }
    } catch (error) {
      console.error('Failed to fetch report context:', error);
    }
  };

  const fetchBalanceSheet = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/reports/balance-sheet?asOfDate=${asOfDate}`);
      const rawData = response.data.data;
      
      // Transform backend data to frontend format
      const totalAssets = parseFloat(rawData.assets?.total || 0);
      const totalLiabilities = parseFloat(rawData.liabilities?.total || 0);
      const totalEquity = parseFloat(rawData.equity?.total || 0);
      
      // Separate current and non-current assets (backend doesn't separate yet)
      const assetAccounts = rawData.assets?.accounts || [];
      const currentAssets = assetAccounts.filter(acc => 
        acc.code && acc.code >= '1000' && acc.code < '1800'
      );
      const nonCurrentAssets = assetAccounts.filter(acc => 
        acc.code && acc.code >= '1800'
      );
      
      // Separate current and non-current liabilities
      const liabilityAccounts = rawData.liabilities?.accounts || [];
      const currentLiabilities = liabilityAccounts.filter(acc => 
        acc.code && acc.code >= '2000' && acc.code < '2500'
      );
      const nonCurrentLiabilities = liabilityAccounts.filter(acc => 
        acc.code && acc.code >= '2500'
      );
      
      setData({
        asOfDate,
        assets: {
          total: totalAssets,
          current: {
            total: currentAssets.reduce((sum, acc) => sum + parseFloat(acc.amount || 0), 0),
            items: currentAssets.map(acc => ({
              name: acc.name,
              amount: parseFloat(acc.amount || 0)
            }))
          },
          nonCurrent: {
            total: nonCurrentAssets.reduce((sum, acc) => sum + parseFloat(acc.amount || 0), 0),
            items: nonCurrentAssets.map(acc => ({
              name: acc.name,
              amount: parseFloat(acc.amount || 0)
            }))
          }
        },
        liabilities: {
          total: totalLiabilities,
          current: {
            total: currentLiabilities.reduce((sum, acc) => sum + parseFloat(acc.amount || 0), 0),
            items: currentLiabilities.map(acc => ({
              name: acc.name,
              amount: parseFloat(acc.amount || 0)
            }))
          },
          nonCurrent: {
            total: nonCurrentLiabilities.reduce((sum, acc) => sum + parseFloat(acc.amount || 0), 0),
            items: nonCurrentLiabilities.map(acc => ({
              name: acc.name,
              amount: parseFloat(acc.amount || 0)
            }))
          }
        },
        equity: {
          total: totalEquity,
          items: (rawData.equity?.accounts || []).map(acc => ({
            name: acc.name,
            amount: parseFloat(acc.amount || 0)
          }))
        },
        isBalanced: rawData.totals?.isBalanced || false
      });
    } catch (error) {
      console.error('Failed to fetch balance sheet:', error);
      toast.error('Failed to load Balance Sheet');
      setData({
        asOfDate,
        assets: { total: 0, current: { total: 0, items: [] }, nonCurrent: { total: 0, items: [] } },
        liabilities: { total: 0, current: { total: 0, items: [] }, nonCurrent: { total: 0, items: [] } },
        equity: { total: 0, items: [] },
        isBalanced: true
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      await exportReportPDF(
        api,
        '/reports/balance-sheet/export',
        { asOfDate },
        `balance-sheet-${asOfDate}.pdf`
      );
      toast.success('Report exported successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export report. Please try again.');
    }
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section]
    );
  };

  const COLORS = ['#3B82F6', '#EF4444', '#8B5CF6'];

  if (loading) {
    return <Loading.Page />;
  }

  const chartData = [
    { name: 'Assets', value: data?.assets?.total || 0 },
    { name: 'Liabilities', value: data?.liabilities?.total || 0 },
    { name: 'Equity', value: data?.equity?.total || 0 },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Balance Sheet"
        description="Statement of financial position showing assets, liabilities, and equity"
        action={
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            {can(['admin']) && (
              <Button variant="secondary" icon={Download} onClick={handleExport}>
                Export PDF
              </Button>
            )}
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <Wallet className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Assets</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.assets?.total || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
              <CreditCard className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Liabilities</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.liabilities?.total || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <Scale className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Net Equity</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.equity?.total || 0)}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Chart and Balance Check */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Composition</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className={`p-6 ${data?.isBalanced ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <h2 className="text-lg font-semibold text-foreground mb-4">Balance Check</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Total Assets</span>
              <span className="font-bold text-foreground">{formatCurrency(data?.assets?.total || 0)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Liabilities + Equity</span>
              <span className="font-bold text-foreground">
                {formatCurrency((data?.liabilities?.total || 0) + (data?.equity?.total || 0))}
              </span>
            </div>
            <hr className="border-border" />
            <div className={`flex justify-between items-center ${
              data?.isBalanced ? 'text-green-700' : 'text-red-700'
            }`}>
              <span className="font-medium">Status</span>
              <span className="font-bold">
                {data?.isBalanced ? '✓ Balanced' : '✗ Unbalanced'}
              </span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-4">
            As of {formatDate(data?.asOfDate)}
          </p>
        </Card>
      </div>

      {/* Detailed Statement */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">Detailed Statement</h2>
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Assets Section */}
          <div>
            <button
              onClick={() => toggleSection('assets')}
              className="w-full flex items-center justify-between p-4 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {expandedSections.includes('assets') ? (
                  <ChevronDown className="w-5 h-5 text-blue-600" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-blue-600" />
                )}
                <span className="font-semibold text-blue-800">Assets</span>
              </div>
              <span className="font-bold text-blue-800">
                {formatCurrency(data?.assets?.total || 0)}
              </span>
            </button>
            {expandedSections.includes('assets') && (
              <div className="border-t border-blue-200">
                {/* Current Assets */}
                <div className="px-8 py-3 bg-muted flex justify-between">
                  <span className="font-medium text-foreground">Current Assets</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(data?.assets?.current?.total || 0)}
                  </span>
                </div>
                {data?.assets?.current?.items?.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-12 py-2.5 border-b border-border/50"
                  >
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className={`font-medium ${item.amount < 0 ? 'text-red-600' : 'text-foreground'}`}>
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                ))}
                {/* Non-Current Assets */}
                <div className="px-8 py-3 bg-muted flex justify-between border-t border-border">
                  <span className="font-medium text-foreground">Non-Current Assets</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(data?.assets?.nonCurrent?.total || 0)}
                  </span>
                </div>
                {data?.assets?.nonCurrent?.items?.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-12 py-2.5 border-b border-border/50"
                  >
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className={`font-medium ${item.amount < 0 ? 'text-red-600' : 'text-foreground'}`}>
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Liabilities Section */}
          <div className="border-t border-border">
            <button
              onClick={() => toggleSection('liabilities')}
              className="w-full flex items-center justify-between p-4 bg-red-50 hover:bg-red-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {expandedSections.includes('liabilities') ? (
                  <ChevronDown className="w-5 h-5 text-red-600" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-red-600" />
                )}
                <span className="font-semibold text-red-800">Liabilities</span>
              </div>
              <span className="font-bold text-red-800">
                {formatCurrency(data?.liabilities?.total || 0)}
              </span>
            </button>
            {expandedSections.includes('liabilities') && (
              <div className="border-t border-red-200">
                {/* Current Liabilities */}
                <div className="px-8 py-3 bg-muted flex justify-between">
                  <span className="font-medium text-foreground">Current Liabilities</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(data?.liabilities?.current?.total || 0)}
                  </span>
                </div>
                {data?.liabilities?.current?.items?.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-12 py-2.5 border-b border-border/50"
                  >
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className="font-medium text-foreground">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
                {/* Non-Current Liabilities */}
                <div className="px-8 py-3 bg-muted flex justify-between border-t border-border">
                  <span className="font-medium text-foreground">Non-Current Liabilities</span>
                  <span className="font-medium text-foreground">
                    {formatCurrency(data?.liabilities?.nonCurrent?.total || 0)}
                  </span>
                </div>
                {data?.liabilities?.nonCurrent?.items?.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-12 py-2.5 border-b border-border/50"
                  >
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className="font-medium text-foreground">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Equity Section */}
          <div className="border-t border-border">
            <button
              onClick={() => toggleSection('equity')}
              className="w-full flex items-center justify-between p-4 bg-purple-50 hover:bg-purple-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                {expandedSections.includes('equity') ? (
                  <ChevronDown className="w-5 h-5 text-purple-600" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-purple-600" />
                )}
                <span className="font-semibold text-purple-800">Equity</span>
              </div>
              <span className="font-bold text-purple-800">
                {formatCurrency(data?.equity?.total || 0)}
              </span>
            </button>
            {expandedSections.includes('equity') && (
              <div className="border-t border-purple-200">
                {data?.equity?.items?.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-8 py-3 border-b border-border/50"
                  >
                    <span className="text-muted-foreground">{item.name}</span>
                    <span className="font-medium text-foreground">{formatCurrency(item.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default BalanceSheet;

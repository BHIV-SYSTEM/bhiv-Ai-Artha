import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Clock,
  AlertTriangle,
  AlertCircle,
  DollarSign,
  User,
  Filter,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  PageHeader,
  Card,
  Button,
  Table,
  Badge,
  Select,
  Loading,
  EmptyState,
} from '../../components/common';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate } from '../../utils/formatters';

const AgedReceivables = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetchAgedReceivables();
  }, []);

  const fetchAgedReceivables = async () => {
    setLoading(true);
    try {
      const asOfDate = new Date().toISOString().split('T')[0];
      const response = await api.get(`/reports/aged-receivables?asOfDate=${asOfDate}`);
      const rawData = response.data.data;
      
      // Parse backend response
      const totals = rawData.totals || {};
      const customers = (rawData.customers || []).map(customer => ({
        _id: customer.customerName,
        name: customer.customerName,
        email: customer.customerEmail,
        total: parseFloat(customer.totalDue || 0),
        current: parseFloat(customer.aging?.current || 0),
        days1_30: parseFloat(customer.aging?.['1-30'] || 0),
        days31_60: parseFloat(customer.aging?.['31-60'] || 0),
        days61_90: parseFloat(customer.aging?.['61-90'] || 0),
        over90: parseFloat(customer.aging?.['90+'] || 0),
        invoices: (customer.invoices || []).map(inv => ({
          number: inv.invoiceNumber,
          amount: parseFloat(inv.amountDue || 0),
          dueDate: inv.dueDate,
          daysOverdue: inv.daysOverdue || 0,
        })),
      }));
      
      setData({
        summary: {
          total: parseFloat(totals.total || 0),
          current: parseFloat(totals.current || 0),
          days1_30: parseFloat(totals['1-30'] || 0),
          days31_60: parseFloat(totals['31-60'] || 0),
          days61_90: parseFloat(totals['61-90'] || 0),
          over90: parseFloat(totals['90+'] || 0),
        },
        customers,
      });
    } catch (error) {
      console.error('Failed to fetch aged receivables:', error);
      toast.error('Failed to load Aged Receivables');
      setData({
        summary: {
          total: 0,
          current: 0,
          days1_30: 0,
          days31_60: 0,
          days61_90: 0,
          over90: 0,
        },
        customers: [],
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!filteredCustomers.length) {
      toast.error('No data to export');
      return;
    }
    try {
      const asOfDate = new Date().toISOString().split('T')[0];
      const header = ['Customer', 'Email', 'Total Outstanding', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];
      const rows = filteredCustomers.map((c) => [
        c.name,
        c.email || '',
        c.total,
        c.current,
        c.days1_30,
        c.days31_60,
        c.days61_90,
        c.over90,
      ]);
      const csv = [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `aged-receivables-${asOfDate}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('Report exported as CSV');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error('Failed to export report. Please try again.');
    }
  };

  const agingBuckets = [
    { key: 'current', label: 'Current', color: '#10B981' },
    { key: 'days1_30', label: '1-30 Days', color: '#3B82F6' },
    { key: 'days31_60', label: '31-60 Days', color: '#F59E0B' },
    { key: 'days61_90', label: '61-90 Days', color: '#F97316' },
    { key: 'over90', label: '90+ Days', color: '#EF4444' },
  ];

  const chartData = agingBuckets.map((bucket) => ({
    name: bucket.label,
    value: data?.summary?.[bucket.key] || 0,
    color: bucket.color,
  }));

  const filterOptions = [
    { value: 'all', label: 'All Customers' },
    { value: 'overdue', label: 'Overdue Only' },
    { value: 'over90', label: '90+ Days Overdue' },
  ];

  const filteredCustomers = data?.customers?.filter((customer) => {
    if (filter === 'overdue') {
      return customer.days1_30 + customer.days31_60 + customer.days61_90 + customer.over90 > 0;
    }
    if (filter === 'over90') {
      return customer.over90 > 0;
    }
    return true;
  }) || [];

  const getAgingBadge = (daysOverdue) => {
    if (daysOverdue === 0) return <Badge variant="success">Current</Badge>;
    if (daysOverdue <= 30) return <Badge variant="info">{daysOverdue} days</Badge>;
    if (daysOverdue <= 60) return <Badge variant="warning">{daysOverdue} days</Badge>;
    if (daysOverdue <= 90) return <Badge variant="purple">{daysOverdue} days</Badge>;
    return <Badge variant="danger">{daysOverdue} days</Badge>;
  };

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Aged Receivables"
        description="Track outstanding customer invoices by aging buckets"
        action={
          <Button variant="secondary" icon={Download} onClick={handleExport}>
            Export CSV
          </Button>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card className="p-4 md:col-span-1">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-bold text-foreground">
                {formatCurrency(data?.summary?.total || 0)}
              </p>
            </div>
          </div>
        </Card>

        {agingBuckets.map((bucket) => (
          <Card key={bucket.key} className="p-4">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-10 rounded"
                style={{ backgroundColor: bucket.color }}
              />
              <div>
                <p className="text-xs text-muted-foreground">{bucket.label}</p>
                <p className="text-lg font-bold text-foreground">
                  {formatCurrency(data?.summary?.[bucket.key] || 0)}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Chart */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">Aging Distribution</h2>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
              <XAxis
                type="number"
                tick={{ fill: '#6B7280', fontSize: 12 }}
                tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}K`}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fill: '#6B7280', fontSize: 12 }}
                width={80}
              />
              <Tooltip
                formatter={(value) => formatCurrency(value)}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Customer Filter */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-muted-foreground" />
          <Select
            options={filterOptions}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-48"
          />
          <span className="text-sm text-muted-foreground">
            Showing {filteredCustomers.length} customers
          </span>
        </div>
      </Card>

      {/* Customer Details */}
      {filteredCustomers.length === 0 ? (
        <Card>
          <EmptyState
            icon={DollarSign}
            title="No receivables found"
            description="All invoices are paid or no customers match the current filter."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredCustomers.map((customer) => (
            <Card key={customer._id} padding={false}>
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
                    <User className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">{customer.name}</h3>
                    <p className="text-sm text-muted-foreground">{customer.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">Total Outstanding</p>
                    <p className="text-xl font-bold text-foreground">
                      {formatCurrency(customer.total)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Aging Breakdown */}
              <div className="p-4 bg-muted grid grid-cols-5 gap-2 text-center">
                {agingBuckets.map((bucket) => (
                  <div key={bucket.key}>
                    <p className="text-xs text-muted-foreground">{bucket.label}</p>
                    <p
                      className="font-semibold"
                      style={{ color: customer[bucket.key] > 0 ? bucket.color : '#9CA3AF' }}
                    >
                      {formatCurrency(customer[bucket.key] || 0)}
                    </p>
                  </div>
                ))}
              </div>

              {/* Invoice List */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted border-y border-border">
                    <tr>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Invoice #</th>
                      <th className="text-left py-2 px-4 font-medium text-muted-foreground">Due Date</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Amount</th>
                      <th className="text-center py-2 px-4 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {customer.invoices?.map((invoice, idx) => (
                      <tr key={idx} className="hover:bg-muted/50">
                        <td className="py-2.5 px-4">
                          <button
                            onClick={() => navigate(`/invoices/${invoice.number}`)}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {invoice.number}
                          </button>
                        </td>
                        <td className="py-2.5 px-4 text-muted-foreground">
                          {formatDate(invoice.dueDate)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono">
                          {formatCurrency(invoice.amount)}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          {getAgingBadge(invoice.daysOverdue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AgedReceivables;

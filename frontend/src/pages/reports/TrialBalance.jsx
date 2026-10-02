import { useState, useEffect } from 'react';
import {
  Download,
  CheckCircle,
  AlertTriangle,
  ArrowUpDown,
} from 'lucide-react';
import {
  PageHeader,
  Card,
  Button,
  Table,
  Badge,
  Loading,
} from '../../components/common';
import api from '../../services/api';
import toast from 'react-hot-toast';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const TrialBalance = () => {
  const can = useCan();
  const [loading, setLoading] = useState(true);
  const [asOfDate, setAsOfDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState(null);
  const [sortField, setSortField] = useState('code');
  const [sortDirection, setSortDirection] = useState('asc');

  useEffect(() => {
    loadDefaultAsOfDate();
  }, []);

  useEffect(() => {
    fetchTrialBalance();
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

  const fetchTrialBalance = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/reports/trial-balance?asOfDate=${asOfDate}`);
      const rawData = response.data.data;
      
      // Parse the backend response
      const accounts = (rawData.accounts || []).map(acc => ({
        code: acc.code,
        name: acc.name,
        type: acc.type,
        debit: parseFloat(acc.debit || 0),
        credit: parseFloat(acc.credit || 0),
      }));
      
      setData({
        asOfDate: rawData.asOfDate,
        isBalanced: rawData.totals?.isBalanced || false,
        totalDebits: parseFloat(rawData.totals?.debit || 0),
        totalCredits: parseFloat(rawData.totals?.credit || 0),
        accounts,
        summary: rawData.summary || {},
      });
    } catch (error) {
      console.error('Failed to fetch trial balance:', error);
      toast.error('Failed to load Trial Balance');
      setData({
        asOfDate: asOfDate,
        isBalanced: true,
        totalDebits: 0,
        totalCredits: 0,
        accounts: [],
        summary: {},
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const response = await api.get(
        `/reports/trial-balance/export?asOfDate=${asOfDate}`,
        { responseType: 'blob' }
      );

      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `trial-balance-${asOfDate}.pdf`;
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

  const getTypeColor = (type) => {
    const colors = {
      Assets: 'blue',
      Liabilities: 'red',
      Equity: 'purple',
      Income: 'green',
      Expense: 'orange',
    };
    return colors[type] || 'gray';
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedAccounts = [...(data?.accounts || [])].sort((a, b) => {
    let comparison = 0;
    if (sortField === 'code') {
      comparison = a.code.localeCompare(b.code);
    } else if (sortField === 'name') {
      comparison = a.name.localeCompare(b.name);
    } else if (sortField === 'type') {
      comparison = a.type.localeCompare(b.type);
    } else if (sortField === 'debit') {
      comparison = a.debit - b.debit;
    } else if (sortField === 'credit') {
      comparison = a.credit - b.credit;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Trial Balance"
        description="Verify that debits equal credits across all accounts"
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

      {/* Balance Status */}
      <Card className={`p-6 ${
        data?.isBalanced 
          ? 'bg-green-50 border-green-200' 
          : 'bg-red-50 border-red-200'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {data?.isBalanced ? (
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            ) : (
              <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
            )}
            <div>
              <h2 className={`text-lg font-bold ${
                data?.isBalanced ? 'text-green-800' : 'text-red-800'
              }`}>
                {data?.isBalanced ? 'Trial Balance is Balanced' : 'Trial Balance is NOT Balanced'}
              </h2>
              <p className={`text-sm ${data?.isBalanced ? 'text-green-600' : 'text-red-600'}`}>
                As of {formatDate(data?.asOfDate)}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className="text-sm text-muted-foreground">Total Debits</p>
                <p className="text-xl font-bold text-foreground">
                  {formatCurrency(data?.totalDebits || 0)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Credits</p>
                <p className="text-xl font-bold text-foreground">
                  {formatCurrency(data?.totalCredits || 0)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Trial Balance Table */}
      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted border-b border-border">
              <tr>
                <th
                  className="text-left py-4 px-6 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:bg-muted"
                  onClick={() => handleSort('code')}
                >
                  <div className="flex items-center gap-1">
                    Code
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="text-left py-4 px-6 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:bg-muted"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Account Name
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="text-left py-4 px-6 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:bg-muted"
                  onClick={() => handleSort('type')}
                >
                  <div className="flex items-center gap-1">
                    Type
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="text-right py-4 px-6 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:bg-muted"
                  onClick={() => handleSort('debit')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Debit
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th
                  className="text-right py-4 px-6 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:bg-muted"
                  onClick={() => handleSort('credit')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Credit
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedAccounts.map((account, idx) => (
                <tr key={idx} className="hover:bg-muted/50">
                  <td className="py-3 px-6 font-mono text-sm text-muted-foreground">
                    {account.code}
                  </td>
                  <td className="py-3 px-6 font-medium text-foreground">
                    {account.name}
                  </td>
                  <td className="py-3 px-6">
                    <Badge variant={getTypeColor(account.type)}>
                      {account.type}
                    </Badge>
                  </td>
                  <td className="py-3 px-6 text-right font-mono">
                    {account.debit > 0 ? formatCurrency(account.debit) : '-'}
                  </td>
                  <td className="py-3 px-6 text-right font-mono">
                    {account.credit !== 0 ? (
                      <span className={account.credit < 0 ? 'text-red-600' : ''}>
                        {formatCurrency(Math.abs(account.credit))}
                        {account.credit < 0 && ' (Dr)'}
                      </span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-muted border-t-2 border-border">
              <tr>
                <td colSpan={3} className="py-4 px-6 font-bold text-foreground">
                  TOTAL
                </td>
                <td className="py-4 px-6 text-right font-mono font-bold text-foreground">
                  {formatCurrency(data?.totalDebits || 0)}
                </td>
                <td className="py-4 px-6 text-right font-mono font-bold text-foreground">
                  {formatCurrency(data?.totalCredits || 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* Account Type Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {['Asset', 'Liability', 'Equity', 'Income', 'Expense'].map((type) => {
          const summary = data?.summary?.[type] || { debit: '0', credit: '0' };
          const totalDebit = parseFloat(summary.debit || 0);
          const totalCredit = parseFloat(summary.credit || 0);
          
          return (
            <Card key={type} className="p-4 text-center">
              <Badge variant={getTypeColor(type)} className="mb-2">{type}</Badge>
              <p className="text-xs text-muted-foreground mt-2">
                Dr: {formatCurrency(totalDebit)}
              </p>
              <p className="text-xs text-muted-foreground">
                Cr: {formatCurrency(totalCredit)}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default TrialBalance;

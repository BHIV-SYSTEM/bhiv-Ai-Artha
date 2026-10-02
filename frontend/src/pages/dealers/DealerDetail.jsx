import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Phone, Mail, IndianRupee, Clock, FileText, Edit, Receipt } from 'lucide-react';
import { PageHeader, Card, Button, Badge, Loading } from '../../components/common';
import api from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const DealerDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSummary();
  }, [id]);

  const fetchSummary = async () => {
    try {
      const res = await api.get(`/dealers/${id}/summary`);
      setSummary(res.data.data);
    } catch (err) {
      console.error('Failed to fetch dealer summary:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Loading.Page />;
  if (!summary) return <div className="p-8 text-center">Dealer not found</div>;

  const { dealer, outstanding, recentVouchers, stats } = summary;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title={dealer.name}
        description={`${dealer.dealerCode} - ${dealer.city || 'No city'}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/dealers')} icon={ArrowLeft}>Back</Button>
            <Button variant="outline" onClick={() => navigate(`/dealers/${id}/statement`)} icon={Receipt}>Statement</Button>
            {can(['admin', 'accountant']) && (
              <Button onClick={() => navigate(`/dealers/${id}/edit`)} icon={Edit}>Edit</Button>
            )}
          </div>
        }
      />

      {/* Dealer Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Dealer Information</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-4 h-4 text-muted-foreground" />
              <span>{dealer.phone || 'No phone'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <span>{dealer.email || 'No email'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              <span>{dealer.address || dealer.city || 'No address'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <span>GSTIN: {dealer.gstin || 'N/A'}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Financial Summary</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Outstanding</span>
              <span className="font-semibold">{formatCurrency(outstanding.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Overdue</span>
              <span className="font-semibold text-red-600">{formatCurrency(outstanding.overdueAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Credit Limit</span>
              <span className="font-semibold">{formatCurrency(dealer.creditLimit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Bills</span>
              <span>{stats.totalBills}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Overdue Bills</span>
              <span className="text-red-600">{stats.overdueBills}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Visit Info</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Visits</span>
              <span>{dealer.visits || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Last Visit</span>
              <span>{stats.lastBillingDate ? formatDate(stats.lastBillingDate) : 'Never'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Last Payment</span>
              <span>{stats.lastPaymentDate ? formatDate(stats.lastPaymentDate) : 'None'}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Outstanding Bills */}
      {outstanding.bills.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">Outstanding Bills ({outstanding.bills.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Bill No</th>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Due Date</th>
                  <th className="text-right p-2">Amount</th>
                  <th className="text-right p-2">Balance</th>
                  <th className="text-center p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.bills.map((bill, i) => (
                  <tr key={i} className="border-b hover:bg-muted/50">
                    <td className="p-2 font-medium">{bill.billNo || bill.billName || '-'}</td>
                    <td className="p-2">{bill.billDate || '-'}</td>
                    <td className="p-2">{bill.dueDate || '-'}</td>
                    <td className="p-2 text-right">{formatCurrency(bill.amount)}</td>
                    <td className="p-2 text-right font-semibold">{formatCurrency(bill.balance)}</td>
                    <td className="p-2 text-center">
                      {bill.dueDate && new Date(bill.dueDate) < new Date() ? (
                        <Badge variant="danger">Overdue</Badge>
                      ) : (
                        <Badge variant="success">Current</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Recent Vouchers */}
      {recentVouchers.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Number</th>
                  <th className="text-left p-2">Date</th>
                  <th className="text-right p-2">Amount</th>
                  <th className="text-left p-2">Narration</th>
                </tr>
              </thead>
              <tbody>
                {recentVouchers.map((v, i) => (
                  <tr key={i} className="border-b hover:bg-muted/50">
                    <td className="p-2">
                      <Badge variant={v.voucherType === 'Receipt' ? 'success' : v.voucherType === 'Payment' ? 'warning' : 'info'}>
                        {v.voucherType}
                      </Badge>
                    </td>
                    <td className="p-2 font-medium">{v.voucherNumber || '-'}</td>
                    <td className="p-2">{v.date || '-'}</td>
                    <td className="p-2 text-right">{formatCurrency(v.amount)}</td>
                    <td className="p-2 text-muted-foreground truncate max-w-xs">{v.narration || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default DealerDetail;

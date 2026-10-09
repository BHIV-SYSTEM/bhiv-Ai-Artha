import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, Clock, ArrowUpRight, ArrowDownRight, FileText, Download, Zap, Link2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { bankStatementService } from '../../services';
import { PageHeader, Card, Button } from '../../components/common';
import { useCan } from '../../utils/permissions';

const StatementDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = useCan();
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTransactions, setSelectedTransactions] = useState([]);
  const [creatingExpenses, setCreatingExpenses] = useState(false);

  const loadStatement = async () => {
    try {
      setLoading(true);
      const response = await bankStatementService.getById(id);
      setStatement(response.data.data || response.data);
    } catch (error) {
      console.error('Error loading statement:', error);
      toast.error(error.response?.data?.message || 'Failed to load statement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatement();
  }, [id]);

  const handleMatchTransactions = async () => {
    try {
      await bankStatementService.matchTransactions(id);
      toast.success('Transactions matched successfully');
      loadStatement();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to match transactions');
    }
  };

  const handleCreateExpenses = async () => {
    if (selectedTransactions.length === 0) {
      toast.error('Please select at least one transaction');
      return;
    }

    setCreatingExpenses(true);
    try {
      await bankStatementService.createExpenses(id, selectedTransactions);
      toast.success(`Created ${selectedTransactions.length} expenses successfully`);
      setSelectedTransactions([]);
      loadStatement();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create expenses');
    } finally {
      setCreatingExpenses(false);
    }
  };

  const toggleTransactionSelection = (txnId) => {
    setSelectedTransactions(prev =>
      prev.includes(txnId)
        ? prev.filter(id => id !== txnId)
        : [...prev, txnId]
    );
  };

  const selectAllUnmatched = () => {
    const unmatchedIds = statement.transactions
      .filter(t => !t.matched && t.type === 'debit')
      .map(t => t._id);
    setSelectedTransactions(unmatchedIds);
  };

  const clearSelection = () => {
    setSelectedTransactions([]);
  };

  const handleDeleteStatement = async () => {
    const confirmed = window.confirm(
      `Delete statement ${statement.statementNumber} permanently? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      await bankStatementService.delete(id);
      toast.success('Statement deleted permanently');
      navigate('/statements');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete statement');
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'processing':
        return <Clock className="w-5 h-5 text-blue-600" />;
      case 'failed':
        return <XCircle className="w-5 h-5 text-red-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
    }).format(amount);
  };

  if (loading || !statement) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Statement ${statement.statementNumber}`}
        description={`${statement.bankName} - ${statement.accountHolderName}`}
        actions={
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate('/statements')}>
              Back to Statements
            </Button>
            {can(['admin']) && (
              <Button
                variant="outline"
                onClick={handleDeleteStatement}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Permanently
              </Button>
            )}
            {statement.status === 'completed' && can(['admin', 'accountant']) && (
              <>
                <Button variant="outline" onClick={handleMatchTransactions}>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Match Transactions
                </Button>
                <Button
                  onClick={handleCreateExpenses}
                  disabled={selectedTransactions.length === 0 || creatingExpenses}
                >
                  {creatingExpenses ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4 mr-2" />
                      Create Expenses ({selectedTransactions.length})
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Statement Info */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-sm text-gray-600 mb-1">Bank</div>
          <div className="text-lg font-semibold">{statement.bankName}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600 mb-1">Account Number</div>
          <div className="text-lg font-semibold">
            {statement.accountNumber 
              ? statement.accountNumber.slice(-4).padStart(statement.accountNumber.length, '*')
              : 'N/A'
            }
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600 mb-1">Period</div>
          <div className="text-lg font-semibold">
            {formatDate(statement.startDate)} - {formatDate(statement.endDate)}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-gray-600 mb-1">Status</div>
          <div className="flex items-center gap-2">
            {getStatusIcon(statement.status)}
            <span className="text-lg font-semibold capitalize">{statement.status}</span>
          </div>
        </Card>
      </div>

      {/* Balance Summary */}
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-4">Balance Summary</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="text-sm text-gray-600 mb-1">Opening Balance</div>
            <div className="text-2xl font-bold">{formatCurrency(statement.openingBalance)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Total Debits</div>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(statement.totalDebits)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Total Credits</div>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(statement.totalCredits)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Closing Balance</div>
            <div className="text-2xl font-bold">{formatCurrency(statement.closingBalance)}</div>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Transactions</div>
            <div className="text-2xl font-bold">{statement.transactionCount}</div>
          </div>
        </div>
      </Card>

      {/* Auto-Reconciliation Summary */}
      {statement.status === 'completed' && statement.reconciliation?.reconciledAt && (
        <Card className="p-4 border-green-200 bg-green-50">
          <div className="flex items-start gap-3">
            <Zap className="w-6 h-6 text-green-600 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="font-semibold text-green-800 mb-2">Auto-Reconciliation Complete</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-green-700">Matched Expenses</span>
                  <p className="text-lg font-bold text-green-900">{statement.reconciliation.matchedExpenses || 0}</p>
                </div>
                <div>
                  <span className="text-green-700">Matched Invoices</span>
                  <p className="text-lg font-bold text-green-900">{statement.reconciliation.matchedInvoices || 0}</p>
                </div>
                <div>
                  <span className="text-green-700">Auto-Created Expenses</span>
                  <p className="text-lg font-bold text-green-900">{statement.reconciliation.autoCreatedExpenses || 0}</p>
                </div>
                <div>
                  <span className="text-green-700">Journal Entries</span>
                  <p className="text-lg font-bold text-green-900">{statement.reconciliation.journalEntriesCreated || 0}</p>
                </div>
              </div>
              <p className="text-xs text-green-600 mt-2">
                Reconciled at {new Date(statement.reconciliation.reconciledAt).toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Transactions */}
      {statement.status === 'completed' && (
        <Card>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Transactions</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={selectAllUnmatched}>
                Select All Unmatched
              </Button>
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Clear Selection
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedTransactions.length > 0}
                      onChange={(e) => e.target.checked ? selectAllUnmatched() : clearSelection()}
                      className="rounded border-gray-300 text-primary focus:ring-primary"
                    />
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Matched</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {statement.transactions.map((transaction) => (
                  <tr
                    key={transaction._id}
                    className={`hover:bg-gray-50 ${transaction.matched ? 'bg-green-50' : ''}`}
                  >
                    <td className="px-6 py-4">
                      {!transaction.matched && transaction.type === 'debit' && (
                        <input
                          type="checkbox"
                          checked={selectedTransactions.includes(transaction._id)}
                          onChange={() => toggleTransactionSelection(transaction._id)}
                          className="rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(transaction.date)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">
                      {transaction.description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {transaction.reference || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {transaction.type === 'debit' ? (
                        <ArrowDownRight className="w-4 h-4 text-red-600" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4 text-green-600" />
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`text-sm font-medium ${
                        transaction.type === 'debit' ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {transaction.type === 'debit'
                          ? formatCurrency(transaction.debit)
                          : formatCurrency(transaction.credit)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 capitalize">
                      {transaction.category || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {transaction.matched ? (
                        <div className="flex items-center gap-1">
                          <CheckCircle className="w-5 h-5 text-green-600" />
                          {transaction.autoCreated && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Auto</span>
                          )}
                          {transaction.matchedInvoiceId && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                              <Link2 className="w-3 h-3" />
                              Invoice
                            </span>
                          )}
                          {transaction.matchedExpenseId && !transaction.autoCreated && (
                            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Expense</span>
                          )}
                        </div>
                      ) : (
                        <Clock className="w-5 h-5 text-gray-400" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Processing Error */}
      {statement.status === 'failed' && statement.processingError && (
        <Card className="p-4 border-red-200 bg-red-50">
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 text-red-600 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-red-800">Processing Failed</h3>
              <p className="text-sm text-red-700 mt-1">{statement.processingError}</p>
              <p className="text-sm text-red-700 mt-2">
                Please ensure your file is in CSV format and try again, or contact support.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};

export default StatementDetail;

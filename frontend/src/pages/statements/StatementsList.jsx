import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileText, CheckCircle, XCircle, Clock, AlertCircle, Trash2, Eye, Download, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { bankStatementService } from '../../services';
import { PageHeader, Card, Button } from '../../components/common';
import { useCan } from '../../utils/permissions';

const Statements = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 1,
  });
  const [filters, setFilters] = useState({
    status: '',
    dateFrom: '',
    dateTo: '',
  });

  const loadStatements = async () => {
    try {
      setLoading(true);
      const response = await bankStatementService.getAll({
        ...filters,
        ...pagination,
      });

      setStatements(response.data.data || []);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error('Error loading statements:', error);
      toast.error(error.response?.data?.message || 'Failed to load statements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatements();
  }, [filters, pagination.page]);

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

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const handleProcessStatement = async (id) => {
    try {
      await bankStatementService.process(id);
      toast.success('Statement processing started');
      loadStatements();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to process statement');
    }
  };

  const handleMatchTransactions = async (id) => {
    try {
      await bankStatementService.matchTransactions(id);
      toast.success('Transactions matched successfully');
      loadStatements();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to match transactions');
    }
  };

  const handleViewStatement = (id) => {
    navigate(`/statements/${id}`);
  };

  const handleDeleteStatement = async (id, statementNumber) => {
    const confirmed = window.confirm(
      `Delete statement ${statementNumber} permanently? This cannot be undone.`,
    );
    if (!confirmed) return;

    try {
      await bankStatementService.delete(id);
      toast.success('Statement deleted permanently');
      loadStatements();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete statement');
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bank Statements"
        description="Upload and manage your bank account statements"
        actions={
          can(['admin', 'accountant']) && (
            <Button onClick={() => navigate('/statements/upload')}>
              <Upload className="w-4 h-4 mr-2" />
              Upload Statement
            </Button>
          )
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              From Date
            </label>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              To Date
            </label>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={loadStatements}
              className="w-full"
            >
              Apply Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Statements List */}
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Statement #
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Bank
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Account
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Period
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Transactions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Debits
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Credits
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  </td>
                </tr>
              ) : statements.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-8 text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                    <p>No statements uploaded yet</p>
                    {can(['admin', 'accountant']) && (
                      <Button
                        variant="link"
                        onClick={() => navigate('/statements/upload')}
                        className="mt-2"
                      >
                        Upload your first statement
                      </Button>
                    )}
                  </td>
                </tr>
              ) : (
                statements.map((statement) => (
                  <tr key={statement._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {statement.statementNumber}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {statement.bankName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {statement.accountNumber 
                        ? statement.accountNumber.slice(-4).padStart(statement.accountNumber.length, '*')
                        : 'N/A'
                      }
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDate(statement.startDate)} - {formatDate(statement.endDate)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {statement.transactionCount}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                      {formatCurrency(statement.totalDebits)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                      {formatCurrency(statement.totalCredits)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(statement.status)}
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(statement.status)}`}>
                          {statement.status}
                        </span>
                        {statement.reconciliation?.reconciledAt && (
                          <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700" title="Auto-reconciled">
                            <Zap className="w-3 h-3" />
                            Reconciled
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleViewStatement(statement._id)}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {statement.status === 'pending' && can(['admin', 'accountant']) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleProcessStatement(statement._id)}
                          >
                            Process
                          </Button>
                        )}
                        {statement.status === 'completed' && can(['admin', 'accountant']) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleMatchTransactions(statement._id)}
                          >
                            Match
                          </Button>
                        )}
                        {can(['admin']) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteStatement(statement._id, statement.statementNumber)}
                            className="text-red-600 border-red-200 hover:bg-red-50"
                            title="Delete permanently"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-gray-700">
              Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} entries
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                disabled={pagination.page === 1}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                disabled={pagination.page === pagination.pages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default Statements;

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Filter,
  Download,
  Receipt,
  Eye,
  Edit,
  CheckCircle,
  XCircle,
  Clock,
  ExternalLink,
} from 'lucide-react';
import {
  PageHeader,
  Card,
  Button,
  Table,
  Badge,
  Input,
  Select,
  Loading,
  EmptyState,
} from '../../components/common';
import api from '../../services/api';
import { downloadCsv } from '../../utils/csv';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const ExpenseList = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  useEffect(() => {
    fetchExpenses();
  }, []);

  const fetchExpenses = async () => {
    try {
      const response = await api.get('/expenses');
      setExpenses(response.data.data || []);
    } catch (error) {
      console.error('Failed to fetch expenses:', error);
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const config = {
      pending: { variant: 'warning', icon: Clock },
      approved: { variant: 'success', icon: CheckCircle },
      rejected: { variant: 'danger', icon: XCircle },
      recorded: { variant: 'info', icon: Receipt },
    };
    const { variant, icon: Icon } = config[status] || config.pending;
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {status}
      </Badge>
    );
  };

  const getCategoryColor = (category) => {
    const colors = {
      Operations: 'bg-blue-100 text-blue-800',
      IT: 'bg-purple-100 text-purple-800',
      Travel: 'bg-green-100 text-green-800',
      Entertainment: 'bg-yellow-100 text-yellow-800',
      HR: 'bg-pink-100 text-pink-800',
      Marketing: 'bg-orange-100 text-orange-800',
    };
    return colors[category] || 'bg-muted text-foreground';
  };

  const filteredExpenses = expenses.filter((expense) => {
    const matchesSearch =
      expense.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      expense.vendor?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !statusFilter || expense.status === statusFilter;
    const matchesCategory = !categoryFilter || expense.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  });

  const statusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'recorded', label: 'Recorded' },
  ];

  const categoryOptions = [
    { value: 'Operations', label: 'Operations' },
    { value: 'IT', label: 'IT' },
    { value: 'Travel', label: 'Travel' },
    { value: 'Entertainment', label: 'Entertainment' },
    { value: 'HR', label: 'HR' },
    { value: 'Marketing', label: 'Marketing' },
  ];

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Expenses"
        description="Track and manage your business expenses"
        action={
          can(['admin', 'accountant']) && (
            <Button onClick={() => navigate('/expenses/new')} icon={Plus}>
              Add Expense
            </Button>
          )
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search expenses..."
              icon={Search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="w-full md:w-40">
            <Select
              placeholder="All Status"
              options={statusOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            />
          </div>
          <div className="w-full md:w-40">
            <Select
              placeholder="All Categories"
              options={categoryOptions}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            icon={Download}
            onClick={() => {
              if (!filteredExpenses.length) return;
              downloadCsv(
                `expenses-${new Date().toISOString().split('T')[0]}`,
                ['Description', 'Category', 'Vendor', 'Amount', 'Status', 'Date', 'Submitted By'],
                filteredExpenses.map((exp) => [
                  exp.description || '',
                  exp.category || '',
                  exp.vendor || '',
                  exp.totalAmount ?? exp.amount ?? '',
                  exp.status,
                  exp.date || '',
                  exp.submittedBy?.name || '',
                ])
              );
            }}
          >
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Expense Table */}
      {filteredExpenses.length === 0 ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="No expenses found"
            description="Start tracking your business expenses by adding your first expense."
            actionLabel={can(['admin', 'accountant']) ? 'Add Expense' : undefined}
            onAction={can(['admin', 'accountant']) ? () => navigate('/expenses/new') : undefined}
          />
        </Card>
      ) : (
        <Card padding={false}>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Description</Table.Head>
                <Table.Head>Category</Table.Head>
                <Table.Head>Vendor</Table.Head>
                <Table.Head>Amount</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Source</Table.Head>
                <Table.Head>Date</Table.Head>
                <Table.Head>Submitted By</Table.Head>
                <Table.Head className="w-20">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredExpenses.map((expense) => (
                <Table.Row key={expense._id}>
                  <Table.Cell>
                    <span className="font-medium">{expense.description}</span>
                  </Table.Cell>
                  <Table.Cell>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(expense.category)}`}>
                      {expense.category}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="text-muted-foreground">{expense.vendor || '-'}</Table.Cell>
                  <Table.Cell className="font-semibold">
                    {formatCurrency(expense.totalAmount || expense.amount)}
                  </Table.Cell>
                  <Table.Cell>{getStatusBadge(expense.status)}</Table.Cell>
                  <Table.Cell>
                    {expense.source === 'tally-connector' ? (
                      <Badge variant="info" className="text-xs">
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Tally
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-xs">{expense.source || 'manual'}</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell className="text-muted-foreground">{formatDate(expense.date)}</Table.Cell>
                  <Table.Cell className="text-muted-foreground">
                    {expense.submittedBy?.name || '-'}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1">
                      {can(['admin', 'accountant']) && (
                        <button
                          onClick={() => navigate(`/expenses/${expense._id}/edit`)}
                          className="p-1.5 hover:bg-muted rounded-lg"
                        >
                          <Edit className="w-4 h-4 text-muted-foreground" />
                        </button>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Total Expenses</p>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(expenses.reduce((sum, e) => sum + parseFloat(e.totalAmount || e.amount || 0), 0))}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Pending Approval</p>
          <p className="text-2xl font-bold text-yellow-600">
            {expenses.filter((e) => e.status === 'pending').length}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Approved</p>
          <p className="text-2xl font-bold text-green-600">
            {formatCurrency(
              expenses.filter((e) => e.status === 'approved').reduce((sum, e) => sum + parseFloat(e.totalAmount || e.amount || 0), 0)
            )}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">This Month</p>
          <p className="text-2xl font-bold text-blue-600">
            {formatCurrency(
              expenses
                .filter((e) => new Date(e.date).getMonth() === new Date().getMonth())
                .reduce((sum, e) => sum + parseFloat(e.totalAmount || e.amount || 0), 0)
            )}
          </p>
        </Card>
      </div>
    </div>
  );
};

export default ExpenseList;

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Filter,
  Download,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Send,
  FileText,
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

const InvoiceList = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [invoices, setInvoices] = useState([]);
  const [sharedInvoices, setSharedInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' });

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      const response = await api.get('/invoices');
      setInvoices(response.data.data || []);
      try {
        const shared = await api.get('/invoices/shared');
        setSharedInvoices(shared.data.data || []);
      } catch (sharedError) {
        console.error('Failed to fetch shared invoices:', sharedError);
        setSharedInvoices([]);
      }
    } catch (error) {
      console.error('Failed to fetch invoices:', error);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      draft: 'default',
      sent: 'info',
      paid: 'success',
      partial: 'warning',
      overdue: 'danger',
      cancelled: 'default',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  const filteredInvoices = invoices.filter((invoice) => {
    const matchesSearch =
      invoice.invoiceNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.customerName?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !statusFilter || invoice.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent' },
    { value: 'paid', label: 'Paid' },
    { value: 'partial', label: 'Partial' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Invoices"
        description="Manage your invoices and track payments"
        action={
          can(['admin', 'accountant']) && (
            <Button onClick={() => navigate('/invoices/new')} icon={Plus}>
              New Invoice
            </Button>
          )
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search invoices..."
              icon={Search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="w-full md:w-48">
            <Select
              placeholder="All Status"
              options={statusOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            icon={Download}
            onClick={() => {
              if (!filteredInvoices.length) return;
              downloadCsv(
                `invoices-${new Date().toISOString().split('T')[0]}`,
                ['Invoice #', 'Customer', 'Amount', 'Status', 'Due Date', 'Created'],
                filteredInvoices.map((inv) => [
                  inv.invoiceNumber,
                  inv.customerName || '',
                  inv.totalAmount,
                  inv.status,
                  inv.dueDate || '',
                  inv.createdAt || '',
                ])
              );
            }}
          >
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Invoice Table */}
      {filteredInvoices.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No invoices found"
            description="Create your first invoice to get started with billing."
            actionLabel={can(['admin', 'accountant']) ? 'Create Invoice' : undefined}
            onAction={can(['admin', 'accountant']) ? () => navigate('/invoices/new') : undefined}
          />
        </Card>
      ) : (
        <Card padding={false}>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Invoice #</Table.Head>
                <Table.Head>Customer</Table.Head>
                <Table.Head>Amount</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Source</Table.Head>
                <Table.Head>Due Date</Table.Head>
                <Table.Head>Created</Table.Head>
                <Table.Head className="w-20">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredInvoices.map((invoice) => (
                <Table.Row
                  key={invoice._id}
                  onClick={() => navigate(`/invoices/${invoice._id}`)}
                  className="cursor-pointer"
                >
                  <Table.Cell>
                    <span className="font-medium text-blue-600">{invoice.invoiceNumber}</span>
                  </Table.Cell>
                  <Table.Cell>{invoice.customerName || '-'}</Table.Cell>
                  <Table.Cell className="font-semibold">
                    {formatCurrency(invoice.totalAmount)}
                  </Table.Cell>
                  <Table.Cell>{getStatusBadge(invoice.status)}</Table.Cell>
                  <Table.Cell>
                    {invoice.source === 'tally-connector' ? (
                      <Badge variant="info" className="text-xs">
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Tally
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-xs">{invoice.source || 'manual'}</Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell>{formatDate(invoice.dueDate)}</Table.Cell>
                  <Table.Cell className="text-muted-foreground">
                    {formatDate(invoice.createdAt)}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/invoices/${invoice._id}`);
                        }}
                        className="p-1.5 hover:bg-muted rounded-lg"
                      >
                        <Eye className="w-4 h-4 text-muted-foreground" />
                      </button>
                      {can(['admin', 'accountant']) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/invoices/${invoice._id}/edit`);
                          }}
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

      {/* Invoices shared from other accounts */}
      {sharedInvoices.length > 0 && (
        <Card padding={false}>
          <div className="px-4 py-3 border-b border-border font-semibold text-foreground">
            Invoices shared with me
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Invoice #</Table.Head>
                <Table.Head>Customer</Table.Head>
                <Table.Head>Amount</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Invoice Date</Table.Head>
                <Table.Head className="w-20">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sharedInvoices.map((invoice) => (
                <Table.Row
                  key={invoice._id}
                  onClick={() => navigate(`/invoices/${invoice._id}?shared=1`)}
                  className="cursor-pointer"
                >
                  <Table.Cell>
                    <span className="font-medium text-blue-600">{invoice.invoiceNumber}</span>
                  </Table.Cell>
                  <Table.Cell>{invoice.customerName || '-'}</Table.Cell>
                  <Table.Cell className="font-semibold">
                    {formatCurrency(invoice.totalAmount)}
                  </Table.Cell>
                  <Table.Cell>{getStatusBadge(invoice.status)}</Table.Cell>
                  <Table.Cell>{formatDate(invoice.invoiceDate)}</Table.Cell>
                  <Table.Cell>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/invoices/${invoice._id}?shared=1`);
                      }}
                      className="p-1.5 hover:bg-muted rounded-lg"
                    >
                      <Eye className="w-4 h-4 text-muted-foreground" />
                    </button>
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
          <p className="text-sm text-muted-foreground">Total Invoices</p>
          <p className="text-2xl font-bold text-foreground">{invoices.length}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Paid</p>
          <p className="text-2xl font-bold text-green-600">
            {formatCurrency(
              invoices
                .filter((i) => i.status === 'paid')
                .reduce((sum, i) => sum + parseFloat(i.totalAmount || 0), 0)
            )}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">
            {formatCurrency(
              invoices
                .filter((i) => ['sent', 'partial'].includes(i.status))
                .reduce((sum, i) => sum + parseFloat(i.totalAmount || 0), 0)
            )}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Overdue</p>
          <p className="text-2xl font-bold text-red-600">
            {formatCurrency(
              invoices
                .filter((i) => i.status === 'overdue')
                .reduce((sum, i) => sum + parseFloat(i.totalAmount || 0), 0)
            )}
          </p>
        </Card>
      </div>
    </div>
  );
};

export default InvoiceList;

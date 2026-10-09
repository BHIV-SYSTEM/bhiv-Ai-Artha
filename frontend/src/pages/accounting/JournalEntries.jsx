import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Filter,
  Download,
  Eye,
  CheckCircle,
  Clock,
  XCircle,
  BookOpen,
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
import toast from 'react-hot-toast';

const JournalEntries = () => {
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actingId, setActingId] = useState(null);

  useEffect(() => {
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    try {
      const response = await api.get('/ledger/entries', { params: { limit: 500 } });
      const entriesData = response.data.data || [];
      
      // Calculate debit/credit totals from lines
      const entriesWithTotals = entriesData.map(entry => ({
        ...entry,
        debitTotal: entry.lines?.reduce((sum, line) => sum + parseFloat(line.debit || 0), 0) || 0,
        creditTotal: entry.lines?.reduce((sum, line) => sum + parseFloat(line.credit || 0), 0) || 0,
      }));
      
      setEntries(entriesWithTotals);
    } catch (error) {
      console.error('Failed to fetch entries:', error);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const normalized = (status || '').toLowerCase();
    const config = {
      draft: { variant: 'default', icon: Clock, label: 'Draft' },
      validated: { variant: 'warning', icon: Clock, label: 'Validated' },
      posted: { variant: 'success', icon: CheckCircle, label: 'Posted' },
      voided: { variant: 'danger', icon: XCircle, label: 'Voided' },
    };
    const { variant, icon: Icon, label } = config[normalized] || config.draft;
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </Badge>
    );
  };

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      entry.entryNumber?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const normalizedStatus = (entry.status || '').toLowerCase();
    const matchesStatus = !statusFilter || normalizedStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handlePost = async (entry, event) => {
    event.stopPropagation();
    setActingId(entry._id);
    try {
      await api.post(`/ledger/entries/${entry._id}/post`);
      toast.success(`${entry.entryNumber} posted`);
      fetchEntries();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to post entry');
    } finally {
      setActingId(null);
    }
  };

  const handleVoid = async (entry, event) => {
    event.stopPropagation();
    const reason = window.prompt(`Reason for voiding ${entry.entryNumber}:`);
    if (!reason || !reason.trim()) {
      if (reason !== null) toast.error('A reason is required to void an entry');
      return;
    }
    setActingId(entry._id);
    try {
      await api.post(`/ledger/entries/${entry._id}/void`, { reason: reason.trim() });
      toast.success(`${entry.entryNumber} voided`);
      fetchEntries();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to void entry');
    } finally {
      setActingId(null);
    }
  };

  const statusOptions = [
    { value: 'draft', label: 'Draft' },
    { value: 'validated', label: 'Validated' },
    { value: 'posted', label: 'Posted' },
    { value: 'voided', label: 'Voided' },
  ];

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Journal Entries"
        description="View and manage your ledger entries"
        action={
          <Button onClick={() => navigate('/journal-entries/new')} icon={Plus}>
            New Entry
          </Button>
        }
      />

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <Input
              placeholder="Search entries..."
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
          <Button
            variant="secondary"
            icon={Download}
            onClick={() => {
              if (!filteredEntries.length) return;
              downloadCsv(
                `journal-entries-${new Date().toISOString().split('T')[0]}`,
                ['Entry #', 'Date', 'Description', 'Debit', 'Credit', 'Status', 'Created By'],
                filteredEntries.map((entry) => [
                  entry.entryNumber,
                  entry.date || '',
                  entry.description || '',
                  entry.debitTotal,
                  entry.creditTotal,
                  entry.status,
                  entry.postedBy?.name || 'System',
                ])
              );
            }}
          >
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Entries Table */}
      {filteredEntries.length === 0 ? (
        <Card>
          <EmptyState
            icon={BookOpen}
            title="No journal entries found"
            description="Create your first journal entry to start recording transactions."
            actionLabel="Create Entry"
            onAction={() => navigate('/journal-entries/new')}
          />
        </Card>
      ) : (
        <Card padding={false}>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Entry #</Table.Head>
                <Table.Head>Date</Table.Head>
                <Table.Head>Description</Table.Head>
                <Table.Head className="text-right">Debit</Table.Head>
                <Table.Head className="text-right">Credit</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Created By</Table.Head>
                <Table.Head className="w-32">Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredEntries.map((entry) => (
                <Table.Row
                  key={entry._id}
                  onClick={() => navigate(`/journal-entries/${entry._id}/edit`)}
                  className="cursor-pointer"
                >
                  <Table.Cell>
                    <span className="font-medium text-blue-600">{entry.entryNumber}</span>
                  </Table.Cell>
                  <Table.Cell className="text-muted-foreground">{formatDate(entry.date)}</Table.Cell>
                  <Table.Cell>
                    <div>
                      <p className="font-medium text-foreground">{entry.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {entry.lines?.length || 0} line items
                      </p>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono">
                    {formatCurrency(entry.debitTotal)}
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono">
                    {formatCurrency(entry.creditTotal)}
                  </Table.Cell>
                  <Table.Cell>{getStatusBadge(entry.status)}</Table.Cell>
                  <Table.Cell className="text-muted-foreground">
                    {entry.postedBy?.name || 'System'}
                  </Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {['draft', 'validated'].includes((entry.status || '').toLowerCase()) && (
                        <Button
                          size="sm"
                          loading={actingId === entry._id}
                          onClick={(e) => handlePost(entry, e)}
                        >
                          Post
                        </Button>
                      )}
                      {(entry.status || '').toLowerCase() === 'posted' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={actingId === entry._id}
                          onClick={(e) => handleVoid(entry, e)}
                        >
                          Void
                        </Button>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Total Entries</p>
          <p className="text-2xl font-bold text-foreground">{entries.length}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Posted</p>
          <p className="text-2xl font-bold text-green-600">
            {entries.filter((e) => (e.status || '').toLowerCase() === 'posted').length}
          </p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-sm text-muted-foreground">Pending</p>
          <p className="text-2xl font-bold text-yellow-600">
            {entries.filter((e) => (e.status || '').toLowerCase() === 'draft').length}
          </p>
        </Card>
      </div>
    </div>
  );
};

export default JournalEntries;

import { useState, useEffect } from 'react';
import {
  Download,
  Upload,
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  DollarSign,
  Plus,
  Search,
  Filter,
  Eye,
  ExternalLink,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from 'recharts';
import toast from 'react-hot-toast';
import {
  PageHeader,
  Card,
  Button,
  Badge,
  Select,
  Table,
  Input,
  Modal,
  Loading,
  EmptyState,
} from '../../components/common';
import api from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const TDSManagement = () => {
  const can = useCan();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [quarter, setQuarter] = useState('Q4');
  const [year, setYear] = useState('FY2025-26');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [paying, setPaying] = useState(false);
  const [challanNumber, setChallanNumber] = useState('');
  const [challanDate, setChallanDate] = useState(new Date().toISOString().split('T')[0]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showChallanModal, setShowChallanModal] = useState(false);
  const [challanEntry, setChallanEntry] = useState(null);
  const [showFilingModal, setShowFilingModal] = useState(false);
  const [submittingFiling, setSubmittingFiling] = useState(false);
  const [filingForm, setFilingForm] = useState('26Q');
  const [ackNumber, setAckNumber] = useState('');
  const [filedDate, setFiledDate] = useState(new Date().toISOString().split('T')[0]);
  const [filingNotes, setFilingNotes] = useState('');
  const [createForm, setCreateForm] = useState({
    deducteeName: '',
    deducteePan: '',
    section: '194J',
    nature: '',
    paymentAmount: '',
    transactionDate: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    fetchTDSData();
  }, [quarter, year]);

  const fetchTDSData = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/tds/dashboard?quarter=${quarter}&financialYear=${year}`);
      const apiData = response.data.data;
      
      setData({
        summary: apiData.summary,
        bySection: apiData.bySection,
        entries: apiData.entries,
        filingStatus: apiData.filingStatus,
      });
    } catch (error) {
      toast.error('Failed to load TDS data');
      setData({
        summary: {
          totalDeducted: 0,
          totalPaid: 0,
          pendingPayment: 0,
          pendingCount: 0,
        },
        bySection: [],
        entries: [],
        filingStatus: {
          form24Q: { status: 'pending', dueDate: null },
          form26Q: { status: 'pending', dueDate: null },
          form27Q: { status: 'not_applicable', dueDate: null },
        },
      });
    } finally {
      setLoading(false);
    }
  };

  const handleExportForm26Q = async () => {
    try {
      const response = await api.get(`/tds/form26q?quarter=${quarter}&financialYear=${year}`);
      
      // Convert JSON data to CSV
      const formData = response.data.data;
      if (!formData || !formData.deductees || formData.deductees.length === 0) {
        toast.error('No TDS data available for export');
        return;
      }
      
      // Create CSV content
      const headers = ['Deductee', 'PAN', 'Total Payment', 'Total TDS', 'Entries'];
      const rows = formData.deductees.map(deductee => [
        deductee.name || '',
        deductee.pan || '',
        deductee.totalPayment || 0,
        deductee.totalTDS || 0,
        deductee.entries?.length || 0
      ]);
      
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');
      
      // Download CSV
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `Form26Q-${quarter}-${year}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('Form 26Q exported successfully');
    } catch (error) {
      toast.error('Failed to export Form 26Q');
    }
  };

  const TRACES_PORTAL_URL =
    import.meta.env.VITE_TRACES_PORTAL_URL || 'https://www.traces.gov.in';

  const handleExportForm24Q = async () => {
    try {
      const response = await api.get(
        `/compliance/tds/form24q?quarter=${quarter}&financialYear=${year}&format=csv`,
        { responseType: 'blob' }
      );
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `Form24Q-${quarter}-${year}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('Form 24Q exported successfully');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to export Form 24Q');
    }
  };

  const openChallanModal = (entry) => {
    setChallanEntry(entry);
    setShowChallanModal(true);
  };

  const openFilingModal = (entry) => {
    setSelectedEntry(entry);
    setFilingForm('26Q');
    setAckNumber('');
    setFiledDate(new Date().toISOString().split('T')[0]);
    setFilingNotes('');
    setShowFilingModal(true);
  };

  const handleRecordFiling = async () => {
    if (!selectedEntry) return;
    if (!ackNumber.trim()) {
      toast.error('Acknowledgement number (ARN) is required');
      return;
    }
    setSubmittingFiling(true);
    try {
      await api.post(`/tds/entries/${selectedEntry._id}/file`, {
        acknowledgementNumber: ackNumber.trim(),
        filedDate,
        filingForm,
        notes: filingNotes.trim() || undefined,
      });
      toast.success('TDS filing recorded with acknowledgement');
      setShowFilingModal(false);
      fetchTDSData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to record filing');
    } finally {
      setSubmittingFiling(false);
    }
  };

  // Hand off to the government portal: export Form 26Q, then open TRACES
  const openTracesPortal = () => {
    window.open(TRACES_PORTAL_URL, '_blank', 'noopener,noreferrer');
  };

  const handleFileOnPortal = async () => {
    await handleExportForm26Q();
    openTracesPortal();
    toast.success(
      `Form 26Q downloaded. Complete the filing on ${new URL(TRACES_PORTAL_URL).hostname}.`
    );
  };

  const quarterOptions = [
    { value: 'Q1', label: 'Q1 (Apr-Jun)' },
    { value: 'Q2', label: 'Q2 (Jul-Sep)' },
    { value: 'Q3', label: 'Q3 (Oct-Dec)' },
    { value: 'Q4', label: 'Q4 (Jan-Mar)' },
  ];

  const yearOptions = [
    { value: 'FY2025-26', label: 'FY 2025-26' },
    { value: 'FY2024-25', label: 'FY 2024-25' },
  ];

  const statusOptions = [
    { value: 'pending', label: 'Pending' },
    { value: 'deducted', label: 'Deducted' },
    { value: 'deposited', label: 'Deposited' },
    { value: 'filed', label: 'Filed' },
  ];

  const getStatusBadge = (status) => {
    const config = {
      pending: { variant: 'warning', label: 'Pending', icon: Clock },
      deducted: { variant: 'info', label: 'Deducted', icon: Clock },
      deposited: { variant: 'success', label: 'Deposited', icon: CheckCircle },
      filed: { variant: 'primary', label: 'Filed', icon: CheckCircle },
      paid: { variant: 'success', label: 'Paid', icon: CheckCircle },
      overdue: { variant: 'danger', label: 'Overdue', icon: AlertTriangle },
    };
    const { variant, label, icon: Icon } = config[status] || config.pending;
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </Badge>
    );
  };

  const handlePayTDS = async () => {
    if (!selectedEntry) return;
    if (!challanNumber.trim()) {
      toast.error('Challan number is required');
      return;
    }
    setPaying(true);
    try {
      const entryId = selectedEntry._id;
      // Step 1: record the deduction (creates journal entry, status → deducted)
      if (selectedEntry.status === 'pending') {
        await api.post(`/tds/entries/${entryId}/deduct`);
      }
      // Step 2: record the challan deposit (status → deposited)
      await api.post(`/tds/entries/${entryId}/challan`, {
        challanNumber: challanNumber.trim(),
        challanDate,
        bankBSR: '',
      });
      toast.success('TDS payment and challan recorded successfully!');
      setShowPaymentModal(false);
      setChallanNumber('');
      setChallanDate(new Date().toISOString().split('T')[0]);
      fetchTDSData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to record payment');
    } finally {
      setPaying(false);
    }
  };

  const openPaymentModal = (entry) => {
    setSelectedEntry(entry);
    setChallanNumber('');
    setChallanDate(new Date().toISOString().split('T')[0]);
    setShowPaymentModal(true);
  };

  const sectionRates = {
    '194A': { rate: 10, name: 'Interest' },
    '194C': { rate: 2, name: 'Contractor' },
    '194H': { rate: 5, name: 'Commission' },
    '194I': { rate: 10, name: 'Rent' },
    '194J': { rate: 10, name: 'Professional/Technical' },
    '192': { rate: 0, name: 'Salary' },
    '194Q': { rate: 0.1, name: 'Purchase of Goods' },
  };

  const handleCreateEntry = async () => {
    if (!createForm.deducteeName.trim()) {
      toast.error('Deductee name is required');
      return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(createForm.deducteePan)) {
      toast.error('Invalid PAN format (e.g., ABCDE1234F)');
      return;
    }
    if (!createForm.paymentAmount || parseFloat(createForm.paymentAmount) <= 0) {
      toast.error('Payment amount must be greater than 0');
      return;
    }
    if (!createForm.nature.trim()) {
      toast.error('Nature of payment is required');
      return;
    }

    setCreating(true);
    try {
      await api.post('/tds/entries', {
        deductee: {
          name: createForm.deducteeName.trim(),
          pan: createForm.deducteePan.toUpperCase().trim(),
        },
        section: createForm.section,
        nature: createForm.nature.trim(),
        paymentAmount: createForm.paymentAmount,
        transactionDate: createForm.transactionDate,
      });
      toast.success('TDS entry created successfully');
      setShowCreateModal(false);
      setCreateForm({
        deducteeName: '',
        deducteePan: '',
        section: '194J',
        nature: '',
        paymentAmount: '',
        transactionDate: new Date().toISOString().split('T')[0],
      });
      fetchTDSData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create TDS entry');
    } finally {
      setCreating(false);
    }
  };

  const filteredEntries = data?.entries?.filter((entry) => {
    const matchesSearch =
      entry.deductee?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.pan?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = !statusFilter || entry.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  const COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444'];

  const sectionChartData = data?.bySection?.map((item) => ({
    name: `${item.section} - ${item.name}`,
    value: item.deducted,
  })) || [];

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="TDS Management"
        description="Track and manage Tax Deducted at Source"
        action={
          <div className="flex items-center gap-3">
            <Select
              options={quarterOptions}
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              className="w-36"
            />
            <Select
              options={yearOptions}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-36"
            />
            {can(['admin', 'accountant']) && (
              <Button variant="primary" icon={Plus} onClick={() => setShowCreateModal(true)}>
                Create Entry
              </Button>
            )}
            <Button variant="secondary" icon={Download} onClick={handleExportForm26Q}>
              Download Form 26Q
            </Button>
            <Button variant="secondary" icon={Download} onClick={handleExportForm24Q}>
              Download Form 24Q
            </Button>
            <Button variant="outline" icon={ExternalLink} onClick={handleFileOnPortal}>
              File on TRACES Portal
            </Button>
          </div>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Deducted</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.summary?.totalDeducted || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Paid</p>
              <p className="text-xl font-bold text-foreground">
                {formatCurrency(data?.summary?.totalPaid || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Pending Payment</p>
              <p className="text-xl font-bold text-yellow-600">
                {formatCurrency(data?.summary?.pendingPayment || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-gradient-to-br from-orange-500 to-orange-600 text-white">
          <p className="text-sm text-orange-100">Pending Entries</p>
          <p className="text-3xl font-bold">{data?.summary?.pendingCount || 0}</p>
          <p className="text-sm text-orange-200 mt-1">Awaiting payment</p>
        </Card>
      </div>

      {/* Section Breakdown and Filing Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">TDS by Section</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={sectionChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {sectionChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Section-wise Details</h2>
          <div className="space-y-3">
            {data?.bySection?.map((item, idx) => (
              <div
                key={item.section}
                className="flex items-center justify-between p-3 bg-muted rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                  />
                  <div>
                    <span className="font-medium text-foreground">{item.section}</span>
                    <span className="text-muted-foreground text-sm ml-2">({item.name})</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-foreground">
                    {formatCurrency(item.deducted)}
                  </p>
                  {item.pending > 0 && (
                    <p className="text-xs text-yellow-600">
                      ₹{(item.pending / 1000).toFixed(0)}K pending
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Filing Status */}
      <Card className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Quarterly Filing Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-4 rounded-lg border-2 ${
            data?.filingStatus?.form24Q?.status === 'filed' 
              ? 'border-green-200 bg-green-50' 
              : 'border-yellow-200 bg-yellow-50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-foreground">Form 24Q</h3>
              {getStatusBadge(data?.filingStatus?.form24Q?.status)}
            </div>
            <p className="text-sm text-muted-foreground">Salary TDS Return</p>
            <p className="text-xs text-muted-foreground mt-2">
              Due: {formatDate(data?.filingStatus?.form24Q?.dueDate)}
            </p>
          </div>

          <div className={`p-4 rounded-lg border-2 ${
            data?.filingStatus?.form26Q?.status === 'filed' 
              ? 'border-green-200 bg-green-50' 
              : 'border-yellow-200 bg-yellow-50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-foreground">Form 26Q</h3>
              {getStatusBadge(data?.filingStatus?.form26Q?.status)}
            </div>
            <p className="text-sm text-muted-foreground">Non-Salary TDS Return</p>
            <p className="text-xs text-muted-foreground mt-2">
              Due: {formatDate(data?.filingStatus?.form26Q?.dueDate)}
            </p>
          </div>

          <div className={`p-4 rounded-lg border-2 ${
            data?.filingStatus?.form27Q?.status === 'filed' 
              ? 'border-green-200 bg-green-50' 
              : data?.filingStatus?.form27Q?.status === 'not_applicable'
              ? 'border-muted bg-muted'
              : 'border-yellow-200 bg-yellow-50'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-foreground">Form 27Q</h3>
              <Badge variant="default">N/A</Badge>
            </div>
            <p className="text-sm text-muted-foreground">Foreign Payments</p>
            <p className="text-xs text-muted-foreground mt-2">No foreign payments</p>
          </div>
        </div>
      </Card>

      {/* TDS Entries */}
      <Card padding={false}>
        <div className="p-4 border-b border-border">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search by deductee name or PAN..."
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
          </div>
        </div>

        {filteredEntries.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={FileText}
              title="No TDS entries found"
              description="Create your first TDS entry to start tracking Tax Deducted at Source."
            actionLabel={can(['admin', 'accountant']) ? 'Create TDS Entry' : undefined}
            onAction={can(['admin', 'accountant']) ? () => setShowCreateModal(true) : undefined}
            />
          </div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>Deductee</Table.Head>
                <Table.Head>PAN</Table.Head>
                <Table.Head>Section</Table.Head>
                <Table.Head className="text-right">Amount</Table.Head>
                <Table.Head className="text-right">TDS</Table.Head>
                <Table.Head>Deduction Date</Table.Head>
                <Table.Head>Status</Table.Head>
                <Table.Head>Actions</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {filteredEntries.map((entry) => (
                <Table.Row key={entry._id}>
                  <Table.Cell className="font-medium">{entry.deductee}</Table.Cell>
                  <Table.Cell className="font-mono text-sm text-muted-foreground">{entry.pan}</Table.Cell>
                  <Table.Cell>
                    <Badge variant="info">{entry.section}</Badge>
                  </Table.Cell>
                  <Table.Cell className="text-right font-mono">
                    {formatCurrency(entry.amount)}
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <div>
                      <span className="font-mono font-medium">
                        {formatCurrency(entry.tdsAmount)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
                        ({entry.tdsRate}%)
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-muted-foreground">
                    {formatDate(entry.deductionDate)}
                  </Table.Cell>
                  <Table.Cell>{getStatusBadge(entry.status)}</Table.Cell>
                  <Table.Cell>
                    <div className="flex items-center gap-1">
                      {entry.status === 'pending' || entry.status === 'deducted' ? (
                        can(['admin', 'accountant']) && (
                          <Button size="sm" onClick={() => openPaymentModal(entry)}>
                            Pay
                          </Button>
                        )
                      ) : (
                        can(['admin', 'accountant']) && entry.status === 'deposited' && (
                          <Button size="sm" onClick={() => openFilingModal(entry)}>
                            Record Filing
                          </Button>
                        )
                      )}
                      {entry.status !== 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Eye}
                          onClick={() => openChallanModal(entry)}
                        >
                          Challan
                        </Button>
                      )}
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </Card>

      {/* Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title="Record TDS Payment"
      >
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              Recording payment for TDS deducted from <strong>{selectedEntry?.deductee}</strong>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Deductee PAN:</span>
              <span className="font-mono font-medium">{selectedEntry?.pan}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Section:</span>
              <span className="font-medium">{selectedEntry?.section}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">TDS Amount:</span>
              <span className="font-bold text-foreground">
                {formatCurrency(selectedEntry?.tdsAmount || 0)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due Date:</span>
              <span className="font-medium">{formatDate(selectedEntry?.dueDate)}</span>
            </div>
          </div>

          <Input
            label="Challan Number"
            placeholder="Enter challan number"
            value={challanNumber}
            onChange={(e) => setChallanNumber(e.target.value)}
          />

          <Input
            label="Payment Date"
            type="date"
            value={challanDate}
            onChange={(e) => setChallanDate(e.target.value)}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowPaymentModal(false)}>
              Cancel
            </Button>
            <Button onClick={handlePayTDS} loading={paying}>
              Record Payment
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create TDS Entry Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create TDS Entry"
      >
        <div className="space-y-4">
          <Input
            label="Deductee Name"
            placeholder="e.g., ABC Consultants Pvt Ltd"
            value={createForm.deducteeName}
            onChange={(e) => setCreateForm({ ...createForm, deducteeName: e.target.value })}
          />

          <Input
            label="PAN"
            placeholder="e.g., ABCDE1234F"
            value={createForm.deducteePan}
            onChange={(e) => setCreateForm({ ...createForm, deducteePan: e.target.value.toUpperCase() })}
            maxLength={10}
          />

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Section</label>
              <Select
                options={Object.entries(sectionRates).map(([code, { name }]) => ({
                  value: code,
                  label: `${code} - ${name}`,
                }))}
                value={createForm.section}
                onChange={(e) => setCreateForm({ ...createForm, section: e.target.value })}
              />
            </div>
            <Input
              label="Transaction Date"
              type="date"
              value={createForm.transactionDate}
              onChange={(e) => setCreateForm({ ...createForm, transactionDate: e.target.value })}
            />
          </div>

          <Input
            label="Nature of Payment"
            placeholder="e.g., Professional Fees, Rent, Commission"
            value={createForm.nature}
            onChange={(e) => setCreateForm({ ...createForm, nature: e.target.value })}
          />

          <Input
            label="Payment Amount"
            type="number"
            placeholder="0.00"
            value={createForm.paymentAmount}
            onChange={(e) => setCreateForm({ ...createForm, paymentAmount: e.target.value })}
            min="0"
            step="0.01"
          />

          {createForm.paymentAmount && parseFloat(createForm.paymentAmount) > 0 && (
            <div className="p-3 bg-muted rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">TDS Rate ({createForm.section}):</span>
                <span className="font-medium">{sectionRates[createForm.section]?.rate || 0}%</span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-muted-foreground">TDS Amount:</span>
                <span className="font-bold text-foreground">
                  {formatCurrency(
                    (parseFloat(createForm.paymentAmount) * (sectionRates[createForm.section]?.rate || 0)) / 100
                  )}
                </span>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span className="text-muted-foreground">Net Payable:</span>
                <span className="font-bold text-foreground">
                  {formatCurrency(
                    parseFloat(createForm.paymentAmount) -
                      (parseFloat(createForm.paymentAmount) * (sectionRates[createForm.section]?.rate || 0)) / 100
                  )}
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateEntry} loading={creating}>
              Create Entry
            </Button>
          </div>
        </div>
      </Modal>

      {/* Challan Details Modal */}
      <Modal
        isOpen={showChallanModal}
        onClose={() => setShowChallanModal(false)}
        title="Challan Details"
      >
        {challanEntry && (
          <div className="space-y-4">
            <div className="p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                TDS deposit details for <strong>{challanEntry.deductee}</strong> ({challanEntry.pan})
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Entry Number:</span>
                <span className="font-mono font-medium">{challanEntry.entryNumber || '—'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Section:</span>
                <span className="font-medium">{challanEntry.section}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">TDS Amount:</span>
                <span className="font-bold text-foreground">
                  {formatCurrency(challanEntry.tdsAmount || 0)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Challan Number:</span>
                <span className="font-mono font-medium">
                  {challanEntry.challanNo || 'No challan recorded'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Deposit Date:</span>
                <span className="font-medium">
                  {challanEntry.paidDate ? formatDate(challanEntry.paidDate) : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status:</span>
                <span>{getStatusBadge(challanEntry.status)}</span>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setShowChallanModal(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Record Filing Modal */}
      <Modal
        isOpen={showFilingModal}
        onClose={() => setShowFilingModal(false)}
        title="Record TDS Filing"
      >
        <div className="space-y-4">
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-sm text-green-800">
              Record the return filed on TRACES for{' '}
              <strong>{selectedEntry?.deductee}</strong> (TDS{' '}
              {formatCurrency(selectedEntry?.tdsAmount || 0)})
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Form</label>
            <Select
              options={[
                { value: '26Q', label: '26Q - Non-Salary' },
                { value: '24Q', label: '24Q - Salary' },
                { value: 'other', label: 'Other' },
              ]}
              value={filingForm}
              onChange={(e) => setFilingForm(e.target.value)}
            />
          </div>

          <Input
            label="Acknowledgement Number (ARN)"
            placeholder="e.g., ABC12345678901234567"
            value={ackNumber}
            onChange={(e) => setAckNumber(e.target.value)}
          />

          <Input
            label="Filed Date"
            type="date"
            value={filedDate}
            onChange={(e) => setFiledDate(e.target.value)}
          />

          <Input
            label="Notes (optional)"
            placeholder="e.g., Filed via TRACES quarterly return"
            value={filingNotes}
            onChange={(e) => setFilingNotes(e.target.value)}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowFilingModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleRecordFiling} loading={submittingFiling}>
              Record Filing
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default TDSManagement;

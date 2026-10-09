import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Upload,
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
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
  Loading,
  Modal,
} from '../../components/common';
import api from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/formatters';
import { useCan } from '../../utils/permissions';

const GSTDashboard = () => {
  const navigate = useNavigate();
  const can = useCan();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('current_month');
  const [showFilingModal, setShowFilingModal] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [filing, setFiling] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preparedId, setPreparedId] = useState(null);
  const [arn, setArn] = useState('');
  const [generating, setGenerating] = useState(false);
  const [gstinInput, setGstinInput] = useState('');
  const [gstinResult, setGstinResult] = useState(null);
  const [validatingGstin, setValidatingGstin] = useState(false);

  useEffect(() => {
    fetchGSTData();
  }, [period]);

  const getPeriodParam = () => {
    const now = new Date();
    switch (period) {
      case 'previous_month': {
        const d = new Date(now.getFullYear(), now.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      }
      default:
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
  };

  const fetchGSTData = async () => {
    setLoading(true);
    try {
      const periodParam = getPeriodParam();
      const response = await api.get(`/gst/summary?period=${periodParam}`);
      setData(response.data.data);
    } catch (error) {
      console.error('Failed to fetch GST data:', error);
      toast.error('Failed to load GST data');
      setData({
        summary: { outputGST: 0, inputGST: 0, netPayable: 0, previousCredit: 0, finalPayable: 0 },
        currentMonth: { period: '—', gstr1DueDate: null, gstr3bDueDate: null, gstr1Status: 'not_filed', gstr3bStatus: 'not_filed' },
        returns: [],
        monthlyData: [],
        invoicesSummary: { b2b: { count: 0, taxable: 0, tax: 0 }, b2c: { count: 0, taxable: 0, tax: 0 }, exports: { count: 0, taxable: 0, tax: 0 } },
      });
    } finally {
      setLoading(false);
    }
  };

  const GST_PORTAL_URL = import.meta.env.VITE_GST_PORTAL_URL || 'https://www.gst.gov.in';

  const openGstPortal = () => {
    window.open(GST_PORTAL_URL, '_blank', 'noopener,noreferrer');
  };

  const exportFilingPacket = async (type) => {
    const periodParam = getPeriodParam();
    const label = type === 'gstr-3b' ? 'GSTR-3B' : 'GSTR-1';
    try {
      const response = await api.get(
        `/gst/filing-packet/export?type=${type}&period=${periodParam}`,
        { responseType: 'blob' }
      );
      const blob = new Blob([response.data]);
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${label}-${periodParam}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      toast.success(`${label} filing packet downloaded`);
      return true;
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(`Failed to export ${label}`);
      return false;
    }
  };

  const handleExportGSTR1 = () => exportFilingPacket('gstr-1');

  // Generate the return data for the selected period and download it as JSON
  // (the payload the portal filing is built from).
  const handleGenerateReturn = async (type) => {
    const periodParam = getPeriodParam();
    const [year, month] = periodParam.split('-').map(Number);
    const label = type === 'gstr-3b' ? 'GSTR-3B' : 'GSTR-1';
    setGenerating(true);
    try {
      const endpoint = type === 'gstr-3b' ? '/gst/gstr3b/generate' : '/gst/gstr1/generate';
      const response = await api.post(endpoint, { month, year });
      const payload = response.data.data;
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8;',
      });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${type}-${periodParam}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      toast.success(`${label} generated for ${periodParam} (JSON downloaded)`);
      fetchGSTData();
    } catch (error) {
      console.error('Generate return error:', error);
      toast.error(error.response?.data?.message || `Failed to generate ${label}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleValidateGSTIN = async () => {
    const gstin = gstinInput.trim().toUpperCase();
    if (!gstin) {
      toast.error('Enter a GSTIN to validate');
      return;
    }
    setValidatingGstin(true);
    try {
      const response = await api.post('/gst/validate-gstin', { gstin });
      setGstinResult(response.data.data?.isValid === true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to validate GSTIN');
      setGstinResult(null);
    } finally {
      setValidatingGstin(false);
    }
  };

  // Hand off to the government portal: download our packet, open gst.gov.in
  const handleFileOnPortal = async () => {
    await exportFilingPacket(packetTypeFor(selectedReturn?.type));
    openGstPortal();
    toast.success('Filing packet downloaded. Complete the filing on gst.gov.in.');
  };

  const periodOptions = [
    { value: 'current_month', label: 'Current Month' },
    { value: 'previous_month', label: 'Previous Month' },
    { value: 'current_quarter', label: 'Current Quarter' },
    { value: 'current_fy', label: 'Current FY' },
  ];

  const getStatusBadge = (status) => {
    const config = {
      filed: { variant: 'success', label: 'Filed', icon: CheckCircle },
      revised: { variant: 'success', label: 'Revised', icon: CheckCircle },
      pending: { variant: 'warning', label: 'Pending', icon: Clock },
      not_filed: { variant: 'default', label: 'Not Filed', icon: FileText },
      overdue: { variant: 'danger', label: 'Overdue', icon: AlertTriangle },
    };
    const { variant, label, icon: Icon } = config[status] || config.not_filed;
    return (
      <Badge variant={variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </Badge>
    );
  };

  const packetTypeFor = (type) => (type === 'GSTR-3B' ? 'gstr-3b' : 'gstr-1');

  // Ensure a GSTReturn doc exists for the selected period (packet generation
  // upserts it and returns its id) so filing can be recorded against it.
  const prepareReturnDoc = async () => {
    if (selectedReturn?._id) return selectedReturn._id;
    if (preparedId) return preparedId;
    const type = packetTypeFor(selectedReturn?.type);
    setPreparing(true);
    try {
      const response = await api.get(`/gst/filing-packet/${type}?period=${getPeriodParam()}`);
      const id = response.data?.data?.returnId || response.data?.returnId;
      if (!id) throw new Error('Filing packet did not return a record id');
      setPreparedId(id);
      return id;
    } catch (error) {
      console.error('Prepare return error:', error);
      toast.error(error.response?.data?.message || 'Could not prepare the return record');
      throw error;
    } finally {
      setPreparing(false);
    }
  };

  const openFilingModal = (returnItem) => {
    setSelectedReturn(returnItem);
    setArn('');
    setPreparedId(null);
    setShowFilingModal(true);
    if (!returnItem?._id) {
      // Auto-prepare the return doc in the background (id stored in state)
      prepareReturnDoc().catch(() => {});
    }
  };

  const closeFilingModal = () => {
    setShowFilingModal(false);
    setSelectedReturn(null);
    setArn('');
    setPreparedId(null);
  };

  // Record the outcome of filing on the official portal: store ARN + portal
  // link against the return doc so the report is auditable and real.
  const handleSaveFiling = async () => {
    if (!selectedReturn) return;
    setFiling(true);
    try {
      const returnId = selectedReturn._id || (await prepareReturnDoc());
      const payload = {
        portalUrl: GST_PORTAL_URL,
        filedVia: 'GST_PORTAL',
      };
      const trimmedArn = arn.trim();
      if (trimmedArn) payload.acknowledgementNumber = trimmedArn;
      await api.post(`/gst/returns/${returnId}/file`, payload);
      toast.success(
        trimmedArn
          ? `${selectedReturn.type} filing recorded (ARN ${trimmedArn})`
          : `${selectedReturn.type} filing recorded`
      );
      closeFilingModal();
      fetchGSTData();
    } catch (error) {
      console.error('File return error:', error);
      toast.error(error.response?.data?.message || 'Failed to record filing');
    } finally {
      setFiling(false);
    }
  };

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="GST Dashboard"
        description="Monitor GST compliance, returns, and tax liability"
        action={
          <div className="flex items-center gap-3 flex-wrap">
            <Select
              options={periodOptions}
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-48"
            />
            <Button variant="outline" icon={ExternalLink} onClick={openGstPortal}>
              GST Portal
            </Button>
            {can(['admin', 'accountant']) && (
              <>
                <Button
                  variant="secondary"
                  icon={Download}
                  loading={generating}
                  onClick={() => handleGenerateReturn('gstr-1')}
                >
                  Generate GSTR-1
                </Button>
                <Button
                  variant="secondary"
                  icon={Download}
                  loading={generating}
                  onClick={() => handleGenerateReturn('gstr-3b')}
                >
                  Generate GSTR-3B
                </Button>
                <Button variant="ghost" icon={Download} onClick={handleExportGSTR1}>
                  GSTR-1 CSV
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* GSTIN Validator */}
      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant="info">GSTIN Check</Badge>
          <Input
            placeholder="e.g., 27AABCT1234A1Z1"
            value={gstinInput}
            onChange={(e) => setGstinInput(e.target.value.toUpperCase())}
            maxLength={15}
            className="w-56"
          />
          <Button
            size="sm"
            variant="secondary"
            loading={validatingGstin}
            onClick={handleValidateGSTIN}
          >
            Validate
          </Button>
          {gstinResult === true && <Badge variant="success">Valid GSTIN format</Badge>}
          {gstinResult === false && <Badge variant="danger">Invalid GSTIN format</Badge>}
          <span className="text-xs text-muted-foreground">
            Format check only - verify registration on the GST portal for authoritative status.</span>
        </div>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
              <ArrowUpRight className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Output GST</p>
              <p className="text-lg font-bold text-foreground">
                {formatCurrency(data?.summary?.outputGST || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <ArrowDownRight className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Input GST</p>
              <p className="text-lg font-bold text-foreground">
                {formatCurrency(data?.summary?.inputGST || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net Payable</p>
              <p className="text-lg font-bold text-foreground">
                {formatCurrency(data?.summary?.netPayable || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Previous Credit</p>
              <p className="text-lg font-bold text-foreground">
                {formatCurrency(data?.summary?.previousCredit || 0)}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <p className="text-xs text-blue-100">Final Payable</p>
          <p className="text-2xl font-bold">{formatCurrency(data?.summary?.finalPayable || 0)}</p>
          <p className="text-xs text-blue-200 mt-1">After ITC adjustment</p>
        </Card>
      </div>

      {/* Current Month Returns */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          {data?.currentMonth?.period} - Returns Due
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className={`p-4 rounded-lg border-2 ${
            data?.currentMonth?.gstr1Status === 'filed' 
              ? 'border-green-200 bg-green-50' 
              : 'border-yellow-200 bg-yellow-50'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">GSTR-1</h3>
              {getStatusBadge(data?.currentMonth?.gstr1Status)}
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Outward supplies return
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Due: {formatDate(data?.currentMonth?.gstr1DueDate)}
                </span>
              </div>
              {data?.currentMonth?.gstr1Status !== 'filed' && can(['admin', 'accountant']) && (
                <Button
                  size="sm"
                  onClick={() =>
                    openFilingModal({
                      period: data?.currentMonth?.period,
                      dueDate: data?.currentMonth?.gstr1DueDate,
                      type: 'GSTR-1',
                    })
                  }
                >
                  File Now
                </Button>
              )}
            </div>
          </div>

          <div className={`p-4 rounded-lg border-2 ${
            data?.currentMonth?.gstr3bStatus === 'filed' 
              ? 'border-green-200 bg-green-50' 
              : 'border-border bg-muted'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">GSTR-3B</h3>
              {getStatusBadge(data?.currentMonth?.gstr3bStatus)}
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Summary return with tax payment
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  Due: {formatDate(data?.currentMonth?.gstr3bDueDate)}
                </span>
              </div>
              {data?.currentMonth?.gstr3bStatus !== 'filed' && can(['admin', 'accountant']) && (
                <Button
                  size="sm"
                  onClick={() =>
                    openFilingModal({
                      period: data?.currentMonth?.period,
                      dueDate: data?.currentMonth?.gstr3bDueDate,
                      type: 'GSTR-3B',
                    })
                  }
                >
                  File Now
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Monthly Trend */}
      <Card>
        <h2 className="text-lg font-semibold text-foreground mb-4">GST Trend</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={data?.monthlyData || []}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 12 }} />
              <YAxis
                tick={{ fill: '#6B7280', fontSize: 12 }}
                tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}K`}
              />
              <Tooltip
                formatter={(value) => formatCurrency(value)}
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #E5E7EB',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Bar dataKey="output" name="Output GST" fill="#EF4444" radius={[4, 4, 0, 0]} />
              <Bar dataKey="input" name="Input GST" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="net" name="Net Payable" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Invoice Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4">B2B Invoices</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Count</span>
              <span className="font-medium">{data?.invoicesSummary?.b2b?.count || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Taxable Value</span>
              <span className="font-medium">{formatCurrency(data?.invoicesSummary?.b2b?.taxable || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Tax Amount</span>
              <span className="font-medium">{formatCurrency(data?.invoicesSummary?.b2b?.tax || 0)}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4">B2C Invoices</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Count</span>
              <span className="font-medium">{data?.invoicesSummary?.b2c?.count || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Taxable Value</span>
              <span className="font-medium">{formatCurrency(data?.invoicesSummary?.b2c?.taxable || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Tax Amount</span>
              <span className="font-medium">{formatCurrency(data?.invoicesSummary?.b2c?.tax || 0)}</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-semibold text-foreground mb-4">Export Invoices</h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Count</span>
              <span className="font-medium">{data?.invoicesSummary?.exports?.count || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Taxable Value</span>
              <span className="font-medium">{formatCurrency(data?.invoicesSummary?.exports?.taxable || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Tax Amount</span>
              <span className="font-medium text-green-600">Zero Rated</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Filing History */}
      <Card padding={false}>
        <div className="p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Filing History</h2>
        </div>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.Head>Period</Table.Head>
              <Table.Head>Return Type</Table.Head>
              <Table.Head>Due Date</Table.Head>
              <Table.Head>Filed Date</Table.Head>
              <Table.Head className="text-right">Amount</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head>Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {data?.returns?.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={7} className="text-center text-muted-foreground py-6">
                  No returns generated for this period yet
                </Table.Cell>
              </Table.Row>
            )}
            {data?.returns?.map((item) => (
              <Table.Row key={item._id}>
                <Table.Cell className="font-medium">{item.period}</Table.Cell>
                <Table.Cell>
                  <Badge variant={item.type === 'GSTR-1' ? 'info' : 'purple'}>
                    {item.type}
                  </Badge>
                </Table.Cell>
                <Table.Cell className="text-muted-foreground">{formatDate(item.dueDate)}</Table.Cell>
                <Table.Cell className="text-muted-foreground">
                  {item.filedDate ? formatDate(item.filedDate) : '-'}
                  {item.acknowledgementNumber && (
                    <div className="text-xs font-mono text-muted-foreground">
                      ARN: {item.acknowledgementNumber}
                    </div>
                  )}
                </Table.Cell>
                <Table.Cell className="text-right font-mono">
                  {formatCurrency(item.outputTax || item.netPayable || 0)}
                </Table.Cell>
                <Table.Cell>{getStatusBadge(item.status)}</Table.Cell>
                <Table.Cell>
                  {item.status === 'filed' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={ExternalLink}
                      onClick={() =>
                        window.open(item.portalUrl || GST_PORTAL_URL, '_blank', 'noopener,noreferrer')
                      }
                    >
                      View
                    </Button>
                  ) : can(['admin', 'accountant']) && (
                    <Button size="sm" onClick={() => openFilingModal(item)}>
                      File
                    </Button>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </Card>

      {/* Filing Modal */}
      <Modal
        isOpen={showFilingModal}
        onClose={closeFilingModal}
        title={`File ${selectedReturn?.type}`}
      >
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              Filing happens in three steps: download the packet prepared from your books,
              file <strong>{selectedReturn?.type}</strong> for <strong>{selectedReturn?.period}</strong>{' '}
              on the official GST portal, then record the filing here so Artha keeps the report.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Return Type:</span>
              <span className="font-medium">{selectedReturn?.type}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Period:</span>
              <span className="font-medium">{selectedReturn?.period}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Due Date:</span>
              <span className="font-medium">{formatDate(selectedReturn?.dueDate)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="gst-arn" className="text-sm font-medium text-foreground">
              Portal Acknowledgement Number (ARN)
            </label>
            <input
              id="gst-arn"
              type="text"
              value={arn}
              onChange={(e) => setArn(e.target.value)}
              placeholder="e.g. AA07092512345FZ — optional, shown on the portal after filing"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <p className="text-xs text-muted-foreground">
              Saving records the filing outcome against this return; it does not file on your behalf.
            </p>
          </div>

          <div className="flex flex-wrap justify-end gap-3 pt-4">
            <Button
              variant="outline"
              icon={Download}
              onClick={() => exportFilingPacket(packetTypeFor(selectedReturn?.type))}
            >
              Download Filing Packet
            </Button>
            <Button variant="secondary" icon={ExternalLink} onClick={handleFileOnPortal}>
              Download &amp; Open Portal
            </Button>
            <Button variant="ghost" onClick={closeFilingModal}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveFiling}
              loading={filing || preparing}
              disabled={preparing}
              icon={CheckCircle}
            >
              Save Filing Record
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default GSTDashboard;

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Upload,
  FileText,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Loader2,
  Download,
  Eye,
  X,
  ArrowRight,
  Database,
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronUp,
  Settings,
  Trash2,
  Clock,
  Hash,
  Layers,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Card, Button } from '../../components/common';
import { tallyService } from '../../services';
import SmartUpload from '../upload/SmartUpload';

const TABS = [
  { id: 'import', label: 'Import Data', icon: Upload },
  { id: 'smart', label: 'Smart Upload', icon: Layers },
  { id: 'export', label: 'Export Data', icon: Download },
  { id: 'history', label: 'Import History', icon: Clock },
];

const IMPORT_TYPES = [
  { value: 'vouchers', label: 'Vouchers (Journal Entries)', description: 'Sales, Purchase, Receipt, Payment, Journal vouchers' },
  { value: 'masters', label: 'Masters (Chart of Accounts)', description: 'Account groups, ledgers, and hierarchy' },
  { value: 'opening_balances', label: 'Opening Balances', description: 'Account opening balances for migration' },
];

const EXPORT_TYPES = [
  { value: 'vouchers', label: 'Vouchers', description: 'Export journal entries as Tally XML' },
  { value: 'masters', label: 'Masters', description: 'Export Chart of Accounts' },
  { value: 'opening_balances', label: 'Opening Balances', description: 'Export account balances' },
  { value: 'gst_data', label: 'GST Data', description: 'Export GST invoices for Tally' },
];

const SOURCE_SYSTEMS = [
  { id: 'tally', label: 'Tally ERP / TallyPrime', formats: ['xml', 'csv', 'json', 'xlsx'] },
  { id: 'zoho', label: 'Zoho Books', formats: ['csv', 'xlsx'] },
  { id: 'quickbooks', label: 'QuickBooks', formats: ['csv', 'xlsx'] },
  { id: 'marg', label: 'Marg ERP', formats: ['xml', 'csv', 'xlsx'] },
  { id: 'busy', label: 'Busy Accounting', formats: ['csv', 'xlsx'] },
  { id: 'sage', label: 'Sage', formats: ['csv', 'xlsx'] },
  { id: 'generic', label: 'Generic CSV/JSON/Excel', formats: ['csv', 'json', 'xlsx'] },
];

export default function DataIngestion() {
  const [activeTab, setActiveTab] = useState('import');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exportType, setExportType] = useState('vouchers');
  const [exportDateRange, setExportDateRange] = useState({ startDate: '', endDate: '' });
  const [exporting, setExporting] = useState(false);
  const [createJournals, setCreateJournals] = useState(true);
  const [selectedSource, setSelectedSource] = useState('tally');
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [previewMode, setPreviewMode] = useState('aggregated');
  const fileInputRef = useRef(null);
  const [importHistory, setImportHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyFilter, setHistoryFilter] = useState('');

  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!['xml', 'csv', 'json', 'xlsx', 'xls'].includes(ext)) {
      toast.error('Unsupported file format. Use XML, CSV, JSON, or Excel (XLS/XLSX).');
      return;
    }

    setSelectedFile(file);
    setImportResult(null);
    toast.loading('Previewing file...', { id: 'preview' });

    try {
      const res = await tallyService.previewFile(file);
      setPreviewData(res.data.data);
      toast.success(`Parsed ${res.data.data.totalRecords} records`, { id: 'preview' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to parse file', { id: 'preview' });
      setPreviewData(null);
    }
  }, []);

  const fetchImportHistory = useCallback(async (page = 1, status = '') => {
    setHistoryLoading(true);
    try {
      const params = { page, limit: 15 };
      if (status) params.status = status;
      const res = await tallyService.getImportHistory(params);
      setImportHistory(res.data.data || []);
      setHistoryTotalPages(res.data.pagination?.pages || 1);
    } catch (err) {
      toast.error('Failed to load import history');
      setImportHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchImportHistory(historyPage, historyFilter);
    }
  }, [activeTab, historyPage, historyFilter, fetchImportHistory]);

  const handleImport = useCallback(async () => {
    if (!selectedFile) return;
    setImporting(true);
    toast.loading('Importing data...', { id: 'import' });

    try {
      const res = await tallyService.importFile(selectedFile, {
        createJournals: String(createJournals),
        importType: 'vouchers',
      });
      setImportResult(res.data.data);
      const { results } = res.data.data;
      if (results.failed > 0) {
        toast.error(`Import: ${results.created} created, ${results.failed} failed. Check errors below.`, { id: 'import', duration: 6000 });
      } else if (results.warnings?.length > 0) {
        toast.success(`Import completed: ${results.created} created (${results.warnings.length} warnings)`, { id: 'import' });
      } else {
        toast.success(`Import completed: ${results.created} created, ${results.journalEntriesCreated || 0} journal entries posted`, { id: 'import' });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed', { id: 'import' });
    } finally {
      setImporting(false);
    }
  }, [selectedFile, createJournals]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    toast.loading('Exporting...', { id: 'export' });

    try {
      let res;
      const data = {};
      if (exportType === 'gst_data') {
        if (!exportDateRange.startDate || !exportDateRange.endDate) {
          toast.error('Please select date range for GST export', { id: 'export' });
          setExporting(false);
          return;
        }
        data.period = exportDateRange;
        res = await tallyService.exportGSTData(data);
      } else if (exportType === 'opening_balances') {
        res = await tallyService.exportOpeningBalances(data);
      } else if (exportType === 'masters') {
        res = await tallyService.exportMasters(data);
      } else {
        data.dateRange = exportDateRange;
        res = await tallyService.exportVouchers(data);
      }

      const result = res.data.data;
      let downloadContent, filename, mimeType;

      if (exportType === 'vouchers' && result.xmlData) {
        downloadContent = result.xmlData;
        filename = `tally-vouchers-${Date.now()}.xml`;
        mimeType = 'text/xml';
      } else if (result.mastersData) {
        downloadContent = JSON.stringify(result.mastersData, null, 2);
        filename = `tally-masters-${Date.now()}.json`;
        mimeType = 'application/json';
      } else if (result.gstData) {
        downloadContent = JSON.stringify(result.gstData, null, 2);
        filename = `tally-gst-${Date.now()}.json`;
        mimeType = 'application/json';
      } else if (result.openingBalances) {
        downloadContent = JSON.stringify(result.openingBalances, null, 2);
        filename = `tally-balances-${Date.now()}.json`;
        mimeType = 'application/json';
      } else {
        downloadContent = JSON.stringify(result, null, 2);
        filename = `tally-export-${Date.now()}.json`;
        mimeType = 'application/json';
      }

      const blob = new Blob([downloadContent], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toast.success(`Exported ${result.exportRecord?.recordCount || 0} records`, { id: 'export' });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Export failed', { id: 'export' });
    } finally {
      setExporting(false);
    }
  }, [exportType, exportDateRange]);

  const clearFile = () => {
    setSelectedFile(null);
    setPreviewData(null);
    setImportResult(null);
    setPreviewMode('aggregated');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const renderImportTab = () => (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <Database className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Source System</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SOURCE_SYSTEMS.map(src => (
            <button
              key={src.id}
              onClick={() => setSelectedSource(src.id)}
              className={`p-3 rounded-xl border-2 text-left transition-all ${
                selectedSource === src.id
                  ? 'border-primary bg-primary/5 shadow-sm'
                  : 'border-border/50 hover:border-primary/30 hover:bg-muted/50'
              }`}
            >
              <div className="font-medium text-sm">{src.label}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {src.formats.map(f => f.toUpperCase()).join(', ')}
              </div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Upload className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Upload File</h3>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createJournals}
              onChange={(e) => setCreateJournals(e.target.checked)}
              className="rounded border-border"
            />
            Auto-create journal entries
          </label>
        </div>

        <div
          className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
            selectedFile
              ? 'border-primary bg-primary/5'
              : 'border-border/50 hover:border-primary/30 hover:bg-muted/30'
          }`}
          onClick={() => !selectedFile && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.csv,.json,.xlsx,.xls"
            onChange={handleFileSelect}
            className="hidden"
          />

          {selectedFile ? (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-3">
                {selectedFile.name.endsWith('.xml') ? (
                  <FileText className="w-8 h-8 text-primary" />
                ) : (
                  <FileSpreadsheet className="w-8 h-8 text-primary" />
                )}
                <div className="text-left">
                  <div className="font-medium">{selectedFile.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); clearFile(); }} className="p-1 hover:bg-muted rounded-lg">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Upload className="w-12 h-12 text-muted-foreground mx-auto" />
              <div>
                <p className="font-medium">Drop file here or click to browse</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Supports XML, CSV, JSON from Tally, Zoho, QuickBooks, and more
                </p>
              </div>
            </div>
          )}
        </div>

        {previewData && (
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setExpandedPreview(!expandedPreview)}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Eye className="w-4 h-4" />
                Preview ({previewData.totalRecords} records)
                {expandedPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {expandedPreview && previewData.format === 'csv' && (
                <div className="flex gap-1 p-0.5 bg-muted/50 rounded-lg">
                  <button
                    onClick={() => setPreviewMode('aggregated')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      previewMode === 'aggregated' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    Grouped
                  </button>
                  <button
                    onClick={() => setPreviewMode('raw')}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      previewMode === 'raw' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    Raw CSV
                  </button>
                </div>
              )}
            </div>

            {expandedPreview && previewData.preview && (
              <div className="mt-3 overflow-x-auto">
                {previewMode === 'aggregated' ? (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">#</th>
                        <th className="text-left p-2 font-medium">Date</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-left p-2 font-medium">Number</th>
                        <th className="text-left p-2 font-medium">Narration</th>
                        <th className="text-right p-2 font-medium">Amount</th>
                        <th className="text-center p-2 font-medium">Entries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.preview.map((voucher, idx) => (
                        <tr key={idx} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="p-2 text-muted-foreground">{idx + 1}</td>
                          <td className="p-2">{voucher.date || '-'}</td>
                          <td className="p-2">
                            <span className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
                              {voucher.type || 'Journal'}
                            </span>
                          </td>
                          <td className="p-2 font-mono text-xs">{voucher.number || '-'}</td>
                          <td className="p-2 max-w-[200px] truncate">{voucher.narration || voucher.party || '-'}</td>
                          <td className="p-2 text-right font-mono">{voucher.amount || '-'}</td>
                          <td className="p-2 text-center">{voucher.ledgerEntries?.length || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">#</th>
                        <th className="text-left p-2 font-medium">Date</th>
                        <th className="text-left p-2 font-medium">Voucher#</th>
                        <th className="text-left p-2 font-medium">Type</th>
                        <th className="text-left p-2 font-medium">Ledger</th>
                        <th className="text-right p-2 font-medium">Debit</th>
                        <th className="text-right p-2 font-medium">Credit</th>
                        <th className="text-left p-2 font-medium">Narration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.preview.flatMap((voucher, vIdx) =>
                        (voucher.ledgerEntries || []).map((entry, eIdx) => (
                          <tr key={`${vIdx}-${eIdx}`} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="p-2 text-muted-foreground">{vIdx + 1}.{eIdx + 1}</td>
                            <td className="p-2">{voucher.date || '-'}</td>
                            <td className="p-2 font-mono text-xs">{voucher.number || '-'}</td>
                            <td className="p-2">
                              <span className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary">
                                {voucher.type || 'Journal'}
                              </span>
                            </td>
                            <td className="p-2">{entry.ledgerName || '-'}</td>
                            <td className="p-2 text-right font-mono">{entry.isDebit ? entry.amount : ''}</td>
                            <td className="p-2 text-right font-mono">{!entry.isDebit ? entry.amount : ''}</td>
                            <td className="p-2 max-w-[200px] truncate">{voucher.narration || '-'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}
                {previewData.totalRecords > 10 && (
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Showing 10 of {previewData.totalRecords} records
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {importResult && (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle className="w-5 h-5 text-emerald-500" />
            <h3 className="text-lg font-semibold">Import Results</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Created', value: importResult.results.created, color: 'text-emerald-600' },
              { label: 'Updated', value: importResult.results.updated, color: 'text-blue-600' },
              { label: 'Skipped', value: importResult.results.skipped, color: 'text-amber-600' },
              { label: 'Failed', value: importResult.results.failed, color: 'text-red-600' },
              { label: 'Journals', value: importResult.results.journalEntriesCreated, color: 'text-primary' },
            ].map(stat => (
              <div key={stat.label} className="text-center p-3 rounded-xl bg-muted/50">
                <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
          {importResult.results.errors?.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
              <div className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">Errors:</div>
              {importResult.results.errors.slice(0, 5).map((err, i) => (
                <div key={i} className="text-xs text-red-600 dark:text-red-300">
                  {err.voucher}: {err.error}
                </div>
              ))}
            </div>
          )}
          {importResult.results.warnings?.length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
              <div className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">Warnings:</div>
              {importResult.results.warnings.slice(0, 5).map((w, i) => (
                <div key={i} className="text-xs text-amber-600 dark:text-amber-300">
                  {w.voucher}: {w.warning}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={clearFile}
          disabled={!selectedFile || importing}
        >
          Clear
        </Button>
        <Button
          onClick={handleImport}
          disabled={!selectedFile || importing}
          className="min-w-[120px]"
        >
          {importing ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Importing...</>
          ) : (
            <><Upload className="w-4 h-4 mr-2" /> Import Data</>
          )}
        </Button>
      </div>
    </div>
  );

  const renderExportTab = () => (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <Download className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Export to Tally</h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Export Type</label>
            <div className="grid grid-cols-2 gap-3">
              {EXPORT_TYPES.map(type => (
                <button
                  key={type.value}
                  onClick={() => setExportType(type.value)}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                    exportType === type.value
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border/50 hover:border-primary/30'
                  }`}
                >
                  <div className="font-medium text-sm">{type.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {exportType === 'vouchers' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Start Date</label>
                <input
                  type="date"
                  value={exportDateRange.startDate}
                  onChange={(e) => setExportDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End Date</label>
                <input
                  type="date"
                  value={exportDateRange.endDate}
                  onChange={(e) => setExportDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm"
                />
              </div>
            </div>
          )}

          {exportType === 'gst_data' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Period Start</label>
                <input
                  type="date"
                  value={exportDateRange.startDate}
                  onChange={(e) => setExportDateRange(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Period End</label>
                <input
                  type="date"
                  value={exportDateRange.endDate}
                  onChange={(e) => setExportDateRange(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleExport}
          disabled={exporting}
          className="min-w-[120px]"
        >
          {exporting ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Exporting...</>
          ) : (
            <><Download className="w-4 h-4 mr-2" /> Export</>
          )}
        </Button>
      </div>
    </div>
  );

  const renderHistoryTab = () => {
    const statusColors = {
      completed: 'bg-green-100 text-green-800',
      partial: 'bg-yellow-100 text-yellow-800',
      failed: 'bg-red-100 text-red-800',
      processing: 'bg-blue-100 text-blue-800',
      pending: 'bg-gray-100 text-gray-800',
    };

    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold">Import History</h3>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={historyFilter}
              onChange={(e) => { setHistoryFilter(e.target.value); setHistoryPage(1); }}
              className="px-3 py-1.5 text-sm border rounded-lg bg-background"
            >
              <option value="">All Status</option>
              <option value="completed">Completed</option>
              <option value="partial">Partial</option>
              <option value="failed">Failed</option>
              <option value="processing">Processing</option>
              <option value="pending">Pending</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchImportHistory(historyPage, historyFilter)}
              disabled={historyLoading}
            >
              <RefreshCw className={`w-4 h-4 ${historyLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {historyLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : importHistory.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground bg-muted/30 rounded-xl">
            <Layers className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No import records found.</p>
            <p className="text-xs mt-1">Import data using the Import Data tab to see history here.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Import ID</th>
                    <th className="pb-2 font-medium">Type</th>
                    <th className="pb-2 font-medium">Format</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium text-right">Created</th>
                    <th className="pb-2 font-medium text-right">Updated</th>
                    <th className="pb-2 font-medium text-right">Failed</th>
                    <th className="pb-2 font-medium">Imported By</th>
                    <th className="pb-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {importHistory.map((record) => (
                    <tr key={record._id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2.5 font-mono text-xs">{record.importId}</td>
                      <td className="py-2.5">{record.importType}</td>
                      <td className="py-2.5 uppercase">{record.format}</td>
                      <td className="py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[record.status] || 'bg-gray-100'}`}>
                          {record.status}
                        </span>
                      </td>
                      <td className="py-2.5 text-right">{record.importResults?.created || 0}</td>
                      <td className="py-2.5 text-right">{record.importResults?.updated || 0}</td>
                      <td className="py-2.5 text-right text-red-600">{record.importResults?.failed || 0}</td>
                      <td className="py-2.5">{record.importedBy?.name || record.importedBy?.email || '—'}</td>
                      <td className="py-2.5 text-xs text-muted-foreground">
                        {new Date(record.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {historyTotalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <span className="text-xs text-muted-foreground">
                  Page {historyPage} of {historyTotalPages}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                    disabled={historyPage <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                    disabled={historyPage >= historyTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Ingestion"
        subtitle="Import and export accounting data from Tally and other systems"
        icon={Database}
      />

      <div className="flex gap-1 p-1 bg-muted/50 rounded-xl w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'import' && renderImportTab()}
      {activeTab === 'smart' && <SmartUpload embedded />}
      {activeTab === 'export' && renderExportTab()}
      {activeTab === 'history' && renderHistoryTab()}
    </div>
  );
}

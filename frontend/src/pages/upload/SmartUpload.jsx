import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  X,
  FileText,
  FileSpreadsheet,
  Image,
  CheckCircle,
  AlertCircle,
  Loader2,
  Zap,
  Receipt,
  CreditCard,
  ArrowRight,
  ShieldCheck,
  Clock,
  IndianRupee,
  CalendarDays,
  Tag,
  Store,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Eye,
  FileSearch,
  Hash,
  Wallet,
  StickyNote,
  Layers,
  Lock,
  RotateCcw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, Card, Button } from '../../components/common';
import api from '../../services/api';

const FILE_TYPE_ICONS = {
  'image/jpeg': Image,
  'image/png': Image,
  'image/jpg': Image,
  'image/webp': Image,
  'image/gif': Image,
  'image/bmp': Image,
  'image/tiff': Image,
  'application/pdf': FileText,
  'text/csv': FileSpreadsheet,
  'text/tab-separated-values': FileSpreadsheet,
  'application/vnd.ms-excel': FileSpreadsheet,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': FileSpreadsheet,
  'application/msword': FileText,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': FileText,
  'text/plain': FileText,
  'text/markdown': FileText,
  'application/json': FileText,
  'text/html': FileText,
};

// Mirrors ALLOWED_EXTENSIONS on the backend document extractor.
const ACCEPTED_EXTENSIONS = [
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff',
  'txt', 'md', 'log', 'csv', 'tsv', 'json', 'xml', 'html', 'htm',
  'doc', 'docx', 'xls', 'xlsx',
];
const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(',');

const TYPE_COLORS = {
  bank_statement: 'bg-blue-500/10 text-blue-600 border-blue-200',
  bill: 'bg-amber-500/10 text-amber-600 border-amber-200',
  receipt: 'bg-emerald-500/10 text-emerald-600 border-emerald-200',
  document: 'bg-violet-500/10 text-violet-600 border-violet-200',
  invoice: 'bg-cyan-500/10 text-cyan-600 border-cyan-200',
};
const TYPE_LABELS = {
  bank_statement: 'Bank Statement',
  bill: 'Bill / Purchase',
  receipt: 'Receipt / Expense',
  document: 'Document',
  invoice: 'Sales Invoice',
};

// Optional "process as" override — Auto keeps the backend's own detection.
const DOC_TYPE_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'invoice', label: 'Sales invoice' },
  { value: 'receipt', label: 'Expense / receipt' },
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'document', label: 'Document only' },
];

const CATEGORY_LABELS = {
  travel: 'Travel', meals: 'Meals & Entertainment', supplies: 'Office Supplies',
  utilities: 'Utilities', rent: 'Rent', insurance: 'Insurance',
  marketing: 'Marketing', professional_services: 'Professional Services',
  equipment: 'Equipment', software: 'Software', other: 'Other',
};

const SmartUpload = ({ embedded = false } = {}) => {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [expandedCards, setExpandedCards] = useState({});
  const [showRawText, setShowRawText] = useState({});
  const [approvingIds, setApprovingIds] = useState(new Set());
  const [approvedIds, setApprovedIds] = useState(new Set());
  const [passwords, setPasswords] = useState({});
  const [retrying, setRetrying] = useState(new Set());
  const [forcedType, setForcedType] = useState('');

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const addFiles = (newFiles) => {
    const valid = newFiles.filter((f) => {
      const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
      return ACCEPTED_EXTENSIONS.includes(ext) && f.size <= 25 * 1024 * 1024;
    });
    if (valid.length < newFiles.length) toast.error('Some files were skipped (unsupported type or > 25MB)');
    setFiles((prev) => [...prev, ...valid].slice(0, 10));
  };

  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));
  const getFileIcon = (file) => FILE_TYPE_ICONS[file.type] || FileText;
  const toggleCard = (i) => setExpandedCards((p) => ({ ...p, [i]: !p[i] }));
  const toggleRaw = (i) => setShowRawText((p) => ({ ...p, [i]: !p[i] }));

  /* ── Upload all ──────────────────────────────────── */
  const handleUploadAll = async () => {
    if (!files.length) return toast.error('Please add at least one file');
    setUploading(true);
    setResults([]);
    setApprovedIds(new Set());
    const out = [];
    for (let i = 0; i < files.length; i++) {
      setCurrentIndex(i);
      try {
        const fd = new FormData();
        fd.append('file', files[i]);
        if (forcedType) fd.append('documentType', forcedType);
        const res = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        out.push({ fileName: files[i].name, success: true, data: res.data.data });
      } catch (err) {
        out.push({ fileName: files[i].name, success: false, error: err.response?.data?.message || err.message });
      }
    }
    setResults(out);
    setCurrentIndex(-1);
    setUploading(false);
    const expanded = {};
    out.forEach((_, i) => { expanded[i] = true; });
    setExpandedCards(expanded);
    const ok = out.filter((r) => r.success).length;
    toast.success(ok === out.length ? `All ${ok} files processed!` : `${ok} of ${out.length} files processed`);
  };

  /* ── Approve single → then navigate ─────────────── */
  const handleApprove = async (expenseId, index, autoNav = false) => {
    setApprovingIds((p) => new Set([...p, expenseId]));
    try {
      await api.post(`/expenses/${expenseId}/approve`);
      setApprovedIds((p) => new Set([...p, expenseId]));
      setResults((prev) =>
        prev.map((r, i) =>
          i === index ? { ...r, data: { ...r.data, summary: { ...r.data.summary, status: 'approved' } } } : r
        )
      );
      toast.success('Approved & recorded to ledger!');
      if (autoNav) {
        setTimeout(() => navigate('/expenses'), 600);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Approval failed');
    } finally {
      setApprovingIds((p) => { const n = new Set(p); n.delete(expenseId); return n; });
    }
  };

  /* ── Approve ALL → then navigate ────────────────── */
  const handleApproveAll = async () => {
    const pending = results
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.success && r.data?.summary?.expenseId && r.data?.summary?.status !== 'approved' && !approvedIds.has(r.data.summary.expenseId));
    if (!pending.length) return toast('Nothing to approve');
    for (const { r, i } of pending) {
      await handleApprove(r.data.summary.expenseId, i, false);
    }
    toast.success('All approved! Redirecting to Expenses...');
    setTimeout(() => navigate('/expenses'), 800);
  };

  /* ── Retry with password ────────────────────────── */
  const handleRetryWithPassword = async (index) => {
    const pw = passwords[index];
    if (!pw) return toast.error('Please enter the PDF password');
    const file = files[index];
    if (!file) return;

    setRetrying((p) => new Set([...p, index]));
    try {        const fd = new FormData();
        fd.append('file', file);
        fd.append('password', pw);
        if (forcedType) fd.append('documentType', forcedType);
      const res = await api.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setResults((prev) => prev.map((r, i) => i === index ? { fileName: file.name, success: true, data: res.data.data } : r));
      toast.success('PDF unlocked & data extracted!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Retry failed');
    } finally {
      setRetrying((p) => { const n = new Set(p); n.delete(index); return n; });
    }
  };

  /* ── Derived counts ─────────────────────────────── */
  const hasResults = results.length > 0;
  const pendingCount = results.filter(
    (r) => r.success && r.data?.summary?.expenseId && r.data?.summary?.status !== 'approved' && !approvedIds.has(r.data.summary.expenseId)
  ).length;
  const approvedCount = results.filter(
    (r) => r.success && (r.data?.summary?.status === 'approved' || approvedIds.has(r.data?.summary?.expenseId))
  ).length;
  const statementsCount = results.filter((r) => r.success && r.data?.documentType === 'bank_statement').length;
  const expensesCount = results.filter(
    (r) => r.success && (r.data?.documentType === 'receipt' || r.data?.documentType === 'bill')
  ).length;
  const invoicesCount = results.filter((r) => r.success && r.data?.documentType === 'invoice').length;
  const documentsCount = results.filter((r) => r.success && r.data?.documentType === 'document').length;
  const totalAmount = results
    .filter((r) => r.success && r.data?.summary?.amount)
    .reduce((s, r) => s + parseFloat(r.data.summary.amount || 0), 0);

  return (
    <div className="space-y-6 animate-fadeIn">
      {!embedded && (
        <PageHeader
          title="Smart Upload"
          description="Drop any document — see all extracted data below — approve here and go to Expenses"
        />
      )}

      {/* ─── Upload Zone ─────────────────────────────────── */}
      <Card>
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-300 ${
            dragActive ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="flex justify-center mb-3">
            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center">
              <Upload className="w-7 h-7 text-primary" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">Drop any file here</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Invoices &amp; receipts (images, PDF) &bull; Bank statements (CSV, Excel, PDF) &bull; Documents (DOCX, TXT, JSON, HTML) &bull; Up to 10 files
          </p>
          <label className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium cursor-pointer hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/20">
            <Upload className="w-4 h-4" />
            Browse Files
            <input type="file" className="hidden" multiple accept={ACCEPT_ATTR} onChange={(e) => addFiles(Array.from(e.target.files))} />
          </label>

          {/* Optional processing override */}
          <div className="mt-5 inline-flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Process files as</span>
            <select
              value={forcedType}
              onChange={(e) => setForcedType(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {DOC_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* File chips before processing */}
        {files.length > 0 && !hasResults && (
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">Files ({files.length})</h4>
              {!uploading && <button onClick={() => setFiles([])} className="text-xs text-muted-foreground hover:text-destructive transition-colors">Clear all</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {files.map((file, i) => {
                const FIcon = getFileIcon(file);
                const processing = uploading && i === currentIndex;
                return (
                  <div key={i} className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm transition-all ${processing ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/30'}`}>
                    {processing ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <FIcon className="w-4 h-4 text-muted-foreground" />}
                    <span className="text-foreground max-w-[140px] truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)}KB</span>
                    {!uploading && <button onClick={() => removeFile(i)} className="ml-1 hover:text-destructive"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                );
              })}
            </div>
            <Button onClick={handleUploadAll} disabled={uploading || !files.length} className="w-full">
              {uploading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing {currentIndex + 1} of {files.length}...</>
                : <><Zap className="w-4 h-4" /> Process All Files ({files.length})</>}
            </Button>
          </div>
        )}
      </Card>

      {/* ─── Stat counters ───────────────────────────────── */}
      {hasResults && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
          {[
            { label: 'Processed', value: results.filter((r) => r.success).length, icon: CheckCircle, color: 'text-success' },
            { label: 'Expenses', value: expensesCount, icon: Receipt, color: 'text-amber-500' },
            { label: 'Invoices', value: invoicesCount, icon: FileText, color: 'text-cyan-500' },
            { label: 'Statements', value: statementsCount, icon: CreditCard, color: 'text-blue-500' },
            { label: 'Documents', value: documentsCount, icon: FileText, color: 'text-violet-500' },
            { label: 'Approved', value: approvedCount, icon: ShieldCheck, color: 'text-emerald-500' },
            { label: 'Total Amount', value: `₹${totalAmount.toLocaleString('en-IN')}`, icon: IndianRupee, color: 'text-primary' },
          ].map((s) => (
            <Card key={s.label} className="!p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center"><s.icon className={`w-5 h-5 ${s.color}`} /></div>
                <div>
                  <p className="text-[11px] text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Approve-all bar ─────────────────────────────── */}
      {hasResults && pendingCount > 0 && (
        <Card className="!p-4 border-primary/20 bg-primary/5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-primary" /></div>
              <div>
                <p className="text-sm font-semibold text-foreground">{pendingCount} item{pendingCount !== 1 ? 's' : ''} pending approval</p>
                <p className="text-xs text-muted-foreground">Approve to record in ledger &amp; update all numbers, then go to Expenses</p>
              </div>
            </div>
            <Button onClick={handleApproveAll} className="gap-2"><ShieldCheck className="w-4 h-4" /> Approve All &amp; Go to Expenses</Button>
          </div>
        </Card>
      )}

      {/* ─── All-approved banner ─────────────────────────── */}
      {hasResults && pendingCount === 0 && approvedCount > 0 && (
        <Card className="!p-4 border-success/20 bg-success/5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-success" />
              <div>
                <p className="text-sm font-semibold text-foreground">All {approvedCount} expense{approvedCount !== 1 ? 's' : ''} approved &amp; recorded</p>
                <p className="text-xs text-muted-foreground">Dashboard, reports &amp; ledger updated</p>
              </div>
            </div>
            <Button onClick={() => navigate('/expenses')} className="gap-2"><ArrowRight className="w-4 h-4" /> Go to Expenses</Button>
          </div>
        </Card>
      )}

      {/* ─── Extracted Content Cards ─────────────────────── */}
      {hasResults && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Extracted Document Data</h2>
            <Button variant="outline" size="sm" onClick={() => { setFiles([]); setResults([]); setApprovedIds(new Set()); }}>
              Upload More
            </Button>
          </div>

          {results.map((result, index) => {
            const open = expandedCards[index];
            const d = result.data;
            const s = d?.summary || {};
            const isSt = d?.documentType === 'bank_statement';
            const isExp = d?.documentType === 'receipt' || d?.documentType === 'bill';
            const isInv = d?.documentType === 'invoice';
            const isDoc = d?.documentType === 'document';
            const eid = s.expenseId;
            const approved = s.status === 'approved' || approvedIds.has(eid);
            const approving = approvingIds.has(eid);
            const rawText = d?.extractedContent;
            const rawOpen = showRawText[index];
            const needsPassword = d?.pdfError === 'password_required';
            const isRetrying = retrying.has(index);

            return (
              <Card key={index} className={`overflow-hidden transition-all duration-300 ${!result.success ? 'border-destructive/20' : needsPassword ? 'border-amber-400/40' : approved ? 'border-success/30' : ''}`}>
                {/* ── Collapsed header ── */}
                <div className="flex items-center gap-4 cursor-pointer select-none" onClick={() => toggleCard(index)}>
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                    {!result.success ? <AlertCircle className="w-5 h-5 text-destructive" />
                      : needsPassword ? <Lock className="w-5 h-5 text-amber-500" />
                      : approved ? <CheckCircle2 className="w-5 h-5 text-success" />
                      : isSt ? <CreditCard className="w-5 h-5 text-blue-500" />
                      : isDoc ? <FileText className="w-5 h-5 text-violet-500" />
                      : isInv ? <FileText className="w-5 h-5 text-cyan-500" />
                      : <Receipt className="w-5 h-5 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground truncate">{result.fileName}</p>
                      {d?.documentType && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase border ${TYPE_COLORS[d.documentType] || ''}`}>
                          {TYPE_LABELS[d.documentType] || d.documentType}
                        </span>
                      )}
                      {approved && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-success/10 text-success border border-success/20">Approved</span>}
                      {needsPassword && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-amber-500/10 text-amber-600 border border-amber-200">Password Required</span>}
                      {isExp && !approved && !needsPassword && result.success && <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase bg-amber-500/10 text-amber-600 border border-amber-200">Pending</span>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{result.success ? s.message : result.error}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isExp && s.amount && <span className="text-base font-bold text-foreground">₹{parseFloat(s.amount).toLocaleString('en-IN')}</span>}
                    {isInv && s.amount && <span className="text-base font-bold text-foreground">₹{parseFloat(s.amount).toLocaleString('en-IN')}</span>}
                    {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {/* ── Expanded: ALL extracted data ── */}
                {open && result.success && (
                  <div className="mt-4 pt-4 border-t border-border space-y-5">

                    {/* — Password required — */}
                    {needsPassword && (
                      <div className="p-4 bg-amber-500/5 border border-amber-300/30 rounded-xl space-y-3">
                        <div className="flex items-center gap-2">
                          <Lock className="w-4 h-4 text-amber-500" />
                          <p className="text-sm font-semibold text-foreground">This PDF is password-protected</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Indian bank statements usually require your Date of Birth, Customer ID, or PAN as the password. Enter it below to unlock and extract all data.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            placeholder="Enter PDF password"
                            value={passwords[index] || ''}
                            onChange={(e) => setPasswords((p) => ({ ...p, [index]: e.target.value }))}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                          <Button
                            onClick={(e) => { e.stopPropagation(); handleRetryWithPassword(index); }}
                            disabled={isRetrying || !passwords[index]}
                            className="gap-2"
                          >
                            {isRetrying
                              ? <><Loader2 className="w-4 h-4 animate-spin" /> Unlocking...</>
                              : <><RotateCcw className="w-4 h-4" /> Unlock &amp; Extract</>}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* — Expense / Bill — */}
                    {isExp && (
                      <>
                        {/* Key fields grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          <Field icon={Store} label="Vendor" value={s.vendor} />
                          <Field icon={IndianRupee} label="Amount" value={s.amount ? `₹${parseFloat(s.amount).toLocaleString('en-IN')}` : '—'} highlight />
                          <Field icon={IndianRupee} label="Tax / GST" value={s.taxAmount && s.taxAmount !== '0' ? `₹${parseFloat(s.taxAmount).toLocaleString('en-IN')}` : '₹0'} />
                          <Field icon={CalendarDays} label="Date" value={s.date ? new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
                          <Field icon={Tag} label="Expense #" value={s.expenseNumber} />
                          <Field icon={Hash} label="Invoice / Ref #" value={s.invoiceNumber || '—'} />
                          <Field icon={Layers} label="Category" value={CATEGORY_LABELS[s.category] || s.category || 'Other'} />
                          <Field icon={Wallet} label="Payment" value={s.paymentMethod ? s.paymentMethod.replace('_', ' ') : '—'} />
                          <Field icon={Clock} label="Status" value={approved ? 'Approved & Recorded' : 'Pending Approval'} valueClass={approved ? 'text-success' : 'text-amber-500'} />
                          {s.ocrConfidence != null && <Field icon={Eye} label="OCR Confidence" value={`${Math.round(s.ocrConfidence)}%`} />}
                        </div>

                        {/* Description */}
                        {s.description && (
                          <div className="p-3 bg-muted/40 rounded-xl">
                            <div className="flex items-center gap-2 mb-1">
                              <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Extracted Description</span>
                            </div>
                            <p className="text-sm text-foreground">{s.description}</p>
                          </div>
                        )}

                        {/* Line items from document */}
                        {s.lineItems?.length > 0 && (
                          <div className="p-3 bg-muted/40 rounded-xl">
                            <div className="flex items-center gap-2 mb-2">
                              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Line Items ({s.lineItems.length})</span>
                            </div>
                            <div className="space-y-1">
                              {s.lineItems.map((item, li) => (
                                <div key={li} className="flex items-center justify-between gap-3 text-sm py-1 border-b border-border/40 last:border-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {item.hsn && (
                                      <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{item.hsn}</span>
                                    )}
                                    <span className="text-foreground truncate">{item.description}</span>
                                  </div>
                                  {item.quantity != null && item.rate != null && (
                                    <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                                      {item.quantity}{item.unit ? ` ${item.unit}` : ''} × ₹{parseFloat(item.rate).toLocaleString('en-IN')}
                                    </span>
                                  )}
                                  <span className="font-semibold text-foreground flex-shrink-0 tabular-nums">₹{parseFloat(item.amount).toLocaleString('en-IN')}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* PDF info */}
                        {d?.pdfInfo && (
                          <div className="p-3 bg-muted/40 rounded-xl">
                            <div className="flex items-center gap-2 mb-1">
                              <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">PDF Info</span>
                            </div>
                            <div className="flex flex-wrap gap-4 text-sm text-foreground">
                              <span><strong>Pages:</strong> {d.pdfInfo.pages}</span>
                              {d.pdfInfo.title && <span><strong>Title:</strong> {d.pdfInfo.title}</span>}
                              {d.pdfInfo.author && <span><strong>Author:</strong> {d.pdfInfo.author}</span>}
                            </div>
                          </div>
                        )}

                        {/* Full extracted text — always visible for PDFs/docs */}
                        {rawText && (
                          <div>
                            <button onClick={(e) => { e.stopPropagation(); toggleRaw(index); }} className="flex items-center gap-2 text-xs font-medium text-primary hover:underline mb-2">
                              <FileSearch className="w-3.5 h-3.5" />
                              {rawOpen ? 'Hide' : 'Show'} Full Document Text ({rawText.length} chars)
                            </button>
                            {rawOpen && (
                              <div className="p-4 bg-muted/50 rounded-xl border border-border max-h-96 overflow-auto">
                                <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{rawText}</pre>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Processing steps */}
                        <div className="space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Processing Steps</p>
                          {d?.actions?.map((a, ai) => (
                            <div key={ai} className="flex items-start gap-2 text-xs bg-muted/30 rounded-lg p-2.5">
                              {a.type === 'ocr_completed' || a.type === 'extraction_completed' ? <Eye className="w-3.5 h-3.5 text-info mt-0.5 flex-shrink-0" />
                                : a.type === 'pdf_parsed' ? <FileText className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                                : a.type === 'expense_created' ? <CheckCircle className="w-3.5 h-3.5 text-success mt-0.5 flex-shrink-0" />
                                : a.type === 'extraction_failed' || a.type === 'extraction_error' || a.type === 'no_text_found' ? <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                : <Zap className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />}
                              <span className="text-muted-foreground">{a.message}</span>
                            </div>
                          ))}
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-3 pt-1">
                          {!approved && eid && (
                            <Button onClick={(e) => { e.stopPropagation(); handleApprove(eid, index, true); }} disabled={approving} className="gap-2">
                              {approving
                                ? <><Loader2 className="w-4 h-4 animate-spin" /> Approving...</>
                                : <><ShieldCheck className="w-4 h-4" /> Approve &amp; Go to Expenses</>}
                            </Button>
                          )}
                          {approved && (
                            <Button onClick={(e) => { e.stopPropagation(); navigate('/expenses'); }} className="gap-2">
                              <ArrowRight className="w-4 h-4" /> Go to Expenses
                            </Button>
                          )}
                        </div>
                      </>
                    )}

                    {/* — Sales Invoice — */}
                    {isInv && (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          <Field icon={Store} label="Customer" value={s.customerName} />
                          <Field icon={IndianRupee} label="Total" value={s.amount ? `₹${parseFloat(s.amount).toLocaleString('en-IN')}` : '—'} highlight />
                          <Field icon={IndianRupee} label="Tax / GST" value={s.taxAmount && s.taxAmount !== '0' ? `₹${parseFloat(s.taxAmount).toLocaleString('en-IN')}` : '₹0'} />
                          <Field icon={CalendarDays} label="Invoice Date" value={s.date ? new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'} />
                          <Field icon={Hash} label="Invoice #" value={s.invoiceNumber} />
                          <Field icon={Clock} label="Status" value="Draft — review in Invoices" valueClass="text-cyan-500" />
                          {s.ocrConfidence != null && <Field icon={Eye} label="OCR Confidence" value={`${Math.round(s.ocrConfidence)}%`} />}
                        </div>

                        {/* Line items from document */}
                        {s.lineItems?.length > 0 && (
                          <div className="p-3 bg-muted/40 rounded-xl">
                            <div className="flex items-center gap-2 mb-2">
                              <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Line Items ({s.lineItems.length})</span>
                            </div>
                            <div className="space-y-1">
                              {s.lineItems.map((item, li) => (
                                <div key={li} className="flex items-center justify-between gap-3 text-sm py-1 border-b border-border/40 last:border-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    {item.hsn && (
                                      <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">{item.hsn}</span>
                                    )}
                                    <span className="text-foreground truncate">{item.description}</span>
                                  </div>
                                  {item.quantity != null && item.rate != null && (
                                    <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                                      {item.quantity}{item.unit ? ` ${item.unit}` : ''} × ₹{parseFloat(item.rate).toLocaleString('en-IN')}
                                    </span>
                                  )}
                                  <span className="font-semibold text-foreground flex-shrink-0 tabular-nums">₹{parseFloat(item.amount).toLocaleString('en-IN')}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {rawText && (
                          <div>
                            <button onClick={(e) => { e.stopPropagation(); toggleRaw(index); }} className="flex items-center gap-2 text-xs font-medium text-primary hover:underline mb-2">
                              <FileSearch className="w-3.5 h-3.5" />
                              {rawOpen ? 'Hide' : 'Show'} Full Document Text ({rawText.length} chars)
                            </button>
                            {rawOpen && (
                              <div className="p-4 bg-muted/50 rounded-xl border border-border max-h-96 overflow-auto">
                                <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{rawText}</pre>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Processing Steps</p>
                          {d?.actions?.map((a, ai) => (
                            <div key={ai} className="flex items-start gap-2 text-xs bg-muted/30 rounded-lg p-2.5">
                              {a.type === 'invoice_created' || a.type === 'extraction_completed' ? <CheckCircle className="w-3.5 h-3.5 text-success mt-0.5 flex-shrink-0" />
                                : a.type === 'extraction_failed' || a.type === 'extraction_error' || a.type === 'no_text_found' ? <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                : <Zap className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />}
                              <span className="text-muted-foreground">{a.message}</span>
                            </div>
                          ))}
                        </div>

                        {s.invoiceId && (
                          <Button variant="outline" onClick={(e) => { e.stopPropagation(); navigate('/invoices'); }} className="gap-2">
                            <ArrowRight className="w-4 h-4" /> Go to Invoices
                          </Button>
                        )}
                      </>
                    )}

                    {/* — Bank Statement — */}
                    {isSt && (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <Field icon={CreditCard} label="Statement #" value={s.statementNumber} />
                          <Field icon={Clock} label="Status" value={s.status === 'processing' ? 'Processing...' : s.status} valueClass="text-blue-500" />
                        </div>
                        {d?.actions?.map((a, ai) => (
                          <div key={ai} className="flex items-start gap-2 text-xs bg-muted/30 rounded-lg p-2.5">
                            <Zap className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                            <span className="text-muted-foreground">{a.message}</span>
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground">Auto-reconciliation running — matching invoices, creating expenses, posting to ledger.</p>
                        {s.statementId && (
                          <Button variant="outline" onClick={(e) => { e.stopPropagation(); navigate(`/statements/${s.statementId}`); }} className="gap-2">
                            <ArrowRight className="w-4 h-4" /> View Statement Details
                          </Button>
                        )}
                      </>
                    )}

                    {/* — Generic document (DOCX, TXT, JSON, HTML, ...) — */}
                    {isDoc && (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                          <Field icon={FileText} label="Format" value={(s.category || '').toUpperCase() || '—'} />
                          <Field icon={Layers} label="Pages" value={s.pages ?? '—'} />
                          <Field icon={Layers} label="Sections" value={s.sections ?? '—'} />
                          <Field icon={Hash} label="Characters" value={s.charCount != null ? Number(s.charCount).toLocaleString('en-IN') : '—'} />
                          <Field icon={Eye} label="Method" value={s.method || '—'} />
                          <Field icon={FileSearch} label="OCR" value={d?.ocrFallback ? 'Yes (fallback)' : 'Not needed'} valueClass={d?.ocrFallback ? 'text-amber-500' : 'text-success'} />
                          <Field icon={CheckCircle} label="Status" value={s.status === 'extracted' ? 'Content extracted' : s.status === 'empty' ? 'No readable text' : s.status} valueClass={s.status === 'extracted' ? 'text-success' : 'text-amber-500'} />
                        </div>

                        {rawText && (
                          <div>
                            <button onClick={(e) => { e.stopPropagation(); toggleRaw(index); }} className="flex items-center gap-2 text-xs font-medium text-primary hover:underline mb-2">
                              <FileSearch className="w-3.5 h-3.5" />
                              {rawOpen ? 'Hide' : 'Show'} Extracted Text ({rawText.length} chars)
                            </button>
                            {rawOpen && (
                              <div className="p-4 bg-muted/50 rounded-xl border border-border max-h-96 overflow-auto">
                                <pre className="text-xs text-foreground whitespace-pre-wrap font-mono leading-relaxed">{rawText}</pre>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Processing Steps</p>
                          {d?.actions?.map((a, ai) => (
                            <div key={ai} className="flex items-start gap-2 text-xs bg-muted/30 rounded-lg p-2.5">
                              {a.type === 'extraction_completed' || a.type === 'ocr_fallback' ? <Eye className="w-3.5 h-3.5 text-info mt-0.5 flex-shrink-0" />
                                : a.type === 'no_text_found' || a.type === 'unsupported_format' ? <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                                : <Zap className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />}
                              <span className="text-muted-foreground">{a.message}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ─── Empty state ─────────────────────────────────── */}
      {!hasResults && !files.length && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Upload, title: '1. Drop any file', desc: 'Images, PDFs, Excel, DOCX, TXT, JSON — all formats accepted' },
            { icon: Zap, title: '2. Auto-detect', desc: 'System identifies bank statement vs bill vs receipt vs document' },
            { icon: FileSearch, title: '3. See all data', desc: 'Full extracted content shown below — vendor, amount, date, raw text' },
            { icon: ShieldCheck, title: '4. Approve & go', desc: 'Approve here, numbers update everywhere, then go to Expenses' },
          ].map((step, i) => (
            <Card key={i} className="!p-5 text-center">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <step.icon className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">{step.title}</p>
              <p className="text-xs text-muted-foreground">{step.desc}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

const Field = ({ icon: Icon, label, value, highlight, valueClass }) => (
  <div className="flex items-start gap-2.5 p-3 bg-muted/40 rounded-xl">
    <Icon className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={`text-sm font-semibold truncate ${valueClass || (highlight ? 'text-primary' : 'text-foreground')}`}>{value || '—'}</p>
    </div>
  </div>
);

export default SmartUpload;

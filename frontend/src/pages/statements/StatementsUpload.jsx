import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Upload, X, FileText, AlertCircle, AlertTriangle, Loader2, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { bankStatementService } from '../../services';
import {
  PageHeader,
  Card,
  Button,
  Input,
  Label,
  Modal,
  ProgressSubmitButton,
} from '../../components/common';

// Only bank + account identity are business-essential; the rest are
// auto-derived from the statement by the server when left empty.
const uploadSchema = z.object({
  accountNumber: z.string().min(1, 'Account number is required'),
  bankName: z.string().min(1, 'Bank name is required'),
  accountHolderName: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  openingBalance: z.string().optional(),
  closingBalance: z.string().optional(),
});

const FIELD_LABELS = {
  bankName: 'Bank Name',
  accountNumber: 'Account Number',
  accountHolderName: 'Account Holder',
  startDate: 'Start Date',
  endDate: 'End Date',
  openingBalance: 'Opening Balance',
  closingBalance: 'Closing Balance',
};

// Demo bank statement for testing extraction/upload end-to-end
const SAMPLE_STATEMENT_CSV = [
  'HDFC Bank Limited',
  'Account Name: Demo Company Pvt Ltd',
  'Account Number: 50100234567890',
  'IFSC: HDFC0000123',
  'Statement Period: 02/06/2025 to 30/06/2025',
  'Opening Balance: 150000.00',
  'Closing Balance: 220880.63',
  'Date,Description,Debit,Credit,Balance',
  '02/06/2025,NEFT CREDIT - ACME CORP INV1001,0,51234.57,201234.57',
  '05/06/2025,UPI - OFFICE SUPPLIES,2575.43,0,198659.14',
  '10/06/2025,IMPS CREDIT - RETAIL SALES,0,26789.31,225448.45',
  '15/06/2025,ACH DEBIT - RENT JUNE,40000.00,0,185448.45',
  '20/06/2025,NEFT CREDIT - SUNRISE DIST,0,15432.19,200880.64',
  '25/06/2025,MAINTENANCE PAYMENT - SOCIETY,3456.78,0,197423.86',
  '30/06/2025,IMPS CREDIT - SUNRISE DIST,0,23456.77,220880.63',
].join('\n');

const StatementsUpload = () => {
  const navigate = useNavigate();
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [autoFilled, setAutoFilled] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmData, setConfirmData] = useState(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(uploadSchema),
  });

  const watchedValues = watch();
  const requiredKeys = Object.keys(FIELD_LABELS);
  const completedFields =
    requiredKeys.filter((key) => String(watchedValues[key] ?? '').trim() !== '').length +
    (file ? 1 : 0);
  const progress = Math.round((completedFields / (requiredKeys.length + 1)) * 100);

  const AutoBadge = ({ field }) =>
    autoFilled.includes(field) ? (
      <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
        auto
      </span>
    ) : null;

  // Read account/bank/date/balance details from the dropped file and
  // pre-fill only the fields the user has left empty.
  const extractStatementDetails = async (selectedFile) => {
    setExtracting(true);
    setAutoFilled([]);
    try {
      // api client returns the raw axios response — the payload lives at
      // response.data.data (this was reading detectedFields off the top
      // level, so autofill never fired).
      const response = await bankStatementService.extract(selectedFile);
      const details = response?.data?.data || null;
      const current = getValues();
      const filled = [];

      (details?.detectedFields || []).forEach((fieldName) => {
        const value = details[fieldName];
        if (value === null || value === undefined || value === '') return;
        if (String(current[fieldName] ?? '').trim() !== '') return;
        setValue(fieldName, String(value), { shouldDirty: true });
        filled.push(fieldName);
      });

      setAutoFilled(filled);
      if (filled.length) {
        toast.success(
          `Auto-filled from statement: ${filled.map((f) => FIELD_LABELS[f]).join(', ')}`
        );
      } else {
        toast('No statement details detected — please fill the form manually.', { icon: 'ℹ️' });
      }
    } catch (error) {
      toast.error('Could not read statement details automatically. Please fill them manually.');
    } finally {
      setExtracting(false);
    }
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const downloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_STATEMENT_CSV], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'sample-bank-statement.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (selectedFile) => {
    const validTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf'];
    const fileExtension = selectedFile.name.split('.').pop().toLowerCase();
    const validExtensions = ['csv', 'xls', 'xlsx', 'pdf'];

    if (!validTypes.includes(selectedFile.type) && !validExtensions.includes(fileExtension)) {
      toast.error('Invalid file type. Please upload CSV, Excel (XLS/XLSX), or PDF.');
      return;
    }

    if (selectedFile.size > 25 * 1024 * 1024) {
      toast.error('File size must be less than 25MB');
      return;
    }

    setFile(selectedFile);
    extractStatementDetails(selectedFile);
  };

  const removeFile = () => {
    setFile(null);
    setAutoFilled([]);
  };

  const onSubmit = async (data) => {
    if (!file) {
      toast.error('Please select a file to upload');
      return;
    }
    setConfirmData(data);
    setShowConfirm(true);
  };

  const doUpload = async () => {
    if (!file || !confirmData) return;

    setUploading(true);
    try {
      await bankStatementService.upload(file, confirmData);
      toast.success('Bank statement uploaded! Auto-processing & reconciliation started.');
      setShowConfirm(false);
      navigate('/statements');
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error.response?.data?.message || 'Failed to upload statement');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Upload Bank Statement"
        description="Upload your statement — transactions are auto-extracted, matched to invoices & expenses, and posted to the ledger"
        actions={
          <Button variant="outline" onClick={() => navigate('/statements')}>
            Back to Statements
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload Form */}
        <div className="lg:col-span-2">
          <Card className="p-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* File Upload */}
              <div>
                <Label>Statement File *</Label>
                <div
                  className={`mt-2 border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    dragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-300 hover:border-primary'
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  {file ? (
                    <div className="relative inline-block">
                      <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-lg border border-gray-200">
                        <FileText className="w-8 h-8 text-primary" />
                        <div className="text-left">
                          <p className="text-sm font-medium text-gray-900">{file.name}</p>
                          <p className="text-xs text-gray-500">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={removeFile}
                          className="ml-2 text-gray-400 hover:text-red-600"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      {extracting && (
                        <p className="mt-3 inline-flex items-center gap-2 text-xs text-primary">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Reading statement and auto-filling details…
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-sm text-gray-600 mb-2">
                        Drag and drop your file here, or{' '}
                        <label className="text-primary font-medium cursor-pointer hover:underline">
                          browse
                          <input
                            type="file"
                            className="hidden"
                            accept=".csv,.xls,.xlsx,.pdf"
                            onChange={handleFileChange}
                          />
                        </label>
                      </p>
                      <p className="text-xs text-gray-500">
                        Supported formats: CSV, Excel (XLS/XLSX), PDF (Max 25MB)
                      </p>
                    </div>
                  )}
                </div>
                {!file && (
                  <div className="mt-2 flex items-start justify-between gap-2 text-xs text-amber-600">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <p>
                        For best results, export your bank statement as CSV with columns:
                        Date, Description, Debit, Credit, Balance
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={downloadSampleCsv}
                      className="inline-flex items-center gap-1 shrink-0 font-medium text-primary hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Sample CSV
                    </button>
                  </div>
                )}
              </div>

              {/* Account Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="bankName">Bank Name *<AutoBadge field="bankName" /></Label>
                  <Input
                    id="bankName"
                    {...register('bankName')}
                    placeholder="e.g., HDFC Bank"
                  />
                  {errors.bankName && (
                    <p className="mt-1 text-sm text-red-600">{errors.bankName.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="accountNumber">Account Number *<AutoBadge field="accountNumber" /></Label>
                  <Input
                    id="accountNumber"
                    {...register('accountNumber')}
                    placeholder="e.g., 1234567890"
                  />
                  {errors.accountNumber && (
                    <p className="mt-1 text-sm text-red-600">{errors.accountNumber.message}</p>
                  )}
                </div>
              </div>                <div>
                  <Label htmlFor="accountHolderName">Account Holder Name<AutoBadge field="accountHolderName" /></Label>
                <Input
                  id="accountHolderName"
                  {...register('accountHolderName')}
                  placeholder="e.g., ABC Company Pvt Ltd"
                />
                {errors.accountHolderName && (
                  <p className="mt-1 text-sm text-red-600">{errors.accountHolderName.message}</p>
                )}
              </div>

              {/* Statement Period */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startDate">Statement Start Date<AutoBadge field="startDate" /></Label>
                  <Input
                    id="startDate"
                    type="date"
                    {...register('startDate')}
                  />
                  {errors.startDate && (
                    <p className="mt-1 text-sm text-red-600">{errors.startDate.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="endDate">Statement End Date<AutoBadge field="endDate" /></Label>
                  <Input
                    id="endDate"
                    type="date"
                    {...register('endDate')}
                  />
                  {errors.endDate && (
                    <p className="mt-1 text-sm text-red-600">{errors.endDate.message}</p>
                  )}
                </div>
              </div>

              {/* Balances */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="openingBalance">Opening Balance<AutoBadge field="openingBalance" /></Label>
                  <Input
                    id="openingBalance"
                    {...register('openingBalance')}
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                  />
                  {errors.openingBalance && (
                    <p className="mt-1 text-sm text-red-600">{errors.openingBalance.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="closingBalance">Closing Balance<AutoBadge field="closingBalance" /></Label>
                  <Input
                    id="closingBalance"
                    {...register('closingBalance')}
                    placeholder="0.00"
                    type="number"
                    step="0.01"
                  />
                  {errors.closingBalance && (
                    <p className="mt-1 text-sm text-red-600">{errors.closingBalance.message}</p>
                  )}
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex gap-3">
                <ProgressSubmitButton
                  progress={progress}
                  loading={uploading}
                  icon={Upload}
                  className="flex-1"
                  hint="Bank name, account number and the file are required — the rest is auto-derived"
                >
                  Upload Statement
                </ProgressSubmitButton>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate('/statements')}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Card>
        </div>

        {/* Instructions */}
        <div>
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              How to Export Bank Statement
            </h3>
            
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">HDFC Bank</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                  <li>Login to net banking</li>
                  <li>Go to Accounts → Download Statement</li>
                  <li>Select date range and account</li>
                  <li>Choose CSV format and download</li>
                </ol>
              </div>

              <div>
                <h4 className="font-medium text-gray-700 mb-2">ICICI Bank</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                  <li>Login to internet banking</li>
                  <li>Click on Accounts & Save</li>
                  <li>Select "Download Transaction History"</li>
                  <li>Choose CSV format</li>
                </ol>
              </div>

              <div>
                <h4 className="font-medium text-gray-700 mb-2">SBI</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-600">
                  <li>Login to Yono or internet banking</li>
                  <li>Go to Accounts → Transaction History</li>
                  <li>Select period and download</li>
                  <li>Export as CSV if in Excel</li>
                </ol>
              </div>

              <div className="pt-4 border-t">
                <h4 className="font-medium text-gray-700 mb-2">Required Columns</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  <li>Transaction Date</li>
                  <li>Description / Particulars</li>
                  <li>Debit Amount</li>
                  <li>Credit Amount</li>
                  <li>Running Balance (optional)</li>
                </ul>
              </div>

              <div className="pt-4 border-t">
                <h4 className="font-medium text-gray-700 mb-2">Auto-Reconciliation</h4>
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-600">
                  <li>CSV, Excel (XLS/XLSX), and PDF are all supported</li>
                  <li>Transactions are automatically matched to existing expenses</li>
                  <li>Credits are auto-matched to outstanding invoices</li>
                  <li>Unmatched debits auto-create new expense entries</li>
                  <li>Journal entries are posted automatically</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Confirmation popup before submitting */}
      <Modal
        isOpen={showConfirm}
        onClose={() => !uploading && setShowConfirm(false)}
        title="Confirm statement details"
        description="Please once check the data you entered is correct or not."
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
            <AlertTriangle className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">
              Please once check the data you entered is correct or not. Once submitted, this
              statement is auto-matched to expenses and invoices and posted to the ledger.
            </p>
          </div>

          {confirmData && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div className="sm:col-span-2 flex justify-between gap-3 sm:block">
                <dt className="text-muted-foreground">File</dt>
                <dd className="font-medium text-foreground truncate">{file?.name}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted-foreground">Bank Name</dt>
                <dd className="font-medium text-foreground">{confirmData.bankName}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted-foreground">Account Number</dt>
                <dd className="font-medium text-foreground">{confirmData.accountNumber}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted-foreground">Account Holder</dt>
                <dd className="font-medium text-foreground">{confirmData.accountHolderName || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted-foreground">Statement Period</dt>
                <dd className="font-medium text-foreground">
                  {confirmData.startDate && confirmData.endDate
                    ? `${confirmData.startDate} → ${confirmData.endDate}`
                    : '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted-foreground">Opening Balance</dt>
                <dd className="font-medium text-foreground">{confirmData.openingBalance || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted-foreground">Closing Balance</dt>
                <dd className="font-medium text-foreground">{confirmData.closingBalance || '—'}</dd>
              </div>
            </dl>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowConfirm(false)}
              disabled={uploading}
            >
              Go Back
            </Button>
            <Button type="button" onClick={doUpload} loading={uploading}>
              Yes, Upload
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default StatementsUpload;

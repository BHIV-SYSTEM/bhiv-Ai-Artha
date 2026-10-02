import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Upload, X, Camera, FileText, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  Textarea,
  Loading,
  ProgressSubmitButton,
} from '../../components/common';
import api from '../../services/api';
import { formatCurrency } from '../../utils/formatters';

const expenseSchema = z.object({
  description: z.string().min(3, 'Description must be at least 3 characters'),
  amount: z.number().min(1, 'Amount must be greater than 0'),
  category: z.string().min(1, 'Category is required'),
  vendor: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  notes: z.string().optional(),
  gstAmount: z.number().optional(),
  gstRate: z.number().min(0).max(28).optional(),
  supplierState: z.string().optional(),
});

const ExpenseCreate = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEditing = Boolean(id);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [files, setFiles] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      description: '',
      amount: 0,
      category: '',
      vendor: '',
      date: new Date().toISOString().split('T')[0],
      notes: '',
      gstAmount: 0,
      gstRate: 0,
      supplierState: '',
    },
  });

  const watchAmount = watch('amount');
  const watchGstAmount = watch('gstAmount');
  const watchGstRate = watch('gstRate');
  const watchValues = watch();
  const showGstFields = (watchGstAmount > 0) || (watchGstRate > 0);

  const filesRef = useRef([]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Water-fill progress: every backend-required field must be complete
  const requiredFields = ['description', 'amount', 'category', 'date', 'vendor'];
  const completedFields = requiredFields.filter((field) => {
    const value = watchValues[field];
    if (field === 'amount') return Number(value) > 0;
    if (field === 'description') return String(value || '').trim().length >= 3;
    return String(value || '').trim().length > 0;
  }).length;
  const progress = Math.round((completedFields / requiredFields.length) * 100);

  useEffect(() => {
    if (isEditing) {
      fetchExpense();
    }
  }, [id]);

  const fetchExpense = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/expenses/${id}`);
      const expense = response.data.data;
      setValue('description', expense.description);
      setValue('amount', expense.amount);
      setValue('category', expense.category);
      setValue('vendor', expense.vendor || '');
      setValue('date', expense.date?.split('T')[0] || '');
      setValue('notes', expense.notes || '');
      setValue('gstAmount', expense.gstAmount || 0);
      setValue('gstRate', expense.gstRate || 0);
      setValue('supplierState', expense.supplierState || '');
    } catch (error) {
      toast.error('Failed to fetch expense');
      navigate('/expenses');
    } finally {
      setLoading(false);
    }
  };

  const categoryOptions = [
    { value: 'Operations', label: 'Operations' },
    { value: 'IT', label: 'IT & Software' },
    { value: 'Travel', label: 'Travel' },
    { value: 'Entertainment', label: 'Entertainment' },
    { value: 'HR', label: 'HR & Payroll' },
    { value: 'Marketing', label: 'Marketing' },
    { value: 'Utilities', label: 'Utilities' },
    { value: 'Office', label: 'Office Supplies' },
    { value: 'Professional', label: 'Professional Services' },
    { value: 'Other', label: 'Other' },
  ];

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  // Apply OCR response to the form (shared by auto-scan and manual scan)
  const applyOcrData = (data) => {
    const filled = [];

    if (data.vendor && data.vendor !== 'Unknown Vendor') {
      setValue('vendor', data.vendor);
      filled.push('vendor');
    }

    const amount = parseFloat(data.amount);
    if (!isNaN(amount) && amount > 0) {
      setValue('amount', amount);
      filled.push('amount');
    }

    if (data.date) {
      setValue('date', data.date);
      filled.push('date');
    }

    const gst = parseFloat(data.gstAmount ?? data.taxAmount ?? 0);
    const needsRateCheck = !isNaN(gst) && gst > 0;
    if (needsRateCheck) {
      setValue('gstAmount', gst);
      filled.push('GST amount');

      let rate = parseFloat(data.gstRate);
      if (![0, 5, 12, 18, 28].includes(rate)) {
        const derived = amount > 0 ? (gst / amount) * 100 : 0;
        rate = [5, 12, 18, 28].find((allowed) => Math.abs(allowed - derived) <= 1) || 0;
      }
      if (rate > 0) {
        setValue('gstRate', rate);
        filled.push('GST rate');
      }
      if (data.supplierState) {
        setValue('supplierState', data.supplierState);
        filled.push('supplier state');
      }
    }

    if (!String(watch('description') || '').trim()) {
      if (data.invoiceNumber) {
        setValue('description', `Receipt #${String(data.invoiceNumber).substring(0, 40)}`);
      } else if (data.vendor && data.vendor !== 'Unknown Vendor') {
        setValue('description', `Receipt from ${data.vendor}`.substring(0, 80));
      }
    }

    if (filled.length) {
      toast.success(`Receipt scanned! Filled: ${filled.join(', ')}.`);
    }
    if (needsRateCheck && !parseFloat(watch('gstRate'))) {
      toast('GST was found on the receipt — please confirm the GST rate and supplier state.', {
        icon: '⚠️',
      });
    }
  };

  const scanReceiptWithOCR = async (file) => {
    setScanning(true);
    try {
      const formData = new FormData();
      formData.append('receipt', file);

      const response = await api.post('/expenses/ocr', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      applyOcrData(response.data.data || {});
    } catch (error) {
      toast.error('Auto-scan failed. You can re-scan manually or enter details.');
    } finally {
      setScanning(false);
    }
  };

  const autoScanReceipt = async (file) => {
    await scanReceiptWithOCR(file);
  };

  const handleFiles = useCallback((fileList) => {
    const newFiles = Array.from(fileList).filter((file) => {
      const isValid = file.type.startsWith('image/') || file.type === 'application/pdf';
      const isSmallEnough = file.size <= 10 * 1024 * 1024;
      return isValid && isSmallEnough;
    });

    if (newFiles.length === 0) {
      toast.error('Only image or PDF receipts up to 10MB are allowed');
      return;
    }

    if (filesRef.current.length + newFiles.length > 5) {
      toast.error('Maximum 5 files allowed');
      return;
    }

    setFiles((prev) => [...prev, ...newFiles]);

    // First receipt in the box → auto-scan it and pre-fill the form
    if (filesRef.current.length === 0) {
      autoScanReceipt(newFiles[0]);
    }
  }, [autoScanReceipt]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleOCRScan = async () => {
    if (files.length === 0) {
      toast.error('Please upload a receipt first');
      return;
    }
    await scanReceiptWithOCR(files[0]);
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      const formData = new FormData();
      
      // Map category to backend format
      const categoryMap = {
        'Operations': 'other',
        'IT': 'software',
        'Travel': 'travel',
        'Entertainment': 'meals',
        'HR': 'professional_services',
        'Marketing': 'marketing',
        'Utilities': 'utilities',
        'Office': 'supplies',
        'Professional': 'professional_services',
        'Other': 'other'
      };
      
      formData.append('vendor', data.vendor || 'Unknown');
      formData.append('description', data.description);
      formData.append('category', categoryMap[data.category] || 'other');
      formData.append('date', data.date);
      formData.append('amount', String(data.amount));
      formData.append('taxAmount', String(data.gstAmount || 0));
      const gstAmt = parseFloat(data.gstAmount || 0);
      formData.append('totalAmount', String(parseFloat(data.amount) + gstAmt));
      formData.append('paymentMethod', 'other');
      if (data.gstRate) formData.append('gstRate', String(data.gstRate));
      if (data.supplierState) formData.append('supplierState', data.supplierState);
      if (data.notes) formData.append('notes', data.notes);
      
      files.forEach((file) => {
        formData.append('receipts', file);
      });

      if (isEditing) {
        await api.put(`/expenses/${id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.success('Expense updated successfully');
      } else {
        await api.post('/expenses', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        toast.success('Expense created successfully');
      }
      navigate('/expenses');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title={isEditing ? 'Edit Expense' : 'Add Expense'}
        description={isEditing ? 'Update expense details' : 'Record a new business expense'}
        backUrl="/expenses"
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <h2 className="text-lg font-semibold text-foreground mb-4">Expense Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Input
                    label="Description"
                    placeholder="What was this expense for?"
                    error={errors.description?.message}
                    required
                    {...register('description')}
                  />
                </div>
                <Input
                  label="Amount"
                  type="number"
                  placeholder="0.00"
                  error={errors.amount?.message}
                  required
                  {...register('amount', { valueAsNumber: true })}
                />
                <Input
                  label="GST Amount"
                  type="number"
                  placeholder="0.00"
                  helperText="GST included in total amount"
                  {...register('gstAmount', { valueAsNumber: true })}
                />
                {showGstFields && (
                  <>
                    <Input
                      label="GST Rate (%)"
                      type="number"
                      placeholder="e.g. 18"
                      helperText="Required when GST amount is provided"
                      error={errors.gstRate?.message}
                      {...register('gstRate', { valueAsNumber: true })}
                    />
                    <Select
                      label="Supplier State"
                      placeholder="Select state"
                      helperText="Required for GST compliance"
                      error={errors.supplierState?.message}
                      options={[
                        { value: 'ANDHRA_PRADESH', label: 'Andhra Pradesh' },
                        { value: 'ASSAM', label: 'Assam' },
                        { value: 'BIHAR', label: 'Bihar' },
                        { value: 'CHHATTISGARH', label: 'Chhattisgarh' },
                        { value: 'DELHI', label: 'Delhi' },
                        { value: 'GOA', label: 'Goa' },
                        { value: 'GUJARAT', label: 'Gujarat' },
                        { value: 'HARYANA', label: 'Haryana' },
                        { value: 'HIMACHAL_PRADESH', label: 'Himachal Pradesh' },
                        { value: 'JHARKHAND', label: 'Jharkhand' },
                        { value: 'KARNATAKA', label: 'Karnataka' },
                        { value: 'KERALA', label: 'Kerala' },
                        { value: 'MADHYA_PRADESH', label: 'Madhya Pradesh' },
                        { value: 'MAHARASHTRA', label: 'Maharashtra' },
                        { value: 'ODISHA', label: 'Odisha' },
                        { value: 'PUNJAB', label: 'Punjab' },
                        { value: 'RAJASTHAN', label: 'Rajasthan' },
                        { value: 'TAMIL_NADU', label: 'Tamil Nadu' },
                        { value: 'TELANGANA', label: 'Telangana' },
                        { value: 'UTTAR_PRADESH', label: 'Uttar Pradesh' },
                        { value: 'WEST_BENGAL', label: 'West Bengal' },
                        { value: 'OTHER', label: 'Other' },
                      ]}
                      {...register('supplierState')}
                    />
                  </>
                )}
                <Select
                  label="Category"
                  placeholder="Select category"
                  options={categoryOptions}
                  error={errors.category?.message}
                  required
                  {...register('category')}
                />
                <Input
                  label="Vendor/Merchant"
                  placeholder="Where was this purchased?"
                  {...register('vendor')}
                />
                <Input
                  label="Date"
                  type="date"
                  error={errors.date?.message}
                  required
                  {...register('date')}
                />
              </div>
              <div className="mt-4">
                <Textarea
                  label="Notes"
                  placeholder="Additional notes or details..."
                  rows={3}
                  {...register('notes')}
                />
              </div>
            </Card>

            {/* Summary */}
            <Card className="bg-muted">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-3xl font-bold text-foreground">
                    {formatCurrency(watchAmount || 0)}
                  </p>
                </div>
                {watchGstAmount > 0 && (
                  <div className="text-right">
                    <p className="text-sm text-muted-foreground">GST Included</p>
                    <p className="text-lg font-semibold text-green-600">
                      {formatCurrency(watchGstAmount)}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Receipt Upload */}
          <div className="space-y-6">
            <Card>
              <h2 className="text-lg font-semibold text-foreground mb-4">Receipt Upload</h2>
              
              {/* Drop Zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  dragActive
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-border hover:border-muted-foreground'
                }`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drag & drop receipts here, or{' '}
                  <label className="text-blue-600 cursor-pointer hover:text-blue-700">
                    browse
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*,.pdf"
                      multiple
                      onChange={(e) => handleFiles(e.target.files)}
                    />
                  </label>
                </p>
                <p className="text-xs text-muted-foreground">PNG, JPG, PDF up to 10MB</p>
              </div>

              {/* Uploaded Files */}
              {files.length > 0 && (
                <div className="mt-4 space-y-2">
                  {files.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        {file.type.startsWith('image/') ? (
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="w-10 h-10 object-cover rounded"
                          />
                        ) : (
                          <FileText className="w-10 h-10 text-muted-foreground" />
                        )}
                        <div>
                          <p className="text-sm font-medium text-foreground truncate max-w-[150px]">
                            {file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {(file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <X className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* OCR Scan Button */}
              {files.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full mt-4"
                  icon={Camera}
                  loading={scanning}
                  onClick={handleOCRScan}
                >
                  Scan Receipt with OCR
                </Button>
              )}
            </Card>

            {/* Tips */}
            <Card className="bg-blue-50 border-blue-200">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">Auto-Scan</h3>
              <ul className="text-xs text-blue-800 space-y-1">
                <li>• Upload a receipt image and fields auto-fill via OCR</li>
                <li>• Vendor, amount, date, and GST are extracted automatically</li>
                <li>• Use "Scan Receipt" button to re-scan if needed</li>
                <li>• Add vendor GSTN for compliance</li>
              </ul>
            </Card>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/expenses')}
          >
            Cancel
          </Button>
          <ProgressSubmitButton
            progress={progress}
            loading={saving}
            icon={Save}
            hint="Fill description, amount, category, date and vendor (validated on submit)"
          >
            {isEditing ? 'Update Expense' : 'Submit Expense'}
          </ProgressSubmitButton>
        </div>
      </form>
    </div>
  );
};

export default ExpenseCreate;

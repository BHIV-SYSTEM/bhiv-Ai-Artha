import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  Globe,
  FileText,
  DollarSign,
  Save,
  Upload,
  Camera,
} from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  Textarea,
  Loading,
} from '../../components/common';
import api from '../../services/api';

const companySchema = z.object({
  name: z.string().min(2, 'Company name is required'),
  legalName: z.string().optional(),
  email: z.string().email('Invalid email'),
  phone: z.string().min(10, 'Invalid phone number'),
  website: z.string().url().optional().or(z.literal('')),
  gstin: z.string().length(15, 'GSTIN must be 15 characters').optional().or(z.literal('')),
  pan: z.string().length(10, 'PAN must be 10 characters').optional().or(z.literal('')),
  tan: z.string().length(10, 'TAN must be 10 characters').optional().or(z.literal('')),
  cin: z.string().optional(),
  address: z.object({
    line1: z.string().min(1, 'Address is required'),
    line2: z.string().optional(),
    city: z.string().min(1, 'City is required'),
    state: z.string().min(1, 'State is required'),
    pincode: z.string().length(6, 'Invalid pincode'),
    country: z.string().default('India'),
  }),
  bankDetails: z.object({
    accountName: z.string().optional(),
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    ifscCode: z.string().optional(),
    branch: z.string().optional(),
  }),
  invoiceSettings: z.object({
    prefix: z.string().optional(),
    nextNumber: z.number().optional(),
    termsAndConditions: z.string().optional(),
    notes: z.string().optional(),
  }),
  financialYear: z.object({
    startMonth: z.number().min(1).max(12),
    startDay: z.number().min(1).max(31),
  }),
});

const CompanySettings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [logoPreview, setLogoPreview] = useState(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: '',
      legalName: '',
      email: '',
      phone: '',
      website: '',
      gstin: '',
      pan: '',
      tan: '',
      cin: '',
      address: {
        line1: '',
        line2: '',
        city: '',
        state: '',
        pincode: '',
        country: 'India',
      },
      bankDetails: {
        accountName: '',
        accountNumber: '',
        bankName: '',
        ifscCode: '',
        branch: '',
      },
      invoiceSettings: {
        prefix: 'INV',
        nextNumber: 1,
        termsAndConditions: '',
        notes: '',
      },
      financialYear: {
        startMonth: 4,
        startDay: 1,
      },
    },
  });

  useEffect(() => {
    fetchCompanySettings();
  }, []);

  const fetchCompanySettings = async () => {
    try {
      const response = await api.get('/settings/company');
      const data = response.data.data;
      
      const setNestedValue = (obj, prefix = '') => {
        Object.keys(obj).forEach((key) => {
          const path = prefix ? `${prefix}.${key}` : key;
          const value = obj[key];
          if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
            setNestedValue(value, path);
          } else {
            setValue(path, value);
          }
        });
      };
      
      setNestedValue(data);
      
      if (data.logo) {
        setLogoPreview(data.logo);
      }
    } catch (error) {
      toast.error('Failed to load company settings');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data) => {
    setSaving(true);
    try {
      // logoPreview holds the picked image (data-URL); it is separate state,
      // not a react-hook-form field, so it must be merged into the payload.
      await api.put('/settings/company', { ...data, logo: logoPreview ?? null });
      toast.success('Settings saved successfully');
    } catch (error) {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Keep the payload well inside the API's 10MB JSON body limit once base64.
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be 2MB or smaller');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const stateOptions = [
    { value: 'Andhra Pradesh', label: 'Andhra Pradesh' },
    { value: 'Delhi', label: 'Delhi' },
    { value: 'Gujarat', label: 'Gujarat' },
    { value: 'Karnataka', label: 'Karnataka' },
    { value: 'Maharashtra', label: 'Maharashtra' },
    { value: 'Tamil Nadu', label: 'Tamil Nadu' },
    { value: 'Telangana', label: 'Telangana' },
    { value: 'Uttar Pradesh', label: 'Uttar Pradesh' },
    { value: 'West Bengal', label: 'West Bengal' },
  ];

  const tabs = [
    { id: 'general', label: 'General', icon: Building2 },
    { id: 'address', label: 'Address', icon: MapPin },
    { id: 'tax', label: 'Tax & Compliance', icon: FileText },
    { id: 'bank', label: 'Bank Details', icon: DollarSign },
    { id: 'invoice', label: 'Invoice Settings', icon: FileText },
  ];

  if (loading) {
    return <Loading.Page />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        title="Company Settings"
        description="Manage your company profile and preferences"
      />

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="flex flex-col md:flex-row gap-6">
          {/* Tabs Sidebar */}
          <Card className="md:w-64 p-2">
            <nav className="space-y-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-blue-700 font-medium'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <tab.icon className="w-5 h-5" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </Card>

          {/* Content Area */}
          <div className="flex-1">
            <Card>
              {/* General Tab */}
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-foreground">General Information</h2>

                  {/* Logo Upload */}
                  <div className="flex items-center gap-6">
                    <div className="relative">
                      {logoPreview ? (
                        <img
                          src={logoPreview}
                          alt="Company Logo"
                          className="w-24 h-24 rounded-xl object-cover border-2 border-border"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-xl bg-muted flex items-center justify-center border-2 border-dashed border-border">
                          <Building2 className="w-10 h-10 text-muted-foreground" />
                        </div>
                      )}
                      <label className="absolute -bottom-2 -right-2 w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center cursor-pointer hover:bg-blue-700 transition-colors">
                        <Camera className="w-4 h-4 text-white" />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={handleLogoUpload}
                        />
                      </label>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">Company Logo</p>
                      <p className="text-sm text-muted-foreground">
                        PNG, JPG up to 2MB. Recommended size: 200x200px
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Company Name"
                      placeholder="Your company name"
                      error={errors.name?.message}
                      {...register('name')}
                    />
                    <Input
                      label="Legal Name"
                      placeholder="Full legal name"
                      {...register('legalName')}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Email"
                      type="email"
                      icon={Mail}
                      placeholder="company@example.com"
                      error={errors.email?.message}
                      {...register('email')}
                    />
                    <Input
                      label="Phone"
                      icon={Phone}
                      placeholder="9876543210"
                      error={errors.phone?.message}
                      {...register('phone')}
                    />
                  </div>

                  <Input
                    label="Website"
                    icon={Globe}
                    placeholder="https://yourcompany.com"
                    error={errors.website?.message}
                    {...register('website')}
                  />
                </div>
              )}

              {/* Address Tab */}
              {activeTab === 'address' && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-foreground">Business Address</h2>

                  <Input
                    label="Address Line 1"
                    placeholder="Street address"
                    error={errors.address?.line1?.message}
                    {...register('address.line1')}
                  />

                  <Input
                    label="Address Line 2"
                    placeholder="Apartment, suite, etc. (optional)"
                    {...register('address.line2')}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Input
                      label="City"
                      placeholder="City"
                      error={errors.address?.city?.message}
                      {...register('address.city')}
                    />
                    <Select
                      label="State"
                      options={stateOptions}
                      error={errors.address?.state?.message}
                      {...register('address.state')}
                    />
                    <Input
                      label="Pincode"
                      placeholder="400001"
                      error={errors.address?.pincode?.message}
                      {...register('address.pincode')}
                    />
                  </div>

                  <Input
                    label="Country"
                    value="India"
                    disabled
                    {...register('address.country')}
                  />
                </div>
              )}

              {/* Tax Tab */}
              {activeTab === 'tax' && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-foreground">Tax & Compliance</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="GSTIN"
                      placeholder="27AABCT1234A1Z5"
                      error={errors.gstin?.message}
                      {...register('gstin')}
                    />
                    <Input
                      label="PAN"
                      placeholder="AABCT1234A"
                      error={errors.pan?.message}
                      {...register('pan')}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="TAN"
                      placeholder="MUMB12345A"
                      error={errors.tan?.message}
                      {...register('tan')}
                    />
                    <Input
                      label="CIN"
                      placeholder="Company Identification Number"
                      {...register('cin')}
                    />
                  </div>

                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h3 className="font-medium text-blue-800 mb-2">Financial Year</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <Select
                        label="Start Month"
                        options={[
                          { value: 1, label: 'January' },
                          { value: 4, label: 'April' },
                          { value: 7, label: 'July' },
                          { value: 10, label: 'October' },
                        ]}
                        {...register('financialYear.startMonth', { valueAsNumber: true })}
                      />
                      <Input
                        label="Start Day"
                        type="number"
                        min="1"
                        max="31"
                        {...register('financialYear.startDay', { valueAsNumber: true })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Bank Tab */}
              {activeTab === 'bank' && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-foreground">Bank Details</h2>
                  <p className="text-sm text-muted-foreground">
                    These details will appear on your invoices for payment
                  </p>

                  <Input
                    label="Account Name"
                    placeholder="Account holder name"
                    {...register('bankDetails.accountName')}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Account Number"
                      placeholder="50200012345678"
                      {...register('bankDetails.accountNumber')}
                    />
                    <Input
                      label="IFSC Code"
                      placeholder="HDFC0001234"
                      {...register('bankDetails.ifscCode')}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Bank Name"
                      placeholder="HDFC Bank"
                      {...register('bankDetails.bankName')}
                    />
                    <Input
                      label="Branch"
                      placeholder="Branch name"
                      {...register('bankDetails.branch')}
                    />
                  </div>
                </div>
              )}

              {/* Invoice Tab */}
              {activeTab === 'invoice' && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-foreground">Invoice Settings</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                      label="Invoice Prefix"
                      placeholder="INV"
                      {...register('invoiceSettings.prefix')}
                    />
                    <Input
                      label="Next Invoice Number"
                      type="number"
                      {...register('invoiceSettings.nextNumber', { valueAsNumber: true })}
                    />
                  </div>

                  <Textarea
                    label="Default Terms & Conditions"
                    placeholder="Payment terms, late fees, etc."
                    rows={4}
                    {...register('invoiceSettings.termsAndConditions')}
                  />

                  <Textarea
                    label="Default Notes"
                    placeholder="Thank you message, additional info"
                    rows={2}
                    {...register('invoiceSettings.notes')}
                  />
                </div>
              )}

              {/* Save Button */}
              <div className="flex justify-end pt-6 mt-6 border-t border-border">
                <Button type="submit" loading={saving} icon={Save}>
                  Save Changes
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
};

export default CompanySettings;

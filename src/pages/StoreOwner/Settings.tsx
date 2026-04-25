import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import { appFetch } from '../../lib/api';
import { formatCurrency, normalizeLogoDataUrl, normalizeSignatureDataUrl } from '../../lib/utils';
import { generateStoreActivityArchivePDF } from '../../lib/pdf';
import { applyCurrencyPreferenceFromStore, getCurrencyConfig, POPULAR_CURRENCIES } from '../../lib/currency';
import { useNotification } from '../../context/NotificationContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import ConfirmActionModal from '../../components/ConfirmActionModal';
import {
  Store, 
  Image as ImageIcon, 
  MapPin, 
  Phone, 
  Save, 
  Loader2,
  CheckCircle2,
  LayoutGrid,
  ListFilter,
  Plus,
  Trash2,
  Settings as SettingsIcon,
  Home,
  Download,
  Upload,
  AlertTriangle,
  X,
  Moon,
  Sparkles,
  SunMedium,
  Search
} from 'lucide-react';

type DiscountCodeConfig = {
  id: string;
  name: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  expires_at: string | null;
  active: boolean;
};

const normalizeDiscountCodes = (value: any): DiscountCodeConfig[] => {
  const list = Array.isArray(value)
    ? value
    : (() => {
        try {
          const parsed = JSON.parse(String(value || '[]'));
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })();

  const seen = new Set<string>();
  return list.reduce((acc: DiscountCodeConfig[], entry: any, index: number) => {
    const name = String(entry?.name || '').trim().slice(0, 80);
    const code = String(entry?.code || '').trim().toUpperCase().replace(/\s+/g, '');
    const type = String(entry?.type || '').toUpperCase() === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const rawValue = Math.max(0, Number(entry?.value) || 0);
    const normalizedValue = type === 'PERCENTAGE'
      ? Number(Math.min(100, rawValue).toFixed(2))
      : Number(rawValue.toFixed(2));
    const rawExpiry = String(entry?.expires_at || '').trim();
    const expires_at = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry) ? rawExpiry : null;

    if (!name || !code || normalizedValue <= 0 || seen.has(code)) {
      return acc;
    }

    seen.add(code);
    acc.push({
      id: String(entry?.id || `discount-${code.toLowerCase()}-${index + 1}`),
      name,
      code,
      type,
      value: normalizedValue,
      expires_at,
      active: entry?.active !== false,
    });
    return acc;
  }, []);
};

const createEmptyDiscountCodeForm = () => ({
  name: '',
  code: '',
  type: 'PERCENTAGE' as 'PERCENTAGE' | 'FIXED',
  value: '',
  expires_at: '',
  active: true,
});

const Settings: React.FC = () => {
  const { showNotification } = useNotification();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { user } = useAuth();
  const [store, setStore] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [newSpec, setNewSpec] = useState('');
  const [showImportConfirm, setShowImportConfirm] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [pendingImportData, setPendingImportData] = useState<any>(null);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [importPrecheck, setImportPrecheck] = useState<any>(null);
  const [importPrecheckLoading, setImportPrecheckLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [showHealthModal, setShowHealthModal] = useState(false);
  const [healthProgress, setHealthProgress] = useState(0);
  const [healthStep, setHealthStep] = useState('Preparing cleanup...');
  const [healthResult, setHealthResult] = useState<any>(null);
  const [dangerAction, setDangerAction] = useState<'proformas' | 'logs' | null>(null);
  const [dangerLoading, setDangerLoading] = useState(false);
  const [retentionMode, setRetentionMode] = useState<'ONE_YEAR' | 'CUSTOM'>('ONE_YEAR');
  const [retentionFromDate, setRetentionFromDate] = useState('');
  const [retentionToDate, setRetentionToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [retentionPreviewLoading, setRetentionPreviewLoading] = useState(false);
  const [retentionPreview, setRetentionPreview] = useState<any>(null);
  const [retentionBackupDownloaded, setRetentionBackupDownloaded] = useState(false);
  const [retentionReportDownloaded, setRetentionReportDownloaded] = useState(false);
  const [retentionDeleteLoading, setRetentionDeleteLoading] = useState(false);
  const [retentionConfirmationText, setRetentionConfirmationText] = useState('');
  const [showRetentionDeleteConfirm, setShowRetentionDeleteConfirm] = useState(false);
  const [discountCodeForm, setDiscountCodeForm] = useState(createEmptyDiscountCodeForm());
  const [currencySearch, setCurrencySearch] = useState('');
  const [activeTab, setActiveTab] = useState<'identity' | 'receipts' | 'pricing' | 'promo' | 'columns' | 'data'>('identity');
  const isOwner = user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const selectedCurrency = getCurrencyConfig(store?.currency_code);
  const filteredCurrencies = POPULAR_CURRENCIES.filter((currency) => {
    const query = currencySearch.trim().toLowerCase();
    if (!query) return true;
    return [currency.code, currency.label, currency.symbol]
      .some((value) => String(value).toLowerCase().includes(query));
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const buildNormalizedStoreState = async (data: any) => {
    const [normalizedLogo, normalizedSignature] = await Promise.all([
      normalizeLogoDataUrl(data?.logo),
      normalizeSignatureDataUrl(data?.signature_image),
    ]);

    const normalizedCurrency = getCurrencyConfig(data?.currency_code);
    applyCurrencyPreferenceFromStore({ currency_code: normalizedCurrency.code });

    return {
      ...data,
      currency_code: normalizedCurrency.code,
      logo: normalizedLogo || data?.logo || null,
      signature_image: normalizedSignature || data?.signature_image || null,
      custom_specs: Array.isArray(data?.custom_specs) ? data.custom_specs : [],
      receipt_paper_size: ['THERMAL', 'THERMAL_58', 'A4'].includes(data?.receipt_paper_size) ? data.receipt_paper_size : (data?.mode === 'GADGET' ? 'A4' : 'THERMAL'),
      document_color: /^#([0-9A-Fa-f]{6})$/.test(String(data?.document_color || '')) ? String(data.document_color).toUpperCase() : '#F4BD4A',
      show_store_name_on_documents: data?.show_store_name_on_documents === true || data?.show_store_name_on_documents === 1,
      tax_enabled: Boolean(data?.tax_enabled),
      tax_percentage: Math.max(0, Number(data?.tax_percentage) || 0),
      default_missing_cost_to_price: Boolean(data?.default_missing_cost_to_price),
      receipt_header_note: String(data?.receipt_header_note || ''),
      receipt_footer_note: String(data?.receipt_footer_note || 'Thank you for your business!'),
      receipt_show_bank_details: data?.receipt_show_bank_details !== false,
      pin_checkout_enabled: data?.pin_checkout_enabled !== false,
      discount_codes: normalizeDiscountCodes(data?.discount_codes),
      staff_announcement_text: String(data?.staff_announcement_text || ''),
      staff_announcement_active: data?.staff_announcement_active === true,
      staff_announcement_updated_at: data?.staff_announcement_updated_at || null,
    };
  };

  const loadSettings = async () => {
    try {
      const data = await appFetch('/api/store/settings');
      setStore(await buildNormalizedStoreState(data));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (signatureSaving) {
      showNotification({ message: 'Please wait for the signature image to finish saving first.', type: 'warning' });
      return;
    }

    setSaving(true);
    setSuccess(false);
    try {
      await appFetch('/api/store/settings', {
        method: 'PUT',
        body: JSON.stringify(store),
      });
      const refreshed = await appFetch('/api/store/settings');
      setStore(await buildNormalizedStoreState(refreshed));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const persistStoreSettings = async (nextStore: any, successMessage?: string) => {
    setStore(nextStore);
    setSaving(true);
    setSuccess(false);
    try {
      await appFetch('/api/store/settings', {
        method: 'PUT',
        body: JSON.stringify(nextStore),
      });
      const refreshed = await appFetch('/api/store/settings');
      setStore(await buildNormalizedStoreState(refreshed));
      if (successMessage) {
        showNotification({ message: successMessage, type: 'success' });
      }
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const rawLogo = reader.result as string;
        const normalizedLogo = await normalizeLogoDataUrl(rawLogo);
        setStore({ ...store, logo: normalizedLogo || rawLogo });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSignatureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !store) return;

    const normalizedType = String(file.type || '').toLowerCase();
    if (normalizedType && !['image/png', 'image/jpeg', 'image/jpg'].includes(normalizedType)) {
      showNotification({ message: 'PNG is preferred, and JPG/JPEG is also accepted for signatures.', type: 'warning' });
      e.target.value = '';
      return;
    }

    setSignatureSaving(true);
    const reader = new FileReader();
    reader.onerror = () => {
      setSignatureSaving(false);
      e.target.value = '';
      showNotification({ message: 'Could not read that signature image. Please try again.', type: 'error' });
    };
    reader.onloadend = async () => {
      try {
        const rawSignature = reader.result as string;
        const normalizedSignature = await normalizeSignatureDataUrl(rawSignature);
        const nextStore = { ...store, signature_image: normalizedSignature || rawSignature };
        await persistStoreSettings(nextStore, 'Signature uploaded and saved.');
      } catch (err) {
        showNotification({ message: String(err), type: 'error' });
      } finally {
        setSignatureSaving(false);
        e.target.value = '';
      }
    };
    reader.readAsDataURL(file);
  };

  const addSpec = () => {
    if (!newSpec.trim()) return;
    if (store.custom_specs.includes(newSpec.trim())) return;
    setStore({ ...store, custom_specs: [...store.custom_specs, newSpec.trim()] });
    setNewSpec('');
  };

  const removeSpec = (spec: string) => {
    setStore({ ...store, custom_specs: store.custom_specs.filter((s: string) => s !== spec) });
  };

  const addDiscountCode = async () => {
    if (!store) return;

    const name = discountCodeForm.name.trim();
    const code = discountCodeForm.code.trim().toUpperCase().replace(/\s+/g, '');
    const type = discountCodeForm.type === 'FIXED' ? 'FIXED' : 'PERCENTAGE';
    const value = Math.max(0, Number(discountCodeForm.value) || 0);
    const expiresAt = discountCodeForm.expires_at.trim();
    const existingCodes = normalizeDiscountCodes(store.discount_codes);

    if (!name) {
      showNotification({ message: 'Enter a code name first.', type: 'warning' });
      return;
    }
    if (!code) {
      showNotification({ message: 'Enter the discount code text first.', type: 'warning' });
      return;
    }
    if (existingCodes.some((entry) => entry.code === code)) {
      showNotification({ message: `Discount code ${code} already exists.`, type: 'warning' });
      return;
    }
    if (value <= 0) {
      showNotification({ message: 'Enter a discount value greater than zero.', type: 'warning' });
      return;
    }
    if (type === 'PERCENTAGE' && value > 100) {
      showNotification({ message: 'Percentage discount cannot be more than 100%.', type: 'warning' });
      return;
    }
    if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      showNotification({ message: 'Expiry date must be a valid YYYY-MM-DD value.', type: 'warning' });
      return;
    }

    const nextStore = {
      ...store,
      discount_codes: [
        ...existingCodes,
        {
          id: `discount-${code.toLowerCase()}-${Date.now()}`,
          name,
          code,
          type,
          value: type === 'PERCENTAGE' ? Math.min(100, value) : Number(value.toFixed(2)),
          expires_at: expiresAt || null,
          active: discountCodeForm.active !== false,
        },
      ],
    };

    setDiscountCodeForm(createEmptyDiscountCodeForm());
    await persistStoreSettings(nextStore, `Discount code ${code} saved.`);
  };

  const toggleDiscountCodeActive = async (entryId: string) => {
    if (!store) return;

    const nextCodes = normalizeDiscountCodes(store.discount_codes).map((entry) => (
      entry.id === entryId ? { ...entry, active: !entry.active } : entry
    ));
    const toggled = nextCodes.find((entry) => entry.id === entryId);
    await persistStoreSettings(
      { ...store, discount_codes: nextCodes },
      toggled?.active ? `${toggled.code} is now active.` : `${toggled?.code || 'Discount code'} has been paused.`
    );
  };

  const removeDiscountCode = async (entryId: string) => {
    if (!store) return;

    const existingCodes = normalizeDiscountCodes(store.discount_codes);
    const removed = existingCodes.find((entry) => entry.id === entryId);
    const nextCodes = existingCodes.filter((entry) => entry.id !== entryId);
    await persistStoreSettings(
      { ...store, discount_codes: nextCodes },
      removed ? `${removed.code} removed.` : 'Discount code removed.'
    );
  };

  const postStaffAnnouncement = async () => {
    if (!store) return;

    const message = String(store.staff_announcement_text || '').trim().slice(0, 240);
    if (!message) {
      showNotification({ message: 'Enter a short reminder before posting the banner.', type: 'warning' });
      return;
    }

    await persistStoreSettings({
      ...store,
      staff_announcement_text: message,
      staff_announcement_active: true,
      staff_announcement_updated_at: new Date().toISOString(),
    }, 'Announcement posted for staff.');
  };

  const clearStaffAnnouncement = async () => {
    if (!store) return;

    await persistStoreSettings({
      ...store,
      staff_announcement_text: '',
      staff_announcement_active: false,
      staff_announcement_updated_at: null,
    }, 'Announcement cleared.');
  };

  const handleExport = async () => {
    try {
      const data = await appFetch('/api/admin/store/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `store_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setRetentionBackupDownloaded(true);
      showNotification({ message: 'Store backup downloaded successfully.', type: 'success' });
    } catch (err) {
      showNotification({ message: 'Export failed: ' + err, type: 'error' });
    }
  };

  const runRetentionPreview = async () => {
    if (retentionMode === 'CUSTOM' && (!retentionFromDate || !retentionToDate)) {
      showNotification({ message: 'Select a valid custom date range first.', type: 'warning' });
      return;
    }

    setRetentionPreviewLoading(true);
    try {
      const payload = {
        mode: retentionMode,
        fromDate: retentionMode === 'CUSTOM' ? retentionFromDate : null,
        toDate: retentionMode === 'CUSTOM' ? retentionToDate : null,
      };
      const preview = await appFetch('/api/admin/store/retention/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setRetentionPreview(preview);
      setRetentionBackupDownloaded(false);
      setRetentionReportDownloaded(false);
      setRetentionConfirmationText('');
      showNotification({ message: `Preview ready. ${Number(preview?.totalRows || 0)} row(s) in scope.`, type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to preview retention cleanup.'), type: 'error' });
    } finally {
      setRetentionPreviewLoading(false);
    }
  };

  const downloadRetentionActivityPdf = async () => {
    if (!retentionPreview) {
      showNotification({ message: 'Run retention preview before generating archive PDF.', type: 'warning' });
      return;
    }

    try {
      const payload = {
        mode: retentionMode,
        fromDate: retentionMode === 'CUSTOM' ? retentionFromDate : null,
        toDate: retentionMode === 'CUSTOM' ? retentionToDate : null,
      };
      const summary = await appFetch('/api/admin/store/retention/activity-summary', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const { doc, filename } = await generateStoreActivityArchivePDF(summary, store, user);
      doc.save(filename);
      setRetentionReportDownloaded(true);
      showNotification({ message: 'Store activity archive PDF downloaded.', type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to generate archive PDF.'), type: 'error' });
    }
  };

  const getRetentionDeleteValidationError = () => {
    if (!isOwner) return 'Only store owner accounts can run this deletion.';
    if (!retentionPreview) return 'Run retention preview first.';
    if (!retentionBackupDownloaded || !retentionReportDownloaded) {
      return 'Download JSON backup and activity PDF before deleting.';
    }
    if (retentionConfirmationText.trim().toUpperCase() !== 'DELETE STORE DATA') {
      return 'Type DELETE STORE DATA to confirm.';
    }
    return null;
  };

  const executeRetentionDelete = async () => {
    const validationError = getRetentionDeleteValidationError();
    if (validationError) {
      showNotification({ message: validationError, type: 'warning' });
      return;
    }

    setRetentionDeleteLoading(true);
    setShowRetentionDeleteConfirm(false);
    try {
      const payload = {
        mode: retentionMode,
        fromDate: retentionMode === 'CUSTOM' ? retentionFromDate : null,
        toDate: retentionMode === 'CUSTOM' ? retentionToDate : null,
        backupDownloaded: retentionBackupDownloaded,
        reportDownloaded: retentionReportDownloaded,
        confirmationText: retentionConfirmationText,
      };
      const result = await appFetch('/api/admin/store/retention/delete', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      showNotification({ message: `Retention delete completed. ${Number(result?.totalDeleted || 0)} row(s) removed.`, type: 'success' });
      setRetentionPreview(null);
      setRetentionBackupDownloaded(false);
      setRetentionReportDownloaded(false);
      setRetentionConfirmationText('');
      setShowRetentionDeleteConfirm(false);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Retention deletion failed.'), type: 'error' });
    } finally {
      setRetentionDeleteLoading(false);
    }
  };

  const requestRetentionDeleteConfirm = () => {
    const validationError = getRetentionDeleteValidationError();
    if (validationError) {
      showNotification({ message: validationError, type: 'warning' });
      return;
    }
    setShowRetentionDeleteConfirm(true);
  };

  const retentionCountRows = Object.entries(retentionPreview?.counts || {})
    .map(([key, value]) => ({
      key,
      label: key.replace(/_/g, ' '),
      count: Number(value || 0),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);

  const retentionChartMax = retentionCountRows.reduce((max, row) => Math.max(max, row.count), 0);

  const getImportRiskSummary = () => {
    if (!importPrecheck) {
      return {
        score: 0,
        level: 'N/A',
        tone: 'border-slate-700 bg-slate-900/70 text-slate-300',
      };
    }

    const diagnostics = importPrecheck?.diagnostics || {};
    const warningCount = Array.isArray(importPrecheck?.warnings) ? importPrecheck.warnings.length : 0;
    const duplicateCount = Array.isArray(diagnostics?.duplicateBarcodes) ? diagnostics.duplicateBarcodes.length : 0;
    const brokenRefs = Number(diagnostics?.missingCategoryRefs || 0)
      + Number(diagnostics?.missingSaleUserRefs || 0)
      + Number(diagnostics?.missingSaleCustomerRefs || 0)
      + Number(diagnostics?.missingSaleItemSaleRefs || 0)
      + Number(diagnostics?.missingSaleItemProductRefs || 0);
    const typeMismatches = Number(
      Object.values(diagnostics?.booleanInIntegerFields || {})
        .reduce((sum: number, value: any) => sum + Number(value || 0), 0)
    );

    const score = Math.max(0, Math.min(100,
      (warningCount * 12)
      + (duplicateCount * 10)
      + Math.min(40, brokenRefs * 2)
      + Math.min(20, typeMismatches)
    ));

    if (score >= 55) {
      return {
        score,
        level: 'Risky',
        tone: 'border-rose-500/40 bg-rose-900/200/10 text-rose-200',
      };
    }
    if (score >= 25) {
      return {
        score,
        level: 'Needs Review',
        tone: 'border-amber-500/40 bg-amber-900/200/10 text-amber-200',
      };
    }

    return {
      score,
      level: 'Safe',
      tone: 'border-emerald-500/40 bg-emerald-900/200/10 text-emerald-200',
    };
  };

  const getImportFixSuggestions = () => {
    if (!importPrecheck) return [] as string[];

    const diagnostics = importPrecheck?.diagnostics || {};
    const suggestions: string[] = [];

    if ((Array.isArray(diagnostics?.duplicateBarcodes) ? diagnostics.duplicateBarcodes.length : 0) > 0) {
      suggestions.push('Resolve duplicate barcode values before import to avoid scan conflicts.');
    }
    if (Number(diagnostics?.missingCategoryRefs || 0) > 0) {
      suggestions.push('Add missing categories in the backup or remove invalid category_id links from products.');
    }
    if (Number(diagnostics?.missingSaleUserRefs || 0) > 0) {
      suggestions.push('Ensure all sales user_id values exist in users for clean ownership/audit history.');
    }
    if (Number(diagnostics?.missingSaleCustomerRefs || 0) > 0) {
      suggestions.push('Fix sales customer_id references or set them to null when customer records are missing.');
    }
    if (Number(diagnostics?.missingSaleItemSaleRefs || 0) > 0 || Number(diagnostics?.missingSaleItemProductRefs || 0) > 0) {
      suggestions.push('Repair sale item references so each sale_item links to a valid sale and product.');
    }

    const booleanMismatches = Number(
      Object.values(diagnostics?.booleanInIntegerFields || {})
        .reduce((sum: number, value: any) => sum + Number(value || 0), 0)
    );
    if (booleanMismatches > 0) {
      suggestions.push('Integer-backed flags contain booleans; importer will normalize them, but review source formatting for consistency.');
    }

    if (suggestions.length === 0) {
      suggestions.push('No critical fixes required. You can proceed with import confidently.');
    }

    return suggestions;
  };

  const downloadImportPrecheckJson = () => {
    if (!importPrecheck) return;

    const payload = {
      generatedAt: new Date().toISOString(),
      fileName: pendingImportFile?.name || null,
      importMode,
      risk: getImportRiskSummary(),
      ...importPrecheck,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `import-precheck-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const downloadImportPrecheckPdf = () => {
    if (!importPrecheck) return;

    const diagnostics = importPrecheck?.diagnostics || {};
    const warnings = Array.isArray(importPrecheck?.warnings) ? importPrecheck.warnings : [];
    const risk = getImportRiskSummary();
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 52;

    doc.setFontSize(16);
    doc.text('GoodyPOS Import Precheck Report', 40, y);
    y += 24;

    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 40, y);
    y += 14;
    doc.text(`File: ${pendingImportFile?.name || 'N/A'}`, 40, y);
    y += 14;
    doc.text(`Mode: ${importMode === 'merge' ? 'Smart Merge' : 'Replace All'}`, 40, y);
    y += 14;
    doc.text(`Risk: ${risk.level} (${risk.score}/100)`, 40, y);
    y += 22;

    doc.setFontSize(11);
    doc.text('Summary', 40, y);
    y += 16;
    doc.setFontSize(10);
    doc.text(`Products: ${Number(importPrecheck?.summary?.products || 0)}`, 40, y); y += 13;
    doc.text(`Sales: ${Number(importPrecheck?.summary?.sales || 0)}`, 40, y); y += 13;
    doc.text(`Customers: ${Number(importPrecheck?.summary?.customers || 0)}`, 40, y); y += 13;
    doc.text(`Users: ${Number(importPrecheck?.summary?.users || 0)}`, 40, y); y += 20;

    doc.setFontSize(11);
    doc.text('Warnings', 40, y);
    y += 16;
    doc.setFontSize(10);
    if (warnings.length === 0) {
      doc.text('No warnings detected.', 40, y);
      y += 13;
    } else {
      warnings.slice(0, 12).forEach((warning: string) => {
        const lines = doc.splitTextToSize(`- ${warning}`, 510);
        doc.text(lines, 40, y);
        y += (lines.length * 13);
      });
    }

    y += 8;
    doc.setFontSize(11);
    doc.text('Diagnostics', 40, y);
    y += 16;
    doc.setFontSize(10);
    const diagnosticLines = [
      `Duplicate barcodes: ${Array.isArray(diagnostics?.duplicateBarcodes) ? diagnostics.duplicateBarcodes.length : 0}`,
      `Missing category refs: ${Number(diagnostics?.missingCategoryRefs || 0)}`,
      `Missing sale user refs: ${Number(diagnostics?.missingSaleUserRefs || 0)}`,
      `Missing sale customer refs: ${Number(diagnostics?.missingSaleCustomerRefs || 0)}`,
      `Broken sale item refs: ${Number(diagnostics?.missingSaleItemSaleRefs || 0) + Number(diagnostics?.missingSaleItemProductRefs || 0)}`,
    ];

    diagnosticLines.forEach((line) => {
      doc.text(line, 40, y);
      y += 13;
    });

    doc.save(`import-precheck-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImportPrecheckLoading(true);
    setImportPrecheck(null);

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const precheck = await appFetch('/api/admin/store/import/precheck', {
        method: 'POST',
        body: JSON.stringify({ data: parsed }),
      });

      setPendingImportFile(file);
      setPendingImportData(parsed);
      setImportPrecheck(precheck || null);
      setShowImportConfirm(true);
    } catch (err: any) {
      showNotification({ message: `Import precheck failed: ${String(err?.message || err || 'Invalid backup file')}`, type: 'error' });
      setPendingImportFile(null);
      setPendingImportData(null);
    } finally {
      setImportPrecheckLoading(false);
      e.target.value = '';
    }
  };

  const cancelImport = () => {
    setShowImportConfirm(false);
    setPendingImportFile(null);
    setPendingImportData(null);
    setImportPrecheck(null);
    setImportMode('replace');
  };

  const confirmImport = async () => {
    if (!pendingImportData) return;

    setImporting(true);
    try {
      await appFetch('/api/admin/store/import', {
        method: 'POST',
        body: JSON.stringify({ data: pendingImportData, mode: importMode }),
      });
      setShowImportConfirm(false);
      setPendingImportFile(null);
      setPendingImportData(null);
      setImportPrecheck(null);
      showNotification({ message: `Import successful in ${importMode === 'merge' ? 'Smart Merge' : 'Replace All'} mode. The page will now reload.`, type: 'success' });
      window.location.reload();
    } catch (err) {
      showNotification({ message: 'Import failed: ' + err, type: 'error' });
      setImporting(false);
    }
  };

  const runSystemOptimization = async () => {
    setHealthBusy(true);
    setShowHealthModal(true);
    setHealthProgress(8);
    setHealthStep('Checkpointing local WAL logs...');

    const progressTimer = window.setInterval(() => {
      setHealthProgress((prev) => {
        const next = Math.min(prev + 11, 92);
        if (next < 35) {
          setHealthStep('Checkpointing local WAL logs...');
        } else if (next < 70) {
          setHealthStep('Vacuuming and compacting the database...');
        } else {
          setHealthStep('Scanning uploads for unused media...');
        }
        return next;
      });
    }, 220);

    try {
      const result = await appFetch('/api/system-health/optimize', { method: 'POST' });
      window.clearInterval(progressTimer);
      setHealthProgress(100);
      setHealthStep('Optimization complete. Your financial totals remain untouched.');
      setHealthResult(result || null);
      setTimeout(() => {
        setShowHealthModal(false);
        setHealthBusy(false);
      }, 700);
      showNotification({
        message: result?.message || `Optimization Complete! ${Number(result?.spaceRecoveredMb || 0).toFixed(2)}MB of space recovered.`,
        type: 'success',
      });
    } catch (err) {
      window.clearInterval(progressTimer);
      setHealthBusy(false);
      setHealthStep('Cleanup failed.');
      setShowHealthModal(false);
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const handleDangerAction = async () => {
    if (!dangerAction) return;

    setDangerLoading(true);
    try {
      const endpoint = dangerAction === 'proformas'
        ? '/api/system-health/clear-expired-proformas'
        : '/api/system-health/clear-old-activity-logs';
      const result = await appFetch(endpoint, { method: 'POST' });
      setDangerAction(null);
      showNotification({
        message: dangerAction === 'proformas'
          ? `Expired pro-formas cleared successfully. ${Number(result?.deletedCount || 0)} record(s) removed.`
          : `Old maintenance logs cleared successfully. ${Number(result?.deletedCount || 0)} log(s) removed. Immutable audit-vault records were preserved.`,
        type: 'success',
      });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setDangerLoading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  return (
    <>
      {showImportConfirm && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-xl rounded-[28px] border border-red-900/40 bg-slate-950 text-white shadow-2xl shadow-red-950/30 overflow-hidden">
            <div className="flex items-start justify-between p-6 pb-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                  <AlertTriangle size={28} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white">Confirm Import</h3>
                  <p className="text-sm text-slate-400">This action will replace your current store records.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={cancelImport}
                disabled={importing}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-slate-800 leading-6">
                <p className="font-bold text-red-300 mb-1">Critical warning</p>
                <p>
                  {importMode === 'replace'
                    ? <>This will overwrite <span className="font-bold text-white">products, sales, customers, and settings</span> for this store.</>
                    : <>Smart Merge keeps existing records and imports new entries while updating matched IDs.</>}
                </p>
                {pendingImportFile && (
                  <p className="mt-2 text-xs text-slate-300">Selected file: <span className="font-semibold text-white">{pendingImportFile.name}</span></p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Import Mode</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setImportMode('replace')}
                    disabled={importing}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${importMode === 'replace' ? 'border-red-400 bg-red-500/20 text-red-200' : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'}`}
                  >
                    Replace All
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportMode('merge')}
                    disabled={importing}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold transition-colors ${importMode === 'merge' ? 'border-emerald-400 bg-emerald-900/200/20 text-emerald-200' : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'}`}
                  >
                    Smart Merge
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-300">Import Precheck</p>
                {importPrecheckLoading ? (
                  <p className="mt-2 flex items-center gap-2 text-slate-300"><Loader2 size={14} className="animate-spin" /> Analyzing backup file...</p>
                ) : importPrecheck ? (
                  <div className="mt-2 space-y-2">
                    <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${getImportRiskSummary().tone}`}>
                      Precheck Score: {getImportRiskSummary().score}/100 - {getImportRiskSummary().level}
                    </div>
                    <p className="text-xs text-slate-300">
                      Records: {Number(importPrecheck?.summary?.products || 0)} products, {Number(importPrecheck?.summary?.sales || 0)} sales, {Number(importPrecheck?.summary?.customers || 0)} customers, {Number(importPrecheck?.summary?.users || 0)} users.
                    </p>
                    {(importPrecheck?.warnings || []).length > 0 ? (
                      <ul className="space-y-1 text-xs text-amber-200">
                        {(importPrecheck.warnings as string[]).slice(0, 4).map((warning, index) => (
                          <li key={index}>• {warning}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-emerald-300">No structural issues detected in precheck.</p>
                    )}

                    <div className="rounded-xl border border-slate-700 bg-slate-950/70 p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">Fix Suggestions</p>
                      <ul className="mt-2 space-y-1 text-xs text-slate-800">
                        {getImportFixSuggestions().slice(0, 5).map((item, index) => (
                          <li key={index}>- {item}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={downloadImportPrecheckJson}
                        className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-slate-100 hover:bg-slate-800"
                      >
                        Export Precheck JSON
                      </button>
                      <button
                        type="button"
                        onClick={downloadImportPrecheckPdf}
                        className="rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-slate-100 hover:bg-slate-800"
                      >
                        Export Precheck PDF
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">No precheck data yet.</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={cancelImport}
                  disabled={importing}
                  className="flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 font-bold text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={importing || importPrecheckLoading || !pendingImportData}
                  className="flex-1 rounded-2xl bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-700 shadow-lg shadow-red-950/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {importing ? <Loader2 className="animate-spin" size={18} /> : <Upload size={18} />}
                  {importing ? 'Importing...' : importPrecheckLoading ? 'Running Precheck...' : 'Yes, Import Data'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showHealthModal && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-emerald-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-cyan-50 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-emerald-100 p-3 text-emerald-400">
                  <Sparkles size={22} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">Cleaning System...</h3>
                  <p className="text-sm text-slate-600">Optimizing the database and clearing unused cache safely.</p>
                </div>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-300"
                  style={{ width: `${healthProgress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <p className="font-semibold text-slate-700">{healthStep}</p>
                <span className="font-black text-slate-900">{healthProgress}%</span>
              </div>
              <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
                Sales, expenses, and analytics figures are preserved during cleanup.
              </div>
            </div>
          </div>
        </div>
      )}

      {showRetentionDeleteConfirm && retentionPreview && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-[28px] border border-red-900/40 bg-slate-950 text-white shadow-2xl shadow-red-950/30 overflow-hidden">
            <div className="flex items-start justify-between p-6 pb-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                  <AlertTriangle size={28} />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-white">Final Retention Confirmation</h3>
                  <p className="text-sm text-slate-400">Review the scope before permanent deletion.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRetentionDeleteConfirm(false)}
                disabled={retentionDeleteLoading}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-slate-900">
                <p className="font-bold text-red-300">Range</p>
                <p className="mt-1">{retentionPreview?.range?.label || 'N/A'}</p>
                <p className="mt-2 font-bold text-red-300">Total rows to delete</p>
                <p className="mt-1 text-xl font-black text-white">{Number(retentionPreview?.totalRows || 0)}</p>
              </div>

              <div className="rounded-2xl border border-slate-700 bg-slate-900 p-4 space-y-2">
                {retentionCountRows.slice(0, 8).map((row) => {
                  const width = retentionChartMax > 0 ? Math.max(6, Math.round((row.count / retentionChartMax) * 100)) : 0;
                  return (
                    <div key={`modal-${row.key}`} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span className="font-semibold uppercase tracking-wide">{row.label}</span>
                        <span className="font-black text-white">{row.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-red-500 via-orange-500 to-amber-400" style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-slate-400">
                Backup downloaded: <span className="font-bold text-white">{retentionBackupDownloaded ? 'Yes' : 'No'}</span> • Archive PDF downloaded: <span className="font-bold text-white">{retentionReportDownloaded ? 'Yes' : 'No'}</span>
              </p>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowRetentionDeleteConfirm(false)}
                  disabled={retentionDeleteLoading}
                  className="flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 font-bold text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeRetentionDelete}
                  disabled={retentionDeleteLoading}
                  className="flex-1 rounded-2xl bg-red-600 px-4 py-3 font-bold text-white hover:bg-red-700 shadow-lg shadow-red-950/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {retentionDeleteLoading ? <Loader2 className="animate-spin" size={18} /> : <AlertTriangle size={18} />}
                  {retentionDeleteLoading ? 'Deleting...' : 'Confirm Permanent Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TABBED SETTINGS LAYOUT ── */}
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-white p-4 md:p-8">
        {/* Blur orbs */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
          <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-indigo-200/30 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-violet-200/20 blur-3xl" />
        </div>

        <div className="mx-auto max-w-5xl space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-black text-slate-900">Store Settings</h1>
              <p className="mt-1 text-sm text-slate-500">Configure identity, receipts, pricing, and more</p>
            </div>
            <Link to="/" className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50 transition-colors">
              <Home size={16} /> Home
            </Link>
          </div>

          {/* Tab bar */}
          <div className="flex flex-wrap gap-2 rounded-3xl bg-white p-2 shadow-sm border border-slate-100">
            {([
              { id: 'identity', label: 'Identity', icon: <Store size={15} /> },
              { id: 'receipts', label: 'Receipts', icon: <Sparkles size={15} /> },
              { id: 'pricing', label: 'Pricing', icon: <SettingsIcon size={15} /> },
              { id: 'promo', label: 'Promo & Staff', icon: <Plus size={15} /> },
              { id: 'columns', label: 'Columns', icon: <LayoutGrid size={15} /> },
              { id: 'data', label: 'Data & System', icon: <Download size={15} /> },
            ] as { id: typeof activeTab; label: string; icon: React.ReactNode }[]).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-200'}`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* ── TAB: IDENTITY ── */}
          {activeTab === 'identity' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-5">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Company Info</h2>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">Company Name</label>
                  <div className="relative">
                    <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input required className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.name} onChange={e => setStore({ ...store, name: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">Store Address</label>
                  <div className="relative">
                    <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input required className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.address || ''} onChange={e => setStore({ ...store, address: e.target.value })} />
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input required className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.phone || ''} onChange={e => setStore({ ...store, phone: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">Paper Size</label>
                    <select className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.receipt_paper_size || 'THERMAL'} onChange={e => setStore({ ...store, receipt_paper_size: e.target.value })}>
                      <option value="THERMAL">Thermal (80mm)</option>
                      <option value="THERMAL_58">Thermal (58mm)</option>
                      <option value="A4">A4 Paper</option>
                    </select>
                    <p className="mt-1.5 text-xs text-slate-400">Used for Smart Retail receipts after checkout.</p>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-bold text-slate-700">Invoice / Pro-forma Color</label>
                    <div className="flex items-center gap-3">
                      <input type="color" className="h-14 w-14 cursor-pointer rounded-xl border border-slate-200 bg-white p-1" value={store.document_color || '#F4BD4A'} onChange={e => setStore({ ...store, document_color: e.target.value.toUpperCase() })} />
                      <input className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 p-4 font-mono uppercase focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.document_color || '#F4BD4A'} onChange={e => { const raw = e.target.value.trim(); setStore({ ...store, document_color: raw.startsWith('#') ? raw.toUpperCase() : `#${raw.toUpperCase()}` }); }} placeholder="#F4BD4A" />
                    </div>
                <p className="mt-1.5 text-xs text-slate-400">Accent color for A4 invoices and pro-forma documents.</p>
                  </div>
                </div>

                {/* Logo & Signature side-by-side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 flex flex-col items-center text-center">
                    <p className="mb-4 text-xs font-black uppercase tracking-widest text-slate-400">Store Logo</p>
                    <div className="relative mb-4 h-28 w-28 overflow-hidden rounded-3xl border-2 border-dashed border-slate-200 bg-white flex items-center justify-center group">
                      {store.logo ? <img src={store.logo} alt="Logo" className="h-full w-full object-contain p-2" /> : <ImageIcon className="text-slate-300" size={40} />}
                      <label className="absolute inset-0 flex cursor-pointer items-center justify-center bg-slate-950/50 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="text-xs font-bold text-white">Change</span>
                        <input type="file" className="hidden" onChange={handleLogoChange} accept="image/*" />
                      </label>
                    </div>
                    <p className="text-[11px] text-slate-400">PNG preferred • ~900×260 px</p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <p className="text-xs font-black uppercase tracking-widest text-slate-400">Document Signature</p>
                      {store.signature_image && (
                        <button type="button" onClick={() => void persistStoreSettings({ ...store, signature_image: null }, 'Signature removed.')} disabled={signatureSaving || saving} className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100 disabled:opacity-60">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <div className="flex h-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white px-2">
                      {store.signature_image ? <img src={store.signature_image} alt="Signature" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-slate-400">No signature uploaded</span>}
                    </div>
                    <label className={`mt-3 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition-colors ${signatureSaving ? 'cursor-wait opacity-70' : 'cursor-pointer hover:bg-slate-100'}`}>
                      <Upload size={14} />
                      {signatureSaving ? 'Saving...' : store.signature_image ? 'Replace' : 'Upload'}
                      <input type="file" className="hidden" onChange={handleSignatureChange} accept="image/png,image/jpeg,image/jpg" disabled={signatureSaving} />
                    </label>
                  </div>
                </div>

                {/* Show name toggle */}
                <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Show Company Name when Logo Exists</h3>
                    <p className="mt-1 text-xs text-slate-500">Leave off if your logo already contains your brand name.</p>
                  </div>
                  <button type="button" onClick={() => setStore({ ...store, show_store_name_on_documents: !store.show_store_name_on_documents })} className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-full transition-colors ${store.show_store_name_on_documents ? 'bg-emerald-600' : 'bg-slate-300'}`} aria-pressed={store.show_store_name_on_documents}>
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${store.show_store_name_on_documents ? 'translate-x-9' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <button type="submit" disabled={saving || signatureSaving} className="w-full rounded-2xl bg-slate-900 py-4 font-bold text-white flex items-center justify-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50">
                {saving || signatureSaving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                {signatureSaving ? 'Saving Signature...' : 'Save Configuration'}
              </button>
              {success && <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">Store configuration saved successfully.</div>}
            </form>
          )}

          {/* ── TAB: RECEIPTS ── */}
          {activeTab === 'receipts' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-5">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Receipt Studio</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Header Note</label>
                    <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.receipt_header_note || ''} onChange={e => setStore({ ...store, receipt_header_note: e.target.value })} placeholder="e.g. Premium gadgets • Trusted service" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Footer Thank-you Note</label>
                    <textarea rows={3} className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 resize-none focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.receipt_footer_note || ''} onChange={e => setStore({ ...store, receipt_footer_note: e.target.value })} placeholder="Thank you for your business!" />
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-800">Show Bank Details on Pro-forma</label>
                    <p className="mt-1 text-xs text-slate-500">Display your payment account block when sharing quotations.</p>
                  </div>
                  <button type="button" onClick={() => setStore({ ...store, receipt_show_bank_details: !store.receipt_show_bank_details })} className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-full transition-colors ${store.receipt_show_bank_details ? 'bg-emerald-600' : 'bg-slate-300'}`} aria-pressed={store.receipt_show_bank_details}>
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${store.receipt_show_bank_details ? 'translate-x-9' : 'translate-x-1'}`} />
                  </button>
                </div>

                {/* Receipt preview */}
                <div className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between px-4 py-3 text-white" style={{ backgroundColor: store.document_color || '#F4BD4A' }}>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-80">{store.receipt_paper_size === 'A4' ? 'A4 Invoice' : store.receipt_paper_size === 'THERMAL_58' ? 'Thermal Receipt (58mm)' : 'Thermal Receipt (80mm)'}</p>
                      {(!store.logo || store.show_store_name_on_documents) && <p className="text-base font-black">{store.name || 'Your Business Name'}</p>}
                    </div>
                    <p className="text-xs font-semibold opacity-90">Preview</p>
                  </div>
                  <div className="space-y-2 bg-white p-4 text-sm text-slate-600">
                    <p className="font-semibold text-slate-900">{store.receipt_header_note || 'Your branded receipt headline appears here.'}</p>
                    <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                      <p>Customer: Walk-in Customer</p>
                      <p>Total: {formatCurrency(12500, { currencyCode: store.currency_code })}</p>
                      {store.receipt_show_bank_details && <p className="mt-1">Bank: {store.bank_name || 'Bank details will appear here'}</p>}
                    </div>
                    <p className="text-xs text-slate-500">{store.receipt_footer_note || 'Thank you for your business!'}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-5">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Bank Details (for Pro-forma)</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Bank Name</label>
                    <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.bank_name || ''} onChange={e => setStore({ ...store, bank_name: e.target.value })} placeholder="e.g. Zenith Bank" />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Account Number</label>
                    <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.account_number || ''} onChange={e => setStore({ ...store, account_number: e.target.value })} placeholder="e.g. 1234567890" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">Account Name</label>
                    <input className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.account_name || ''} onChange={e => setStore({ ...store, account_name: e.target.value })} placeholder="e.g. Goody Gadgets Ltd" />
                  </div>
                </div>
              </div>

              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">PIN Approval</h2>
                <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Smart Retail Checkout PIN Approval</h3>
                    <p className="mt-1 text-xs text-slate-500">Applies in Smart Retail Mode only.</p>
                  </div>
                  <button type="button" onClick={() => setStore({ ...store, pin_checkout_enabled: !store.pin_checkout_enabled })} className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-full transition-colors ${store.pin_checkout_enabled ? 'bg-emerald-600' : 'bg-slate-300'}`} aria-pressed={store.pin_checkout_enabled}>
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${store.pin_checkout_enabled ? 'translate-x-9' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <button type="submit" disabled={saving} className="w-full rounded-2xl bg-slate-900 py-4 font-bold text-white flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                Save Configuration
              </button>
              {success && <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">Store configuration saved successfully.</div>}
            </form>
          )}

          {/* ── TAB: PRICING ── */}
          {activeTab === 'pricing' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-5">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Currency & Regional Format</h2>

                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_200px] gap-5">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Default Currency</label>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">{POPULAR_CURRENCIES.length} options</span>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                        <Search size={16} className="text-slate-400" />
                        <input value={currencySearch} onChange={e => setCurrencySearch(e.target.value)} placeholder="Search currency, code, or symbol" className="w-full bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none" />
                      </div>
                      <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                        <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                          {filteredCurrencies.map((currency) => {
                            const isSelected = store.currency_code === currency.code;
                            return (
                              <button key={currency.code} type="button" onClick={() => { const nextStore = { ...store, currency_code: currency.code }; setStore(nextStore); applyCurrencyPreferenceFromStore(nextStore); }} className={`group flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-all ${isSelected ? 'bg-slate-900 text-white' : 'bg-white text-slate-200 hover:bg-slate-50'}`}>
                                <div className="flex min-w-0 items-center gap-3">
                                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl border text-sm font-black ${isSelected ? 'border-white/20 bg-white/10 text-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{currency.symbol}</div>
                                  <div className="min-w-0">
                                    <p className={`truncate text-sm font-bold ${isSelected ? 'text-white' : 'text-slate-900'}`}>{currency.label}</p>
                                    <p className={`text-[11px] uppercase tracking-widest ${isSelected ? 'text-slate-800' : 'text-slate-500'}`}>{currency.code} • {currency.locale}</p>
                                  </div>
                                </div>
                                <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${isSelected ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-600'}`}>{isSelected ? 'Selected' : 'Use'}</span>
                              </button>
                            );
                          })}
                          {!filteredCurrencies.length && <div className="px-4 py-6 text-center text-sm text-slate-500">No currencies matched that search.</div>}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-slate-500">Live Preview</p>
                      <div className="mt-2 space-y-1.5">
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Quick Sale</p>
                          <p className="mt-0.5 break-words text-[15px] font-black leading-tight text-slate-900">{formatCurrency(12500, { currencyCode: store.currency_code })}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Expense</p>
                          <p className="mt-0.5 break-words text-[15px] font-black leading-tight text-slate-900">{formatCurrency(2450.5, { currencyCode: store.currency_code })}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-900 px-2 py-1.5 text-[8px] font-bold uppercase tracking-[0.2em] text-white">
                        <span>{selectedCurrency.code}</span>
                        <span className="h-1 w-1 rounded-full bg-slate-400" />
                        <span>{selectedCurrency.symbol}</span>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-3 py-2 text-white">
                        <p className="text-[8px] font-black uppercase tracking-[0.28em]">Current Choice</p>
                        <p className="mt-1 break-words text-[13px] font-black leading-snug">{selectedCurrency.label}</p>
                      </div>
                      <div className="space-y-1.5 px-3 py-2">
                        <div className="rounded-lg bg-slate-50 px-2.5 py-2"><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">Code</p><p className="mt-0.5 text-sm font-black text-slate-900">{selectedCurrency.code}</p></div>
                        <div className="rounded-lg bg-emerald-900/20 px-2.5 py-2"><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-400">Receipt</p><p className="mt-0.5 text-sm font-black text-emerald-400">{formatCurrency(98765.43, { currencyCode: store.currency_code })}</p></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-5">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">VAT Settings</h2>

                <div className="flex items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-800">VAT (7.5%)</label>
                    <p className="mt-1 text-xs text-slate-500">Separates tax from revenue in accountant reports.</p>
                  </div>
                  <button type="button" onClick={() => { const nextStore = { ...store, tax_enabled: !store.tax_enabled, tax_percentage: !store.tax_enabled ? 7.5 : Math.min(100, Math.max(0, Number(store.tax_percentage) || 0)) }; persistStoreSettings(nextStore, `VAT ${nextStore.tax_enabled ? 'enabled' : 'disabled'}`); }} className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-full transition-colors ${store.tax_enabled ? 'bg-emerald-600' : 'bg-slate-300'}`} aria-pressed={store.tax_enabled}>
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${store.tax_enabled ? 'translate-x-9' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-500">VAT Percentage (%)</label>
                    <input type="number" min="0" max="100" step="0.01" disabled={!store.tax_enabled} className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:bg-slate-100 disabled:text-slate-400" value={store.tax_percentage ?? 0} onChange={e => setStore({ ...store, tax_percentage: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} onBlur={() => persistStoreSettings({ ...store, tax_percentage: Math.min(100, Math.max(0, Number(store.tax_percentage) || 0)) }, 'Tax percentage saved')} />
                  </div>
                  <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 px-4 py-3">
                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-400">Preview</p>
                    <p className="mt-2 text-sm text-emerald-300">{store.tax_enabled && Number(store.tax_percentage) > 0 ? `A ${Number(store.tax_percentage)}% VAT will be separated at checkout.` : 'VAT is currently disabled.'}</p>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-900/20 p-4">
                  <div>
                    <label className="block text-sm font-bold text-amber-300">Default Missing Cost to Selling Price</label>
                    <p className="mt-1 text-xs text-amber-300">Items without a saved cost use the selling price for analytics (zero profit instead of excluded).</p>
                  </div>
                  <button type="button" onClick={() => { const nextStore = { ...store, default_missing_cost_to_price: !store.default_missing_cost_to_price }; persistStoreSettings(nextStore, nextStore.default_missing_cost_to_price ? 'Missing-cost defaulting enabled' : 'Missing-cost defaulting disabled'); }} className={`relative inline-flex h-8 w-16 shrink-0 items-center rounded-full transition-colors ${store.default_missing_cost_to_price ? 'bg-amber-900/200' : 'bg-slate-300'}`} aria-pressed={store.default_missing_cost_to_price}>
                    <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${store.default_missing_cost_to_price ? 'translate-x-9' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <button type="submit" disabled={saving} className="w-full rounded-2xl bg-slate-900 py-4 font-bold text-white flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                Save Configuration
              </button>
              {success && <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700">Store configuration saved successfully.</div>}
            </form>
          )}

          {/* ── TAB: PROMO & STAFF ── */}
          {activeTab === 'promo' && (
            <div className="space-y-5">
              {/* Discount Codes */}
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Checkout Discount Codes</h2>
                    <p className="mt-1 text-sm text-slate-500">Promo codes cashiers type at checkout for automatic discounts.</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white"><Plus size={12} /> Cashier Ready</div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div><label className="mb-2 block text-sm font-bold text-slate-700">Code Name</label><input aria-label="Code Name" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900" value={discountCodeForm.name} onChange={e => setDiscountCodeForm({ ...discountCodeForm, name: e.target.value })} placeholder="e.g. Welcome 10" /></div>
                  <div><label className="mb-2 block text-sm font-bold text-slate-700">Discount Code</label><input aria-label="Discount Code" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-slate-900" value={discountCodeForm.code} onChange={e => setDiscountCodeForm({ ...discountCodeForm, code: e.target.value.toUpperCase().replace(/\s+/g, '') })} placeholder="WELCOME10" /></div>
                  <div><label className="mb-2 block text-sm font-bold text-slate-700">Type</label><select aria-label="Type" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900" value={discountCodeForm.type} onChange={e => setDiscountCodeForm({ ...discountCodeForm, type: e.target.value === 'FIXED' ? 'FIXED' : 'PERCENTAGE' })}><option value="PERCENTAGE">Percentage (%)</option><option value="FIXED">Fixed Amount</option></select></div>
                  <div><label className="mb-2 block text-sm font-bold text-slate-700">Value</label><input aria-label="Value" type="number" min={0} max={discountCodeForm.type === 'PERCENTAGE' ? 100 : undefined} step="0.01" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900" value={discountCodeForm.value} onChange={e => setDiscountCodeForm({ ...discountCodeForm, value: e.target.value })} placeholder={discountCodeForm.type === 'PERCENTAGE' ? '10' : '1000'} /></div>
                  <div><label className="mb-2 block text-sm font-bold text-slate-700">Expiry (Optional)</label><input aria-label="Expiry" type="date" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-slate-900" value={discountCodeForm.expires_at} onChange={e => setDiscountCodeForm({ ...discountCodeForm, expires_at: e.target.value })} /></div>
                  <div className="flex items-end"><button type="button" onClick={() => void addDiscountCode()} disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-60"><Plus size={16} /> Add Code</button></div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">Saved Codes</p>
                      <p className="text-xs text-slate-500">Cashiers can type these at checkout and the discount applies automatically.</p>
                    </div>
                    <span className="rounded-full bg-white border border-slate-200 px-3 py-1 text-[11px] font-bold text-slate-600">
                      {normalizeDiscountCodes(store.discount_codes).length} total
                    </span>
                  </div>

                  <div className="space-y-3">
                    {normalizeDiscountCodes(store.discount_codes).length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                        No discount codes yet. Add one above to enable quick cashier promos.
                      </div>
                    ) : normalizeDiscountCodes(store.discount_codes).map((entry: DiscountCodeConfig) => {
                      const expired = Boolean(entry.expires_at) && new Date(`${entry.expires_at}T23:59:59`).getTime() < Date.now();
                      return (
                        <div key={entry.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-bold text-slate-900">{entry.name}</p>
                              <span className="rounded-full bg-slate-900 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-white">{entry.code}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${entry.active ? 'bg-emerald-100 text-emerald-400' : 'bg-slate-200 text-slate-600'}`}>
                                {entry.active ? 'Active' : 'Inactive'}
                              </span>
                              {expired && (
                                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-400">Expired</span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-slate-600">
                              {entry.type === 'PERCENTAGE' ? `${entry.value}% off` : `${formatCurrency(entry.value, { currencyCode: store.currency_code })} off`}
                              {entry.expires_at ? ` • Expires ${entry.expires_at}` : ' • No expiry'}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void toggleDiscountCodeActive(entry.id)}
                              disabled={saving}
                              className={`rounded-xl px-3 py-2 text-xs font-bold transition-colors ${entry.active ? 'bg-amber-100 text-amber-300 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-300 hover:bg-emerald-200'} disabled:opacity-60`}
                            >
                              {entry.active ? 'Set Inactive' : 'Set Active'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeDiscountCode(entry.id)}
                              disabled={saving}
                              className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60"
                            >
                              <Trash2 size={14} /> Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Staff Announcement Banner */}
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Staff Announcement Banner</h2>
                    <p className="mt-1 text-sm text-slate-500">Shows on the login screen and dashboard for your team.</p>
                  </div>
                  <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${store.staff_announcement_active ? 'bg-amber-900/200 text-white' : 'bg-slate-200 text-slate-300'}`}>
                    {store.staff_announcement_active ? 'Live' : 'Hidden'}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-700">Announcement Note</label>
                  <textarea aria-label="Staff Announcement Note" rows={3} maxLength={240} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-slate-900" value={store.staff_announcement_text || ''} onChange={e => setStore({ ...store, staff_announcement_text: e.target.value.slice(0, 240), staff_announcement_active: Boolean(e.target.value.trim()) })} placeholder="e.g. Transfer customers must wait for confirmation." />
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span>Quick staff reminders and day-to-day instructions.</span>
                    <span>{String(store.staff_announcement_text || '').length}/240</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => void postStaffAnnouncement()} disabled={saving} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-60"><Save size={16} /> Post Announcement</button>
                  <button type="button" onClick={() => void clearStaffAnnouncement()} disabled={saving || !String(store.staff_announcement_text || '').trim()} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"><Trash2 size={16} /> Clear Banner</button>
                </div>

                <div className={`rounded-2xl border px-4 py-3 text-sm ${store.staff_announcement_active && String(store.staff_announcement_text || '').trim() ? 'border-amber-200 bg-amber-900/20 text-amber-300' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  {store.staff_announcement_active && String(store.staff_announcement_text || '').trim() ? `Live: ${String(store.staff_announcement_text || '').trim()}` : 'No active banner.'}
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: COLUMNS ── */}
          {activeTab === 'columns' && (
            <div className="space-y-5">
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Dynamic Column Manager</h2>
                    <p className="mt-1 text-sm text-slate-500">Custom product specification fields shown in the product table.</p>
                  </div>
                  <SettingsIcon className="text-slate-300" size={22} />
                </div>

                <div className="flex gap-2">
                  <input className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 p-3 focus:outline-none focus:ring-2 focus:ring-slate-900" value={newSpec} onChange={e => setNewSpec(e.target.value)} placeholder="e.g. Processor, Warranty, Color" onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addSpec())} />
                  <button type="button" onClick={addSpec} className="rounded-2xl bg-slate-900 p-3 text-white hover:bg-slate-800 transition-colors"><Plus size={20} /></button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {store.custom_specs.map((spec: string) => (
                    <div key={spec} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-3 group">
                      <span className="text-sm font-semibold text-slate-700">{spec}</span>
                      <button type="button" onClick={() => removeSpec(spec)} className="p-1 text-slate-400 opacity-0 transition-colors hover:text-red-600 group-hover:opacity-100"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {store.custom_specs.length === 0 && (
                    <div className="col-span-2 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 py-8 text-center">
                      <p className="text-xs text-slate-400">No custom columns defined</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: DATA & SYSTEM ── */}
          {activeTab === 'data' && (
            <div className="space-y-5">
              {/* Appearance */}
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Appearance</h2>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{resolvedTheme === 'dark' ? 'Dark mode is active' : 'Light mode is active'}</p>
                  </div>
                  <div className={`rounded-xl p-3 ${resolvedTheme === 'dark' ? 'bg-slate-900 text-white' : 'bg-amber-100 text-amber-400'}`}>
                    {resolvedTheme === 'dark' ? <Moon size={18} /> : <SunMedium size={18} />}
                  </div>
                </div>
                <button type="button" onClick={toggleTheme} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors">
                  Switch to {resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode
                </button>
              </div>

              {/* Business Mode */}
              <div className="rounded-3xl bg-slate-900 p-6 shadow-sm border border-slate-800 text-white">
                <h2 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-500">Business Mode</h2>
                <div className="flex items-center gap-4">
                  <div className="rounded-xl bg-slate-800 p-3 text-red-500">{store.mode === 'SUPERMARKET' ? <ListFilter /> : <LayoutGrid />}</div>
                  <div>
                    <p className="font-bold">{store.mode}</p>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500">Locked by System Owner</p>
                  </div>
                </div>
              </div>

              {/* Export / Import */}
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Data Management</h2>
                <button onClick={handleExport} className="w-full rounded-2xl bg-slate-100 py-4 text-slate-900 font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-all"><Download size={20} /> Export Store Data</button>
                <div className="relative">
                  <input type="file" id="import-file" className="hidden" accept=".json" onChange={handleImport} />
                  <label htmlFor="import-file" className="w-full py-4 bg-red-50 text-red-600 border border-red-100 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-100 transition-all cursor-pointer"><Upload size={20} /> Import Store Data</label>
                </div>
                <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 px-4 py-3 text-center">
                  <p className="text-xs font-bold text-emerald-400">Auto daily local backup is enabled</p>
                  <p className="mt-1 text-[10px] text-emerald-600">Backups stored in <span className="font-mono">backups/daily</span>.</p>
                </div>
                <p className="text-center text-[10px] text-slate-400">Warning: Replace All overwrites store records. Smart Merge preserves existing records.</p>
              </div>

              {/* Data Retention */}
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-red-100 space-y-4">
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-red-500">Data Retention Cleanup</h2>
                <p className="text-sm font-semibold text-slate-900">Delete old store activity by 1-year rule or custom date range</p>

                <div className="space-y-3">
                  <select value={retentionMode} onChange={e => { setRetentionMode(e.target.value === 'CUSTOM' ? 'CUSTOM' : 'ONE_YEAR'); setRetentionPreview(null); }} className="w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800">
                    <option value="ONE_YEAR">Older than 1 year</option>
                    <option value="CUSTOM">Custom date range</option>
                  </select>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600">From date</label><input type="date" value={retentionFromDate} onChange={e => setRetentionFromDate(e.target.value)} disabled={retentionMode !== 'CUSTOM'} className="w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50" /></div>
                    <div className="space-y-1"><label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600">To date</label><input type="date" value={retentionToDate} onChange={e => setRetentionToDate(e.target.value)} disabled={retentionMode !== 'CUSTOM'} className="w-full rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50" /></div>
                  </div>
                </div>

                <button type="button" onClick={runRetentionPreview} disabled={retentionPreviewLoading || !isOwner} className="w-full rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
                  {retentionPreviewLoading ? 'Previewing...' : 'Preview rows to delete'}
                </button>

                {retentionPreview && (
                  <div className="space-y-3 rounded-xl border border-red-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-900">Scope: {retentionPreview?.range?.label || '—'} • Total rows: {Number(retentionPreview?.totalRows || 0)}</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 md:grid-cols-3">
                      {Object.entries(retentionPreview?.counts || {}).map(([key, value]) => (
                        <div key={key} className="rounded-lg bg-slate-50 px-2 py-1.5">
                          <span className="font-semibold uppercase tracking-wide text-slate-500">{key.replace(/_/g, ' ')}</span>
                          <p className="font-bold text-slate-900">{Number(value || 0)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl border border-red-100 bg-red-50/60 p-3 space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-red-700">Deletion Impact Chart</p>
                      {retentionCountRows.map((row) => {
                        const width = retentionChartMax > 0 ? Math.max(4, Math.round((row.count / retentionChartMax) * 100)) : 0;
                        return (
                          <div key={`chart-${row.key}`} className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] text-slate-300"><span className="font-semibold uppercase tracking-wide">{row.label}</span><span className="font-black text-slate-900">{row.count}</span></div>
                            <div className="h-2 overflow-hidden rounded-full bg-red-100"><div className="h-full rounded-full bg-gradient-to-r from-red-500 via-orange-500 to-amber-400" style={{ width: `${width}%` }} /></div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      <button type="button" onClick={handleExport} className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-200">Download Full JSON Backup {retentionBackupDownloaded ? '✓' : ''}</button>
                      <button type="button" onClick={downloadRetentionActivityPdf} className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-200">Download Activity PDF {retentionReportDownloaded ? '✓' : ''}</button>
                    </div>
                    <input type="text" placeholder="Type DELETE STORE DATA" value={retentionConfirmationText} onChange={e => setRetentionConfirmationText(e.target.value)} className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" />
                    <button type="button" onClick={requestRetentionDeleteConfirm} disabled={retentionDeleteLoading || !retentionBackupDownloaded || !retentionReportDownloaded || !isOwner} className="w-full rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50">
                      {retentionDeleteLoading ? 'Deleting...' : 'Review & Delete Retention Data'}
                    </button>
                  </div>
                )}
              </div>

              {/* System Health */}
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">System Health</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-900">Optimize database, clear WAL/cache, and remove unused media</p>
                  </div>
                  <div className="rounded-xl bg-emerald-100 p-3 text-emerald-400"><Sparkles size={18} /></div>
                </div>
                <button type="button" onClick={runSystemOptimization} disabled={healthBusy} className="w-full rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 flex items-center justify-center gap-2">
                  {healthBusy ? <Loader2 className="animate-spin" size={18} /> : <SettingsIcon size={18} />}
                  {healthBusy ? 'Cleaning System...' : 'Optimize & Clear Cache'}
                </button>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                  Runs <span className="font-semibold text-slate-900">`VACUUM`</span>, <span className="font-semibold text-slate-900">`wal_checkpoint(TRUNCATE)`</span>, and removes unused uploaded images.
                </div>
                {healthResult && (
                  <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 p-4 space-y-2">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-400">Latest cleanup result</p>
                    <p className="text-lg font-black text-emerald-300">{Number(healthResult?.spaceRecoveredMb || 0).toFixed(2)} MB recovered</p>
                    <div className="grid grid-cols-2 gap-2 text-xs text-emerald-300">
                      <div className="rounded-xl bg-white px-3 py-2">Unused media removed: <span className="font-bold">{Number(healthResult?.media?.deletedFiles || 0)}</span></div>
                      <div className="rounded-xl bg-white px-3 py-2">Images scanned: <span className="font-bold">{Number(healthResult?.media?.scannedFiles || 0)}</span></div>
                    </div>
                  </div>
                )}
                <div className="rounded-2xl border border-blue-700/30 bg-blue-900/20 px-4 py-3 text-xs text-blue-300">
                  Sales, expenses, customer balances, and analytics currency totals are not modified by this cleanup.
                </div>
              </div>

              {/* Danger Zone */}
              <div className="rounded-3xl bg-white p-6 shadow-sm border border-red-100 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xs font-black uppercase tracking-[0.2em] text-red-500">Danger Zone</h2>
                    <p className="mt-1 text-sm font-semibold text-slate-900">Owner-only cleanup tools for old non-financial records</p>
                  </div>
                  <div className="rounded-xl bg-red-100 p-3 text-red-600"><AlertTriangle size={18} /></div>
                </div>
                {isOwner ? (
                  <div className="space-y-3">
                    <button type="button" onClick={() => setDangerAction('proformas')} className="w-full rounded-2xl border border-amber-200 bg-amber-900/20 px-4 py-3 text-sm font-bold text-amber-300 hover:bg-amber-100 transition-colors">Clear Expired Pro-formas</button>
                    <button type="button" onClick={() => setDangerAction('logs')} className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 hover:bg-red-100 transition-colors">Clear Old Maintenance Logs</button>
                    <p className="text-[11px] text-slate-500">Removes expired quotes and old maintenance logs only. Permanent Audit Vault records always stay intact.</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">Only the <span className="font-bold text-slate-600">Store Owner</span> can use these purge actions.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmActionModal
        isOpen={Boolean(dangerAction)}
        title={dangerAction === 'proformas' ? 'Clear expired pro-formas?' : 'Clear old maintenance logs?'}
        description={dangerAction === 'proformas'
          ? 'This will delete quotation records whose expiry date is older than 30 days to keep reservation checks fast.'
          : 'This only removes maintenance logs older than 6 months. Permanent Audit Vault records will not be deleted.'}
        confirmLabel={dangerAction === 'proformas' ? 'Yes, clear pro-formas' : 'Yes, clear logs'}
        cancelLabel="Cancel"
        tone="warning"
        loading={dangerLoading}
        onClose={() => {
          if (dangerLoading) return;
          setDangerAction(null);
        }}
        onConfirm={handleDangerAction}
      />
    </>
  );
};

export default Settings;

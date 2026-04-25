import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Eye, Home, Loader2, MapPin, Package, Phone, Plus, Search, ShieldCheck, Trash2, TrendingUp, Undo2, Users, X, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { formatCurrency, openWhatsAppShare } from '../../lib/utils';
import WhatsAppPreviewModal from '../../components/WhatsAppPreviewModal';
import {
  calculateVendorIdFromSignature,
  getTrackedSoldAmountFromSpecs as getSoldAmountFromSpecs,
  getTrackedSoldQuantityFromSpecs as getSoldQuantityFromSpecs,
  getVendorSignature,
} from '../../lib/vendorMetrics';

type CustomSpec = { id: string; key: string; value: string };
type ConditionKey = 'new' | 'open_box' | 'used';
type ConditionSlot = { price: string; stock: string; cost: string };
type ConditionMatrixForm = Record<ConditionKey, ConditionSlot>;
type VendorSummary = {
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  vendorAddress: string;
  vendorType: 'INNER' | 'HYBRID';
  totalRecords: number;
  totalQuantity: number;
  inStoreRecords: number;
  inStoreQuantity: number;
  inStorePayoutValue: number;
  inStoreSellingValue: number;
  inStoreProfitValue: number;
  sourcedLinkedValue: number;
  sourcedUnpaidValue: number;
  sourcedPayableRecords: number;
  consignmentPayableRecords: number;
  soldQuantityTotal: number;
  soldAmountTotal: number;
  vendorReturnedTotal: number;
  lastActivityAt: string | null;
  items: any[];
};

const CONDITION_MATRIX_SPECS_KEY = '__condition_matrix';
const CONDITION_KEYS: ConditionKey[] = ['new', 'open_box', 'used'];
const QUEUE_PAGE_SIZE = 5;
const CONDITION_LABELS: Record<ConditionKey, string> = {
  new: 'New',
  open_box: 'Open Box',
  used: 'Used',
};

const GLASS_PANEL = 'rounded-[26px] border border-slate-200 bg-white/90 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur';

const buildSavedVendorKey = (vendor: any) => {
  return `${String(vendor.vendor_name || '').trim()}||${String(vendor.vendor_phone || '').trim()}||${String(vendor.vendor_address || '').trim()}`;
};

const getConditionMatrixTotalStock = (publicSpecs: any) => {
  const matrix = publicSpecs && typeof publicSpecs === 'object' ? publicSpecs[CONDITION_MATRIX_SPECS_KEY] : null;
  if (!matrix || typeof matrix !== 'object') return 0;
  return CONDITION_KEYS
    .map((key) => Math.max(0, Math.trunc(Number((matrix as any)?.[key]?.stock || 0) || 0)))
    .reduce((sum, value) => sum + value, 0);
};

const createSpecRow = (key = '', value = ''): CustomSpec => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  key,
  value,
});

const createEmptyConditionMatrix = (): ConditionMatrixForm => ({
  new: { price: '', stock: '', cost: '' },
  open_box: { price: '', stock: '', cost: '' },
  used: { price: '', stock: '', cost: '' },
});

const normalizeConditionMatrix = (value: any): ConditionMatrixForm => {
  return CONDITION_KEYS.reduce((acc, key) => {
    const source = value && typeof value === 'object' ? value[key] : null;
    acc[key] = {
      price: source?.price == null ? '' : String(source.price),
      stock: source?.stock == null ? '' : String(source.stock),
      cost: source?.cost == null ? '' : String(source.cost),
    };
    return acc;
  }, createEmptyConditionMatrix());
};

const extractConditionMatrixFromSpecs = (value: any): ConditionMatrixForm => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyConditionMatrix();
  }
  return normalizeConditionMatrix(value[CONDITION_MATRIX_SPECS_KEY]);
};

const buildConditionMatrixPayload = (value: any): Record<string, { price: number; stock: number; cost: number }> | null => {
  const matrix = normalizeConditionMatrix(value);
  let hasAnyEntry = false;

  const payload = CONDITION_KEYS.reduce((acc, key) => {
    const slot = matrix[key] || { price: '', stock: '', cost: '' };
    const price = Math.max(0, Number(String(slot.price || '').replace(/,/g, '') || 0) || 0);
    const stock = Math.max(0, Math.trunc(Number(String(slot.stock || '').replace(/,/g, '') || 0) || 0));
    const cost = Math.max(0, Number(String(slot.cost || '').replace(/,/g, '') || 0) || 0);
    if (price > 0 || stock > 0 || cost > 0) {
      hasAnyEntry = true;
    }
    acc[key] = { price, stock, cost };
    return acc;
  }, {} as Record<string, { price: number; stock: number; cost: number }>);

  return hasAnyEntry ? payload : null;
};

const createEmptyForm = () => ({
  id: 0,
  quick_code: '',
  vendor_name: '',
  vendor_phone: '',
  vendor_address: '',
  item_name: '',
  imei_serial: '',
  quantity: '1',
  internal_condition: '',
  condition_matrix: createEmptyConditionMatrix(),
});

const ConsignmentHub: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'sold' | 'returned'>('all');
  const [showStaffEntryModal, setShowStaffEntryModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showVendorDetailsModal, setShowVendorDetailsModal] = useState(false);
  const [fixSoldModal, setFixSoldModal] = useState<{ item: any; qty: string } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteVendorCandidate, setDeleteVendorCandidate] = useState<VendorSummary | null>(null);
  const [deletingVendor, setDeletingVendor] = useState(false);
  const [returningToVendor, setReturningToVendor] = useState(false);
  const [returnQuantityInput, setReturnQuantityInput] = useState('1');
  const [returnReasonInput, setReturnReasonInput] = useState('');
  const [returnCandidate, setReturnCandidate] = useState<any | null>(null);
  const [selectedItemDetail, setSelectedItemDetail] = useState<any | null>(null);
  const [form, setForm] = useState<any>(createEmptyForm());
  const [activeCondition, setActiveCondition] = useState<ConditionKey>('new');
  const [customSpecs, setCustomSpecs] = useState<CustomSpec[]>([]);
  const [savedVendors, setSavedVendors] = useState<any[]>([]);
  const [savedVendorSearch, setSavedVendorSearch] = useState('');
  const [vendorItems, setVendorItems] = useState<any[]>([]);
  const [vendorPayableRows, setVendorPayableRows] = useState<any[]>([]);
  const [queuePage, setQueuePage] = useState(1);
  const [selectedVendorName, setSelectedVendorName] = useState('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendorKey, setSelectedVendorKey] = useState('');
  const [vendorPortalEnabled, setVendorPortalEnabled] = useState(false);
  const [vendorPortalUrl, setVendorPortalUrl] = useState('');
  const [vendorPortalBusy, setVendorPortalBusy] = useState(false);
  const [vendorBankLoading, setVendorBankLoading] = useState(false);
  const [vendorBankSaving, setVendorBankSaving] = useState(false);
  const [vendorBankEditorOpen, setVendorBankEditorOpen] = useState(true);
  const [pendingWhatsAppShare, setPendingWhatsAppShare] = useState<{
    phone: string;
    title: string;
    lines: string[];
  } | null>(null);
  const [storeName, setStoreName] = useState('');
  const [vendorBankForm, setVendorBankForm] = useState({
    bank_name: '',
    account_number: '',
    account_name: '',
    bank_note: '',
    updated_at: null as string | null,
  });
  const deferredSearch = useDeferredValue(search.trim());

  const isManager = ['STORE_ADMIN', 'MANAGER'].includes(String(user?.role || ''));

  const mapSpecsToArray = (value: any): CustomSpec[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value)
      .filter(([key, entry]) => {
        if (String(key || '').startsWith('__')) return false;
        if (String(key) === CONDITION_MATRIX_SPECS_KEY) return false;
        return ['string', 'number', 'boolean'].includes(typeof entry);
      })
      .map(([key, entry]) => createSpecRow(String(key || ''), String(entry ?? '')))
      .filter((entry) => entry.key.trim() && entry.value.trim());
  };

  const buildSpecsObject = (rows: CustomSpec[]) => {
    return rows.reduce((acc: Record<string, any>, row) => {
      const key = String(row.key || '').trim();
      const value = String(row.value || '').trim();
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, any>);
  };

  const loadItems = async () => {
    try {
      if (hasLoadedOnce) {
        setListLoading(true);
      } else {
        setLoading(true);
      }
      const query = new URLSearchParams();
      if (status !== 'all') query.set('status', status);
      if (deferredSearch) query.set('search', deferredSearch);
      const data = await appFetch(`/api/consignment-items${query.toString() ? `?${query.toString()}` : ''}`);
      setItems(Array.isArray(data) ? data : []);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load consignment items'), type: 'error' });
      setItems([]);
    } finally {
      setLoading(false);
      setListLoading(false);
      setHasLoadedOnce(true);
    }
  };

  const loadSavedVendors = async () => {
    try {
      const rows = await appFetch('/api/consignment-vendors');
      setSavedVendors(Array.isArray(rows) ? rows : []);
    } catch {
      setSavedVendors([]);
    }
  };

  const loadVendorItems = async () => {
    try {
      const data = await appFetch('/api/consignment-items?status=all');
      setVendorItems(Array.isArray(data) ? data : []);
    } catch {
      setVendorItems([]);
    }
  };

  const loadVendorPayables = async () => {
    if (!isManager) {
      setVendorPayableRows([]);
      return;
    }
    try {
      const data = await appFetch('/api/vendor-payables');
      setVendorPayableRows(Array.isArray(data?.records) ? data.records : []);
    } catch {
      setVendorPayableRows([]);
    }
  };

  const loadVendorPortalConfig = async () => {
    if (!isManager) return;
    try {
      const data = await appFetch('/api/vendor-portal/config');
      setVendorPortalEnabled(data?.enabled === true);
      setVendorPortalUrl(String(data?.portal_url || ''));
    } catch {
      setVendorPortalEnabled(false);
      setVendorPortalUrl('');
    }
  };

  const toggleVendorPortal = async () => {
    if (!isManager || vendorPortalBusy) return;
    const nextEnabled = !vendorPortalEnabled;
    try {
      setVendorPortalBusy(true);
      const updated = await appFetch('/api/vendor-portal/config', {
        method: 'PUT',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      setVendorPortalEnabled(updated?.enabled === true);
      setVendorPortalUrl(String(updated?.portal_url || vendorPortalUrl || ''));
      showNotification({
        message: nextEnabled ? 'Vendor portal enabled.' : 'Vendor portal disabled.',
        type: 'success',
      });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to update vendor portal setting'), type: 'error' });
    } finally {
      setVendorPortalBusy(false);
    }
  };

  const copyVendorPortalUrl = async () => {
    if (!vendorPortalUrl) return;
    try {
      await navigator.clipboard.writeText(vendorPortalUrl);
      showNotification({ message: 'Vendor portal link copied.', type: 'success' });
    } catch {
      showNotification({ message: 'Could not copy link. Please copy it manually.', type: 'warning' });
    }
  };

  const loadVendorBankDetails = async (vendorName: string) => {
    if (!isManager || String(vendorName || '').trim().length < 2) {
      setVendorBankForm({ bank_name: '', account_number: '', account_name: '', bank_note: '', updated_at: null });
      setVendorBankEditorOpen(true);
      return;
    }

    try {
      setVendorBankLoading(true);
      const data = await appFetch(`/api/consignment-vendor-bank-details?vendor_name=${encodeURIComponent(vendorName)}`);
      const nextForm = {
        bank_name: String(data?.bank_name || ''),
        account_number: String(data?.account_number || ''),
        account_name: String(data?.account_name || ''),
        bank_note: String(data?.bank_note || ''),
        updated_at: data?.updated_at || null,
      };
      const hasSavedDetails = Boolean(
        nextForm.bank_name.trim()
        || nextForm.account_number.trim()
        || nextForm.account_name.trim()
        || nextForm.bank_note.trim(),
      );
      setVendorBankForm(nextForm);
      setVendorBankEditorOpen(!hasSavedDetails);
    } catch {
      setVendorBankForm({ bank_name: '', account_number: '', account_name: '', bank_note: '', updated_at: null });
      setVendorBankEditorOpen(true);
    } finally {
      setVendorBankLoading(false);
    }
  };

  const saveVendorBankDetails = async () => {
    if (!isManager || !selectedVendorSummary) return;
    try {
      setVendorBankSaving(true);
      const data = await appFetch('/api/consignment-vendor-bank-details', {
        method: 'PUT',
        body: JSON.stringify({
          vendor_name: selectedVendorSummary.vendorName,
          bank_name: vendorBankForm.bank_name,
          account_number: vendorBankForm.account_number,
          account_name: vendorBankForm.account_name,
          bank_note: vendorBankForm.bank_note,
        }),
      });

      setVendorBankForm({
        bank_name: String(data?.bank_name || ''),
        account_number: String(data?.account_number || ''),
        account_name: String(data?.account_name || ''),
        bank_note: String(data?.bank_note || ''),
        updated_at: data?.updated_at || null,
      });
      setVendorBankEditorOpen(false);
      showNotification({ message: 'Vendor bank details saved.', type: 'success' });
      if (isManager) {
        await loadVendorPayables();
      }
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save vendor bank details'), type: 'error' });
    } finally {
      setVendorBankSaving(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, [status, deferredSearch]);

  useEffect(() => {
    setQueuePage(1);
  }, [status, deferredSearch]);

  useEffect(() => {
    void loadSavedVendors();
  }, []);

  useEffect(() => {
    void loadVendorItems();
  }, []);

  useEffect(() => {
    if (!isManager) {
      setVendorPayableRows([]);
      return;
    }
    void loadVendorPayables();
  }, [isManager]);

  useEffect(() => {
    if (!isManager) return;
    void loadVendorPortalConfig();
  }, [isManager]);

  useEffect(() => {
    appFetch('/api/store/settings').then((data: any) => {
      if (data?.name) setStoreName(String(data.name));
    }).catch(() => {});
  }, []);

  const resetForm = () => {
    setForm(createEmptyForm());
    setSelectedVendorKey('');
    setSavedVendorSearch('');
    setCustomSpecs([]);
    setActiveCondition('new');
  };

  const applySavedVendorKey = (key: string) => {
    setSelectedVendorKey(key);
    if (!key) return;
    const [name, phone, address] = key.split('||');
    setForm((prev: any) => ({
      ...prev,
      vendor_name: name || prev.vendor_name,
      vendor_phone: phone || prev.vendor_phone,
      vendor_address: address || prev.vendor_address,
    }));
  };

  const editItem = (item: any) => {
    setShowStaffEntryModal(true);

    const conditionMatrix = extractConditionMatrixFromSpecs(item.public_specs);
    const matrixTotalStock = CONDITION_KEYS
      .map((key) => Math.max(0, Math.trunc(Number(conditionMatrix[key]?.stock || 0) || 0)))
      .reduce((sum, value) => sum + value, 0);
    const itemQuantity = Math.max(0, Math.trunc(Number(item.quantity || 0) || 0));

    // If the condition matrix has no stock but item.quantity > 0, seed the first
    // condition that has price/cost data (or 'new' as fallback) with the item quantity.
    if (matrixTotalStock === 0 && itemQuantity > 0) {
      const targetKey = CONDITION_KEYS.find(
        (key) => Number(conditionMatrix[key]?.price || 0) > 0 || Number(conditionMatrix[key]?.cost || 0) > 0
      ) || 'new';
      conditionMatrix[targetKey] = { ...conditionMatrix[targetKey], stock: String(itemQuantity) };
    }

    setForm({
      id: Number(item.id || 0) || 0,
      quick_code: item.quick_code || '',
      vendor_name: item.vendor_name || '',
      vendor_phone: item.vendor_phone || '',
      vendor_address: item.vendor_address || '',
      item_name: item.item_name || '',
      imei_serial: item.imei_serial || '',
      quantity: String(Math.max(1, Math.trunc(Number(item.quantity || 0) || 1))),
      internal_condition: item.internal_condition || '',
      condition_matrix: conditionMatrix,
    });

    const filledKey = CONDITION_KEYS.find(
      (key) => Number(conditionMatrix[key]?.price || 0) > 0 || Number(conditionMatrix[key]?.stock || 0) > 0 || Number(conditionMatrix[key]?.cost || 0) > 0
    );
    setActiveCondition(filledKey || 'new');

    setCustomSpecs(mapSpecsToArray(item.public_specs));
  };

  const applyConditionMatrixTotals = () => {
    const matrix = normalizeConditionMatrix(form.condition_matrix);
    const totalStock = CONDITION_KEYS
      .map((key) => Math.max(0, Math.trunc(Number(String(matrix[key]?.stock || '').replace(/,/g, '') || 0) || 0)))
      .reduce((sum, value) => sum + value, 0);
    const minPrice = CONDITION_KEYS
      .map((key) => Math.max(0, Number(String(matrix[key]?.price || '').replace(/,/g, '') || 0) || 0))
      .filter((value) => value > 0)
      .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
    const minCost = CONDITION_KEYS
      .map((key) => Math.max(0, Number(String(matrix[key]?.cost || '').replace(/,/g, '') || 0) || 0))
      .filter((value) => value > 0)
      .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);

    if (totalStock <= 0 && !Number.isFinite(minPrice) && !Number.isFinite(minCost)) {
      showNotification({ message: 'Enter at least one condition value before applying matrix totals.', type: 'warning' });
      return;
    }

    setForm((prev: any) => ({
      ...prev,
      quantity: totalStock > 0 ? String(totalStock) : prev.quantity,
    }));
  };

  const saveItem = async () => {
    const publicSpecsPayload = buildSpecsObject(customSpecs);

    // Only save the active condition's data — one condition per post
    const activeSlot = form.condition_matrix?.[activeCondition] || { price: '', stock: '', cost: '' };
    const singleConditionMatrix = {
      new: { price: '', stock: '', cost: '' },
      open_box: { price: '', stock: '', cost: '' },
      used: { price: '', stock: '', cost: '' },
      [activeCondition]: activeSlot,
    };

    const conditionMatrixPayload = buildConditionMatrixPayload(singleConditionMatrix);
    const activePrice = Math.max(0, Number(String(activeSlot.price || '').replace(/,/g, '') || 0) || 0);
    const activeStock = Math.max(0, Math.trunc(Number(String(activeSlot.stock || '').replace(/,/g, '') || 0) || 0));
    const activeCost = Math.max(0, Number(String(activeSlot.cost || '').replace(/,/g, '') || 0) || 0);

    const matrixTotalStock = activeStock;
    const matrixMinPrice = activePrice > 0 ? activePrice : Number.POSITIVE_INFINITY;
    const matrixMinCost = activeCost > 0 ? activeCost : Number.POSITIVE_INFINITY;

    if (conditionMatrixPayload) {
      publicSpecsPayload[CONDITION_MATRIX_SPECS_KEY] = conditionMatrixPayload;
    }

    const payload = {
      quick_code: String(form.quick_code || '').trim().toUpperCase(),
      vendor_name: String(form.vendor_name || '').trim(),
      vendor_phone: String(form.vendor_phone || '').trim(),
      vendor_address: String(form.vendor_address || '').trim(),
      item_name: String(form.item_name || '').trim(),
      imei_serial: String(form.imei_serial || '').trim(),
      quantity: matrixTotalStock > 0
        ? matrixTotalStock
        : Math.max(1, Math.trunc(Number(form.quantity || 0) || 1)),
      agreed_payout: Number.isFinite(matrixMinCost) ? matrixMinCost : 0,
      selling_price: Number.isFinite(matrixMinPrice) ? matrixMinPrice : 0,
      internal_condition: String(form.internal_condition || '').trim(),
      public_specs: publicSpecsPayload,
    };

    if (payload.vendor_name.length < 2 || payload.item_name.length < 2) {
      showNotification({ message: 'Vendor and item name are required.', type: 'warning' });
      return;
    }

    if (payload.agreed_payout <= 0 || payload.selling_price <= 0) {
      showNotification({ message: 'Set a condition matrix vendor cost and a selling price greater than zero.', type: 'warning' });
      return;
    }

    try {
      setSaving(true);
      if (Number(form.id || 0) > 0) {
        await appFetch(`/api/consignment-items/${form.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showNotification({ message: 'Item updated and moved to pending approval.', type: 'success' });
      } else {
        await appFetch('/api/consignment-items', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showNotification({ message: 'Consignment item submitted for manager approval.', type: 'success' });
      }

      resetForm();
      setShowStaffEntryModal(false);
      await Promise.all([loadItems(), loadVendorItems()]);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save item'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const updateReviewStatus = async (item: any, action: 'approve' | 'reject') => {
    try {
      await appFetch(`/api/consignment-items/${item.id}/${action}`, { method: 'POST' });
      showNotification({ message: `Item ${action}d successfully.`, type: 'success' });
      await Promise.all([loadItems(), loadVendorItems()]);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || `Failed to ${action} item`), type: 'error' });
    }
  };

  const recalculateSold = (item: any) => {
    const currentSold = getSoldQuantityFromSpecs(item?.public_specs);
    setFixSoldModal({ item, qty: String(currentSold) });
  };

  const submitFixSold = async () => {
    if (!fixSoldModal) return;
    const { item, qty } = fixSoldModal;
    const parsedQty = Math.max(0, Math.trunc(Number(qty) || 0));
    const sellingPrice = Math.max(0, Number(item?.selling_price || 0) || 0);
    const amount = parsedQty * sellingPrice;
    try {
      const updated = await appFetch(`/api/consignment-items/${item.id}/recalculate-sold`, {
        method: 'POST',
        body: JSON.stringify({ soldQty: parsedQty, soldAmount: amount }),
      });
      const { soldQty: newQty, soldAmount: newAmount } = (updated as any).recalculated || {};
      showNotification({
        message: `Sold stats updated: ${newQty ?? parsedQty} unit(s) · ${formatCurrency(newAmount ?? amount)}`,
        type: 'success',
      });
      setFixSoldModal(null);
      await loadItems();
    } catch (err: any) {
      showNotification({ message: err?.message || 'Failed to update sold stats', type: 'error' });
    }
  };

  const confirmDeleteItem = async () => {
    if (!deleteCandidate) return;
    setDeleting(true);
    try {
      await appFetch(`/api/consignment-items/${deleteCandidate.id}`, { method: 'DELETE' });
      showNotification({ message: `"${deleteCandidate.item_name}" deleted.`, type: 'success' });
      setDeleteCandidate(null);
      await loadItems();
    } catch (err: any) {
      showNotification({ message: err?.message || 'Failed to delete item.', type: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeleteVendor = async () => {
    if (!deleteVendorCandidate) return;
    setDeletingVendor(true);
    try {
      await appFetch(`/api/consignment-vendors?vendor_name=${encodeURIComponent(deleteVendorCandidate.vendorName)}`, { method: 'DELETE' });
      showNotification({ message: `Vendor "${deleteVendorCandidate.vendorName}" and all their items deleted.`, type: 'success' });
      setDeleteVendorCandidate(null);
      setShowVendorDetailsModal(false);
      setSelectedVendorName('');
      await Promise.all([loadItems(), loadVendorItems(), loadVendorPayables()]);
    } catch (err: any) {
      showNotification({ message: err?.message || 'Failed to delete vendor.', type: 'error' });
    } finally {
      setDeletingVendor(false);
    }
  };

  const markReturnedToVendor = async (item: any) => {
    const availableQuantity = Math.max(
      0,
      Math.trunc(Number(item?.quantity || 0) || 0),
      getConditionMatrixTotalStock(item?.public_specs),
    );
    if (availableQuantity <= 0) {
      showNotification({ message: 'This item has no available quantity to return.', type: 'warning' });
      return;
    }

    setReturnCandidate(item);
    setReturnQuantityInput('1');
    setReturnReasonInput('');
    setShowReturnModal(true);
  };

  const submitVendorReturn = async () => {
    if (!returnCandidate) return;

    const availableQuantity = Math.max(
      0,
      Math.trunc(Number(returnCandidate?.quantity || 0) || 0),
      getConditionMatrixTotalStock(returnCandidate?.public_specs),
    );

    const returnQuantity = Math.max(0, Math.trunc(Number(returnQuantityInput) || 0));
    if (!Number.isInteger(returnQuantity) || returnQuantity < 1 || returnQuantity > availableQuantity) {
      showNotification({ message: `Enter a valid quantity between 1 and ${availableQuantity}.`, type: 'warning' });
      return;
    }

    try {
      setReturningToVendor(true);
      const updated = await appFetch(`/api/consignment-items/${returnCandidate.id}/return`, {
        method: 'POST',
        body: JSON.stringify({ quantity: returnQuantity, reason: returnReasonInput.trim() }),
      });
      const remainingQuantity = Math.max(0, Math.trunc(Number(updated?.quantity || 0) || 0));
      showNotification({
        message: returnQuantity >= availableQuantity
          ? 'Item marked as fully returned to vendor.'
          : `Returned ${returnQuantity} unit${returnQuantity === 1 ? '' : 's'} to vendor. Remaining: ${remainingQuantity}.`,
        type: 'success',
      });
      setShowReturnModal(false);
      setReturnCandidate(null);
      setReturnQuantityInput('1');
      setReturnReasonInput('');
      await Promise.all([loadItems(), loadVendorItems()]);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to mark item as returned'), type: 'error' });
    } finally {
      setReturningToVendor(false);
    }
  };

  const pendingItems = useMemo(
    () => items.filter((entry) => String(entry.status || '').toLowerCase() === 'pending'),
    [items],
  );

  const vendorPayableStatsByName = useMemo(() => {
    return vendorPayableRows.reduce((acc: Record<string, {
      displayName: string;
      sourcedRecords: number;
      consignmentRecords: number;
      sourcedAmount: number;
      consignmentAmount: number;
      sourcedUnpaid: number;
      consignmentUnpaid: number;
    }>, row: any) => {
      const displayName = String(row?.vendor_name || 'Unknown Vendor').trim() || 'Unknown Vendor';
      const key = displayName.toLowerCase();
      if (!acc[key]) {
        acc[key] = {
          displayName,
          sourcedRecords: 0,
          consignmentRecords: 0,
          sourcedAmount: 0,
          consignmentAmount: 0,
          sourcedUnpaid: 0,
          consignmentUnpaid: 0,
        };
      }

      const sourceType = String(row?.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'SOURCED';
      const amount = Math.max(0, Number(row?.amount_due || 0) || 0);
      const isUnpaid = String(row?.status || 'UNPAID').toUpperCase() !== 'SETTLED';

      if (sourceType === 'CONSIGNMENT') {
        acc[key].consignmentRecords += 1;
        acc[key].consignmentAmount += amount;
        if (isUnpaid) acc[key].consignmentUnpaid += amount;
      } else {
        acc[key].sourcedRecords += 1;
        acc[key].sourcedAmount += amount;
        if (isUnpaid) acc[key].sourcedUnpaid += amount;
      }

      return acc;
    }, {});
  }, [vendorPayableRows]);

  const vendorSummaries = useMemo<VendorSummary[]>(() => {
    const grouped = vendorItems.reduce((acc: Record<string, VendorSummary>, item: any) => {
      const vendorName = String(item.vendor_name || 'Unknown Vendor').trim() || 'Unknown Vendor';
      const itemStatus = String(item.status || 'pending').toLowerCase();
      const inStore = ['pending', 'approved'].includes(itemStatus);
      if (!acc[vendorName]) {
        acc[vendorName] = {
          vendorId: '',
          vendorName,
          vendorPhone: String(item.vendor_phone || '').trim(),
          vendorAddress: String(item.vendor_address || '').trim(),
          vendorType: 'INNER',
          totalRecords: 0,
          totalQuantity: 0,
          inStoreRecords: 0,
          inStoreQuantity: 0,
          inStorePayoutValue: 0,
          inStoreSellingValue: 0,
          inStoreProfitValue: 0,
          sourcedLinkedValue: 0,
          sourcedUnpaidValue: 0,
          sourcedPayableRecords: 0,
          consignmentPayableRecords: 0,
          soldQuantityTotal: 0,
          soldAmountTotal: 0,
          vendorReturnedTotal: 0,
          lastActivityAt: null,
          items: [],
        };
      }

      acc[vendorName].totalRecords += 1;
      acc[vendorName].totalQuantity += Math.max(0, Math.trunc(Number(item.quantity || 0) || 0));
      if (inStore) {
        const itemQty = Math.max(0, Math.trunc(Number(item.quantity || 0) || 0));
        const payout = Math.max(0, Number(item.agreed_payout || 0) || 0);
        const selling = Math.max(0, Number(item.selling_price || 0) || 0);
        acc[vendorName].inStoreRecords += 1;
        acc[vendorName].inStoreQuantity += itemQty;
        acc[vendorName].inStorePayoutValue += payout * itemQty;
        acc[vendorName].inStoreSellingValue += selling * itemQty;
        acc[vendorName].inStoreProfitValue += Math.max(0, (selling - payout) * itemQty);
      }
      const soldQty = getSoldQuantityFromSpecs(item?.public_specs);
      const soldAmount = getSoldAmountFromSpecs(item?.public_specs, Number(item?.selling_price || 0) || 0);
      const returnedQty = Math.max(0, Math.trunc(Number(item?.public_specs?.__returned_quantity_total || 0) || 0));
      acc[vendorName].soldQuantityTotal += soldQty;
      acc[vendorName].soldAmountTotal += soldAmount;
      acc[vendorName].vendorReturnedTotal += returnedQty;
      if (!acc[vendorName].vendorPhone && item.vendor_phone) {
        acc[vendorName].vendorPhone = String(item.vendor_phone || '').trim();
      }
      if (!acc[vendorName].vendorAddress && item.vendor_address) {
        acc[vendorName].vendorAddress = String(item.vendor_address || '').trim();
      }
      const itemUpdatedAt = item.updated_at ? String(item.updated_at) : null;
      if (itemUpdatedAt) {
        const currentLast = acc[vendorName].lastActivityAt ? new Date(acc[vendorName].lastActivityAt).getTime() : 0;
        const nextLast = new Date(itemUpdatedAt).getTime();
        if (nextLast > currentLast) {
          acc[vendorName].lastActivityAt = itemUpdatedAt;
        }
      }
      acc[vendorName].items.push(item);
      return acc;
    }, {});

    const summaries = Object.values(grouped) as VendorSummary[];
    const sorted = summaries.sort((a, b) => b.inStoreRecords - a.inStoreRecords || a.vendorName.localeCompare(b.vendorName));
    return sorted.map((entry) => ({
      ...entry,
      vendorId: calculateVendorIdFromSignature(getVendorSignature(entry.vendorName, entry.vendorPhone, entry.vendorAddress)),
      vendorType: (vendorPayableStatsByName[entry.vendorName.toLowerCase()]?.sourcedRecords || 0) > 0 ? 'HYBRID' : 'INNER',
      sourcedLinkedValue: vendorPayableStatsByName[entry.vendorName.toLowerCase()]?.sourcedAmount || 0,
      sourcedUnpaidValue: vendorPayableStatsByName[entry.vendorName.toLowerCase()]?.sourcedUnpaid || 0,
      sourcedPayableRecords: vendorPayableStatsByName[entry.vendorName.toLowerCase()]?.sourcedRecords || 0,
      consignmentPayableRecords: vendorPayableStatsByName[entry.vendorName.toLowerCase()]?.consignmentRecords || 0,
    }));
  }, [vendorItems, vendorPayableStatsByName]);

  const outsideVendorInsight = useMemo(() => {
    const inStoreVendorNames = new Set(vendorSummaries.map((entry) => entry.vendorName.toLowerCase()));
    const outsideRows = (Object.values(vendorPayableStatsByName) as Array<{
      displayName: string;
      sourcedRecords: number;
      sourcedAmount: number;
      sourcedUnpaid: number;
    }>)
      .filter((entry) => !inStoreVendorNames.has(entry.displayName.toLowerCase()) && entry.sourcedRecords > 0);

    return {
      count: outsideRows.length,
      sourcedTotal: outsideRows.reduce((sum, row) => sum + row.sourcedAmount, 0),
      sourcedUnpaid: outsideRows.reduce((sum, row) => sum + row.sourcedUnpaid, 0),
      topOutsideVendors: outsideRows
        .slice()
        .sort((a, b) => b.sourcedUnpaid - a.sourcedUnpaid || b.sourcedAmount - a.sourcedAmount)
        .slice(0, 5),
    };
  }, [vendorPayableStatsByName, vendorSummaries]);

  const selectedVendorSummary = useMemo<VendorSummary | null>(() => {
    if (!selectedVendorName) return vendorSummaries[0] || null;
    return vendorSummaries.find((entry) => entry.vendorName === selectedVendorName) || vendorSummaries[0] || null;
  }, [selectedVendorName, vendorSummaries]);

  useEffect(() => {
    if (!showVendorDetailsModal || !selectedVendorSummary || !isManager) return;
    void loadVendorBankDetails(selectedVendorSummary.vendorName);
  }, [showVendorDetailsModal, selectedVendorSummary, isManager]);

  const filteredVendorSummaries = useMemo(() => {
    const term = String(vendorSearch || '').trim().toLowerCase();
    if (!term) return vendorSummaries;
    return vendorSummaries.filter((entry) => (
      entry.vendorName.toLowerCase().includes(term)
      || entry.vendorId.toLowerCase().includes(term)
      || entry.vendorPhone.toLowerCase().includes(term)
      || entry.vendorAddress.toLowerCase().includes(term)
    ));
  }, [vendorSearch, vendorSummaries]);

  const vendorIdBySignature = useMemo(() => {
    const map = new Map<string, string>();
    vendorSummaries.forEach((entry) => {
      map.set(getVendorSignature(entry.vendorName, entry.vendorPhone, entry.vendorAddress), entry.vendorId);
    });
    return map;
  }, [vendorSummaries]);

  const filteredSavedVendors = useMemo(() => {
    const term = String(savedVendorSearch || '').trim().toLowerCase();
    if (!term) return savedVendors;

    return savedVendors.filter((vendor) => {
      const name = String(vendor.vendor_name || '').trim();
      const phone = String(vendor.vendor_phone || '').trim();
      const address = String(vendor.vendor_address || '').trim();
      const signature = getVendorSignature(name, phone, address);
      const vendorId = vendorIdBySignature.get(signature) || calculateVendorIdFromSignature(signature);
      const haystack = `${name} ${phone} ${address} ${vendorId}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [savedVendors, savedVendorSearch, vendorIdBySignature]);

  const selectedVendorAllItems = useMemo(() => {
    if (!selectedVendorSummary) return [];
    return (selectedVendorSummary.items || [])
      .slice()
      .sort((a: any, b: any) => Number(b.updated_at ? new Date(b.updated_at).getTime() : 0) - Number(a.updated_at ? new Date(a.updated_at).getTime() : 0));
  }, [selectedVendorSummary]);

  const selectedVendorCollectedItem = useMemo(() => {
    return selectedVendorAllItems.find((entry: any) => getSoldQuantityFromSpecs(entry?.public_specs) > 0) || null;
  }, [selectedVendorAllItems]);

  const shareCollectionHistory = (item: any, history: Array<{ quantity: number; reason: string | null; at: string; by: string | null }>, totalQty: number) => {
    const phone = String(item?.vendor_phone || '').trim();
    if (!phone) return;
    const itemName = String(item?.item_name || 'Vendor item');
    const quickCode = String(item?.quick_code || '').trim();
    const lines: string[] = [
      `Vendor: ${String(item?.vendor_name || 'Vendor')}`,
      `Item: ${itemName}${quickCode ? ` | QC: ${quickCode}` : ''}`,
      `Total units collected back: ${totalQty}`,
      '---',
      ...history.map((e, i) => {
        const dateStr = e.at ? new Date(e.at).toLocaleString() : 'N/A';
        const reasonStr = e.reason ? `Reason: ${e.reason}` : 'No reason recorded';
        const byStr = e.by ? ` | By: ${e.by}` : '';
        return `${i + 1}. ${e.quantity} unit(s) on ${dateStr}${byStr} — ${reasonStr}`;
      }),
      '---',
      'Please confirm the above collection records.',
    ];
    setPendingWhatsAppShare({ phone, title: 'Collection History', lines });
  };

  const shareVendorAcknowledgement = (item?: any, contextLabel = 'vendor activity') => {
    if (!selectedVendorSummary?.vendorPhone) return;

    const itemName = String(item?.item_name || selectedVendorSummary.vendorName || 'Vendor item');
    const quickCode = String(item?.quick_code || '').trim();
    const itemQty = Math.max(0, Math.trunc(Number(item?.quantity || 0) || 0));
    const collectedQty = Math.max(
      0,
      Math.trunc(Number(item?.sold_quantity || getSoldQuantityFromSpecs(item?.public_specs) || 0) || 0),
    );
    const itemAmount = Math.max(
      0,
      Number(item?.sold_amount || getSoldAmountFromSpecs(item?.public_specs, Number(item?.selling_price || 0) || 0) || 0) || 0,
    );

    setPendingWhatsAppShare({
      phone: selectedVendorSummary.vendorPhone,
      title: 'Acknowledgement',
      lines: [
        `Vendor: ${selectedVendorSummary.vendorName}`,
        `${contextLabel} | Item: ${itemName}${quickCode ? ` | QC: ${quickCode}` : ''}`,
        `Collected: ${collectedQty} unit(s) | Value: ${formatCurrency(itemAmount)} | Balance: ${itemQty} unit(s)`,
        item?.updated_at ? `Updated: ${new Date(item.updated_at).toLocaleString()}` : '',
        'Please confirm receipt.',
      ].filter(Boolean),
    });
  };

  const sendPendingWhatsAppShare = () => {
    if (!pendingWhatsAppShare) return;
    openWhatsAppShare(pendingWhatsAppShare);
    setPendingWhatsAppShare(null);
    showNotification({
      title: 'Acknowledgement Sent',
      message: 'WhatsApp opened with the acknowledgement message.',
      type: 'success',
      presentation: 'toast',
      duration: 1800,
    });
  };

  const queueTotalPages = useMemo(() => Math.max(1, Math.ceil(items.length / QUEUE_PAGE_SIZE)), [items.length]);

  useEffect(() => {
    setQueuePage((prev) => Math.min(prev, queueTotalPages));
  }, [queueTotalPages]);

  const paginatedItems = useMemo(() => {
    const start = (queuePage - 1) * QUEUE_PAGE_SIZE;
    return items.slice(start, start + QUEUE_PAGE_SIZE);
  }, [items, queuePage]);

  const queueRangeStart = items.length === 0 ? 0 : ((queuePage - 1) * QUEUE_PAGE_SIZE) + 1;
  const queueRangeEnd = items.length === 0 ? 0 : Math.min(queuePage * QUEUE_PAGE_SIZE, items.length);

  if (loading && !hasLoadedOnce) {
    return (
      <div className="flex h-full min-h-[16rem] items-center justify-center rounded-[24px] border border-slate-200 bg-white">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <>
      <WhatsAppPreviewModal
        isOpen={Boolean(pendingWhatsAppShare)}
        title={pendingWhatsAppShare?.title || 'Acknowledgement'}
        lines={pendingWhatsAppShare?.lines || []}
        onClose={() => setPendingWhatsAppShare(null)}
        onSend={sendPendingWhatsAppShare}
        storeName={storeName || undefined}
      />

      {showReturnModal && returnCandidate && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Return To Vendor</h3>
                <p className="mt-1 text-sm text-slate-500">{returnCandidate.item_name} • {returnCandidate.vendor_name || 'Unknown Vendor'}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (returningToVendor) return;
                  setShowReturnModal(false);
                  setReturnCandidate(null);
                  setReturnQuantityInput('1');
                  setReturnReasonInput('');
                }}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-300"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                Available quantity: <strong>{Math.max(0, Math.trunc(Number(returnCandidate.quantity || 0) || 0), getConditionMatrixTotalStock(returnCandidate.public_specs))}</strong>
              </p>
              <div className="rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700">
                This will immediately reduce available stock for this item.
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">Quantity to return</label>
                <input
                  type="number"
                  min={1}
                  step="1"
                  value={returnQuantityInput}
                  onChange={(e) => setReturnQuantityInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-slate-500">Reason for collection <span className="font-normal normal-case tracking-normal text-slate-400">(optional)</span></label>
                <textarea
                  rows={2}
                  maxLength={200}
                  placeholder="e.g. Vendor requested stock back, item not selling..."
                  value={returnReasonInput}
                  onChange={(e) => setReturnReasonInput(e.target.value)}
                  className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  if (returningToVendor) return;
                  setShowReturnModal(false);
                  setReturnCandidate(null);
                  setReturnQuantityInput('1');
                  setReturnReasonInput('');
                }}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={returningToVendor}
                onClick={() => void submitVendorReturn()}
                className="flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {returningToVendor ? 'Processing...' : 'Return To Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteVendorCandidate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-rose-200 bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-rose-400">Delete Vendor</h3>
                <p className="mt-1 text-sm text-slate-600">
                  You are about to permanently delete <strong>{deleteVendorCandidate.vendorName}</strong> and all <strong>{deleteVendorCandidate.totalRecords}</strong> of their consignment item record(s).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteVendorCandidate(null)}
                disabled={deletingVendor}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-300"
              >
                <X size={18} />
              </button>
            </div>
            <div className="rounded-xl border border-rose-700/30 bg-rose-900/20 px-3 py-2 text-xs font-semibold text-rose-400">
              This cannot be undone. Items with recorded sales cannot be deleted — the server will block this if any exist.
            </div>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteVendorCandidate(null)}
                disabled={deletingVendor}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingVendor}
                onClick={() => void confirmDeleteVendor()}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {deletingVendor ? 'Deleting...' : 'Yes, Delete Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showVendorDetailsModal && selectedVendorSummary && (
        <div className="fixed inset-0 z-[72] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl" style={{ maxHeight: '92vh' }}>

            {/* Dark gradient header */}
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-violet-900 px-6 py-5">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-violet-500 opacity-15" />
              <div className="pointer-events-none absolute -bottom-6 left-1/4 h-28 w-28 rounded-full bg-blue-900/200 opacity-10" />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Vendor Detail View</p>
                  <h3 className="mt-0.5 text-2xl font-black text-white">{selectedVendorSummary.vendorName}</h3>
                  <p className="mt-1 text-sm text-slate-400">VID {selectedVendorSummary.vendorId} • {selectedVendorSummary.vendorPhone || 'No phone'} • {selectedVendorSummary.vendorAddress || 'No address'}</p>
                  <div className={`mt-2.5 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${selectedVendorSummary.vendorType === 'HYBRID' ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30' : 'bg-violet-500/20 text-violet-300 border border-violet-500/30'}`}>
                    {selectedVendorSummary.vendorType === 'HYBRID' ? 'HYBRID VENDOR' : 'INNER VENDOR'}
                    <span className="font-semibold normal-case tracking-normal opacity-80">{selectedVendorSummary.vendorType === 'HYBRID' ? 'Consignment + Outside/Sourced' : 'Consignment Hub Vendor'}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isManager && (
                    <button
                      type="button"
                      onClick={() => setDeleteVendorCandidate(selectedVendorSummary)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-900/200/20 px-3 py-2 text-xs font-black uppercase tracking-widest text-rose-300 hover:bg-rose-900/200/30"
                    >
                      <Trash2 size={13} /> Delete Vendor
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowVendorDetailsModal(false)}
                    className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* KPI strip inside header */}
              <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">In Store</p>
                  <p className="mt-0.5 text-xl font-black text-white">{selectedVendorSummary.inStoreQuantity}</p>
                  <p className="text-[10px] text-slate-400">{selectedVendorSummary.inStoreRecords} item(s)</p>
                </div>
                <div className="rounded-xl bg-white/10 px-3 py-2.5 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Payout Value</p>
                  <p className="mt-0.5 text-lg font-black text-white">{formatCurrency(selectedVendorSummary.inStorePayoutValue)}</p>
                  <p className="text-[10px] text-slate-400">owed to vendor</p>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-900/200/20 px-3 py-2.5 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-wide text-emerald-300">Potential Profit</p>
                  <p className="mt-0.5 text-lg font-black text-white">{formatCurrency(selectedVendorSummary.inStoreProfitValue)}</p>
                  <p className="text-[10px] text-emerald-400">if all stock sells</p>
                </div>
                <div className="rounded-xl border border-blue-500/30 bg-blue-900/200/20 px-3 py-2.5 backdrop-blur">
                  <p className="text-[10px] font-black uppercase tracking-wide text-blue-300">Sold to Customers</p>
                  <p className="mt-0.5 text-xl font-black text-white">{selectedVendorSummary.soldQuantityTotal}</p>
                  <p className="text-[10px] text-blue-300">{formatCurrency(selectedVendorSummary.soldAmountTotal)}</p>
                </div>
              </div>
            </div>

            {/* Status row */}
            <div className="grid gap-3 border-b border-slate-100 bg-slate-50 p-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Vendor Collected Back</p>
                <p className="mt-1 text-2xl font-black text-violet-900">{selectedVendorSummary.vendorReturnedTotal}</p>
                <p className="text-xs text-violet-600">unit(s) taken back</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-900/20 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600">Remaining In Store</p>
                <p className="mt-1 text-2xl font-black text-emerald-300">{selectedVendorSummary.inStoreQuantity}</p>
                <p className="text-xs text-emerald-600">{selectedVendorSummary.inStoreRecords} active record(s)</p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-900/20 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-600">Pending Payables</p>
                <p className="mt-1 text-2xl font-black text-amber-300">{formatCurrency(selectedVendorSummary.sourcedUnpaidValue)}</p>
                <p className="text-xs text-amber-600">Outside/Sourced unsettled</p>
              </div>
            </div>

            {/* Activity + WhatsApp Ack */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
              <p className="text-xs text-slate-500">Last activity: <span className="font-semibold text-slate-700">{selectedVendorSummary.lastActivityAt ? new Date(selectedVendorSummary.lastActivityAt).toLocaleString() : 'N/A'}</span></p>
              <button
                type="button"
                onClick={() => shareVendorAcknowledgement(selectedVendorCollectedItem || selectedVendorAllItems[0], 'vendor summary')}
                disabled={!selectedVendorSummary.vendorPhone}
                className="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-black uppercase tracking-widest text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 size={13} /> WhatsApp Ack
              </button>
            </div>

            {isManager && (
              <div className="border-b border-slate-200 p-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Inner Vendor Bank Details</p>
                    <div className="flex items-center gap-2">
                      {vendorBankForm.updated_at && (
                        <p className="text-[11px] text-slate-500">Updated {new Date(vendorBankForm.updated_at).toLocaleString()}</p>
                      )}
                      {!vendorBankLoading && (
                        <button
                          type="button"
                          onClick={() => setVendorBankEditorOpen((prev) => !prev)}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-100"
                        >
                          {vendorBankEditorOpen ? 'Close Form' : 'Edit Details'}
                        </button>
                      )}
                    </div>
                  </div>
                  {vendorBankLoading ? (
                    <p className="text-xs text-slate-500">Loading bank details...</p>
                  ) : !vendorBankEditorOpen ? (
                    <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-300">
                      <p><span className="font-black text-slate-500">Bank:</span> {vendorBankForm.bank_name || 'Not provided'}</p>
                      <p><span className="font-black text-slate-500">Account Name:</span> {vendorBankForm.account_name || 'Not provided'}</p>
                      <p><span className="font-black text-slate-500">Account Number:</span> {vendorBankForm.account_number || 'Not provided'}</p>
                      {vendorBankForm.bank_note ? (
                        <p><span className="font-black text-slate-500">Note:</span> {vendorBankForm.bank_note}</p>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          value={vendorBankForm.bank_name}
                          onChange={(e) => setVendorBankForm((prev) => ({ ...prev, bank_name: e.target.value }))}
                          placeholder="Bank name"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                        <input
                          type="text"
                          value={vendorBankForm.account_number}
                          onChange={(e) => setVendorBankForm((prev) => ({ ...prev, account_number: e.target.value }))}
                          placeholder="Account number"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                        <input
                          type="text"
                          value={vendorBankForm.account_name}
                          onChange={(e) => setVendorBankForm((prev) => ({ ...prev, account_name: e.target.value }))}
                          placeholder="Account name"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 sm:col-span-2"
                        />
                        <textarea
                          value={vendorBankForm.bank_note}
                          onChange={(e) => setVendorBankForm((prev) => ({ ...prev, bank_note: e.target.value }))}
                          placeholder="Optional note"
                          className="min-h-[64px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-300 sm:col-span-2"
                        />
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          disabled={vendorBankSaving}
                          onClick={() => void saveVendorBankDetails()}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {vendorBankSaving ? 'Saving...' : 'Save Bank Details'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="relative">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-white to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-white to-transparent" />

              <div className="h-[42vh] space-y-2 overflow-y-scroll p-4 pr-3 scroll-smooth overscroll-contain snap-y snap-proximity [scrollbar-width:thin] [scrollbar-color:#94a3b8_#e2e8f0] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400 [&::-webkit-scrollbar-thumb:hover]:bg-slate-500">
                {selectedVendorAllItems.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-5 text-sm text-slate-500">No consignment items found for this vendor.</p>
                ) : (
                  selectedVendorAllItems.map((entry: any) => {
                  const itemStatus = String(entry.status || 'pending').toLowerCase();
                  const soldQuantity = getSoldQuantityFromSpecs(entry?.public_specs);
                  const soldAmount = getSoldAmountFromSpecs(entry?.public_specs, Number(entry?.selling_price || 0) || 0);
                  const vendorCollectedQty = Math.max(0, Math.trunc(Number(entry?.public_specs?.__returned_quantity_total || 0) || 0));
                  const vendorCollectedAt = entry?.public_specs?.__last_returned_at || null;
                  const vendorCollectedReason = String(entry?.public_specs?.__last_returned_reason || '').trim();
                  const statusClass = itemStatus === 'approved'
                    ? 'bg-emerald-100 text-emerald-400'
                    : itemStatus === 'rejected'
                      ? 'bg-rose-100 text-rose-400'
                      : itemStatus === 'sold'
                        ? 'bg-blue-100 text-blue-400'
                        : itemStatus === 'returned'
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-amber-100 text-amber-400';

                  const conditionMatrix = extractConditionMatrixFromSpecs(entry.public_specs);
                  const matrixSummary = CONDITION_KEYS
                    .map((key) => {
                      const slot = conditionMatrix[key] || { stock: '', price: '' };
                      const stock = Math.max(0, Math.trunc(Number(slot.stock || 0) || 0));
                      const price = Math.max(0, Number(slot.price || 0) || 0);
                      if (stock <= 0 && price <= 0) return null;
                      return `${CONDITION_LABELS[key]}: ${stock} @ ${formatCurrency(price)}`;
                    })
                    .filter(Boolean)
                    .join(' • ');

                    return (
                      <div key={`${entry.id}-${entry.quick_code || entry.item_name}`} className="snap-start overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                        {/* accent strip */}
                        <div className={`h-1 w-full ${itemStatus === 'approved' ? 'bg-emerald-900/200' : itemStatus === 'sold' ? 'bg-blue-900/200' : itemStatus === 'returned' ? 'bg-violet-500' : itemStatus === 'rejected' ? 'bg-rose-900/200' : 'bg-amber-400'}`} />
                        <div className="p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="font-black text-slate-900">{entry.item_name}</p>
                              <div className="mt-1 flex flex-wrap gap-1">
                                {entry.quick_code && <span className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-700">QC {entry.quick_code}</span>}
                                {entry.imei_serial && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{entry.imei_serial}</span>}
                                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">×{Math.max(0, Math.trunc(Number(entry.quantity || 0) || 0))}</span>
                              </div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${statusClass}`}>{itemStatus}</span>
                          </div>

                          <div className="mt-2 grid grid-cols-3 gap-1.5">
                            <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                              <p className="text-[9px] text-slate-400">Payout</p>
                              <p className="text-xs font-black text-slate-200">{formatCurrency(Number(entry.agreed_payout || 0) || 0)}</p>
                            </div>
                            <div className="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
                              <p className="text-[9px] text-slate-400">Selling</p>
                              <p className="text-xs font-black text-slate-200">{formatCurrency(Number(entry.selling_price || 0) || 0)}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-900/20 px-2 py-1.5 text-center">
                              <p className="text-[9px] text-emerald-500">Profit</p>
                              <p className="text-xs font-black text-emerald-400">{formatCurrency(Math.max(0, (Number(entry.selling_price || 0) || 0) - (Number(entry.agreed_payout || 0) || 0)))}</p>
                            </div>
                          </div>

                          {soldQuantity > 0 && (
                            <p className="mt-2 text-xs font-semibold text-blue-400">Sold: {soldQuantity} unit(s) · {formatCurrency(soldAmount)}</p>
                          )}
                          {vendorCollectedQty > 0 && (
                            <p className="mt-0.5 text-xs font-semibold text-violet-700">
                              Collected back: {vendorCollectedQty} unit(s){vendorCollectedAt ? ` · ${new Date(vendorCollectedAt).toLocaleDateString()}` : ''}
                              {vendorCollectedReason ? ` · ${vendorCollectedReason}` : ''}
                            </p>
                          )}
                          {matrixSummary && <p className="mt-1 text-[11px] text-slate-400">{matrixSummary}</p>}

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => shareVendorAcknowledgement(entry, 'collected item acknowledgement')}
                              disabled={!selectedVendorSummary.vendorPhone}
                              className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <CheckCircle2 size={11} /> WhatsApp Ack
                            </button>
                            {isManager && soldQuantity === 0 && (
                              <button
                                type="button"
                                onClick={() => void recalculateSold(entry)}
                                className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700 hover:bg-sky-100"
                              >
                                Fix Sold Stats
                              </button>
                            )}
                          </div>
                          <p className="mt-1.5 text-[10px] text-slate-400">Updated: {entry.updated_at ? new Date(entry.updated_at).toLocaleString() : 'N/A'}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showStaffEntryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-3xl bg-white text-slate-900 shadow-2xl">
            <div className="flex justify-between items-center mb-6 p-8 pb-0">
              <h2 className="text-2xl font-black text-slate-900">{Number(form.id || 0) > 0 ? 'Edit Consignment Item' : 'Add New Consignment Item'}</h2>
              <button onClick={() => { resetForm(); setShowStaffEntryModal(false); }} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>

            <form className="space-y-6 overflow-auto flex-1 px-8 py-6">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Quick Code</label>
                <input
                  className="w-full p-4 bg-slate-100 border border-slate-200 rounded-2xl text-sm text-slate-500 cursor-not-allowed"
                  placeholder="Auto-generated unique 5-digit code"
                  value={form.quick_code}
                  readOnly
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Vendor Details</label>
                <div className="space-y-3">
                  <div className="relative">
                    <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      className="w-full p-4 pl-11 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                      placeholder="Search saved vendor by name, phone, address, or VID"
                      value={savedVendorSearch}
                      onChange={(e) => setSavedVendorSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        e.preventDefault();
                        const firstMatch = filteredSavedVendors[0];
                        if (!firstMatch) return;
                        applySavedVendorKey(buildSavedVendorKey(firstMatch));
                      }}
                    />
                  </div>

                  <select
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900"
                    value={selectedVendorKey}
                    onChange={(e) => {
                      const key = e.target.value;
                      applySavedVendorKey(key);
                    }}
                  >
                    <option value="">Select saved vendor (optional)</option>
                    {filteredSavedVendors.map((vendor) => {
                      const key = buildSavedVendorKey(vendor);
                      const signature = getVendorSignature(vendor.vendor_name, vendor.vendor_phone, vendor.vendor_address);
                      const vendorId = vendorIdBySignature.get(signature) || calculateVendorIdFromSignature(signature);
                      return (
                        <option key={key} value={key}>
                          {vendor.vendor_name} [VID {vendorId}]{vendor.vendor_phone ? ` - ${vendor.vendor_phone}` : ''}
                        </option>
                      );
                    })}
                    {!filteredSavedVendors.length && savedVendorSearch.trim() && (
                      <option value="" disabled>
                        No saved vendors match your search
                      </option>
                    )}
                  </select>

                  <input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400" placeholder="Vendor Name" value={form.vendor_name} onChange={(e) => setForm((prev: any) => ({ ...prev, vendor_name: e.target.value }))} />
                  <input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400" placeholder="Vendor Phone Number" value={form.vendor_phone} onChange={(e) => setForm((prev: any) => ({ ...prev, vendor_phone: e.target.value }))} />
                  <input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400" placeholder="Vendor Address" value={form.vendor_address} onChange={(e) => setForm((prev: any) => ({ ...prev, vendor_address: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Item Details</label>
                <div className="space-y-3">
                  <input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400" placeholder="Item Name" value={form.item_name} onChange={(e) => setForm((prev: any) => ({ ...prev, item_name: e.target.value }))} />
                  <input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400" placeholder="IMEI / Serial" value={form.imei_serial} onChange={(e) => setForm((prev: any) => ({ ...prev, imei_serial: e.target.value }))} />
                </div>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-sm font-bold text-slate-700">Pricing & Quantity</label>
                  <button
                    type="button"
                    onClick={applyConditionMatrixTotals}
                    className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    Use Matrix Totals
                  </button>
                </div>

                <div className="space-y-3">
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                  <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Condition Matrix</label>

                  {/* Condition toggle buttons */}
                  <div className="flex gap-2">
                    {CONDITION_KEYS.map((conditionKey) => {
                      const current = form.condition_matrix?.[conditionKey] || {};
                      const hasData = Number(String(current.price || '').replace(/,/g, '') || 0) > 0 || Number(current.stock || 0) > 0 || Number(String(current.cost || '').replace(/,/g, '') || 0) > 0;
                      const isActive = activeCondition === conditionKey;
                      return (
                        <button
                          key={conditionKey}
                          type="button"
                          onClick={() => {
                            if (isActive) return;
                            // Move data from active condition to new selection, clear the rest
                            const currentData = normalizeConditionMatrix(form.condition_matrix)[activeCondition] || { price: '', stock: '', cost: '' };
                            const emptySlot = { price: '', stock: '', cost: '' };
                            setForm((prev: any) => ({
                              ...prev,
                              condition_matrix: {
                                new: emptySlot,
                                open_box: emptySlot,
                                used: emptySlot,
                                [conditionKey]: { ...currentData },
                              },
                            }));
                            setActiveCondition(conditionKey);
                          }}
                          className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-black uppercase tracking-wide transition-all ${
                            isActive
                              ? 'bg-slate-900 text-white shadow-md'
                              : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {CONDITION_LABELS[conditionKey]}
                        </button>
                      );
                    })}
                  </div>

                  {/* Active condition fields */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Selling Price</label>
                      <input
                        className="w-full p-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                        type="text"
                        inputMode="numeric"
                        placeholder="0.00"
                        value={(() => {
                          const raw = String(form.condition_matrix?.[activeCondition]?.price || '');
                          const num = raw.replace(/,/g, '');
                          if (!num) return '';
                          const parts = num.split('.');
                          return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts.length > 1 ? '.' + parts[1] : '');
                        })()}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '');
                          const parts = raw.split('.');
                          const formatted = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts.length > 1 ? '.' + parts[1] : '');
                          setForm((prev: any) => ({
                            ...prev,
                            condition_matrix: {
                              ...normalizeConditionMatrix(prev.condition_matrix),
                              [activeCondition]: { ...normalizeConditionMatrix(prev.condition_matrix)[activeCondition], price: formatted },
                            },
                          }));
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Quantity</label>
                      <input
                        className="w-full p-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                        type="number"
                        min={0}
                        step="1"
                        placeholder="0"
                        value={form.condition_matrix?.[activeCondition]?.stock || ''}
                        onChange={(e) => setForm((prev: any) => ({
                          ...prev,
                          condition_matrix: {
                            ...normalizeConditionMatrix(prev.condition_matrix),
                            [activeCondition]: { ...normalizeConditionMatrix(prev.condition_matrix)[activeCondition], stock: e.target.value },
                          },
                        }))}
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 mb-1 block uppercase">Vendor Cost</label>
                      <input
                        className="w-full p-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                        type="text"
                        inputMode="numeric"
                        placeholder="0.00"
                        value={(() => {
                          const raw = String(form.condition_matrix?.[activeCondition]?.cost || '');
                          const num = raw.replace(/,/g, '');
                          if (!num) return '';
                          const parts = num.split('.');
                          return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts.length > 1 ? '.' + parts[1] : '');
                        })()}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '');
                          const parts = raw.split('.');
                          const formatted = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts.length > 1 ? '.' + parts[1] : '');
                          setForm((prev: any) => ({
                            ...prev,
                            condition_matrix: {
                              ...normalizeConditionMatrix(prev.condition_matrix),
                              [activeCondition]: { ...normalizeConditionMatrix(prev.condition_matrix)[activeCondition], cost: formatted },
                            },
                          }));
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Internal Notes</label>
                <textarea
                  className="w-full p-4 rounded-2xl border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  rows={3}
                  placeholder="Internal overall condition notes..."
                  value={form.internal_condition}
                  onChange={(e) => setForm((prev: any) => ({ ...prev, internal_condition: e.target.value }))}
                />
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <label className="block text-sm font-bold text-slate-700">Public Specs</label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                    onClick={() => setCustomSpecs((prev) => [...prev, createSpecRow()])}
                  >
                    <Plus size={14} /> Add Field
                  </button>
                </div>

                {customSpecs.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs text-slate-500">Add specs like Color, Battery Health, RAM, etc. (visible on invoice)</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customSpecs.map((row, index) => (
                      <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                        <input
                          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                          placeholder="e.g. Color"
                          value={row.key}
                          onChange={(e) => setCustomSpecs((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, key: e.target.value } : entry))}
                        />
                        <input
                          className="w-full p-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm"
                          placeholder="e.g. Midnight Black"
                          value={row.value}
                          onChange={(e) => setCustomSpecs((prev) => prev.map((entry, entryIndex) => entryIndex === index ? { ...entry, value: e.target.value } : entry))}
                        />
                        <button
                          type="button"
                          className="rounded-xl border border-rose-200 bg-rose-900/20 px-3 py-3 text-xs font-bold text-rose-400 hover:bg-rose-100 transition-colors"
                          onClick={() => setCustomSpecs((prev) => prev.filter((_, entryIndex) => entryIndex !== index))}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </form>

            <div className="border-t border-slate-200 bg-slate-50 px-8 py-4 rounded-b-3xl">
              <div className="grid gap-3 sm:grid-cols-2 sticky bottom-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveItem}
                  className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 transition-colors disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? 'Saving...' : (Number(form.id || 0) > 0 ? 'Save & Return to Pending' : 'Submit for Approval')}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    resetForm();
                    setShowStaffEntryModal(false);
                  }}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:cursor-not-allowed disabled:opacity-70"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    <div className="relative isolate space-y-5 overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#f6fbff_0%,#ffffff_58%,#f8fafc_100%)] p-3 sm:p-4 lg:p-5">
      <div className="pointer-events-none absolute -left-14 top-0 h-40 w-40 rounded-full bg-sky-200/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-44 w-44 rounded-full bg-violet-200/20 blur-3xl" />

      {/* ── Header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Consignment Workflow</p>
          <h1 className="text-2xl font-black text-slate-900">Consignment Hub</h1>
          <p className="mt-0.5 text-sm text-slate-500">Staff submit · Managers approve · Live in POS</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { resetForm(); setShowStaffEntryModal(true); }}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-slate-800 active:scale-95 transition-transform"
          >
            <Plus size={15} /> Add Product
          </button>
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Home size={15} />
          </Link>
        </div>
      </header>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Vendors', value: vendorSummaries.length, color: 'text-violet-700', bg: 'bg-violet-50 border-violet-100' },
          { label: 'In-Store Records', value: vendorSummaries.reduce((s: number, e: any) => s + Number(e.inStoreRecords || 0), 0), color: 'text-sky-700', bg: 'bg-sky-50 border-sky-100' },
          { label: 'In-Store Units', value: vendorSummaries.reduce((s: number, e: any) => s + Number(e.inStoreQuantity || 0), 0), color: 'text-emerald-400', bg: 'bg-emerald-900/20 border-emerald-700/30' },
          { label: 'Pending Approval', value: pendingItems.length, color: pendingItems.length > 0 ? 'text-amber-400' : 'text-slate-600', bg: pendingItems.length > 0 ? 'bg-amber-900/20 border-amber-200' : 'bg-slate-50 border-slate-200' },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-2xl border px-4 py-3 ${stat.bg}`}>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{stat.label}</p>
            <p className={`mt-1 text-2xl font-black ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* ── Main grid ── */}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">

        {/* ── Left: Vendor Sidebar ── */}
        <aside className="flex flex-col gap-4">
          <div className={`${GLASS_PANEL} flex flex-col gap-3 p-4`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-100">
                  <Users size={15} className="text-violet-700" />
                </div>
                <h2 className="text-sm font-black text-slate-900">Vendors</h2>
              </div>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700">{filteredVendorSummaries.length}</span>
            </div>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={vendorSearch}
                onChange={(e) => setVendorSearch(e.target.value)}
                placeholder="Search name, VID, phone…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-xs text-slate-300 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
            </div>

            {/* Vendor list */}
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-0.5">
              {filteredVendorSummaries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-6 text-center text-xs text-slate-400">No vendors found.</div>
              ) : filteredVendorSummaries.map((entry: VendorSummary) => {
                const isHybrid = entry.vendorType === 'HYBRID';
                const accentBorder = isHybrid ? 'border-l-sky-400' : 'border-l-violet-400';
                const typeBadge = isHybrid
                  ? 'bg-sky-100 text-sky-700'
                  : 'bg-violet-100 text-violet-700';
                return (
                  <button
                    key={entry.vendorName}
                    type="button"
                    onClick={() => { setSelectedVendorName(entry.vendorName); setShowVendorDetailsModal(true); }}
                    className={`group w-full rounded-xl border border-slate-200 border-l-4 ${accentBorder} bg-white px-3 py-2.5 text-left transition hover:border-slate-300 hover:shadow-sm active:scale-[0.99]`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate text-sm font-black text-slate-900">{entry.vendorName}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${typeBadge}`}>{isHybrid ? 'Hybrid' : 'Inner'}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-400">VID {entry.vendorId}</p>
                      </div>
                      <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-300 transition group-hover:text-slate-500" />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-center">
                      <div className="rounded-lg bg-slate-50 py-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Items</p>
                        <p className="text-xs font-black text-slate-300">{entry.inStoreRecords}</p>
                      </div>
                      <div className="rounded-lg bg-slate-50 py-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Units</p>
                        <p className="text-xs font-black text-slate-300">{entry.inStoreQuantity}</p>
                      </div>
                      <div className="rounded-lg bg-emerald-900/20 py-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">Profit</p>
                        <p className="text-xs font-black text-emerald-400">{formatCurrency(entry.inStoreProfitValue)}</p>
                      </div>
                    </div>
                    {entry.vendorPhone && (
                      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1"><Phone size={9} />{entry.vendorPhone}</span>
                        {entry.vendorAddress && <span className="flex items-center gap-1 truncate"><MapPin size={9} />{entry.vendorAddress}</span>}
                      </div>
                    )}
                    {isHybrid && entry.sourcedUnpaidValue > 0 && (
                      <p className="mt-1 text-[10px] font-semibold text-sky-600">Sourced unpaid: {formatCurrency(entry.sourcedUnpaidValue)}</p>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Type legend — compact */}
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-[10px]">
              <span className="flex items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 font-bold text-violet-700"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" />Inner</span>
              <span className="flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-2.5 py-1 font-bold text-sky-700"><span className="h-1.5 w-1.5 rounded-full bg-sky-400" />Hybrid</span>
              {outsideVendorInsight.count > 0 && (
                <span className="flex items-center gap-1.5 rounded-full border border-amber-700/30 bg-amber-900/20 px-2.5 py-1 font-bold text-amber-400"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Outside ({outsideVendorInsight.count})</span>
              )}
            </div>
          </div>

          {/* Vendor Portal */}
          {isManager && (
            <div className={`${GLASS_PANEL} p-4`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black text-slate-300">Vendor Portal</p>
                <button
                  type="button"
                  disabled={vendorPortalBusy}
                  onClick={() => void toggleVendorPortal()}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-white transition ${vendorPortalEnabled ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-600 hover:bg-slate-700'} disabled:opacity-60`}
                >
                  {vendorPortalBusy ? '…' : (vendorPortalEnabled ? 'Enabled' : 'Disabled')}
                </button>
              </div>
              {vendorPortalUrl && (
                <div className="mt-2 flex items-center gap-2">
                  <p className="flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">{vendorPortalUrl}</p>
                  <button type="button" onClick={() => void copyVendorPortalUrl()} className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">Copy</button>
                  <a href={vendorPortalUrl} target="_blank" rel="noreferrer" className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">Open</a>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ── Right: Approval Queue ── */}
        <section className={`${GLASS_PANEL} flex flex-col gap-4 p-4 sm:p-5`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-black text-slate-900">Approval Queue</h2>
            {/* Status tabs with counts */}
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'pending', 'approved', 'rejected', 'sold', 'returned'] as const).map((s) => {
                const count = s === 'all' ? items.length : items.filter((i: any) => String(i.status || 'pending').toLowerCase() === s).length;
                const isActive = status === s;
                const activeStyle = s === 'pending' ? 'bg-amber-900/200 text-white border-amber-500'
                  : s === 'approved' ? 'bg-emerald-600 text-white border-emerald-600'
                  : s === 'rejected' ? 'bg-rose-900/200 text-white border-rose-500'
                  : s === 'sold' ? 'bg-blue-900/200 text-white border-blue-500'
                  : s === 'returned' ? 'bg-violet-500 text-white border-violet-500'
                  : 'bg-slate-900 text-white border-slate-900';
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-widest transition ${isActive ? activeStyle : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
                  >
                    {s}
                    {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${isActive ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`}>{count}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search + status bar */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Search by code, IMEI, item, or vendor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {listLoading && <Loader2 size={16} className="animate-spin text-slate-400" />}
          </div>

          {isManager && pendingItems.length > 0 && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-900/20 px-3.5 py-2.5 text-sm font-semibold text-amber-300">
              <ShieldCheck size={15} className="shrink-0 text-amber-600" />
              {pendingItems.length} item{pendingItems.length !== 1 ? 's' : ''} awaiting your approval
            </div>
          )}

          {/* Queue items */}
          <div className="space-y-3">
            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
                <Package size={28} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm font-semibold text-slate-400">No items for this filter</p>
              </div>
            ) : paginatedItems.map((item: any) => {
              const itemStatus = String(item.status || 'pending').toLowerCase();
              const vendorId = vendorIdBySignature.get(getVendorSignature(item.vendor_name, item.vendor_phone, item.vendor_address)) || calculateVendorIdFromSignature(getVendorSignature(item.vendor_name, item.vendor_phone, item.vendor_address));
              const profit = (Number(item.selling_price || 0) || 0) - (Number(item.agreed_payout || 0) || 0);
              const qty = Math.max(0, Math.trunc(Number(item.quantity || 0) || 0));
              const soldQuantity = getSoldQuantityFromSpecs(item?.public_specs);
              const soldAmount = getSoldAmountFromSpecs(item?.public_specs, Number(item?.selling_price || 0) || 0);
              const totalReturnedQuantity = Math.max(0, Math.trunc(Number(item?.public_specs?.__returned_quantity_total || 0) || 0));
              const conditionMatrix = extractConditionMatrixFromSpecs(item.public_specs);
              const publicSpecs = mapSpecsToArray(item.public_specs);
              const conditionMatrixRows = CONDITION_KEYS
                .map((k) => { const slot = conditionMatrix[k] || { price: '', stock: '', cost: '' }; return { key: k, label: CONDITION_LABELS[k], price: Math.max(0, Number(slot.price || 0) || 0), stock: Math.max(0, Math.trunc(Number(slot.stock || 0) || 0)), cost: Math.max(0, Number(slot.cost || 0) || 0) }; })
                .filter((r) => r.price > 0 || r.stock > 0 || r.cost > 0);

              const statusConfig: Record<string, { pill: string; dot: string }> = {
                approved: { pill: 'border-emerald-200 bg-emerald-900/20 text-emerald-400', dot: 'bg-emerald-400' },
                rejected: { pill: 'border-rose-200 bg-rose-900/20 text-rose-400', dot: 'bg-rose-400' },
                sold:     { pill: 'border-blue-200 bg-blue-900/20 text-blue-400', dot: 'bg-blue-400' },
                returned: { pill: 'border-violet-200 bg-violet-50 text-violet-700', dot: 'bg-violet-400' },
                pending:  { pill: 'border-amber-200 bg-amber-900/20 text-amber-400', dot: 'bg-amber-400' },
              };
              const sc = statusConfig[itemStatus] || statusConfig.pending;

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItemDetail(item)}
                  className="group cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-md"
                >
                  {/* Card header */}
                  <div className="flex items-start justify-between gap-3 px-4 pt-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-slate-900">{item.item_name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span className="font-semibold text-slate-600">VID {vendorId} · {item.vendor_name}</span>
                        {item.imei_serial && <span>IMEI: {item.imei_serial}</span>}
                        {item.quick_code && <span>QC: {item.quick_code}</span>}
                      </div>
                    </div>
                    <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${sc.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${sc.dot}`} />{itemStatus}
                    </span>
                  </div>

                  {/* Stats grid */}
                  <div className="mt-3 grid grid-cols-4 divide-x divide-slate-100 border-y border-slate-100 bg-slate-50/60">
                    {[
                      { label: 'Payout', value: formatCurrency(Number(item.agreed_payout || 0)), color: 'text-slate-300' },
                      { label: 'Selling', value: formatCurrency(Number(item.selling_price || 0)), color: 'text-slate-300' },
                      { label: 'Profit', value: formatCurrency(profit), color: profit > 0 ? 'text-emerald-400' : 'text-slate-500' },
                      { label: 'Qty', value: qty, color: 'text-slate-300' },
                    ].map((cell) => (
                      <div key={cell.label} className="py-2.5 text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{cell.label}</p>
                        <p className={`mt-0.5 text-sm font-black ${cell.color}`}>{cell.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Sales + returned row */}
                  <div className="flex flex-wrap gap-3 px-4 pt-2.5 text-[11px]">
                    {soldQuantity > 0 && (
                      <span className="font-semibold text-blue-400">Sold: {soldQuantity} × {formatCurrency(soldAmount)}</span>
                    )}
                    {totalReturnedQuantity > 0 && (
                      <span className="font-semibold text-violet-700">Returned: {totalReturnedQuantity} unit(s)</span>
                    )}
                  </div>

                  {/* Condition matrix tags */}
                  {conditionMatrixRows.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                      {conditionMatrixRows.map((row) => (
                        <span key={`${item.id}-${row.key}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
                          {row.label} · {formatCurrency(row.price)} · ×{row.stock}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Public spec badges */}
                  {publicSpecs.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pt-1.5">
                      {publicSpecs.map((entry: any) => (
                        <span key={`${item.id}-${entry.key}`} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500">
                          {entry.key}: {entry.value}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 bg-slate-50/50 px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => editItem(item)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-100">Edit</button>
                    {isManager && soldQuantity === 0 && (
                      <button type="button" onClick={() => void recalculateSold(item)} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] font-bold text-sky-700 hover:bg-sky-100">Fix Stats</button>
                    )}
                    {isManager && ['pending', 'approved'].includes(itemStatus) && (
                      <button type="button" onClick={() => void markReturnedToVendor(item)} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-bold text-violet-700 hover:bg-violet-100">
                        <Undo2 size={11} /> Return
                      </button>
                    )}
                    {isManager && itemStatus === 'pending' && (
                      <>
                        <button type="button" onClick={() => void updateReviewStatus(item, 'reject')} className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-900/20 px-2.5 py-1.5 text-[11px] font-bold text-rose-400 hover:bg-rose-100">
                          <XCircle size={11} /> Reject
                        </button>
                        <button type="button" onClick={() => void updateReviewStatus(item, 'approve')} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-900/20 px-2.5 py-1.5 text-[11px] font-bold text-emerald-400 hover:bg-emerald-100">
                          <CheckCircle2 size={11} /> Approve
                        </button>
                      </>
                    )}
                    {isManager && (
                      <button type="button" onClick={() => setDeleteCandidate(item)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-700/30 bg-rose-900/20 px-2.5 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-100">
                        <Trash2 size={11} /> Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {queueTotalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
              <p className="font-semibold text-slate-500">
                {queueRangeStart}–{queueRangeEnd} of <span className="text-slate-200">{items.length}</span>
              </p>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => setQueuePage(1)} disabled={queuePage === 1} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">First</button>
                <button type="button" onClick={() => setQueuePage((p) => Math.max(1, p - 1))} disabled={queuePage === 1} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Prev</button>
                <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 font-black text-slate-300">{queuePage} / {queueTotalPages}</span>
                <button type="button" onClick={() => setQueuePage((p) => Math.min(queueTotalPages, p + 1))} disabled={queuePage >= queueTotalPages} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>

    {selectedItemDetail && (() => {
      const det = selectedItemDetail;
      const detStatus = String(det.status || 'pending').toLowerCase();
      const detStatusClass = detStatus === 'approved' ? 'bg-emerald-100 text-emerald-400' : detStatus === 'rejected' ? 'bg-rose-100 text-rose-400' : detStatus === 'sold' ? 'bg-blue-100 text-blue-400' : detStatus === 'returned' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-400';
      const detSoldQty = getSoldQuantityFromSpecs(det?.public_specs);
      const detSoldAmount = getSoldAmountFromSpecs(det?.public_specs, Number(det?.selling_price || 0) || 0);
      const detReturnedQty = Math.max(0, Math.trunc(Number(det?.public_specs?.__returned_quantity_total || 0) || 0));
      const detReturnedAt = det?.public_specs?.__last_returned_at || null;
      const detReturnedReason = String(det?.public_specs?.__last_returned_reason || '').trim();
      const detLastReturnedQty = Math.max(0, Math.trunc(Number(det?.public_specs?.__last_returned_quantity || 0) || 0));
      const rawHistory: Array<{ quantity: number; reason: string | null; at: string; by: string | null }> =
        Array.isArray(det?.public_specs?.__return_history) ? det.public_specs.__return_history : [];
      // Backfill: if no history but there is collection data, synthesise one entry from __last_* fields
      const detReturnHistory = rawHistory.length === 0 && detReturnedAt
        ? [{ quantity: detLastReturnedQty || detReturnedQty, reason: detReturnedReason || null, at: detReturnedAt, by: null }]
        : rawHistory;
      // Show last 3 most recent; check if older entries exist beyond history log
      const shownHistory = [...detReturnHistory].reverse().slice(0, 3);
      const historyTrackedTotal = detReturnHistory.reduce((sum, e) => sum + Math.max(0, Number(e.quantity || 0)), 0);
      const unloggedUnits = Math.max(0, detReturnedQty - historyTrackedTotal);
      const detConditionMatrix = extractConditionMatrixFromSpecs(det.public_specs);
      const detMatrixRows = CONDITION_KEYS
        .map((k) => { const s = detConditionMatrix[k] || { price: '', stock: '', cost: '' }; return { key: k, label: CONDITION_LABELS[k], price: Math.max(0, Number(s.price || 0) || 0), stock: Math.max(0, Math.trunc(Number(s.stock || 0) || 0)), cost: Math.max(0, Number(s.cost || 0) || 0) }; })
        .filter((r) => r.price > 0 || r.stock > 0 || r.cost > 0);
      const detPublicSpecs = mapSpecsToArray(det.public_specs);
      const detVendorId = vendorIdBySignature.get(getVendorSignature(det.vendor_name, det.vendor_phone, det.vendor_address)) || calculateVendorIdFromSignature(getVendorSignature(det.vendor_name, det.vendor_phone, det.vendor_address));

      return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-t-3xl rounded-b-none border border-slate-200 bg-white shadow-2xl sm:rounded-3xl" style={{ maxHeight: '92vh' }}>

            {/* Dark header */}
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 to-slate-800 px-5 py-4">
              <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-violet-500 opacity-10" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${detStatusClass}`}>{detStatus}</div>
                  <h3 className="mt-1.5 text-lg font-black leading-snug text-white">{det.item_name}</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80">QC {det.quick_code || 'N/A'}</span>
                    {det.imei_serial && <span className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80">IMEI: {det.imei_serial}</span>}
                    <span className="rounded-lg bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80">{det.vendor_name} · VID {detVendorId}</span>
                  </div>
                </div>
                <button type="button" onClick={() => setSelectedItemDetail(null)} className="shrink-0 rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white">
                  <X size={18} />
                </button>
              </div>

              {/* Quick stat pills */}
              <div className="relative mt-3 grid grid-cols-4 gap-2">
                <div className="rounded-xl bg-white/10 px-2 py-2 text-center">
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">Qty</p>
                  <p className="mt-0.5 text-base font-black text-white">{Math.max(0, Math.trunc(Number(det.quantity || 0) || 0))}</p>
                </div>
                <div className="rounded-xl bg-white/10 px-2 py-2 text-center">
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">Payout</p>
                  <p className="mt-0.5 text-xs font-black text-white">{formatCurrency(Number(det.agreed_payout || 0) || 0)}</p>
                </div>
                <div className="rounded-xl bg-white/10 px-2 py-2 text-center">
                  <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">Selling</p>
                  <p className="mt-0.5 text-xs font-black text-white">{formatCurrency(Number(det.selling_price || 0) || 0)}</p>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-900/200/20 px-2 py-2 text-center">
                  <p className="text-[9px] font-black uppercase tracking-wide text-emerald-300">Profit</p>
                  <p className="mt-0.5 text-xs font-black text-emerald-200">{formatCurrency(Math.max(0, (Number(det.selling_price || 0) || 0) - (Number(det.agreed_payout || 0) || 0)))}</p>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">

              {/* Vendor Identity */}
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Vendor & Identity</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div><span className="font-semibold text-slate-500">Phone</span><p className="font-bold text-slate-800">{det.vendor_phone || 'N/A'}</p></div>
                  <div><span className="font-semibold text-slate-500">Address</span><p className="font-bold text-slate-800">{det.vendor_address || 'N/A'}</p></div>
                  {det.updated_at && <div className="col-span-2"><span className="font-semibold text-slate-500">Last Updated</span><p className="font-bold text-slate-800">{new Date(det.updated_at).toLocaleString()}</p></div>}
                </div>
              </div>

              {/* Sales */}
              <div className="rounded-xl border border-slate-200 p-3" style={{ backgroundColor: 'var(--surface)' }}>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-blue-500">Sales to Customers</p>
                <div className="flex items-center gap-6 text-sm">
                  <div><p className="text-[10px] text-slate-500">Units sold</p><p className="text-xl font-black text-slate-900">{detSoldQty}</p></div>
                  <div><p className="text-[10px] text-slate-500">Sales amount</p><p className="text-xl font-black text-slate-900">{formatCurrency(detSoldAmount)}</p></div>
                </div>
                {detSoldQty === 0 && <p className="mt-1 text-[11px] text-slate-400">No customer sales recorded yet.</p>}
              </div>

              {/* Vendor Collection */}
              {detReturnedQty > 0 ? (
                <div className="rounded-xl border border-slate-200 p-3 space-y-2" style={{ backgroundColor: 'var(--surface)' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-500">Vendor Collection</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-700">
                    <p><span className="font-semibold">Total collected back:</span> <strong className="text-slate-800">{detReturnedQty} unit(s)</strong></p>
                    {detLastReturnedQty > 0 && <p><span className="font-semibold">Last collection:</span> <strong className="text-slate-800">{detLastReturnedQty} unit(s)</strong></p>}
                    {detReturnedAt && <p className="col-span-2"><span className="font-semibold">Last collected at:</span> {new Date(detReturnedAt).toLocaleString()}</p>}
                  </div>
                  {/* History log */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Collection History</p>
                      {detReturnHistory.length > 3 && (
                        <span className="text-[10px] text-slate-400">Last 3 of {detReturnHistory.length}</span>
                      )}
                    </div>
                    {unloggedUnits > 0 && (
                      <div className="mb-2 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] text-slate-500" style={{ backgroundColor: 'var(--surface-muted)' }}>
                        {unloggedUnits} earlier unit(s) collected before history tracking was enabled — no individual records available.
                      </div>
                    )}
                    <div className="space-y-1.5">
                      {shownHistory.map((entry, idx) => (
                        <div key={idx} className="rounded-lg border border-slate-200 px-3 py-2" style={{ backgroundColor: 'var(--surface-muted)' }}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-bold text-violet-500">{entry.quantity} unit(s) collected</span>
                            <span className="text-[11px] text-slate-500">{entry.at ? new Date(entry.at).toLocaleString() : 'N/A'}</span>
                          </div>
                          {entry.by && <p className="text-[11px] text-slate-500 mt-0.5">By: {entry.by}</p>}
                          {entry.reason
                            ? <p className="mt-1 text-xs font-medium text-slate-700">Reason: {entry.reason}</p>
                            : <p className="text-[11px] text-slate-400 mt-0.5 italic">No reason recorded</p>
                          }
                        </div>
                      ))}
                      {shownHistory.length === 0 && (
                        <p className="text-[11px] text-slate-400 italic">No history entries available yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-500" style={{ backgroundColor: 'var(--surface-muted)' }}>
                  No vendor collection recorded yet.
                </div>
              )}

              {/* Condition Matrix */}
              {detMatrixRows.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Condition Matrix</p>
                  <div className="space-y-1.5">
                    {detMatrixRows.map((row) => (
                      <div key={row.key} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                        <span className="font-bold">{row.label}</span>
                        <span>Qty <strong className="text-slate-800">{row.stock}</strong></span>
                        <span>Selling <strong className="text-slate-800">{formatCurrency(row.price)}</strong></span>
                        <span>Cost <strong className="text-slate-800">{formatCurrency(row.cost)}</strong></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom Specs */}
              {detPublicSpecs.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Specifications</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detPublicSpecs.map((entry) => (
                      <span key={entry.key} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600">
                        <span className="font-semibold">{entry.key}:</span> {entry.value}
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>

            {/* Footer actions */}
            <div className="border-t border-slate-100 px-5 py-3 flex flex-wrap gap-2 justify-end">
              {isManager && ['pending', 'approved'].includes(detStatus) && (
                <button type="button" onClick={() => { setSelectedItemDetail(null); void markReturnedToVendor(det); }} className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100">
                  <Undo2 size={13} /> Return To Vendor
                </button>
              )}
              {detReturnedQty > 0 && det?.vendor_phone && (
                <button
                  type="button"
                  onClick={() => shareCollectionHistory(det, detReturnHistory, detReturnedQty)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700 hover:bg-green-100"
                >
                  <CheckCircle2 size={13} /> Share History via WhatsApp
                </button>
              )}
              <button type="button" onClick={() => { setSelectedItemDetail(null); editItem(det); }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100">
                Edit Item
              </button>
              <button type="button" onClick={() => setSelectedItemDetail(null)} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800">
                Close
              </button>
            </div>
          </div>
        </div>
      );
    })()}

    {deleteCandidate && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
          <p className="mb-1 text-xs font-black uppercase tracking-widest text-rose-500">Delete Item</p>
          <p className="mb-1 text-sm font-semibold text-slate-900">{deleteCandidate.item_name}</p>
          <p className="mb-4 text-xs text-slate-500">This will permanently remove the item and all its data. This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDeleteCandidate(null)} disabled={deleting} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void confirmDeleteItem()} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    )}

    {fixSoldModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
          <p className="mb-1 text-xs font-black uppercase tracking-widest text-slate-500">Fix Sold Stats</p>
          <p className="mb-4 text-sm font-semibold text-slate-900">{fixSoldModal.item.item_name}</p>
          <label className="mb-1 block text-xs font-semibold text-slate-600">Units sold / collected by vendor</label>
          <input
            type="number"
            min="0"
            value={fixSoldModal.qty}
            onChange={(e) => setFixSoldModal((prev) => prev ? { ...prev, qty: e.target.value } : null)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-400"
            autoFocus
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setFixSoldModal(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="button" onClick={() => void submitFixSold()} className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-700">Save</button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default ConsignmentHub;

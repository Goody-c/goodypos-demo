import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Package,
  AlertCircle,
  LayoutGrid,
  ListFilter,
  Loader2,
  Settings2,
  Check,
  X,
  Upload,
  ImageIcon,
  Home,
  RotateCcw,
  Download,
  Printer,
  ChevronDown,
  TrendingUp,
  ShoppingCart,
  MoreHorizontal,
} from 'lucide-react';
import { downloadCsv, formatCurrency, parseCsv } from '../../lib/utils';
import { getCurrencyConfig } from '../../lib/currency';
import { useNotification } from '../../context/NotificationContext';
import StockAdjustmentModal from '../../components/StockAdjustmentModal';

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const INVENTORY_PAGE_SIZE = 60;

const formatInventoryCurrency = (amount: number) => formatCurrency(amount).replace(/\s(?=\d)/, '\u00A0');

const formatInventoryUnits = (value: number | string) => {
  if (value === '' || value === null || value === undefined) return '';
  const num = Number(value);
  if (Number.isNaN(num)) return '';
  return num.toLocaleString('en-US');
};

const getInventoryAmountTextClass = (amount: number) => {
  const displayLength = formatInventoryCurrency(amount).length;

  if (displayLength >= 14) return 'text-[0.78rem] sm:text-[0.82rem]';
  if (displayLength >= 12) return 'text-[0.84rem] sm:text-[0.9rem]';
  if (displayLength >= 10) return 'text-[0.92rem]';
  return 'text-base';
};

const getInventoryUnitsTextClass = (value: number | string) => {
  const displayLength = formatInventoryUnits(value).length;

  if (displayLength >= 7) return 'text-[0.9rem] sm:text-[0.95rem]';
  if (displayLength >= 5) return 'text-[1rem]';
  return 'text-[1.08rem]';
};

const formatConditionLabel = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const normalizeCsvHeaderKey = (value: unknown) => String(value ?? '')
  .replace(/^\uFEFF/, '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const normalizeImportedProductRows = (rows: Array<Record<string, string>>) => (
  rows.map((row) => {
    const normalizedRow = Object.fromEntries(
      Object.entries(row || {}).map(([key, value]) => [normalizeCsvHeaderKey(key), value]),
    ) as Record<string, string>;

    return {
      ...row,
      ...normalizedRow,
      name: String(
        normalizedRow.name
        || normalizedRow.product_name
        || normalizedRow.product
        || '',
      ).trim(),
      product_name: String(
        normalizedRow.product_name
        || normalizedRow.name
        || normalizedRow.product
        || '',
      ).trim(),
      category: String(normalizedRow.category || '').trim(),
      barcode: String(
        normalizedRow.barcode
        || normalizedRow.sku
        || normalizedRow.barcode_sku
        || '',
      ).trim(),
      quick_code: String(normalizedRow.quick_code || '').trim(),
    };
  })
);

const Inventory: React.FC = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [store, setStore] = useState<any>(null);
  const inventoryCurrencySymbol = getCurrencyConfig(store?.currency_code).symbol;
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [sortBy, setSortBy] = useState<'recent' | 'price-low' | 'price-high' | 'category-az' | 'category-za'>('recent');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStockStatus, setSelectedStockStatus] = useState<'all' | 'low' | 'out' | 'healthy'>('all');
  const [selectedDate, setSelectedDate] = useState(() => getLocalDateValue());
  const [categories, setCategories] = useState<any[]>([]);
  const [dailySummary, setDailySummary] = useState<any>({ addedToday: 0, soldToday: 0, trend: [], selectedDate: getLocalDateValue() });
  const [showModal, setShowModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjustmentProduct, setAdjustmentProduct] = useState<any>(null);
  const [overviewProduct, setOverviewProduct] = useState<any>(null);
  const [overviewTab, setOverviewTab] = useState<'overview' | 'pricing' | 'stock' | 'specs'>('overview');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [categoryLoading, setCategoryLoading] = useState(false);
  
  // Recycle Bin States
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [deletedProducts, setDeletedProducts] = useState<any[]>([]);
  const [loadingDeleted, setLoadingDeleted] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<number[]>([]);
  const [labelProduct, setLabelProduct] = useState<any>(null);
  const [labelProducts, setLabelProducts] = useState<any[]>([]);
  const [barcodeLabelSvg, setBarcodeLabelSvg] = useState('');
  const [loadingLabel, setLoadingLabel] = useState(false);
  const [labelCopies, setLabelCopies] = useState(1);
  const [labelPrintMode, setLabelPrintMode] = useState<'single' | 'sheet'>('single');
  const [labelSheetPreset, setLabelSheetPreset] = useState<'2x5' | '3x7' | '4x10'>('3x7');
  const [inlineEditState, setInlineEditState] = useState<{ productId: number; field: string; value: string } | null>(null);
  const [inlineSavingKey, setInlineSavingKey] = useState<string | null>(null);
  const [pendingProductRequests, setPendingProductRequests] = useState<any[]>([]);
  const [pendingProductRequestsLoading, setPendingProductRequestsLoading] = useState(false);
  const [requestActionId, setRequestActionId] = useState<number | null>(null);
  const [editingRequestId, setEditingRequestId] = useState<number | null>(null);
  const [requestEditDrafts, setRequestEditDrafts] = useState<Record<number, { name: string; category: string; barcode: string; price: string; stock: string }>>({});
  const [staffPendingSubmissions, setStaffPendingSubmissions] = useState<any[]>([]);
  const [staffPendingSubmissionsLoading, setStaffPendingSubmissionsLoading] = useState(false);
  const [staffSubmissionsPage, setStaffSubmissionsPage] = useState(1);
  const STAFF_SUBMISSIONS_PAGE_SIZE = 5;
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const inlineTapTrackerRef = useRef<Record<string, number>>({});
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canManageProducts = user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN' || user?.role === 'MANAGER' || user?.role === 'PROCUREMENT_OFFICER';
  const canManageCategories = canManageProducts;
  const canApproveProductRequests = user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER';
  const isStaff = user?.role === 'STAFF';
  const canCreateProducts = canManageProducts || isStaff;
  const canEditProducts = canManageProducts;
  const canDeleteProducts = user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const canAdjustStock = canManageProducts;
  const canImportProducts = canAdjustStock;
  const canViewCostFields = user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN' || user?.role === 'ACCOUNTANT' || user?.role === 'PROCUREMENT_OFFICER';
  const importProductsRef = useRef<HTMLInputElement>(null);
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [activeCondition, setActiveCondition] = useState<'new' | 'open_box' | 'used'>('new');
  const [activeConditionPerProduct, setActiveConditionPerProduct] = useState<Record<number, string>>({});
  const moreActionsRef = useRef<HTMLDivElement>(null);
  
  const [formData, setFormData] = useState<any>({
    name: '',
    barcode: '',
    category: '',
    thumbnail: '',
    price: '',
    stock: '',
    cost: '',
    specs: {},
    condition_matrix: {
      new: { price: '', stock: '', cost: '' },
      open_box: { price: '', stock: '', cost: '' },
      used: { price: '', stock: '', cost: '' }
    }
  });

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    loadDailySummary(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    setInventoryPage(1);
    setSelectedProductIds([]);
  }, [search, selectedCategory, selectedStockStatus, sortBy]);

  useEffect(() => {
    if (!showMoreActions) return;
    const handler = (e: MouseEvent) => {
      if (moreActionsRef.current && !moreActionsRef.current.contains(e.target as Node)) setShowMoreActions(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [showMoreActions]);

  const loadDailySummary = async (dateValue = selectedDate) => {
    try {
      const summaryData = await appFetch(`/api/inventory/daily-summary?date=${encodeURIComponent(dateValue)}&days=14`);
      setDailySummary(summaryData);
    } catch (err) {
      console.error('Failed to load inventory summary:', err);
      setDailySummary({ addedToday: 0, soldToday: 0, trend: [], selectedDate: dateValue });
    }
  };

  const loadProductsPage = async (
    page = inventoryPage,
    searchTerm = search.trim(),
    category = selectedCategory,
    stockStatus = selectedStockStatus,
    sort = sortBy
  ) => {
    setProductsLoading(true);
    try {
      const query = new URLSearchParams({
        limit: String(INVENTORY_PAGE_SIZE),
        offset: String((page - 1) * INVENTORY_PAGE_SIZE),
        sort,
      });

      if (searchTerm) {
        query.set('search', searchTerm);
      }

      if (category !== 'all') {
        query.set('category', category);
      }

      if (stockStatus !== 'all') {
        query.set('stock_status', stockStatus);
      }

      const data = await appFetch(`/api/products?${query.toString()}`);
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      const total = Array.isArray(data) ? items.length : Number(data?.total || 0);

      setProducts(items);
      setProductTotal(total);
    } catch (err) {
      console.error('Failed to load products:', err);
      setProducts([]);
      setProductTotal(0);
    } finally {
      setProductsLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const [storeData, categoriesData] = await Promise.all([
        appFetch('/api/store/settings'),
        appFetch('/api/categories')
      ]);
      setStore(storeData);
      setCategories(Array.isArray(categoriesData) ? categoriesData : []);
      await loadProductsPage(1, search.trim(), selectedCategory, selectedStockStatus, sortBy);
      if (canApproveProductRequests) {
        await loadPendingProductRequests();
      }
      if (isStaff) {
        await loadStaffPendingSubmissions();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadPendingProductRequests = async () => {
    if (!canApproveProductRequests) {
      setPendingProductRequests([]);
      return;
    }

    setPendingProductRequestsLoading(true);
    try {
      const rows = await appFetch('/api/product-change-requests?status=PENDING');
      setPendingProductRequests(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setPendingProductRequests([]);
      showNotification({ message: String(err?.message || err || 'Failed to load pending product requests'), type: 'error' });
    } finally {
      setPendingProductRequestsLoading(false);
    }
  };

  const loadStaffPendingSubmissions = async () => {
    if (!isStaff) {
      setStaffPendingSubmissions([]);
      return;
    }

    setStaffPendingSubmissionsLoading(true);
    try {
      const rows = await appFetch('/api/product-change-requests?status=PENDING');
      setStaffPendingSubmissions(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      setStaffPendingSubmissions([]);
      showNotification({ message: String(err?.message || err || 'Failed to load your pending submissions'), type: 'error' });
    } finally {
      setStaffPendingSubmissionsLoading(false);
    }
  };

  const deriveRequestDisplayValues = (payload: any) => {
    const matrix = payload?.condition_matrix && typeof payload.condition_matrix === 'object'
      ? payload.condition_matrix
      : null;

    const matrixPrices = matrix
      ? ['new', 'open_box', 'used']
        .map((key) => Math.max(0, Number((matrix as any)?.[key]?.price || 0) || 0))
        .filter((value) => value > 0)
      : [];
    const matrixStock = matrix
      ? ['new', 'open_box', 'used']
        .map((key) => Math.max(0, Math.trunc(Number((matrix as any)?.[key]?.stock || 0) || 0)))
        .reduce((sum, value) => sum + value, 0)
      : 0;

    const basePrice = Math.max(0, Number(payload?.price || 0) || 0);
    const baseStock = Math.max(0, Math.trunc(Number(payload?.stock || 0) || 0));

    return {
      price: basePrice > 0 ? basePrice : (matrixPrices.length > 0 ? Math.min(...matrixPrices) : 0),
      stock: baseStock > 0 ? baseStock : matrixStock,
    };
  };

  const beginProductRequestEdit = (request: any) => {
    const requestId = Number(request?.id || 0);
    if (!requestId) return;
    const payload = request?.payload || {};
    const derived = deriveRequestDisplayValues(payload);

    setRequestEditDrafts((prev) => ({
      ...prev,
      [requestId]: {
        name: String(payload?.name || ''),
        category: String(payload?.category || ''),
        barcode: String(payload?.barcode || ''),
        price: String(Math.max(0, Number(payload?.price || derived.price || 0) || 0)),
        stock: String(Math.max(0, Math.trunc(Number(payload?.stock || derived.stock || 0) || 0))),
      },
    }));
    setEditingRequestId(requestId);
  };

  const handleProductRequestDecision = async (requestId: number, action: 'approve' | 'reject', overridePayload?: any) => {
    setRequestActionId(requestId);
    try {
      await appFetch(`/api/product-change-requests/${requestId}/${action}`, {
        method: 'POST',
        ...(overridePayload ? { body: JSON.stringify({ payload: overridePayload }) } : {}),
      });
      showNotification({ message: `Request ${action}d successfully.`, type: 'success' });
      await Promise.all([
        loadProductsPage(inventoryPage, search.trim(), selectedCategory, selectedStockStatus, sortBy),
        loadPendingProductRequests(),
      ]);
      setEditingRequestId((current) => (current === requestId ? null : current));
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || `Failed to ${action} request`), type: 'error' });
    } finally {
      setRequestActionId(null);
    }
  };

  const openCategoryModal = () => {
    if (!canManageCategories) {
      showNotification({ message: 'Only store admins can edit inventory categories.', type: 'warning' });
      return;
    }
    setNewCategoryName('');
    setNewCategoryDescription('');
    setShowCategoryModal(true);
  };

  const closeCategoryModal = () => {
    setShowCategoryModal(false);
  };

  const handleSaveCategory = async () => {
    if (!canManageCategories) {
      showNotification({ message: 'Only store admins can edit inventory categories.', type: 'error' });
      return;
    }

    const trimmedName = newCategoryName.trim();
    if (!trimmedName) {
      showNotification({ message: 'Category name is required', type: 'error' });
      return;
    }

    setCategoryLoading(true);
    try {
      const created = await appFetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, description: newCategoryDescription.trim() || null })
      });

      setCategories((prev) => [...prev, created]);
      setFormData((prev: any) => ({ ...prev, category: created.name, category_id: created.id }));
      showNotification({ message: `Category ${created.name} added`, type: 'success' });
      setShowCategoryModal(false);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally {
      setCategoryLoading(false);
    }
  };

  const loadDeletedProducts = async () => {
    setLoadingDeleted(true);
    try {
      const data = await appFetch('/api/admin/inventory/deleted');
      // Filter for current store if not system admin, but user said "accessible only to System Admins"
      // So we'll show all deleted products if they are system admin
      setDeletedProducts(data);
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setLoadingDeleted(false);
    }
  };

  const restoreProduct = async (id: number) => {
    try {
      await appFetch(`/api/admin/inventory/restore/${id}`, { method: 'POST' });
      loadDeletedProducts();
      loadData();
      showNotification({ message: 'Product restored successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const openStockAdjustmentModal = (product: any = null) => {
    if (!canAdjustStock) {
      showNotification({ message: 'Staff accounts can only view inventory. Ask a manager or admin to update stock.', type: 'warning' });
      return;
    }
    setAdjustmentProduct(product);
    setShowAdjustmentModal(true);
  };

  const openProductOverview = (product: any, initialTab: 'overview' | 'pricing' | 'stock' | 'specs' = 'overview') => {
    setOverviewProduct(product);
    setOverviewTab(initialTab);
  };

  const closeProductOverview = () => {
    setOverviewProduct(null);
    setOverviewTab('overview');
  };

  const handleStockAdjustmentSaved = async () => {
    await loadProductsPage(inventoryPage, search.trim(), selectedCategory, selectedStockStatus, sortBy);
    await loadDailySummary(selectedDate);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const canSubmitCurrentAction = editingProduct ? canEditProducts : canCreateProducts;
    if (!canSubmitCurrentAction) {
      showNotification({ message: 'You are not allowed to submit inventory changes.', type: 'error' });
      return;
    }

    // Validate product name
    if (!formData.name || formData.name.trim().length === 0) {
      showNotification({ message: 'Product name is required.', type: 'warning' });
      return;
    }

    // Check if product has any condition-based pricing
    const hasConditionPricing = store?.mode === 'GADGET' && formData.condition_matrix && ['new', 'open_box', 'used'].some((cond) => {
      return Number((formData.condition_matrix as any)?.[cond]?.price || 0) > 0;
    });

    // Validate selling price - required unless condition-based pricing exists
    if (!hasConditionPricing && Number(formData.price || 0) <= 0) {
      showNotification({ message: 'Selling price is required before saving this product (or set condition-based pricing for Smart Retail Mode).', type: 'warning' });
      return;
    }

    if (store?.mode === 'GADGET') {
      const invalidCondition = ['new', 'open_box', 'used'].find((cond) => {
        const slot = formData.condition_matrix?.[cond] || {};
        const hasAnyValue = Number(slot.price || 0) > 0 || Number(slot.stock || 0) > 0 || Number(slot.cost || 0) > 0;
        return hasAnyValue && Number(slot.price || 0) <= 0;
      });

      if (invalidCondition) {
        showNotification({
          message: `Selling price is required for ${String(invalidCondition).replace('_', ' ')} items. Cost price is optional.`,
          type: 'warning',
        });
        return;
      }
    }
    try {
      const url = editingProduct ? `/api/products/${editingProduct.id}` : '/api/products';
      const method = editingProduct ? 'PUT' : 'POST';
      
      const dataToSubmit = {
        ...formData,
        price: formData.price === '' ? 0 : Number(formData.price),
        stock: formData.stock === '' ? 0 : Number(formData.stock),
        cost: formData.cost === '' ? 0 : Number(formData.cost),
        category_id: formData.category_id,
        condition_matrix: store?.mode === 'SUPERMARKET' ? null : {
          new: {
            price: formData.condition_matrix.new.price === '' ? 0 : Number(formData.condition_matrix.new.price),
            stock: formData.condition_matrix.new.stock === '' ? 0 : Number(formData.condition_matrix.new.stock),
            cost: formData.condition_matrix.new.cost === '' ? 0 : Number(formData.condition_matrix.new.cost)
          },
          open_box: {
            price: formData.condition_matrix.open_box.price === '' ? 0 : Number(formData.condition_matrix.open_box.price),
            stock: formData.condition_matrix.open_box.stock === '' ? 0 : Number(formData.condition_matrix.open_box.stock),
            cost: formData.condition_matrix.open_box.cost === '' ? 0 : Number(formData.condition_matrix.open_box.cost)
          },
          used: {
            price: formData.condition_matrix.used.price === '' ? 0 : Number(formData.condition_matrix.used.price),
            stock: formData.condition_matrix.used.stock === '' ? 0 : Number(formData.condition_matrix.used.stock),
            cost: formData.condition_matrix.used.cost === '' ? 0 : Number(formData.condition_matrix.used.cost)
          }
        }
      };

      const result = await appFetch(url, {
        method,
        body: JSON.stringify(dataToSubmit),
      });
      setShowModal(false);
      setEditingProduct(null);
      resetForm();
      await loadData();
      const savedBarcode = String(result?.barcode || dataToSubmit.barcode || '').trim();
      showNotification({
        message: result?.pendingApproval
          ? 'Change submitted for manager/store owner approval.'
          : (editingProduct
            ? 'Product updated successfully'
            : `Product saved successfully${savedBarcode ? ` with barcode ${savedBarcode}` : ''}`),
        type: 'success'
      });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const resetForm = () => {
    setThumbnailUrl('');
    setIsDraggingImage(false);
    setFormData({
      name: '',
      barcode: '',
      category: '',
      category_id: null,
      thumbnail: '',
      price: '',
      stock: '',
      cost: '',
      specs: {},
      condition_matrix: {
        new: { price: '', stock: '', cost: '' },
        open_box: { price: '', stock: '', cost: '' },
        used: { price: '', stock: '', cost: '' }
      }
    });
  };

  const handleEdit = (p: any) => {
    if (!canEditProducts) {
      showNotification({ message: 'You can add products only. Editing existing products is not allowed for your role.', type: 'warning' });
      return;
    }

    setEditingProduct(p);
    const matrix = p.condition_matrix || {
      new: { price: 0, stock: 0, cost: p.cost || 0 },
      open_box: { price: 0, stock: 0, cost: p.cost || 0 },
      used: { price: 0, stock: 0, cost: p.cost || 0 }
    };
    const fallbackCost = p.cost === 0 ? '' : p.cost;
    
    setThumbnailUrl(/^https?:\/\//i.test(String(p.thumbnail || '')) ? String(p.thumbnail) : '');
    setFormData({
      ...p,
      category_id: p.category_id || null,
      price: p.price === 0 ? '' : p.price,
      stock: p.stock === 0 ? '' : p.stock,
      cost: p.cost === 0 ? '' : p.cost,
      specs: p.specs || {},
      condition_matrix: {
        new: { 
          price: matrix.new.price === 0 ? '' : matrix.new.price, 
          stock: matrix.new.stock === 0 ? '' : matrix.new.stock,
          cost: Number(matrix.new.cost ?? fallbackCost) === 0 ? '' : Number(matrix.new.cost ?? fallbackCost)
        },
        open_box: { 
          price: matrix.open_box.price === 0 ? '' : matrix.open_box.price, 
          stock: matrix.open_box.stock === 0 ? '' : matrix.open_box.stock,
          cost: Number(matrix.open_box.cost ?? fallbackCost) === 0 ? '' : Number(matrix.open_box.cost ?? fallbackCost)
        },
        used: { 
          price: matrix.used.price === 0 ? '' : matrix.used.price, 
          stock: matrix.used.stock === 0 ? '' : matrix.used.stock,
          cost: Number(matrix.used.cost ?? fallbackCost) === 0 ? '' : Number(matrix.used.cost ?? fallbackCost)
        }
      }
    });
    setShowModal(true);
  };

  const formatNumberForInput = (value: number | string) => formatInventoryUnits(value);

  const parseNumberFromInput = (raw: string) => {
    const cleaned = raw.replace(/[^\d.-]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return '';
    const num = Number(cleaned);
    return Number.isNaN(num) ? '' : num;
  };

  const getInlineFieldKey = (productId: number, field: string) => `${productId}:${field}`;

  const isInlineEditing = (productId: number, field: string) => (
    inlineEditState?.productId === productId && inlineEditState.field === field
  );

  const isInlineSaving = (productId: number, field: string) => inlineSavingKey === getInlineFieldKey(productId, field);

  const beginInlineEdit = (product: any, field: string, initialValue: unknown) => {
    if (!canEditProducts) {
      showNotification({ message: 'Editing existing products is not allowed for your role.', type: 'warning' });
      return;
    }

    const productId = Number(product?.id || 0);
    if (!productId) return;

    setInlineEditState({ productId, field, value: String(initialValue ?? '') });
  };

  const handleInlineFieldGesture = (product: any, field: string, initialValue: unknown) => {
    const key = getInlineFieldKey(Number(product?.id || 0), field);
    const now = Date.now();
    const previousTap = inlineTapTrackerRef.current[key] || 0;

    if (now - previousTap <= 320) {
      inlineTapTrackerRef.current[key] = 0;
      beginInlineEdit(product, field, initialValue);
      return;
    }

    inlineTapTrackerRef.current[key] = now;
  };

  const buildProductUpdatePayload = (product: any) => {
    let rawMatrix = product?.condition_matrix;
    if (typeof rawMatrix === 'string') {
      try {
        rawMatrix = JSON.parse(rawMatrix);
      } catch {
        rawMatrix = {};
      }
    }

    const fallbackCost = Math.max(0, Number(product?.cost ?? 0) || 0);
    const normalizedMatrix = ['new', 'open_box', 'used'].reduce((acc, cond) => {
      const entry = rawMatrix?.[cond] || {};
      acc[cond] = {
        ...entry,
        price: Math.max(0, Number(entry?.price ?? 0) || 0),
        stock: Math.max(0, Math.trunc(Number(entry?.stock ?? 0) || 0)),
        cost: Math.max(0, Number(entry?.cost ?? fallbackCost) || 0),
      };
      return acc;
    }, {} as Record<string, { price: number; stock: number; cost: number }>);

    const positiveConditionPrices = Object.values(normalizedMatrix)
      .map((entry) => Number(entry.price) || 0)
      .filter((value) => value > 0);
    const totalConditionStock = Object.values(normalizedMatrix)
      .reduce((sum, entry) => sum + (Math.max(0, Math.trunc(Number(entry.stock) || 0))), 0);
    const hasConditionEntries = Object.values(normalizedMatrix)
      .some((entry) => Number(entry.price || 0) > 0 || Number(entry.stock || 0) > 0 || Number(entry.cost || 0) > 0);

    return {
      name: String(product?.name || '').trim(),
      barcode: String(product?.barcode || '').trim(),
      quick_code: String(product?.quick_code || '').trim(),
      category: String(product?.category || '').trim(),
      category_id: product?.category_id || null,
      thumbnail: product?.thumbnail || null,
      specs: product?.specs && typeof product.specs === 'object' ? product.specs : {},
      condition_matrix: store?.mode === 'GADGET' || hasConditionEntries ? normalizedMatrix : null,
      price: store?.mode === 'GADGET'
        ? (positiveConditionPrices.length > 0 ? Math.min(...positiveConditionPrices) : Math.max(0, Number(product?.price) || 0))
        : Math.max(0, Number(product?.price) || 0),
      stock: store?.mode === 'GADGET'
        ? totalConditionStock
        : Math.max(0, Math.trunc(Number(product?.stock) || 0)),
      cost: Math.max(0, Number(product?.cost ?? 0) || 0),
    };
  };

  const saveInlineEdit = async (product: any) => {
    if (!inlineEditState || Number(product?.id || 0) !== Number(inlineEditState.productId)) {
      return;
    }

    const payload = buildProductUpdatePayload(product);
    const fieldKey = getInlineFieldKey(Number(product.id), inlineEditState.field);
    const rawValue = String(inlineEditState.value || '');
    const trimmedValue = rawValue.trim();

    if (inlineEditState.field === 'name') {
      if (!trimmedValue) {
        showNotification({ message: 'Product name cannot be empty.', type: 'warning' });
        return;
      }
      payload.name = trimmedValue;
    } else if (inlineEditState.field === 'category') {
      const normalizedCategory = trimmedValue || 'General';
      const matchedCategory = categories.find((item) => String(item?.name || '').trim().toLowerCase() === normalizedCategory.toLowerCase());
      payload.category = matchedCategory?.name || normalizedCategory;
      payload.category_id = matchedCategory?.id || null;
    } else if (inlineEditState.field === 'price') {
      const parsedValue = parseNumberFromInput(rawValue);
      if (parsedValue === '') {
        showNotification({ message: 'Enter a valid selling price.', type: 'warning' });
        return;
      }
      payload.price = Math.max(0, Number(parsedValue) || 0);
    } else if (inlineEditState.field === 'stock') {
      const parsedValue = parseNumberFromInput(rawValue);
      if (parsedValue === '') {
        showNotification({ message: 'Enter a valid stock quantity.', type: 'warning' });
        return;
      }
      payload.stock = Math.max(0, Math.trunc(Number(parsedValue) || 0));
    } else if (inlineEditState.field.startsWith('condition:')) {
      const [, conditionKey, property] = inlineEditState.field.split(':');
      const parsedValue = parseNumberFromInput(rawValue);

      if (!['new', 'open_box', 'used'].includes(conditionKey) || !['price', 'stock'].includes(property) || parsedValue === '') {
        showNotification({ message: 'Enter a valid condition value.', type: 'warning' });
        return;
      }

      payload.condition_matrix[conditionKey] = {
        ...payload.condition_matrix[conditionKey],
        [property]: property === 'stock'
          ? Math.max(0, Math.trunc(Number(parsedValue) || 0))
          : Math.max(0, Number(parsedValue) || 0),
      };

      const positiveConditionPrices = ['new', 'open_box', 'used']
        .map((key) => Number(payload.condition_matrix[key]?.price || 0))
        .filter((value) => value > 0);
      payload.price = positiveConditionPrices.length > 0 ? Math.min(...positiveConditionPrices) : 0;
      payload.stock = ['new', 'open_box', 'used']
        .reduce((sum, key) => sum + Math.max(0, Math.trunc(Number(payload.condition_matrix[key]?.stock || 0))), 0);
    }

    setInlineSavingKey(fieldKey);
    try {
      await appFetch(`/api/products/${product.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });

      setInlineEditState(null);
      await loadProductsPage(inventoryPage, search.trim(), selectedCategory, selectedStockStatus, sortBy);
      showNotification({ message: 'Change submitted for manager/store owner approval.', type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally {
      setInlineSavingKey(null);
    }
  };

  const getInlineActivationProps = (product: any, field: string, initialValue: unknown) => {
    if (!canEditProducts || isInlineEditing(Number(product?.id || 0), field)) {
      return {};
    }

    return {
      role: 'button',
      tabIndex: 0,
      title: 'Double-click or double-tap to edit this field',
      onClick: () => handleInlineFieldGesture(product, field, initialValue),
      onDoubleClick: () => beginInlineEdit(product, field, initialValue),
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          beginInlineEdit(product, field, initialValue);
        }
      },
    };
  };

  const renderInlineEditor = (
    product: any,
    field: string,
    options: {
      type?: 'text' | 'select';
      inputMode?: 'text' | 'decimal' | 'numeric';
      placeholder?: string;
      selectOptions?: string[];
    } = {},
  ) => {
    if (!isInlineEditing(Number(product?.id || 0), field) || !inlineEditState) {
      return null;
    }

    const saving = isInlineSaving(Number(product?.id || 0), field);

    return (
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-2 shadow-sm">
        {options.type === 'select' ? (
          <select
            autoFocus
            value={inlineEditState.value}
            onChange={(event) => setInlineEditState((current) => (current ? { ...current, value: event.target.value } : current))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveInlineEdit(product);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setInlineEditState(null);
              }
            }}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
          >
            {(options.selectOptions || ['General']).map((optionValue) => (
              <option key={optionValue} value={optionValue}>{optionValue}</option>
            ))}
          </select>
        ) : (
          <input
            autoFocus
            type="text"
            inputMode={options.inputMode || 'text'}
            value={inlineEditState.value}
            onChange={(event) => {
              const nextValue = event.target.value;
              const shouldFormatNumeric = options.inputMode === 'decimal' || options.inputMode === 'numeric';
              const formattedValue = shouldFormatNumeric
                ? (() => {
                    const parsed = parseNumberFromInput(nextValue);
                    return parsed === '' ? '' : formatNumberForInput(parsed);
                  })()
                : nextValue;

              setInlineEditState((current) => (current ? { ...current, value: formattedValue } : current));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void saveInlineEdit(product);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setInlineEditState(null);
              }
            }}
            placeholder={options.placeholder || 'Update value'}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
          />
        )}

        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setInlineEditState(null)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void saveInlineEdit(product); }}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
        </div>
      </div>
    );
  };

  const calculateBarcodeCheckDigit = (base12: string) => {
    const digits = base12.replace(/\D/g, '');
    if (digits.length !== 12) return '0';

    const weightedSum = digits
      .split('')
      .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);

    return String((10 - (weightedSum % 10)) % 10);
  };

  const createAutoBarcodeValue = () => {
    const storeSeed = String(store?.id || user?.store_id || 0).padStart(4, '0').slice(-4);
    const timeSeed = String(Date.now()).slice(-5).padStart(5, '0');
    const randomSeed = String(Math.floor(Math.random() * 10));
    const base12 = `20${storeSeed}${timeSeed}${randomSeed}`;
    return `${base12}${calculateBarcodeCheckDigit(base12)}`;
  };

  const handleGenerateBarcode = () => {
    const nextBarcode = createAutoBarcodeValue();
    setFormData((prev: any) => ({ ...prev, barcode: nextBarcode }));
    showNotification({ message: `Barcode generated: ${nextBarcode}`, type: 'success' });
  };

  const escapeHtml = (value: unknown) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const renderBarcodeLabelSvg = async (value: string) => {
    const barcodeValue = String(value || '').trim();
    if (!barcodeValue) {
      throw new Error('This product does not have a barcode yet.');
    }

    const { default: JsBarcode } = await import('jsbarcode');
    const svgNode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const format = /^\d{12,13}$/.test(barcodeValue) ? 'EAN13' : 'CODE128';

    JsBarcode(svgNode, barcodeValue, {
      format,
      displayValue: true,
      background: '#ffffff',
      lineColor: '#0f172a',
      margin: 0,
      textMargin: 4,
      fontOptions: 'bold',
      fontSize: 14,
      width: barcodeValue.length > 14 ? 1.5 : 2,
      height: 64,
    });

    svgNode.setAttribute('width', '100%');
    svgNode.setAttribute('height', '88');
    svgNode.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    return svgNode.outerHTML;
  };

  const openBarcodeLabel = async (product: any) => {
    const barcodeValue = String(product?.barcode || product?.quick_code || '').trim();
    if (!barcodeValue) {
      showNotification({ message: 'This product has no barcode to print yet.', type: 'warning' });
      return;
    }

    setLabelProduct(product);
    setLabelProducts([product]);
    setBarcodeLabelSvg('');
    setLoadingLabel(true);
    setLabelCopies(1);
    setLabelPrintMode('single');
    setLabelSheetPreset('3x7');

    try {
      const svgMarkup = await renderBarcodeLabelSvg(barcodeValue);
      setBarcodeLabelSvg(svgMarkup);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to render barcode label'), type: 'error' });
    } finally {
      setLoadingLabel(false);
    }
  };

  const closeBarcodeLabel = () => {
    setLabelProduct(null);
    setLabelProducts([]);
    setBarcodeLabelSvg('');
    setLoadingLabel(false);
    setLabelCopies(1);
    setLabelPrintMode('single');
    setLabelSheetPreset('3x7');
  };

  const sheetPresetConfig = {
    '2x5': { columns: 2, width: '90mm', minHeight: '50mm', gap: '6mm', label: '2 × 5' },
    '3x7': { columns: 3, width: '63.5mm', minHeight: '38.1mm', gap: '4mm', label: '3 × 7' },
    '4x10': { columns: 4, width: '48mm', minHeight: '25.4mm', gap: '3mm', label: '4 × 10' },
  } as const;

  const handleOpenBulkBarcodeLabels = async () => {
    if (!selectedProducts.length) {
      showNotification({ message: 'Select one or more products first.', type: 'warning' });
      return;
    }

    const printableProducts = selectedProducts.filter((product) => String(product?.barcode || product?.quick_code || '').trim());
    const skippedCount = selectedProducts.length - printableProducts.length;

    if (!printableProducts.length) {
      showNotification({ message: 'The selected products do not have printable barcodes yet.', type: 'warning' });
      return;
    }

    if (skippedCount > 0) {
      showNotification({ message: `Skipped ${skippedCount} selected product(s) without barcodes.`, type: 'warning' });
    }

    setLabelProduct(printableProducts[0]);
    setLabelProducts(printableProducts);
    setBarcodeLabelSvg('');
    setLoadingLabel(true);
    setLabelCopies(1);
    setLabelPrintMode('sheet');
    setLabelSheetPreset('3x7');

    try {
      const svgMarkup = await renderBarcodeLabelSvg(String(printableProducts[0]?.barcode || printableProducts[0]?.quick_code || ''));
      setBarcodeLabelSvg(svgMarkup);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to render barcode labels'), type: 'error' });
    } finally {
      setLoadingLabel(false);
    }
  };

  const handlePrintBarcodeLabel = async () => {
    const productsToPrint = (labelProducts.length ? labelProducts : labelProduct ? [labelProduct] : [])
      .filter((product) => String(product?.barcode || product?.quick_code || '').trim());

    if (!productsToPrint.length) return;

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      showNotification({ message: 'Please allow pop-ups to print the barcode label.', type: 'warning' });
      return;
    }

    const copies = Math.min(48, Math.max(1, Number(labelCopies) || 1));
    const isSheetMode = labelPrintMode === 'sheet';
    const sheetPreset = sheetPresetConfig[labelSheetPreset];

    try {
      const renderedProducts = await Promise.all(
        productsToPrint.map(async (product) => ({
          product,
          svg: await renderBarcodeLabelSvg(String(product?.barcode || product?.quick_code || '').trim()),
        }))
      );

      const labelMarkupFor = (product: any, svgMarkup: string) => {
        const displayPrice = getComparablePrice(product);
        const productName = escapeHtml(product.name || 'Unnamed Product');
        const categoryName = escapeHtml(product.category || 'General');
        const storeName = escapeHtml(store?.name || 'Goody POS');
        const barcodeValue = escapeHtml(product.barcode || product.quick_code || '');
        const quickCode = escapeHtml(product.quick_code || '—');
        const priceText = escapeHtml(formatCurrency(displayPrice));

        return `
          <div class="label-card">
            <div class="store">${storeName}</div>
            <div class="name">${productName}</div>
            <div class="meta">${categoryName}</div>
            <div class="barcode">${svgMarkup}</div>
            <div class="footer">
              <span>SKU: ${quickCode}</span>
              <span>${priceText}</span>
            </div>
            <div class="meta" style="margin-top:6px;">${barcodeValue}</div>
          </div>
        `;
      };

      const repeatedLabels = renderedProducts.flatMap(({ product, svg }) => (
        Array.from({ length: copies }, (_, index) => {
          const labelMarkup = labelMarkupFor(product, svg);
          if (isSheetMode) {
            return `<div class="sheet-cell" data-product-id="${product.id}" data-copy="${index + 1}">${labelMarkup}</div>`;
          }
          return `<section class="single-page" data-product-id="${product.id}" data-copy="${index + 1}">${labelMarkup}</section>`;
        })
      )).join('');

      const titleName = escapeHtml(labelProduct?.name || 'Barcode');
      printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${titleName} Barcode Labels</title>
    <style>
      @page { size: ${isSheetMode ? 'A4 portrait' : '62mm 40mm'}; margin: ${isSheetMode ? '8mm' : '4mm'}; }
      body {
        margin: 0;
        font-family: Inter, Arial, sans-serif;
        background: ${isSheetMode ? '#ffffff' : '#f8fafc'};
        color: #0f172a;
      }
      .sheet-grid {
        display: grid;
        grid-template-columns: repeat(${sheetPreset.columns}, ${sheetPreset.width});
        gap: ${sheetPreset.gap};
        justify-content: center;
        align-content: start;
      }
      .sheet-cell {
        width: ${sheetPreset.width};
        min-height: ${sheetPreset.minHeight};
        page-break-inside: avoid;
      }
      .single-page {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px;
        box-sizing: border-box;
      }
      .single-page:not(:last-child) {
        page-break-after: always;
      }
      .label-card {
        width: 100%;
        box-sizing: border-box;
        background: #ffffff;
        border: 1px solid #cbd5e1;
        border-radius: 12px;
        padding: 10px 12px;
      }
      .store {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: #64748b;
        text-align: center;
      }
      .name {
        margin-top: 6px;
        font-size: 14px;
        font-weight: 800;
        text-align: center;
      }
      .meta {
        margin-top: 2px;
        font-size: 10px;
        color: #64748b;
        text-align: center;
      }
      .barcode {
        margin-top: 8px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 6px;
        background: #fff;
        overflow: hidden;
      }
      .footer {
        margin-top: 8px;
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font-size: 10px;
        color: #334155;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    ${isSheetMode ? `<div class="sheet-grid">${repeatedLabels}</div>` : repeatedLabels}
  </body>
</html>`);
      printWindow.document.close();
      printWindow.focus();
      window.setTimeout(() => {
        printWindow.print();
      }, 250);
    } catch (err: any) {
      printWindow.close();
      showNotification({ message: String(err?.message || err || 'Failed to print barcode labels'), type: 'error' });
    }
  };

  const handleDelete = async (id: number) => {
    if (!canDeleteProducts) {
      showNotification({ message: 'Only store admins can delete inventory products.', type: 'error' });
      return;
    }
    try {
      await appFetch(`/api/products/${id}`, { method: 'DELETE' });
      loadData();
      showNotification({ message: 'Product deleted successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const handleExportProducts = async () => {
    try {
      const query = new URLSearchParams({ sort: sortBy });
      if (deferredSearch) {
        query.set('search', deferredSearch);
      }
      if (selectedCategory !== 'all') {
        query.set('category', selectedCategory);
      }
      if (selectedStockStatus !== 'all') {
        query.set('stock_status', selectedStockStatus);
      }

      const data = await appFetch(`/api/products?${query.toString()}`);
      const exportProducts = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      
      // Filter out invalid products (those without names or invalid entries)
      const validProducts = exportProducts.filter((p) => p.name && String(p.name).trim().length > 0);
      
      // Check if any product has condition variants with data
      const hasVariants = validProducts.some((p) => p.condition_matrix && Object.keys(p.condition_matrix).length > 0);
      
      const rows = validProducts.map((product) => {
        const row: any = {
          product_name: product.name,
          barcode: product.barcode || '',
          category: product.category || '',
          price: product.price ?? 0,
          stock: product.stock ?? 0,
          cost: product.cost ?? 0,
        };
        
        // Only include variant columns if data has variants
        if (hasVariants && product.condition_matrix) {
          const cm = product.condition_matrix;
          if (cm.new) {
            row.new_price = cm.new.price ?? 0;
            row.new_stock = cm.new.stock ?? 0;
            row.new_cost = cm.new.cost ?? null;
          }
          if (cm.open_box) {
            row.open_box_price = cm.open_box.price ?? 0;
            row.open_box_stock = cm.open_box.stock ?? 0;
            row.open_box_cost = cm.open_box.cost ?? null;
          }
          if (cm.used) {
            row.used_price = cm.used.price ?? 0;
            row.used_stock = cm.used.stock ?? 0;
            row.used_cost = cm.used.cost ?? null;
          }
        }
        
        return row;
      });

      downloadCsv(`products-${getLocalDateValue()}.csv`, rows);
      showNotification({ message: `Exported ${rows.length} products`, type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to export products'), type: 'error' });
    }
  };

  const handleExportReorderList = async () => {
    try {
      const query = new URLSearchParams({ sort: sortBy });
      if (deferredSearch) {
        query.set('search', deferredSearch);
      }
      if (selectedCategory !== 'all') {
        query.set('category', selectedCategory);
      }

      const data = await appFetch(`/api/products?${query.toString()}`);
      const exportProducts = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      
      // Filter out invalid products and get only low-stock items
      const validProducts = exportProducts.filter((p) => p.name && String(p.name).trim().length > 0);
      const reorderProducts = validProducts.filter((product) => getAvailableUnits(product) < 5);

      if (!reorderProducts.length) {
        showNotification({ message: 'No low-stock or out-of-stock items match your current filters.', type: 'warning' });
        return;
      }

      const rows = reorderProducts.map((product) => ({
        product_name: product.name,
        barcode: product.barcode || '',
        category: product.category || '',
        available_units: getAvailableUnits(product),
        on_hold_quantity: Number(product.on_collection_quantity || 0),
        status: getStockHealth(product) === 'out' ? 'OUT OF STOCK' : 'LOW STOCK',
        cost_per_unit: product.cost || 0,
        selling_price: product.price || 0,
      }));

      downloadCsv(`reorder-list-${getLocalDateValue()}.csv`, rows);
      showNotification({ message: `Exported ${rows.length} reorder item(s)`, type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to export reorder list'), type: 'error' });
    }
  };

  const handleImportProducts = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!canImportProducts) {
      showNotification({ message: 'Staff accounts cannot import or modify inventory.', type: 'error' });
      e.target.value = '';
      return;
    }

    try {
      const text = await file.text();
      const rows = normalizeImportedProductRows(parseCsv(text));
      if (!rows.length) {
        showNotification({ message: 'No product rows were found in the selected CSV file.', type: 'warning' });
        return;
      }

      const result = await appFetch('/api/import/products', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });

      await loadData();
      const importedCount = Number(result?.importedCount || 0);
      showNotification({
        message: importedCount > 0
          ? `Imported ${importedCount} products successfully`
          : 'No products were imported. Check that the CSV has valid product names.',
        type: importedCount > 0 ? 'success' : 'warning',
      });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to import products'), type: 'error' });
    } finally {
      e.target.value = '';
    }
  };

  const applyThumbnailUrl = () => {
    const trimmedUrl = thumbnailUrl.trim();
    if (!trimmedUrl) {
      showNotification({ message: 'Please enter an image URL first.', type: 'warning' });
      return;
    }

    setFormData((prev: any) => ({ ...prev, thumbnail: trimmedUrl }));
    showNotification({ message: 'Image URL applied successfully.', type: 'success' });
  };

  const processImageFile = (file?: File) => {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showNotification({ message: 'Please choose a valid image file.', type: 'error' });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showNotification({ message: 'File is too large. Please select an image under 5MB.', type: 'error' });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDimension = 1200;
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          showNotification({ message: 'Unable to process this image. Try another one.', type: 'error' });
          return;
        }

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        const optimizedImage = canvas.toDataURL(mimeType, 0.86);

        setThumbnailUrl('');
        setFormData((prev: any) => ({ ...prev, thumbnail: optimizedImage }));
        showNotification({ message: 'Product image uploaded successfully.', type: 'success' });
      };

      img.onerror = () => {
        showNotification({ message: 'Failed to load the selected image.', type: 'error' });
      };

      img.src = String(reader.result || '');
    };

    reader.onerror = () => {
      showNotification({ message: 'Failed to read the selected file.', type: 'error' });
    };

    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    processImageFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const getComparablePrice = (product: any) => {
    if (store?.mode === 'GADGET' && product.condition_matrix) {
      const prices = Object.values(product.condition_matrix || {})
        .map((entry: any) => Number(entry?.price) || 0)
        .filter((value: number) => value > 0);

      if (prices.length > 0) {
        return Math.min(...prices);
      }
    }

    return Number(product.price) || 0;
  };

  const getProfitMargin = (sellingPrice: unknown, costPrice: unknown) => {
    return Number((Number(sellingPrice || 0) - Number(costPrice || 0)).toFixed(2));
  };

  const getAvailableUnits = (product: any) => {
    if (store?.mode === 'GADGET' && product?.condition_matrix) {
      const conditionStocks = Object.values(product.condition_matrix || {}).map((entry: any) => Number(entry?.stock) || 0);
      if (conditionStocks.length > 0) {
        return conditionStocks.reduce((sum, value) => sum + value, 0);
      }
    }

    return Number(product?.stock) || 0;
  };

  const getStockHealth = (product: any): 'out' | 'low' | 'healthy' => {
    const units = getAvailableUnits(product);
    if (units <= 0) return 'out';
    if (units < 5) return 'low';
    return 'healthy';
  };

  const duplicateBarcodeCountMap = useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((product) => {
      const barcode = String(product?.barcode || '').trim();
      if (!barcode) return;
      counts.set(barcode, (counts.get(barcode) || 0) + 1);
    });
    return counts;
  }, [products]);

  const getDataHealthFlags = (product: any) => {
    const flags: Array<{ key: string; label: string; tone: string }> = [];
    const barcode = String(product?.barcode || '').trim();
    const availableUnits = getAvailableUnits(product);

    if (barcode && (duplicateBarcodeCountMap.get(barcode) || 0) > 1) {
      flags.push({ key: 'duplicate-barcode', label: 'Duplicate barcode', tone: 'bg-amber-100 text-amber-400' });
    }

    if (availableUnits > 0) {
      const hasZeroPrice = store?.mode === 'GADGET'
        ? Object.values(product?.condition_matrix || {}).every((entry: any) => Number(entry?.price || 0) <= 0)
        : Number(product?.price || 0) <= 0;

      if (hasZeroPrice) {
        flags.push({ key: 'zero-price-stock', label: 'Stock with zero price', tone: 'bg-rose-100 text-rose-400' });
      }
    }

    if (canViewCostFields) {
      const missingCost = store?.mode === 'GADGET'
        ? Object.values(product?.condition_matrix || {}).some((entry: any) => {
            const stock = Number(entry?.stock || 0);
            const price = Number(entry?.price || 0);
            const cost = Number(entry?.cost ?? 0);
            return (stock > 0 || price > 0) && cost <= 0;
          })
        : (availableUnits > 0 || Number(product?.price || 0) > 0) && Number(product?.cost ?? 0) <= 0;

      if (missingCost) {
        flags.push({ key: 'missing-cost', label: 'Missing cost', tone: 'bg-orange-100 text-orange-700' });
      }
    }

    return flags;
  };

  const formatAddedDate = (value?: string) => {
    if (!value) return 'Recently';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'Recently';
    return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getConditionSnapshot = (product: any) => {
    const matrix = product?.condition_matrix && typeof product.condition_matrix === 'object'
      ? product.condition_matrix
      : {};

    return ['new', 'open_box', 'used'].map((key) => ({
      key,
      label: key.replace('_', ' '),
      price: Number(matrix?.[key]?.price || 0) || 0,
      stock: Number(matrix?.[key]?.stock || 0) || 0,
      cost: Number(matrix?.[key]?.cost ?? product?.cost ?? 0) || 0,
    }));
  };

  const hasConditionData = (entry: { price: number; stock: number; cost: number }, product?: any) => {
    const fallbackCost = Number(product?.cost ?? 0) || 0;
    return entry.price > 0 || entry.stock > 0 || (entry.cost > 0 && entry.cost !== fallbackCost);
  };

  const getPrimaryConditionEntry = (product: any) => {
    const entries = getConditionSnapshot(product).filter((entry) => hasConditionData(entry, product));
    return entries[0] || null;
  };

  const getProductSpecsEntries = (product: any) => (
    Object.entries(product?.specs || {}).filter(([, value]) => String(value ?? '').trim().length > 0)
  );

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  useEffect(() => {
    if (!loading) {
      void loadProductsPage(inventoryPage, deferredSearch, selectedCategory, selectedStockStatus, sortBy);
    }
  }, [inventoryPage, deferredSearch, selectedCategory, selectedStockStatus, sortBy, loading]);

  const selectedDateLabel = useMemo(() => new Date(`${selectedDate}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }), [selectedDate]);

  const filteredProducts = useMemo(() => {
    const sorted = [...products].sort((a, b) => {
      const categoryCompare = String(a.category || 'General').localeCompare(String(b.category || 'General'));

      if (sortBy === 'price-low') {
        return getComparablePrice(a) - getComparablePrice(b);
      }
      if (sortBy === 'price-high') {
        return getComparablePrice(b) - getComparablePrice(a);
      }
      if (sortBy === 'category-az') {
        return categoryCompare || a.name.localeCompare(b.name);
      }
      if (sortBy === 'category-za') {
        return (-categoryCompare) || a.name.localeCompare(b.name);
      }

      const recentDiff = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      return recentDiff !== 0 ? recentDiff : Number(b.id || 0) - Number(a.id || 0);
    });

    if (selectedStockStatus === 'low') {
      return sorted.filter((product) => {
        const units = getAvailableUnits(product);
        return units > 0 && units < 5;
      });
    }

    if (selectedStockStatus === 'out') {
      return sorted.filter((product) => getAvailableUnits(product) <= 0);
    }

    if (selectedStockStatus === 'healthy') {
      return sorted.filter((product) => getAvailableUnits(product) >= 5);
    }

    return sorted;
  }, [products, selectedStockStatus, sortBy, store?.mode]);

  const inventoryStatusSummary = useMemo(() => filteredProducts.reduce((summary, product) => {
    const health = getStockHealth(product);
    if (health === 'out') summary.out += 1;
    else if (health === 'low') summary.low += 1;
    else summary.healthy += 1;
    return summary;
  }, { low: 0, out: 0, healthy: 0 }), [filteredProducts]);

  const paginatedProducts = useMemo(() => filteredProducts, [filteredProducts]);

  const inventoryTotalPages = Math.max(1, Math.ceil(productTotal / INVENTORY_PAGE_SIZE));
  const inventoryPageStart = productTotal === 0 ? 0 : ((inventoryPage - 1) * INVENTORY_PAGE_SIZE) + 1;
  const inventoryPageEnd = productTotal === 0 ? 0 : Math.min(inventoryPage * INVENTORY_PAGE_SIZE, productTotal);

  useEffect(() => {
    if (inventoryPage > inventoryTotalPages) {
      setInventoryPage(inventoryTotalPages);
    }
  }, [inventoryPage, inventoryTotalPages]);

  const selectedProducts = useMemo(
    () => products.filter((product) => selectedProductIds.includes(Number(product.id))),
    [products, selectedProductIds]
  );

  const overviewConditionCards = overviewProduct ? getConditionSnapshot(overviewProduct) : [];
  const populatedOverviewConditionCards = overviewProduct
    ? overviewConditionCards.filter((entry) => hasConditionData(entry, overviewProduct))
    : [];
  const primaryOverviewCondition = populatedOverviewConditionCards[0] || null;
  const overviewConditionLabel = primaryOverviewCondition
    ? primaryOverviewCondition.label.replace(/\b\w/g, (char) => char.toUpperCase())
    : '';
  const overviewSpecs = overviewProduct ? getProductSpecsEntries(overviewProduct) : [];
  const overviewSellingPrice = primaryOverviewCondition?.price ?? (overviewProduct ? getComparablePrice(overviewProduct) : 0);
  const overviewCostPrice = primaryOverviewCondition?.cost ?? (overviewProduct ? Number(overviewProduct?.cost || 0) : 0);
  const overviewProfit = overviewSellingPrice - overviewCostPrice;
  const overviewMarkup = overviewCostPrice > 0 ? (overviewProfit / overviewCostPrice) * 100 : 0;
  const overviewAvailableUnits = primaryOverviewCondition?.stock ?? (overviewProduct ? getAvailableUnits(overviewProduct) : 0);
  const overviewOnCollection = overviewProduct ? Number(overviewProduct?.on_collection_quantity || 0) : 0;
  const overviewHealth = overviewProduct ? getStockHealth(overviewProduct) : 'healthy';

  const allFilteredSelected = paginatedProducts.length > 0
    && paginatedProducts.every((product) => selectedProductIds.includes(Number(product.id)));
  const hasActiveInventoryFilters = Boolean(search.trim()) || selectedCategory !== 'all' || selectedStockStatus !== 'all' || sortBy !== 'recent';

  const resetInventoryFilters = () => {
    setSearch('');
    setSelectedCategory('all');
    setSelectedStockStatus('all');
    setSortBy('recent');
    setInventoryPage(1);
  };

  const toggleProductSelection = (productId: number) => {
    setSelectedProductIds((prev) => (
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    ));
  };

  const toggleSelectAllFiltered = () => {
    const visibleIds = paginatedProducts.map((product) => Number(product.id));

    setSelectedProductIds((prev) => {
      const alreadySelected = visibleIds.every((id) => prev.includes(id));
      if (alreadySelected) {
        return prev.filter((id) => !visibleIds.includes(id));
      }

      return Array.from(new Set([...prev, ...visibleIds]));
    });
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      {/* ── HERO HEADER ── */}
      <header className="relative rounded-[28px] bg-[radial-gradient(ellipse_at_top_left,#312e81_0%,#1e1b4b_40%,#0f172a_100%)] px-6 py-7 text-white shadow-[0_30px_80px_-30px_rgba(49,46,129,0.7)] sm:px-8">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-violet-500/20 blur-[70px]" />
          <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-indigo-400/15 blur-[60px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />
        </div>

        <div className="relative z-20 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-[#a5b4fc]">Stock Control</p>
            <h1 className="text-3xl font-black text-white sm:text-4xl" style={{ fontFamily: 'var(--font-display)' }}>Inventory</h1>
            <p className="mt-1 text-sm text-[#94a3b8]">Manage products, stock levels, and pricing</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input ref={importProductsRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportProducts} />

              {/* Home */}
            <Link to="/" className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20">
              <Home size={15} /> Home
            </Link>

            {/* Print Selected */}
            <button
              onClick={handleOpenBulkBarcodeLabels}
              disabled={selectedProductIds.length === 0}
              className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-40"
            >
              <Printer size={15} /> {selectedProductIds.length > 0 ? `Print (${selectedProductIds.length})` : 'Print'}
            </button>

            {/* More Actions dropdown */}
            <div className="relative" ref={moreActionsRef}>
              <button
                type="button"
                onClick={() => setShowMoreActions((v) => !v)}
                className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20"
              >
                <MoreHorizontal size={16} /> More <ChevronDown size={14} className={`transition-transform ${showMoreActions ? 'rotate-180' : ''}`} />
              </button>
              {showMoreActions && (
                <div className="absolute left-0 top-full z-[200] mt-2 w-52 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <button onClick={() => { handleExportProducts(); setShowMoreActions(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-50">
                    <Download size={15} className="text-slate-400" /> Export CSV
                  </button>
                  {canImportProducts && (
                    <button onClick={() => { importProductsRef.current?.click(); setShowMoreActions(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-50">
                      <Upload size={15} className="text-slate-400" /> Import CSV
                    </button>
                  )}
                  <button onClick={() => { handleExportReorderList(); setShowMoreActions(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-amber-400 hover:bg-amber-900/20">
                    <AlertCircle size={15} className="text-amber-400" /> Reorder List
                  </button>
                  {canAdjustStock && (
                    <Link to="/stock-adjustments" onClick={() => setShowMoreActions(false)} className="flex items-center gap-3 px-4 py-3 text-sm font-bold text-slate-300 hover:bg-slate-50">
                      <Settings2 size={15} className="text-slate-400" /> Adjustment Log
                    </Link>
                  )}
                  {user?.role === 'SYSTEM_ADMIN' && (
                    <button onClick={() => { setShowRecycleBin(true); loadDeletedProducts(); setShowMoreActions(false); }} className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-rose-600 hover:bg-rose-900/20">
                      <Trash2 size={15} className="text-rose-400" /> Recycle Bin
                    </button>
                  )}
                </div>
              )}
            </div>

            {canAdjustStock && (
              <button
                onClick={() => openStockAdjustmentModal()}
                className="flex items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/20 px-4 py-2.5 text-sm font-bold text-sky-200 backdrop-blur transition hover:bg-sky-500/30"
              >
                <Settings2 size={15} /> Quick Adjust
              </button>
            )}
            {canCreateProducts && (
              <button
                onClick={() => { resetForm(); setEditingProduct(null); setShowModal(true); }}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
              >
                <Plus size={16} /> Add Product
              </button>
            )}
          </div>
        </div>

        {/* KPI strip */}
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4" style={{ isolation: 'auto' }}>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#a5b4fc]">Total Products</p>
            <p className="mt-1 text-2xl font-black text-white">{productTotal.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#34d399]">Added Today</p>
            <p className="mt-1 text-2xl font-black text-white">{dailySummary?.addedToday || 0}</p>
          </div>
          <div className="rounded-2xl border border-amber-400/30 bg-amber-900/200/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#fbbf24]">Low Stock</p>
            <p className="mt-1 text-2xl font-black text-white">{inventoryStatusSummary.low}</p>
          </div>
          <div className="rounded-2xl border border-rose-400/30 bg-rose-900/200/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#fb7185]">Out of Stock</p>
            <p className="mt-1 text-2xl font-black text-white">{inventoryStatusSummary.out}</p>
          </div>
        </div>
      </header>

      {(user?.role === 'STAFF' || user?.role === 'ACCOUNTANT' || user?.role === 'PROCUREMENT_OFFICER') && (
        <div className="rounded-2xl border border-amber-200 bg-amber-900/20 px-4 py-3 text-sm font-semibold text-amber-300 shadow-sm">
          {user?.role === 'ACCOUNTANT'
            ? <>Accountant access is <span className="font-black">view-only</span> for inventory, with cost and net profit visible for reconciliation.</>
            : user?.role === 'PROCUREMENT_OFFICER'
              ? <>Procurement access can <span className="font-black">manage inventory, restocks, and stock recounts</span>, but cannot delete products or change sensitive store settings.</>
              : <>Staff can submit <span className="font-black">new product requests only</span>; editing existing products is restricted.</>}
        </div>
      )}

      {isStaff && (
        <section className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black uppercase tracking-widest text-sky-700">Your Pending Submissions</h2>
              <p className="text-xs text-sky-600">Products you've added that are waiting for manager or store owner approval.</p>
            </div>
            <button
              type="button"
              onClick={() => { void loadStaffPendingSubmissions(); }}
              className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100"
            >
              Refresh
            </button>
          </div>

          {staffPendingSubmissionsLoading ? (
            <div className="flex items-center gap-2 text-sm text-sky-700"><Loader2 size={14} className="animate-spin" /> Loading...</div>
          ) : staffPendingSubmissions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-sky-200 bg-white px-3 py-4 text-sm text-sky-700">No pending submissions.</div>
          ) : (
            <>
              <div className="space-y-1 mb-3">
                {(() => {
                  const startIdx = (staffSubmissionsPage - 1) * STAFF_SUBMISSIONS_PAGE_SIZE;
                  const endIdx = startIdx + STAFF_SUBMISSIONS_PAGE_SIZE;
                  const paginatedSubmissions = staffPendingSubmissions.slice(startIdx, endIdx);

	                  return paginatedSubmissions.map((request) => {
	                    const payload = request?.payload || {};
	                    const isCreate = String(request.request_type || '').toUpperCase() === 'CREATE';
	                    const primaryCondition = getPrimaryConditionEntry(payload);
                
                    return (
                  <div key={request.id} className="rounded-lg border border-sky-200 bg-white px-3 py-2 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {isCreate ? '➕' : '✏️'} {String(payload?.name || 'Unnamed')}
                        </p>
                        <p className="text-xs text-slate-600">
                          {String(payload?.category || 'No category')} {payload?.barcode ? `• ${payload.barcode}` : ''}
                        </p>
                      </div>
                      <div className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-900/20 px-2 py-1 shrink-0">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-400">Waiting</span>
                      </div>
                    </div>

	                    {primaryCondition && store?.mode === 'GADGET' && (
	                      <div className="mb-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs">
	                        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700">
	                          Condition
	                          <span className="rounded-full bg-white px-2 py-0.5 text-sky-900">{formatConditionLabel(primaryCondition.label)}</span>
	                        </div>
	                        <div className="mt-2 flex flex-wrap gap-3 text-slate-600">
	                          <p><span className="font-bold">Price:</span> {formatCurrency(Number(primaryCondition.price || 0))}</p>
	                          <p><span className="font-bold">Stock:</span> {Number(primaryCondition.stock || 0)} units</p>
	                        </div>
	                      </div>
	                    )}

                    {payload?.specs && Object.keys(payload.specs).length > 0 && (
                      <div className="rounded border border-slate-200 bg-slate-50 p-2 mb-1 text-[10px]">
                        <p className="font-bold uppercase text-slate-600 mb-1">Specs</p>
                        <div className="space-y-0.5">
                          {Object.entries(payload.specs).slice(0, 3).map(([key, value]: [string, any]) => (
                            <p key={key} className="text-slate-300">
                              <span className="font-bold">{String(key).replace(/_/g, ' ')}:</span> {String(value)}
                            </p>
                          ))}
                          {Object.keys(payload.specs).length > 3 && (
                            <p className="text-slate-500 italic">+{Object.keys(payload.specs).length - 3} more</p>
                          )}
                        </div>
                      </div>
                    )}

                    <p className="text-[9px] text-slate-500">
                      {new Date(request.created_at).toLocaleDateString()} {new Date(request.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  );
                });
                })()}
              </div>
              
              {Math.ceil(staffPendingSubmissions.length / STAFF_SUBMISSIONS_PAGE_SIZE) > 1 && (
                <div className="flex items-center justify-between gap-2 border-t border-sky-200 pt-3">
                  <p className="text-xs text-sky-600">
                    Page {staffSubmissionsPage} of {Math.ceil(staffPendingSubmissions.length / STAFF_SUBMISSIONS_PAGE_SIZE)}
                  </p>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setStaffSubmissionsPage(prev => Math.max(1, prev - 1))}
                      disabled={staffSubmissionsPage === 1}
                      className="rounded border border-sky-200 bg-white px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setStaffSubmissionsPage(prev => Math.min(Math.ceil(staffPendingSubmissions.length / STAFF_SUBMISSIONS_PAGE_SIZE), prev + 1))}
                      disabled={staffSubmissionsPage === Math.ceil(staffPendingSubmissions.length / STAFF_SUBMISSIONS_PAGE_SIZE)}
                      className="rounded border border-sky-200 bg-white px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {canApproveProductRequests && pendingProductRequests.length > 0 && (
        <section className="rounded-2xl border border-indigo-700/30 bg-indigo-900/20/60 p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-600 text-white">
                <AlertCircle size={15} />
              </div>
              <div>
                <h2 className="text-sm font-black text-indigo-300">Product Change Approvals</h2>
                <p className="text-xs text-indigo-600">{pendingProductRequests.length} pending request{pendingProductRequests.length !== 1 ? 's' : ''} from staff</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { void loadPendingProductRequests(); }}
              className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-400 hover:bg-indigo-100"
            >
              Refresh
            </button>
          </div>

          {pendingProductRequestsLoading ? (
            <div className="flex items-center gap-2 text-sm text-indigo-400"><Loader2 size={14} className="animate-spin" /> Loading requests...</div>
          ) : (
            <div className="space-y-2">
              {pendingProductRequests.map((request) => {
                const payload = request?.payload || {};
                const derived = deriveRequestDisplayValues(payload);
                const isActing = requestActionId === Number(request.id);
                const isEditingThisRequest = editingRequestId === Number(request.id);
                const requestDraft = requestEditDrafts[Number(request.id)] || null;
                return (
                  <div key={request.id} className="rounded-xl border border-indigo-200 bg-white px-3 py-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-bold text-slate-900">
                          {String(request.request_type || '').toUpperCase() === 'CREATE' ? 'Add Product' : 'Edit Product'}: {String(payload?.name || 'Unnamed Product')}
                        </p>
                        <p className="text-xs text-slate-600">
                          Requested by {request.requested_by_username || 'Unknown user'} • Price {formatCurrency(derived.price)} • Stock {derived.stock}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isActing}
                          onClick={() => beginProductRequestEdit(request)}
                          className="rounded-lg border border-indigo-200 bg-indigo-900/20 px-2.5 py-1.5 text-xs font-bold text-indigo-400 hover:bg-indigo-100 disabled:opacity-50"
                        >
                          Edit & Approve
                        </button>
                        <button
                          type="button"
                          disabled={isActing}
                          onClick={() => { void handleProductRequestDecision(Number(request.id), 'reject'); }}
                          className="rounded-lg border border-rose-200 bg-rose-900/20 px-2.5 py-1.5 text-xs font-bold text-rose-400 hover:bg-rose-100 disabled:opacity-50"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          disabled={isActing}
                          onClick={() => { void handleProductRequestDecision(Number(request.id), 'approve'); }}
                          className="rounded-lg border border-emerald-200 bg-emerald-900/20 px-2.5 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          {isActing ? 'Processing...' : 'Approve'}
                        </button>
                      </div>
                    </div>

                    {isEditingThisRequest && requestDraft && (
                      <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-900/20 p-3">
                        <p className="mb-2 text-xs font-black uppercase tracking-widest text-indigo-400">Edit Before Approval</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            type="text"
                            value={requestDraft.name}
                            onChange={(e) => setRequestEditDrafts((prev) => ({
                              ...prev,
                              [Number(request.id)]: { ...requestDraft, name: e.target.value },
                            }))}
                            placeholder="Product name"
                            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          <input
                            type="text"
                            value={requestDraft.category}
                            onChange={(e) => setRequestEditDrafts((prev) => ({
                              ...prev,
                              [Number(request.id)]: { ...requestDraft, category: e.target.value },
                            }))}
                            placeholder="Category"
                            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          <input
                            type="text"
                            value={requestDraft.barcode}
                            onChange={(e) => setRequestEditDrafts((prev) => ({
                              ...prev,
                              [Number(request.id)]: { ...requestDraft, barcode: e.target.value },
                            }))}
                            placeholder="Barcode"
                            className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-400"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={requestDraft.price}
                              onChange={(e) => setRequestEditDrafts((prev) => ({
                                ...prev,
                                [Number(request.id)]: { ...requestDraft, price: e.target.value },
                              }))}
                              placeholder="Price"
                              className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={requestDraft.stock}
                              onChange={(e) => setRequestEditDrafts((prev) => ({
                                ...prev,
                                [Number(request.id)]: { ...requestDraft, stock: e.target.value },
                              }))}
                              placeholder="Stock"
                              className="rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                          </div>
                        </div>

                        <div className="mt-2 flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={() => setEditingRequestId(null)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isActing}
                            onClick={() => {
                              const editedPayload = {
                                ...payload,
                                name: String(requestDraft.name || '').trim() || String(payload?.name || '').trim(),
                                category: String(requestDraft.category || '').trim() || null,
                                barcode: String(requestDraft.barcode || '').trim() || null,
                                price: Math.max(0, Number(requestDraft.price || 0) || 0),
                                stock: Math.max(0, Math.trunc(Number(requestDraft.stock || 0) || 0)),
                              };
                              void handleProductRequestDecision(Number(request.id), 'approve', editedPayload);
                            }}
                            className="rounded-lg border border-emerald-200 bg-emerald-900/20 px-2.5 py-1.5 text-xs font-bold text-emerald-400 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            {isActing ? 'Processing...' : 'Approve Edited'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── ACTIVITY STRIP ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_2fr]">
        <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-900/20 text-emerald-600"><TrendingUp size={17} /></div>
            <div>
              <p className="text-xs font-black text-slate-500 uppercase tracking-[0.18em]">Units Added</p>
              <p className="text-[11px] text-slate-400">{selectedDateLabel}</p>
            </div>
          </div>
          <p className="text-4xl font-black text-slate-900">{dailySummary?.addedToday || 0}</p>
          <p className="mt-1 text-xs text-slate-400">Opening stock recorded on selected day</p>
        </div>

        <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600"><ShoppingCart size={17} /></div>
            <div>
              <p className="text-xs font-black text-slate-500 uppercase tracking-[0.18em]">Units Sold</p>
              <p className="text-[11px] text-slate-400">{selectedDateLabel}</p>
            </div>
          </div>
          <p className="text-4xl font-black text-slate-900">{dailySummary?.soldToday || 0}</p>
          <p className="mt-1 text-xs text-slate-400">Completed sales quantity on selected day</p>
        </div>

        <div className="rounded-[24px] border border-slate-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Activity Trend</p>
              <p className="text-[11px] text-slate-400">Added vs sold around selected date</p>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-300 outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </label>
          </div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {(dailySummary?.trend || []).map((entry: any) => (
              <div key={entry.date} className={`rounded-xl px-2 py-2 text-center transition ${entry.date === selectedDate ? 'bg-slate-900 text-white shadow-md' : 'bg-slate-50 border border-slate-100'}`}>
                <p className={`mb-1 text-[10px] font-black uppercase tracking-wide ${entry.date === selectedDate ? 'text-slate-300' : 'text-slate-400'}`}>{entry.label}</p>
                <p className={`text-xs font-black ${entry.date === selectedDate ? 'text-emerald-300' : 'text-emerald-600'}`}>+{entry.added}</p>
                <p className={`text-xs font-black ${entry.date === selectedDate ? 'text-rose-300' : 'text-rose-500'}`}>-{entry.sold}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FILTER BAR ── */}
      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search by name, barcode, or quick code…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search.trim() && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-300">
                <X size={15} />
              </button>
            )}
          </div>

          {/* Selects row */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-300 outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <select value={selectedStockStatus} onChange={(e) => setSelectedStockStatus(e.target.value as 'all' | 'low' | 'out' | 'healthy')} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-300 outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="all">All stock levels</option>
              <option value="low">Low stock (&lt; 5)</option>
              <option value="out">Out of stock</option>
              <option value="healthy">Healthy stock</option>
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'recent' | 'price-low' | 'price-high' | 'category-az' | 'category-za')} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-300 outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="recent">Recently added</option>
              <option value="price-low">Price: Low → High</option>
              <option value="price-high">Price: High → Low</option>
              <option value="category-az">Category: A → Z</option>
              <option value="category-za">Category: Z → A</option>
            </select>
            {hasActiveInventoryFilters && (
              <button type="button" onClick={resetInventoryFilters} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50">
                <RotateCcw size={14} /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Status strip */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            Showing {inventoryPageStart}–{inventoryPageEnd} of {productTotal}
          </span>
          {inventoryStatusSummary.low > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-400">
              ⚠ Low {inventoryStatusSummary.low}
            </span>
          )}
          {inventoryStatusSummary.out > 0 && (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-400">
              ✕ Out {inventoryStatusSummary.out}
            </span>
          )}
          {selectedProductIds.length > 0 && (
            <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-black text-indigo-400">
              ✓ {selectedProductIds.length} selected
            </span>
          )}
          {productsLoading && (
            <span className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-600">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </span>
          )}
        </div>
      </div>

      {canEditProducts && (
        <div className="flex items-center gap-3 rounded-2xl border border-indigo-700/30 bg-indigo-900/20 px-4 py-3 text-sm text-indigo-400 shadow-sm">
          <span className="shrink-0 rounded-lg bg-indigo-100 p-1.5 text-indigo-500"><Edit2 size={13} /></span>
          <span><strong className="font-black">Tip:</strong> Double-click or double-tap any product name, category, price, or stock cell to edit that column instantly.</span>
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-bold text-slate-500">Page <span className="text-slate-900">{inventoryPage}</span> of <span className="text-slate-900">{inventoryTotalPages}</span></p>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setInventoryPage(1)} disabled={inventoryPage === 1} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">First</button>
          <button type="button" onClick={() => setInventoryPage((prev) => Math.max(1, prev - 1))} disabled={inventoryPage === 1} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Prev</button>
          <button type="button" onClick={() => setInventoryPage((prev) => Math.min(inventoryTotalPages, prev + 1))} disabled={inventoryPage >= inventoryTotalPages} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40">Next</button>
        </div>
      </div>

	      <div className="space-y-3 lg:hidden">
        {paginatedProducts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <Package size={22} />
            </div>
            <p className="mt-4 text-base font-bold text-slate-900">No products match this view</p>
            <p className="mt-1 text-sm text-slate-500">Try clearing the search or resetting the filters to see more items.</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {hasActiveInventoryFilters && (
                <button
                  type="button"
                  onClick={resetInventoryFilters}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                  Reset Filters
                </button>
              )}
              {canCreateProducts && (
                <button
                  type="button"
                  onClick={() => { resetForm(); setEditingProduct(null); setShowModal(true); }}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                >
                  Add Product
                </button>
              )}
            </div>
          </div>
        ) : paginatedProducts.map((p) => (
          <article key={p.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 product-card-hover">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label={`Select ${p.name}`}
                checked={selectedProductIds.includes(Number(p.id))}
                onChange={() => toggleProductSelection(Number(p.id))}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                {p.thumbnail ? (
                  <img
                    src={p.thumbnail}
                    alt={p.name}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <Package className="h-full w-full p-2 text-slate-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-bold text-slate-900">{p.name}</p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                    {p.category || 'General'}
                  </span>
                  {Number(p.on_collection_quantity || 0) > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-400">
                      On Loan / Collection
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs font-mono text-slate-400">{p.barcode || 'No Barcode'}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono font-bold text-slate-300">
                    Quick: {p.quick_code || '-----'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600">
                    Added {formatAddedDate(p.created_at)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-black uppercase tracking-widest ${getStockHealth(p) === 'out' ? 'bg-red-100 text-red-700' : getStockHealth(p) === 'low' ? 'bg-amber-100 text-amber-400' : 'bg-emerald-100 text-emerald-400'}`}>
                    {getStockHealth(p) === 'out' ? 'Out of Stock' : getStockHealth(p) === 'low' ? 'Low Stock' : 'Healthy'}
                  </span>
                  {getDataHealthFlags(p).map((flag) => (
                    <span key={flag.key} className={`rounded-full px-2 py-0.5 font-black uppercase tracking-widest ${flag.tone}`}>
                      {flag.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Pricing</p>
	                {store.mode === 'SUPERMARKET' ? (
	                  <p className="mt-2 text-lg font-black text-slate-900">{formatCurrency(p.price)}</p>
	                ) : (
	                  (() => {
	                    const activeCondition = getPrimaryConditionEntry(p);
	                    return (
	                      <div className="mt-2 space-y-2">
	                        {activeCondition && (
	                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700">
	                            Condition
	                            <span className="rounded-full bg-white px-2 py-0.5 text-sky-900">{formatConditionLabel(activeCondition.label)}</span>
	                          </div>
	                        )}
	                        <p className="text-lg font-black text-slate-900">{formatInventoryCurrency(activeCondition?.price ?? Number(p.price || 0))}</p>
	                      </div>
	                    );
	                  })()
	                )}
	              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Stock</p>
	                {store.mode === 'SUPERMARKET' ? (
	                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-300">
	                    <span className="font-black">{formatInventoryUnits(getAvailableUnits(p))}</span>
	                    <span>available</span>
                    {Number(p.on_collection_quantity || 0) > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-400">
                        On Collection: {formatInventoryUnits(Number(p.on_collection_quantity || 0))}
                      </span>
                    )}
                  </div>
	                ) : (
	                  (() => {
	                    const activeCondition = getPrimaryConditionEntry(p);
	                    const stockUnits = Number(activeCondition?.stock ?? getAvailableUnits(p) ?? 0);
	                    return (
	                      <div className="mt-2 space-y-2">
	                        {activeCondition && (
	                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700">
	                            Condition
	                            <span className="rounded-full bg-white px-2 py-0.5 text-sky-900">{formatConditionLabel(activeCondition.label)}</span>
	                          </div>
	                        )}
	                        <p className={`text-sm font-black ${stockUnits < 5 ? 'text-red-600' : 'text-slate-900'}`}>
	                          {formatInventoryUnits(stockUnits)} units
	                        </p>
	                      </div>
	                    );
	                  })()
	                )}
	              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                onClick={() => openProductOverview(p)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title="Product overview"
              >
                <LayoutGrid size={18} />
              </button>
              {canAdjustStock && (
                <button
                  onClick={() => openStockAdjustmentModal(p)}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-blue-900/20 hover:text-blue-400"
                  title="Adjust stock"
                >
                  <Settings2 size={18} />
                </button>
              )}
              <button
                onClick={() => openBarcodeLabel(p)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-blue-900/20 hover:text-blue-600"
                title="Print Barcode Label"
              >
                <Printer size={18} />
              </button>
              {canManageProducts && (
                <button
                  onClick={() => handleEdit(p)}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
                >
                  <Edit2 size={18} />
                </button>
              )}
              {canDeleteProducts && (
                <button
                  onClick={() => handleDelete(p.id)}
                  className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

	      <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm lg:block">
	        <div className="w-full">
	          <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="w-14 p-4 text-xs font-bold text-slate-500 uppercase tracking-widest">
                <input
                  type="checkbox"
                  aria-label="Select all visible products"
                  checked={allFilteredSelected}
                  onChange={toggleSelectAllFiltered}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
              </th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest lg:w-[31%]">Product</th>
	              <th className="hidden xl:table-cell p-4 text-xs font-bold text-slate-500 uppercase tracking-widest xl:w-[11%]">Quick Code</th>
	              <th className="hidden xl:table-cell p-4 text-xs font-bold text-slate-500 uppercase tracking-widest xl:w-[11%]">Category</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest lg:w-[16%]">Pricing</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest lg:w-[19%]">Available / On Collection</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right lg:w-[12%]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedProducts.map(p => (
              <tr key={p.id} className={`border-b border-slate-50 transition-colors hover:bg-slate-50/50 ${Number(p.on_collection_quantity || 0) > 0 ? 'bg-amber-900/20/40' : ''}`}>
                <td className="p-4 align-top">
                  <input
                    type="checkbox"
                    aria-label={`Select ${p.name}`}
                    checked={selectedProductIds.includes(Number(p.id))}
                    onChange={() => toggleProductSelection(Number(p.id))}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                  />
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0 border border-slate-200">
                      {p.thumbnail ? (
                        <img 
                          src={p.thumbnail} 
                          alt={p.name} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <Package className="w-full h-full p-2 text-slate-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      {isInlineEditing(Number(p.id), 'name') ? (
                        renderInlineEditor(p, 'name', { placeholder: 'Product name' })
                      ) : (
                        <div
                          {...getInlineActivationProps(p, 'name', String(p.name || ''))}
                          className={`rounded-xl p-1 transition-colors ${canManageProducts ? 'cursor-pointer hover:bg-sky-50' : ''}`}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-slate-900">{p.name}</p>
                            {Number(p.on_collection_quantity || 0) > 0 && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-400">
                                On Loan / Collection
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-slate-400 font-mono">{p.barcode || 'No Barcode'}</p>
	                      <div className="mt-1 flex flex-wrap items-center gap-2 xl:hidden">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          {p.category || 'General'}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-300">
                          {p.quick_code || '-----'}
                        </span>
                      </div>
                      {getDataHealthFlags(p).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {getDataHealthFlags(p).map((flag) => (
                            <span key={flag.key} className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${flag.tone}`}>
                              {flag.label}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="text-[11px] text-slate-500">Added {formatAddedDate(p.created_at)}</p>
                    </div>
                  </div>
                </td>
	                <td className="hidden xl:table-cell p-4">
                  <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 font-mono text-sm font-bold text-slate-900">
                    {p.quick_code || '-----'}
                  </span>
                </td>
	                <td className="hidden xl:table-cell p-4">
                  {isInlineEditing(Number(p.id), 'category') ? (
                    renderInlineEditor(p, 'category', {
                      type: 'select',
                      selectOptions: Array.from(new Set([String(p.category || 'General'), 'General', ...categories.map((cat) => String(cat?.name || '').trim()).filter(Boolean)])),
                    })
                  ) : (
                    <span
                      {...getInlineActivationProps(p, 'category', String(p.category || 'General'))}
                      className={`inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 transition-colors ${canManageProducts ? 'cursor-pointer hover:bg-sky-100' : ''}`}
                    >
                      {p.category || 'General'}
                    </span>
                  )}
                </td>
                <td className="p-4">
                  {store.mode === 'SUPERMARKET' ? (
                    isInlineEditing(Number(p.id), 'price') ? (
                      renderInlineEditor(p, 'price', { inputMode: 'decimal', placeholder: 'Selling price' })
                    ) : (
                      <div
                        {...getInlineActivationProps(p, 'price', formatNumberForInput(p.price))}
                        className={`inline-flex rounded-xl px-2 py-1 font-bold text-slate-900 transition-colors ${canManageProducts ? 'cursor-pointer hover:bg-sky-50' : ''}`}
                      >
                        {formatCurrency(p.price)}
                      </div>
                    )
                  ) : (
                    <div className="space-y-1.5">
                      {Object.entries(p.condition_matrix || {}).filter(([, data]: any) => Number(data?.price || 0) > 0 || Number(data?.stock || 0) > 0).map(([cond, data]: any) => {
                        const amount = Number(data?.price || 0);
                        const field = `condition:${cond}:price`;
                        return (
                          <div key={cond}
                            className={`rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm transition-colors ${canManageProducts && !isInlineEditing(Number(p.id), field) ? 'cursor-pointer hover:border-sky-200 hover:bg-sky-50/60' : ''}`}
                            {...getInlineActivationProps(p, field, formatNumberForInput(amount))}
                          >
                            <div className="mb-1 text-[9px] font-black uppercase tracking-wide text-slate-400">{cond.replace('_', ' ')}</div>
                            {isInlineEditing(Number(p.id), field) ? renderInlineEditor(p, field, { inputMode: 'decimal', placeholder: '0' }) : (
                              <div className={`text-lg font-black leading-tight tracking-tight xl:text-xl ${amount > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{formatInventoryCurrency(amount)}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="p-4">
                  {store.mode === 'SUPERMARKET' ? (
                    <div className="space-y-1">
                      {isInlineEditing(Number(p.id), 'stock') ? (
                        renderInlineEditor(p, 'stock', { inputMode: 'numeric', placeholder: 'Stock units' })
                      ) : (
                        <div
                          {...getInlineActivationProps(p, 'stock', formatNumberForInput(getAvailableUnits(p)))}
                          className={`inline-flex items-center gap-2 rounded-xl px-2 py-1 transition-colors ${canManageProducts ? 'cursor-pointer hover:bg-sky-50' : ''}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${getAvailableUnits(p) < 5 ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                          <span className="font-bold">{getAvailableUnits(p)}</span>
                          <span className="text-xs text-slate-400">available</span>
                        </div>
                      )}
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${getStockHealth(p) === 'out' ? 'bg-red-100 text-red-700' : getStockHealth(p) === 'low' ? 'bg-amber-100 text-amber-400' : 'bg-emerald-100 text-emerald-400'}`}>
                        {getStockHealth(p) === 'out' ? 'Out of Stock' : getStockHealth(p) === 'low' ? 'Low Stock' : 'Healthy'}
                      </span>
                      {Number(p.on_collection_quantity || 0) > 0 && (
                        <p className="text-xs font-bold text-amber-400">On Collection: {p.on_collection_quantity}</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(p.condition_matrix || {}).filter(([, data]: any) => Number(data?.price || 0) > 0 || Number(data?.stock || 0) > 0).map(([cond, data]: any) => {
                        const stockUnits = Number(data?.stock || 0);
                        const field = `condition:${cond}:stock`;
                        return (
                          <div key={cond}
                            className={`rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-sm transition-colors ${canManageProducts && !isInlineEditing(Number(p.id), field) ? 'cursor-pointer hover:border-sky-200 hover:bg-sky-50/60' : ''}`}
                            {...getInlineActivationProps(p, field, formatNumberForInput(stockUnits))}
                          >
                            {isInlineEditing(Number(p.id), field) ? (
                              <div>{renderInlineEditor(p, field, { inputMode: 'numeric', placeholder: '0' })}</div>
                            ) : (
                              <div className="space-y-0.5">
                                <span className={`block font-bold leading-none tabular-nums ${stockUnits < 5 ? 'text-red-500' : 'text-slate-300'} ${getInventoryUnitsTextClass(stockUnits)}`}>{formatInventoryUnits(stockUnits)}</span>
                                <span className="flex items-center gap-1 text-[11px] text-slate-400"><Package size={11} /><span>units</span></span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {Number(p.on_collection_quantity || 0) > 0 && (
                        <p className="text-xs font-bold text-amber-400">On Collection: {p.on_collection_quantity}</p>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-4 text-right">
                  <div className="ml-auto flex flex-wrap justify-end gap-1">
                    <button
                      onClick={() => openProductOverview(p)}
                      className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Product overview"
                    >
                      <LayoutGrid size={18} />
                    </button>
                    {canAdjustStock && (
                      <button
                        onClick={() => openStockAdjustmentModal(p)}
                        className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="Adjust stock"
                      >
                        <Settings2 size={18} />
                      </button>
                    )}
                    <button
                      onClick={() => openBarcodeLabel(p)}
                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-900/20 rounded-lg transition-colors"
                      title="Print Barcode Label"
                    >
                      <Printer size={18} />
                    </button>
                    {canManageProducts && (
                      <button onClick={() => handleEdit(p)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
                        <Edit2 size={18} />
                      </button>
                    )}
                    {canDeleteProducts && (
                      <button onClick={() => handleDelete(p.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 size={18} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filteredProducts.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8">
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-8 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
                      <Package size={22} />
                    </div>
                    <p className="mt-4 text-base font-bold text-slate-900">No products match this view</p>
                    <p className="mt-1 text-sm text-slate-500">Adjust the search or filters to bring products back into view.</p>
                    <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                      {hasActiveInventoryFilters && (
                        <button
                          type="button"
                          onClick={resetInventoryFilters}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100"
                        >
                          Reset Filters
                        </button>
                      )}
                      {canManageProducts && (
                        <button
                          type="button"
                          onClick={() => { resetForm(); setEditingProduct(null); setShowModal(true); }}
                          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                        >
                          Add Product
                        </button>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>
      </div>

      {overviewProduct && (
        <div className="fixed inset-0 z-[56] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Product Overview</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">{overviewProduct.name}</h2>
                <p className="mt-1 text-sm text-slate-500">Dedicated product details with pricing, stock health, and specifications in one place.</p>
              </div>
              <button onClick={closeProductOverview} className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-300">
                <X size={20} />
              </button>
            </div>

            <div className="border-b border-slate-100 px-4 py-3 sm:px-6">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: 'overview', label: 'Overview' },
                  { key: 'pricing', label: 'Pricing' },
                  { key: 'stock', label: 'Stock' },
                  { key: 'specs', label: 'Specs' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setOverviewTab(tab.key as 'overview' | 'pricing' | 'stock' | 'specs')}
                    className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${overviewTab === tab.key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-6 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[320px_1fr]">
              <aside className="space-y-4">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <div className="mb-4 flex h-44 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {overviewProduct.thumbnail ? (
                      <img
                        src={overviewProduct.thumbnail}
                        alt={overviewProduct.name}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Package className="h-16 w-16 text-slate-300" />
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                        {overviewProduct.category || 'General'}
                      </span>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${overviewHealth === 'out' ? 'bg-red-100 text-red-700' : overviewHealth === 'low' ? 'bg-amber-100 text-amber-400' : 'bg-emerald-100 text-emerald-400'}`}>
                        {overviewHealth === 'out' ? 'Out of Stock' : overviewHealth === 'low' ? 'Low Stock' : 'Healthy'}
                      </span>
                    </div>

                    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                      <div className="flex items-center justify-between gap-3">
                        <span>Quick code</span>
                        <span className="font-mono font-bold text-slate-900">{overviewProduct.quick_code || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Barcode</span>
                        <span className="font-mono text-xs font-bold text-slate-900">{overviewProduct.barcode || '—'}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Added</span>
                        <span className="font-semibold text-slate-900">{formatAddedDate(overviewProduct.created_at)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>Mode</span>
                        <span className="font-semibold text-slate-900">{store?.mode === 'GADGET' ? 'Smart Retail' : 'Standard Retail'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Quick Actions</p>
                  <div className="mt-3 grid gap-2">
                    <button
                      type="button"
                      onClick={() => setOverviewTab('pricing')}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-left text-sm font-bold text-slate-300 transition-colors hover:bg-slate-100"
                    >
                      Open Pricing Tab
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverviewTab('stock')}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-left text-sm font-bold text-slate-300 transition-colors hover:bg-slate-100"
                    >
                      Open Stock Tab
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverviewTab('specs')}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-left text-sm font-bold text-slate-300 transition-colors hover:bg-slate-100"
                    >
                      Open Specs Tab
                    </button>
                    {canManageProducts && (
                      <button
                        type="button"
                        onClick={() => {
                          closeProductOverview();
                          handleEdit(overviewProduct);
                        }}
                        className="rounded-xl bg-slate-900 px-4 py-2 text-left text-sm font-bold text-white transition-colors hover:bg-slate-800"
                      >
                        Edit Product
                      </button>
                    )}
                    {canAdjustStock && (
                      <button
                        type="button"
                        onClick={() => {
                          closeProductOverview();
                          openStockAdjustmentModal(overviewProduct);
                        }}
                        className="rounded-xl border border-blue-200 bg-blue-900/20 px-4 py-2 text-left text-sm font-bold text-blue-400 transition-colors hover:bg-blue-100"
                      >
                        Quick Stock Adjust
                      </button>
                    )}
                  </div>
                </div>
              </aside>

              <section className="space-y-4">
                {overviewTab === 'overview' && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Selling Price</p>
                        <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(overviewSellingPrice)}</p>
                      </div>
                      {canViewCostFields && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Cost Price</p>
                          <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(overviewCostPrice)}</p>
                        </div>
                      )}
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Available Units</p>
                        <p className="mt-2 text-2xl font-black text-slate-900">{formatInventoryUnits(overviewAvailableUnits)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">On Collection</p>
                        <p className="mt-2 text-2xl font-black text-slate-900">{formatInventoryUnits(overviewOnCollection)}</p>
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-black text-slate-900">Modern Snapshot</h3>
                          <p className="text-sm text-slate-500">A clean product summary for quick business decisions.</p>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {canViewCostFields && (
                          <div className={`rounded-2xl border p-4 ${overviewProfit > 0 ? 'border-emerald-200 bg-emerald-900/20' : overviewProfit < 0 ? 'border-rose-200 bg-rose-900/20' : 'border-slate-200 bg-white'}`}>
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Unit Profit</p>
                            <p className={`mt-2 text-xl font-black ${overviewProfit > 0 ? 'text-emerald-400' : overviewProfit < 0 ? 'text-rose-400' : 'text-slate-900'}`}>{formatCurrency(overviewProfit)}</p>
                          </div>
                        )}
                        {canViewCostFields && (
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Markup</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{overviewCostPrice > 0 ? `${overviewMarkup.toFixed(1)}%` : '—'}</p>
                          </div>
                        )}
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Retail Value</p>
                          <p className="mt-2 text-xl font-black text-slate-900">{formatCurrency(overviewSellingPrice * overviewAvailableUnits)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Stock Health</p>
                          <p className="mt-2 text-xl font-black text-slate-900">{overviewHealth === 'out' ? 'Restock Now' : overviewHealth === 'low' ? 'Low Stock' : 'Healthy Level'}</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {overviewTab === 'pricing' && (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
                    <h3 className="text-lg font-black text-slate-900">Pricing Breakdown</h3>
                    <p className="mt-1 text-sm text-slate-500">Selling, cost, and condition-based pricing in one dedicated tab.</p>

                    {store?.mode === 'SUPERMARKET' ? (
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Selling Price</p>
                          <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(overviewSellingPrice)}</p>
                        </div>
                        {canViewCostFields && (
                          <>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Cost Price</p>
                              <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(overviewCostPrice)}</p>
                            </div>
                            <div className={`rounded-2xl border p-4 ${overviewProfit > 0 ? 'border-emerald-200 bg-emerald-900/20' : overviewProfit < 0 ? 'border-rose-200 bg-rose-900/20' : 'border-slate-200 bg-white'}`}>
                              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Unit Profit</p>
                              <p className={`mt-2 text-2xl font-black ${overviewProfit > 0 ? 'text-emerald-400' : overviewProfit < 0 ? 'text-rose-400' : 'text-slate-900'}`}>{formatCurrency(overviewProfit)}</p>
                            </div>
                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Markup</p>
                              <p className="mt-2 text-2xl font-black text-slate-900">{overviewCostPrice > 0 ? `${overviewMarkup.toFixed(1)}%` : '—'}</p>
                            </div>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {overviewConditionLabel && (
                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-sky-700">
                            Condition
                            <span className="rounded-full bg-white px-2 py-0.5 text-sky-900">{overviewConditionLabel}</span>
                          </div>
                        )}
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Selling Price</p>
                            <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(overviewSellingPrice)}</p>
                          </div>
                          {canViewCostFields && (
                            <>
                              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Cost Price</p>
                                <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(overviewCostPrice)}</p>
                              </div>
                              <div className={`rounded-2xl border p-4 ${overviewProfit > 0 ? 'border-emerald-200 bg-emerald-900/20' : overviewProfit < 0 ? 'border-rose-200 bg-rose-900/20' : 'border-slate-200 bg-white'}`}>
                                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Unit Profit</p>
                                <p className={`mt-2 text-2xl font-black ${overviewProfit > 0 ? 'text-emerald-400' : overviewProfit < 0 ? 'text-rose-400' : 'text-slate-900'}`}>{formatCurrency(overviewProfit)}</p>
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Markup</p>
                                <p className="mt-2 text-2xl font-black text-slate-900">{overviewCostPrice > 0 ? `${overviewMarkup.toFixed(1)}%` : '—'}</p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {overviewTab === 'stock' && (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
                    <h3 className="text-lg font-black text-slate-900">Stock Intelligence</h3>
                    <p className="mt-1 text-sm text-slate-500">Availability, on-collection count, and stock posture for this product.</p>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Available Units</p>
                        <p className="mt-2 text-2xl font-black text-slate-900">{formatInventoryUnits(overviewAvailableUnits)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">On Collection</p>
                        <p className="mt-2 text-2xl font-black text-slate-900">{formatInventoryUnits(overviewOnCollection)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Health</p>
                        <p className="mt-2 text-2xl font-black text-slate-900">{overviewHealth === 'out' ? 'Out' : overviewHealth === 'low' ? 'Low' : 'Good'}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-4">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Status Note</p>
                        <p className="mt-2 text-sm font-bold text-slate-900">
                          {overviewHealth === 'out'
                            ? 'This item needs immediate restock.'
                            : overviewHealth === 'low'
                              ? 'Stock is running low.'
                              : 'Current stock level is healthy.'}
                        </p>
                      </div>
                    </div>

                    {overviewConditionLabel && (
                      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-sky-700">
                        Condition
                        <span className="rounded-full bg-white px-2 py-0.5 text-sky-900">{overviewConditionLabel}</span>
                      </div>
                    )}
                  </div>
                )}

                {overviewTab === 'specs' && (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 shadow-sm sm:p-5">
                    <h3 className="text-lg font-black text-slate-900">Product Specifications</h3>
                    <p className="mt-1 text-sm text-slate-500">All saved technical details for this product.</p>

                    {overviewSpecs.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
                        No extra specifications have been saved for this product yet.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {overviewSpecs.map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">{label}</p>
                            <p className="mt-2 text-sm font-bold text-slate-900">{String(value)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      <StockAdjustmentModal
        isOpen={showAdjustmentModal}
        products={products}
        selectedProduct={adjustmentProduct}
        onClose={() => {
          setShowAdjustmentModal(false);
          setAdjustmentProduct(null);
        }}
        onSaved={handleStockAdjustmentSaved}
      />

      {labelProduct && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl text-slate-900">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Barcode Label View</h2>
                <p className="text-sm text-slate-500">Preview and print one label, multiple copies, or an A4 label sheet.</p>
              </div>
              <button onClick={closeBarcodeLabel} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={22} />
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-4">
                <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-center text-[10px] font-bold uppercase tracking-[0.28em] text-slate-500">{store?.name || 'Goody POS'}</p>
                  <h3 className="mt-2 text-center text-lg font-black text-slate-900">{labelProduct.name}</h3>
                  <p className="text-center text-xs text-slate-500">{labelProduct.category || 'General'}</p>

                  <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
                    {loadingLabel ? (
                      <div className="flex h-28 items-center justify-center text-slate-500"><Loader2 className="animate-spin" /></div>
                    ) : barcodeLabelSvg ? (
                      <div className="overflow-hidden" dangerouslySetInnerHTML={{ __html: barcodeLabelSvg }} />
                    ) : (
                      <div className="flex h-28 items-center justify-center text-sm text-slate-500">Unable to generate barcode preview.</div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 text-xs font-bold text-slate-600">
                    <span>SKU: {labelProduct.quick_code || '—'}</span>
                    <span>{formatCurrency(getComparablePrice(labelProduct))}</span>
                  </div>
                  <p className="mt-2 text-center text-[11px] text-slate-500">{labelProduct.barcode || labelProduct.quick_code}</p>
                  <p className="mt-1 text-center text-[10px] text-slate-400">
                    {labelPrintMode === 'sheet'
                      ? `A4 ${sheetPresetConfig[labelSheetPreset].label} sheet • ${(labelProducts.length || 1) * labelCopies} total label${(labelProducts.length || 1) * labelCopies === 1 ? '' : 's'}`
                      : `${labelProducts.length > 1 ? `${labelProducts.length} products • ` : ''}${labelCopies} cop${labelCopies === 1 ? 'y' : 'ies'} queued`}
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Product</p>
                  <p className="mt-2 text-lg font-black text-slate-900">{labelProduct.name}</p>
                  <p className="mt-1 text-sm text-slate-600">{labelProduct.category || 'General'}</p>
                </div>

                {labelProducts.length > 1 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Bulk Batch</p>
                    <p className="mt-2 text-lg font-black text-slate-900">{labelProducts.length} products selected</p>
                    <p className="mt-1 text-sm text-slate-600">Previewing the first product. Printing includes the whole selection.</p>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Barcode Value</p>
                  <p className="mt-2 break-all font-mono text-sm font-bold text-slate-900">{labelProduct.barcode || labelProduct.quick_code}</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-500">Print Setup</p>
                  <div className="mt-3 space-y-3">
                    <label className="block text-sm font-semibold text-slate-600">
                      Copies
                      <input
                        type="number"
                        min={1}
                        max={48}
                        value={labelCopies}
                        onChange={(e) => setLabelCopies(Math.min(48, Math.max(1, Number(e.target.value) || 1)))}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </label>
                    <label className="block text-sm font-semibold text-slate-600">
                      Layout
                      <select
                        value={labelPrintMode}
                        onChange={(e) => setLabelPrintMode(e.target.value as 'single' | 'sheet')}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                      >
                        <option value="single">Single label / thermal roll</option>
                        <option value="sheet">A4 sheet labels</option>
                      </select>
                    </label>
                    {labelPrintMode === 'sheet' && (
                      <label className="block text-sm font-semibold text-slate-600">
                        Sheet preset
                        <select
                          value={labelSheetPreset}
                          onChange={(e) => setLabelSheetPreset(e.target.value as '2x5' | '3x7' | '4x10')}
                          className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                        >
                          <option value="2x5">2 × 5 large labels</option>
                          <option value="3x7">3 × 7 standard labels</option>
                          <option value="4x10">4 × 10 compact labels</option>
                        </select>
                      </label>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Use the print button below to create a clean label for shelves, packaging, or sticker sheets.
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handlePrintBarcodeLabel}
                    disabled={loadingLabel || !barcodeLabelSvg}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Printer size={16} /> {labelPrintMode === 'sheet' || labelCopies > 1 ? 'Print Labels' : 'Print Label'}
                  </button>
                  <button
                    type="button"
                    onClick={closeBarcodeLabel}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-[300]">          {showCategoryModal && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-60">
              <div className="max-w-md w-full bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-800">
                <h3 className="text-xl font-bold text-white mb-4">Add New Category</h3>
                <label className="block text-sm text-slate-200 mb-1">Category Name</label>
                <input
                  className="w-full mb-4 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. MacBooks"
                />
                <label className="block text-sm text-slate-200 mb-1">Description (optional)</label>
                <textarea
                  className="w-full mb-4 px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={newCategoryDescription}
                  onChange={(e) => setNewCategoryDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                />
                <div className="flex justify-end items-center gap-3">
                  <button
                    type="button"
                    onClick={closeCategoryModal}
                    className="px-4 py-2 rounded-xl border border-slate-600 text-slate-300 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCategory}
                    disabled={categoryLoading}
                    className="px-4 py-2 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-900/200 disabled:opacity-50"
                  >
                    {categoryLoading ? 'Saving...' : 'Save Category'}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="w-[calc(100%-1.5rem)] max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl max-h-[90vh] flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-indigo-900 px-6 py-5 shrink-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
                  <Package size={17} className="text-white" />
                </div>
                <div>
                  <h2 className="font-black text-white">{editingProduct ? 'Edit Product' : 'Add New Product'}</h2>
                  <p className="text-xs text-slate-300">{editingProduct ? 'Update product details and pricing' : 'Fill in the details to add a new product'}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-white transition">
                <X size={18} />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="col-span-2">
                  <label className="block text-sm font-bold text-slate-700 mb-2">Product Name</label>
                  <input 
                    required
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g. iPhone 15 Pro Max"
                  />
                </div>
                
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <label className="block text-sm font-bold text-slate-700">Barcode / SKU</label>
                    <button
                        type="button"
                      onClick={handleGenerateBarcode}
                      className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200"
                    >
                      Auto Generate
                    </button>
                  </div>
                  <input 
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                    value={formData.barcode}
                    onChange={e => setFormData({...formData, barcode: e.target.value})}
                    placeholder="Leave blank to auto-generate on save"
                  />
                  <p className="mt-2 text-xs text-slate-600">If you leave this empty, GoodyPOS will create a unique barcode automatically.</p>
                </div>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Category</label>
                  <div className="flex gap-2">
                    <select
                      className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900"
                      value={formData.category_id || ''}
                      onChange={(e) => {
                        const id = e.target.value ? Number(e.target.value) : null;
                        const selected = categories.find((c) => c.id === id);
                        setFormData({
                          ...formData,
                          category_id: id,
                          category: selected?.name || ''
                        });
                      }}
                    >
                      <option value="">Select category</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={openCategoryModal}
                      className="px-4 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition-colors"
                    >
                      + New
                    </button>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="mb-2 block text-sm font-bold text-slate-700">Product Thumbnail</label>
                  <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
                    <div
                      className={`group relative flex h-40 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed transition-all ${isDraggingImage ? 'border-slate-900 bg-slate-100' : 'border-slate-200 bg-slate-50'}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDraggingImage(true);
                      }}
                      onDragLeave={() => setIsDraggingImage(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingImage(false);
                        processImageFile(e.dataTransfer.files?.[0]);
                      }}
                    >
                      {formData.thumbnail ? (
                        <img
                          src={formData.thumbnail}
                          alt="Preview"
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <ImageIcon size={34} />
                          <p className="text-[11px] font-semibold">Drop image here</p>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="absolute inset-x-3 bottom-3 rounded-xl bg-slate-950/80 px-3 py-2 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        Change Image
                      </button>
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs text-slate-600">
                        Upload, drag-and-drop, or paste an image URL. Files are optimized automatically for faster loading.
                      </p>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200"
                        >
                          <Upload size={14} /> Choose File
                        </button>
                        {formData.thumbnail && (
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, thumbnail: '' });
                              setThumbnailUrl('');
                            }}
                            className="rounded-xl px-4 py-2 text-xs font-bold text-red-500 transition-colors hover:bg-red-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={handleFileChange}
                        accept="image/png,image/jpeg,image/webp,image/jpg"
                      />

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                        <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-slate-700">Or use image URL</label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            type="url"
                            value={thumbnailUrl}
                            onChange={(e) => setThumbnailUrl(e.target.value)}
                            placeholder="https://example.com/product-image.jpg"
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-slate-900"
                          />
                          <button
                            type="button"
                            onClick={applyThumbnailUrl}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800"
                          >
                            Apply URL
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {store.mode === 'SUPERMARKET' ? (
                  <>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Selling Price</label>
                      <input 
                        type="number"
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900"
                        value={formData.price}
                        onChange={e => setFormData({...formData, price: e.target.value === '' ? '' : Number(e.target.value)})}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">Stock Level</label>
                      <input 
                        type="number"
                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900"
                        value={formData.stock}
                        onChange={e => setFormData({...formData, stock: e.target.value === '' ? '' : Number(e.target.value)})}
                      />
                    </div>
                    {canViewCostFields && (
                      <>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Cost Price</label>
                          <input 
                            type="number"
                            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900"
                            value={formData.cost}
                            onChange={e => setFormData({...formData, cost: e.target.value === '' ? '' : Number(e.target.value)})}
                          />
                        </div>
                        <div className={`rounded-2xl border p-4 ${Number(formData.price || 0) <= 0 ? 'border-amber-200 bg-amber-900/20' : getProfitMargin(formData.price, formData.cost) > 0 ? 'border-emerald-200 bg-emerald-900/20' : getProfitMargin(formData.price, formData.cost) < 0 ? 'border-rose-200 bg-rose-900/20' : 'border-slate-200 bg-slate-50'}`}>
                          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Live Margin</p>
                          <p className={`mt-2 text-xl font-black ${Number(formData.price || 0) <= 0 ? 'text-amber-400' : getProfitMargin(formData.price, formData.cost) > 0 ? 'text-emerald-400' : getProfitMargin(formData.price, formData.cost) < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                            {Number(formData.price || 0) <= 0
                              ? 'Selling price required'
                              : `Profit: ${formatCurrency(getProfitMargin(formData.price, formData.cost))}`}
                          </p>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div className="col-span-2 space-y-4">
                    <p className="text-sm font-bold text-slate-700 uppercase tracking-widest flex items-center gap-2">
                      <Settings2 size={16} /> Condition Matrix
                    </p>

                    {/* Condition toggle buttons */}
                    <div className="flex gap-2">
                      {(['new', 'open_box', 'used'] as const).map(cond => {
                        const label = cond === 'open_box' ? 'Open Box' : cond.charAt(0).toUpperCase() + cond.slice(1);
                        const current = formData.condition_matrix[cond] || { price: '', stock: '', cost: '' };
                        const hasData = Number(current.price || 0) > 0 || Number(current.stock || 0) > 0 || Number(current.cost || 0) > 0;
                        const isActive = activeCondition === cond;
                        return (
                          <button
                            key={cond}
                            type="button"
                            onClick={() => {
                              if (isActive) return;
                              // Move data from current active condition to newly selected one, clear old
                              const currentData = formData.condition_matrix[activeCondition] || { price: '', stock: '', cost: '' };
                              const newMatrix = {
                                new: { price: '', stock: '', cost: '' },
                                open_box: { price: '', stock: '', cost: '' },
                                used: { price: '', stock: '', cost: '' },
                              };
                              newMatrix[cond as 'new' | 'open_box' | 'used'] = { ...currentData };
                              setFormData({ ...formData, condition_matrix: newMatrix });
                              setActiveCondition(cond as 'new' | 'open_box' | 'used');
                            }}
                            className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-black uppercase tracking-wide transition-all ${
                              isActive
                                ? 'bg-slate-900 text-white shadow-md'
                                : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Active condition fields */}
                    {(() => {
                      const cond = activeCondition;
                      const current = formData.condition_matrix[cond] || { price: '', stock: '', cost: '' };
                      const margin = getProfitMargin(current.price, current.cost);
                      const sellingPriceMissing = (Number(current.stock || 0) > 0 || Number(current.cost || 0) > 0) && Number(current.price || 0) <= 0;
                      return (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                          {canViewCostFields && (
                            <div>
                              <label className="block text-xs font-bold mb-1 text-slate-700">Cost Price ({inventoryCurrencySymbol})</label>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder={`Enter cost in ${inventoryCurrencySymbol}`}
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                                value={formatNumberForInput(current.cost)}
                                onChange={e => {
                                  const newMatrix = { ...formData.condition_matrix };
                                  newMatrix[cond].cost = parseNumberFromInput(e.target.value);
                                  setFormData({ ...formData, condition_matrix: newMatrix });
                                }}
                              />
                            </div>
                          )}
                          <div>
                            <label className="block text-xs font-bold mb-1 text-slate-700">Selling Price ({inventoryCurrencySymbol})</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder={`Enter price in ${inventoryCurrencySymbol}`}
                              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                              value={formatNumberForInput(current.price)}
                              onChange={e => {
                                const newMatrix = { ...formData.condition_matrix };
                                newMatrix[cond].price = parseNumberFromInput(e.target.value);
                                setFormData({ ...formData, condition_matrix: newMatrix });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold mb-1 text-slate-700">Stock</label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Package size={14} /></span>
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="0"
                                className="w-full pl-8 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                                value={formatNumberForInput(current.stock)}
                                onChange={e => {
                                  const newMatrix = { ...formData.condition_matrix };
                                  newMatrix[cond].stock = parseNumberFromInput(e.target.value);
                                  setFormData({ ...formData, condition_matrix: newMatrix });
                                }}
                              />
                            </div>
                          </div>
                          {canViewCostFields && (
                            <div className={`rounded-xl px-3 py-2 text-sm font-black ${sellingPriceMissing ? 'bg-amber-900/20 text-amber-600' : margin > 0 ? 'bg-emerald-900/20 text-emerald-700' : margin < 0 ? 'bg-rose-900/20 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                              {sellingPriceMissing ? 'Selling price required' : `Profit: ${formatCurrency(margin)}`}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Dynamic Specs */}
                {store.custom_specs && store.custom_specs.length > 0 && (
                  <div className="col-span-2 space-y-4 pt-4 border-t border-slate-100">
                    <p className="text-sm font-bold text-slate-900 uppercase tracking-widest flex items-center gap-2">
                      <LayoutGrid size={16} /> Specifications
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      {store.custom_specs.map((spec: string) => (
                        <div key={spec}>
                          <label className="text-xs font-bold text-slate-500 mb-1 block uppercase">{spec}</label>
                          <input 
                            className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-sm text-slate-900"
                            value={formData.specs[spec] || ''}
                            onChange={e => {
                              const newSpecs = { ...formData.specs };
                              newSpecs[spec] = e.target.value;
                              setFormData({ ...formData, specs: newSpecs });
                            }}
                            placeholder={`Enter ${spec}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:gap-3">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 rounded-2xl border border-slate-200 py-3 font-bold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-900 py-3 font-black text-white shadow-lg transition hover:opacity-90"
                >
                  {editingProduct ? 'Update Product' : 'Save Product'}
                </button>
              </div>
            </form>
            </div>
          </div>
        </div>
      )}
      {/* Recycle Bin Modal */}
      {showRecycleBin && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4 z-[80]">
          <div className="bg-slate-900 max-w-4xl w-full rounded-[40px] p-10 border border-slate-800 shadow-2xl flex flex-col max-h-[85vh]">
            <header className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-black text-white">Inventory Recycle Bin</h2>
                <p className="text-slate-400">Restore soft-deleted products</p>
              </div>
              <button onClick={() => setShowRecycleBin(false)} className="text-slate-500 hover:text-white"><X size={32} /></button>
            </header>

            <div className="flex-1 overflow-auto space-y-4 pr-2">
              {loadingDeleted ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-red-500" size={48} /></div>
              ) : deletedProducts.length === 0 ? (
                <div className="text-center py-20 text-slate-500">
                  <Trash2 size={64} className="mx-auto mb-4 opacity-20" />
                  <p className="text-xl font-bold">Recycle bin is empty</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {deletedProducts.map(product => (
                    <div key={product.id} className="bg-slate-800/50 border border-slate-700 p-6 rounded-3xl flex items-center justify-between hover:bg-slate-800 transition-colors group">
                      <div className="flex items-center gap-6">
                        <div className="w-16 h-16 bg-slate-900 rounded-2xl overflow-hidden border border-slate-700">
                          {product.thumbnail ? (
                            <img src={product.thumbnail} alt={product.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Package className="w-full h-full p-4 text-slate-300" />
                          )}
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-white">{product.name}</h3>
                          <div className="flex items-center gap-3 text-sm text-slate-500">
                            <span className="bg-slate-700 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest">Store ID: {product.store_id}</span>
                            <span>Deleted: {new Date(product.deleted_at).toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={() => restoreProduct(product.id)}
                        className="flex items-center gap-2 bg-green-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-600/10"
                      >
                        <RotateCcw size={18} /> Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Inventory;

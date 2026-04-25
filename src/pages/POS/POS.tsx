import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Search, 
  ShoppingCart, 
  Edit2,
  Trash2, 
  Plus, 
  Minus, 
  CreditCard, 
  Banknote, 
  ArrowRightLeft,
  AlertCircle,
  Package,
  X,
  CheckCircle2,
  Loader2,
  FileText,
  Home,
  Clock,
  Save,
  History,
  User,
  MessageCircle,
  Percent,
  Share2,
  MoreHorizontal,
  Delete
} from 'lucide-react';
import { formatCurrency, normalizeLogoDataUrl, openWhatsAppShare, printPdfUrl } from '../../lib/utils';
import { getCurrencyConfig } from '../../lib/currency';

interface Product {
  id: number;
  name: string;
  barcode: string;
  quick_code?: string;
  imei_serial?: string;
  consignment_quantity?: number;
  consignment_item_id?: number | null;
  is_consignment?: boolean;
  item_source?: 'INVENTORY' | 'CONSIGNMENT';
  vendor_name?: string;
  agreed_payout?: number;
  internal_condition?: string;
  thumbnail: string;
  price: number;
  stock: number;
  mode: 'SUPERMARKET' | 'GADGET';
  specs: any;
  condition_matrix: any;
}

interface CartItem extends Product {
  quantity: number;
  selectedCondition?: 'NEW' | 'OPEN_BOX' | 'USED';
  imei_serial?: string;
  price_at_sale: number;
  base_price_at_sale: number;
  is_sourced?: boolean;
  sourced_vendor_name?: string;
  sourced_vendor_address?: string;
  sourced_vendor_phone?: string;
  sourced_vendor_reference?: string;
  sourced_product_specs?: string;
  sourced_cost_price?: number;
}

interface DiscountCodeConfig {
  id: string;
  name: string;
  code: string;
  type: 'PERCENTAGE' | 'FIXED';
  value: number;
  expires_at: string | null;
  active: boolean;
}

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

const isDiscountCodeExpired = (expiresAt?: string | null) => {
  if (!expiresAt) return false;
  const expiryTime = new Date(`${expiresAt}T23:59:59`).getTime();
  return Number.isFinite(expiryTime) && expiryTime < Date.now();
};

const getDefaultDueDateValue = () => {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().split('T')[0];
};

const POS_MAX_VISIBLE_PRODUCTS = 120;
const USB_SCANNER_MIN_LENGTH = 4;
const USB_SCANNER_IDLE_RESET_MS = 250;
const USB_SCANNER_RAPID_KEY_MS = 90;

const formatCheckoutCurrency = (amount: number) => formatCurrency(amount).replace(/\s(?=\d)/, '\u00A0');

const getCheckoutAmountTextClass = (amount: number) => {
  const displayLength = formatCheckoutCurrency(amount).length;

  if (displayLength >= 14) return 'text-[1.8rem] sm:text-[2.2rem]';
  if (displayLength >= 12) return 'text-[2.1rem] sm:text-[2.6rem]';
  return 'text-4xl sm:text-[3.25rem]';
};

const getCartLineAmountTextClass = (amount: number) => {
  const displayLength = formatCheckoutCurrency(amount).length;

  if (displayLength >= 14) return 'text-lg sm:text-xl';
  if (displayLength >= 12) return 'text-xl sm:text-2xl';
  return 'text-2xl';
};

const getSidebarTotalTextClass = (amount: number) => {
  const displayLength = formatCheckoutCurrency(amount).length;

  if (displayLength >= 14) return 'text-xl sm:text-2xl';
  if (displayLength >= 12) return 'text-2xl sm:text-[1.7rem]';
  return 'text-2xl sm:text-3xl';
};

const normalizeCustomerPhoneInput = (value: unknown) => {
  const raw = String(value ?? '');
  const hasLeadingPlus = raw.trim().startsWith('+');
  const digits = raw.replace(/\D/g, '').slice(0, 15);
  return hasLeadingPlus ? `+${digits}` : digits;
};
const getCustomerPhoneDigits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const isValidCustomerPhone = (value: unknown) => {
  const digits = getCustomerPhoneDigits(value);
  return digits.length >= 7 && digits.length <= 15;
};

const POS: React.FC = () => {
  const { user } = useAuth();
  const { showNotification, hideNotification } = useNotification();
  const navigate = useNavigate();
  const [store, setStore] = useState<any>(null);
  const quickCashSymbol = getCurrencyConfig(store?.currency_code).symbol;
  const [products, setProducts] = useState<Product[]>([]);
  const [productTotal, setProductTotal] = useState(0);
  const [productsLoading, setProductsLoading] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [priceEditBuffer, setPriceEditBuffer] = useState<Record<number, string>>({});
  const [priceEditIndex, setPriceEditIndex] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Checkout States
  const [showCheckout, setShowCheckout] = useState(false);
  const [showSourcedItemModal, setShowSourcedItemModal] = useState(false);
  const [editingSourcedItemId, setEditingSourcedItemId] = useState<number | null>(null);
  const [sourcedItemForm, setSourcedItemForm] = useState({
    name: '',
    imei_serial: '',
    vendor_cost_price: '',
    selling_price: '',
    vendor_name: '',
    vendor_address: '',
    vendor_phone: '',
    vendor_reference: '',
    product_specs: '',
  });
  const [lastSale, setLastSale] = useState<any>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showWhatsAppShareModal, setShowWhatsAppShareModal] = useState(false);
  const [whatsAppShareMode, setWhatsAppShareMode] = useState<'receipt' | 'order'>('receipt');
  const [whatsAppSharePhone, setWhatsAppSharePhone] = useState('');
  const [paymentMethods, setPaymentMethods] = useState({ cash: 0, transfer: 0, pos: 0 });
  const [checkoutPin, setCheckoutPin] = useState('');
  const [checkoutPinConfirmed, setCheckoutPinConfirmed] = useState(false);
  const [confirmingCheckoutPin, setConfirmingCheckoutPin] = useState(false);
  const [confirmedCheckoutActor, setConfirmedCheckoutActor] = useState<any>(null);
  const [isPendingTransfer, setIsPendingTransfer] = useState(false);
  const [allowPayLater, setAllowPayLater] = useState(false);
  const [saleDueDate, setSaleDueDate] = useState(() => getDefaultDueDateValue());
  const [saleNote, setSaleNote] = useState('');
  const [discountType, setDiscountType] = useState<'NONE' | 'PERCENTAGE' | 'FIXED'>('NONE');
  const [discountValue, setDiscountValue] = useState('');
  const [discountNote, setDiscountNote] = useState('');
  const [showDiscountOnInvoice, setShowDiscountOnInvoice] = useState(true);
  const [discountCodeInput, setDiscountCodeInput] = useState('');
  const [, setAppliedDiscountCode] = useState<DiscountCodeConfig | null>(null);
  
  // Hold Sale States
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showParkedSales, setShowParkedSales] = useState(false);
  const [holds, setHolds] = useState<any[]>([]);
  const [holdForm, setHoldForm] = useState({ customer_name: '', note: '' });
  const [savingHold, setSavingHold] = useState(false);
  
  // Customer States
  const [customer, setCustomer] = useState<any>(null);
  const [savedCustomers, setSavedCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [searchingCustomer, setSearchingCustomer] = useState(false);
  const [customerSearchStatus, setCustomerSearchStatus] = useState<'idle' | 'found' | 'notfound'>('idle');
  const [searchResultCustomer, setSearchResultCustomer] = useState<any>(null);
  const [showInlineCustomerForm, setShowInlineCustomerForm] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', address: '' });
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [phoneSuggestions, setPhoneSuggestions] = useState<any[]>([]);
  const [showPhoneSuggestions, setShowPhoneSuggestions] = useState(false);
  
  // Pro-forma & Reservation States
  const [showProformaModal, setShowProformaModal] = useState(false);
  const [proformaExpiry, setProformaExpiry] = useState<number | 'custom'>(24); // Default 24h
  const [customExpiryDate, setCustomExpiryDate] = useState('');
  const [generatingProforma, setGeneratingProforma] = useState(false);
  const [convertingProformaId, setConvertingProformaId] = useState<number | null>(null);
  
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const checkoutModalRef = useRef<HTMLDivElement>(null);
  const scannerBufferRef = useRef('');
  const scannerLastKeyAtRef = useRef(0);
  const scannerResetTimerRef = useRef<number | null>(null);
  const location = useLocation();
  const customerPhoneDigits = getCustomerPhoneDigits(customerForm.phone);
  const customerPhoneNeedsMoreDigits = customerPhoneDigits.length > 0 && customerPhoneDigits.length < 7;

  const focusSearchInput = () => {
    searchRef.current?.focus();
    searchRef.current?.select();
  };

  const clearProductSearch = () => {
    setSearch('');
    window.setTimeout(() => focusSearchInput(), 0);
  };

  useEffect(() => {
    void loadStoreData();
    void loadHolds();
  }, []);

  useEffect(() => {
    if (!showMoreMenu) return;
    const close = () => setShowMoreMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [showMoreMenu]);

  useEffect(() => {
    if (!showCheckout) return;

    const frame = window.requestAnimationFrame(() => {
      checkoutModalRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      checkoutModalRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showCheckout]);

  useEffect(() => {
    const p = location.state?.loadProforma;
    if (!p) return;

    setConvertingProformaId(p.id);

    if (p.customer_id) {
      appFetch('/api/customers')
        .then((customers) => {
          const cust = customers.find((c: any) => c.id === p.customer_id);
          if (cust) {
            setCustomer(cust);
            setCustomerForm({
              name: cust.name || '',
              phone: cust.phone || '',
              address: cust.address || ''
            });
          }
        })
        .catch(console.error);
    } else if (p.customer_name || p.customer_phone || p.customer_address) {
      setCustomer({
        name: p.customer_name || 'Walk-in Customer',
        phone: p.customer_phone || '',
        address: p.customer_address || ''
      });
      setCustomerForm({
        name: p.customer_name || '',
        phone: p.customer_phone || '',
        address: p.customer_address || ''
      });
    }

    const parsedItems = typeof p.items === 'string' ? JSON.parse(p.items) : p.items;
    setCart(parsedItems.map((item: any) => {
      const priceAtSale = Number(item.price_at_sale ?? item.price ?? 0) || 0;
      return {
        ...item,
        price_at_sale: priceAtSale,
        base_price_at_sale: Number(item.base_price_at_sale ?? priceAtSale) || priceAtSale,
        is_sourced: Boolean(item?.is_sourced || item?.sourced_item || item?.item_source === 'SOURCED'),
        sourced_vendor_name: item?.sourced_vendor_name || '',
        sourced_vendor_address: item?.sourced_vendor_address || item?.specs?.sourced_vendor_address || '',
        sourced_vendor_phone: item?.sourced_vendor_phone || item?.specs?.sourced_vendor_phone || '',
        sourced_vendor_reference: item?.sourced_vendor_reference || '',
        sourced_product_specs: item?.sourced_product_specs || item?.specs?.sourced_product_specs || '',
        sourced_cost_price: Math.max(0, Number(item?.sourced_cost_price ?? item?.cost_at_sale ?? 0) || 0),
      };
    }));

    window.history.replaceState({}, document.title);
  }, [location.state]);

  useEffect(() => {
    if (store?.mode === 'SUPERMARKET') {
      focusSearchInput();
    }
  }, [store?.mode]);

  const loadHolds = async () => {
    try {
      const data = await appFetch('/api/pos/holds');
      setHolds(data);
    } catch (err) {
      console.error('Failed to load holds:', err);
    }
  };

  const handleHoldSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) return;
    setSavingHold(true);
    try {
      await appFetch('/api/pos/hold', {
        method: 'POST',
        body: JSON.stringify({
          ...holdForm,
          cart_data: cart
        })
      });
      setCart([]);
      setHoldForm({ customer_name: '', note: '' });
      setShowHoldModal(false);
      loadHolds();
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setSavingHold(false);
    }
  };

  const attachCustomer = (customerData: any, notify = false) => {
    if (!customerData) return;

    setCustomer(customerData);
    setCustomerForm({
      name: customerData.name || '',
      phone: customerData.phone || '',
      address: customerData.address || ''
    });
    setCustomerSearch(customerData.phone || '');
    setSearchResultCustomer(customerData);
    setCustomerSearchStatus('found');
    setShowInlineCustomerForm(false);
    setShowPhoneSuggestions(false);

    if (notify) {
      showNotification({ message: `Attached ${customerData.name}`, type: 'success' });
    }
  };

  const loadCustomers = async () => {
    try {
      const data = await appFetch('/api/customers');
      setSavedCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load customers:', err);
      setSavedCustomers([]);
    }
  };

  const handleSelectCustomer = (customerId: string) => {
    const selected = savedCustomers.find(entry => String(entry.id) === customerId);
    if (!selected) return;
    attachCustomer(selected, true);
  };

  const handlePhoneSuggestions = async (digits: string) => {
    if (digits.length < 5) {
      setPhoneSuggestions([]);
      setShowPhoneSuggestions(false);
      return;
    }
    try {
      const suggestions = await appFetch(`/api/customers/phone-suggestions?prefix=${encodeURIComponent(digits)}`);
      if (Array.isArray(suggestions)) {
        setPhoneSuggestions(suggestions);
        setShowPhoneSuggestions(suggestions.length > 0);
      } else {
        setPhoneSuggestions([]);
        setShowPhoneSuggestions(false);
      }
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
      setPhoneSuggestions([]);
      setShowPhoneSuggestions(false);
    }
  };

  const handleCustomerSearch = async (manualPhone?: string) => {
    const raw = String((manualPhone ?? customerSearch) || '');
    const phone = (raw.match(/\d/g) || []).join('');
    setCustomerSearch(phone);
    setShowPhoneSuggestions(false);

    if (phone.length < 7) {
      setSearchingCustomer(false);
      setCustomer(null);
      setCustomerSearchStatus('idle');
      setSearchResultCustomer(null);
      setShowInlineCustomerForm(false);
      return;
    }

    setSearchingCustomer(true);
    try {
      const data = await appFetch(`/api/customers/search?phone=${encodeURIComponent(phone)}`);
      if (data && data.id) {
        attachCustomer({ ...data, phone: data.phone || phone });
        showNotification({ message: `Found: ${data.name}`, type: 'success' });
      } else {
        setCustomer(null);
        setSearchResultCustomer(null);
        setCustomerSearchStatus('notfound');
        setShowInlineCustomerForm(true);
        setCustomerForm(prev => ({ ...prev, phone, name: '', address: '' }));
        showNotification({ message: 'Customer not found. Please register below.', type: 'warning' });
      }
    } catch (err) {
      console.error('Customer search error:', err);
      setCustomer(null);
      setSearchResultCustomer(null);
      setCustomerSearchStatus('notfound');
      setShowInlineCustomerForm(true);
      setCustomerForm(prev => ({ ...prev, phone }));
      showNotification({ message: 'Search error. Please register below.', type: 'error' });
    } finally {
      setSearchingCustomer(false);
    }
  };

  const handleQuickAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!String(customerForm.name || '').trim() || !isValidCustomerPhone(customerForm.phone)) {
      showNotification({ message: 'Enter a customer name and a valid phone number with 7-15 digits.', type: 'warning' });
      return;
    }

    setSavingCustomer(true);
    try {
      const data = await appFetch('/api/customers', {
        method: 'POST',
        body: JSON.stringify({
          ...customerForm,
          name: String(customerForm.name || '').trim(),
          phone: normalizeCustomerPhoneInput(customerForm.phone),
          address: String(customerForm.address || '').trim(),
        })
      });
      attachCustomer(data);
      await loadCustomers();
      setShowCustomerModal(false);
      setCustomerForm({ name: '', phone: '', address: '' });
      setCustomerSearch('');
      showNotification({ message: 'Customer added and attached!', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleGenerateProforma = async () => {
    if (cart.length === 0) return;
    setGeneratingProforma(true);
    try {
      let expiryDate;
      if (proformaExpiry === 'custom') {
        if (!customExpiryDate) {
          showNotification({ message: 'Please select a custom expiry date', type: 'warning' });
          setGeneratingProforma(false);
          return;
        }
        expiryDate = new Date(customExpiryDate).toISOString();
      } else {
        expiryDate = new Date(Date.now() + proformaExpiry * 60 * 60 * 1000).toISOString();
      }

      const proformaData = {
        customer_id: customer?.id,
        customer_name: customer?.name || 'Walk-in Customer',
        customer_phone: customer?.phone,
        customer_address: customer?.address || customerForm.address || '',
        items: cart.map(item => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price_at_sale,
          specs: item.specs || {},
          condition: item.selectedCondition || null,
          imei_serial: item.imei_serial || null,
        })),
        subtotal,
        tax_amount: taxAmount,
        tax_percentage: taxRate,
        total,
        expiry_date: expiryDate
      };

      const result = await appFetch('/api/pro-formas', {
        method: 'POST',
        body: JSON.stringify(proformaData)
      });

      if (result.success) {
        const { generateProformaPDF } = await import('../../lib/pdf');
        const { doc, filename } = await generateProformaPDF({
          ...proformaData,
          id: result.id,
          created_at: new Date().toISOString(),
          expiry_date: expiryDate
        }, store);
        doc.save(filename);
        setShowProformaModal(false);
        setCart([]);
        setCustomer(null);
        showNotification({ message: 'Pro-forma generated and items reserved successfully!', type: 'success' });
      }
    } catch (err: any) {
      showNotification({ message: 'Failed to generate pro-forma: ' + err.message, type: 'error' });
    } finally {
      setGeneratingProforma(false);
    }
  };

  const resumeHold = async (hold: any) => {
    if (cart.length > 0) {
      showNotification({ message: 'Current cart will be replaced with hold items.', type: 'warning' });
    }
    setCart(hold.cart_data);
    setShowParkedSales(false);
    // Optionally delete the hold after resumption
    try {
      await appFetch(`/api/pos/holds/${hold.id}`, { method: 'DELETE' });
      loadHolds();
    } catch (err) {
      console.error('Failed to delete resumed hold:', err);
    }
  };

  const normalizePosProduct = (product: any): Product => {
    const rawSpecs = product?.specs;
    const parsedSpecs = typeof rawSpecs === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(rawSpecs);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          } catch {
            return {};
          }
        })()
      : (rawSpecs && typeof rawSpecs === 'object' ? rawSpecs : {});

    const rawMatrix = product?.condition_matrix;
    const parsedMatrix = typeof rawMatrix === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(rawMatrix);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
          } catch {
            return null;
          }
        })()
      : (rawMatrix && typeof rawMatrix === 'object' ? rawMatrix : null);

    const embeddedMatrix = parsedSpecs && typeof parsedSpecs === 'object' ? parsedSpecs.__condition_matrix : null;
    const resolvedMatrix = parsedMatrix || (embeddedMatrix && typeof embeddedMatrix === 'object' ? embeddedMatrix : null);

    const isConsignment = Boolean(product?.is_consignment) || String(product?.source_type || '').toUpperCase() === 'CONSIGNMENT';
    return {
      ...product,
      specs: parsedSpecs,
      condition_matrix: resolvedMatrix,
      is_consignment: isConsignment,
      internal_condition: product?.internal_condition || null,
      price: Math.max(0, Number(product?.price || 0) || 0),
      stock: Math.max(0, Math.trunc(Number(product?.stock || 0) || 0)),
    } as Product;
  };

  const loadProducts = async (searchTerm = search.trim()) => {
    setProductsLoading(true);
    try {
      const query = new URLSearchParams({ limit: String(POS_MAX_VISIBLE_PRODUCTS) });
      if (searchTerm) {
        query.set('search', searchTerm);
      }

      const productsData = await appFetch(`/api/pos/search-items?${query.toString()}`);
      const items = Array.isArray(productsData) ? productsData : (Array.isArray(productsData?.items) ? productsData.items : []);
      const normalizedItems = items.map((item: any) => normalizePosProduct(item));
      const total = Array.isArray(productsData) ? items.length : Number(productsData?.total || 0);
      setProducts(normalizedItems);
      setProductTotal(total);
    } catch (err) {
      console.error('Failed to refresh products:', err);
      setProducts([]);
      setProductTotal(0);
    } finally {
      setProductsLoading(false);
    }
  };

  const loadStoreData = async () => {
    try {
      const [storeData, customersData] = await Promise.all([
        appFetch('/api/store/settings'),
        appFetch('/api/customers')
      ]);
      const normalizedLogo = await normalizeLogoDataUrl(storeData?.logo);
      setStore({
        ...storeData,
        logo: normalizedLogo || storeData?.logo || null,
        receipt_paper_size: storeData?.receipt_paper_size === 'A4' ? 'A4' : 'THERMAL',
        document_color: /^#([0-9A-Fa-f]{6})$/.test(String(storeData?.document_color || '')) ? String(storeData.document_color).toUpperCase() : '#F4BD4A',
        tax_enabled: Boolean(storeData?.tax_enabled),
        tax_percentage: Math.max(0, Number(storeData?.tax_percentage) || 0),
        pin_checkout_enabled: storeData?.pin_checkout_enabled !== false,
        receipt_header_note: String(storeData?.receipt_header_note || ''),
        receipt_footer_note: String(storeData?.receipt_footer_note || 'Thank you for your business!'),
        receipt_show_bank_details: storeData?.receipt_show_bank_details !== false,
        discount_codes: normalizeDiscountCodes(storeData?.discount_codes),
      });
      setSavedCustomers(Array.isArray(customersData) ? customersData : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetCheckoutState = () => {
    setCart([]);
    setPaymentMethods({ cash: 0, transfer: 0, pos: 0 });
    setCheckoutPin('');
    setCheckoutPinConfirmed(false);
    setConfirmingCheckoutPin(false);
    setConfirmedCheckoutActor(null);
    setIsPendingTransfer(false);
    setAllowPayLater(false);
    setSaleDueDate(getDefaultDueDateValue());
    setSaleNote('');
    setDiscountType('NONE');
    setDiscountValue('');
    setDiscountNote('');
    setShowDiscountOnInvoice(true);
    setDiscountCodeInput('');
    setAppliedDiscountCode(null);
    setShowCheckout(false);
    setShowReceipt(true);
    setConvertingProformaId(null);
  };

  const applyDiscountPreset = (value: number) => {
    setDiscountType('PERCENTAGE');
    setDiscountValue(String(value));
    setAppliedDiscountCode(null);
    setDiscountCodeInput('');
  };

  const clearDiscount = () => {
    setDiscountType('NONE');
    setDiscountValue('');
    setDiscountNote('');
    setDiscountCodeInput('');
    setAppliedDiscountCode(null);
  };

  const addToCart = async (product: Product, condition: 'NEW' | 'OPEN_BOX' | 'USED' = 'NEW', override = false) => {
    if (product.is_consignment) {
      const existing = cart.find((item) => item.id === product.id);
      if (existing) {
        const maxQuantity = Math.max(1, Math.trunc(Number(product.consignment_quantity ?? product.stock ?? 1) || 1));
        if (existing.quantity >= maxQuantity) {
          showNotification({ message: `Only ${maxQuantity} unit${maxQuantity === 1 ? '' : 's'} available for this consignment item.`, type: 'warning' });
          return;
        }

        setCartItemQuantity(cart.indexOf(existing), existing.quantity + 1, true);
        return;
      }

      setCart((prev) => [
        ...prev,
        {
          ...product,
          quantity: 1,
          selectedCondition: undefined,
          price_at_sale: Number(product.price || 0) || 0,
          base_price_at_sale: Number(product.price || 0) || 0,
          imei_serial: String(product.imei_serial || '').trim(),
          consignment_quantity: Math.max(1, Math.trunc(Number(product.consignment_quantity ?? product.stock ?? 1) || 1)),
        },
      ]);

      setSearch('');
      searchRef.current?.focus();
      return;
    }

    if (!override) {
      try {
        const existingInCart = cart.find(item => item.id === product.id && item.selectedCondition === condition);
        const currentQtyInCart = existingInCart ? existingInCart.quantity : 0;
        const check = await appFetch(`/api/products/reservation-check?product_id=${product.id}&quantity=${currentQtyInCart + 1}`);
        
        if (check.conflict) {
          const reservedNames = Array.isArray(check.reservations)
            ? check.reservations.map((r: any) => r.customer_name).filter(Boolean).join(', ')
            : '';

          showNotification({
            type: 'warning',
            title: 'Stock Reservation Alert',
            message: (
              <div className="space-y-4">
                <p>
                  ⚠️ This item is currently reserved for <strong>{reservedNames || 'another pending customer order'}</strong> on a pending Pro-forma.
                </p>
                <div className="w-full bg-slate-800 rounded-xl p-4 border border-slate-700 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Total Stock:</span>
                    <span className="text-white font-bold">{check.totalStock} units</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Reserved:</span>
                    <span className="text-yellow-400 font-bold">{check.totalReserved} units</span>
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-600 pt-3">
                    <span className="text-slate-300 font-semibold">Available to Sell:</span>
                    <span className={`font-bold ${check.availableAfterReservations < 0 ? 'text-red-400' : 'text-green-400'}`}>
                      {check.availableAfterReservations} units
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-500 italic">
                  "Selling this may conflict with a pending corporate order."
                </p>
              </div>
            ),
            autoClose: false,
            actions: [
              {
                label: 'Cancel',
                onClick: () => hideNotification()
              },
              {
                label: 'Override & Proceed to Sell',
                primary: true,
                countdown: 5,
                onClick: () => {
                  addToCart(product, condition, true);
                  hideNotification();
                }
              }
            ]
          });
          return;
        }

        if (check.outOfStock) {
          showNotification({
            type: 'warning',
            title: 'Out of Stock',
            message: 'This item does not have enough available stock right now.',
          });
          return;
        }
      } catch (err) {
        console.error('Reservation check failed:', err);
      }
    }

    const price = product.condition_matrix ? product.condition_matrix[condition.toLowerCase().replace(' ', '_')]?.price : product.price;
    
    const existing = cart.find(item => item.id === product.id && item.selectedCondition === condition);
    
    if (existing) {
      setCart(cart.map(item => 
        (item.id === product.id && item.selectedCondition === condition)
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      const resolvedPrice = price || product.price;
      setCart([...cart, { 
        ...product, 
        quantity: 1, 
        selectedCondition: product.condition_matrix ? condition : undefined, 
        imei_serial: '',
        price_at_sale: resolvedPrice,
        base_price_at_sale: resolvedPrice,
      }]);
    }
    
    setSearch('');
    searchRef.current?.focus();
  };

  const removeFromCart = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  const updateCartItemPrice = (index: number, newPriceStr: string) => {
    const item = cart[index];
    if (!item) return;
    const newPrice = Math.max(0, Number(newPriceStr) || 0);
    const minPrice = item.base_price_at_sale;
    if (newPrice < minPrice) {
      showNotification({
        message: `Error: Price cannot be lower than the approved base price of ${formatCurrency(minPrice)}.`,
        type: 'error',
      });
      setPriceEditBuffer((prev) => ({ ...prev, [index]: String(minPrice) }));
      setCart(cart.map((ci, i) => i === index ? { ...ci, price_at_sale: minPrice } : ci));
      return;
    }
    setPriceEditBuffer((prev) => ({ ...prev, [index]: String(newPrice) }));
    setCart(cart.map((ci, i) => i === index ? { ...ci, price_at_sale: newPrice } : ci));
  };

  const openSourcedItemEditor = (item: CartItem) => {
    setEditingSourcedItemId(Number(item.id));
    setSourcedItemForm({
      name: String(item.name || ''),
      imei_serial: String(item.imei_serial || ''),
      vendor_cost_price: String(Number(item.sourced_cost_price || 0) || 0),
      selling_price: String(Number(item.price_at_sale || item.price || 0) || 0),
      vendor_name: String(item.sourced_vendor_name || ''),
      vendor_address: String(item.sourced_vendor_address || ''),
      vendor_phone: String(item.sourced_vendor_phone || ''),
      vendor_reference: String(item.sourced_vendor_reference || ''),
      product_specs: String(item.sourced_product_specs || ''),
    });
    setShowSourcedItemModal(true);
  };

  const handleAddSourcedItem = () => {
    const name = String(sourcedItemForm.name || '').trim();
    const imeiSerial = String(sourcedItemForm.imei_serial || '').trim();
    const vendorName = String(sourcedItemForm.vendor_name || '').trim();
    const vendorAddress = String(sourcedItemForm.vendor_address || '').trim();
    const vendorPhone = String(sourcedItemForm.vendor_phone || '').trim();
    const vendorReference = String(sourcedItemForm.vendor_reference || '').trim();
    const productSpecs = String(sourcedItemForm.product_specs || '').trim();
    const vendorCostPrice = Math.max(0, Number(sourcedItemForm.vendor_cost_price || 0) || 0);
    const sellingPrice = Math.max(0, Number(sourcedItemForm.selling_price || 0) || 0);

    if (name.length < 2) {
      showNotification({ message: 'Enter a valid sourced item name.', type: 'warning' });
      return;
    }
    if (vendorName.length < 2) {
      showNotification({ message: 'Enter the vendor name.', type: 'warning' });
      return;
    }
    if (vendorCostPrice <= 0) {
      showNotification({ message: 'Vendor cost must be greater than zero.', type: 'warning' });
      return;
    }
    if (sellingPrice <= 0) {
      showNotification({ message: 'Selling price must be greater than zero.', type: 'warning' });
      return;
    }

    const syntheticId = -Math.floor(Date.now() + Math.random() * 1000);
    const existingEditingId = editingSourcedItemId;
    const cartItem: CartItem = {
      id: existingEditingId || syntheticId,
      name,
      barcode: '',
      thumbnail: '',
      price: sellingPrice,
      stock: 999999,
      mode: (store?.mode === 'SUPERMARKET' ? 'SUPERMARKET' : 'GADGET'),
      specs: {
        sourced_item: true,
        sourced_item_name: name,
        sourced_vendor_name: vendorName,
        sourced_vendor_address: vendorAddress || null,
        sourced_vendor_phone: vendorPhone || null,
        sourced_vendor_reference: vendorReference || null,
        sourced_product_specs: productSpecs || null,
        sourced_cost_price: vendorCostPrice,
      },
      condition_matrix: null,
      quantity: 1,
      price_at_sale: sellingPrice,
      base_price_at_sale: sellingPrice,
      imei_serial: imeiSerial,
      is_sourced: true,
      sourced_vendor_name: vendorName,
      sourced_vendor_address: vendorAddress,
      sourced_vendor_phone: vendorPhone,
      sourced_vendor_reference: vendorReference,
      sourced_product_specs: productSpecs,
      sourced_cost_price: vendorCostPrice,
    };

    setCart((prev) => (
      existingEditingId
        ? prev.map((entry) => (Number(entry.id) === existingEditingId ? { ...entry, ...cartItem } : entry))
        : [...prev, cartItem]
    ));
    setShowSourcedItemModal(false);
    setEditingSourcedItemId(null);
    setSourcedItemForm({
      name: '',
      imei_serial: '',
      vendor_cost_price: '',
      selling_price: '',
      vendor_name: '',
      vendor_address: '',
      vendor_phone: '',
      vendor_reference: '',
      product_specs: '',
    });
    showNotification({ message: existingEditingId ? 'Sourced item updated in cart.' : 'Sourced item added to cart.', type: 'success' });
  };

  const getCartItemMaxQuantity = (item: CartItem) => {
    if (item.is_consignment) {
      return Math.max(1, Math.trunc(Number(item.consignment_quantity ?? item.stock ?? 1) || 1));
    }

    if (item.is_sourced) {
      return 999;
    }

    if (store?.mode === 'GADGET' && item.selectedCondition) {
      const conditionKey = item.selectedCondition.toLowerCase();
      const conditionStock = Number(item.condition_matrix?.[conditionKey]?.stock ?? item.stock ?? 0);
      return Math.max(1, conditionStock || 1);
    }

    return Math.max(1, Number(item.stock || 0) || 1);
  };

  const setCartItemQuantity = (index: number, nextQuantity: number, notifyIfClamped = false) => {
    const item = cart[index];
    if (!item) return;

    const desiredQuantity = Number.isFinite(nextQuantity) ? Math.max(1, Math.floor(nextQuantity)) : 1;
    const maxQuantity = getCartItemMaxQuantity(item);
    const safeQuantity = Math.min(desiredQuantity, maxQuantity);

    if (notifyIfClamped && safeQuantity !== desiredQuantity) {
      showNotification({
        message: `Only ${maxQuantity.toLocaleString()} unit${maxQuantity === 1 ? '' : 's'} available for ${item.name}.`,
        type: 'warning',
      });
    }

    setCart((prev) => prev.map((entry, i) => (
      i === index ? { ...entry, quantity: safeQuantity } : entry
    )));
  };

  const updateQuantity = (index: number, delta: number) => {
    const item = cart[index];
    if (!item) return;
    setCartItemQuantity(index, item.quantity + delta);
  };

  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + (item.price_at_sale * item.quantity), 0),
    [cart]
  );
  const numericDiscountValue = Math.max(0, Number(discountValue) || 0);
  const discountAmount = useMemo(() => {
    if (discountType === 'PERCENTAGE') {
      return Number(Math.min(subtotal, subtotal * (Math.min(100, numericDiscountValue) / 100)).toFixed(2));
    }
    if (discountType === 'FIXED') {
      return Number(Math.min(subtotal, numericDiscountValue).toFixed(2));
    }
    return 0;
  }, [discountType, numericDiscountValue, subtotal]);
  const subtotalAfterDiscount = useMemo(() => Math.max(0, Number((subtotal - discountAmount).toFixed(2))), [subtotal, discountAmount]);
  const taxRate = store?.tax_enabled ? Math.max(0, Number(store?.tax_percentage) || 0) : 0;
  const taxAmount = useMemo(() => Number((subtotalAfterDiscount * (taxRate / 100)).toFixed(2)), [subtotalAfterDiscount, taxRate]);
  const total = useMemo(() => Number((subtotalAfterDiscount + taxAmount).toFixed(2)), [subtotalAfterDiscount, taxAmount]);
  const customerVisibleSubtotal = useMemo(() => (showDiscountOnInvoice ? subtotal : total), [showDiscountOnInvoice, subtotal, total]);
  const totalPaid = useMemo(
    () => paymentMethods.cash + paymentMethods.transfer + paymentMethods.pos,
    [paymentMethods.cash, paymentMethods.transfer, paymentMethods.pos]
  );
  const balance = useMemo(() => totalPaid - total, [totalPaid, total]);
  const remainingBalance = useMemo(() => Math.max(0, total - totalPaid), [total, totalPaid]);
  const totalDisplay = useMemo(() => formatCheckoutCurrency(total), [total]);
  const balanceDisplay = useMemo(() => formatCheckoutCurrency(Math.abs(balance)), [balance]);
  const totalAmountClass = useMemo(() => getCheckoutAmountTextClass(total), [total]);
  const balanceAmountClass = useMemo(() => getCheckoutAmountTextClass(Math.abs(balance)), [balance]);
  const shouldShowStoreNameOnReceipt = !lastSale?.store?.logo
    || lastSale?.store?.show_store_name_on_documents === true
    || lastSale?.store?.show_store_name_on_documents === 1;

  const getInvoiceItemLabel = (item: any, index: number) => {
    const baseName = String(item?.product_name || item?.name || `Item ${index + 1}`).trim();
    if (item?.item_source === 'CONSIGNMENT' || item?.is_consignment) {
      return baseName;
    }
    if (item?.item_source === 'SOURCED' || item?.is_sourced) {
      return baseName;
    }
    return baseName;
  };

  const getReceiptItemDetailLine = (item: any) => {
    const imeiSerial = String(item?.imei_serial || '').trim();
    return imeiSerial ? `IMEI/Serial: ${imeiSerial}` : '';
  };
  const hasOutstandingBalance = remainingBalance > 0;
  const requiresCheckoutPin = store?.mode === 'GADGET' && store?.pin_checkout_enabled !== false;
  const isCheckoutPinValid = /^\d{4,6}$/.test(checkoutPin);
  const needsCustomerForPendingSale = hasOutstandingBalance && (allowPayLater || isPendingTransfer);
  const canCheckout = (totalPaid >= total || (hasOutstandingBalance && (allowPayLater || isPendingTransfer)))
    && (store?.mode !== 'GADGET' || Boolean(customer))
    && (!needsCustomerForPendingSale || Boolean(customer))
    && (!requiresCheckoutPin || checkoutPinConfirmed);
  const checkoutGuidanceMessage = !canCheckout
    ? store?.mode === 'GADGET' && !customer
      ? 'Attach a customer before completing this Smart Retail Mode sale.'
      : requiresCheckoutPin && !checkoutPinConfirmed
        ? 'Confirm a staff checkout PIN before finishing this sale.'
        : hasOutstandingBalance && !allowPayLater && !isPendingTransfer
          ? `Add ${formatCurrency(remainingBalance)} more, or mark the sale as Pay Later / Pending Transfer.`
          : 'Enter the payment details needed to complete this checkout.'
    : null;

  const applyConfiguredDiscountCode = (entry: DiscountCodeConfig) => {
    setDiscountType(entry.type);
    setDiscountValue(String(entry.value));
    setDiscountNote(`${entry.name} (${entry.code})`);
    setDiscountCodeInput(entry.code);
    setAppliedDiscountCode(entry);
  };

  const handleApplyDiscountCode = () => {
    const code = discountCodeInput.trim().toUpperCase().replace(/\s+/g, '');
    if (!code) {
      showNotification({ message: 'Enter a discount code first.', type: 'warning' });
      return;
    }

    const configuredCodes = normalizeDiscountCodes(store?.discount_codes);
    const match = configuredCodes.find((entry) => entry.code === code);

    if (!match) {
      showNotification({ message: `Discount code ${code} was not found for this store.`, type: 'error' });
      return;
    }
    if (!match.active) {
      showNotification({ message: `${match.code} is currently inactive.`, type: 'warning' });
      return;
    }
    if (isDiscountCodeExpired(match.expires_at)) {
      showNotification({ message: `${match.code} has expired and can no longer be used.`, type: 'warning' });
      return;
    }

    applyConfiguredDiscountCode(match);
    showNotification({ message: `${match.name} applied successfully.`, type: 'success' });
  };

  const handleConfirmCheckoutPin = async () => {
    if (!requiresCheckoutPin) {
      setCheckoutPinConfirmed(false);
      setConfirmedCheckoutActor(null);
      return;
    }

    if (!isCheckoutPinValid) {
      showNotification({ message: 'Enter a valid 4-6 digit PIN first.', type: 'warning' });
      return;
    }

    setConfirmingCheckoutPin(true);
    try {
      const verification = await appFetch('/api/auth/checkout-pin/verify', {
        method: 'POST',
        body: JSON.stringify({ pin: checkoutPin }),
      });

      setCheckoutPinConfirmed(true);
      setConfirmedCheckoutActor(verification?.user || null);
      showNotification({
        message: `PIN confirmed for ${verification?.user?.username || 'this staff member'}`,
        type: 'success',
      });
    } catch (err: any) {
      setCheckoutPinConfirmed(false);
      setConfirmedCheckoutActor(null);
      showNotification({ message: String(err?.message || err || 'PIN confirmation failed'), type: 'error' });
    } finally {
      setConfirmingCheckoutPin(false);
    }
  };

  const handleCheckout = async () => {
    if (requiresCheckoutPin && !checkoutPinConfirmed) {
      showNotification({ message: 'Confirm the checkout PIN first before completing this Smart Retail Mode sale.', type: 'warning' });
      return;
    }

    if (totalPaid < total && !allowPayLater && !isPendingTransfer) {
      showNotification({ message: 'Insufficient payment amount. Use Pay Later or Pending Verify to save this sale.', type: 'error' });
      return;
    }

    if (hasOutstandingBalance && !customer) {
      showNotification({ message: 'Attach a customer to track this outstanding balance.', type: 'warning' });
      return;
    }

    const saleStatus = (isPendingTransfer || allowPayLater || totalPaid < total) ? 'PENDING' : 'COMPLETED';
    const timestamp = new Date().toISOString();
    const saleItemsPayload = cart.map(item => ({
      product_id: item.id,
      quantity: item.quantity,
      price_at_sale: item.price_at_sale,
      base_price_at_sale: item.base_price_at_sale,
      price_markup: Math.max(0, Number((item.price_at_sale - item.base_price_at_sale).toFixed(2))),
      imei_serial: item.imei_serial,
      condition: item.selectedCondition,
      specs_at_sale: item.specs,
      is_sourced: Boolean(item.is_sourced),
      sourced_vendor_name: item.sourced_vendor_name || null,
      sourced_vendor_address: item.sourced_vendor_address || null,
      sourced_vendor_phone: item.sourced_vendor_phone || null,
      sourced_vendor_reference: item.sourced_vendor_reference || null,
      sourced_product_specs: item.sourced_product_specs || null,
      sourced_cost_price: Math.max(0, Number(item.sourced_cost_price || 0) || 0),
      is_consignment: Boolean(item.is_consignment),
      consignment_item_id: item.consignment_item_id || null,
      vendor_name: item.vendor_name || null,
      agreed_payout: Math.max(0, Number(item.agreed_payout || 0) || 0),
      name: item.name,
    }));
    const salePayload = {
      subtotal,
      discount_amount: discountAmount,
      discount_type: discountType === 'NONE' ? null : discountType,
      discount_value: discountType === 'NONE' ? 0 : numericDiscountValue,
      discount_note: discountNote.trim() || null,
      show_discount_on_invoice: showDiscountOnInvoice,
      tax_amount: taxAmount,
      tax_percentage: taxRate,
      total,
      payment_methods: paymentMethods,
      items: saleItemsPayload,
      status: saleStatus,
      customer_id: customer?.id || null,
      due_date: saleStatus === 'PENDING' ? (saleDueDate || null) : null,
      note: saleNote.trim() || null,
      checkout_pin: requiresCheckoutPin ? checkoutPin : undefined,
    };

    let saleData: any = null;

    try {
      saleData = await appFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify(salePayload)
      });

      if (convertingProformaId) {
        try {
          await appFetch(`/api/pro-formas/${convertingProformaId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: 'CONVERTED' })
          });
        } catch (err) {
          console.error('Failed to update pro-forma status:', err);
        }
      }

      let pdfData = '';
      try {
        const { generateSalePDF } = await import('../../lib/pdf');
        const { doc, filename } = await generateSalePDF({
          id: saleData.id,
          subtotal,
          discount_amount: discountAmount,
          discount_type: discountType === 'NONE' ? null : discountType,
          discount_value: discountType === 'NONE' ? 0 : numericDiscountValue,
          discount_note: discountNote.trim() || null,
          show_discount_on_invoice: showDiscountOnInvoice,
          tax_amount: taxAmount,
          tax_percentage: taxRate,
          total,
          payment_methods: paymentMethods,
          items: cart,
          timestamp,
          status: saleStatus,
          customer,
        }, store);

        pdfData = doc.output('datauristring');
        await appFetch(`/api/sales/${saleData.id}/pdf`, {
          method: 'POST',
          body: JSON.stringify({
            pdf_data: pdfData,
            filename
          })
        });
      } catch (pdfErr) {
        console.error('PDF generation/upload error:', pdfErr);
        showNotification({ message: 'Sale completed, but receipt PDF upload failed. You can still print locally.', type: 'warning' });
      }

      setLastSale({
        id: saleData.id,
        subtotal,
        discount_amount: discountAmount,
        discount_type: discountType === 'NONE' ? null : discountType,
        discount_value: discountType === 'NONE' ? 0 : numericDiscountValue,
        discount_note: discountNote.trim() || null,
        show_discount_on_invoice: showDiscountOnInvoice,
        tax_amount: taxAmount,
        tax_percentage: taxRate,
        total,
        payment_methods: paymentMethods,
        items: cart,
        timestamp,
        status: saleStatus,
        customer,
        store,
        recorded_by: saleData?.recorded_by || { id: user?.id, username: user?.username, role: user?.role },
        pdf_data: pdfData
      });

      showNotification({
        message: `Sale recorded to ${saleData?.recorded_by?.username || user?.username || 'the selected staff account'}`,
        type: 'success'
      });

      resetCheckoutState();
      void loadProducts();
    } catch (err: any) {
      const message = String(err?.message || err || '');
      const isNetworkIssue = !saleData && (!navigator.onLine || /failed to fetch|networkerror|load failed|offline/i.test(message));

      if (isNetworkIssue) {
        showNotification({
          title: 'Connection Error',
          message: 'Sale could not be completed because the device is offline. Reconnect and try again.',
          type: 'error',
          duration: 4500,
        });
        return;
      }

      console.error('Checkout Error:', err);
      showNotification({ message: `Checkout failed: ${err.message || err}`, type: 'error' });
    }
  };

  const isA4Paper = store?.receipt_paper_size === 'A4';
  const documentColor = store?.document_color || '#F4BD4A';

  const prepareReceiptPdfForShare = async () => {
    if (!lastSale) {
      throw new Error('No receipt available to share.');
    }

    const { generateSalePDF } = await import('../../lib/pdf');
    const { doc, filename } = await generateSalePDF({
      ...lastSale,
      customer: lastSale.customer || customer,
    }, store);

    const pdfBlob = doc.output('blob');
    const pdfData = doc.output('datauristring');
    const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });

    if (!String(lastSale.id || '').startsWith('offline-')) {
      try {
        const uploadResult = await appFetch(`/api/sales/${lastSale.id}/pdf`, {
          method: 'POST',
          body: JSON.stringify({
            pdf_data: pdfData,
            filename,
          })
        });

        const savedPath = String(uploadResult?.path || '').trim();
        if (savedPath) {
          setLastSale((prev: any) => prev ? { ...prev, pdf_path: savedPath, pdf_data: pdfData } : prev);
        }
      } catch (uploadErr) {
        console.warn('Receipt PDF could not be saved remotely. Using local PDF instead.', uploadErr);
      }
    }

    return { doc, pdfFile };
  };

  const handlePrintReceipt = async () => {
    if (!lastSale) return;

    try {
      const { doc, pdfFile } = await prepareReceiptPdfForShare();
      const printUrl = URL.createObjectURL(pdfFile);

      doc.autoPrint();
      printPdfUrl(printUrl);
    } catch (err: any) {
      console.error('Print error:', err);
      showNotification({ message: `Print failed: ${err.message || err}`, type: 'error' });
    }
  };

  const handleShareReceiptPdf = async () => {
    if (!lastSale) return;

    try {
      const { pdfFile } = await prepareReceiptPdfForShare();

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          const canShareFiles = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [pdfFile] });
          if (canShareFiles) {
            await navigator.share({ files: [pdfFile] });
            showNotification({ message: 'Invoice PDF ready to send via WhatsApp or any app.', type: 'success' });
            return;
          }
        } catch (shareErr) {
          console.warn('Native file sharing unavailable, using download fallback:', shareErr);
        }
      }

      const downloadUrl = URL.createObjectURL(pdfFile);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = pdfFile.name || `invoice-${lastSale.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

      showNotification({ message: 'PDF downloaded. You can now attach it in WhatsApp.', type: 'success' });
    } catch (err: any) {
      console.error('PDF share error:', err);
      showNotification({ message: `PDF share failed: ${err.message || err}`, type: 'error' });
    }
  };

  const openWhatsAppShareModal = () => {
    if (!lastSale) return;
    setWhatsAppShareMode('receipt');
    setWhatsAppSharePhone(String(lastSale.customer?.phone || lastSale.customer_phone || ''));
    setShowWhatsAppShareModal(true);
  };

  const openOrderBookingModal = () => {
    if (cart.length === 0) return;
    setWhatsAppShareMode('order');
    setWhatsAppSharePhone(String(customer?.phone || customerForm.phone || ''));
    setShowWhatsAppShareModal(true);
  };

  const handleShareReceiptToWhatsApp = (targetPhone = whatsAppSharePhone) => {
    if (!lastSale) return;

    const itemLines = Array.isArray(lastSale.items)
      ? lastSale.items.map((item: any, index: number) => {
          const itemName = getInvoiceItemLabel(item, index);
          const quantity = Number(item?.quantity || 0);
          const unitPrice = Number(item?.price_at_sale || 0);
          const lineTotal = Number(item?.subtotal ?? (unitPrice * quantity)) || 0;
          return `${index + 1}. ${itemName} — ${quantity} × ${formatCurrency(unitPrice)} = ${formatCurrency(lineTotal)}`;
        })
      : [];

    const paymentBreakdownLines = Object.entries(lastSale.payment_methods || {})
      .filter(([, amount]) => Number(amount) > 0)
      .map(([method, amount]) => `${String(method).toUpperCase()}: ${formatCurrency(Number(amount) || 0)}`);

    openWhatsAppShare({
      phone: targetPhone,
      title: `${lastSale.customer?.name || 'Customer'}, here is your receipt from ${lastSale.store?.name || 'Goody POS'}.`,
      lines: [
        `Invoice: #${lastSale.id}`,
        `Date: ${lastSale.timestamp ? new Date(lastSale.timestamp).toLocaleString() : '—'}`,
        `Cashier: ${lastSale.user_username || user?.username || 'Store Staff'}`,
        '',
        'Items:',
        ...itemLines,
        '',
        'Payment Breakdown:',
        ...(paymentBreakdownLines.length ? paymentBreakdownLines : ['No payment breakdown available']),
        '',
        `Subtotal: ${formatCurrency(Number(lastSale.show_discount_on_invoice === false ? lastSale.total : (lastSale.subtotal ?? lastSale.total ?? 0)) || 0)}`,
        ...(Number(lastSale.discount_amount || 0) > 0 && lastSale.show_discount_on_invoice !== false
          ? [`Discount${lastSale.discount_note ? ` (${lastSale.discount_note})` : ''}: -${formatCurrency(Number(lastSale.discount_amount || 0))}`]
          : []),
        `Tax: ${formatCurrency(Number(lastSale.tax_amount || 0))}`,
        `Total: ${formatCurrency(Number(lastSale.total || 0))}`,
      ],
    });

    setShowWhatsAppShareModal(false);
  };

  const handleShareOrderBookingToWhatsApp = (targetPhone = whatsAppSharePhone) => {
    if (cart.length === 0) return;

    const customerName = customer?.name || customerForm.name || 'Customer';
    const customerPhone = customer?.phone || customerForm.phone || '';
    const customerAddress = customer?.address || customerForm.address || '';

    const itemLines = cart.map((item, index) => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.price_at_sale || item.price || 0);
      const lineTotal = quantity * unitPrice;
      const detailBits = [item.selectedCondition, item.imei_serial ? `S/N ${item.imei_serial}` : ''].filter(Boolean).join(' • ');
      return `${index + 1}. ${item.name}${detailBits ? ` (${detailBits})` : ''} — ${quantity} × ${formatCurrency(unitPrice)} = ${formatCurrency(lineTotal)}`;
    });

    openWhatsAppShare({
      phone: targetPhone,
      title: `${customerName}, here is your order booking from ${store?.name || 'Goody POS'}.`,
      lines: [
        `Prepared by: ${user?.username || 'Store Staff'}`,
        `Date: ${new Date().toLocaleString()}`,
        customerPhone ? `Phone: ${customerPhone}` : '',
        customerAddress ? `Address: ${customerAddress}` : '',
        '',
        'Requested Items:',
        ...itemLines,
        '',
        `Subtotal: ${formatCurrency(showDiscountOnInvoice ? subtotal : total)}`,
        ...(discountAmount > 0 && showDiscountOnInvoice ? [`Discount${discountNote.trim() ? ` (${discountNote.trim()})` : ''}: -${formatCurrency(discountAmount)}`] : []),
        `Tax: ${formatCurrency(taxAmount)}`,
        `Total: ${formatCurrency(total)}`,
        '',
        'Reply on WhatsApp to confirm this order or request any changes.',
      ],
    });

    setShowWhatsAppShareModal(false);
    showNotification({ message: 'Order booking opened in WhatsApp.', type: 'success' });
  };

  const hasAvailableStock = (product: Product) => {
    if (store?.mode === 'GADGET' && product.condition_matrix && !product.is_consignment && !product.is_sourced) {
      return ['new', 'open_box', 'used'].some((key) => Number(product.condition_matrix?.[key]?.stock || 0) > 0);
    }

    return Number(product.stock || 0) > 0;
  };

  const matchProductByCode = (catalog: Product[], rawCode: string) => {
    const normalizedCode = String(rawCode || '').trim().toLowerCase();
    if (!normalizedCode) return null;

    return catalog.find((product) =>
      hasAvailableStock(product)
      && [product.barcode, product.quick_code, product.imei_serial].some(
        (value) => String(value || '').trim().toLowerCase() === normalizedCode
      )
    ) || null;
  };

  const getPreferredScannerCondition = (product: Product): 'NEW' | 'OPEN_BOX' | 'USED' | null => {
    if (String(store?.mode || product.mode || '').toUpperCase() !== 'GADGET' || !product.condition_matrix) {
      return null;
    }

    const conditionOrder = [
      { key: 'new', label: 'NEW' as const },
      { key: 'open_box', label: 'OPEN_BOX' as const },
      { key: 'used', label: 'USED' as const },
    ];

    const nextCondition = conditionOrder.find(({ key }) => Number(product.condition_matrix?.[key]?.stock || 0) > 0);
    return nextCondition?.label || null;
  };

  const addMatchedProductFromScanner = (product: Product) => {
    const preferredCondition = getPreferredScannerCondition(product);
    if (preferredCondition) {
      void addToCart(product, preferredCondition);
      return;
    }

    void addToCart(product);
  };

  const handleScannedCode = async (rawCode: string) => {
    const scannedCode = String(rawCode || '').trim();
    if (scannedCode.length < USB_SCANNER_MIN_LENGTH) {
      return;
    }

    const exactMatch = matchProductByCode(products, scannedCode);
    if (exactMatch) {
      addMatchedProductFromScanner(exactMatch);
      showNotification({ message: `Added ${exactMatch.name} from barcode scan`, type: 'success' });
      return;
    }

    try {
      const query = new URLSearchParams({
        search: scannedCode,
        limit: '20',
      });
      const data = await appFetch(`/api/pos/search-items?${query.toString()}`);
      const remoteProducts = (Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : [])).map((item: any) => normalizePosProduct(item));
      const remoteMatch = matchProductByCode(remoteProducts, scannedCode);

      if (remoteMatch) {
        setProducts(remoteProducts);
        setProductTotal(Array.isArray(data) ? remoteProducts.length : Number(data?.total || remoteProducts.length));
        addMatchedProductFromScanner(remoteMatch);
        showNotification({ message: `Added ${remoteMatch.name} from barcode scan`, type: 'success' });
        return;
      }

      // No match found — show the remote results so staff can pick manually
      setProducts(remoteProducts);
      setProductTotal(Array.isArray(data) ? remoteProducts.length : Number(data?.total || remoteProducts.length));
    } catch (error) {
      console.warn('Barcode lookup fallback failed:', error);
    }

    setSearch(scannedCode);
    showNotification({ message: `Scanned ${scannedCode}. Review the search results below.`, type: 'warning' });
  };

  const filteredProducts = useMemo(() => {
    return products.filter((p) =>
      hasAvailableStock(p) && (
        !deferredSearch ||
        p.name.toLowerCase().includes(deferredSearch) ||
        p.barcode?.toLowerCase().includes(deferredSearch) ||
        p.quick_code?.toLowerCase().includes(deferredSearch)
      )
    );
  }, [products, deferredSearch, store?.mode]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadProducts(deferredSearch);
    }, deferredSearch ? 120 : 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [deferredSearch]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, POS_MAX_VISIBLE_PRODUCTS),
    [filteredProducts]
  );
  const cartItemCount = useMemo(
    () => cart.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)), 0),
    [cart]
  );
  const hasSearchQuery = search.trim().length > 0;

  const quickCash = (amount: number) => {
    setPaymentMethods((prev) => ({ ...prev, cash: prev.cash + amount }));
  };

  useEffect(() => {
    const resetScannerBuffer = () => {
      scannerBufferRef.current = '';
      if (scannerResetTimerRef.current !== null) {
        window.clearTimeout(scannerResetTimerRef.current);
        scannerResetTimerRef.current = null;
      }
    };

    const scheduleScannerReset = () => {
      if (scannerResetTimerRef.current !== null) {
        window.clearTimeout(scannerResetTimerRef.current);
      }
      scannerResetTimerRef.current = window.setTimeout(() => {
        scannerBufferRef.current = '';
        scannerResetTimerRef.current = null;
      }, USB_SCANNER_IDLE_RESET_MS);
    };

    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingField = Boolean(
        target && (
          target instanceof HTMLInputElement
          || target instanceof HTMLTextAreaElement
          || target instanceof HTMLSelectElement
          || target.isContentEditable
        )
      );
      const key = event.key.toLowerCase();

      if (key === 'escape') {
        const hasOpenPanel = showWhatsAppShareModal || showReceipt || showCheckout || showSourcedItemModal || showHoldModal || showParkedSales || showProformaModal || showCustomerModal;
        if (hasOpenPanel) {
          event.preventDefault();
          setShowWhatsAppShareModal(false);
          setShowReceipt(false);
          setShowCheckout(false);
          setShowSourcedItemModal(false);
          setShowHoldModal(false);
          setShowParkedSales(false);
          setShowProformaModal(false);
          setShowCustomerModal(false);
          window.setTimeout(() => focusSearchInput(), 0);
        }
        resetScannerBuffer();
        return;
      }

      if (!isTypingField && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const now = Date.now();
        const isRapidKey = now - scannerLastKeyAtRef.current <= USB_SCANNER_RAPID_KEY_MS;

        if (event.key === 'Enter') {
          const scannedValue = scannerBufferRef.current.trim();
          if (scannedValue.length >= USB_SCANNER_MIN_LENGTH) {
            event.preventDefault();
            resetScannerBuffer();
            void handleScannedCode(scannedValue);
            return;
          }
          resetScannerBuffer();
        } else if (event.key === 'Backspace') {
          resetScannerBuffer();
        } else if (event.key.length === 1 && !/\s/.test(event.key)) {
          if (!isRapidKey) {
            scannerBufferRef.current = '';
          }
          scannerBufferRef.current += event.key;
          scannerLastKeyAtRef.current = now;
          scheduleScannerReset();
        }
      }

      if (isTypingField) {
        return;
      }

      if (key === '/' || ((event.metaKey || event.ctrlKey) && key === 'k')) {
        event.preventDefault();
        resetScannerBuffer();
        focusSearchInput();
        return;
      }

      if (key === 'f2') {
        event.preventDefault();
        if (showCheckout) {
          setShowCheckout(false);
        } else if (cart.length > 0) {
          setShowCheckout(true);
        } else {
          showNotification({ message: 'Add item(s) to the cart before opening checkout.', type: 'warning' });
        }
        return;
      }

      if (key === 'f4') {
        event.preventDefault();
        setShowParkedSales((prev) => !prev);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === 'h') {
        event.preventDefault();
        if (cart.length > 0) {
          setShowHoldModal(true);
        } else {
          showNotification({ message: 'Add item(s) to the cart before holding the sale.', type: 'warning' });
        }
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
      if (scannerResetTimerRef.current !== null) {
        window.clearTimeout(scannerResetTimerRef.current);
        scannerResetTimerRef.current = null;
      }
    };
  }, [cart.length, showCheckout, showCustomerModal, showHoldModal, showParkedSales, showProformaModal, showReceipt, showSourcedItemModal, showWhatsAppShareModal, showNotification]);

  if (loading) return <div className="flex h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,#dbeafe_0%,#e2e8f0_45%,#cbd5e1_100%)] text-slate-100"><Loader2 className="animate-spin text-slate-300" /></div>;

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe_0%,#e2e8f0_34%,#cbd5e1_100%)] text-slate-100 lg:h-screen lg:flex-row">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-16 top-0 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute right-0 top-8 h-64 w-64 rounded-full bg-indigo-400/15 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-slate-900/10 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.18] [background-image:radial-gradient(circle,rgba(15,23,42,0.14)_1px,transparent_1.6px)] [background-size:22px_22px]" />
      </div>

      {/* Left Side: Product Selection */}
      <div className="flex min-h-[55vh] flex-1 flex-col border-b border-slate-200 lg:min-h-0 lg:border-b-0 lg:border-r lg:border-slate-200">
        <header className="flex flex-col gap-3 border-b border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur-sm sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3 max-w-xl">
            <div className="relative flex flex-1 items-center gap-2 min-w-0">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Search size={20} /></span>
              <input
                ref={searchRef}
                type="text"
                placeholder={store.mode === 'SUPERMARKET' ? "Search product / scan barcode / quick code" : "Search item / scan barcode / quick code"}
                className="w-full rounded-xl border-2 border-slate-900 bg-white py-3 pl-10 pr-12 text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();

                  const trimmed = search.trim();
                  if (trimmed.length >= USB_SCANNER_MIN_LENGTH) {
                    void handleScannedCode(trimmed);
                    return;
                  }

                  if (filteredProducts.length === 1) {
                    void addToCart(filteredProducts[0]);
                  }
                }}
              />
              {hasSearchQuery && (
                <button
                  type="button"
                  onClick={clearProductSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-300"
                  aria-label="Clear product search"
                  title="Clear search"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="ml-0 flex flex-wrap items-center gap-2 sm:gap-3 lg:ml-4 lg:justify-end">
            <div className="text-right">
              <p className="text-sm font-bold">{store.name}</p>
              <p className="text-xs text-slate-400 uppercase tracking-widest">{store.mode === 'SUPERMARKET' ? 'SUPERMARKET MODE' : 'SMART RETAIL MODE'}</p>
            </div>
            <button 
              onClick={() => setShowParkedSales(true)} 
              className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900" 
              title="Parked Sales (F4)"
            >
              <Clock size={20} />
              {holds.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center">
                  {holds.length}
                </span>
              )}
            </button>
            <button onClick={() => navigate('/')} className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900" title="Home">
              <Home size={20} />
            </button>
            <button onClick={() => window.history.back()} className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900" title="Close">
              <X size={20} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-bold shadow-sm">
              {productsLoading ? 'Refreshing products…' : `${productTotal} match${productTotal === 1 ? '' : 'es'}`}
            </span>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 font-bold text-sky-700 shadow-sm">
              `/` Search
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-bold shadow-sm">
              `F2` Checkout
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-bold shadow-sm">
              `F4` Holds
            </span>
            {cartItemCount > 0 && (
              <span className="rounded-full border border-emerald-200 bg-emerald-900/20 px-3 py-1 font-bold text-emerald-400 shadow-sm">
                {cartItemCount} unit{cartItemCount === 1 ? '' : 's'} in cart
              </span>
            )}
            {productTotal > POS_MAX_VISIBLE_PRODUCTS && (
              <span className="rounded-full border border-amber-300 bg-amber-900/20 px-3 py-1 font-bold text-amber-400">
                Showing first {POS_MAX_VISIBLE_PRODUCTS}; refine search for faster browsing.
              </span>
            )}
          </div>

          {visibleProducts.length === 0 ? (
            <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-300 bg-white/80 px-6 py-10 text-center shadow-sm">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <Package size={26} />
              </div>
              <h3 className="mt-4 text-lg font-black text-slate-900">No matching products</h3>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                Try another barcode, quick code, or product name. You can also clear the search and browse the live catalog again.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {hasSearchQuery && (
                  <button
                    type="button"
                    onClick={clearProductSearch}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-300 transition-colors hover:bg-slate-50"
                  >
                    Clear Search
                  </button>
                )}
                <button
                  type="button"
                  onClick={focusSearchInput}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800"
                >
                  Focus Search
                </button>
              </div>
            </div>
          ) : store.mode === 'SUPERMARKET' ? (
            <div className="space-y-2">
              {/* Numpad — always visible in supermarket mode */}
              <div className="mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                <p className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-slate-400">Numpad</p>
                <div className="grid grid-cols-6 gap-1">
                  {['1','2','3','4','5','6','7','8','9','00','0','⌫'].map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (key === '⌫') {
                          setSearch(prev => prev.slice(0, -1));
                        } else {
                          setSearch(prev => prev + key);
                        }
                        focusSearchInput();
                      }}
                      className={`flex items-center justify-center rounded-lg py-2 text-sm font-black transition-colors ${
                        key === '⌫'
                          ? 'bg-red-50 text-red-500 hover:bg-red-100'
                          : 'bg-slate-50 text-slate-900 hover:bg-slate-100 active:bg-slate-200'
                      }`}
                    >
                      {key === '⌫' ? <Delete size={14} /> : key}
                    </button>
                  ))}
                </div>
              </div>
              {visibleProducts.map(p => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="group flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 shadow-sm transition-all duration-150 hover:border-red-300 hover:bg-red-50 hover:shadow-md active:scale-[0.99]"
                >
                  <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-slate-100 bg-slate-100">
                    {p.thumbnail ? (
                      <img src={p.thumbnail} alt={p.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                    ) : (
                      <Package className="h-full w-full p-3 text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-base font-black leading-tight text-slate-900 truncate">{p.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {p.is_consignment && (
                        <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-[2px] text-[9px] font-black tracking-widest text-amber-400">CONSIGNMENT</span>
                      )}
                      {p.quick_code && (
                        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-[2px] text-[9px] font-black tracking-widest text-sky-600">QC {p.quick_code}</span>
                      )}
                      <span className="font-mono text-[10px] text-slate-400">{p.barcode || '—'}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-black text-red-500">{formatCurrency(p.price)}</p>
                    <span className={`inline-block rounded-lg px-2 py-0.5 text-[10px] font-black ${
                      p.stock === 0 ? 'bg-slate-100 text-slate-400' :
                      p.stock < 5 ? 'bg-red-100 text-red-600 animate-pulse' :
                      'bg-emerald-900/20 text-emerald-400'
                    }`}>
                      {p.stock === 0 ? 'Out of stock' : `${p.stock} in stock`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visibleProducts.map(p => {
                // Determine card accent from condition availability
                const hasNew = Number(p.condition_matrix?.new?.stock || 0) > 0;
                const hasOpenBox = Number(p.condition_matrix?.open_box?.stock || 0) > 0;
                const hasUsed = Number(p.condition_matrix?.used?.stock || 0) > 0;
                const totalStock = p.condition_matrix
                  ? (Number(p.condition_matrix?.new?.stock || 0) + Number(p.condition_matrix?.open_box?.stock || 0) + Number(p.condition_matrix?.used?.stock || 0))
                  : Math.max(0, Number(p.is_consignment ? p.consignment_quantity : p.stock) || 0);
                const isLowStock = totalStock > 0 && totalStock <= 3;
                const accentColor = hasNew ? 'bg-emerald-900/200' : hasOpenBox ? 'bg-amber-900/200' : hasUsed ? 'bg-rose-900/200' : 'bg-slate-400';
                const condBadgeColors: Record<string, string> = {
                  NEW: 'bg-emerald-100 text-emerald-300 border-emerald-400',
                  OPEN_BOX: 'bg-amber-100 text-amber-300 border-amber-400',
                  USED: 'bg-rose-100 text-rose-300 border-rose-400',
                };
                const condHoverColors: Record<string, string> = {
                  NEW: 'hover:border-emerald-500 hover:bg-emerald-900/20',
                  OPEN_BOX: 'hover:border-amber-500 hover:bg-amber-900/20',
                  USED: 'hover:border-rose-500 hover:bg-rose-900/20',
                };
                const condPriceColors: Record<string, string> = {
                  NEW: 'text-emerald-600',
                  OPEN_BOX: 'text-amber-600',
                  USED: 'text-rose-500',
                };

                return (
                  <div key={p.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg">
                    {/* Accent strip */}
                    <div className={`h-1.5 w-full ${accentColor} transition-all duration-200`} />

                    <div className="relative h-36 bg-slate-100">
                      {p.thumbnail ? (
                        <img src={p.thumbnail} alt={p.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" decoding="async" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-slate-300">
                          <Package size={44} />
                        </div>
                      )}
                      {/* Stock badge top-right */}
                      <div className={`absolute right-2 top-2 rounded-lg px-2 py-1 text-[9px] font-black uppercase tracking-widest backdrop-blur ${isLowStock ? 'bg-red-500 text-white' : totalStock === 0 ? 'bg-slate-700 text-white' : 'bg-white/90 border border-slate-200 text-slate-600'}`}>
                        {totalStock === 0 ? 'Out' : isLowStock ? `Low · ${totalStock}` : `Qty ${totalStock}`}
                      </div>
                      {p.is_consignment && (
                        <div className="absolute left-2 top-2 rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-widest text-amber-400">
                          Consignment
                        </div>
                      )}
                    </div>

                    <div className="p-3 flex-1 flex flex-col gap-3">
                      {/* Name block */}
                      <div className="rounded-xl bg-slate-900 px-3 py-2.5">
                        <h3 className="font-bold text-white leading-snug">{p.name}</h3>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {p.quick_code && (
                            <span className="rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-[9px] font-black tracking-[0.24em] text-sky-200">
                              QC {p.quick_code}
                            </span>
                          )}
                          {p.is_consignment && p.internal_condition && (
                            <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[9px] font-black tracking-widest text-white/80">
                              {(() => {
                                const ic = String(p.internal_condition).toLowerCase();
                                if (ic.includes('new')) return 'NEW';
                                if (ic.includes('open')) return 'OPEN BOX';
                                return 'USED';
                              })()}
                            </span>
                          )}
                          {Object.entries(p.specs || {})
                            .filter(([key, val]) => !String(key).startsWith('__') && ['string', 'number', 'boolean'].includes(typeof val))
                            .slice(0, 3)
                            .map(([key, val]) => (
                              <span key={key} className="rounded bg-white/10 px-2 py-0.5 text-[9px] uppercase text-slate-300">
                                {String(val)}
                              </span>
                            ))}
                        </div>
                      </div>

                      {/* Condition / add-to-cart buttons */}
                      <div className="mt-auto space-y-1.5">
                        {(() => {
                          const matrixButtons = ['NEW', 'OPEN_BOX', 'USED'].map((cond) => {
                            const matrix = p.condition_matrix?.[cond.toLowerCase().replace(' ', '_')];
                            if (!matrix || Number(matrix.stock || 0) <= 0) return null;
                            const stock = Number(matrix.stock || 0);
                            return (
                              <button
                                key={cond}
                                onClick={() => addToCart(p, cond as any)}
                                className={`group/btn flex w-full items-center justify-between rounded-xl border-2 border-slate-900 bg-slate-50 px-3 py-2 transition-all duration-150 ${condHoverColors[cond] ?? 'hover:border-red-500 hover:bg-red-50'}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black tracking-widest ${condBadgeColors[cond] ?? 'bg-slate-100 text-slate-600 border-slate-300'}`}>
                                    {cond.replace('_', ' ')}
                                  </span>
                                  <span className={`text-[10px] font-semibold ${stock <= 3 ? 'text-red-500 animate-pulse' : 'text-slate-400'}`}>
                                    {stock <= 3 ? `Only ${stock} left` : `${stock} in stock`}
                                  </span>
                                </div>
                                <span className={`text-base font-black ${condPriceColors[cond] ?? 'text-red-500'}`}>
                                  {formatCurrency(Number(matrix.price || 0) || 0)}
                                </span>
                              </button>
                            );
                          }).filter(Boolean);

                          if (matrixButtons.length > 0) return matrixButtons;

                          const stock = Math.max(0, Number(p.is_consignment ? p.consignment_quantity : p.stock) || 0);
                          const condLabel = p.is_consignment && p.internal_condition
                            ? (() => {
                                const ic = String(p.internal_condition).toLowerCase();
                                if (ic.includes('new')) return 'NEW';
                                if (ic.includes('open')) return 'OPEN BOX';
                                if (ic.includes('used') || ic.includes('pre') || ic.includes('refurb')) return 'USED';
                                return p.internal_condition.toUpperCase();
                              })()
                            : null;
                          return (
                            <button
                              type="button"
                              onClick={() => addToCart(p)}
                              className="group/btn flex w-full items-center justify-between rounded-xl border-2 border-slate-900 bg-slate-50 px-3 py-2 transition-all duration-150 hover:border-emerald-500 hover:bg-emerald-900/20"
                            >
                              <div className="flex items-center gap-2">
                                {condLabel && (
                                  <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[9px] font-black tracking-widest text-slate-600">
                                    {condLabel}
                                  </span>
                                )}
                                <span className={`text-[10px] font-semibold ${stock <= 3 ? 'text-red-500 animate-pulse' : 'text-slate-400'}`}>
                                  {stock <= 3 ? `Only ${stock} left` : `${stock} in stock`}
                                </span>
                              </div>
                              <span className="text-base font-black text-emerald-600">
                                {formatCurrency(Number(p.price || 0) || 0)}
                              </span>
                            </button>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Side: Cart & Checkout */}
      <div className="flex w-full flex-col border-t border-slate-200 bg-white lg:min-h-0 lg:w-[380px] lg:max-w-[380px] lg:border-l lg:border-t-0 lg:border-slate-200 xl:w-[400px] xl:max-w-[400px]">
        <header className="border-b border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="text-red-500" size={18} />
              <span className="font-black text-slate-900">Current Cart</span>
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-black text-white">{cart.length}</span>
            </div>
            {cart.length > 0 && (
              <button type="button" onClick={() => setCart([])} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600">
                Clear
              </button>
            )}
          </div>
          {cart.length > 0 && (
            <div className="mt-2 flex items-end justify-between">
              <p className="text-xs text-slate-400">{cartItemCount} unit{cartItemCount === 1 ? '' : 's'} · {cart.length} line{cart.length === 1 ? '' : 's'}</p>
              <p className={`font-black text-[#ff4d5a] ${getSidebarTotalTextClass(total)}`}>{formatCheckoutCurrency(total)}</p>
            </div>
          )}
        </header>

        <div className="max-h-[45vh] flex-1 space-y-4 overflow-auto p-4 lg:max-h-none">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-slate-400">
              <div className="rounded-full bg-slate-100 p-5 text-slate-500">
                <ShoppingCart size={42} />
              </div>
              <div>
                <p className="text-base font-bold text-slate-300">Cart is empty</p>
                <p className="mt-1 text-sm text-slate-500">Scan a barcode, type a quick code, or tap a product to begin this sale.</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-bold">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">`/` Search</span>
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">`F4` Holds</span>
              </div>
            </div>
          ) : (
            cart.map((item, index) => {
              const conditionColor =
                item.selectedCondition === 'new' ? 'bg-emerald-900/200 text-white' :
                item.selectedCondition === 'open_box' ? 'bg-amber-900/200 text-white' :
                item.selectedCondition === 'used' ? 'bg-rose-900/200 text-white' : null;

              return (
              <div key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-sm">
                {/* top accent strip */}
                <div className={`h-1 w-full ${item.selectedCondition === 'new' ? 'bg-emerald-900/200' : item.selectedCondition === 'open_box' ? 'bg-amber-900/200' : item.selectedCondition === 'used' ? 'bg-rose-900/200' : 'bg-slate-300'}`} />

                <div className="p-3 space-y-2.5">
                  {/* header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      {/* line number badge */}
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold leading-snug">{item.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {conditionColor && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${conditionColor}`}>
                              {item.selectedCondition === 'open_box' ? 'Open Box' : item.selectedCondition}
                            </span>
                          )}
                          {item.is_consignment && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-400">
                              Consignment
                            </span>
                          )}
                          {item.is_sourced && (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-purple-700">
                              Sourced
                            </span>
                          )}
                        </div>
                        {item.imei_serial && (
                          <p className="mt-1 font-mono text-[10px] text-slate-400">S/N: {item.imei_serial}</p>
                        )}
                        {item.is_sourced && (
                          <p className="mt-0.5 text-[10px] text-amber-400">
                            {item.sourced_vendor_name || 'Unknown'}{item.sourced_vendor_phone ? ` · ${item.sourced_vendor_phone}` : ''} · Debt: {formatCurrency(Number(item.sourced_cost_price || 0))}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.is_sourced && (
                        <button onClick={() => openSourcedItemEditor(item)} className="rounded-lg p-2.5 min-w-[40px] min-h-[40px] text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900" aria-label={`Edit sourced item ${item.name}`}>
                          <Edit2 size={14} />
                        </button>
                      )}
                      <button onClick={() => removeFromCart(index)} className="rounded-lg p-2.5 min-w-[40px] min-h-[40px] text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500" aria-label={`Remove ${item.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* qty + price row */}
                  <div className="flex items-center justify-between gap-2">
                    {/* quantity stepper */}
                    <div className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 p-1">
                      <button
                        onClick={() => updateQuantity(index, -1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-300 shadow-sm transition-colors hover:bg-slate-900 hover:text-white active:scale-95"
                        aria-label={`Decrease quantity for ${item.name}`}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={item.quantity}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => {
                          const digitsOnly = e.target.value.replace(/\D/g, '');
                          if (!digitsOnly) return;
                          setCartItemQuantity(index, Number(digitsOnly));
                        }}
                        onBlur={(e) => {
                          const digitsOnly = e.target.value.replace(/\D/g, '');
                          setCartItemQuantity(index, Number(digitsOnly || '1'), true);
                        }}
                        className="w-10 bg-transparent text-center text-sm font-black text-slate-900 focus:outline-none"
                        aria-label={`Quantity for ${item.name}`}
                      />
                      <button
                        onClick={() => updateQuantity(index, 1)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-slate-300 shadow-sm transition-colors hover:bg-slate-900 hover:text-white active:scale-95"
                        aria-label={`Increase quantity for ${item.name}`}
                      >
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* price + line total */}
                    <div className="flex flex-col items-end gap-0.5">
                      {store.mode === 'SUPERMARKET' ? (
                        <span className="text-xs font-bold text-slate-400">{formatCheckoutCurrency(item.price_at_sale)} ea</span>
                      ) : priceEditIndex === index ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          autoFocus
                          value={priceEditBuffer[index] ?? item.price_at_sale.toLocaleString('en-NG')}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/,/g, '').replace(/[^0-9.]/g, '');
                            const parts = raw.split('.');
                            const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                            const formatted = parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
                            setPriceEditBuffer((prev) => ({ ...prev, [index]: formatted }));
                          }}
                          onBlur={() => {
                            const raw = (priceEditBuffer[index] ?? String(item.price_at_sale)).replace(/,/g, '');
                            updateCartItemPrice(index, raw);
                            setPriceEditIndex(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const raw = (priceEditBuffer[index] ?? String(item.price_at_sale)).replace(/,/g, '');
                              updateCartItemPrice(index, raw);
                              setPriceEditIndex(null);
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                            if (e.key === 'Escape') setPriceEditIndex(null);
                          }}
                          className={`w-28 rounded-lg border px-2 py-1 text-right text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-300 ${item.price_at_sale > item.base_price_at_sale ? 'border-emerald-300 bg-emerald-900/20 text-emerald-300' : 'border-slate-200 bg-white text-slate-900'}`}
                          aria-label={`Unit price for ${item.name}`}
                        />
                      ) : (
                        <button
                          onClick={() => {
                            const formatted = item.price_at_sale.toLocaleString('en-NG');
                            setPriceEditBuffer((prev) => ({ ...prev, [index]: formatted }));
                            setPriceEditIndex(index);
                          }}
                          className={`group flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold transition-colors hover:border-emerald-300 hover:bg-emerald-900/20 ${item.price_at_sale > item.base_price_at_sale ? 'border-emerald-200 bg-emerald-900/20 text-emerald-300' : 'border-slate-200 bg-slate-50 text-slate-500'}`}
                          title="Click to edit price"
                          aria-label={`Edit unit price for ${item.name}`}
                        >
                          <Edit2 size={10} className="opacity-40 group-hover:opacity-80" />
                          <span>{formatCheckoutCurrency(item.price_at_sale)} ea</span>
                        </button>
                      )}
                      <p className={`font-black tracking-[-0.03em] text-slate-900 ${getCartLineAmountTextClass(item.price_at_sale * item.quantity)}`}>
                        {formatCheckoutCurrency(item.price_at_sale * item.quantity)}
                      </p>
                      {item.price_at_sale > item.base_price_at_sale && (
                        <p className="text-[10px] font-bold text-emerald-600">
                          +{formatCheckoutCurrency((item.price_at_sale - item.base_price_at_sale) * item.quantity)} profit
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              );
            })
          )}
        </div>

        <div className="space-y-4 border-t border-slate-200 bg-slate-50 p-4 sm:p-6">
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-600">
              {cartItemCount} unit{cartItemCount === 1 ? '' : 's'}
            </span>
            <span className={`rounded-full px-3 py-1 ${customer ? 'border border-emerald-200 bg-emerald-900/20 text-emerald-400' : 'border border-slate-200 bg-white text-slate-600'}`}>
              {customer ? `Customer: ${customer.name}` : 'Walk-in sale'}
            </span>
            {requiresCheckoutPin && (
              <span className={`rounded-full px-3 py-1 ${checkoutPinConfirmed ? 'border border-emerald-200 bg-emerald-900/20 text-emerald-400' : 'border border-amber-200 bg-amber-900/20 text-amber-400'}`}>
                {checkoutPinConfirmed ? 'PIN confirmed' : 'PIN needed'}
              </span>
            )}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between items-center text-slate-400">
              <span>Subtotal</span>
              <span>{formatCurrency(customerVisibleSubtotal)}</span>
            </div>
            {discountAmount > 0 && showDiscountOnInvoice && (
              <div className="flex justify-between items-center text-emerald-400">
                <span>Discount{discountNote.trim() ? ` • ${discountNote.trim()}` : ''}</span>
                <span>-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            {taxRate > 0 && (
              <div className="flex justify-between items-center text-slate-400">
                <span>Tax ({taxRate}%)</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-end justify-between gap-2 font-black">
            <span className="text-xl sm:text-2xl">Total</span>
            <span className={`text-right text-[#ff4d5a] ${getSidebarTotalTextClass(total)}`}>{formatCheckoutCurrency(total)}</span>
          </div>
          
          <div className="flex flex-col gap-2">
            {/* More actions overflow */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowMoreMenu(v => !v); }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100"
              >
                <MoreHorizontal size={18} /> More Actions
              </button>
              {showMoreMenu && (
                <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
                  <button
                    type="button"
                    onClick={() => { setShowMoreMenu(false); setShowSourcedItemModal(true); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-amber-400 transition-colors hover:bg-amber-900/20"
                  >
                    <Plus size={16} /> Add Sourced Item
                  </button>
                  <button
                    disabled={cart.length === 0}
                    onClick={() => { setShowMoreMenu(false); setShowProformaModal(true); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-indigo-400 transition-colors hover:bg-indigo-900/20 disabled:opacity-40"
                  >
                    <FileText size={16} /> Generate Pro-forma
                  </button>
                  <button
                    disabled={cart.length === 0}
                    onClick={() => { setShowMoreMenu(false); openOrderBookingModal(); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold text-emerald-400 transition-colors hover:bg-emerald-900/20 disabled:opacity-40"
                  >
                    <MessageCircle size={16} /> Book Order on WhatsApp
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                disabled={cart.length === 0}
                onClick={() => setShowHoldModal(true)}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 py-4 text-base font-black text-white shadow-sm transition-all hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save size={18} /> Hold
              </button>
              <button
                disabled={cart.length === 0}
                onClick={() => setShowCheckout(true)}
                className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-red-500 py-4 text-lg font-black text-white shadow-lg shadow-red-500/25 transition-all hover:from-rose-500 hover:to-red-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CreditCard size={20} /> Pay Now
              </button>
            </div>
          </div>
        </div>
      </div>

      {showSourcedItemModal && (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-amber-400">Quick Collect</p>
                <h2 className="text-xl font-black text-slate-900">{editingSourcedItemId ? 'Edit Sourced Item' : 'Add Sourced Item'}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowSourcedItemModal(false);
                  setEditingSourcedItemId(null);
                }}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-300"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Item Name</label>
                <input
                  type="text"
                  value={sourcedItemForm.name}
                  onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="e.g. iPhone 13 Pro"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">S/N</label>
                <input
                  type="text"
                  value={sourcedItemForm.imei_serial}
                  onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, imei_serial: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="Optional"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">{`Vendor Cost (${quickCashSymbol})`}</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={sourcedItemForm.vendor_cost_price}
                    onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, vendor_cost_price: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="1000000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Selling Price</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={sourcedItemForm.selling_price}
                    onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, selling_price: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    placeholder="1050000"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Vendor Name</label>
                <input
                  type="text"
                  value={sourcedItemForm.vendor_name}
                  onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, vendor_name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="e.g. Jude"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Shop Address (Optional)</label>
                <input
                  type="text"
                  value={sourcedItemForm.vendor_address}
                  onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, vendor_address: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="e.g. Block C7, New York"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Vendor Phone (Optional)</label>
                <input
                  type="text"
                  value={sourcedItemForm.vendor_phone}
                  onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, vendor_phone: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="e.g. +1 202 555 0123"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Vendor Reference (Optional)</label>
                <input
                  type="text"
                  value={sourcedItemForm.vendor_reference}
                  onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, vendor_reference: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="Any extra detail"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Product Specs (Visible On Invoice)</label>
                <textarea
                  value={sourcedItemForm.product_specs}
                  onChange={(e) => setSourcedItemForm((prev) => ({ ...prev, product_specs: e.target.value }))}
                  className="min-h-[84px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  placeholder="e.g. Color: Sierra Blue, 256GB, Battery Health 88%, Face ID working"
                />
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowSourcedItemModal(false);
                  setEditingSourcedItemId(null);
                }}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddSourcedItem}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
              >
                {editingSourcedItemId ? 'Save Changes' : 'Add to Cart'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Quick Add Modal */}
      {showCustomerModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[110]">
          <div className="bg-white max-w-md w-full rounded-2xl p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-900">Quick Add Customer</h2>
              <button onClick={() => setShowCustomerModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleQuickAddCustomer} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Full Name</label>
                <input 
                  required
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={customerForm.name}
                  onChange={e => setCustomerForm({...customerForm, name: e.target.value})}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Phone Number</label>
                <input 
                  required
                  type="tel"
                  inputMode="numeric"
                  maxLength={15}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={customerForm.phone}
                  onChange={e => setCustomerForm({ ...customerForm, phone: normalizeCustomerPhoneInput(e.target.value) })}
                  placeholder="e.g. 08012345678"
                />
                <p className={`mt-1 text-xs ${customerPhoneNeedsMoreDigits ? 'text-amber-600' : 'text-slate-500'}`}>
                  Use 7-15 digits. `+` is allowed for international numbers.
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Address (Optional)</label>
                <textarea 
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={customerForm.address}
                  onChange={e => setCustomerForm({...customerForm, address: e.target.value})}
                  placeholder="e.g. 123 Street Name, City"
                  rows={3}
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowCustomerModal(false)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={savingCustomer}
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2"
                >
                  {savingCustomer ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                  Add & Attach
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Hold Sale Modal */}
      {showHoldModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-xl">
          <div className="w-full max-w-md rounded-[32px] border border-slate-700 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-8 text-white shadow-2xl shadow-slate-950/60">
            <header className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-white">Hold Sale</h2>
                <p className="mt-1 text-sm text-slate-300">Save this cart and return to it later without losing the items.</p>
              </div>
              <button
                onClick={() => setShowHoldModal(false)}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X />
              </button>
            </header>
            <form onSubmit={handleHoldSale} className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-700">Customer Name (Optional)</label>
                <input 
                  type="text"
                  className="w-full rounded-xl border border-slate-600 bg-slate-800/95 px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  value={holdForm.customer_name}
                  onChange={e => setHoldForm({...holdForm, customer_name: e.target.value})}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-700">Note (Optional)</label>
                <textarea 
                  className="h-24 w-full resize-none rounded-xl border border-slate-600 bg-slate-800/95 px-4 py-3 text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                  value={holdForm.note}
                  onChange={e => setHoldForm({...holdForm, note: e.target.value})}
                  placeholder="Add a note about this hold..."
                />
              </div>
              <button
                type="submit"
                disabled={savingHold}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-600 py-4 font-bold text-white shadow-lg shadow-red-600/20 transition-colors hover:bg-red-700 disabled:opacity-60"
              >
                {savingHold ? <Loader2 className="animate-spin" /> : <Save size={20} />}
                Confirm Hold
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Parked Sales Modal */}
      {showParkedSales && (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl flex items-center justify-center p-4 z-[80]">
          <div className="bg-slate-900 max-w-2xl w-full rounded-[32px] p-8 border border-slate-800 shadow-2xl max-h-[80vh] flex flex-col text-white">
            <header className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-2xl font-black text-white">Parked Sales</h2>
                <p className="text-slate-300 text-sm">Resume or manage held transactions</p>
              </div>
              <button onClick={() => setShowParkedSales(false)} className="text-slate-300 hover:text-white"><X /></button>
            </header>
            
            <div className="flex-1 overflow-auto space-y-4 pr-2">
              {holds.length === 0 ? (
                <div className="text-center py-12 text-slate-300">
                  <Clock size={48} className="mx-auto mb-4 opacity-30" />
                  <p>No parked sales found</p>
                </div>
              ) : (
                holds.map(hold => (
                  <div key={hold.id} className="bg-slate-800/50 border border-slate-700 p-6 rounded-2xl flex items-center justify-between hover:bg-slate-800 transition-colors group">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg text-white">{hold.customer_name || 'Unnamed Customer'}</h3>
                        <span className="text-[10px] bg-slate-700 text-slate-200 px-2 py-0.5 rounded font-bold uppercase tracking-widest">
                          {hold.cart_data.length} Items
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-300">
                        <span className="flex items-center gap-1"><History size={12} /> {new Date(hold.timestamp).toLocaleString()}</span>
                        <span className="flex items-center gap-1"><User size={12} /> {hold.staff_name}</span>
                      </div>
                      {hold.note && <p className="text-sm text-slate-200 italic mt-2">"{hold.note}"</p>}
                    </div>
                    <button 
                      onClick={() => resumeHold(hold)}
                      className="bg-red-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/10 group-hover:scale-105"
                    >
                      Resume
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {showCheckout && (
        <div
          ref={checkoutModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/60 p-3 backdrop-blur-sm focus:outline-none sm:p-4"
        >
          <div className="mx-auto flex min-h-full items-start justify-center">
            <div className="my-2 w-full max-w-5xl overflow-visible rounded-3xl border border-white/10 bg-white shadow-[0_32px_96px_rgba(15,23,42,0.28)] lg:my-6 lg:grid lg:h-[92vh] lg:max-h-[92vh] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:overflow-hidden 2xl:max-w-6xl">

              {/* ── Left: Form panel ── */}
              <div className="min-w-0 bg-slate-950 p-5 text-white sm:p-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:p-7">

                {/* Header */}
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">Point of Sale</p>
                    <h2 className="text-2xl font-black text-white">Checkout</h2>
                  </div>
                  <button
                    onClick={() => { setCheckoutPin(''); setCheckoutPinConfirmed(false); setConfirmedCheckoutActor(null); setShowCheckout(false); }}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>

                <div className="space-y-3">

                  {/* ── Section 1: Customer ── */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-500/15">
                          <User size={12} className="text-sky-400" />
                        </div>
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Customer</span>
                      </div>
                      {customer && (
                        <button onClick={() => setCustomer(null)} className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors">
                          Detach
                        </button>
                      )}
                    </div>

                    {customer ? (
                      <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/60 p-3">
                        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-sky-500/20 font-black text-sky-300 text-base">
                          {customer.name[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="font-black text-white truncate">{customer.name}</p>
                            <span className="shrink-0 rounded-md bg-slate-700 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">#{customer.customer_code}</span>
                          </div>
                          <p className="text-xs text-slate-500">{customer.phone}</p>
                        </div>
                        <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <select
                          defaultValue=""
                          onChange={(e) => { if (e.target.value) handleSelectCustomer(e.target.value); }}
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                        >
                          <option value="">Choose from {savedCustomers.length} saved customer{savedCustomers.length === 1 ? '' : 's'}</option>
                          {savedCustomers.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.name}{entry.phone ? ` • ${entry.phone}` : ''}</option>
                          ))}
                        </select>

                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                              type="tel"
                              pattern="\d*"
                              maxLength={15}
                              placeholder="Search by phone…"
                              className="w-full rounded-xl border border-slate-700 bg-slate-800 py-2.5 pl-8 pr-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                              value={customerSearch}
                              onChange={(e) => {
                                const digits = (e.target.value.match(/\d/g) || []).join('').slice(0, 15);
                                setCustomerSearch(digits);
                                setCustomerSearchStatus('idle');
                                setSearchResultCustomer(null);
                                handlePhoneSuggestions(digits);
                              }}
                              onKeyDown={(e) => e.key === 'Enter' && customerSearch.length >= 7 && handleCustomerSearch()}
                              onFocus={() => customerSearch.length >= 5 && setShowPhoneSuggestions(true)}
                            />
                            {showPhoneSuggestions && Array.isArray(phoneSuggestions) && phoneSuggestions.length > 0 && (
                              <div className="absolute top-full left-0 right-0 mt-1 z-50 max-h-40 overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 shadow-xl">
                                {phoneSuggestions.map(suggestion => (
                                  <button key={suggestion.id} type="button"
                                    onClick={() => { setCustomerSearch(suggestion.phone); setShowPhoneSuggestions(false); setTimeout(() => handleCustomerSearch(suggestion.phone), 50); }}
                                    className="w-full border-b border-slate-700 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-700 transition-colors"
                                  >
                                    <div className="font-semibold text-white">{suggestion.phone}</div>
                                    <div className="text-xs text-slate-400">{suggestion.name}</div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => { if (customerSearch.length >= 7) handleCustomerSearch(); }}
                            disabled={searchingCustomer || customerSearch.length < 7}
                            className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40 transition-colors"
                          >
                            {searchingCustomer ? <Loader2 size={14} className="animate-spin" /> : 'Find'}
                          </button>
                          <button
                            onClick={() => { setShowInlineCustomerForm(true); setCustomerForm({ phone: customerSearch, name: '', address: '' }); }}
                            className="rounded-xl bg-sky-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-sky-500 transition-colors"
                          >
                            + Add
                          </button>
                        </div>
                      </div>
                    )}

                    {store?.mode === 'GADGET' && !customer && (
                      <p className="mt-2.5 flex items-center gap-1.5 text-xs font-bold text-amber-400">
                        <AlertCircle size={12} /> Required for Smart Retail Mode
                      </p>
                    )}

                    {showInlineCustomerForm && (
                      <div className="mt-3 space-y-3 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
                        <p className="text-xs font-bold text-slate-400">New customer — <span className="text-sky-400">{customerForm.phone || 'enter phone below'}</span></p>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">Phone *</label>
                          <input type="tel" inputMode="numeric" maxLength={15} placeholder="08012345678"
                            value={customerForm.phone}
                            onChange={e => setCustomerForm({ ...customerForm, phone: normalizeCustomerPhoneInput(e.target.value) })}
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                          <p className={`mt-1 text-[11px] ${customerPhoneNeedsMoreDigits ? 'text-amber-400' : 'text-slate-600'}`}>7–15 digits. + allowed for international.</p>
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">Full Name *</label>
                          <input type="text" autoFocus placeholder="John Doe"
                            value={customerForm.name}
                            onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })}
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">Address (optional)</label>
                          <input type="text" placeholder="123 Street, City"
                            value={customerForm.address}
                            onChange={e => setCustomerForm({ ...customerForm, address: e.target.value })}
                            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500"
                          />
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button type="button"
                            onClick={() => { setShowInlineCustomerForm(false); setCustomerSearchStatus('idle'); }}
                            className="flex-1 rounded-xl border border-slate-700 py-2.5 text-sm font-bold text-slate-400 hover:bg-slate-700 transition-colors"
                          >Cancel</button>
                          <button type="button"
                            disabled={!String(customerForm.name || '').trim() || !isValidCustomerPhone(customerForm.phone) || savingCustomer}
                            onClick={async () => {
                              if (!String(customerForm.name || '').trim() || !isValidCustomerPhone(customerForm.phone)) {
                                showNotification({ message: 'Name and a valid phone number with 7-15 digits are required', type: 'warning' });
                                return;
                              }
                              setSavingCustomer(true);
                              try {
                                const result = await appFetch('/api/customers', { method: 'POST', body: JSON.stringify({ ...customerForm, name: String(customerForm.name || '').trim(), phone: normalizeCustomerPhoneInput(customerForm.phone), address: String(customerForm.address || '').trim() }) });
                                attachCustomer(result);
                                await loadCustomers();
                                setShowInlineCustomerForm(false);
                                showNotification({ message: `Customer ${result.name} created successfully!`, type: 'success' });
                              } catch (err: any) {
                                showNotification({ message: String(err), type: 'error' });
                              } finally {
                                setSavingCustomer(false);
                              }
                            }}
                            className="flex-1 rounded-xl bg-sky-600 py-2.5 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >{savingCustomer ? 'Creating…' : 'Create & Link'}</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── PIN disabled notice ── */}
                  {store?.mode === 'GADGET' && !requiresCheckoutPin && (
                    <div className="rounded-2xl border border-sky-800/40 bg-sky-900/20 px-4 py-3">
                      <p className="text-[11px] font-black uppercase tracking-widest text-sky-400">PIN approval off</p>
                      <p className="mt-0.5 text-xs text-sky-300/70">Checkout PIN is disabled for this store. Sales will proceed under the logged-in user.</p>
                    </div>
                  )}

                  {/* ── Section 2: Discount ── */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-900/200/15">
                          <Percent size={12} className="text-emerald-400" />
                        </div>
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Discount & Promo</span>
                      </div>
                      {discountAmount > 0 && (
                        <span className="rounded-lg bg-emerald-900/200/15 px-2.5 py-1 text-xs font-black text-emerald-400">
                          −{formatCurrency(discountAmount)}
                        </span>
                      )}
                    </div>

                    {/* Quick presets */}
                    <div className="mb-3 flex gap-1.5">
                      {[5, 10, 15].map((v) => (
                        <button key={v} type="button" onClick={() => applyDiscountPreset(v)}
                          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 py-1.5 text-[11px] font-black text-emerald-400 hover:border-emerald-600 hover:bg-emerald-900/20 transition-colors"
                        >{v}% Off</button>
                      ))}
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">Type</label>
                        <select value={discountType}
                          onChange={(e) => { setDiscountType(e.target.value as 'NONE' | 'PERCENTAGE' | 'FIXED'); setAppliedDiscountCode(null); }}
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <option value="NONE">No discount</option>
                          <option value="PERCENTAGE">Percentage (%)</option>
                          <option value="FIXED">Fixed amount</option>
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">
                          {discountType === 'PERCENTAGE' ? 'Percentage' : 'Amount'}
                        </label>
                        <input type="number" min={0} max={discountType === 'PERCENTAGE' ? 100 : undefined} step="0.01"
                          value={discountValue}
                          onChange={(e) => { setDiscountValue(e.target.value); setAppliedDiscountCode(null); }}
                          disabled={discountType === 'NONE'}
                          placeholder={discountType === 'PERCENTAGE' ? '10' : '0.00'}
                          className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40"
                        />
                      </div>
                    </div>

                    {discountType !== 'NONE' && (
                      <div className="mt-2.5 space-y-2.5">
                        {/* Discount code */}
                        <div className="flex gap-2">
                          <input aria-label="Discount Code" type="text"
                            value={discountCodeInput}
                            onChange={(e) => setDiscountCodeInput(e.target.value.toUpperCase().replace(/\s+/g, ''))}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleApplyDiscountCode(); } }}
                            placeholder="Store code e.g. WELCOME10"
                            className="flex-1 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 font-mono text-sm uppercase tracking-wide text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <button type="button" onClick={handleApplyDiscountCode}
                            className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-900/200 transition-colors"
                          >Apply</button>
                        </div>

                        {/* Invoice visibility */}
                        <div className="flex gap-2">
                          {[{ val: true, label: 'Show on invoice' }, { val: false, label: 'Hide on invoice' }].map(({ val, label }) => (
                            <label key={String(val)} className={`flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${showDiscountOnInvoice === val ? 'border-emerald-600 bg-emerald-900/20 text-emerald-300' : 'border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                              <input type="radio" name="show-discount-on-invoice" checked={showDiscountOnInvoice === val} onChange={() => setShowDiscountOnInvoice(val)} className="accent-emerald-500" />
                              {label}
                            </label>
                          ))}
                        </div>

                        <button type="button" onClick={clearDiscount}
                          className="w-full rounded-xl border border-slate-700 py-2 text-xs font-bold text-slate-400 hover:border-red-700/50 hover:text-red-400 transition-colors"
                        >Clear Discount</button>
                      </div>
                    )}
                  </div>

                  {/* ── Section 3: Payment ── */}
                  <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/15">
                        <CreditCard size={12} className="text-violet-400" />
                      </div>
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">Payment</span>
                    </div>

                    <div className="space-y-2">
                      {/* Cash */}
                      <div className="rounded-xl border-l-2 border-l-emerald-500 border-y border-r border-slate-800 bg-slate-800/50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Banknote size={14} className="text-emerald-400" />
                            <span className="text-sm font-bold text-white">Cash</span>
                          </div>
                          {remainingBalance > 0 && (
                            <button onClick={() => setPaymentMethods({...paymentMethods, cash: paymentMethods.cash + remainingBalance})}
                              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white hover:bg-emerald-900/200 transition-colors shadow-lg shadow-emerald-900/40"
                            >Fill {formatCurrency(remainingBalance)}</button>
                          )}
                        </div>
                        <input type="number"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-lg font-black text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          value={paymentMethods.cash || ''}
                          onChange={(e) => setPaymentMethods({...paymentMethods, cash: e.target.value === '' ? 0 : Number(e.target.value)})}
                          placeholder="0.00"
                        />
                        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                          {[200, 500, 1000, 5000].map(amt => (
                            <button key={amt} type="button" onClick={() => quickCash(amt)}
                              className="shrink-0 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-black text-slate-300 hover:border-emerald-700 hover:text-emerald-300 transition-colors"
                            >+{amt >= 1000 ? `${quickCashSymbol}${amt / 1000}k` : formatCurrency(amt)}</button>
                          ))}
                        </div>
                      </div>

                      {/* Bank Transfer */}
                      <div className="rounded-xl border-l-2 border-l-blue-500 border-y border-r border-slate-800 bg-slate-800/50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ArrowRightLeft size={14} className="text-blue-400" />
                            <span className="text-sm font-bold text-white">Bank Transfer</span>
                          </div>
                          {remainingBalance > 0 && (
                            <button onClick={() => setPaymentMethods({...paymentMethods, transfer: paymentMethods.transfer + remainingBalance})}
                              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white hover:bg-blue-900/200 transition-colors shadow-lg shadow-blue-900/40"
                            >Fill {formatCurrency(remainingBalance)}</button>
                          )}
                        </div>
                        <input type="number"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-lg font-black text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={paymentMethods.transfer || ''}
                          onChange={(e) => setPaymentMethods({...paymentMethods, transfer: e.target.value === '' ? 0 : Number(e.target.value)})}
                          placeholder="0.00"
                        />
                      </div>

                      {/* POS Terminal */}
                      <div className="rounded-xl border-l-2 border-l-purple-500 border-y border-r border-slate-800 bg-slate-800/50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <CreditCard size={14} className="text-purple-400" />
                            <span className="text-sm font-bold text-white">POS Terminal</span>
                          </div>
                          {remainingBalance > 0 && (
                            <button onClick={() => setPaymentMethods({...paymentMethods, pos: paymentMethods.pos + remainingBalance})}
                              className="rounded-xl bg-purple-600 px-4 py-2 text-sm font-black text-white hover:bg-purple-900/200 transition-colors shadow-lg shadow-purple-900/40"
                            >Fill {formatCurrency(remainingBalance)}</button>
                          )}
                        </div>
                        <input type="number"
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-lg font-black text-white placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                          value={paymentMethods.pos || ''}
                          onChange={(e) => setPaymentMethods({...paymentMethods, pos: e.target.value === '' ? 0 : Number(e.target.value)})}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* ── Section 4: Pending options ── */}
                  {(hasOutstandingBalance || allowPayLater || isPendingTransfer) && (
                    <div className="rounded-2xl border border-amber-700/30 bg-amber-900/10 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-900/200/15">
                            <Clock size={12} className="text-amber-400" />
                          </div>
                          <span className="text-[11px] font-black uppercase tracking-widest text-amber-400/80">Pending Options</span>
                        </div>
                        <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-black text-amber-400">
                          Due: {formatCurrency(remainingBalance)}
                        </span>
                      </div>

                      <div className="mb-3 grid gap-2 sm:grid-cols-2">
                        <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${allowPayLater ? 'border-amber-600/50 bg-amber-900/20' : 'border-slate-700 bg-slate-800/50 hover:border-amber-700/40'}`}>
                          <input type="checkbox" checked={allowPayLater} onChange={(e) => setAllowPayLater(e.target.checked)} className="mt-0.5 accent-amber-500" />
                          <span>
                            <span className="block text-sm font-bold text-white">Pay Later / Debt</span>
                            <span className="text-xs text-slate-400">Save with outstanding balance.</span>
                          </span>
                        </label>
                        <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${isPendingTransfer ? 'border-sky-600/50 bg-sky-900/20' : 'border-slate-700 bg-slate-800/50 hover:border-sky-700/40'}`}>
                          <input type="checkbox" checked={isPendingTransfer} onChange={(e) => setIsPendingTransfer(e.target.checked)} className="mt-0.5 accent-blue-500" />
                          <span>
                            <span className="block text-sm font-bold text-white">Pending Transfer</span>
                            <span className="text-xs text-slate-400">Bank alert not landed yet.</span>
                          </span>
                        </label>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">Due Date</label>
                          <input type="date" value={saleDueDate} onChange={(e) => setSaleDueDate(e.target.value)}
                            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-slate-500">Debt Note</label>
                          <input type="text" value={saleNote} onChange={(e) => setSaleNote(e.target.value)} placeholder="Optional follow-up note"
                            className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                      </div>
                      {hasOutstandingBalance && !customer && (
                        <p className="mt-2.5 text-xs font-bold text-amber-500">Attach a customer to track and remind the debt via WhatsApp.</p>
                      )}
                    </div>
                  )}

                </div>
              </div>

              {/* ── Right: Summary & Actions ── */}
              <div className="flex min-w-0 flex-col border-t border-slate-100 bg-white p-5 sm:p-6 lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:border-l lg:border-t-0">

                {/* Total */}
                <div className="mb-5 rounded-2xl bg-slate-950 p-5 text-center">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Total Payable</p>
                  <p className={`min-w-0 break-words font-black leading-[0.9] tracking-[-0.04em] text-white ${totalAmountClass}`}>{totalDisplay}</p>
                </div>

                {/* Breakdown */}
                <div className="mb-5 space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Subtotal</span>
                    <span className="font-bold text-slate-700">{formatCheckoutCurrency(subtotal)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex items-center justify-between text-emerald-700">
                      <span>Discount</span>
                      <span className="font-bold">−{formatCheckoutCurrency(discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Tax ({taxRate}%)</span>
                    <span className="font-bold text-slate-700">{formatCheckoutCurrency(taxAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
                    <span className="font-bold text-slate-600">Total Paid</span>
                    <span className="font-black text-slate-900">{formatCheckoutCurrency(totalPaid)}</span>
                  </div>
                </div>

                {/* Change / Outstanding */}
                <div className={`mb-5 rounded-2xl border px-4 py-3 text-center ${balance > 0 ? 'border-emerald-200 bg-emerald-900/20' : balance < 0 ? 'border-[#fda4af] bg-[#fff1f2]' : 'border-slate-200 bg-slate-50'}`}>
                  <p className={`mb-0.5 text-[10px] font-black uppercase tracking-[0.25em] ${balance > 0 ? 'text-emerald-600' : balance < 0 ? 'text-[#ef4444]' : 'text-slate-400'}`}>
                    {balance > 0 ? 'Change to Return' : balance < 0 ? 'Outstanding' : 'Balanced'}
                  </p>
                  <p className={`min-w-0 break-words font-black leading-[0.9] tracking-[-0.04em] ${balance > 0 ? 'text-emerald-600 animate-pulse' : balance < 0 ? 'text-[#ef4444]' : 'text-slate-400'} ${balanceAmountClass}`}>
                    {balance !== 0 ? balanceDisplay : formatCheckoutCurrency(0)}
                  </p>
                </div>

                <div className="mt-auto space-y-3">
                  {/* PIN */}
                  {store?.mode === 'GADGET' && requiresCheckoutPin && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">PIN Confirmation</p>
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${checkoutPinConfirmed ? 'bg-emerald-100 text-emerald-400' : isCheckoutPinValid ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-400'}`}>
                          {checkoutPinConfirmed ? 'Confirmed' : isCheckoutPinValid ? 'Ready' : 'Required'}
                        </span>
                      </div>
                      <p className="mb-3 text-xs text-slate-500">Enter any Store Owner, Manager, or Staff PIN to approve.</p>
                      <div className="flex gap-2">
                        <input type="password" inputMode="numeric" maxLength={6}
                          value={checkoutPin}
                          onChange={(e) => { setCheckoutPin((e.target.value.match(/\d/g) || []).join('').slice(0, 6)); setCheckoutPinConfirmed(false); setConfirmedCheckoutActor(null); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleConfirmCheckoutPin(); } }}
                          placeholder="4–6 digit PIN"
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <button type="button"
                          onClick={() => void handleConfirmCheckoutPin()}
                          disabled={!isCheckoutPinValid || confirmingCheckoutPin}
                          className={`rounded-xl px-4 py-2.5 text-sm font-black transition-colors ${!isCheckoutPinValid || confirmingCheckoutPin ? 'cursor-not-allowed bg-slate-100 text-slate-400' : checkoutPinConfirmed ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                        >{confirmingCheckoutPin ? '…' : checkoutPinConfirmed ? 'Confirmed ✓' : 'Confirm'}</button>
                      </div>
                      {checkoutPinConfirmed && (
                        <p className="mt-2 text-[11px] text-emerald-600">
                          Approved by {confirmedCheckoutActor?.username || 'staff'}{confirmedCheckoutActor?.role ? ` (${confirmedCheckoutActor.role})` : ''}.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Complete Sale */}
                  <button
                    disabled={!canCheckout}
                    onClick={handleCheckout}
                    className={`flex w-full items-center justify-center gap-2 rounded-2xl py-4 text-base font-black shadow-lg transition-all active:scale-[0.98] ${
                      canCheckout
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-600/30'
                        : 'cursor-not-allowed bg-slate-100 text-slate-400'
                    }`}
                  >
                    <CheckCircle2 size={20} />
                    {store?.mode === 'GADGET' && !customer
                      ? 'Attach Customer First'
                      : requiresCheckoutPin && !checkoutPinConfirmed
                        ? 'Confirm PIN First'
                        : hasOutstandingBalance && allowPayLater
                          ? `Save Debt: ${formatCurrency(remainingBalance)}`
                          : hasOutstandingBalance && isPendingTransfer
                            ? `Record Pending: ${formatCurrency(remainingBalance)}`
                            : totalPaid < total
                              ? `Outstanding: ${formatCurrency(total - totalPaid)}`
                              : 'Complete Sale'}
                  </button>

                  {checkoutGuidanceMessage && (
                    <p className="rounded-xl border border-amber-200 bg-amber-900/20 px-3 py-2.5 text-center text-xs font-semibold text-amber-300">
                      {checkoutGuidanceMessage}
                    </p>
                  )}

                  <button
                    onClick={() => { setCheckoutPin(''); setCheckoutPinConfirmed(false); setConfirmedCheckoutActor(null); setShowCheckout(false); }}
                    className="w-full rounded-2xl border border-slate-200 py-2.5 text-sm font-bold text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
                  >
                    Back to Terminal
                  </button>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
      {/* Receipt Modal */}
      {showReceipt && lastSale && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-[100]">
          <div className={`invoice-light-preview bg-white text-black shadow-2xl ${isA4Paper ? 'w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl p-8 font-sans' : 'w-[80mm] rounded-sm p-6 font-mono text-sm receipt-container printable'}`}>
            {isA4Paper ? (
              <>
                <div className="flex items-start justify-between border-b border-slate-200 pb-5 mb-6">
                  <div className="space-y-2">
                    {lastSale.store.logo && (
                      <img src={lastSale.store.logo} alt="Logo" className="max-h-16 w-auto max-w-[10rem] object-contain" referrerPolicy="no-referrer" />
                    )}
                    {shouldShowStoreNameOnReceipt && (
                      <h2 className="text-2xl font-black text-slate-900">{lastSale.store.name}</h2>
                    )}
                    <p className="text-sm text-slate-600">{lastSale.store.address}</p>
                    <p className="text-sm text-slate-600">{lastSale.store.phone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-black text-slate-800">Invoice {String(lastSale.id).padStart(6, '0')}</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Tax Invoice</p>
                    <p className="mt-3 text-sm text-slate-600">Issue: {new Date(lastSale.timestamp).toLocaleDateString()}</p>
                    <p className="text-sm text-slate-600">Reference: {String(lastSale.id).padStart(6, '0')}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Bill To</p>
                    <p className="text-lg font-bold text-slate-900">{lastSale.customer?.name || 'Walk-in Customer'}</p>
                    <p className="text-sm text-slate-600">{lastSale.customer?.phone || 'Phone not provided'}</p>
                    <p className="text-sm text-slate-600 whitespace-pre-line">{lastSale.customer?.address || 'Address not provided'}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg px-4 py-3 text-white" style={{ backgroundColor: documentColor }}>
                      <p className="text-[11px] font-bold uppercase">Invoice No.</p>
                      <p className="text-lg font-black">{String(lastSale.id).padStart(6, '0')}</p>
                    </div>
                    <div className="rounded-lg px-4 py-3 text-white" style={{ backgroundColor: documentColor }}>
                      <p className="text-[11px] font-bold uppercase">Issue Date</p>
                      <p className="text-lg font-black">{new Date(lastSale.timestamp).toLocaleDateString()}</p>
                    </div>
                    <div className="rounded-lg px-4 py-3 text-white" style={{ backgroundColor: documentColor }}>
                      <p className="text-[11px] font-bold uppercase">Due Date</p>
                      <p className="text-lg font-black">{new Date(lastSale.timestamp).toLocaleDateString()}</p>
                    </div>
                    <div className="rounded-lg bg-slate-800 px-4 py-3 text-white">
                      <p className="text-[11px] font-bold uppercase">Total Due</p>
                      <p className="text-lg font-black">{formatCurrency(lastSale.total)}</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 mb-6">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold">Description</th>
                        <th className="px-4 py-3 text-center font-bold">Qty</th>
                        <th className="px-4 py-3 text-right font-bold">Unit Price</th>
                        <th className="px-4 py-3 text-right font-bold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lastSale.items.map((item: any, idx: number) => (
                        <tr key={idx} className="border-t border-slate-200 align-top">
                          <td className="px-4 py-3">
                            <p className="font-bold text-slate-900">{getInvoiceItemLabel(item, idx)}</p>
                            {lastSale.store.mode === 'GADGET' && getReceiptItemDetailLine(item) && (
                              <div className="mt-1 text-xs text-slate-500 space-y-0.5">
                                <p>{getReceiptItemDetailLine(item)}</p>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">{item.quantity}</td>
                          <td className="px-4 py-3 text-right">{formatCurrency(item.price_at_sale)}</td>
                          <td className="px-4 py-3 text-right font-semibold">{formatCurrency(item.price_at_sale * item.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex flex-col md:flex-row gap-6 justify-between">
                  <div className="space-y-3 text-sm text-slate-600">
                    <div>
                      <p className="font-bold text-slate-800">Terms & Conditions</p>
                      <p>Please retain this invoice for warranty support and store records.</p>
                    </div>
                  </div>

                  <div className="md:w-72 ml-auto space-y-2 text-sm">
                    <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(lastSale.show_discount_on_invoice === false ? lastSale.total : (lastSale.subtotal ?? lastSale.total))}</span></div>
                    {Number(lastSale.discount_amount || 0) > 0 && lastSale.show_discount_on_invoice !== false && (
                      <div className="flex justify-between text-emerald-400"><span>Discount</span><span>-{formatCurrency(lastSale.discount_amount ?? 0)}</span></div>
                    )}
                    <div className="flex justify-between"><span>Tax ({lastSale.tax_percentage ?? 0}%)</span><span>{formatCurrency(lastSale.tax_amount ?? 0)}</span></div>
                    <div className="border-t border-slate-300 pt-2 flex justify-between text-lg font-black text-slate-900">
                      <span>Total</span><span>{formatCurrency(lastSale.total)}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="text-center border-b border-dashed border-black pb-4 mb-4">
                  {lastSale.store.logo && (
                    <img src={lastSale.store.logo} alt="Logo" className="mx-auto mb-2 max-h-16 w-auto max-w-[10rem] object-contain" referrerPolicy="no-referrer" />
                  )}
                  {shouldShowStoreNameOnReceipt && (
                    <h2 className="text-xl font-black uppercase tracking-tighter">{lastSale.store.name}</h2>
                  )}
                  <p className="text-[10px] leading-tight">{lastSale.store.address}</p>
                  <p className="text-[10px]">{lastSale.store.phone}</p>
                </div>

                <div className="flex justify-between text-[10px] mb-4">
                  <span>ID: #{lastSale.id}</span>
                  <span>{new Date(lastSale.timestamp).toLocaleString()}</span>
                </div>

                <div className="space-y-4 mb-6">
                  <div className="grid grid-cols-4 border-b border-black pb-1 text-[10px] font-bold">
                    <span className="col-span-2">ITEM</span>
                    <span className="text-center">QTY</span>
                    <span className="text-right">PRICE</span>
                  </div>
                  {lastSale.items.map((item: any, idx: number) => (
                    <div key={idx} className="space-y-1">
                      <div className="grid grid-cols-4 text-[11px] leading-tight">
                        <span className="col-span-2 font-bold uppercase">{getInvoiceItemLabel(item, idx)}</span>
                        <span className="text-center">x{item.quantity}</span>
                        <span className="text-right">{formatCurrency(item.price_at_sale)}</span>
                      </div>
                      {lastSale.store.mode === 'GADGET' && getReceiptItemDetailLine(item) && (
                        <div className="text-[9px] text-gray-600 pl-2 border-l border-gray-200">
                          <p>{getReceiptItemDetailLine(item)}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="border-t border-dashed border-black pt-4 space-y-1 mb-6">
                  <div className="flex justify-between text-[10px]">
                    <span>SUBTOTAL</span>
                    <span>{formatCurrency(lastSale.show_discount_on_invoice === false ? lastSale.total : (lastSale.subtotal ?? lastSale.total))}</span>
                  </div>
                  {Number(lastSale.discount_amount || 0) > 0 && lastSale.show_discount_on_invoice !== false && (
                    <div className="flex justify-between text-[10px]">
                      <span>DISCOUNT</span>
                      <span>-{formatCurrency(lastSale.discount_amount ?? 0)}</span>
                    </div>
                  )}
                  {Number(lastSale.tax_amount || 0) > 0 && (
                    <div className="flex justify-between text-[10px]">
                      <span>TAX</span>
                      <span>{formatCurrency(lastSale.tax_amount ?? 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-lg">
                    <span>TOTAL</span>
                    <span>{formatCurrency(lastSale.total)}</span>
                  </div>
                  <div className="text-[10px] space-y-0.5">
                    {Object.entries(lastSale.payment_methods).map(([method, amount]: any) => (amount as number) > 0 && (
                      <div key={method} className="flex justify-between">
                        <span className="uppercase">{method}</span>
                        <span>{formatCurrency(amount as number)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-center text-[10px] space-y-1 italic">
                  <p>Thank you for your business!</p>
                  <p>Returns are subject to store review and policy.</p>
                  <p className="font-bold not-italic mt-4 border-t border-black pt-2 text-[10px]">Powered by Goody Technology</p>
                </div>
              </>
            )}

            <div className="mt-8 grid gap-2 no-print sm:grid-cols-2 xl:grid-cols-4">
              <button 
                onClick={handlePrintReceipt}
                className="rounded-xl bg-slate-900 py-3 font-bold text-white flex items-center justify-center gap-2"
              >
                {isA4Paper ? 'Print A4 Invoice' : 'Print Thermal Receipt'}
              </button>
              <button
                onClick={openWhatsAppShareModal}
                className="rounded-xl bg-green-600 py-3 font-bold text-white flex items-center justify-center gap-2"
              >
                <MessageCircle size={16} /> WhatsApp Text
              </button>
              <button
                onClick={handleShareReceiptPdf}
                className="rounded-xl bg-emerald-700 py-3 font-bold text-white flex items-center justify-center gap-2"
              >
                <Share2 size={16} /> WhatsApp PDF
              </button>
              <button 
                onClick={() => setShowReceipt(false)}
                className="border border-slate-200 py-3 rounded-xl font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <WhatsAppShareModal
        isOpen={showWhatsAppShareModal && (whatsAppShareMode === 'receipt' ? Boolean(lastSale) : cart.length > 0)}
        phone={whatsAppSharePhone}
        recipientName={whatsAppShareMode === 'receipt' ? (lastSale?.customer?.name || 'customer') : (customer?.name || customerForm.name || 'customer')}
        title={whatsAppShareMode === 'receipt' ? 'Share on WhatsApp' : 'Book Order on WhatsApp'}
        description={whatsAppShareMode === 'receipt'
          ? `Send this receipt to ${lastSale?.customer?.name || 'a customer'} or any other WhatsApp number.`
          : `Send this order booking to ${customer?.name || customerForm.name || 'a customer'} or any other WhatsApp number.`}
        infoText={whatsAppShareMode === 'receipt'
          ? 'The full receipt summary, item list, cashier name, payment breakdown, and PDF link will be included.'
          : 'The selected cart items, quantities, prices, and total amount will be shared as a WhatsApp order booking.'}
        buttonLabel={whatsAppShareMode === 'receipt' ? 'Share Now' : 'Send Order'}
        onPhoneChange={setWhatsAppSharePhone}
        onClose={() => setShowWhatsAppShareModal(false)}
        onShare={() => (whatsAppShareMode === 'receipt'
          ? handleShareReceiptToWhatsApp(whatsAppSharePhone)
          : handleShareOrderBookingToWhatsApp(whatsAppSharePhone))}
      />

      {/* Pro-forma Modal */}
      {showProformaModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white max-w-md w-full rounded-3xl p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-black text-slate-900">Generate Pro-forma</h2>
              <button onClick={() => setShowProformaModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                <X size={24} />
              </button>
            </div>
            
            <div className="space-y-6">
              {customer ? (
                <div className="p-4 bg-indigo-900/20 rounded-2xl border border-indigo-700/30 flex justify-between items-center">
                  <div>
                    <p className="text-sm text-indigo-400 font-medium mb-1">Customer</p>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-indigo-300">{customer.name}</p>
                      <span className="text-[10px] bg-indigo-200 text-indigo-800 px-2 py-0.5 rounded font-mono">#{customer.customer_code || 'CUSTOMER'}</span>
                    </div>
                    <p className="text-xs text-indigo-600 mt-1">{customer.phone || ''}</p>
                    {customer.address && <p className="text-xs text-indigo-600">{customer.address}</p>}
                  </div>
                  <button onClick={() => { setCustomer(null); setCustomerSearch(''); setCustomerSearchStatus('idle'); }} className="text-xs font-bold text-red-500 hover:underline">
                    Change
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-700">Select saved customer</label>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          handleSelectCustomer(e.target.value);
                        }
                      }}
                      className="w-full px-3 py-2 bg-white text-slate-900 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">Choose from {savedCustomers.length} saved customer{savedCustomers.length === 1 ? '' : 's'}</option>
                      {savedCustomers.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.name} {entry.phone ? `• ${entry.phone}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <p className="text-sm text-slate-300 font-medium">Or search by phone number</p>
                  <div className="space-y-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input 
                          type="tel"
                          pattern="\d*"
                          maxLength={15}
                          placeholder="08012345678"
                          className="w-full pl-9 pr-3 py-2 bg-white text-slate-900 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          value={customerSearch}
                          onChange={(e) => {
                            const digits = (e.target.value.match(/\d/g) || []).join('').slice(0, 15);
                            setCustomerSearch(digits);
                            setCustomerSearchStatus('idle');
                            setSearchResultCustomer(null);
                            handlePhoneSuggestions(digits);
                          }}
                          onFocus={() => customerSearch.length >= 5 && setShowPhoneSuggestions(true)}
                        />
                        {showPhoneSuggestions && Array.isArray(phoneSuggestions) && phoneSuggestions.length > 0 && (
                          <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
                            {phoneSuggestions.map(suggestion => (
                              <button
                                key={suggestion.id}
                                type="button"
                                onClick={() => {
                                  setCustomerSearch(suggestion.phone);
                                  setShowPhoneSuggestions(false);
                                  setTimeout(() => handleCustomerSearch(suggestion.phone), 50);
                                }}
                                className="w-full text-left px-3 py-2 hover:bg-indigo-900/20 border-b border-slate-100 last:border-b-0 transition-colors text-sm"
                              >
                                <div className="font-semibold text-slate-900">{suggestion.phone}</div>
                                <div className="text-xs text-slate-600">{suggestion.name}</div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={async () => {
                          if (customerSearch.length >= 7) {
                            await handleCustomerSearch(customerSearch);
                          }
                        }}
                        disabled={searchingCustomer || customerSearch.length < 7}
                        className={`px-6 py-2 rounded-xl font-bold text-sm transition-all ${customerSearch.length >= 7 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}
                      >
                        {searchingCustomer ? <Loader2 className="animate-spin inline" size={16} /> : 'Find'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowInlineCustomerForm(true);
                          setCustomerSearchStatus('idle');
                          setCustomerForm({ phone: customerSearch, name: '', address: '' });
                        }}
                        className="px-4 py-2 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-colors whitespace-nowrap"
                      >
                        Add Customer
                      </button>
                    </div>
                    {customerSearch.length > 0 && customerSearch.length < 7 && (
                      <p className="text-xs text-slate-500">Enter at least {7 - customerSearch.length} more digit{7 - customerSearch.length !== 1 ? 's' : ''}</p>
                    )}
                  </div>

                  {customerSearchStatus === 'found' && searchResultCustomer && (
                    <div className="p-3 bg-emerald-900/20 border border-emerald-200 rounded-lg flex items-center gap-2 text-emerald-400 font-semibold">
                      <CheckCircle2 size={16} />
                      <span>✓ Found: {searchResultCustomer.name}</span>
                    </div>
                  )}

                  {customerSearchStatus === 'notfound' && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg space-y-2">
                      <p className="text-sm font-semibold text-red-700">✗ Customer not found</p>
                      <button
                        type="button"
                        onClick={() => setShowInlineCustomerForm(true)}
                        className="w-full py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-colors text-sm"
                      >
                        + Register New Customer
                      </button>
                    </div>
                  )}

                  {showInlineCustomerForm && (
                    <div className="p-4 bg-white border border-indigo-200 rounded-lg space-y-3">
                      <p className="text-sm font-bold text-slate-900">Register customer for: <span className="text-indigo-600">{customerForm.phone || 'new customer'}</span></p>
                      <div>
                        <label className="block text-xs font-bold mb-1 text-slate-700">Phone Number *</label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          maxLength={15}
                          placeholder="08012345678"
                          value={customerForm.phone}
                          onChange={e => setCustomerForm({ ...customerForm, phone: normalizeCustomerPhoneInput(e.target.value) })}
                          className="w-full p-2 border border-slate-300 rounded-lg text-slate-900 bg-white placeholder-slate-400 text-sm"
                        />
                        <p className={`mt-1 text-xs ${customerPhoneNeedsMoreDigits ? 'text-amber-600' : 'text-slate-500'}`}>
                          Use 7-15 digits. `+` is allowed for international numbers.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1 text-slate-700">Full Name *</label>
                        <input
                          type="text"
                          autoFocus
                          placeholder="John Doe"
                          value={customerForm.name}
                          onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })}
                          className="w-full p-2 border border-slate-300 rounded-lg text-slate-900 bg-white placeholder-slate-400 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1 text-slate-700">Address (Optional)</label>
                        <input
                          type="text"
                          placeholder="123 Street, City"
                          value={customerForm.address}
                          onChange={e => setCustomerForm({ ...customerForm, address: e.target.value })}
                          className="w-full p-2 border border-slate-300 rounded-lg text-slate-900 bg-white placeholder-slate-400 text-sm"
                        />
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setShowInlineCustomerForm(false);
                            setCustomerSearchStatus('idle');
                          }}
                          className="flex-1 border border-slate-300 rounded-lg py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          disabled={!String(customerForm.name || '').trim() || !isValidCustomerPhone(customerForm.phone) || savingCustomer}
                          onClick={async () => {
                            if (!String(customerForm.name || '').trim() || !isValidCustomerPhone(customerForm.phone)) {
                              showNotification({ message: 'Name and a valid phone number with 7-15 digits are required', type: 'warning' });
                              return;
                            }
                            setSavingCustomer(true);
                            try {
                              const result = await appFetch('/api/customers', {
                                method: 'POST',
                                body: JSON.stringify({
                                  ...customerForm,
                                  name: String(customerForm.name || '').trim(),
                                  phone: normalizeCustomerPhoneInput(customerForm.phone),
                                  address: String(customerForm.address || '').trim(),
                                })
                              });
                              attachCustomer(result);
                              await loadCustomers();
                              setShowInlineCustomerForm(false);
                              showNotification({ message: `Customer ${result.name} created successfully!`, type: 'success' });
                            } catch (err: any) {
                              console.error('Customer creation error:', err);
                              showNotification({ message: String(err), type: 'error' });
                            } finally {
                              setSavingCustomer(false);
                            }
                          }}
                          className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {savingCustomer ? 'Creating...' : 'Create & Link'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Expiry Duration</label>
                <div className="grid grid-cols-4 gap-2">
                  {[24, 48, 168].map(hours => (
                    <button
                      key={hours}
                      onClick={() => setProformaExpiry(hours)}
                      className={`py-3 rounded-xl font-bold text-sm transition-all ${
                        proformaExpiry === hours 
                          ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' 
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {hours === 168 ? '7 Days' : `${hours}h`}
                    </button>
                  ))}
                  <button
                    onClick={() => setProformaExpiry('custom')}
                    className={`py-3 rounded-xl font-bold text-sm transition-all ${
                      proformaExpiry === 'custom'
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {proformaExpiry === 'custom' && (
                  <div className="mt-2">
                    <input 
                      type="datetime-local" 
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      value={customExpiryDate}
                      onChange={(e) => setCustomExpiryDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                    />
                  </div>
                )}
              </div>

              <div className="pt-4">
                <button
                  disabled={generatingProforma || !customer}
                  onClick={handleGenerateProforma}
                  className={`w-full py-4 text-white rounded-2xl font-bold text-lg shadow-lg transition-all flex items-center justify-center gap-2 ${
                    !customer 
                      ? 'bg-slate-300 cursor-not-allowed shadow-none' 
                      : 'bg-indigo-600 shadow-indigo-200 hover:bg-indigo-700'
                  }`}
                >
                  {generatingProforma ? <Loader2 className="animate-spin" /> : <FileText size={20} />}
                  Generate & Reserve Stock
                </button>
                {!customer && (
                  <p className="text-[10px] text-red-500 text-center mt-2 font-bold">
                    * Customer details are required for Pro-forma
                  </p>
                )}
                <p className="text-[10px] text-slate-400 text-center mt-3 uppercase tracking-widest font-bold">
                  Stock will be reserved until expiry
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default POS;

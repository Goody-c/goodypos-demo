import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Home,
  Loader2,
  MessageCircle,
  Package,
  Phone,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useNotification } from '../../context/NotificationContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';
import { formatCurrency, openWhatsAppShare } from '../../lib/utils';

const getDefaultReturnDate = () => {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return nextWeek.toISOString().split('T')[0];
};

const formatDateLabel = (value?: string | null) => {
  const rawValue = String(value || '').trim();
  if (!rawValue) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
    ? new Date(`${rawValue}T12:00:00`)
    : new Date(rawValue);
  if (Number.isNaN(date.getTime())) return rawValue;
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

const normalizeConditionKey = (value?: string | null) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const formatConditionLabel = (value?: string | null) => String(value || '').replace(/_/g, ' ') || 'Standard';

const MarketCollections: React.FC = () => {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [store, setStore] = useState<any>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [consignmentItems, setConsignmentItems] = useState<any[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'OVERDUE' | 'SOLD' | 'RETURNED'>('ALL');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedCondition, setSelectedCondition] = useState('NEW');
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [itemSearch, setItemSearch] = useState('');
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const [draftItems, setDraftItems] = useState<any[]>([]);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharePhone, setSharePhone] = useState('');
  const [shareTarget, setShareTarget] = useState<any>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [form, setForm] = useState({
    collector_name: '',
    phone: '',
    expected_return_date: getDefaultReturnDate(),
    note: '',
  });

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!itemDropdownOpen) return;
    const close = () => setItemDropdownOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [itemDropdownOpen]);

  const DEMO_COLLECTIONS = [
    {
      id: 4001, ref_code: 'MC-TH-1777119452028', tracking_code: '52028', collector_name: 'Chris Hernandez', phone: '(347) 555-0099',
      status: 'OPEN', expected_return_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      note: 'Sent with vendor for trade show display. Collect by end of week.',
      is_overdue: false, total_value: 1299, total_quantity: 1,
      items: [{ id: 1, name: 'iPhone 15 Pro Max 256GB', condition: 'NEW', quantity: 1, price_at_collection: 1299, subtotal: 1299 }],
    },
    {
      id: 4002, ref_code: 'MC-TH-1777119451100', tracking_code: '51100', collector_name: 'Daniel Brooks', phone: '(917) 555-0144',
      status: 'OPEN', expected_return_date: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      note: 'Taken for client demo at Brooklyn tech expo.',
      is_overdue: false, total_value: 2650, total_quantity: 2,
      items: [{ id: 2, name: 'MacBook Air M2 13"', condition: 'NEW', quantity: 1, price_at_collection: 1950, subtotal: 1950 }, { id: 3, name: 'AirPods Pro 2nd Gen', condition: 'NEW', quantity: 1, price_at_collection: 700, subtotal: 700 }],
    },
    {
      id: 4003, ref_code: 'MC-TH-1777119449900', tracking_code: '49900', collector_name: 'Marcus Webb', phone: '(213) 555-0177',
      status: 'OVERDUE', expected_return_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      note: 'Collector took units to West Coast distributor. No update since.',
      is_overdue: true, total_value: 3200, total_quantity: 2,
      items: [{ id: 4, name: 'Samsung Galaxy S24 Ultra', condition: 'NEW', quantity: 2, price_at_collection: 1600, subtotal: 3200 }],
    },
    {
      id: 4004, ref_code: 'MC-TH-1777119448700', tracking_code: '48700', collector_name: 'Ryan Fitzgerald', phone: '(646) 555-0122',
      status: 'OVERDUE', expected_return_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      note: 'Display units for pop-up store. Return date passed.',
      is_overdue: true, total_value: 850, total_quantity: 2,
      items: [{ id: 5, name: 'iPad Mini 6th Gen', condition: 'NEW', quantity: 1, price_at_collection: 550, subtotal: 550 }, { id: 6, name: 'Apple Pencil 2nd Gen', condition: 'NEW', quantity: 1, price_at_collection: 300, subtotal: 300 }],
    },
    {
      id: 4005, ref_code: 'MC-TH-1777119447500', tracking_code: '47500', collector_name: 'Ethan Clarke', phone: '+44 7700 900155',
      status: 'SOLD', expected_return_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      note: 'Sold at London tech fair. Payment received via bank transfer.',
      is_overdue: false, total_value: 980, total_quantity: 2,
      items: [{ id: 7, name: 'Sony WH-1000XM5', condition: 'NEW', quantity: 2, price_at_collection: 490, subtotal: 980 }],
    },
    {
      id: 4006, ref_code: 'MC-TH-1777119446300', tracking_code: '46300', collector_name: 'Luca Bianchi', phone: '+39 333 100 0006',
      status: 'RETURNED', expected_return_date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      note: 'All units returned in good condition after Milan trade show.',
      is_overdue: false, total_value: 1750, total_quantity: 6,
      items: [{ id: 8, name: 'Samsung Galaxy Tab S9', condition: 'NEW', quantity: 1, price_at_collection: 750, subtotal: 750 }, { id: 9, name: 'USB-C Hub 7-in-1', condition: '', quantity: 2, price_at_collection: 140, subtotal: 280 }, { id: 10, name: 'Wireless Charger Pad', condition: '', quantity: 3, price_at_collection: 240, subtotal: 720 }],
    },
  ];

  const loadData = async () => {
    try {
      const [storeData, productsData, consignmentData] = await Promise.all([
        appFetch('/api/store/settings'),
        appFetch('/api/products'),
        appFetch('/api/consignment-items?status=approved').catch(() => []),
      ]);
      setStore(storeData);
      setProducts(Array.isArray(productsData) ? productsData : []);
      setCollections(DEMO_COLLECTIONS);
      setConsignmentItems((Array.isArray(consignmentData) ? consignmentData : []).filter((ci: any) => Number(ci.quantity || 0) > 0));
    } catch (err: any) {
      setCollections(DEMO_COLLECTIONS);
    } finally {
      setLoading(false);
    }
  };

  const hasConditionMatrix = (product: any) =>
    product?.condition_matrix && typeof product.condition_matrix === 'object' && Object.keys(product.condition_matrix).length > 0;

  const getAvailableQuantity = (product: any, conditionValue?: string | null) => {
    if (!product) return 0;
    if (hasConditionMatrix(product)) {
      const key = normalizeConditionKey(conditionValue || selectedCondition);
      return Number(product.condition_matrix?.[key]?.stock || 0);
    }
    return Number(product.stock || 0);
  };

  const getUnitPrice = (product: any, conditionValue?: string | null) => {
    if (!product) return 0;
    if (hasConditionMatrix(product)) {
      const key = normalizeConditionKey(conditionValue || selectedCondition);
      return Number(product.condition_matrix?.[key]?.price || product.price || 0);
    }
    return Number(product.price || 0);
  };

  const selectedProduct = useMemo(
    () => products.find((product) => Number(product.id) === Number(selectedProductId)),
    [products, selectedProductId]
  );

  const selectedConsignmentItem = useMemo(
    () => String(selectedProductId).startsWith('ci-')
      ? consignmentItems.find((c) => Number(c.id) === Number(String(selectedProductId).replace('ci-', '')))
      : null,
    [consignmentItems, selectedProductId]
  );

  const selectedCiMatrix = useMemo(
    () => selectedConsignmentItem?.public_specs?.__condition_matrix || null,
    [selectedConsignmentItem]
  );

  const hasCiConditionMatrix = (ci: any) => {
    const m = ci?.public_specs?.__condition_matrix;
    return m && typeof m === 'object' && Object.keys(m).length > 0;
  };

  const filteredItemOptions = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const matchProduct = (p: any) => !q
      || String(p.name || '').toLowerCase().includes(q)
      || String(p.barcode || '').toLowerCase().includes(q)
      || String(p.quick_code || '').toLowerCase().includes(q);
    const matchCi = (ci: any) => !q
      || String(ci.item_name || '').toLowerCase().includes(q)
      || String(ci.imei_serial || '').toLowerCase().includes(q)
      || String(ci.vendor_name || '').toLowerCase().includes(q)
      || String(ci.quick_code || '').toLowerCase().includes(q);

    const productOptions = products.filter(matchProduct).map((p) => {
      const totalStock = hasConditionMatrix(p)
        ? Object.values(p.condition_matrix).reduce((s: number, v: any) => s + Number(v?.stock || 0), 0)
        : Number(p.stock || 0);
      return { id: `${p.id}`, label: p.name, sublabel: `${totalStock} avail.${p.quick_code ? ` · ${p.quick_code}` : ''}`, type: 'product' as const, raw: p };
    });

    const ciOptions = consignmentItems.filter(matchCi).map((ci) => {
      const ciM = ci?.public_specs?.__condition_matrix;
      const ciTotal = ciM && typeof ciM === 'object'
        ? Object.values(ciM).reduce((s: number, v: any) => s + Number(v?.stock || 0), 0)
        : Number(ci.quantity || 0);
      return { id: `ci-${ci.id}`, label: ci.item_name, sublabel: `${ciTotal} avail. · ${ci.vendor_name || 'Vendor'}`, type: 'consignment' as const, raw: ci };
    });

    return { products: productOptions, consignments: ciOptions };
  }, [products, consignmentItems, itemSearch, hasConditionMatrix]);

  const openCollections = useMemo(
    () => collections.filter((entry) => String(entry.status || '').toUpperCase() === 'OPEN'),
    [collections]
  );

  const summary = useMemo(() => ({
    openCount: openCollections.length,
    itemsOut: openCollections.reduce((sum, entry) => sum + (Number(entry.total_quantity) || 0), 0),
    valueOut: openCollections.reduce((sum, entry) => sum + (Number(entry.total_value) || 0), 0),
    overdueCount: openCollections.filter((entry) => entry.is_overdue).length,
  }), [openCollections]);

  const filteredCollections = useMemo(() => {
    const query = search.trim().toLowerCase();
    return collections.filter((entry) => {
      const entryStatus = String(entry.status || '').toUpperCase();
      const matchesStatus = statusFilter === 'ALL' ? true
        : statusFilter === 'OVERDUE' ? Boolean(entry.is_overdue)
        : entryStatus === statusFilter;
      const matchesSearch = !query || [
        entry.collector_name, entry.phone, entry.tracking_code,
        ...(Array.isArray(entry.items) ? entry.items.map((item: any) => item.name) : []),
      ].some((value) => String(value || '').toLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    });
  }, [collections, search, statusFilter]);

  const resetForm = () => {
    setForm({ collector_name: '', phone: '', expected_return_date: getDefaultReturnDate(), note: '' });
    setDraftItems([]);
    setSelectedProductId('');
    setSelectedCondition('NEW');
    setSelectedQuantity(1);
    setItemSearch('');
    setItemDropdownOpen(false);
  };

  const handleAddDraftItem = () => {
    if (!selectedProductId) { showNotification({ message: 'Select an item first.', type: 'warning' }); return; }
    const quantity = Math.max(1, Number(selectedQuantity) || 1);

    // Check if it's a consignment item (prefixed with "ci-")
    if (String(selectedProductId).startsWith('ci-')) {
      const ciId = Number(String(selectedProductId).replace('ci-', ''));
      const ci = consignmentItems.find((c) => Number(c.id) === ciId);
      if (!ci) { showNotification({ message: 'Consignment item not found.', type: 'warning' }); return; }
      const ciMatrix = ci?.public_specs?.__condition_matrix;
      const ciHasMatrix = ciMatrix && typeof ciMatrix === 'object' && Object.keys(ciMatrix).length > 0;
      const ciCondition = ciHasMatrix ? selectedCondition : null;
      const ciConditionKey = String(ciCondition || '').toLowerCase();
      const available = ciHasMatrix
        ? Number(ciMatrix?.[ciConditionKey]?.stock || 0)
        : Number(ci.quantity || 0);
      const unitPrice = ciHasMatrix
        ? Number(ciMatrix?.[ciConditionKey]?.price || ci.selling_price || 0)
        : Number(ci.selling_price || 0);
      if (quantity > available) { showNotification({ message: `Only ${available} unit(s) of ${ci.item_name} available.`, type: 'error' }); return; }
      setDraftItems((prev) => {
        const existingIndex = prev.findIndex((e) => Number(e.consignment_item_id) === ciId && String(e.condition || '') === String(ciCondition || ''));
        if (existingIndex >= 0) {
          const next = [...prev];
          const combinedQty = Number(next[existingIndex].quantity || 0) + quantity;
          if (combinedQty > available) { showNotification({ message: `Cannot exceed ${available} unit(s) of ${ci.item_name}.`, type: 'error' }); return prev; }
          next[existingIndex] = { ...next[existingIndex], quantity: combinedQty, subtotal: combinedQty * unitPrice };
          return next;
        }
        return [...prev, { consignment_item_id: ciId, product_id: null, name: ci.item_name, quantity, condition: ciCondition, price_at_collection: unitPrice, subtotal: quantity * unitPrice, vendor_name: ci.vendor_name || null }];
      });
    } else {
      const product = products.find((item) => Number(item.id) === Number(selectedProductId));
      if (!product) { showNotification({ message: 'Select an inventory item first.', type: 'warning' }); return; }
      const condition = hasConditionMatrix(product) ? selectedCondition : null;
      const available = getAvailableQuantity(product, condition);
      if (quantity > available) { showNotification({ message: `Only ${available} unit(s) available for ${product.name}.`, type: 'error' }); return; }
      const unitPrice = getUnitPrice(product, condition);
      setDraftItems((prev) => {
        const existingIndex = prev.findIndex((e) => Number(e.product_id) === Number(product.id) && String(e.condition || '') === String(condition || ''));
        if (existingIndex >= 0) {
          const next = [...prev];
          const combinedQty = Number(next[existingIndex].quantity || 0) + quantity;
          if (combinedQty > available) { showNotification({ message: `Cannot exceed ${available} unit(s) of ${product.name}.`, type: 'error' }); return prev; }
          next[existingIndex] = { ...next[existingIndex], quantity: combinedQty, subtotal: combinedQty * unitPrice };
          return next;
        }
        return [...prev, { product_id: Number(product.id), consignment_item_id: null, name: product.name, quantity, condition, price_at_collection: unitPrice, subtotal: quantity * unitPrice }];
      });
    }
    setSelectedProductId('');
    setSelectedQuantity(1);
  };

  const removeDraftItem = (index: number) => setDraftItems((prev) => prev.filter((_, i) => i !== index));

  const handleSaveCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.collector_name.trim()) { showNotification({ message: 'Collector name is required.', type: 'error' }); return; }
    if (!form.phone.trim()) { showNotification({ message: 'Phone number is required.', type: 'error' }); return; }
    if (!draftItems.length) { showNotification({ message: 'Add at least one product.', type: 'error' }); return; }
    setSaving(true);
    try {
      const payload = { ...form, items: draftItems.map((item) => ({ product_id: Number(item.product_id), quantity: Number(item.quantity), condition: item.condition || null })) };
      const result = await appFetch('/api/market-collections', { method: 'POST', body: JSON.stringify(payload) });
      const trackingCode = result?.collection?.tracking_code || 'saved';
      showNotification({ message: `Collection saved with ref ${trackingCode}.`, type: 'success' });
      resetForm();
      setShowFormModal(false);
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkSold = async (entry: any) => {
    setActionId(Number(entry.id));
    try {
      const result = await appFetch(`/api/market-collections/${entry.id}/mark-sold`, { method: 'POST' });
      showNotification({ message: `Collection ${entry.tracking_code} converted to sale #${result?.saleId || ''}.`, type: 'success' });
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally { setActionId(null); }
  };

  const handleReturned = async (entry: any) => {
    setActionId(Number(entry.id));
    try {
      await appFetch(`/api/market-collections/${entry.id}/return`, { method: 'POST' });
      showNotification({ message: `Collection ${entry.tracking_code} returned to inventory.`, type: 'success' });
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally { setActionId(null); }
  };

  const buildItemSummary = (entry: any) => (
    Array.isArray(entry?.items)
      ? entry.items.map((item: any) => `${item.name}${Number(item.quantity) > 1 ? ` x${item.quantity}` : ''}`).join(', ')
      : 'your collected items'
  );

  const openShareModal = (entry: any) => { setShareTarget({ ...entry, messageType: 'collection' }); setSharePhone(String(entry?.phone || '')); setShareModalOpen(true); };
  const resendSoldMessage = (entry: any) => { setShareTarget({ ...entry, messageType: 'sold' }); setSharePhone(String(entry?.phone || '')); setShareModalOpen(true); };
  const resendReturnedMessage = (entry: any) => { setShareTarget({ ...entry, messageType: 'returned' }); setSharePhone(String(entry?.phone || '')); setShareModalOpen(true); };

  const handleShareWhatsApp = (entry = shareTarget, targetPhone = sharePhone) => {
    if (!entry) return;
    const itemSummary = buildItemSummary(entry);
    const messageType = String(entry?.messageType || 'collection');
    const sharePayload = messageType === 'sold'
      ? { title: `Hello ${entry.collector_name}, this is to confirm that ${itemSummary} (Ref: ${entry.tracking_code}) has now been marked as SOLD in ${store?.name || 'Goody-POS'}.`, lines: [`Sale value: ${formatCurrency(Number(entry.total_value) || 0)}`, 'Thank you for the successful resale update.', ...(entry.note ? [`Note: ${entry.note}`] : [])] }
      : messageType === 'returned'
        ? { title: `Hello ${entry.collector_name}, this is to confirm that ${itemSummary} (Ref: ${entry.tracking_code}) has been RETURNED back to ${store?.name || 'Goody-POS'}.`, lines: [`Return recorded on ${new Date().toLocaleString()}`, 'Thank you. This collection slip is now closed.', ...(entry.note ? [`Note: ${entry.note}`] : [])] }
        : { title: `Hello ${entry.collector_name}, this is to confirm you collected ${itemSummary} (Ref: ${entry.tracking_code}) from ${store?.name || 'Goody-POS'}. Expected back by ${formatDateLabel(entry.expected_return_date)}.`, lines: entry.note ? [`Note: ${entry.note}`] : [] };
    openWhatsAppShare({ phone: targetPhone, title: sharePayload.title, lines: sharePayload.lines });
    setShareModalOpen(false);
    showNotification({ message: targetPhone ? 'WhatsApp message opened successfully.' : 'Choose any contact inside WhatsApp to send the update.', type: 'success' });
  };

  const handleCopyCode = async (code: string) => {
    try { await navigator.clipboard.writeText(code); showNotification({ message: `Tracking code ${code} copied.`, type: 'success' }); }
    catch { showNotification({ message: 'Unable to copy on this device.', type: 'warning' }); }
  };

  const handlePrintSlip = async (entry: any) => {
    try {
      const { generateMarketCollectionSlipPDF } = await import('../../lib/pdf');
      const { doc, pdfUrl } = await generateMarketCollectionSlipPDF(entry, store);
      (doc as any).autoPrint?.();
      window.location.assign(pdfUrl);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to print slip'), type: 'error' });
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={30} /></div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">

      {/* ── Hero Header ── */}
      <header className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 p-6 text-white shadow-2xl">
        <div className="pointer-events-none absolute inset-0 opacity-10 [background-image:radial-gradient(circle,rgba(255,255,255,0.15)_1px,transparent_1.5px)] [background-size:20px_20px]" />
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-indigo-900/200/20 blur-3xl" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-amber-300">
              <ShieldAlert size={13} /> Market Collector Ledger
            </p>
            <h1 className="text-2xl font-black sm:text-3xl">Track items out on collection</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-300">
              Record collectors, auto-generate a 5-digit tracking code, share on WhatsApp, and keep inventory in sync.
            </p>

            {/* KPI pills */}
            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { label: 'Open Slips', value: summary.openCount, color: 'bg-white/10 border-white/15 text-white' },
                { label: 'Items Out', value: summary.itemsOut, color: 'bg-amber-400/15 border-amber-400/35 text-amber-200' },
                { label: 'Collection Value', value: formatCurrency(summary.valueOut), color: 'bg-emerald-400/15 border-emerald-400/35 text-emerald-200' },
                { label: 'Overdue', value: summary.overdueCount, color: summary.overdueCount > 0 ? 'bg-rose-400/20 border-rose-400/35 text-rose-200' : 'bg-white/10 border-white/15 text-slate-200' },
              ].map((kpi) => (
                <div key={kpi.label} className={`rounded-2xl border px-4 py-2 backdrop-blur-sm ${kpi.color}`}>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em]">{kpi.label}</p>
                  <p className="text-[1.95rem] font-black leading-none">{kpi.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
            <button
              type="button"
              onClick={() => setShowFormModal(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3 text-sm font-black text-slate-900 shadow-lg shadow-amber-400/25 transition-all hover:bg-amber-300"
            >
              <Plus size={16} /> New Collection
            </button>
            <Link to="/" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/15">
              <Home size={16} /> Home
            </Link>
          </div>
        </div>
      </header>

      {/* ── Collector Ledger ── */}
      <section className="rounded-[28px] border border-slate-100 bg-white shadow-sm">
        {/* section header */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Collector Ledger</h2>
            <p className="text-sm text-slate-500">Open, sold, and returned history with follow-up actions.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search collector, phone, or ref"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-slate-900 sm:w-64"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'OPEN', 'OVERDUE', 'SOLD', 'RETURNED'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`rounded-xl px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition-colors ${
                    statusFilter === f
                      ? f === 'OVERDUE' ? 'bg-rose-600 text-white'
                      : f === 'SOLD' ? 'bg-emerald-600 text-white'
                      : f === 'RETURNED' ? 'bg-blue-600 text-white'
                      : 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3 p-5">
          {filteredCollections.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-16 text-center">
              <Package size={40} className="mb-3 text-slate-300" />
              <p className="font-bold text-slate-500">No market collection entries found for this filter.</p>
            </div>
          ) : filteredCollections.map((entry) => {
            const isOpen = String(entry.status || '').toUpperCase() === 'OPEN';
            const isSold = String(entry.status || '').toUpperCase() === 'SOLD';
            const isReturned = String(entry.status || '').toUpperCase() === 'RETURNED';
            const isBusy = actionId === Number(entry.id);
            const statusColor = entry.is_overdue ? 'from-rose-900 via-rose-800 to-red-900'
              : isOpen ? 'from-slate-900 via-slate-800 to-indigo-900'
              : isSold ? 'from-emerald-900 via-emerald-800 to-teal-900'
              : 'from-slate-700 via-slate-800 to-slate-900';

            return (
              <div key={entry.id} className={`overflow-hidden rounded-2xl border shadow-sm ${entry.is_overdue ? 'border-rose-200' : 'border-slate-100'}`}>

                {/* card header */}
                <div className={`relative bg-gradient-to-r ${statusColor} px-5 py-4 text-white`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-lg font-black">{entry.collector_name}</p>
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${
                          entry.is_overdue ? 'bg-red-400/30 text-red-200'
                          : isOpen ? 'bg-amber-400/20 text-amber-300'
                          : isSold ? 'bg-emerald-400/20 text-emerald-300'
                          : 'bg-white/15 text-slate-300'
                        }`}>
                          {entry.is_overdue ? 'Overdue' : (entry.status_label || entry.status)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopyCode(String(entry.tracking_code || ''))}
                          className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-0.5 text-[10px] font-black uppercase tracking-widest text-white/80 hover:bg-white/20"
                        >
                          Ref {entry.tracking_code} <Copy size={10} />
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
                        <span className="flex items-center gap-1"><Phone size={13} /> {entry.phone}</span>
                        <span>Due {formatDateLabel(entry.expected_return_date)}</span>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">Collection Value</p>
                      <p className="text-2xl font-black">{formatCurrency(Number(entry.total_value) || 0)}</p>
                      <p className="text-xs text-white/50">{Number(entry.total_quantity) || 0} item(s)</p>
                    </div>
                  </div>
                </div>

                {/* card body */}
                <div className="bg-white p-4 space-y-3">
                  {/* items grid */}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(entry.items || []).map((item: any) => (
                      <div key={item.id || `${item.product_id}-${item.name}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                        <div>
                          <p className="text-sm font-bold text-slate-900">{item.name}</p>
                          <p className="text-[11px] text-slate-500">{item.quantity} unit(s){item.condition ? ` · ${formatConditionLabel(item.condition)}` : ''}</p>
                        </div>
                        <span className="text-sm font-black text-slate-900">{formatCurrency(Number(item.subtotal) || Number(item.price_at_collection) * Number(item.quantity || 1) || Number(item.total) || 0)}</span>
                      </div>
                    ))}
                  </div>

                  {entry.note && (
                    <p className="rounded-xl border border-amber-700/30 bg-amber-900/20 px-3 py-2 text-sm text-amber-300">{entry.note}</p>
                  )}

                  {/* action row */}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button type="button" onClick={() => openShareModal(entry)} className="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-3 py-2 text-xs font-black text-white hover:bg-green-700">
                      <MessageCircle size={13} /> WhatsApp
                    </button>
                    <button type="button" onClick={() => handlePrintSlip(entry)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-300 hover:bg-slate-50">
                      <Printer size={13} /> Print Slip
                    </button>

                    {isOpen && (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleMarkSold(entry)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {isBusy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Mark Sold
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleReturned(entry)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-900/20 px-3 py-2 text-xs font-black text-amber-300 hover:bg-amber-100 disabled:opacity-60"
                        >
                          <RotateCcw size={13} /> Returned
                        </button>
                      </>
                    )}
                    {isSold && (
                      <button type="button" onClick={() => resendSoldMessage(entry)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-900/20 border border-emerald-200 px-3 py-2 text-xs font-black text-emerald-300 hover:bg-emerald-100">
                        <MessageCircle size={13} /> Resend Sold Message
                      </button>
                    )}
                    {isReturned && (
                      <button type="button" onClick={() => resendReturnedMessage(entry)} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-900/20 border border-blue-200 px-3 py-2 text-xs font-black text-blue-300 hover:bg-blue-100">
                        <MessageCircle size={13} /> Resend Return Message
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Overdue Alert ── */}
      {summary.overdueCount > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-900/20 p-4 text-sm text-rose-300 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 shrink-0 text-rose-600" size={18} />
            <div>
              <p className="font-black">Overdue collection alert</p>
              <p>{summary.overdueCount} collection entr{summary.overdueCount === 1 ? 'y is' : 'ies are'} past the expected return date and highlighted above.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── New Collection Modal ── */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">

            {/* modal header */}
            <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 px-6 py-5 text-white">
              <div className="pointer-events-none absolute inset-0 opacity-10 [background-image:radial-gradient(circle,rgba(255,255,255,0.2)_1px,transparent_1.5px)] [background-size:18px_18px]" />
              <div className="relative flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300 flex items-center gap-1.5"><TrendingUp size={11} /> New Market Collection</p>
                  <h2 className="text-xl font-black">Record a Collector</h2>
                  <p className="text-xs text-slate-400 mt-0.5">A unique 5-digit ref will be auto-generated on save.</p>
                </div>
                <button type="button" onClick={() => { setShowFormModal(false); resetForm(); }} className="rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* modal body */}
            <div className="flex-1 overflow-auto p-5">
              <form id="collection-form" className="space-y-4" onSubmit={handleSaveCollection}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-500">Collector Name</span>
                    <input type="text" value={form.collector_name} onChange={(e) => setForm((prev) => ({ ...prev, collector_name: e.target.value }))} placeholder="e.g. Alhaji Next Door"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-500">Phone <span className="text-rose-500">*</span></span>
                    <input type="tel" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="08012345678"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900" />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-500">Expected Return / Payment Date</span>
                  <input type="date" value={form.expected_return_date} onChange={(e) => setForm((prev) => ({ ...prev, expected_return_date: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900" />
                </label>

                {/* items section */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="mb-3 text-xs font-black uppercase tracking-widest text-slate-500">Item(s) Collected</p>

                  <div className="flex flex-col gap-2">
                    {/* Searchable item picker */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={itemSearch}
                        onChange={(e) => { setItemSearch(e.target.value); setItemDropdownOpen(true); }}
                        onFocus={() => setItemDropdownOpen(true)}
                        placeholder="Search by name, quick code, barcode, or vendor…"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      {selectedProductId && !itemDropdownOpen && (
                        <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <span className="flex-1 text-sm font-bold text-slate-900 truncate">
                            {[...filteredItemOptions.products, ...filteredItemOptions.consignments].find(o => o.id === selectedProductId)?.label
                              || (selectedProductId.startsWith('ci-') ? selectedConsignmentItem?.item_name : selectedProduct?.name)
                              || selectedProductId}
                          </span>
                          <button type="button" onClick={() => { setSelectedProductId(''); setItemSearch(''); setSelectedCondition('NEW'); }}
                            className="text-slate-400 hover:text-rose-500">
                            <X size={13} />
                          </button>
                        </div>
                      )}
                      {itemDropdownOpen && (
                        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl" style={{ backgroundColor: 'var(--surface)' }}>
                          <div className="max-h-56 overflow-y-auto">
                            {filteredItemOptions.products.length > 0 && (
                              <>
                                <div className="sticky top-0 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest border-b" style={{ backgroundColor: 'var(--surface-muted)', color: 'var(--ink)', borderColor: 'var(--line)' }}>Inventory Products</div>
                                {filteredItemOptions.products.map((opt) => (
                                  <button key={opt.id} type="button"
                                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left text-sm transition-colors dropdown-item-hover ${selectedProductId === opt.id ? 'bg-indigo-100' : ''}`}
                                    onClick={() => { setSelectedProductId(opt.id); const firstFilled = Object.entries(opt.raw?.condition_matrix || {}).find(([, v]: any) => Number(v?.price || 0) > 0 || Number(v?.stock || 0) > 0); setSelectedCondition(firstFilled ? String(firstFilled[0]).toUpperCase() : 'NEW'); setItemSearch(''); setItemDropdownOpen(false); }}>
                                    <span className="font-bold truncate" style={{ color: 'var(--ink)' }}>{opt.label}</span>
                                    <span className="ml-2 shrink-0 text-xs text-slate-500">{opt.sublabel}</span>
                                  </button>
                                ))}
                              </>
                            )}
                            {filteredItemOptions.consignments.length > 0 && (
                              <>
                                <div className="sticky top-0 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-violet-500 border-b border-violet-200" style={{ backgroundColor: 'var(--surface-muted)' }}>Consignment (Vendor Items)</div>
                                {filteredItemOptions.consignments.map((opt) => (
                                  <button key={opt.id} type="button"
                                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left text-sm transition-colors dropdown-item-hover ${selectedProductId === opt.id ? 'bg-violet-100' : ''}`}
                                    onClick={() => { setSelectedProductId(opt.id); const firstFilled = Object.entries(opt.raw?.condition_matrix || {}).find(([, v]: any) => Number(v?.price || 0) > 0 || Number(v?.stock || 0) > 0); setSelectedCondition(firstFilled ? String(firstFilled[0]).toUpperCase() : 'NEW'); setItemSearch(''); setItemDropdownOpen(false); }}>
                                    <span className="font-bold truncate" style={{ color: 'var(--ink)' }}>{opt.label}</span>
                                    <span className="ml-2 shrink-0 text-xs text-violet-500">{opt.sublabel}</span>
                                  </button>
                                ))}
                              </>
                            )}
                            {filteredItemOptions.products.length === 0 && filteredItemOptions.consignments.length === 0 && (
                              <div className="px-3 py-4 text-center text-sm text-slate-400">No items found.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Condition selector — only conditions with actual data */}
                    {store?.mode === 'GADGET' && selectedProduct && hasConditionMatrix(selectedProduct) && (() => {
                      const filledConditions = Object.entries(selectedProduct.condition_matrix || {}).filter(([, value]: any) => Number(value?.price || 0) > 0 || Number(value?.stock || 0) > 0);
                      if (filledConditions.length === 0) return null;
                      if (filledConditions.length === 1) {
                        const [key, value]: any = filledConditions[0];
                        return (
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-300">
                            <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-black uppercase text-white">{formatConditionLabel(key)}</span>
                            <span>{Number(value?.stock || 0)} avail · {formatCurrency(Number(value?.price || 0))}</span>
                          </div>
                        );
                      }
                      return (
                        <div className="flex gap-1.5">
                          {filledConditions.map(([key, value]: any) => (
                            <button key={key} type="button" onClick={() => setSelectedCondition(String(key).toUpperCase())}
                              className={`flex-1 rounded-xl px-2 py-2 text-xs font-black uppercase tracking-wide transition-all ${selectedCondition === String(key).toUpperCase() ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                              {formatConditionLabel(key)} · {Number(value?.stock || 0)} avail
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    {store?.mode === 'GADGET' && selectedConsignmentItem && selectedCiMatrix && (() => {
                      const filledConditions = Object.entries(selectedCiMatrix).filter(([, value]: any) => Number(value?.price || 0) > 0 || Number(value?.stock || 0) > 0);
                      if (filledConditions.length === 0) return null;
                      if (filledConditions.length === 1) {
                        const [key, value]: any = filledConditions[0];
                        return (
                          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-300">
                            <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-black uppercase text-white">{formatConditionLabel(key)}</span>
                            <span>{Number(value?.stock || 0)} avail · {formatCurrency(Number(value?.price || 0))}</span>
                          </div>
                        );
                      }
                      return (
                        <div className="flex gap-1.5">
                          {filledConditions.map(([key, value]: any) => (
                            <button key={key} type="button" onClick={() => setSelectedCondition(String(key).toUpperCase())}
                              className={`flex-1 rounded-xl px-2 py-2 text-xs font-black uppercase tracking-wide transition-all ${selectedCondition === String(key).toUpperCase() ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                              {formatConditionLabel(key)} · {Number(value?.stock || 0)} avail
                            </button>
                          ))}
                        </div>
                      );
                    })()}

                    <div className="flex gap-2">
                      <input type="number" min={1} value={selectedQuantity} onChange={(e) => setSelectedQuantity(Math.max(1, Number(e.target.value) || 1))}
                        placeholder="Qty"
                        className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900" />
                      <button type="button" onClick={handleAddDraftItem}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-black text-white hover:bg-slate-800">
                        <Plus size={15} /> Add Item
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {draftItems.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 text-center text-sm text-slate-400">No items added yet.</p>
                    ) : draftItems.map((item, index) => (
                      <div key={`${item.consignment_item_id ?? item.product_id}-${index}`} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-bold text-slate-900">{item.name}</p>
                            {item.consignment_item_id && (
                              <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-700">Vendor</span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">
                            {item.vendor_name ? `${item.vendor_name} · ` : ''}{item.quantity} unit(s) · {formatCurrency(item.price_at_collection)} each
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-slate-900">{formatCurrency(item.subtotal)}</span>
                          <button type="button" onClick={() => removeDraftItem(index)} className="rounded-full p-1.5 text-slate-400 hover:bg-rose-900/20 hover:text-rose-500"><X size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-black uppercase tracking-widest text-slate-500">Note (optional)</span>
                  <textarea rows={2} value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} placeholder="Payment arrangement or follow-up note"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-slate-900" />
                </label>
              </form>
            </div>

            {/* modal footer */}
            <div className="flex gap-3 border-t border-slate-100 p-5">
              <button type="button" onClick={() => { setShowFormModal(false); resetForm(); }}
                className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-black text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" form="collection-form" disabled={saving}
                className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-indigo-900 py-3 text-sm font-black text-white shadow-lg hover:from-slate-800 hover:to-indigo-800 disabled:opacity-60">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Save Collection
              </button>
            </div>
          </div>
        </div>
      )}

      <WhatsAppShareModal
        isOpen={shareModalOpen && Boolean(shareTarget)}
        phone={sharePhone}
        recipientName={shareTarget?.collector_name || 'collector'}
        title={shareTarget?.messageType === 'sold' ? 'Resend Sold Update' : shareTarget?.messageType === 'returned' ? 'Resend Return Update' : 'Share Collection on WhatsApp'}
        description={shareTarget?.messageType === 'sold'
          ? `Send a sold confirmation to ${shareTarget?.collector_name || 'the collector'} or any other WhatsApp number.`
          : shareTarget?.messageType === 'returned'
            ? `Send a return confirmation to ${shareTarget?.collector_name || 'the collector'} or any other WhatsApp number.`
            : `Send this collection confirmation to ${shareTarget?.collector_name || 'the collector'} or any other WhatsApp number.`}
        infoText={shareTarget?.messageType === 'sold'
          ? 'This message confirms the collection has been sold and closed successfully.'
          : shareTarget?.messageType === 'returned'
            ? 'This message confirms the item has been returned back to the store.'
            : 'If the saved phone number is not on WhatsApp, clear the field and choose any contact directly inside WhatsApp.'}
        buttonLabel={shareTarget?.messageType === 'sold' ? 'Send Sold Update' : shareTarget?.messageType === 'returned' ? 'Send Return Update' : 'Send Notice'}
        onPhoneChange={setSharePhone}
        onClose={() => setShareModalOpen(false)}
        onShare={() => handleShareWhatsApp(shareTarget, sharePhone)}
      />
    </div>
  );
};

export default MarketCollections;

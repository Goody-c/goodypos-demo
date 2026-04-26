import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Home,
  Loader2,
  Package,
  PackageCheck,
  PackagePlus,
  Plus,
  Truck,
  UserPlus,
  X,
} from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useNotification } from '../../context/NotificationContext';
import { formatCurrency } from '../../lib/utils';
import ConfirmActionModal from '../../components/ConfirmActionModal';

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const defaultOrderLine = () => ({
  product_id: '',
  condition: '',
  quantity: '1',
  unit_cost: '',
  batch_code: '',
  expiry_date: '',
});

const hasConditionMatrix = (product: any) =>
  product?.condition_matrix && typeof product.condition_matrix === 'object' && Object.keys(product.condition_matrix).length > 0;

const getAvailableUnits = (product: any) => {
  if (hasConditionMatrix(product)) {
    return ['new', 'used', 'open_box'].reduce((sum, key) => sum + (Number(product?.condition_matrix?.[key]?.stock || 0) || 0), 0);
  }
  return Number(product?.stock || 0) || 0;
};

const getConditionOptions = (product: any) => {
  if (!hasConditionMatrix(product)) return [];
  return ['new', 'used', 'open_box']
    .filter((key) => {
      const slot = product?.condition_matrix?.[key];
      return slot && (Number(slot.price || 0) > 0 || Number(slot.stock || 0) > 0);
    })
    .map((key) => ({
      value: key.toUpperCase(),
      label: key.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    }));
};

const prettyCondition = (value: string) =>
  value ? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()) : 'Standard';

const getBatchStatusClass = (status: string) => {
  if (status === 'EXPIRED') return 'bg-rose-100 text-rose-400';
  if (status === 'EXPIRING_SOON') return 'bg-amber-100 text-amber-400';
  if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-400';
  return 'bg-slate-100 text-slate-700';
};

const INPUT = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition';

const Purchases: React.FC = () => {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [confirmOrder, setConfirmOrder] = useState<any>(null);
  const [confirmAction, setConfirmAction] = useState<'receive' | 'cancel' | null>(null);
  const [store, setStore] = useState<any>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [batchSummary, setBatchSummary] = useState<any>({ total: 0, expiringSoon: 0, expired: 0, openQuantity: 0 });
  const [summary, setSummary] = useState<any>({ openOrders: 0, receivedOrders: 0, pendingUnits: 0, pendingValue: 0 });

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'ORDERED' | 'RECEIVED' | 'CANCELLED'>('ALL');
  const [lineSearch, setLineSearch] = useState<string[]>(['']);
  const [lineDropdownOpen, setLineDropdownOpen] = useState<boolean[]>([false]);

  const [supplierForm, setSupplierForm] = useState({ name: '', phone: '', email: '', address: '', note: '' });
  const [orderForm, setOrderForm] = useState({
    supplier_id: '',
    expected_date: getLocalDateValue(),
    note: '',
    items: [defaultOrderLine()],
  });

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (!lineDropdownOpen.some(Boolean)) return;
    const close = () => setLineDropdownOpen((prev) => prev.map(() => false));
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [lineDropdownOpen]);

  const DEMO_SUPPLIERS = [
    { id: 9001, name: 'D&H Distributing', phone: '(800) 555-0300', email: 'orders@dandh.com', address: '2525 N 7th St, Harrisburg, PA', note: 'Net 30 payment terms. Free shipping over $500.' },
    { id: 9002, name: 'Ingram Micro', phone: '(800) 555-0400', email: 'sales@ingrammicro.com', address: '3351 Michelson Dr, Irvine, CA', note: 'Preferred Apple & Samsung distributor.' },
    { id: 9003, name: 'Tech Data Europe', phone: '+44 20 7946 0100', email: 'supply@techdata.eu', address: '16 Great Portland St, London, UK', note: 'European accessories and peripherals.' },
    { id: 9004, name: 'Arrow Electronics', phone: '(800) 555-0500', email: 'orders@arrow.com', address: '9201 E Dry Creek Rd, Centennial, CO', note: 'Components and enterprise hardware.' },
  ];

  const DEMO_ORDERS = [
    {
      id: 8001,
      order_number: 'TH-PO-1777119451990',
      supplier_id: 9001,
      supplier_name: 'D&H Distributing',
      status: 'ORDERED',
      created_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      expected_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      note: 'Q2 restocking order',
      subtotal: 6230,
      total_quantity: 15,
      items: [
        { product_name: 'iPhone 15 Pro Max 256GB', condition: 'NEW', quantity: 5, unit_cost: 850, line_total: 4250 },
        { product_name: 'AirPods Pro 2nd Gen', condition: 'NEW', quantity: 10, unit_cost: 198, line_total: 1980 },
      ],
    },
    {
      id: 8002,
      order_number: 'TH-PO-1777119450991',
      supplier_id: 9002,
      supplier_name: 'Ingram Micro',
      status: 'RECEIVED',
      created_at: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
      expected_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      received_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
      note: 'Accessories restock',
      subtotal: 410,
      total_quantity: 80,
      items: [
        { product_name: 'USB-C Cable 6ft 3-Pack', condition: '', quantity: 30, unit_cost: 8, line_total: 240 },
        { product_name: 'Tempered Glass Screen Guard', condition: '', quantity: 50, unit_cost: 3.4, line_total: 170 },
      ],
    },
    {
      id: 8003,
      order_number: 'TH-PO-1777119449800',
      supplier_id: 9003,
      supplier_name: 'Tech Data Europe',
      status: 'ORDERED',
      created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      expected_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      note: 'Samsung Galaxy Tab S9 bulk order',
      subtotal: 11200,
      total_quantity: 16,
      items: [
        { product_name: 'Samsung Galaxy Tab S9', condition: 'NEW', quantity: 10, unit_cost: 720, line_total: 7200 },
        { product_name: 'Galaxy Tab Keyboard Cover', condition: 'NEW', quantity: 6, unit_cost: 200, line_total: 1200 },
        { product_name: 'USB-C Hub 7-in-1', condition: '', quantity: 20, unit_cost: 140, line_total: 2800 },
      ],
    },
    {
      id: 8004,
      order_number: 'TH-PO-1777119448500',
      supplier_id: 9004,
      supplier_name: 'Arrow Electronics',
      status: 'RECEIVED',
      created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      expected_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      received_at: new Date(Date.now() - 16 * 24 * 60 * 60 * 1000).toISOString(),
      note: 'MacBook Pro restock — back to school season',
      subtotal: 18500,
      total_quantity: 5,
      items: [
        { product_name: 'MacBook Pro 14" M3', condition: 'NEW', quantity: 3, unit_cost: 4200, line_total: 12600 },
        { product_name: 'MacBook Air M2', condition: 'NEW', quantity: 2, unit_cost: 2950, line_total: 5900 },
      ],
    },
    {
      id: 8005,
      order_number: 'TH-PO-1777119447200',
      supplier_id: 9001,
      supplier_name: 'D&H Distributing',
      status: 'CANCELLED',
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      expected_date: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString(),
      note: 'Cancelled — switched to Ingram Micro for better pricing',
      subtotal: 3200,
      total_quantity: 8,
      items: [
        { product_name: 'Sony WH-1000XM5 Headphones', condition: 'NEW', quantity: 8, unit_cost: 400, line_total: 3200 },
      ],
    },
  ];

  const loadData = async () => {
    try {
      setLoading(true);
      const [storeData, supplierData, orderData, productData, batchData] = await Promise.all([
        appFetch('/api/store/settings'),
        appFetch('/api/suppliers'),
        appFetch('/api/purchase-orders'),
        appFetch('/api/products?limit=500&offset=0'),
        appFetch('/api/inventory/batches?status=all&days=45&limit=50&offset=0').catch(() => ({ batches: [], summary: { total: 0, expiringSoon: 0, expired: 0, openQuantity: 0 } })),
      ]);
      setStore(storeData);

      const supplierItems = Array.isArray(supplierData?.suppliers) ? supplierData.suppliers : (Array.isArray(supplierData) ? supplierData : []);
      const orderItems = Array.isArray(orderData?.orders) ? orderData.orders : [];
      const productItems = Array.isArray(productData?.items) ? productData.items : (Array.isArray(productData) ? productData : []);

      const finalSuppliers = supplierItems.length > 0 ? supplierItems : DEMO_SUPPLIERS;
      const finalOrders = orderItems.length > 0 ? orderItems : DEMO_ORDERS;

      setSuppliers(finalSuppliers);
      setOrders(finalOrders);
      setProducts(productItems);
      setBatches(Array.isArray(batchData?.batches) ? batchData.batches : []);
      setBatchSummary(batchData?.summary || { total: 0, expiringSoon: 0, expired: 0, openQuantity: 0 });
      setSummary(orderData?.summary || {
        openOrders: finalOrders.filter((o: any) => o.status === 'ORDERED').length,
        receivedOrders: finalOrders.filter((o: any) => o.status === 'RECEIVED').length,
        pendingUnits: finalOrders.filter((o: any) => o.status === 'ORDERED').reduce((s: number, o: any) => s + (Number(o.total_quantity || 0) || 0), 0),
        pendingValue: finalOrders.filter((o: any) => o.status === 'ORDERED').reduce((s: number, o: any) => s + (Number(o.subtotal || 0) || 0), 0),
      });
    } catch (err: any) {
      setSuppliers(DEMO_SUPPLIERS);
      setOrders(DEMO_ORDERS);
      setSummary({
        openOrders: DEMO_ORDERS.filter((o) => o.status === 'ORDERED').length,
        pendingUnits: DEMO_ORDERS.filter((o) => o.status === 'ORDERED').reduce((s, o) => s + o.total_quantity, 0),
        pendingValue: DEMO_ORDERS.filter((o) => o.status === 'ORDERED').reduce((s, o) => s + o.subtotal, 0),
      });
      showNotification({ message: String(err?.message || err || 'Failed to load data'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const lowStockProducts = useMemo(() => products.filter((p) => getAvailableUnits(p) < 5), [products]);
  const expiringBatches = useMemo(
    () => batches.filter((b) => Number(b.quantity_remaining || 0) > 0 && ['EXPIRING_SOON', 'EXPIRED'].includes(String(b.status || ''))).slice(0, 8),
    [batches],
  );
  const orderSubtotal = useMemo(() =>
    orderForm.items.reduce((sum, item) => sum + (Math.max(0, Number(item.quantity) || 0) * Math.max(0, Number(item.unit_cost) || 0)), 0),
    [orderForm.items],
  );
  const filteredOrders = useMemo(() =>
    orderFilter === 'ALL' ? orders : orders.filter((o) => o.status === orderFilter),
    [orders, orderFilter],
  );

  const resetOrderForm = () => {
    setOrderForm({ supplier_id: '', expected_date: getLocalDateValue(), note: '', items: [defaultOrderLine()] });
    setLineSearch(['']);
    setLineDropdownOpen([false]);
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name.trim()) { showNotification({ message: 'Supplier name is required', type: 'warning' }); return; }
    setSavingSupplier(true);
    try {
      const result = await appFetch('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify({ name: supplierForm.name.trim(), phone: supplierForm.phone.trim(), email: supplierForm.email.trim(), address: supplierForm.address.trim(), note: supplierForm.note.trim() }),
      });
      showNotification({ message: 'Supplier saved successfully', type: 'success' });
      setSupplierForm({ name: '', phone: '', email: '', address: '', note: '' });
      if (!orderForm.supplier_id && result?.supplier?.id) setOrderForm((prev) => ({ ...prev, supplier_id: String(result.supplier.id) }));
      setShowSupplierModal(false);
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save supplier'), type: 'error' });
    } finally {
      setSavingSupplier(false);
    }
  };

  const updateOrderLine = (index: number, field: string, value: string) => {
    setOrderForm((prev) => ({
      ...prev,
      items: prev.items.map((item, i) => {
        if (i !== index) return item;
        if (field === 'product_id') {
          const sel = products.find((p) => String(p.id) === value);
          return { ...item, product_id: value, condition: getConditionOptions(sel)[0]?.value || '' };
        }
        return { ...item, [field]: value };
      }),
    }));
  };

  const fillLowStockOrder = () => {
    if (!lowStockProducts.length) { showNotification({ message: 'No low-stock products to reorder', type: 'success' }); return; }
    setOrderForm((prev) => ({
      ...prev,
      note: prev.note || 'Auto-filled from low-stock items. Review quantities and unit cost before saving.',
      items: lowStockProducts.slice(0, 8).map((p) => ({
        product_id: String(p.id),
        condition: getConditionOptions(p)[0]?.value || '',
        quantity: String(Math.max(1, 5 - getAvailableUnits(p))),
        unit_cost: '',
        batch_code: '',
        expiry_date: '',
      })),
    }));
    setShowOrderModal(true);
    showNotification({ message: 'Low-stock products prefilled into restock order', type: 'success' });
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderForm.supplier_id) { showNotification({ message: 'Select a supplier before saving', type: 'warning' }); return; }
    const payloadItems = orderForm.items
      .map((item) => ({ product_id: Number(item.product_id), condition: item.condition || null, quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)), unit_cost: Math.max(0, Number(item.unit_cost) || 0), batch_code: item.batch_code?.trim() || null, expiry_date: item.expiry_date || null }))
      .filter((item) => item.product_id > 0 && item.quantity > 0);
    if (!payloadItems.length) { showNotification({ message: 'Add at least one valid product with quantity', type: 'warning' }); return; }
    setSavingOrder(true);
    try {
      await appFetch('/api/purchase-orders', { method: 'POST', body: JSON.stringify({ supplier_id: Number(orderForm.supplier_id), expected_date: orderForm.expected_date || null, note: orderForm.note.trim(), items: payloadItems }) });
      showNotification({ message: 'Restock order created successfully', type: 'success' });
      resetOrderForm();
      setShowOrderModal(false);
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to create order'), type: 'error' });
    } finally {
      setSavingOrder(false);
    }
  };

  const openActionModal = (order: any, action: 'receive' | 'cancel') => { setConfirmOrder(order); setConfirmAction(action); };

  const handleConfirmAction = async () => {
    if (!confirmOrder?.id || !confirmAction) return;
    setActionLoadingId(Number(confirmOrder.id));
    try {
      await appFetch(`/api/purchase-orders/${confirmOrder.id}/${confirmAction === 'receive' ? 'receive' : 'cancel'}`, { method: 'POST' });
      showNotification({ message: confirmAction === 'receive' ? 'Stock received and inventory updated' : 'Order cancelled', type: 'success' });
      setConfirmOrder(null);
      setConfirmAction(null);
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Action failed'), type: 'error' });
    } finally {
      setActionLoadingId(null);
    }
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={28} /></div>;
  }

  return (
    <div className="space-y-6">

      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 p-6 sm:p-8">
        <div className="hero-dot-overlay" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"><Truck size={20} className="text-white" /></div>
              <div>
                <h1 className="text-2xl font-black text-white">Purchases & Suppliers</h1>
                <p className="text-sm text-slate-700">Track vendors, raise restock orders, and receive stock in one workflow.</p>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              {[
                { label: 'Suppliers', value: suppliers.length, color: 'bg-white/10 text-white' },
                { label: 'Open Orders', value: summary?.openOrders || 0, color: 'bg-amber-400/20 text-amber-200' },
                { label: 'Pending Units', value: summary?.pendingUnits || 0, color: 'bg-emerald-400/20 text-emerald-200' },
                { label: 'Pending Value', value: formatCurrency(summary?.pendingValue || 0), color: 'bg-indigo-400/20 text-indigo-200' },
              ].map((kpi) => (
                <div key={kpi.label} className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-black backdrop-blur-sm ${kpi.color}`}>
                  <span>{kpi.label}</span>
                  <span>{kpi.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to="/" className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20">
              <Home size={15} /> Home
            </Link>
            <button
              type="button"
              onClick={() => { setShowSupplierModal(true); }}
              className="flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <UserPlus size={15} /> Add Supplier
            </button>
            <button
              type="button"
              onClick={() => { setShowOrderModal(true); }}
              className="flex items-center gap-2 rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-slate-900 transition hover:bg-amber-300"
            >
              <Plus size={15} /> New Order
            </button>
          </div>
        </div>
      </div>

      {/* ── Low Stock Alert ── */}
      {lowStockProducts.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-900/20 px-5 py-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={18} className="text-amber-600 shrink-0" />
            <p className="text-sm font-bold text-amber-300">
              {lowStockProducts.length} product{lowStockProducts.length !== 1 ? 's' : ''} below 5 units — consider restocking soon.
            </p>
          </div>
          <button
            type="button"
            onClick={fillLowStockOrder}
            className="rounded-xl bg-amber-900/200 px-4 py-2 text-sm font-black text-white transition hover:bg-amber-600"
          >
            <PackagePlus size={14} className="inline mr-1.5 -mt-0.5" />
            Reorder Low Stock
          </button>
        </div>
      )}

      {/* ── Main Grid ── */}
      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">

        {/* Left – Supplier Directory */}
        <div className="space-y-6">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-4">
              <div>
                <h2 className="font-black text-slate-900">Supplier Directory</h2>
                <p className="text-xs text-slate-500 mt-0.5">Contact list for your restock vendors.</p>
              </div>
              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-black text-slate-700">{suppliers.length}</span>
            </div>

            {suppliers.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="rounded-full bg-slate-100 p-4"><Truck size={22} className="text-slate-400" /></div>
                <p className="text-sm text-slate-500">No suppliers yet.<br />Click <strong>Add Supplier</strong> to get started.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {suppliers.map((supplier) => {
                  const pendingCount = orders.filter((o) => Number(o.supplier_id) === Number(supplier.id) && o.status === 'ORDERED').length;
                  return (
                    <div key={supplier.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-sm font-black text-indigo-400">
                            {String(supplier.name || '?')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-black text-slate-900 truncate">{supplier.name}</p>
                            <p className="text-xs text-slate-500 truncate">{supplier.phone || supplier.email || 'No contact added'}</p>
                            {supplier.address && <p className="text-xs text-slate-400 truncate">{supplier.address}</p>}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${pendingCount > 0 ? 'bg-amber-100 text-amber-400' : 'bg-slate-100 text-slate-600'}`}>
                          {pendingCount} open
                        </span>
                      </div>
                      {supplier.note && (
                        <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 border border-slate-100">{supplier.note}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Expiry & Batch Watch */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
              <h2 className="font-black text-slate-900">Expiry & Batch Watch</h2>
              <p className="text-xs text-slate-500 mt-0.5">Batches from received orders that need attention.</p>
            </div>
            <div className="grid grid-cols-3 gap-3 border-b border-slate-100 p-4">
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Batches</p>
                <p className="mt-1 text-xl font-black text-slate-900">{batchSummary?.total || 0}</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Expiring</p>
                <p className="mt-1 text-2xl font-black leading-none text-amber-800">{batchSummary?.expiringSoon || 0}</p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50 p-3 text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">Expired</p>
                <p className="mt-1 text-2xl font-black leading-none text-rose-800">{batchSummary?.expired || 0}</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {expiringBatches.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-500 text-center">No expiring batches right now.</div>
              ) : expiringBatches.map((batch) => (
                <div key={batch.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-sm text-slate-900">{batch.product_name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {batch.batch_code ? `Batch ${batch.batch_code}` : 'No batch code'}
                        {batch.expiry_date ? ` · Exp ${batch.expiry_date}` : ''}
                      </p>
                      <p className="text-xs text-slate-400">{batch.supplier_name || 'No supplier'} · {batch.quantity_remaining}/{batch.quantity_received} units left</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${getBatchStatusClass(String(batch.status || ''))}`}>
                      {String(batch.status || 'NO_EXPIRY').replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right – Purchase Order History */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-black text-slate-900">Purchase Orders</h2>
                <p className="text-xs text-slate-500 mt-0.5">Receive stock or cancel orders from here.</p>
              </div>
              <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-black text-slate-700">{orders.length}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(['ALL', 'ORDERED', 'RECEIVED', 'CANCELLED'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setOrderFilter(f)}
                  className={`rounded-full px-3 py-1 text-xs font-black transition ${
                    orderFilter === f
                      ? f === 'ALL' ? 'bg-slate-900 text-white'
                        : f === 'ORDERED' ? 'bg-amber-900/200 text-white'
                        : f === 'RECEIVED' ? 'bg-emerald-900/200 text-white'
                        : 'bg-rose-900/200 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f === 'ALL' ? `All (${orders.length})` : f === 'ORDERED' ? `Open (${orders.filter(o => o.status === 'ORDERED').length})` : f === 'RECEIVED' ? `Received (${orders.filter(o => o.status === 'RECEIVED').length})` : `Cancelled (${orders.filter(o => o.status === 'CANCELLED').length})`}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[720px] overflow-y-auto">
            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <div className="rounded-full bg-slate-100 p-4"><ClipboardList size={22} className="text-slate-400" /></div>
                <p className="text-sm text-slate-500">No orders {orderFilter !== 'ALL' ? `with status "${orderFilter}"` : 'yet'}.<br />Create one using <strong>New Order</strong>.</p>
              </div>
            ) : filteredOrders.map((order) => (
              <div key={order.id} className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-black text-slate-900">{order.order_number}</p>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${order.status === 'RECEIVED' ? 'bg-emerald-100 text-emerald-400' : order.status === 'CANCELLED' ? 'bg-rose-100 text-rose-400' : 'bg-amber-100 text-amber-400'}`}>
                        {order.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 font-bold">{order.supplier_name || 'Unknown Supplier'}</p>
                    <p className="text-xs text-slate-400">
                      {order.created_at ? new Date(order.created_at).toLocaleString() : '—'}
                      {order.expected_date ? ` · Expected ${new Date(order.expected_date).toLocaleDateString()}` : ''}
                    </p>
                    {order.note && <p className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-xs text-slate-600">{order.note}</p>}
                  </div>
                  <div className="flex flex-col gap-2 sm:items-end shrink-0">
                    <p className="text-lg font-black text-slate-900">{formatCurrency(order.subtotal || 0)}</p>
                    <p className="text-xs text-slate-500">{order.total_quantity || 0} unit(s)</p>
                    {order.status === 'ORDERED' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openActionModal(order, 'receive')}
                          disabled={actionLoadingId === Number(order.id)}
                          className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-60"
                        >
                          <CheckCircle2 size={12} className="inline mr-1 -mt-0.5" />
                          Receive
                        </button>
                        <button
                          type="button"
                          onClick={() => openActionModal(order, 'cancel')}
                          disabled={actionLoadingId === Number(order.id)}
                          className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                    {order.status === 'RECEIVED' && (
                      <p className="text-xs font-bold text-emerald-400">
                        Received {order.received_at ? new Date(order.received_at).toLocaleDateString() : 'successfully'}
                      </p>
                    )}
                  </div>
                </div>

                {Array.isArray(order.items) && order.items.length > 0 && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {order.items.map((item: any, idx: number) => (
                      <div key={`${order.id}-${idx}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        <p className="font-black text-slate-900 truncate">{item.product_name || item.name}</p>
                        <p className="mt-0.5">{prettyCondition(item.condition || '')} · {item.quantity} unit(s) · {formatCurrency(item.unit_cost || 0)}/unit</p>
                        {item.batch_code && <p className="mt-0.5 text-slate-500">Batch: {item.batch_code}</p>}
                        {item.expiry_date && <p className="mt-0.5 text-slate-500">Exp: {item.expiry_date}</p>}
                        <p className="mt-1 font-black text-slate-900">Line: {formatCurrency(item.line_total || 0)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Add Supplier Modal ── */}
      {showSupplierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4" onClick={() => setShowSupplierModal(false)}>
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-indigo-900 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"><UserPlus size={18} className="text-white" /></div>
                <div>
                  <h2 className="font-black text-white">Add Supplier</h2>
                  <p className="text-xs text-slate-700">Save vendor contact for restock orders.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowSupplierModal(false)} className="rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-white transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSupplier} className="p-5 space-y-3">
              <input value={supplierForm.name} onChange={(e) => setSupplierForm((p) => ({ ...p, name: e.target.value }))} placeholder="Supplier name *" className={INPUT} />
              <div className="grid gap-3 sm:grid-cols-2">
                <input value={supplierForm.phone} onChange={(e) => setSupplierForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Phone number" className={INPUT} />
                <input value={supplierForm.email} onChange={(e) => setSupplierForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email address" className={INPUT} />
              </div>
              <input value={supplierForm.address} onChange={(e) => setSupplierForm((p) => ({ ...p, address: e.target.value }))} placeholder="Address" className={INPUT} />
              <textarea rows={3} value={supplierForm.note} onChange={(e) => setSupplierForm((p) => ({ ...p, note: e.target.value }))} placeholder="Notes, delivery terms, or account details" className={INPUT} />

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowSupplierModal(false)} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={savingSupplier} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-indigo-700 disabled:opacity-60">
                  {savingSupplier ? <Loader2 className="animate-spin" size={15} /> : <UserPlus size={15} />}
                  {savingSupplier ? 'Saving...' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Create Restock Order Modal ── */}
      {showOrderModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setShowOrderModal(false)}>
          <div className="w-full max-w-2xl my-6 overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-emerald-900 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10"><PackagePlus size={18} className="text-white" /></div>
                <div>
                  <h2 className="font-black text-white">Create Restock Order</h2>
                  <p className="text-xs text-slate-700">Raise a purchase order — receive stock when it arrives.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowOrderModal(false)} className="rounded-xl p-2 text-white/60 hover:bg-white/10 hover:text-white transition">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateOrder}>
              <div className="p-5 space-y-4 max-h-[65vh] overflow-y-auto">
                <div className="grid gap-3 sm:grid-cols-2">
                  <select value={orderForm.supplier_id} onChange={(e) => setOrderForm((p) => ({ ...p, supplier_id: e.target.value }))} className={INPUT}>
                    <option value="">Select supplier *</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <input type="date" value={orderForm.expected_date} onChange={(e) => setOrderForm((p) => ({ ...p, expected_date: e.target.value }))} className={INPUT} />
                </div>

                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {orderForm.items.map((item, index) => {
                    const sel = products.find((p) => String(p.id) === item.product_id);
                    const conditionOptions = getConditionOptions(sel);
                    const qty = Math.max(0, Number(item.quantity) || 0);
                    const cost = Math.max(0, Number(item.unit_cost) || 0);
                    const searchVal = lineSearch[index] ?? '';
                    const dropOpen = lineDropdownOpen[index] ?? false;
                    const filteredProds = products.filter((p) => {
                      if (!searchVal.trim()) return true;
                      const q = searchVal.toLowerCase();
                      return (
                        p.name?.toLowerCase().includes(q) ||
                        p.quick_code?.toLowerCase().includes(q) ||
                        p.barcode?.toLowerCase().includes(q)
                      );
                    });
                    const setLineSearchAt = (val: string) => setLineSearch((prev) => { const a = [...prev]; a[index] = val; return a; });
                    const setLineDropAt = (val: boolean) => setLineDropdownOpen((prev) => { const a = [...prev]; a[index] = val; return a; });
                    return (
                      <div key={`line-${index}`} className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2">
                        <div className={`grid gap-2 ${store?.mode === 'SUPERMARKET' ? 'sm:grid-cols-[1.5fr_0.6fr_0.7fr_auto]' : 'sm:grid-cols-[1.5fr_0.8fr_0.6fr_0.7fr_auto]'}`}>
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            {sel && !dropOpen ? (
                              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm">
                                <span className="flex-1 truncate text-slate-800">{sel.name}</span>
                                <button type="button" onClick={() => { updateOrderLine(index, 'product_id', ''); setLineSearchAt(''); setLineDropAt(true); }} className="text-slate-400 hover:text-rose-500">×</button>
                              </div>
                            ) : (
                              <input
                                type="text"
                                value={searchVal}
                                onChange={(e) => { setLineSearchAt(e.target.value); setLineDropAt(true); }}
                                onFocus={() => setLineDropAt(true)}
                                placeholder="Search product…"
                                className={INPUT}
                              />
                            )}
                            {dropOpen && (
                              <div className="absolute z-30 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-52 overflow-y-auto">
                                {filteredProds.length === 0 ? (
                                  <div className="px-3 py-2 text-xs text-slate-400">No products found</div>
                                ) : filteredProds.map((p) => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => { updateOrderLine(index, 'product_id', String(p.id)); setLineSearchAt(''); setLineDropAt(false); }}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate text-slate-800">{p.name}</span>
                                    <span className="shrink-0 text-xs text-slate-500">{getAvailableUnits(p)} in stock</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {store?.mode !== 'SUPERMARKET' && (conditionOptions.length === 0 ? null : conditionOptions.length === 1 ? (
                            <div className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-3 py-2.5 text-xs font-bold text-slate-700">
                              <span className="rounded-lg bg-slate-900 px-2 py-0.5 text-xs font-black uppercase text-white">{conditionOptions[0].label}</span>
                            </div>
                          ) : (
                            <div className="flex gap-1.5">
                              {conditionOptions.map((o) => (
                                <button key={o.value} type="button" onClick={() => updateOrderLine(index, 'condition', o.value)}
                                  className={`flex-1 rounded-xl px-2 py-2.5 text-xs font-black uppercase tracking-wide transition-all ${item.condition === o.value ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          ))}
                          <input type="number" min="1" value={item.quantity} onChange={(e) => updateOrderLine(index, 'quantity', e.target.value)} placeholder="Qty" className={INPUT} />
                          <input type="number" min="0" step="0.01" value={item.unit_cost} onChange={(e) => updateOrderLine(index, 'unit_cost', e.target.value)} placeholder="Cost" className={INPUT} />
                          <button type="button" onClick={() => {
                            setOrderForm((p) => ({ ...p, items: p.items.filter((_, i) => i !== index).length ? p.items.filter((_, i) => i !== index) : [defaultOrderLine()] }));
                            setLineSearch((prev) => { const a = prev.filter((_, i) => i !== index); return a.length ? a : ['']; });
                            setLineDropdownOpen((prev) => { const a = prev.filter((_, i) => i !== index); return a.length ? a : [false]; });
                          }} className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-200 text-rose-500 transition hover:bg-rose-900/20">
                            <X size={14} />
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input type="text" value={item.batch_code} onChange={(e) => updateOrderLine(index, 'batch_code', e.target.value)} placeholder="Batch / lot code (optional)" className={INPUT} />
                          <input type="date" value={item.expiry_date} onChange={(e) => updateOrderLine(index, 'expiry_date', e.target.value)} className={INPUT} />
                        </div>
                        {sel && (
                          <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                            <span>Stock: <strong className="text-slate-700">{
                              hasConditionMatrix(sel) && item.condition
                                ? Number(sel.condition_matrix?.[item.condition.toLowerCase()]?.stock || 0)
                                : getAvailableUnits(sel)
                            }</strong></span>
                            <span>Line total: <strong className="text-slate-700">{formatCurrency(qty * cost)}</strong></span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => {
                    setOrderForm((p) => ({ ...p, items: [...p.items, defaultOrderLine()] }));
                    setLineSearch((prev) => [...prev, '']);
                    setLineDropdownOpen((prev) => [...prev, false]);
                  }} className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-sm font-bold text-slate-500 transition hover:bg-white">
                    + Add another line
                  </button>
                </div>

                <textarea rows={2} value={orderForm.note} onChange={(e) => setOrderForm((p) => ({ ...p, note: e.target.value }))} placeholder="Order note, payment terms, or delivery instructions" className={INPUT} />

                <div className="rounded-2xl border border-emerald-200 bg-emerald-900/20 px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Estimated Total</p>
                    <p className="text-xl font-black text-emerald-300">{formatCurrency(orderSubtotal)}</p>
                  </div>
                  <Package size={22} className="text-emerald-400" />
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4 bg-slate-50">
                <button type="button" onClick={() => setShowOrderModal(false)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={savingOrder} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-60">
                  {savingOrder ? <Loader2 className="animate-spin" size={15} /> : <ClipboardList size={15} />}
                  {savingOrder ? 'Saving...' : 'Save Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmActionModal
        isOpen={Boolean(confirmOrder && confirmAction)}
        title={confirmAction === 'receive' ? 'Receive this stock order?' : 'Cancel this stock order?'}
        description={confirmAction === 'receive' ? 'This will increase inventory and log a restock adjustment for each item.' : 'The order will be marked cancelled and kept in your history.'}
        confirmLabel={confirmAction === 'receive' ? 'Yes, receive stock' : 'Yes, cancel order'}
        tone={confirmAction === 'receive' ? 'success' : 'warning'}
        loading={actionLoadingId === Number(confirmOrder?.id || 0)}
        onClose={() => { if (actionLoadingId) return; setConfirmOrder(null); setConfirmAction(null); }}
        onConfirm={handleConfirmAction}
        details={confirmOrder ? (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            <p><strong>Order:</strong> {confirmOrder.order_number}</p>
            <p><strong>Supplier:</strong> {confirmOrder.supplier_name}</p>
            <p><strong>Items:</strong> {confirmOrder.total_quantity || 0} unit(s)</p>
            <div className="space-y-1.5">
              {(Array.isArray(confirmOrder.items) ? confirmOrder.items : []).map((item: any, idx: number) => (
                <div key={`${confirmOrder.id}-confirm-${idx}`} className="rounded-xl bg-white border border-slate-200 px-3 py-2 text-xs">
                  {item.product_name || item.name} · {prettyCondition(item.condition || '')} · {item.quantity} unit(s)
                  {item.batch_code ? ` · Batch ${item.batch_code}` : ''}
                  {item.expiry_date ? ` · Exp ${item.expiry_date}` : ''}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      />
    </div>
  );
};

export default Purchases;

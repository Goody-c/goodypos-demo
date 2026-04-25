import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, Loader2, Package, RotateCcw, Search, X } from 'lucide-react';
import { appFetch } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

const PRODUCT_OVERVIEW_LIMIT = 300;

const formatInventoryUnits = (value: number | string) => {
  if (value === '' || value === null || value === undefined) return '0';
  const num = Number(value);
  if (Number.isNaN(num)) return '0';
  return num.toLocaleString('en-US');
};

const formatAddedDate = (value?: string) => {
  if (!value) return 'Recently';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Recently';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const ProductOverview: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [products, setProducts] = useState<any[]>([]);
  const [store, setStore] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [overviewTab, setOverviewTab] = useState<'overview' | 'pricing' | 'stock' | 'specs'>('overview');

  const canViewCostFields = user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN' || user?.role === 'ACCOUNTANT' || user?.role === 'PROCUREMENT_OFFICER';

  const getComparablePrice = (product: any) => {
    if (store?.mode === 'GADGET' && product?.condition_matrix && typeof product.condition_matrix === 'object') {
      const prices = Object.values(product.condition_matrix || {}).map((e: any) => Number(e?.price) || 0).filter((v: number) => v > 0);
      if (prices.length > 0) return Math.min(...prices);
    }
    return Number(product?.price) || 0;
  };

  const getAvailableUnits = (product: any) => {
    if (store?.mode === 'GADGET' && product?.condition_matrix && typeof product.condition_matrix === 'object') {
      const stocks = Object.values(product.condition_matrix || {}).map((e: any) => Number(e?.stock) || 0);
      if (stocks.length > 0) return stocks.reduce((s, v) => s + v, 0);
    }
    return Number(product?.stock) || 0;
  };

  const getStockHealth = (product: any): 'out' | 'low' | 'healthy' => {
    const units = getAvailableUnits(product);
    if (units <= 0) return 'out';
    if (units < 5) return 'low';
    return 'healthy';
  };

  const getConditionSnapshot = (product: any) => {
    const matrix = product?.condition_matrix && typeof product.condition_matrix === 'object' ? product.condition_matrix : {};
    return ['new', 'open_box', 'used'].map((key) => ({
      key, label: key.replace('_', ' '),
      price: Number((matrix as Record<string, any>)?.[key]?.price || 0) || 0,
      stock: Number((matrix as Record<string, any>)?.[key]?.stock || 0) || 0,
      cost: Number((matrix as Record<string, any>)?.[key]?.cost ?? product?.cost ?? 0) || 0,
    }));
  };

  const hasConditionData = (entry: { price: number; stock: number; cost: number }, product?: any) => {
    const fallbackCost = Number(product?.cost ?? 0) || 0;
    return entry.price > 0 || entry.stock > 0 || (entry.cost > 0 && entry.cost !== fallbackCost);
  };

  const getProductSpecsEntries = (product: any) => (
    Object.entries(product?.specs || {}).filter(([, value]) => String(value ?? '').trim().length > 0)
  );

  const loadData = async (withRefreshFeedback = false) => {
    if (withRefreshFeedback) setRefreshing(true);
    try {
      const [storeData, productsData] = await Promise.all([
        appFetch('/api/store/settings'),
        appFetch(`/api/products?limit=${PRODUCT_OVERVIEW_LIMIT}&offset=0&sort=recent`),
      ]);
      const items = Array.isArray(productsData) ? productsData : (Array.isArray(productsData?.items) ? productsData.items : []);
      setStore(storeData);
      setProducts(items);
      setSelectedProductId((current) => {
        if (current && items.some((p: any) => Number(p.id) === Number(current))) return current;
        return items.length ? Number(items[0].id) : null;
      });
      if (withRefreshFeedback) showNotification({ message: 'Product overview refreshed.', type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || 'Failed to load product overview.'), type: 'error' });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void loadData(); }, []);

  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => String(p.category || 'General')))).sort((a, b) => a.localeCompare(b)),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCategory !== 'all' && String(p.category || 'General') !== selectedCategory) return false;
      if (!q) return true;
      return [p.name, p.category, p.quick_code, p.barcode].some((v) => String(v || '').toLowerCase().includes(q));
    });
  }, [products, search, selectedCategory]);

  useEffect(() => {
    if (filteredProducts.length === 0) { setSelectedProductId(null); return; }
    const exists = filteredProducts.some((p) => Number(p.id) === Number(selectedProductId));
    if (!exists) { setSelectedProductId(Number(filteredProducts[0].id)); setOverviewTab('overview'); }
  }, [filteredProducts, selectedProductId]);

  const selectedProduct = useMemo(
    () => filteredProducts.find((p) => Number(p.id) === Number(selectedProductId)) || null,
    [filteredProducts, selectedProductId]
  );

  const stockSummary = useMemo(
    () => filteredProducts.reduce((s, p) => {
      const h = getStockHealth(p);
      if (h === 'out') s.out += 1; else if (h === 'low') s.low += 1; else s.healthy += 1;
      return s;
    }, { out: 0, low: 0, healthy: 0 }),
    [filteredProducts, store?.mode]
  );

  const overviewConditionCards = selectedProduct ? getConditionSnapshot(selectedProduct) : [];
  const populatedOverviewConditionCards = selectedProduct
    ? overviewConditionCards.filter((entry) => hasConditionData(entry, selectedProduct))
    : [];
  const primaryCondition = populatedOverviewConditionCards[0] || null;
  const singleConditionLabel = primaryCondition
    ? primaryCondition.label.replace(/\b\w/g, (char) => char.toUpperCase())
    : '';
  const overviewSpecs = selectedProduct ? getProductSpecsEntries(selectedProduct) : [];
  const overviewSellingPrice = primaryCondition?.price ?? (selectedProduct ? getComparablePrice(selectedProduct) : 0);
  const overviewCostPrice = primaryCondition?.cost ?? (selectedProduct ? Number(selectedProduct?.cost || 0) : 0);
  const overviewAvailableUnits = primaryCondition?.stock ?? (selectedProduct ? getAvailableUnits(selectedProduct) : 0);
  const overviewProfit = overviewSellingPrice - overviewCostPrice;
  const overviewMarkup = overviewCostPrice > 0 ? (overviewProfit / overviewCostPrice) * 100 : 0;
  const overviewOnCollection = selectedProduct ? Number(selectedProduct?.on_collection_quantity || 0) : 0;
  const overviewHealth = selectedProduct ? getStockHealth(selectedProduct) : 'healthy';

  const healthPill = (h: 'out' | 'low' | 'healthy') =>
    h === 'out' ? 'bg-rose-100 text-rose-400' : h === 'low' ? 'bg-amber-100 text-amber-400' : 'bg-emerald-100 text-emerald-400';
  const healthLabel = (h: 'out' | 'low' | 'healthy') =>
    h === 'out' ? 'Out of Stock' : h === 'low' ? 'Low Stock' : 'Healthy';

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'pricing', label: 'Pricing' },
    { key: 'stock', label: 'Stock' },
    { key: 'specs', label: 'Specs' },
  ] as const;

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-[28px] border border-slate-200 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">

      {/* ── HERO ── */}
      <header className="relative rounded-[28px] bg-[radial-gradient(ellipse_at_top_left,#1e3a5f_0%,#1e293b_40%,#0f172a_100%)] px-7 py-8 text-white shadow-[0_30px_80px_-30px_rgba(30,41,59,0.8)]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-sky-500/15 blur-[70px]" />
          <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-blue-400/10 blur-[60px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />
        </div>
        <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-[#38bdf8]">Sidebar Product Overview</p>
            <h1 className="text-3xl font-black text-white sm:text-4xl" style={{ fontFamily: 'var(--font-display)' }}>Product Overview</h1>
            <p className="mt-1 text-sm text-[#94a3b8]">Open full product details directly from the left menu.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/inventory" className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20">
              Open Inventory
            </Link>
            <button type="button" onClick={() => void loadData(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-black text-slate-900 shadow-sm transition hover:bg-slate-100">
              <RotateCcw size={15} className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* KPI strip */}
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Visible Products', value: formatInventoryUnits(filteredProducts.length), color: 'text-white', border: 'border-white/15 bg-white/10' },
            { label: 'Healthy Stock', value: formatInventoryUnits(stockSummary.healthy), color: 'text-[#34d399]', border: 'border-emerald-400/30 bg-emerald-900/200/10' },
            { label: 'Low / Out', value: formatInventoryUnits(stockSummary.low + stockSummary.out), color: 'text-[#fbbf24]', border: 'border-amber-400/30 bg-amber-900/200/10' },
            { label: 'Categories', value: formatInventoryUnits(categories.length), color: 'text-white', border: 'border-white/15 bg-white/10' },
          ].map((s) => (
            <div key={s.label} className={`rounded-2xl border px-4 py-3 backdrop-blur ${s.border}`}>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#94a3b8]">{s.label}</p>
              <p className={`mt-1 text-2xl font-black ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      </header>

      {/* ── MAIN LAYOUT ── */}
      <div className="grid gap-5 xl:grid-cols-[300px_1fr]">

        {/* Sidebar */}
        <aside className="space-y-4">
          {/* Search + Filter */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Find Product</p>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, barcode, quick code…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300">
                  <X size={13} />
                </button>
              )}
            </div>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-300 outline-none focus:ring-2 focus:ring-sky-400">
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Product list */}
          <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-black text-slate-900">Products</p>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">{filteredProducts.length} items</span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-2 space-y-1.5">
              {filteredProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500 text-center">
                  No products match this search.
                </div>
              ) : filteredProducts.map((product) => {
                const isActive = Number(product.id) === Number(selectedProductId);
                const health = getStockHealth(product);
                return (
                  <button key={product.id} type="button"
                    onClick={() => { setSelectedProductId(Number(product.id)); setOverviewTab('overview'); }}
                    className={`w-full rounded-2xl border p-3 text-left transition-all ${isActive ? 'border-sky-300 bg-sky-50 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900">{product.name}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{product.category || 'General'} · {product.quick_code || '—'}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${healthPill(health)}`}>
                        {health === 'out' ? 'Out' : health === 'low' ? 'Low' : 'OK'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs">
                      <span className="text-slate-500">Price <strong className="text-slate-900">{formatCurrency(getComparablePrice(product))}</strong></span>
                      <span className="text-slate-500">Stock <strong className="text-slate-900">{formatInventoryUnits(getAvailableUnits(product))}</strong></span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Detail panel */}
        <section>
          {!selectedProduct ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[28px] border border-dashed border-slate-200 bg-white p-8 text-center">
              <LayoutGrid className="h-12 w-12 text-slate-300" />
              <h2 className="mt-4 text-xl font-black text-slate-900">No product selected</h2>
              <p className="mt-2 max-w-md text-sm text-slate-500">Choose a product from the left list to open its dedicated overview here.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">

              {/* Product hero */}
              <div className="bg-[linear-gradient(135deg,#0f172a,#1e293b_50%,#1e3a5f)] px-6 py-5 text-white">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex gap-4">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/20 bg-white/10">
                      {selectedProduct.thumbnail ? (
                        <img src={selectedProduct.thumbnail} alt={selectedProduct.name} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Package className="h-7 w-7 text-white/40" />
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#38bdf8]">Dedicated Product Overview</p>
                      <h2 className="mt-1 text-2xl font-black text-white">{selectedProduct.name}</h2>
                      <p className="mt-0.5 text-sm text-[#94a3b8]">View pricing, stock health, and technical specs in one place.</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-white">
                          {selectedProduct.category || 'General'}
                        </span>
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${healthPill(overviewHealth)}`}>
                          {healthLabel(overviewHealth)}
                        </span>
                        {singleConditionLabel && (
                          <span className="rounded-full border border-sky-300/30 bg-sky-400/15 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-sky-100">
                            {singleConditionLabel}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm backdrop-blur">
                    <div className="flex items-center justify-between gap-6">
                      <span className="text-[#94a3b8]">Quick code</span>
                      <span className="font-mono font-black text-white">{selectedProduct.quick_code || '—'}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-6">
                      <span className="text-[#94a3b8]">Barcode</span>
                      <span className="font-mono text-xs font-bold text-white">{selectedProduct.barcode || '—'}</span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-6">
                      <span className="text-[#94a3b8]">Added</span>
                      <span className="font-bold text-white">{formatAddedDate(selectedProduct.created_at)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-slate-100 px-4 py-3">
                {TABS.map((tab) => (
                  <button key={tab.key} type="button" onClick={() => setOverviewTab(tab.key)}
                    className={`rounded-xl px-4 py-2 text-sm font-black transition ${overviewTab === tab.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-5 space-y-4">

                {/* OVERVIEW TAB */}
                {overviewTab === 'overview' && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: 'Selling Price', value: formatCurrency(overviewSellingPrice), color: 'text-slate-900' },
                        ...(canViewCostFields ? [{ label: 'Cost Price', value: formatCurrency(overviewCostPrice), color: 'text-slate-900' }] : []),
                        { label: 'Available Units', value: formatInventoryUnits(overviewAvailableUnits), color: overviewAvailableUnits < 5 ? 'text-rose-600' : 'text-slate-900' },
                        { label: 'On Collection', value: formatInventoryUnits(overviewOnCollection), color: 'text-slate-900' },
                      ].map((c) => (
                        <div key={c.label} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{c.label}</p>
                          <p className={`mt-2 text-2xl font-black ${c.color}`}>{c.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {canViewCostFields && (
                        <>
                          <div className={`rounded-2xl border p-4 ${overviewProfit > 0 ? 'border-emerald-200 bg-emerald-900/20' : overviewProfit < 0 ? 'border-rose-200 bg-rose-900/20' : 'border-slate-100 bg-slate-50'}`}>
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Unit Profit</p>
                            <p className={`mt-2 text-xl font-black ${overviewProfit > 0 ? 'text-emerald-400' : overviewProfit < 0 ? 'text-rose-400' : 'text-slate-900'}`}>{formatCurrency(overviewProfit)}</p>
                          </div>
                          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Markup</p>
                            <p className="mt-2 text-xl font-black text-slate-900">{overviewCostPrice > 0 ? `${overviewMarkup.toFixed(1)}%` : '—'}</p>
                          </div>
                        </>
                      )}
                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Retail Value</p>
                        <p className="mt-2 text-xl font-black text-slate-900">{formatCurrency(overviewSellingPrice * overviewAvailableUnits)}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Store Mode</p>
                        <p className="mt-2 text-xl font-black text-slate-900">{store?.mode === 'GADGET' ? 'Smart Retail' : 'Standard Retail'}</p>
                      </div>
                    </div>
                  </>
                )}

                {/* PRICING TAB */}
                {overviewTab === 'pricing' && (
                  <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-5">
                    <h3 className="text-base font-black text-slate-900">Pricing Breakdown</h3>
                    <p className="mt-0.5 text-sm text-slate-500">Selling, cost, and condition-based pricing.</p>
                    {store?.mode === 'SUPERMARKET' ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                          { label: 'Selling Price', value: formatCurrency(overviewSellingPrice) },
                          ...(canViewCostFields ? [
                            { label: 'Cost Price', value: formatCurrency(overviewCostPrice) },
                            { label: 'Unit Profit', value: formatCurrency(overviewProfit) },
                            { label: 'Markup', value: overviewCostPrice > 0 ? `${overviewMarkup.toFixed(1)}%` : '—' },
                          ] : []),
                        ].map((c) => (
                          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{c.label}</p>
                            <p className="mt-2 text-2xl font-black text-slate-900">{c.value}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {singleConditionLabel && (
                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-sky-700">
                            Condition
                            <span className="rounded-full bg-white px-2 py-0.5 text-sky-900">{singleConditionLabel}</span>
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {[
                          { label: 'Selling Price', value: formatCurrency(overviewSellingPrice) },
                          ...(canViewCostFields ? [
                            { label: 'Cost Price', value: formatCurrency(overviewCostPrice) },
                            { label: 'Unit Profit', value: formatCurrency(overviewProfit) },
                            { label: 'Markup', value: overviewCostPrice > 0 ? `${overviewMarkup.toFixed(1)}%` : '—' },
                          ] : []),
                        ].map((c) => (
                          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{c.label}</p>
                            <p className="mt-2 text-2xl font-black text-slate-900">{c.value}</p>
                          </div>
                        ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STOCK TAB */}
                {overviewTab === 'stock' && (
                  <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-5">
                    <h3 className="text-base font-black text-slate-900">Stock Intelligence</h3>
                    <p className="mt-0.5 text-sm text-slate-500">Availability, on-collection count, and stock posture.</p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: 'Available Units', value: formatInventoryUnits(overviewAvailableUnits), color: overviewAvailableUnits < 5 ? 'text-rose-600' : 'text-slate-900' },
                        { label: 'On Collection', value: formatInventoryUnits(overviewOnCollection), color: 'text-slate-900' },
                        { label: 'Health', value: overviewHealth === 'out' ? 'Out' : overviewHealth === 'low' ? 'Low' : 'Good', color: overviewHealth === 'out' ? 'text-rose-600' : overviewHealth === 'low' ? 'text-amber-600' : 'text-emerald-600' },
                        {
                          label: 'Status Note',
                          value: overviewHealth === 'out' ? 'Needs restock' : overviewHealth === 'low' ? 'Running low' : 'Stock is healthy',
                          color: 'text-slate-300', small: true,
                        },
                      ].map((c: any) => (
                        <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{c.label}</p>
                          <p className={`mt-2 font-black ${c.small ? 'text-sm' : 'text-2xl'} ${c.color}`}>{c.value}</p>
                        </div>
                      ))}
                    </div>
                    {singleConditionLabel && (
                      <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-sky-700">
                        Condition
                        <span className="rounded-full bg-white px-2 py-0.5 text-sky-900">{singleConditionLabel}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* SPECS TAB */}
                {overviewTab === 'specs' && (
                  <div className="rounded-[24px] border border-slate-100 bg-slate-50 p-5">
                    <h3 className="text-base font-black text-slate-900">Product Specifications</h3>
                    <p className="mt-0.5 text-sm text-slate-500">All saved technical details for this product.</p>
                    {overviewSpecs.length === 0 ? (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
                        No specifications saved for this product yet.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {overviewSpecs.map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{label}</p>
                            <p className="mt-2 text-sm font-bold text-slate-900">{String(value)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ProductOverview;

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Home, Loader2, Search, Settings2, ShieldAlert } from 'lucide-react';
import { appFetch } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import StockAdjustmentModal from '../../components/StockAdjustmentModal';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

const parseConditionMatrix = (value: any) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getTrackedUnitCost = (product: any, condition?: unknown) => {
  if (!product) return 0;

  const normalizedCondition = String(condition || '').trim().toLowerCase().replace(/\s+/g, '_');
  const conditionMatrix = parseConditionMatrix(product.condition_matrix);
  const slot = normalizedCondition && conditionMatrix ? conditionMatrix?.[normalizedCondition] : null;
  const slotCost = Number(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);

  if (Number.isFinite(slotCost) && slotCost > 0) {
    return slotCost;
  }

  const productCost = Number(product?.cost ?? 0);
  return Number.isFinite(productCost) && productCost > 0 ? productCost : 0;
};

const getCountEstimate = (entry: any, product?: any) => {
  const variance = Number(entry?.variance_quantity ?? entry?.quantity_change ?? 0) || 0;
  const unitCost = getTrackedUnitCost(product, entry?.condition);
  const estimatedValue = Number((Math.abs(variance) * unitCost).toFixed(2)) || 0;

  return {
    variance,
    unitCost,
    estimatedValue,
    direction: variance < 0 ? 'loss' : variance > 0 ? 'surplus' : 'match',
  };
};

const StockAdjustments: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [adjustments, setAdjustments] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DAMAGED' | 'LOST' | 'FOUND' | 'MANUAL' | 'INTERNAL_USE' | 'RESTOCK' | 'COUNT'>('ALL');
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const deferredSearch = useDeferredValue(search.trim());

  const loadData = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (deferredSearch) query.set('search', deferredSearch);
      if (typeFilter !== 'ALL') query.set('type', typeFilter);

      const [adjustmentData, productData] = await Promise.all([
        appFetch(`/api/stock-adjustments${query.toString() ? `?${query.toString()}` : ''}`),
        appFetch('/api/products?limit=500&offset=0'),
      ]);

      setAdjustments(Array.isArray(adjustmentData) ? adjustmentData : []);
      setProducts(Array.isArray(productData) ? productData : (Array.isArray(productData?.items) ? productData.items : []));
    } catch (err) {
      console.error(err);
      setAdjustments([]);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [deferredSearch, typeFilter]);

  useEffect(() => { setPage(1); }, [deferredSearch, typeFilter]);

  const canReviewCounts = user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER';
  const productsById = useMemo(() => new Map(products.map((product) => [String(product.id), product])), [products]);

  const handleReviewCount = async (entry: any, action: 'approve' | 'reject') => {
    if (!entry?.id) return;

    try {
      setReviewingId(Number(entry.id));
      await appFetch(`/api/stock-adjustments/${entry.id}/${action}`, { method: 'POST' });
      showNotification({
        message: action === 'approve' ? 'Stock recount approved successfully.' : 'Stock recount rejected successfully.',
        type: 'success',
      });
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || `Failed to ${action} stock recount`), type: 'error' });
    } finally {
      setReviewingId(null);
    }
  };

  const summary = useMemo(() => {
    return adjustments.reduce((acc, entry) => {
      const change = Number(entry.quantity_change || 0);
      const rawCostImpact = Number(entry.cost_impact || 0);
      const isCountEntry = String(entry.adjustment_type || '').toUpperCase() === 'COUNT';
      const countEstimate = isCountEntry ? getCountEstimate(entry, productsById.get(String(entry.product_id))) : null;

      acc.totalRecords += 1;
      if (change > 0) acc.unitsAdded += change;
      if (change < 0) acc.unitsRemoved += Math.abs(change);
      if (rawCostImpact < 0) {
        acc.lossValue += Math.abs(rawCostImpact);
      } else if (countEstimate?.direction === 'loss') {
        acc.lossValue += Number(countEstimate.estimatedValue || 0);
      }
      if (String(entry.recount_status || '').toUpperCase() === 'PENDING') acc.pendingCounts += 1;
      return acc;
    }, {
      totalRecords: 0,
      unitsAdded: 0,
      unitsRemoved: 0,
      lossValue: 0,
      pendingCounts: 0,
    });
  }, [adjustments, productsById]);

  const getTypeBadgeClass = (type: string) => {
    if (type === 'DAMAGED' || type === 'LOST') return 'bg-rose-100 text-rose-400';
    if (type === 'FOUND' || type === 'RESTOCK') return 'bg-emerald-100 text-emerald-400';
    if (type === 'COUNT') return 'bg-indigo-100 text-indigo-400';
    return 'bg-slate-100 text-slate-300';
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Inventory Control</p>
          <h1 className="text-2xl font-bold text-slate-900">Stock Adjustments & Loss Control</h1>
          <p className="text-slate-500">Track damaged items, missing stock, restocks, found goods, and manual count corrections.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/inventory" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            <Home size={16} /> Inventory
          </Link>
          <button
            type="button"
            onClick={() => setShowAdjustmentModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800"
          >
            <Settings2 size={16} /> New Adjustment
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Records</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{summary.totalRecords}</p>
          <p className="mt-1 text-xs text-slate-500">Logged stock change entries</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Units Added</p>
          <p className="mt-2 text-[2rem] font-black leading-none text-emerald-800">{summary.unitsAdded}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-700">Restocks and found inventory</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50 p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-rose-700">Units Removed</p>
          <p className="mt-2 text-[2rem] font-black leading-none text-rose-800">{summary.unitsRemoved}</p>
          <p className="mt-1 text-xs font-semibold text-rose-700">Losses, damages, and internal use</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">Estimated Loss Value</p>
          <p className="mt-2 text-[2rem] font-black leading-none text-amber-800">{formatCurrency(summary.lossValue)}</p>
          <p className="mt-1 text-xs font-semibold text-amber-700">Based on product cost</p>
        </div>
      </div>

      {summary.pendingCounts > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-900/20 px-4 py-3 text-sm font-semibold text-amber-300 shadow-sm">
          {summary.pendingCounts} stock recount {summary.pendingCounts === 1 ? 'is' : 'are'} awaiting manager or owner approval.
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'DAMAGED', 'LOST', 'FOUND', 'MANUAL', 'INTERNAL_USE', 'RESTOCK', 'COUNT'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTypeFilter(value)}
              className={`rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-widest transition-colors ${typeFilter === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {value.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, note, or adjustment type..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
        </div>
      </div>

      <div className="space-y-4">
        {adjustments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <ShieldAlert className="mx-auto mb-3 text-slate-300" size={28} />
            <h2 className="text-lg font-bold text-slate-900">No stock adjustments recorded yet</h2>
            <p className="mt-1 text-sm text-slate-500">Use the button above to log damaged goods, missing units, restocks, or stock-count corrections.</p>
          </div>
        ) : adjustments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((entry) => {
          const isCountEntry = String(entry.adjustment_type || '').toUpperCase() === 'COUNT';
          const countEstimate = isCountEntry ? getCountEstimate(entry, productsById.get(String(entry.product_id))) : null;
          const hasVarianceEstimate = Boolean(isCountEntry && countEstimate && Number(countEstimate.variance || 0) !== 0);

          return (
            <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-black text-slate-900">{entry.product_name}</p>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${getTypeBadgeClass(String(entry.adjustment_type || 'MANUAL'))}`}>
                      {String(entry.adjustment_type || 'MANUAL').replace(/_/g, ' ')}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                      {String(entry.adjustment_mode || 'DECREASE').replace(/_/g, ' ')}
                    </span>
                    {isCountEntry && (
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${String(entry.recount_status || '').toUpperCase() === 'PENDING' ? 'bg-amber-100 text-amber-400' : String(entry.recount_status || '').toUpperCase() === 'APPROVED' ? 'bg-emerald-100 text-emerald-400' : String(entry.recount_status || '').toUpperCase() === 'REJECTED' ? 'bg-rose-100 text-rose-400' : 'bg-slate-100 text-slate-300'}`}>
                        {String(entry.recount_status || 'NOT_REQUIRED').replace(/_/g, ' ')}
                      </span>
                    )}
                    {entry.condition && (
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-blue-400">
                        {String(entry.condition).replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600">{entry.category_name || 'General'} · by {entry.adjusted_by_username || 'Staff'} · {new Date(entry.created_at).toLocaleString()}</p>
                  {entry.note && (
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-300">
                      {entry.note}
                    </div>
                  )}
                  {isCountEntry && (
                    <div className="rounded-2xl border border-blue-700/30 bg-blue-900/20 px-3 py-3 text-sm text-blue-300">
                      <p>
                        Counted quantity: <span className="font-black">{entry.counted_quantity ?? entry.quantity_after}</span> · Variance: <span className="font-black">{Number(entry.variance_quantity || 0) > 0 ? '+' : ''}{Number(entry.variance_quantity || 0)}</span>
                      </p>
                      <p className="mt-1 text-xs text-blue-400">
                        {String(entry.recount_status || '').toUpperCase() === 'PENDING'
                          ? `Awaiting approval. Live stock remains at ${entry.quantity_before} until a manager or store owner reviews it.`
                          : String(entry.recount_status || '').toUpperCase() === 'REJECTED'
                            ? `This recount was rejected${entry.approved_by_username ? ` by ${entry.approved_by_username}` : ''}.`
                            : `Reviewed${entry.approved_by_username ? ` by ${entry.approved_by_username}` : ''}${entry.approved_at ? ` on ${new Date(entry.approved_at).toLocaleString()}` : ''}.`}
                      </p>
                      {hasVarianceEstimate && (
                        <p className="mt-1 text-xs text-blue-400">
                          {Number(countEstimate?.unitCost || 0) > 0
                            ? `Estimated ${countEstimate?.direction === 'loss' ? 'loss value' : 'surplus value'}: ${Math.abs(Number(countEstimate?.variance || 0))} × ${formatCurrency(Number(countEstimate?.unitCost || 0))} = ${formatCurrency(Number(countEstimate?.estimatedValue || 0))}.`
                            : 'Estimated variance value will appear once a unit cost is set for this product.'}
                        </p>
                      )}
                    </div>
                  )}
                  {canReviewCounts && String(entry.recount_status || '').toUpperCase() === 'PENDING' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={reviewingId === Number(entry.id)}
                        onClick={() => handleReviewCount(entry, 'approve')}
                        className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Approve count
                      </button>
                      <button
                        type="button"
                        disabled={reviewingId === Number(entry.id)}
                        onClick={() => handleReviewCount(entry, 'reject')}
                        className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-widest text-rose-400 hover:bg-rose-900/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[26rem]">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Movement</p>
                    <p className={`mt-1 text-xl font-black ${Number(entry.quantity_change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {Number(entry.quantity_change || 0) >= 0 ? '+' : ''}{Number(entry.quantity_change || 0)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Before → After</p>
                    <p className="mt-1 text-lg font-black text-slate-900">{entry.quantity_before} → {entry.quantity_after}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Cost impact</p>
                    <p className={`mt-1 text-lg font-black ${Number(entry.cost_impact || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {formatCurrency(Number(entry.cost_impact || 0))}
                    </p>
                    {hasVarianceEstimate && (
                      <p className="mt-1 text-[10px] font-semibold text-slate-500">
                        {Number(countEstimate?.unitCost || 0) > 0
                          ? `Est. ${countEstimate?.direction === 'loss' ? 'loss' : 'surplus'}: ${Math.abs(Number(countEstimate?.variance || 0))} × ${formatCurrency(Number(countEstimate?.unitCost || 0))}`
                          : 'Set unit cost to show estimate'}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {adjustments.length > PAGE_SIZE && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-slate-600">
              Page {page} of {Math.ceil(adjustments.length / PAGE_SIZE)} &bull; {adjustments.length} records
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(Math.ceil(adjustments.length / PAGE_SIZE), p + 1))}
              disabled={page === Math.ceil(adjustments.length / PAGE_SIZE)}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>

      <StockAdjustmentModal
        isOpen={showAdjustmentModal}
        products={products}
        onClose={() => setShowAdjustmentModal(false)}
        onSaved={loadData}
      />
    </div>
  );
};

export default StockAdjustments;

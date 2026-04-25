import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Package, Settings2, X } from 'lucide-react';
import { appFetch } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { useNotification } from '../context/NotificationContext';

type StockAdjustmentModalProps = {
  isOpen: boolean;
  products: any[];
  selectedProduct?: any | null;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
};

const getProductAvailableStock = (product: any, condition: string) => {
  if (!product) return 0;
  if (product.condition_matrix && condition) {
    const key = String(condition || '').toLowerCase();
    return Math.max(0, Number(product.condition_matrix?.[key]?.stock || 0));
  }
  return Math.max(0, Number(product.stock || 0));
};

const getTrackedUnitCost = (product: any, condition?: unknown) => {
  if (!product) return 0;

  const normalizedCondition = String(condition || '').trim().toLowerCase().replace(/\s+/g, '_');
  const slot = normalizedCondition ? product?.condition_matrix?.[normalizedCondition] : null;
  const slotCost = Number(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);

  if (Number.isFinite(slotCost) && slotCost > 0) {
    return slotCost;
  }

  const productCost = Number(product?.cost ?? 0);
  return Number.isFinite(productCost) && productCost > 0 ? productCost : 0;
};

const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  isOpen,
  products,
  selectedProduct,
  onClose,
  onSaved,
}) => {
  const { showNotification } = useNotification();
  const [form, setForm] = useState({
    product_id: '',
    adjustment_type: 'MANUAL',
    adjustment_mode: 'DECREASE',
    quantity: '1',
    condition: '',
    note: '',
  });
  const [saving, setSaving] = useState(false);
  const isCountValidation = form.adjustment_type === 'COUNT';

  useEffect(() => {
    if (!isOpen) return;

    const initialProductId = selectedProduct?.id ? String(selectedProduct.id) : '';
    const hasConditions = Boolean(selectedProduct?.condition_matrix);
    const firstCondition = hasConditions
      ? (Object.keys(selectedProduct?.condition_matrix || {}).find((key) => Number(selectedProduct?.condition_matrix?.[key]?.stock || 0) >= 0) || 'new')
      : '';

    setForm({
      product_id: initialProductId,
      adjustment_type: 'MANUAL',
      adjustment_mode: 'DECREASE',
      quantity: '1',
      condition: firstCondition,
      note: '',
    });
  }, [isOpen, selectedProduct]);

  const currentProduct = useMemo(() => {
    return products.find((product) => String(product.id) === String(form.product_id)) || selectedProduct || null;
  }, [products, selectedProduct, form.product_id]);

  const hasConditions = Boolean(currentProduct?.condition_matrix);
  const currentStock = useMemo(() => getProductAvailableStock(currentProduct, form.condition), [currentProduct, form.condition]);
  const estimatedAfter = useMemo(() => {
    const qty = Math.max(0, Number(form.quantity) || 0);
    if (form.adjustment_mode === 'SET') return qty;
    if (form.adjustment_mode === 'INCREASE') return currentStock + qty;
    return Math.max(0, currentStock - qty);
  }, [form.adjustment_mode, form.quantity, currentStock]);
  const estimatedDelta = useMemo(() => (
    form.adjustment_mode === 'SET'
      ? estimatedAfter - currentStock
      : form.adjustment_mode === 'INCREASE'
        ? Math.max(0, Number(form.quantity) || 0)
        : -Math.max(0, Number(form.quantity) || 0)
  ), [estimatedAfter, currentStock, form.adjustment_mode, form.quantity]);
  const estimatedUnitCost = useMemo(() => getTrackedUnitCost(currentProduct, form.condition), [currentProduct, form.condition]);
  const estimatedValue = useMemo(() => Number((Math.abs(estimatedDelta) * estimatedUnitCost).toFixed(2)) || 0, [estimatedDelta, estimatedUnitCost]);

  useEffect(() => {
    if (!hasConditions) {
      setForm((prev) => ({ ...prev, condition: '' }));
      return;
    }

    if (!form.condition) {
      const nextCondition = Object.keys(currentProduct?.condition_matrix || {}).find((key) => Number(currentProduct?.condition_matrix?.[key]?.stock || 0) >= 0) || 'new';
      setForm((prev) => ({ ...prev, condition: nextCondition }));
    }
  }, [currentProduct, hasConditions, form.condition]);

  useEffect(() => {
    if (form.adjustment_type === 'COUNT' && form.adjustment_mode !== 'SET') {
      setForm((prev) => ({ ...prev, adjustment_mode: 'SET' }));
    }
  }, [form.adjustment_type, form.adjustment_mode]);

  const handleSubmit = async () => {
    if (!form.product_id) {
      showNotification({ message: 'Please select a product first.', type: 'error' });
      return;
    }

    const quantity = Number(form.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || (form.adjustment_mode !== 'SET' && quantity <= 0)) {
      showNotification({ message: 'Enter a valid quantity for this adjustment.', type: 'error' });
      return;
    }

    try {
      setSaving(true);
      const recountStatus = String((await appFetch('/api/stock-adjustments', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(form.product_id),
          adjustment_type: form.adjustment_type,
          adjustment_mode: form.adjustment_mode,
          quantity,
          condition: form.condition || null,
          note: form.note.trim(),
        }),
      }))?.adjustment?.recount_status || '').toUpperCase();

      showNotification({
        message: recountStatus === 'PENDING'
          ? 'Stock recount submitted for manager approval.'
          : isCountValidation
            ? 'Stock count validation saved successfully.'
            : 'Stock adjustment saved successfully.',
        type: 'success',
      });
      await onSaved?.();
      onClose();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save stock adjustment'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-blue-100 p-3 text-blue-400">
              <Settings2 size={22} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Inventory Control</p>
              <h2 className="text-2xl font-black text-slate-900">Stock Adjustment</h2>
              <p className="text-sm text-slate-500">Record damaged, lost, found, restock, or manual stock corrections.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_0.9fr]">
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Product</label>
              <select
                value={form.product_id}
                onChange={(e) => setForm((prev) => ({ ...prev, product_id: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
              >
                <option value="">Select inventory item</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Adjustment type</label>
                <select
                  value={form.adjustment_type}
                  onChange={(e) => setForm((prev) => ({ ...prev, adjustment_type: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="MANUAL">Manual correction</option>
                  <option value="DAMAGED">Damaged stock</option>
                  <option value="LOST">Lost / missing</option>
                  <option value="FOUND">Found stock</option>
                  <option value="RESTOCK">Restock</option>
                  <option value="INTERNAL_USE">Internal use</option>
                  <option value="COUNT">Stock count validation</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Adjustment mode</label>
                <select
                  value={form.adjustment_mode}
                  onChange={(e) => setForm((prev) => ({ ...prev, adjustment_mode: e.target.value }))}
                  disabled={isCountValidation}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <option value="DECREASE">Remove units</option>
                  <option value="INCREASE">Add units</option>
                  <option value="SET">Set exact stock</option>
                </select>
              </div>
            </div>

            {hasConditions && (
              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Condition</label>
                <select
                  value={form.condition}
                  onChange={(e) => setForm((prev) => ({ ...prev, condition: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
                >
                  {Object.keys(currentProduct?.condition_matrix || {}).map((key) => (
                    <option key={key} value={key}>{key.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">
                {form.adjustment_mode === 'SET' ? (isCountValidation ? 'Counted quantity' : 'New stock quantity') : 'Quantity'}
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.quantity}
                onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Note</label>
              <textarea
                value={form.note}
                onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                rows={4}
                placeholder={isCountValidation ? 'Who counted it, why the recount was done, or any variance note' : 'Optional details about why this stock was adjusted'}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center gap-2 text-slate-900">
                <Package size={18} className="text-slate-500" />
                <h3 className="font-black">Adjustment preview</h3>
              </div>

              {currentProduct ? (
                <div className="space-y-3 text-sm text-slate-700">
                  <div>
                    <p className="font-bold text-slate-900">{currentProduct.name}</p>
                    <p className="text-xs text-slate-500">{currentProduct.category || 'General'}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-3">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Current stock</p>
                      <p className="mt-1 text-xl font-black text-slate-900">{currentStock}</p>
                    </div>
                    <div className="rounded-2xl border border-blue-700/30 bg-blue-900/20 p-3">
                      <p className="text-[11px] font-black uppercase tracking-widest text-blue-400">After save</p>
                      <p className="mt-1 text-xl font-black text-blue-300">{estimatedAfter}</p>
                    </div>
                  </div>

                  {hasConditions && form.condition && (
                    <p className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 inline-flex">
                      Condition: {form.condition.replace(/_/g, ' ')}
                    </p>
                  )}

                  {isCountValidation && (
                    <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 p-3 text-sm text-amber-300">
                      <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">Count validation</p>
                      <p className="mt-1">
                        Variance: <span className="font-black">{estimatedDelta > 0 ? '+' : ''}{estimatedDelta}</span>
                        {estimatedAfter !== currentStock ? ' unit(s) compared with the system count.' : ' unit(s) — this matches the current system stock.'}
                      </p>
                      <p className="mt-1 text-xs text-amber-400">If there is a variance, a manager or store owner will be able to approve the recount before it updates live stock.</p>
                      {estimatedDelta !== 0 && (
                        <p className="mt-1 text-xs text-amber-400">
                          {estimatedUnitCost > 0
                            ? `Estimated ${estimatedDelta < 0 ? 'loss value' : 'surplus value'}: ${Math.abs(estimatedDelta)} × ${formatCurrency(estimatedUnitCost)} = ${formatCurrency(estimatedValue)}.`
                            : 'Add a unit cost on this product to show the estimated value of the variance.'}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">{isCountValidation ? 'Estimated value if approved' : 'Estimated cost impact'}</p>
                      <p className="mt-1 text-lg font-black text-slate-900">
                      {formatCurrency(isCountValidation ? estimatedValue : estimatedDelta * estimatedUnitCost)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {estimatedUnitCost > 0
                        ? `Based on unit cost of ${formatCurrency(estimatedUnitCost)}`
                        : 'Set a unit cost on this product to improve this estimate'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                  Select a product to see the current stock and adjustment preview.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-amber-700/30 bg-amber-900/20 p-4 text-sm text-amber-300">
              <p className="font-black uppercase tracking-widest text-[11px]">Loss control note</p>
              <p className="mt-2">Use this for damaged goods, missing items, restocks, stock counting, and internal-use withdrawals so every inventory change stays auditable.</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Settings2 size={16} />}
            {saving ? 'Saving...' : 'Save Adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockAdjustmentModal;

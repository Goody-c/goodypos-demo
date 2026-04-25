import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Package, RotateCcw, WalletCards, X } from 'lucide-react';
import { appFetch } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { useNotification } from '../context/NotificationContext';

type ReturnSaleModalProps = {
  isOpen: boolean;
  sale: any;
  onClose: () => void;
  onSuccess?: (payload?: any) => void | Promise<void>;
};

const ReturnSaleModal: React.FC<ReturnSaleModalProps> = ({ isOpen, sale, onClose, onSuccess }) => {
  const { showNotification } = useNotification();
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [returnType, setReturnType] = useState<'REFUND' | 'EXCHANGE' | 'RETURN_ONLY'>('REFUND');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'transfer' | 'pos' | 'store_credit' | 'other'>('cash');
  const [refundAmount, setRefundAmount] = useState('0');
  const [refundEdited, setRefundEdited] = useState(false);
  const [restockItems, setRestockItems] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQuantities({});
    setReason('');
    setNote('');
    setReturnType('REFUND');
    setRefundMethod('cash');
    setRefundAmount('0');
    setRefundEdited(false);
    setRestockItems(true);
  }, [isOpen, sale?.id]);

  const saleItems = useMemo(() => (Array.isArray(sale?.items) ? sale.items : []), [sale]);

  const selectedItems = useMemo(() => {
    return saleItems
      .map((item: any) => {
        const requestedQuantity = Math.max(0, Number(quantities[item.id]) || 0);
        const availableQuantity = Math.max(0, Number(item.returnable_quantity ?? item.quantity) || 0);
        const finalQuantity = Math.min(requestedQuantity, availableQuantity);

        if (!finalQuantity) {
          return null;
        }

        return {
          sale_item_id: Number(item.id),
          quantity: finalQuantity,
          subtotal: finalQuantity * (Number(item.price_at_sale || 0) || 0),
          product_name: item.product_name || item.name || 'Product',
        };
      })
      .filter(Boolean) as Array<{ sale_item_id: number; quantity: number; subtotal: number; product_name: string }>;
  }, [quantities, saleItems]);

  const calculatedReturnValue = useMemo(() => {
    return selectedItems.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
  }, [selectedItems]);

  useEffect(() => {
    if (!isOpen || refundEdited) return;
    setRefundAmount(returnType === 'REFUND' && calculatedReturnValue ? calculatedReturnValue.toFixed(2) : '0');
  }, [calculatedReturnValue, isOpen, refundEdited, returnType]);

  const handleQuantityChange = (itemId: number, nextValue: string, maxValue: number) => {
    const parsed = Math.max(0, Math.min(maxValue, Number(nextValue) || 0));
    setQuantities((prev) => ({
      ...prev,
      [itemId]: nextValue === '' ? '' : String(parsed),
    }));
  };

  const handleSubmit = async () => {
    if (!sale?.id || submitting) return;

    if (selectedItems.length === 0) {
      showNotification({ message: 'Select at least one item quantity to return.', type: 'error' });
      return;
    }

    if (reason.trim().length < 3) {
      showNotification({ message: 'Please enter a reason for this return.', type: 'error' });
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        items: selectedItems.map((item) => ({ sale_item_id: item.sale_item_id, quantity: item.quantity })),
        reason: reason.trim(),
        note: note.trim(),
        return_type: returnType,
        refund_method: refundMethod,
        refund_amount: Math.max(0, Number(refundAmount) || 0),
        restock_items: restockItems,
      };

      const result = await appFetch(`/api/sales/${sale.id}/returns`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showNotification({ message: 'Return processed successfully.', type: 'success' });
      await onSuccess?.(result);
      onClose();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to process return'), type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex h-[min(92vh,54rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-amber-100 p-3 text-amber-400">
              <RotateCcw size={24} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Returns & Refunds</p>
              <h2 className="text-2xl font-black text-slate-900">Process Sale Return</h2>
              <p className="text-sm text-slate-500">Sale #{sale?.id} · {sale?.customer_name || 'Walk-in Customer'}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-300">
            <X size={20} />
          </button>
        </div>

        <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[1.3fr_0.8fr]">
          <div className="overflow-y-auto border-b border-slate-100 p-6 lg:border-b-0 lg:border-r">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Original Total</p>
                <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(Number(sale?.total || 0))}</p>
              </div>
              <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">Already Returned</p>
                <p className="mt-1 text-lg font-black text-amber-300">{formatCurrency(Number(sale?.returned_amount || 0))}</p>
              </div>
              <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 p-3">
                <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">Current Balance</p>
                <p className="mt-1 text-lg font-black text-emerald-300">{formatCurrency(Number(sale?.amount_due || 0))}</p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <h3 className="font-black text-slate-900">Select items to return</h3>
                  <p className="text-xs text-slate-500">Only remaining returnable quantities can be processed.</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">
                  {saleItems.length} line item(s)
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {saleItems.map((item: any) => {
                  const soldQty = Math.max(0, Number(item.quantity) || 0);
                  const returnedQty = Math.max(0, Number(item.returned_quantity) || 0);
                  const availableQty = Math.max(0, Number(item.returnable_quantity ?? soldQty - returnedQty) || 0);

                  return (
                    <div key={`${sale?.id}-${item.id}`} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900">{item.product_name || item.name || 'Product'}</p>
                        <p className="text-sm text-slate-500">
                          {formatCurrency(Number(item.price_at_sale || 0))} each · Sold {soldQty}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Returned: {returnedQty}</span>
                          <span className={`rounded-full px-2.5 py-1 ${availableQty > 0 ? 'bg-emerald-100 text-emerald-400' : 'bg-rose-100 text-rose-400'}`}>
                            Returnable: {availableQty}
                          </span>
                          {String(item.item_source || '').toUpperCase() === 'SOURCED' && (
                            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-400">Return to Vendor</span>
                          )}
                          {item.condition && (
                            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-400">{String(item.condition).replace(/_/g, ' ')}</span>
                          )}
                        </div>
                      </div>

                      <div className="w-full sm:w-36">
                        <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Qty to return</label>
                        <input
                          type="number"
                          min={0}
                          max={availableQty}
                          step={1}
                          disabled={availableQty <= 0}
                          value={quantities[item.id] ?? ''}
                          onChange={(e) => handleQuantityChange(Number(item.id), e.target.value, availableQty)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="overflow-y-auto bg-slate-50 p-6">
            <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <WalletCards size={18} className="text-slate-500" />
                <h3 className="font-black">Return details</h3>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Reason</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this item coming back?"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Type</label>
                <select
                  value={returnType}
                  onChange={(e) => setReturnType(e.target.value as 'REFUND' | 'EXCHANGE' | 'RETURN_ONLY')}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                >
                  <option value="REFUND">Refund</option>
                  <option value="EXCHANGE">Exchange</option>
                  <option value="RETURN_ONLY">Return only</option>
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Refund method</label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'transfer' | 'pos' | 'store_credit' | 'other')}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="cash">Cash</option>
                    <option value="transfer">Transfer</option>
                    <option value="pos">POS</option>
                    <option value="store_credit">Store credit</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Refund amount</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={refundAmount}
                    onChange={(e) => {
                      setRefundEdited(true);
                      setRefundAmount(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-black uppercase tracking-widest text-slate-500">Internal note</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Optional staff note"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={restockItems}
                  onChange={(e) => setRestockItems(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <span>
                  <span className="block font-bold text-slate-900">Restore returned items back into inventory</span>
                  <span className="text-xs text-slate-500">Untick this if the item came back damaged or should not be sold again.</span>
                </span>
              </label>
            </div>

            <div className="mt-4 space-y-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-900">
                <Package size={18} className="text-slate-500" />
                <h3 className="font-black">Summary</h3>
              </div>

              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex justify-between">
                  <span>Selected items</span>
                  <span className="font-bold text-slate-900">{selectedItems.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Return value</span>
                  <span className="font-bold text-slate-900">{formatCurrency(calculatedReturnValue)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Refund to issue</span>
                  <span className="font-bold text-slate-900">{formatCurrency(Number(refundAmount) || 0)}</span>
                </div>
              </div>

              {selectedItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  Pick at least one quantity above to continue.
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedItems.map((item) => (
                    <div key={item.sale_item_id} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-300">
                      <p className="font-bold text-slate-900">{item.product_name}</p>
                      <p>{item.quantity} unit(s) · {formatCurrency(item.subtotal)}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 px-3 py-3 text-xs text-amber-300">
                <div className="mb-1 flex items-center gap-2 font-black uppercase tracking-widest">
                  <AlertTriangle size={14} /> Important
                </div>
                Each return is logged permanently and the remaining invoice balance will adjust automatically.
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-4 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}
            {submitting ? 'Processing...' : 'Confirm Return'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReturnSaleModal;

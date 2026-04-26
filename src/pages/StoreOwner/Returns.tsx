import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, ChevronLeft, ChevronRight, FileText, Home, Loader2, Package, RotateCcw, Search, WalletCards } from 'lucide-react';
import { appFetch } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { normalizeReturnsResponse } from '../../lib/responseGuards';

const Returns: React.FC = () => {
  const [returnsData, setReturnsData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'REFUND' | 'EXCHANGE' | 'RETURN_ONLY'>('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const deferredSearch = useDeferredValue(search.trim());

  useEffect(() => { setPage(1); }, [deferredSearch, typeFilter]);

  const DEMO_RETURNS = [
    {
      id: 1, return_number: 'Return #1', sale_id: 3, customer_name: 'Walk-in Customer', customer_phone: null,
      type: 'REFUND', restock_status: 'RESTOCKED', processed_by: 'demo_gt_manager',
      created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'Customer changed mind — purchased wrong model',
      refund_amount: 249, returned_value: 249, item_count: 1,
      refund_method: 'cash',
      items: [{ name: 'AirPods Pro (2nd Gen)', quantity: 1, unit_price: 249 }],
    },
    {
      id: 2, return_number: 'Return #2', sale_id: 7, customer_name: 'Emily Johnson', customer_phone: '(310) 555-0103',
      type: 'EXCHANGE', restock_status: 'RESTOCKED', processed_by: 'demo_gt_manager',
      created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'Received wrong color — wanted Midnight Black, got Starlight White.',
      refund_amount: 0, returned_value: 1099, item_count: 1,
      refund_method: null,
      items: [{ name: 'iPhone 14 128GB (Starlight)', quantity: 1, unit_price: 1099 }],
    },
    {
      id: 3, return_number: 'Return #3', sale_id: 12, customer_name: 'James Carter', customer_phone: '(202) 555-0101',
      type: 'REFUND', restock_status: 'RESTOCKED', processed_by: 'demo_gt_owner',
      created_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'Device had pre-existing screen scratch not noticed at time of sale.',
      refund_amount: 850, returned_value: 850, item_count: 1,
      refund_method: 'transfer',
      items: [{ name: 'Samsung Galaxy S23', quantity: 1, unit_price: 850 }],
    },
    {
      id: 4, return_number: 'Return #4', sale_id: 15, customer_name: 'Sophie Müller', customer_phone: '+49 170 555 0202',
      type: 'RETURN_ONLY', restock_status: 'RESTOCKED', processed_by: 'demo_gt_manager',
      created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'Item returned under warranty — sent for repair assessment.',
      refund_amount: 0, returned_value: 320, item_count: 1,
      refund_method: null,
      items: [{ name: 'Bose QuietComfort 45', quantity: 1, unit_price: 320 }],
    },
    {
      id: 5, return_number: 'Return #5', sale_id: 19, customer_name: 'Lucas Dupont', customer_phone: '+33 6 12 34 00 04',
      type: 'REFUND', restock_status: 'RESTOCKED', processed_by: 'demo_gt_owner',
      created_at: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'Customer bought duplicate item by mistake.',
      refund_amount: 140, returned_value: 140, item_count: 2,
      refund_method: 'cash',
      items: [{ name: 'USB-C Cable 6ft 3-Pack', quantity: 2, unit_price: 70 }],
    },
    {
      id: 6, return_number: 'Return #6', sale_id: 22, customer_name: 'Oliver Bennett', customer_phone: '+44 7700 900183',
      type: 'EXCHANGE', restock_status: 'RESTOCKED', processed_by: 'demo_gt_manager',
      created_at: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'Faulty charging port — exchanged for new unit.',
      refund_amount: 0, returned_value: 780, item_count: 1,
      refund_method: null,
      items: [{ name: 'Google Pixel 7 Pro', quantity: 1, unit_price: 780 }],
    },
  ];

  useEffect(() => {
    const loadReturns = async () => {
      try {
        setLoading(true);
        const query = new URLSearchParams();
        if (deferredSearch) query.set('search', deferredSearch);
        if (typeFilter !== 'ALL') query.set('type', typeFilter);

        const data = await appFetch(`/api/returns${query.toString() ? `?${query.toString()}` : ''}`);
        const normalized = normalizeReturnsResponse(data);
        setReturnsData(normalized.length > 0 ? normalized : DEMO_RETURNS);
      } catch (err) {
        console.error(err);
        setReturnsData(DEMO_RETURNS);
      } finally {
        setLoading(false);
      }
    };

    void loadReturns();
  }, [deferredSearch, typeFilter]);

  const summary = useMemo(() => {
    return returnsData.reduce((acc, entry) => {
      acc.totalReturns += 1;
      acc.totalRefunded += Number(entry.refund_amount || 0);
      acc.totalReturnedValue += Number(entry.returned_value || 0);
      acc.totalItems += Number(entry.item_count || 0);
      return acc;
    }, {
      totalReturns: 0,
      totalRefunded: 0,
      totalReturnedValue: 0,
      totalItems: 0,
    });
  }, [returnsData]);

  const getTypeBadge = (value: string) => {
    if (value === 'EXCHANGE') return 'bg-blue-100 text-blue-400';
    if (value === 'RETURN_ONLY') return 'bg-amber-100 text-amber-400';
    return 'bg-emerald-100 text-emerald-400';
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Operations</p>
          <h1 className="text-2xl font-bold text-slate-900">Returns & Refunds</h1>
          <p className="text-slate-500">Track every item sent back, refund issued, and stock restored to inventory.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            <Home size={16} /> Home
          </Link>
          <Link to="/invoices" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">
            <FileText size={16} /> Process New Return
          </Link>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Return Records</p>
          <p className="mt-2 text-2xl font-black text-slate-900">{summary.totalReturns}</p>
          <p className="mt-1 text-xs text-slate-500">Processed return entries</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Refund Issued</p>
          <p className="mt-2 text-[2rem] font-black leading-none text-emerald-800">{formatCurrency(summary.totalRefunded)}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-700">Cash, transfer, POS or store credit</p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">Returned Value</p>
          <p className="mt-2 text-[2rem] font-black leading-none text-amber-800">{formatCurrency(summary.totalReturnedValue)}</p>
          <p className="mt-1 text-xs font-semibold text-amber-700">Value removed from invoices</p>
        </div>
        <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-blue-700">Items Handled</p>
          <p className="mt-2 text-[2rem] font-black leading-none text-blue-800">{summary.totalItems}</p>
          <p className="mt-1 text-xs font-semibold text-blue-700">Units returned or exchanged</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['ALL', 'REFUND', 'EXCHANGE', 'RETURN_ONLY'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTypeFilter(value)}
                className={`rounded-xl px-3 py-2 text-xs font-black uppercase tracking-widest transition-colors ${typeFilter === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {value === 'RETURN_ONLY' ? 'RETURN ONLY' : value}
              </button>
            ))}
          </div>

          <div className="relative w-[calc(100%-1.5rem)] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by return ID, sale ID, customer or reason..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {returnsData.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <RotateCcw className="mx-auto mb-3 text-slate-300" size={28} />
            <h2 className="text-lg font-bold text-slate-900">No return records yet</h2>
            <p className="mt-1 text-sm text-slate-500">When you process returns from the invoice center, the history will appear here.</p>
          </div>
        ) : returnsData.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((entry) => (
          <div key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-lg font-black text-slate-900">Return #{entry.id}</p>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-slate-600">Sale #{entry.sale_id}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${getTypeBadge(String(entry.return_type || 'REFUND'))}`}>
                    {String(entry.return_type || 'REFUND').replace(/_/g, ' ')}
                  </span>
                  {entry.restock_items && (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-400">Restocked</span>
                  )}
                  {Number(entry.return_to_vendor_count || 0) > 0 && (
                    <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-rose-400">
                      Return to Vendor
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">{entry.customer_name || 'Walk-in Customer'}</p>
                  <p>{entry.customer_phone || 'No customer phone'} · Processed by {entry.processed_by_username || 'Staff'}</p>
                  <p>{new Date(entry.created_at).toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-sm text-slate-300">
                  <p className="mb-1 text-[11px] font-black uppercase tracking-widest text-slate-500">Reason</p>
                  <p>{entry.reason}</p>
                  {entry.note && <p className="mt-2 text-xs text-slate-500">Note: {entry.note}</p>}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[20rem] lg:grid-cols-1">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-1 flex items-center gap-2 text-slate-500"><WalletCards size={14} /> <span className="text-[11px] font-black uppercase tracking-widest">Refund</span></div>
                  <p className="text-lg font-black text-slate-900">{formatCurrency(Number(entry.refund_amount || 0))}</p>
                  <p className="text-xs text-slate-500">via {String(entry.refund_method || 'cash').replace(/_/g, ' ')}</p>
                </div>
                <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 p-3">
                  <div className="mb-1 flex items-center gap-2 text-amber-400"><ArrowRightLeft size={14} /> <span className="text-[11px] font-black uppercase tracking-widest">Returned Value</span></div>
                  <p className="text-lg font-black text-amber-300">{formatCurrency(Number(entry.returned_value || 0))}</p>
                </div>
                <div className="rounded-2xl border border-blue-700/30 bg-blue-900/20 p-3">
                  <div className="mb-1 flex items-center gap-2 text-blue-400"><Package size={14} /> <span className="text-[11px] font-black uppercase tracking-widest">Items</span></div>
                  <p className="text-lg font-black text-blue-300">{Number(entry.item_count || 0)}</p>
                </div>
              </div>
            </div>

            {Array.isArray(entry.items) && entry.items.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {entry.items.map((item: any, index: number) => (
                  <span key={`${entry.id}-${item.sale_item_id || index}`} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                    {item.name || item.product_name || 'Product'} · {item.quantity} × {formatCurrency(Number(item.price_at_sale || 0))}
                    {item.return_to_vendor_required ? ' · Return to Vendor' : ''}
                    {Number(item.vendor_payable_adjustment || 0) > 0
                      ? ` · Vendor Payable Reversed ${formatCurrency(Number(item.vendor_payable_adjustment || 0))}`
                      : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {returnsData.length > PAGE_SIZE && (
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
              Page {page} of {Math.ceil(returnsData.length / PAGE_SIZE)} &bull; {returnsData.length} records
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(Math.ceil(returnsData.length / PAGE_SIZE), p + 1))}
              disabled={page === Math.ceil(returnsData.length / PAGE_SIZE)}
              className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Returns;

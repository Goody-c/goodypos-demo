import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { openWhatsAppShare } from '../lib/utils';
import WhatsAppPreviewModal from '../components/WhatsAppPreviewModal';
import { normalizeVendorPortalResponse } from '../lib/responseGuards';
import { getCollectedStatsFromItems } from '../lib/vendorMetrics';

type VendorPortalResponse = {
  store: {
    id: number;
    name: string;
    currency_code: string;
  };
  vendor: {
    id: string;
    name: string;
    phone: string;
    address: string;
  };
  summary: {
    total_records: number;
    active_units: number;
    collected_records: number;
    collected_units: number;
    sold_units: number;
    sold_amount: number;
    returned_units: number;
    customer_return_events: number;
    customer_returned_units: number;
    pending_payout: number;
    settled_payout: number;
    sourced_payout: number;
    consignment_payout: number;
    total_payout_generated: number;
  };
  items: Array<{
    id: number;
    quick_code: string;
    item_name: string;
    imei_serial: string;
    status: string;
    quantity: number;
    sold_quantity: number;
    sold_amount: number;
    returned_quantity: number;
    returned_reason: string;
    agreed_payout: number;
    selling_price: number;
    updated_at: string | null;
  }>;
  customer_returns: Array<{
    return_id: number;
    sale_id: number;
    item_name: string;
    quantity: number;
    returned_value: number;
    refund_amount: number;
    refund_method: string;
    return_type: string;
    reason: string;
    created_at: string | null;
  }>;
  activities: Array<{
    id: number;
    item_name: string;
    amount_due: number;
    source_type: string;
    status: string;
    note: string | null;
    sale_timestamp: string | null;
    created_at: string | null;
    settled_at: string | null;
  }>;
};

const VendorPortal: React.FC = () => {
  const { storeId } = useParams<{ storeId: string }>();
  const [vendorIdInput, setVendorIdInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<VendorPortalResponse | null>(null);
  const [activitySourceFilter, setActivitySourceFilter] = useState<'ALL' | 'SOURCED' | 'CONSIGNMENT'>('ALL');
  const [itemFilter, setItemFilter] = useState<'ALL' | 'COLLECTED'>('ALL');
  const [customerReturnFilter, setCustomerReturnFilter] = useState<'ALL' | 'REFUND' | 'EXCHANGE' | 'RETURN_ONLY'>('ALL');
  const [customerReturnDateRange, setCustomerReturnDateRange] = useState<'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS'>('ALL');
  const [pendingWhatsAppShare, setPendingWhatsAppShare] = useState<{
    phone: string;
    title: string;
    lines: string[];
  } | null>(null);
  const [shareFeedback, setShareFeedback] = useState('');

  useEffect(() => {
    if (!shareFeedback) return;
    const timer = window.setTimeout(() => setShareFeedback(''), 2400);
    return () => window.clearTimeout(timer);
  }, [shareFeedback]);

  const currencyCode = useMemo(() => {
    const raw = String(payload?.store?.currency_code || 'USD').toUpperCase();
    return /^[A-Z]{3}$/.test(raw) ? raw : 'USD';
  }, [payload?.store?.currency_code]);

  const formatMoney = (value: number) => {
    const amount = Math.max(0, Number(value || 0) || 0);
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currencyCode,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currencyCode} ${amount.toFixed(2)}`;
    }
  };

  const filteredActivities = useMemo(() => {
    const rows = payload?.activities || [];
    if (activitySourceFilter === 'ALL') return rows;
    return rows.filter((entry) => String(entry.source_type || 'SOURCED').toUpperCase() === activitySourceFilter);
  }, [payload?.activities, activitySourceFilter]);

  const activityCounts = useMemo(() => {
    const rows = payload?.activities || [];
    const sourced = rows.filter((entry) => String(entry.source_type || 'SOURCED').toUpperCase() === 'SOURCED').length;
    const consignment = rows.filter((entry) => String(entry.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT').length;
    return {
      all: rows.length,
      sourced,
      consignment,
    };
  }, [payload?.activities]);

  const filteredItems = useMemo(() => {
    const rows = payload?.items || [];
    if (itemFilter === 'ALL') return rows;
    return rows.filter((item) => (
      Math.max(0, Number(item.sold_quantity || 0) || 0) > 0
      || Math.max(0, Number(item.returned_quantity || 0) || 0) > 0
    ));
  }, [payload?.items, itemFilter]);

  const collectedItemStats = useMemo(() => {
    return getCollectedStatsFromItems(payload?.items || []);
  }, [payload?.items]);

  const customerReturnCounts = useMemo(() => {
    const rows = payload?.customer_returns || [];
    return {
      all: rows.length,
      refund: rows.filter((row) => String(row.return_type || '').toUpperCase() === 'REFUND').length,
      exchange: rows.filter((row) => String(row.return_type || '').toUpperCase() === 'EXCHANGE').length,
      returnOnly: rows.filter((row) => String(row.return_type || '').toUpperCase() === 'RETURN_ONLY').length,
    };
  }, [payload?.customer_returns]);

  const filteredCustomerReturns = useMemo(() => {
    const rows = payload?.customer_returns || [];
    const now = new Date();

    return rows.filter((row) => {
      const typeMatch = customerReturnFilter === 'ALL'
        ? true
        : String(row.return_type || '').toUpperCase() === customerReturnFilter;
      if (!typeMatch) return false;

      if (customerReturnDateRange === 'ALL') return true;

      const createdAt = row.created_at ? new Date(row.created_at) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return false;

      if (customerReturnDateRange === 'TODAY') {
        return createdAt.toDateString() === now.toDateString();
      }

      const days = customerReturnDateRange === 'LAST_7_DAYS' ? 7 : 30;
      const threshold = new Date(now);
      threshold.setDate(now.getDate() - days);
      return createdAt >= threshold;
    });
  }, [payload?.customer_returns, customerReturnFilter, customerReturnDateRange]);

  const quickCodeByItemName = useMemo(() => {
    const map = new Map<string, string>();
    (payload?.items || []).forEach((item) => {
      const key = String(item.item_name || '').trim().toLowerCase();
      if (!key) return;
      const quickCode = String(item.quick_code || '').trim();
      if (quickCode && !map.has(key)) {
        map.set(key, quickCode);
      }
    });
    return map;
  }, [payload?.items]);

  const shareReturnAcknowledgement = (entry: VendorPortalResponse['customer_returns'][number]) => {
    if (!payload?.vendor?.phone) return;

    const quickCode = quickCodeByItemName.get(String(entry.item_name || '').trim().toLowerCase()) || '';

    setPendingWhatsAppShare({
      phone: payload.vendor.phone,
      title: 'Acknowledgement',
      lines: [
        `Vendor: ${payload.vendor.name}`,
        `Customer Return Acknowledgement | Item: ${entry.item_name || 'Vendor Item'}${quickCode ? ` | QC: ${quickCode}` : ''}`,
        `Qty: ${entry.quantity} | Returned: ${formatMoney(entry.returned_value)} | Refund: ${formatMoney(entry.refund_amount)}`,
        `Return Type: ${String(entry.return_type || 'REFUND').replace(/_/g, ' ')}`,
        entry.reason ? `Reason: ${entry.reason}` : '',
        entry.created_at ? `Date: ${new Date(entry.created_at).toLocaleString()}` : '',
        'Please confirm receipt.',
      ].filter(Boolean),
    });
  };

  const sendPendingWhatsAppShare = () => {
    if (!pendingWhatsAppShare) return;
    openWhatsAppShare(pendingWhatsAppShare);
    setPendingWhatsAppShare(null);
    setShareFeedback('WhatsApp opened with your acknowledgement message.');
  };

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    const storeIdNumber = Math.max(0, Number(storeId || 0) || 0);
    const normalizedVid = String(vendorIdInput || '').trim();

    if (!Number.isInteger(storeIdNumber) || storeIdNumber <= 0) {
      setError('Invalid portal link. Ask the store for the correct vendor link.');
      setPayload(null);
      return;
    }

    if (!/^\d{3,}$/.test(normalizedVid)) {
      setError('Enter a valid vendor ID.');
      setPayload(null);
      return;
    }

    try {
      setLoading(true);
      setError('');
      setActivitySourceFilter('ALL');
      setItemFilter('ALL');
      setCustomerReturnFilter('ALL');
      setCustomerReturnDateRange('ALL');
      const response = await fetch(`/api/vendor-portal/${storeIdNumber}/profile?vid=${encodeURIComponent(normalizedVid)}`, {
        method: 'GET',
        cache: 'no-store',
      });

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : { error: await response.text() };

      if (!response.ok) {
        throw new Error(String(data?.error || 'Vendor profile lookup failed.'));
      }

      const normalized = normalizeVendorPortalResponse(data);
      if (!normalized) {
        throw new Error('Invalid vendor profile response. Please retry.');
      }

      setPayload(normalized as VendorPortalResponse);
    } catch (err: any) {
      setError(String(err?.message || err || 'Vendor profile lookup failed.'));
      setPayload(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#f8fafc,_#e2e8f0_45%,_#cbd5e1_100%)] px-4 py-8 text-slate-100">
      <WhatsAppPreviewModal
        isOpen={Boolean(pendingWhatsAppShare)}
        title={pendingWhatsAppShare?.title || 'Acknowledgement'}
        lines={pendingWhatsAppShare?.lines || []}
        onClose={() => setPendingWhatsAppShare(null)}
        onSend={sendPendingWhatsAppShare}
        storeName={payload?.store?.name || undefined}
      />

      <div className="mx-auto w-full max-w-5xl space-y-5">
        {shareFeedback && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-900/20 px-4 py-3 text-sm font-semibold text-emerald-400">
            {shareFeedback}
          </section>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xl backdrop-blur sm:p-8">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Goody POS Vendor Portal</p>
          <h1 className="mt-1 text-3xl font-black text-slate-900">View Vendor Profile</h1>
          <p className="mt-2 text-sm text-slate-600">Enter your Vendor ID to view account activities, sold items, and payout summary.</p>

          <form onSubmit={handleLookup} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              type="text"
              value={vendorIdInput}
              onChange={(e) => setVendorIdInput(e.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="Enter Vendor ID"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-200 outline-none ring-offset-2 focus:border-slate-700 focus:ring-2 focus:ring-slate-300"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-black uppercase tracking-wider text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? 'Checking...' : 'View Profile'}
            </button>
          </form>

          {error && (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-900/20 px-3 py-2 text-sm font-semibold text-rose-400">{error}</p>
          )}
        </section>

        {payload && (
          <>
            <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xl backdrop-blur sm:p-8">
              <h2 className="text-2xl font-black text-slate-900">{payload.vendor.name}</h2>
              <p className="mt-1 text-sm text-slate-600">Store: {payload.store.name} • Vendor ID: {payload.vendor.id}</p>
              <p className="mt-1 text-sm text-slate-500">{payload.vendor.phone || 'No phone'} • {payload.vendor.address || 'No address'}</p>

              <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Active Units In Store</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{payload.summary.active_units}</p>
                  <p className="text-xs font-semibold text-slate-500">currently in stock</p>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-900/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Sold to Customers</p>
                  <p className="mt-1 text-xl font-black text-blue-300">{payload.summary.sold_units}</p>
                  <p className="text-xs font-semibold text-blue-400">{collectedItemStats.records} item(s) with sales</p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Vendor Collected Back</p>
                  <p className="mt-1 text-xl font-black text-violet-900">{payload.summary.returned_units}</p>
                  <p className="text-xs font-semibold text-violet-700">unit(s) taken back by vendor</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Pending Payout</p>
                  <p className="mt-1 text-xl font-black text-amber-400">{formatMoney(payload.summary.pending_payout)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Settled Payout</p>
                  <p className="mt-1 text-xl font-black text-emerald-400">{formatMoney(payload.summary.settled_payout)}</p>
                </div>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-amber-200 bg-amber-900/20 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Sourced Payout Total</p>
                  <p className="mt-1 text-lg font-black text-amber-300">{formatMoney(payload.summary.sourced_payout)}</p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Consignment Payout Total</p>
                  <p className="mt-1 text-lg font-black text-violet-900">{formatMoney(payload.summary.consignment_payout)}</p>
                </div>
              </div>

              <div className="mt-2 rounded-xl border border-rose-200 bg-rose-900/20 p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">Customer Returns / Refund Impact</p>
                <p className="mt-1 text-sm font-semibold text-rose-300">{payload.summary.customer_return_events} event(s) • {payload.summary.customer_returned_units} unit(s) returned by customers</p>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xl backdrop-blur sm:p-8">
              <h3 className="text-lg font-black text-slate-900">Item Activity</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setItemFilter('ALL')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${itemFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  All Items ({payload.items.length})
                </button>
                <button
                  type="button"
                  onClick={() => setItemFilter('COLLECTED')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${itemFilter === 'COLLECTED' ? 'bg-violet-700 text-white' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}
                >
                  With Activity ({payload.items.filter((item) => Math.max(0, Number(item.sold_quantity || 0) || 0) > 0 || Math.max(0, Number(item.returned_quantity || 0) || 0) > 0).length})
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {filteredItems.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No items found for this vendor.</p>
                ) : (
                  filteredItems.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold text-slate-900">{item.item_name}</p>
                        <div className="flex flex-wrap gap-1">
                          {Math.max(0, Number(item.sold_quantity || 0) || 0) > 0 && (
                            <span className="inline-flex rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-blue-400">Sold at store</span>
                          )}
                          {Math.max(0, Number(item.returned_quantity || 0) || 0) > 0 && (
                            <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-violet-700">Vendor collected back</span>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-slate-600">IMEI: {item.imei_serial || 'N/A'} • Status: {item.status}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-300">Available: {item.quantity} • Sold: {item.sold_quantity} • Sold Amount: {formatMoney(item.sold_amount)}</p>
                      {Math.max(0, Number(item.returned_quantity || 0) || 0) > 0 && (
                        <>
                          <p className="mt-0.5 text-xs font-semibold text-violet-700">Vendor Collected Back: {item.returned_quantity} unit(s)</p>
                          {item.returned_reason && (
                            <p className="mt-0.5 text-xs text-violet-600">Reason: {item.returned_reason}</p>
                          )}
                        </>
                      )}
                      <p className="text-xs text-slate-500">Updated: {item.updated_at ? new Date(item.updated_at).toLocaleString() : 'N/A'}</p>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xl backdrop-blur sm:p-8">
              <h3 className="text-lg font-black text-slate-900">Account Activities</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActivitySourceFilter('ALL')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${activitySourceFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  All ({activityCounts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setActivitySourceFilter('SOURCED')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${activitySourceFilter === 'SOURCED' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-400 hover:bg-amber-200'}`}
                >
                  Sourced ({activityCounts.sourced})
                </button>
                <button
                  type="button"
                  onClick={() => setActivitySourceFilter('CONSIGNMENT')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${activitySourceFilter === 'CONSIGNMENT' ? 'bg-violet-700 text-white' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}
                >
                  Consignment ({activityCounts.consignment})
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {filteredActivities.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No payout activity yet.</p>
                ) : (
                  filteredActivities.map((entry) => {
                    const normalizedStatus = String(entry.status || 'UNPAID').toUpperCase() === 'SETTLED' ? 'SETTLED' : 'UNPAID';
                    const statusClass = normalizedStatus === 'SETTLED'
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-300'
                      : 'border-rose-300 bg-rose-100 text-rose-300';

                    return (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold text-slate-200">{entry.item_name}</p>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${String(entry.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT' ? 'bg-violet-100 text-violet-700' : 'bg-amber-100 text-amber-400'}`}>
                            {String(entry.source_type || 'SOURCED').toUpperCase()}
                          </span>
                          <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-widest ${statusClass}`}>
                            {normalizedStatus}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs font-semibold text-slate-300">Amount: {formatMoney(entry.amount_due)}</p>
                      <p className="text-xs text-slate-500">Created: {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'N/A'}</p>
                      {entry.settled_at && <p className="text-xs text-emerald-400">Settled: {new Date(entry.settled_at).toLocaleString()}</p>}
                    </div>
                  );})
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-xl backdrop-blur sm:p-8">
              <h3 className="text-lg font-black text-slate-900">Customer Returns & Refund Alerts</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCustomerReturnFilter('ALL')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  All ({customerReturnCounts.all})
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerReturnFilter('REFUND')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnFilter === 'REFUND' ? 'bg-rose-700 text-white' : 'bg-rose-100 text-rose-400 hover:bg-rose-200'}`}
                >
                  Refund ({customerReturnCounts.refund})
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerReturnFilter('EXCHANGE')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnFilter === 'EXCHANGE' ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-400 hover:bg-blue-200'}`}
                >
                  Exchange ({customerReturnCounts.exchange})
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerReturnFilter('RETURN_ONLY')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnFilter === 'RETURN_ONLY' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-400 hover:bg-amber-200'}`}
                >
                  Return Only ({customerReturnCounts.returnOnly})
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCustomerReturnDateRange('ALL')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnDateRange === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  All Time
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerReturnDateRange('TODAY')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnDateRange === 'TODAY' ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-400 hover:bg-emerald-200'}`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerReturnDateRange('LAST_7_DAYS')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnDateRange === 'LAST_7_DAYS' ? 'bg-blue-700 text-white' : 'bg-blue-100 text-blue-400 hover:bg-blue-200'}`}
                >
                  Last 7 Days
                </button>
                <button
                  type="button"
                  onClick={() => setCustomerReturnDateRange('LAST_30_DAYS')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-widest ${customerReturnDateRange === 'LAST_30_DAYS' ? 'bg-violet-700 text-white' : 'bg-violet-100 text-violet-700 hover:bg-violet-200'}`}
                >
                  Last 30 Days
                </button>
              </div>
              <div className="mt-3 space-y-2">
                {filteredCustomerReturns.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No customer return/refund event found for your items.</p>
                ) : (
                  filteredCustomerReturns.map((entry, index) => (
                    <div key={`${entry.return_id}-${entry.sale_id}-${index}`} className="rounded-xl border border-rose-200 bg-rose-900/20 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold text-rose-300">{entry.item_name}</p>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-rose-400">Customer Returned</span>
                          <button
                            type="button"
                            onClick={() => shareReturnAcknowledgement(entry)}
                            disabled={!payload?.vendor?.phone}
                            className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-green-700 hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <MessageCircle size={12} /> WhatsApp Ack
                          </button>
                        </div>
                      </div>
                      <p className="text-xs font-semibold text-rose-300">Qty: {entry.quantity} • Returned Value: {formatMoney(entry.returned_value)} • Refund: {formatMoney(entry.refund_amount)}</p>
                      <p className="text-xs text-rose-400">Return #{entry.return_id} • Sale #{entry.sale_id} • {entry.return_type.replace(/_/g, ' ')} via {entry.refund_method.replace(/_/g, ' ')}</p>
                      {entry.reason && <p className="text-xs text-rose-400">Reason: {entry.reason}</p>}
                      <p className="text-xs text-rose-600">Date: {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'N/A'}</p>
                    </div>
                  ))
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default VendorPortal;

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Banknote, ChevronLeft, ChevronRight, Home, Loader2, Search, WalletCards, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useNotification } from '../../context/NotificationContext';
import { normalizeVendorPayablesResponse } from '../../lib/responseGuards';
import { calculateVendorIdFromSignature, getVendorSignature } from '../../lib/vendorMetrics';

const VendorPayables: React.FC = () => {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNPAID' | 'SETTLED'>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'SOURCED' | 'CONSIGNMENT'>('ALL');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const deferredSearch = useDeferredValue(search.trim());

  useEffect(() => { setPage(1); }, [deferredSearch, statusFilter, sourceFilter]);

  const loadRecords = async () => {
    try {
      if (!hasLoadedOnce) setLoading(true);
      const query = new URLSearchParams();
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      if (deferredSearch) query.set('search', deferredSearch);
      const data = await appFetch(`/api/vendor-payables${query.toString() ? `?${query.toString()}` : ''}`);
      const normalized = normalizeVendorPayablesResponse(data);
      setRecords(normalized.records);
    } catch (err: any) {
      console.error(err);
      setRecords([]);
      showNotification({ message: String(err?.message || err || 'Failed to load vendor payables'), type: 'error' });
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  };

  useEffect(() => { void loadRecords(); }, [deferredSearch, statusFilter]);

  const filteredRecords = useMemo(() => {
    if (sourceFilter === 'ALL') return records;
    return records.filter((row) => String(row.source_type || 'SOURCED').toUpperCase() === sourceFilter);
  }, [records, sourceFilter]);

  const displaySummary = useMemo(() => {
    return filteredRecords.reduce((acc, row) => {
      const amount = Math.max(0, Number(row.amount_due || 0) || 0);
      const sourceType = String(row.source_type || 'SOURCED').toUpperCase();
      acc.totalRecords += 1;
      acc.totalAmountDue += amount;
      if (String(row.status || '').toUpperCase() === 'UNPAID') acc.unpaidAmount += amount;
      if (sourceType === 'CONSIGNMENT') acc.consignmentAmount += amount;
      else acc.sourcedAmount += amount;
      return acc;
    }, { totalRecords: 0, totalAmountDue: 0, unpaidAmount: 0, sourcedAmount: 0, consignmentAmount: 0 });
  }, [filteredRecords]);

  const grouped = useMemo(() => {
    return Object.values(
      filteredRecords.reduce((acc: Record<string, any>, row: any) => {
        const key = String(row.vendor_name || 'Unknown Vendor').trim() || 'Unknown Vendor';
        if (!acc[key]) {
          acc[key] = {
            vendor_name: key,
            vendor_id: calculateVendorIdFromSignature(getVendorSignature(key, null, null)),
            records: [],
            unpaid_amount: 0, total_amount: 0,
            sourced_amount: 0, consignment_amount: 0,
            sourced_unpaid: 0, consignment_unpaid: 0,
            sourced_records: 0, consignment_records: 0,
            bank_name: '', account_number: '', account_name: '', bank_note: '',
          };
        }
        const amount = Math.max(0, Number(row.amount_due || 0) || 0);
        const sourceType = String(row.source_type || 'SOURCED').toUpperCase();
        acc[key].records.push(row);
        if (row.vendor_id) acc[key].vendor_id = String(row.vendor_id);
        if (!acc[key].bank_name && row.vendor_bank_name) acc[key].bank_name = String(row.vendor_bank_name || '').trim();
        if (!acc[key].account_number && row.vendor_account_number) acc[key].account_number = String(row.vendor_account_number || '').trim();
        if (!acc[key].account_name && row.vendor_account_name) acc[key].account_name = String(row.vendor_account_name || '').trim();
        if (!acc[key].bank_note && row.vendor_bank_note) acc[key].bank_note = String(row.vendor_bank_note || '').trim();
        acc[key].total_amount += amount;
        if (sourceType === 'CONSIGNMENT') {
          acc[key].consignment_amount += amount;
          acc[key].consignment_records += 1;
        } else {
          acc[key].sourced_amount += amount;
          acc[key].sourced_records += 1;
        }
        if (String(row.status || '').toUpperCase() === 'UNPAID') {
          acc[key].unpaid_amount += amount;
          if (sourceType === 'CONSIGNMENT') acc[key].consignment_unpaid += amount;
          else acc[key].sourced_unpaid += amount;
        }
        return acc;
      }, {}),
    ) as Array<{
      vendor_name: string; vendor_id: string; records: any[];
      unpaid_amount: number; total_amount: number;
      sourced_amount: number; consignment_amount: number;
      sourced_unpaid: number; consignment_unpaid: number;
      sourced_records: number; consignment_records: number;
      bank_name: string; account_number: string; account_name: string; bank_note: string;
    }>;
  }, [filteredRecords]);

  const classifyVendorType = (vendor: { sourced_records: number; consignment_records: number }) => {
    const hasSourced = Number(vendor.sourced_records || 0) > 0;
    const hasConsignment = Number(vendor.consignment_records || 0) > 0;
    if (hasSourced && hasConsignment) return 'HYBRID';
    if (hasConsignment) return 'INNER VENDOR';
    return 'OUTSIDE VENDOR';
  };

  const vendorTypeSummary = useMemo(() => {
    return grouped.reduce((acc, vendor) => {
      const type = classifyVendorType(vendor);
      if (type === 'INNER VENDOR') acc.inner += 1;
      else if (type === 'OUTSIDE VENDOR') acc.outside += 1;
      else acc.hybrid += 1;
      return acc;
    }, { inner: 0, outside: 0, hybrid: 0 });
  }, [grouped]);

  const toggleStatus = async (row: any) => {
    const id = Number(row?.id || 0);
    if (!id) return;
    const nextStatus = String(row?.status || '').toUpperCase() === 'SETTLED' ? 'UNPAID' : 'SETTLED';
    try {
      setSavingId(id);
      await appFetch(`/api/vendor-payables/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) });
      showNotification({ message: `Vendor payable marked ${nextStatus}.`, type: 'success' });
      await loadRecords();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to update payable status'), type: 'error' });
    } finally {
      setSavingId(null);
    }
  };

  if (loading && !hasLoadedOnce) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">

      {/* ── HERO ── */}
      <header className="relative overflow-hidden rounded-[28px] bg-[radial-gradient(ellipse_at_top_left,#064e3b_0%,#065f46_30%,#0f172a_75%,#020617_100%)] px-7 py-8 text-white shadow-[0_30px_80px_-30px_rgba(6,78,59,0.7)]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-emerald-400/15 blur-[70px]" />
          <div className="absolute bottom-0 left-1/3 h-40 w-40 rounded-full bg-teal-300/10 blur-[60px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px]" />
        </div>
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-emerald-300">Finance</p>
            <h1 className="text-3xl font-black text-white sm:text-4xl" style={{ fontFamily: 'var(--font-display)' }}>Vendor Payables</h1>
            <p className="mt-1 text-sm text-slate-400">Track sourced and consignment vendor debts so every payment is settled on time.</p>
          </div>
          <Link to="/" className="inline-flex items-center gap-2 self-start rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20">
            <Home size={15} /> Home
          </Link>
        </div>

        {/* KPI strip */}
        <div className="relative z-10 mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Total Records</p>
            <p className="mt-1 text-2xl font-black text-white">{displaySummary.totalRecords}</p>
          </div>
          <div className="rounded-2xl border border-red-500/60 bg-red-600 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-100">Unpaid Balance</p>
            <p className="mt-1 text-xl font-black text-white">{formatCurrency(displaySummary.unpaidAmount)}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Total Due</p>
            <p className="mt-1 text-xl font-black text-white">{formatCurrency(displaySummary.totalAmountDue)}</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Vendor Mix</p>
            <p className="mt-1 text-xs font-bold text-white">Inner {vendorTypeSummary.inner} · Outside {vendorTypeSummary.outside} · Hybrid {vendorTypeSummary.hybrid}</p>
          </div>
        </div>
      </header>

      {/* ── FILTER BAR ── */}
      <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            {/* Status pills */}
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'UNPAID', 'SETTLED'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setStatusFilter(v)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-black uppercase tracking-widest transition ${statusFilter === v ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {v}
                </button>
              ))}
            </div>
            {/* Source pills */}
            <div className="flex flex-wrap gap-1.5">
              {(['ALL', 'SOURCED', 'CONSIGNMENT'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setSourceFilter(v)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-black uppercase tracking-widest transition ${sourceFilter === v ? 'bg-emerald-700 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendor, VID, item, sale ID…"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── VENDOR LIST ── */}
      {grouped.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <WalletCards className="mx-auto mb-3 text-slate-300" size={32} />
          <h2 className="text-lg font-black text-slate-900">No vendor payables yet</h2>
          <p className="mt-1 text-sm text-slate-500">When sourced or consignment items are sold from POS, payables will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((vendor) => {
            const vendorType = classifyVendorType(vendor);
            const typePill = vendorType === 'INNER VENDOR'
              ? 'bg-violet-100 text-violet-700'
              : vendorType === 'OUTSIDE VENDOR'
                ? 'bg-amber-100 text-amber-400'
                : 'bg-sky-100 text-sky-700';
            const typeHint = vendorType === 'INNER VENDOR'
              ? 'Consignment Hub vendor'
              : vendorType === 'OUTSIDE VENDOR'
                ? 'Sourced / outside vendor'
                : 'Has both sourced and consignment records';

            return (
              <div key={vendor.vendor_name} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
                {/* Vendor header */}
                <div className="border-b border-slate-100 bg-[linear-gradient(135deg,#f8fafc,#f1f5f9)] px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${typePill}`}>{vendorType}</span>
                        <span className="text-xs text-slate-400">{typeHint}</span>
                      </div>
                      <p className="text-xl font-black text-slate-900">{vendor.vendor_name}</p>
                      <p className="text-xs text-slate-500">VID {vendor.vendor_id}</p>

                      {(vendor.bank_name || vendor.account_number || vendor.account_name || vendor.bank_note) && (
                        <div className="mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                          <span className="flex items-center gap-1 font-black text-slate-300"><Banknote size={12} /> Bank Details</span>
                          {vendor.bank_name && <span><strong>Bank:</strong> {vendor.bank_name}</span>}
                          {vendor.account_name && <span><strong>Name:</strong> {vendor.account_name}</span>}
                          {vendor.account_number && <span><strong>Acct:</strong> {vendor.account_number}</span>}
                          {vendor.bank_note && <span className="text-slate-400">{vendor.bank_note}</span>}
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total Linked</p>
                      <p className="text-xl font-black text-slate-900">{formatCurrency(vendor.total_amount)}</p>
                      {vendor.unpaid_amount > 0 && (
                        <span className="mt-1 inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-black text-amber-400">
                          {formatCurrency(vendor.unpaid_amount)} unpaid
                        </span>
                      )}
                      <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
                        <p>Sourced: {vendor.sourced_records} rec · {formatCurrency(vendor.sourced_amount)} (unpaid {formatCurrency(vendor.sourced_unpaid)})</p>
                        <p>Consignment: {vendor.consignment_records} rec · {formatCurrency(vendor.consignment_amount)} (unpaid {formatCurrency(vendor.consignment_unpaid)})</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Records */}
                <div className="divide-y divide-slate-100">
                  {vendor.records.map((row: any) => {
                    const status = String(row.status || 'UNPAID').toUpperCase();
                    const isSettled = status === 'SETTLED';
                    const sourceType = String(row.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'SOURCED';
                    const sourceReferenceValue = String(row.vendor_reference || '').trim();
                    return (
                      <div key={row.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <p className="font-black text-slate-900">{row.item_name || 'Vendor Item'}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${sourceType === 'CONSIGNMENT' ? 'bg-violet-100 text-violet-600' : 'bg-slate-100 text-slate-500'}`}>{sourceType}</span>
                          </div>
                          <p className="text-xs text-slate-500">Sale #{row.sale_id}{sourceReferenceValue ? ` · ${sourceReferenceValue}` : ''}</p>
                          <p className="text-xs text-slate-400">{new Date(row.created_at).toLocaleString()}</p>
                          {row.sale_timestamp && (
                            <p className="text-[11px] text-slate-400">Sale time: {new Date(row.sale_timestamp).toLocaleString()}</p>
                          )}
                        </div>

                        <div className="flex items-center gap-4 sm:flex-col sm:items-end sm:gap-2">
                          <div className="text-right">
                            <p className="text-lg font-black text-slate-900">{formatCurrency(Number(row.amount_due || 0) || 0)}</p>
                            <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${isSettled ? 'bg-emerald-100 text-emerald-400' : 'bg-amber-100 text-amber-400'}`}>
                              {isSettled ? 'Settled' : 'Unpaid to Vendor'}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={savingId === Number(row.id)}
                            onClick={() => toggleStatus(row)}
                            className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-black transition disabled:opacity-50 ${isSettled ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50' : 'border-emerald-200 bg-emerald-900/20 text-emerald-400 hover:bg-emerald-100'}`}
                          >
                            {savingId === Number(row.id) ? 'Updating…' : isSettled ? 'Mark Unpaid' : 'Mark Settled'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {grouped.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-bold text-slate-600">
                Page {page} of {Math.ceil(grouped.length / PAGE_SIZE)} · {grouped.length} vendors
              </span>
              <button type="button" onClick={() => setPage((p) => Math.min(Math.ceil(grouped.length / PAGE_SIZE), p + 1))} disabled={page === Math.ceil(grouped.length / PAGE_SIZE)}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VendorPayables;

import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Home, Loader2, Search, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';
import { useNotification } from '../../context/NotificationContext';

const GLASS_PANEL = 'rounded-[26px] border border-slate-200 bg-white/90 shadow-[0_18px_40px_rgba(15,23,42,0.08)] backdrop-blur';
const SOFT_PANEL = 'rounded-2xl border border-slate-200 bg-slate-50/80';
const SOURCED_ITEMS_PAGE_SIZE = 12;

const SourcedItems: React.FC = () => {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    total_records: 0,
    total_units: 0,
    total_sales_value: 0,
    total_owner_cost: 0,
    total_gross_profit: 0,
  });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim());
  const [requestedSearch, setRequestedSearch] = useState('');

  const loadRecords = async (nextPage: number, nextSearch: string) => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      query.set('page', String(nextPage));
      query.set('limit', String(SOURCED_ITEMS_PAGE_SIZE));
      if (nextSearch) query.set('search', nextSearch);
      const data = await appFetch(`/api/sourced-items${query.toString() ? `?${query.toString()}` : ''}`);

      setRecords(Array.isArray(data?.records) ? data.records : []);
      setSummary({
        total_records: Number(data?.summary?.total_records || 0) || 0,
        total_units: Number(data?.summary?.total_units || 0) || 0,
        total_sales_value: Number(data?.summary?.total_sales_value || 0) || 0,
        total_owner_cost: Number(data?.summary?.total_owner_cost || 0) || 0,
        total_gross_profit: Number(data?.summary?.total_gross_profit || 0) || 0,
      });
    } catch (err: any) {
      setRecords([]);
      setSummary({ total_records: 0, total_units: 0, total_sales_value: 0, total_owner_cost: 0, total_gross_profit: 0 });
      showNotification({ message: String(err?.message || err || 'Failed to load sourced items'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (requestedSearch !== deferredSearch) {
      setRequestedSearch(deferredSearch);
      setPage(1);
      return;
    }

    void loadRecords(page, deferredSearch);
  }, [deferredSearch, page, requestedSearch]);

  useEffect(() => {
    const totalPagesFromSummary = Math.max(1, Math.ceil(Number(summary.total_records || 0) / SOURCED_ITEMS_PAGE_SIZE));
    if (page > totalPagesFromSummary) {
      setPage(totalPagesFromSummary);
    }
  }, [page, summary.total_records]);

  const groupedByOwner = useMemo(() => {
    return Object.values(
      records.reduce((acc: Record<string, any>, row: any) => {
        const key = String(row.owner_name || 'Unknown Owner').trim() || 'Unknown Owner';
        if (!acc[key]) {
          acc[key] = {
            owner_name: key,
            owner_reference: String(row.owner_reference || '').trim(),
            rows: [],
            total_value: 0,
            total_owner_cost: 0,
            total_profit: 0,
          };
        }

        acc[key].rows.push(row);
        acc[key].total_value += Math.max(0, Number(row.subtotal || 0) || 0);
        acc[key].total_owner_cost += Math.max(0, Number(row.owner_total_cost || 0) || 0);
        acc[key].total_profit += Math.max(0, Number(row.gross_profit || 0) || 0);
        return acc;
      }, {}),
    ) as any[];
  }, [records]);

  const totalPages = Math.max(1, Math.ceil(Number(summary.total_records || 0) / SOURCED_ITEMS_PAGE_SIZE));
  const pageStart = summary.total_records === 0 ? 0 : ((page - 1) * SOURCED_ITEMS_PAGE_SIZE) + 1;
  const pageEnd = summary.total_records === 0 ? 0 : Math.min(page * SOURCED_ITEMS_PAGE_SIZE, Number(summary.total_records || 0));

  if (loading) {
    return (
      <div className="flex h-full min-h-[18rem] items-center justify-center rounded-[26px] border border-slate-200 bg-white shadow-sm">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="relative isolate space-y-5 overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#f6fbff_0%,#ffffff_55%,#f8fafc_100%)] p-3 sm:p-4 lg:p-5">
      <style>{`@keyframes sourcedRiseIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <div className="pointer-events-none absolute -left-16 top-0 h-40 w-40 rounded-full bg-cyan-200/30 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-44 w-44 rounded-full bg-emerald-200/25 blur-3xl" />

      <header className={`relative ${GLASS_PANEL} p-4 sm:p-6`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">POS Tracking</p>
            <h1 className="mt-1 text-3xl font-black text-slate-900">Sourced Items</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">Every sourced item sold in completed sales appears here with full item, vendor, and staff ownership details.</p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-[11px] font-bold text-cyan-700">
              <ShoppingBag size={12} /> Live sourced sales intelligence
            </div>
          </div>

          <Link to="/" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition hover:-translate-y-0.5 hover:bg-slate-50">
            <Home size={16} /> Home
          </Link>
        </div>
      </header>

      <div className="sticky top-2 z-20 space-y-3 rounded-[28px] border border-slate-200/70 bg-white/80 p-2 backdrop-blur-md">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className={`${GLASS_PANEL} p-4`}>
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Records</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{summary.total_records}</p>
        </div>
        <div className={`${GLASS_PANEL} p-4`}>
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Units</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{summary.total_units}</p>
        </div>
        <div className={`${GLASS_PANEL} p-4`}>
          <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Sales Value</p>
          <p className="mt-2 text-3xl font-black text-slate-900">{formatCurrency(summary.total_sales_value)}</p>
        </div>
        <div className="rounded-[26px] border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50 p-4 shadow-[0_12px_30px_rgba(245,158,11,0.14)]">
          <p className="text-[11px] font-black uppercase tracking-widest text-amber-700">Owner Cost</p>
          <p className="mt-2 text-[2.15rem] font-black leading-none text-amber-800">{formatCurrency(summary.total_owner_cost)}</p>
        </div>
        <div className="rounded-[26px] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50 p-4 shadow-[0_12px_30px_rgba(16,185,129,0.14)]">
          <p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">Gross Profit</p>
          <p className="mt-2 text-[2.15rem] font-black leading-none text-emerald-800">{formatCurrency(summary.total_gross_profit)}</p>
        </div>
      </div>

      <div className={`${GLASS_PANEL} p-4`}>
        <div className="relative w-full max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, owner, IMEI, sale ID, or staff"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-4 text-sm text-slate-900 shadow-inner focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[26px] border border-slate-200/80 bg-white/85 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-bold text-slate-600">
          Showing {pageStart}-{pageEnd} of {records.length} sourced records
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-300 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <p className="px-2 text-sm font-bold text-slate-600">
            Page {page} of {totalPages}
          </p>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-300 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
      </div>

      {groupedByOwner.length === 0 ? (
        <div className={`${GLASS_PANEL} border-dashed px-6 py-10 text-center`}>
          <ShoppingBag className="mx-auto mb-3 text-slate-300" size={28} />
          <h2 className="text-lg font-bold text-slate-900">No sourced item sales yet</h2>
          <p className="mt-1 text-sm text-slate-500">Complete a sale that includes Add Sourced Item from POS and it will appear here automatically.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByOwner.map((owner, ownerIndex) => (
            <div
              key={owner.owner_name}
              className={`${GLASS_PANEL} p-4 sm:p-5`}
              style={{ animation: 'sourcedRiseIn 380ms ease-out both', animationDelay: `${Math.min(ownerIndex * 70, 420)}ms` }}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-xl font-black text-slate-900">{owner.owner_name}</p>
                  <p className="text-xs text-slate-500">{owner.owner_reference || 'No owner reference provided'}</p>
                </div>
                <div className="grid min-w-[210px] grid-cols-1 gap-1 text-right text-xs font-semibold sm:grid-cols-3 sm:text-left">
                  <div className={`${SOFT_PANEL} px-2 py-1.5`}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Owner Cost</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-200">{formatCurrency(owner.total_owner_cost)}</p>
                  </div>
                  <div className={`${SOFT_PANEL} px-2 py-1.5`}>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Sales Value</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-200">{formatCurrency(owner.total_value)}</p>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-900/20 px-2 py-1.5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Gross Profit</p>
                    <p className="mt-0.5 text-xs font-bold text-emerald-300">{formatCurrency(owner.total_profit)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {owner.rows.map((row: any, rowIndex: number) => (
                  <div
                    key={row.id}
                    className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50 to-cyan-50/40 p-3.5 shadow-sm"
                    style={{ animation: 'sourcedRiseIn 360ms ease-out both', animationDelay: `${Math.min((ownerIndex * 90) + (rowIndex * 40), 520)}ms` }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-base font-black text-slate-900">{row.item_name}</p>
                        <p className="text-xs font-semibold text-slate-500">Sale #{row.sale_id} • Sold by {row.sold_by_username}</p>
                        <p className="text-xs text-slate-500">{row.imei_serial ? `IMEI/Serial: ${row.imei_serial}` : 'IMEI/Serial: N/A'}</p>
                        <p className="text-xs text-slate-500">{new Date(row.sale_timestamp).toLocaleString()}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs font-semibold text-slate-700 sm:min-w-[260px]">
                        <div className={`${SOFT_PANEL} px-2 py-1.5 text-right`}>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Qty</p>
                          <p className="mt-0.5 font-bold text-slate-900">{Number(row.quantity || 0) || 0}</p>
                        </div>
                        <div className={`${SOFT_PANEL} px-2 py-1.5 text-right`}>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Unit Price</p>
                          <p className="mt-0.5 font-bold text-slate-900">{formatCurrency(Number(row.unit_price || 0) || 0)}</p>
                        </div>
                        <div className={`${SOFT_PANEL} px-2 py-1.5 text-right`}>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Subtotal</p>
                          <p className="mt-0.5 font-bold text-slate-900">{formatCurrency(Number(row.subtotal || 0) || 0)}</p>
                        </div>
                        <div className="rounded-2xl border border-amber-200 bg-amber-900/20 px-2 py-1.5 text-right">
                          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Owner Cost</p>
                          <p className="mt-0.5 font-bold text-amber-300">{formatCurrency(Number(row.owner_total_cost || 0) || 0)}</p>
                        </div>
                        <div className="col-span-2 rounded-2xl border border-emerald-200 bg-emerald-900/20 px-2 py-1.5 text-right">
                          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Profit</p>
                          <p className="mt-0.5 font-bold text-emerald-300">{formatCurrency(Number(row.gross_profit || 0) || 0)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SourcedItems;

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { appFetch } from '../../lib/api';
import {
  AlertTriangle,
  ArrowUpRight,
  BellRing,
  Clock3,
  Download,
  FileText,
  Filter,
  Loader2,
  Printer,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  TrendingUp,
  User,
  X,
} from 'lucide-react';
import { formatCurrency, printPdfUrl } from '../../lib/utils';
import { useNotification } from '../../context/NotificationContext';

const ACTION_TYPE_OPTIONS = ['ALL', 'PRICE_CHANGE', 'PRICE_MARKUP', 'DISCOUNT', 'STOCK_ADJUST', 'PRODUCT_ADD', 'DELETE', 'AUDIT_FLAG'];
const HIGH_RISK_ACTIONS = new Set(['PRICE_CHANGE', 'PRICE_MARKUP', 'DELETE', 'STOCK_ADJUST']);
const ITEMS_PER_PAGE = 12;
const GLASS_PANEL = 'rounded-[28px] border border-slate-200 bg-white/90 ring-1 ring-sky-100 shadow-[0_18px_50px_rgba(15,23,42,0.10)] backdrop-blur-xl';
const GLASS_INSET = 'rounded-2xl border border-slate-200 bg-slate-50/90 backdrop-blur-md';

const parseLogSnapshot = (value: any) => {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
};

const formatActionTypeLabel = (value: unknown) => {
  const raw = String(value || 'LOG').trim().replace(/_/g, ' ').toLowerCase();
  return raw.replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatSnapshotLabel = (key: string) => key
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/_/g, ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const formatSnapshotValue = (key: string, value: any) => {
  if (value == null || value === '') return '—';

  if (typeof value === 'number') {
    return /(price|amount|cost|total|value)$/i.test(key)
      ? formatCurrency(value)
      : value.toLocaleString('en-NG');
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '—';

    if (/(price|amount|cost|total|value)$/i.test(key) && !Number.isNaN(Number(trimmed))) {
      return formatCurrency(Number(trimmed));
    }

    if (/(date|time|timestamp)$/i.test(key) || /(_at|At)$/.test(key)) {
      const parsedDate = new Date(trimmed);
      if (!Number.isNaN(parsedDate.getTime())) {
        return parsedDate.toLocaleString();
      }
    }

    return trimmed;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getAuditTone = (actionType: string, isHighRisk: boolean) => {
  if (isHighRisk) {
    return {
      card: 'border-red-200 bg-gradient-to-br from-red-50 via-white to-rose-50',
      badge: 'border border-red-200 bg-red-100 text-red-700',
      accent: 'bg-gradient-to-r from-red-400 via-rose-400 to-red-500',
      meta: 'bg-red-50 text-red-700',
    };
  }

  if (actionType === 'DISCOUNT') {
    return {
      card: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50',
      badge: 'border border-amber-200 bg-amber-100 text-amber-400',
      accent: 'bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-500',
      meta: 'bg-amber-900/20 text-amber-400',
    };
  }

  if (actionType === 'PRODUCT_ADD') {
    return {
      card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-cyan-50',
      badge: 'border border-emerald-200 bg-emerald-100 text-emerald-400',
      accent: 'bg-gradient-to-r from-emerald-300 via-cyan-300 to-emerald-500',
      meta: 'bg-emerald-900/20 text-emerald-400',
    };
  }

  return {
    card: 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-violet-50',
    badge: 'border border-sky-200 bg-sky-100 text-sky-700',
    accent: 'bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-400',
    meta: 'bg-slate-100 text-slate-300',
  };
};

const renderSourcedSaleSnapshot = (snapshot: any) => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;

  const sourcedItems = Array.isArray(snapshot.sourced_items) ? snapshot.sourced_items : [];
  const hasSourcedShape = sourcedItems.length > 0 || snapshot.vendor_debt_total != null || snapshot.saleId != null || snapshot.sale_id != null;
  if (!hasSourcedShape) return null;

  return (
    <div className="mt-3 space-y-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {(snapshot.saleId != null || snapshot.sale_id != null) && (
          <div className={`${GLASS_INSET} px-3 py-2.5`}>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Sale ID</p>
            <p className="mt-1 text-sm font-bold text-slate-200">{String(snapshot.saleId ?? snapshot.sale_id)}</p>
          </div>
        )}
        {(snapshot.vendor_debt_total != null) && (
          <div className={`${GLASS_INSET} px-3 py-2.5`}>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Vendor Debt Total</p>
            <p className="mt-1 text-sm font-bold text-slate-200">{formatCurrency(Number(snapshot.vendor_debt_total || 0) || 0)}</p>
          </div>
        )}
        <div className={`${GLASS_INSET} px-3 py-2.5`}>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Sourced Items</p>
          <p className="mt-1 text-sm font-bold text-slate-200">{sourcedItems.length}</p>
        </div>
      </div>

      {sourcedItems.map((item: any, index: number) => (
        <div key={`${String(item?.name || 'item')}-${index}`} className={`${GLASS_INSET} p-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-black text-slate-900">{String(item?.name || `Sourced Item ${index + 1}`)}</p>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600">
              Qty {Math.max(0, Math.trunc(Number(item?.quantity || 0) || 0))}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <p className="text-xs text-slate-600">Vendor: <span className="font-semibold text-slate-200">{String(item?.vendor || item?.vendor_name || 'N/A')}</span></p>
            <p className="text-xs text-slate-600">Reference: <span className="font-semibold text-slate-200">{String(item?.vendor_reference || item?.vendor_ref || 'N/A')}</span></p>
            <p className="text-xs text-slate-600">Vendor Cost: <span className="font-semibold text-slate-200">{formatCurrency(Number(item?.vendor_cost_price || item?.agreed_payout || 0) || 0)}</span></p>
            <p className="text-xs text-slate-600">Selling Price: <span className="font-semibold text-slate-200">{formatCurrency(Number(item?.selling_price || 0) || 0)}</span></p>
          </div>
        </div>
      ))}
    </div>
  );
};

const renderSnapshotContent = (snapshot: any) => {
  if (snapshot == null || snapshot === '') return null;

  const sourcedSaleSnapshot = renderSourcedSaleSnapshot(snapshot);
  if (sourcedSaleSnapshot) {
    return sourcedSaleSnapshot;
  }

  if (typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const entries = Object.entries(snapshot).filter(([, entryValue]) => entryValue != null && entryValue !== '');
    const isFlatObject = entries.every(([, entryValue]) => ['string', 'number', 'boolean'].includes(typeof entryValue));

    if (entries.length > 0 && isFlatObject) {
      return (
        <dl className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {entries.map(([key, entryValue]) => (
            <div key={key} className={`${GLASS_INSET} px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]`}>
              <dt className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{formatSnapshotLabel(key)}</dt>
              <dd className="mt-1.5 break-words text-sm font-black leading-5 text-slate-800">{formatSnapshotValue(key, entryValue)}</dd>
            </div>
          ))}
        </dl>
      );
    }
  }

  const fallbackText = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2);
  return <pre className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">{fallbackText}</pre>;
};

const AuditVault: React.FC = () => {
  const { showNotification } = useNotification();
  const [sales, setSales] = useState<any[]>([]);
  const [flags, setFlags] = useState<any[]>([]);
  const [resolvingFlagId, setResolvingFlagId] = useState<number | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [selectedLogIds, setSelectedLogIds] = useState<Set<number>>(new Set());
  const [deletingLogs, setDeletingLogs] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [summary, setSummary] = useState<any>({
    totalToday: 0,
    priceChangesToday: 0,
    discountsToday: 0,
    stockAdjustmentsToday: 0,
    highRiskCount: 0,
    recentHighRisk: [],
  });
  const [loading, setLoading] = useState(true);
  const [saleFilter, setSaleFilter] = useState<'ALL' | 'COMPLETED' | 'PENDING' | 'VOIDED'>('ALL');
  const [staffFilter, setStaffFilter] = useState('');
  const [actionTypeFilter, setActionTypeFilter] = useState('ALL');
  const [todayOnly, setTodayOnly] = useState(true);
  const [highRiskOnly, setHighRiskOnly] = useState(false);
  const [showVoidModal, setShowVoidModal] = useState<number | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [previewPdf, setPreviewPdf] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [activeView, setActiveView] = useState<'activity' | 'sales'>('activity');
  const [logPage, setLogPage] = useState(1);
  const [logTotal, setLogTotal] = useState(0);
  const logPageRef = useRef(1);
  const [salesPage, setSalesPage] = useState(1);

  useEffect(() => {
    void loadAuditVault(true);
  }, [staffFilter, actionTypeFilter, todayOnly, highRiskOnly]);

  useEffect(() => {
    setSalesPage(1);
  }, [saleFilter, sales.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadLogs(logPageRef.current);
    }, 60000);
    return () => window.clearInterval(timer);
  }, [staffFilter, actionTypeFilter, todayOnly, highRiskOnly]);

  const buildLogQuery = (page: number) => {
    const query = new URLSearchParams();
    if (staffFilter.trim()) query.set('staffName', staffFilter.trim());
    if (actionTypeFilter !== 'ALL') query.set('actionType', actionTypeFilter);
    if (todayOnly) query.set('todayOnly', 'true');
    if (highRiskOnly) query.set('highRiskOnly', 'true');
    query.set('limit', String(ITEMS_PER_PAGE));
    query.set('offset', String((page - 1) * ITEMS_PER_PAGE));
    return query;
  };

  const loadLogs = async (_page: number) => {
    // Demo mode: always keep demo logs
  };

  const handleDeleteSelectedLogs = async () => {
    if (selectedLogIds.size === 0) return;
    setShowDeleteConfirm(true);
  };

  const confirmDeleteLogs = async () => {
    try {
      setDeletingLogs(true);
      setShowDeleteConfirm(false);
      await appFetch('/api/system-logs', { method: 'DELETE', body: JSON.stringify({ ids: Array.from(selectedLogIds) }) });
      setSelectedLogIds(new Set());
      await loadLogs(logPage);
    } catch (err: any) {
      console.error(err);
    } finally {
      setDeletingLogs(false);
    }
  };

  const handleLogPageChange = (newPage: number) => {
    logPageRef.current = newPage;
    setLogPage(newPage);
    void loadLogs(newPage);
  };

  const DEMO_LOGS = [
    { id: 9001, action_type: 'PRICE_CHANGE', user_name: 'demo_gt_manager', description: 'iPhone 15 Pro Max 256GB — Price adjusted for promotional weekend sale.', timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), is_high_risk: true, risk_level: 'HIGH', snapshot_before: { price: 1399 }, snapshot_after: { price: 1299 } },
    { id: 9002, action_type: 'DISCOUNT', user_name: 'demo_gt_staff', description: 'Samsung Galaxy S24 Ultra — 10% loyalty discount applied for returning customer James Carter.', timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), is_high_risk: false, risk_level: 'LOW', snapshot_before: { discount: 0 }, snapshot_after: { discount: 78 } },
    { id: 9003, action_type: 'STOCK_ADJUST', user_name: 'demo_gt_manager', description: 'AirPods Pro 2nd Gen — Stock count corrected after physical inventory check.', timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), is_high_risk: true, risk_level: 'HIGH', snapshot_before: { stock: 12 }, snapshot_after: { stock: 9 } },
    { id: 9004, action_type: 'PRICE_MARKUP', user_name: 'demo_gt_owner', description: 'MacBook Air M2 13" — Markup applied due to supplier price increase.', timestamp: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(), is_high_risk: true, risk_level: 'HIGH', snapshot_before: { price: 1850 }, snapshot_after: { price: 1950 } },
    { id: 9005, action_type: 'DISCOUNT', user_name: 'demo_gt_staff', description: 'Google Pixel 7 Pro — Manager-approved 5% discount for bundle purchase.', timestamp: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(), is_high_risk: false, risk_level: 'LOW', snapshot_before: { discount: 0 }, snapshot_after: { discount: 39 } },
    { id: 9006, action_type: 'PRODUCT_ADD', user_name: 'demo_gt_manager', description: 'Sony WH-1000XM5 — New product added to inventory from D&H Distributing shipment.', timestamp: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(), is_high_risk: false, risk_level: 'LOW', snapshot_before: null, snapshot_after: { price: 350, stock: 8 } },
    { id: 9007, action_type: 'STOCK_ADJUST', user_name: 'demo_gt_owner', description: 'Samsung Galaxy Tab S9 — Display unit removed from stock — sent for demo to Tech Data Europe.', timestamp: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(), is_high_risk: true, risk_level: 'HIGH', snapshot_before: { stock: 5 }, snapshot_after: { stock: 4 } },
    { id: 9008, action_type: 'PRICE_CHANGE', user_name: 'demo_gt_manager', description: 'iPad Air 5th Gen — End-of-season clearance price applied.', timestamp: new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString(), is_high_risk: true, risk_level: 'HIGH', snapshot_before: { price: 720 }, snapshot_after: { price: 649 } },
    { id: 9009, action_type: 'DISCOUNT', user_name: 'demo_gt_staff', description: 'USB-C Cable 6ft 3-Pack — Bulk discount for Oliver Bennett — 3 packs purchased.', timestamp: new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString(), is_high_risk: false, risk_level: 'LOW', snapshot_before: { discount: 0 }, snapshot_after: { discount: 10 } },
    { id: 9010, action_type: 'DELETE', user_name: 'demo_gt_owner', description: 'Refurbished iPhone 11 (Defective) — Product removed — failed quality check, returned to supplier.', timestamp: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(), is_high_risk: true, risk_level: 'HIGH', snapshot_before: { stock: 1, price: 299 }, snapshot_after: null },
    { id: 9011, action_type: 'PRODUCT_ADD', user_name: 'demo_gt_manager', description: 'Tempered Glass Screen Guard — New accessory line added — 50 units from Ingram Micro.', timestamp: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(), is_high_risk: false, risk_level: 'LOW', snapshot_before: null, snapshot_after: { price: 15, stock: 50 } },
    { id: 9012, action_type: 'AUDIT_FLAG', user_name: 'demo_gt_owner', description: 'iPhone 14 128GB — Flagged: unusual price drop detected outside approved range.', timestamp: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(), is_high_risk: true, risk_level: 'HIGH', snapshot_before: { price: 999 }, snapshot_after: { price: 750 } },
  ];

  const DEMO_SUMMARY = {
    totalToday: 5, priceChangesToday: 2, discountsToday: 2, stockAdjustmentsToday: 1, highRiskCount: 4, recentHighRisk: DEMO_LOGS.filter((l) => l.is_high_risk).slice(0, 3),
  };

  const loadAuditVault = async (showLoader = true) => {
    logPageRef.current = 1;
    setLogPage(1);
    try {
      if (showLoader) setLoading(true);
      const [flagData, salesData] = await Promise.all([
        appFetch('/api/audit-flags'),
        appFetch('/api/sales?limit=60'),
      ]);
      setLogs(DEMO_LOGS);
      setLogTotal(DEMO_LOGS.length);
      setSummary(DEMO_SUMMARY);
      setFlags(Array.isArray(flagData?.flags) ? flagData.flags : []);
      setSales(Array.isArray(salesData?.items) ? salesData.items : Array.isArray(salesData) ? salesData : []);
    } catch (err) {
      console.error(err);
      setLogs(DEMO_LOGS);
      setLogTotal(DEMO_LOGS.length);
      setSummary(DEMO_SUMMARY);
      setFlags([]);
      setSales([]);
    } finally {
      if (showLoader) setLoading(false);
    }
  };

  const handleVoid = async (id: number) => {
    if (!voidReason.trim()) {
      return showNotification({ message: 'Please provide a reason for voiding this sale.', type: 'warning' });
    }

    try {
      await appFetch(`/api/sales/${id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: voidReason.trim() }),
      });
      setShowVoidModal(null);
      setVoidReason('');
      showNotification({ message: 'Sale voided and recorded in the permanent audit trail.', type: 'success' });
      await loadAuditVault(false);
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    }
  };

  const handleResolveFlag = async (flagId: number) => {
    setResolvingFlagId(flagId);
    try {
      await appFetch(`/api/audit-flags/${flagId}/resolve`, { method: 'PUT' });
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
      showNotification({ message: 'Flag marked as resolved.', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setResolvingFlagId(null);
    }
  };

  const openPreview = (sale: any) => {
    if (sale.pdf_path) {
      setPreviewPdf(sale.pdf_path);
      setSelectedSale(sale);
    } else {
      showNotification({ message: 'PDF not found for this sale.', type: 'error' });
    }
  };

  const filteredSales = useMemo(
    () => sales.filter((sale) => saleFilter === 'ALL' || sale.status === saleFilter),
    [saleFilter, sales],
  );
  const openFlags = useMemo(
    () => flags.filter((flag) => String(flag.status || 'OPEN').toUpperCase() === 'OPEN'),
    [flags],
  );
  const totalLogPages = Math.max(1, Math.ceil(logTotal / ITEMS_PER_PAGE));
  const pagedSales = useMemo(() => {
    const start = (salesPage - 1) * ITEMS_PER_PAGE;
    return filteredSales.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredSales, salesPage]);
  const totalSalesPages = Math.max(1, Math.ceil(filteredSales.length / ITEMS_PER_PAGE));

  if (loading) {
    return (
      <div className="flex h-full min-h-[16rem] items-center justify-center rounded-[28px] border border-slate-200 bg-white text-slate-300 shadow-[0_18px_50px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <Loader2 className="animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="relative isolate space-y-5 overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_55%,#f8fafc_100%)] p-3 text-slate-900 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:p-4 lg:p-5">
      <div className="pointer-events-none absolute -left-12 top-0 h-36 w-36 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-violet-200/20 blur-3xl" />

      <header className={`relative ${GLASS_PANEL} p-4 sm:p-5`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3 shadow-sm">
              <ShieldAlert className="text-cyan-600" size={24} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-violet-700">Owner audit center</p>
              <h1 className="mt-1 text-2xl font-black text-slate-900">Audit Vault</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Review sensitive activity, flagged transactions, stock edits, and void history from one focused control page.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"><ShieldCheck size={12} /> Owner only</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"><Clock3 size={12} /> Auto-refresh 60s</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-700"><BellRing size={12} /> Immutable trail</span>
              </div>
            </div>
          </div>

          <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm xl:min-w-[240px]">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Risk monitor</p>
            <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-black ${Number(summary?.highRiskCount || 0) > 0 ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-900/20 text-emerald-400'}`}>
              <BellRing size={16} />
              {Number(summary?.highRiskCount || 0) > 0 ? `${summary.highRiskCount} high-risk alert(s)` : 'No high-risk alerts'}
            </div>
            <p className="mt-2 text-xs text-slate-500">Compact view for quick owner checks.</p>
          </div>
        </div>
      </header>

      <section className="relative grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="group relative overflow-hidden rounded-[24px] border border-red-200 bg-white p-4 shadow-[0_12px_35px_rgba(239,68,68,0.10)] transition-transform hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-600">High Risk Today</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{Number(summary?.highRiskCount || 0)}</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-2.5 text-red-600">
              <AlertTriangle size={18} />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">Price changes, sale deletions, and stock edits.</p>
          <div className="mt-4 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 w-[78%] rounded-full bg-gradient-to-r from-red-300 to-rose-400" /></div>
        </div>
        <div className="group relative overflow-hidden rounded-[24px] border border-amber-200 bg-white p-4 shadow-[0_12px_35px_rgba(245,158,11,0.10)] transition-transform hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-600">Price Changes</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{Number(summary?.priceChangesToday || 0)}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-900/20 p-2.5 text-amber-600">
              <Sparkles size={18} />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">Every selling-price adjustment is captured.</p>
          <div className="mt-4 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 w-[64%] rounded-full bg-gradient-to-r from-amber-200 to-yellow-300" /></div>
        </div>
        <div className="group relative overflow-hidden rounded-[24px] border border-sky-200 bg-white p-4 shadow-[0_12px_35px_rgba(14,165,233,0.10)] transition-transform hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-600">Discounts Today</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{Number(summary?.discountsToday || 0)}</p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-2.5 text-sky-600">
              <BellRing size={18} />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">Quick view of staff and manager discounts.</p>
          <div className="mt-4 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 w-[58%] rounded-full bg-gradient-to-r from-sky-200 to-cyan-300" /></div>
        </div>
        <div className="group relative overflow-hidden rounded-[24px] border border-violet-200 bg-white p-4 shadow-[0_12px_35px_rgba(139,92,246,0.10)] transition-transform hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-violet-600">Stock Adjustments</p>
              <p className="mt-2 text-3xl font-black text-slate-900">{Number(summary?.stockAdjustmentsToday || 0)}</p>
            </div>
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-2.5 text-violet-600">
              <ShieldCheck size={18} />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-600">Tracks manual edits to reduce shrinkage risk.</p>
          <div className="mt-4 h-1.5 rounded-full bg-slate-200"><div className="h-1.5 w-[70%] rounded-full bg-gradient-to-r from-violet-200 to-fuchsia-300" /></div>
        </div>
      </section>

      <section className={`relative ${GLASS_PANEL} p-4 sm:p-5`}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <Filter className="text-cyan-600" size={18} />
            <div>
              <h2 className="text-lg font-black text-slate-900">Filters & view</h2>
              <p className="text-sm text-slate-500">Switch between activity and sales review without one long endless screen.</p>
            </div>
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveView('activity')}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition-all ${activeView === 'activity' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-200'}`}
            >
              Activity Feed
            </button>
            <button
              type="button"
              onClick={() => setActiveView('sales')}
              className={`rounded-lg px-3 py-2 text-xs font-bold transition-all ${activeView === 'sales' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-200'}`}
            >
              Sales Review
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <input
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            placeholder="Filter by staff name"
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-cyan-400"
          />
          <select
            value={actionTypeFilter}
            onChange={(e) => setActionTypeFilter(e.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400"
          >
            {ACTION_TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option === 'ALL' ? 'All action types' : option.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setTodayOnly((prev) => !prev)}
            className={`rounded-2xl px-4 py-3 text-sm font-bold transition-colors ${todayOnly ? 'border border-cyan-200 bg-cyan-50 text-cyan-700' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {todayOnly ? 'Showing Today Only' : 'Show All Dates'}
          </button>
          <button
            type="button"
            onClick={() => setHighRiskOnly((prev) => !prev)}
            className={`rounded-2xl px-4 py-3 text-sm font-bold transition-colors ${highRiskOnly ? 'border border-red-200 bg-red-50 text-red-700' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {highRiskOnly ? 'High-Risk Only' : 'Include All Risk Levels'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{activeView === 'activity' ? `${logs.length} audit record(s)` : `${filteredSales.length} sale record(s)`} available</span>
          <span>Compact page mode enabled</span>
        </div>
      </section>

      {activeView === 'activity' && openFlags.length > 0 && (
        <section className="relative overflow-hidden rounded-[28px] border border-orange-200/80 bg-gradient-to-br from-orange-50 via-amber-50/60 to-white p-5 shadow-[0_20px_60px_rgba(234,88,12,0.10)] backdrop-blur-xl">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-orange-300/20 blur-2xl" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-24 rounded-full bg-amber-200/20 blur-2xl" />

          <div className="relative mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-orange-200 bg-orange-100 shadow-sm">
                <AlertTriangle size={16} className="text-orange-600" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-600">Staff / Accountant</p>
                <h3 className="text-sm font-black text-slate-900">Flagged Transactions</h3>
              </div>
            </div>
            <span className="flex h-7 min-w-[28px] items-center justify-center rounded-full border border-orange-200 bg-orange-100 px-2.5 text-xs font-black text-orange-700">
              {openFlags.length}
            </span>
          </div>

          <div className="relative grid gap-3 sm:grid-cols-2">
            {openFlags.slice(0, 6).map((flag) => {
              const issueLabel = String(flag.issue_type || 'CHECK_REQUIRED').replace(/_/g, ' ');
              const isPriceMarkup = String(flag.issue_type || '').includes('MARKUP');
              const isPriceChange = String(flag.issue_type || '').includes('PRICE_CHANGE');
              const iconColor = isPriceMarkup ? 'text-orange-500' : isPriceChange ? 'text-rose-500' : 'text-amber-500';
              const badgeBg = isPriceMarkup ? 'border-orange-200 bg-orange-50 text-orange-700' : isPriceChange ? 'border-rose-200 bg-rose-900/20 text-rose-400' : 'border-amber-200 bg-amber-900/20 text-amber-400';

              return (
                <div
                  key={flag.id}
                  className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 hover:shadow-[0_8px_30px_rgba(234,88,12,0.12)] hover:-translate-y-0.5"
                >
                  <div className="pointer-events-none absolute right-0 top-0 h-16 w-16 rounded-bl-full bg-orange-50/80 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-100 bg-slate-50`}>
                        {isPriceMarkup ? <TrendingUp size={14} className={iconColor} /> : <Tag size={14} className={iconColor} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black uppercase tracking-widest text-orange-500">Sale #{flag.sale_id}</p>
                        <p className="truncate text-sm font-black text-slate-900">{issueLabel}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${badgeBg}`}>Open</span>
                      <button
                        type="button"
                        onClick={() => handleResolveFlag(flag.id)}
                        disabled={resolvingFlagId === flag.id}
                        className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 transition hover:border-emerald-300 hover:bg-emerald-900/20 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {resolvingFlagId === flag.id
                          ? <Loader2 size={10} className="animate-spin" />
                          : <ShieldCheck size={10} />}
                        {resolvingFlagId === flag.id ? 'Resolving…' : 'Resolve'}
                      </button>
                    </div>
                  </div>

                  <p className="text-[13px] leading-relaxed text-slate-300">
                    {String(flag.note || '').split(/(\d[\d,.]*)/).map((part, i) =>
                      /^\d[\d,.]*$/.test(part)
                        ? <strong key={i} className="font-black text-slate-900">{part}</strong>
                        : part
                    )}
                  </p>

                  <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
                    <User size={11} className="shrink-0 text-slate-500" />
                    <p className="truncate text-[11px] font-semibold text-slate-500">
                      {flag.flagged_by_username || 'User'}
                      <span className="mx-1.5 text-slate-400">·</span>
                      {new Date(flag.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeView === 'activity' && (
        <section className={`relative ${GLASS_PANEL} p-4 sm:p-5`}>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Activity Feed</p>
              <h2 className="text-lg font-black text-slate-900">Immutable staff activity cards</h2>
              <p className="text-sm text-slate-500">A secure, read-only stream of product, price, stock, and discount events.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-bold text-cyan-700">{logs.length} record(s)</span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Page {logPage} / {totalLogPages}</span>
              {selectedLogIds.size > 0 && (
                <button
                  type="button"
                  onClick={handleDeleteSelectedLogs}
                  disabled={deletingLogs}
                  className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                >
                  {deletingLogs ? 'Deleting…' : `Delete ${selectedLogIds.size} selected`}
                </button>
              )}
              {logs.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedLogIds.size === logs.length) {
                      setSelectedLogIds(new Set());
                    } else {
                      setSelectedLogIds(new Set(logs.map((l: any) => Number(l.id))));
                    }
                  }}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  {selectedLogIds.size === logs.length ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </div>
          </div>

          {logs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              No activity matched your current filters.
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {logs.map((log) => {
                  const actionType = String(log.action_type || '').toUpperCase();
                  const oldSnapshot = parseLogSnapshot(log.old_value);
                  const newSnapshot = parseLogSnapshot(log.new_value);
                  const isHighRisk = Boolean(log.is_high_risk) || HIGH_RISK_ACTIONS.has(actionType);
                  const tone = getAuditTone(actionType, isHighRisk);

                  const isSelected = selectedLogIds.has(Number(log.id));
                  return (
                    <article
                      key={log.id}
                      className={`group relative overflow-hidden rounded-[24px] border p-4 shadow-[0_12px_30px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(15,23,42,0.16)] ${tone.card} ${isSelected ? 'ring-2 ring-red-400' : ''}`}
                    >
                      <div className={`absolute inset-x-0 top-0 h-1.5 ${tone.accent}`} />
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => setSelectedLogIds(prev => {
                          const next = new Set(prev);
                          isSelected ? next.delete(Number(log.id)) : next.add(Number(log.id));
                          return next;
                        })}
                        className="absolute right-3 top-4 h-4 w-4 cursor-pointer rounded border-slate-300 accent-red-600"
                      />

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="text-base font-black text-slate-900">{log.user_name || 'Unknown user'}</span>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${tone.badge}`}>
                              {formatActionTypeLabel(actionType || 'LOG')}
                            </span>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-300">{log.description}</p>
                        </div>
                        <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[11px] font-bold ${tone.meta}`}>
                          {new Date(log.timestamp).toLocaleString()}
                        </span>
                      </div>

                      {(oldSnapshot || newSnapshot) && (
                        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                          {oldSnapshot && (
                            <div className={`${GLASS_INSET} p-3.5 shadow-sm`}>
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Before</p>
                              {renderSnapshotContent(oldSnapshot)}
                            </div>
                          )}
                          {newSnapshot && (
                            <div className={`${GLASS_INSET} p-3.5 shadow-sm`}>
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{actionType === 'PRODUCT_ADD' ? 'Product Details' : 'After'}</p>
                              {renderSnapshotContent(newSnapshot)}
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold text-slate-600">Showing {logs.length} of {logTotal} record(s)</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleLogPageChange(logPage - 1)}
                    disabled={logPage === 1}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => handleLogPageChange(logPage + 1)}
                    disabled={logPage === totalLogPages}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {activeView === 'sales' && (
        <section className="relative space-y-4">
          <div className={`flex flex-col gap-3 ${GLASS_PANEL} p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between`}>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-500">Transaction Review</p>
              <h2 className="text-lg font-black text-slate-900">Sale history and void controls</h2>
              <p className="text-sm text-slate-500">Review completed, pending, and voided transactions without turning the page into a long feed.</p>
            </div>
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              {['ALL', 'COMPLETED', 'PENDING', 'VOIDED'].map((status) => (
                <button
                  key={status}
                  onClick={() => setSaleFilter(status as any)}
                  className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${saleFilter === status ? 'bg-cyan-100 text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-200'}`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {filteredSales.length === 0 ? (
            <div className={`rounded-[24px] ${GLASS_PANEL} p-8 text-center text-sm text-slate-500`}>
              No sales matched the selected status.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4">
                {pagedSales.map((sale) => (
                  <div key={sale.id} className={`rounded-[24px] border p-4 shadow-[0_12px_35px_rgba(15,23,42,0.10)] ${sale.status === 'VOIDED' ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-lg font-bold text-slate-900">Sale #{sale.id}</span>
                          <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${sale.status === 'COMPLETED' ? 'border border-emerald-200 bg-emerald-900/20 text-emerald-400' : sale.status === 'PENDING' ? 'border border-blue-200 bg-blue-900/20 text-blue-400' : 'border border-red-200 bg-red-50 text-red-700'}`}>
                            {sale.status}
                          </span>
                          <button
                            onClick={() => openPreview(sale)}
                            className="rounded-lg p-2 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900"
                            title="Preview Invoice"
                          >
                            <FileText size={16} />
                          </button>
                        </div>
                        <p className="mt-1 font-mono text-xs text-slate-500">{new Date(sale.timestamp).toLocaleString()} • User ID: {sale.user_id}</p>
                        {Number(sale.discount_amount || 0) > 0 && (
                          <p className="mt-2 text-xs font-bold text-amber-400">Discount applied: {formatCurrency(Number(sale.discount_amount || 0))}</p>
                        )}
                        {sale.status === 'VOIDED' && (
                          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-100/80 p-3 text-sm text-red-800">
                            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                            <div>
                              <p className="font-bold">Void Reason</p>
                              <p>{sale.void_reason}</p>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-black text-slate-900">{formatCurrency(Number(sale.total || 0))}</p>
                        <div className="mt-2 flex flex-wrap justify-end gap-2">
                          {Object.entries(sale.payment_methods || {}).map(([method, amount]: any) => (
                            Number(amount) > 0 ? (
                              <span key={method} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-300">
                                {method}: {formatCurrency(Number(amount) || 0)}
                              </span>
                            ) : null
                          ))}
                        </div>
                        {sale.status !== 'VOIDED' && (
                          <div className="mt-4 flex justify-end">
                            <button
                              onClick={() => setShowVoidModal(sale.id)}
                              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 transition-colors hover:bg-red-100"
                            >
                              <Trash2 size={14} /> Void Transaction
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className={`flex flex-wrap items-center justify-between gap-3 ${GLASS_PANEL} p-3`}>
                <p className="text-xs font-semibold text-slate-600">Showing {pagedSales.length} of {filteredSales.length} sale record(s)</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSalesPage((prev) => Math.max(1, prev - 1))}
                    disabled={salesPage === 1}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">Page {salesPage} / {totalSalesPages}</span>
                  <button
                    type="button"
                    onClick={() => setSalesPage((prev) => Math.min(totalSalesPages, prev + 1))}
                    disabled={salesPage === totalSalesPages}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-300 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {showVoidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-slate-950/90 p-8 text-slate-100 shadow-[0_30px_90px_rgba(2,6,23,0.7)] backdrop-blur-xl">
            <div className="mb-6 flex items-center gap-4">
              <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-red-300">
                <AlertTriangle size={32} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Void Transaction #{showVoidModal}</h2>
                <p className="text-sm text-slate-300">This will be recorded permanently in the Audit Vault.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Reason for Voiding</label>
                <textarea
                  className="min-h-[100px] w-full rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-slate-100 outline-none placeholder:text-slate-500 focus:ring-2 focus:ring-red-400"
                  placeholder="e.g. Duplicate checkout, customer changed mind..."
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                />
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  onClick={() => setShowVoidModal(null)}
                  className="flex-1 rounded-2xl border border-white/10 bg-white/5 py-4 font-bold text-slate-200 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  disabled={!voidReason.trim()}
                  onClick={() => handleVoid(showVoidModal)}
                  className="flex-1 rounded-2xl border border-red-500/30 bg-red-500/15 py-4 font-bold text-red-50 hover:bg-red-500/25 disabled:opacity-50"
                >
                  Confirm Void
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewPdf && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md">
          <div className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/95 shadow-[0_30px_90px_rgba(2,6,23,0.8)]">
            <div className="flex items-center justify-between border-b border-white/10 bg-slate-950/95 p-6">
              <div>
                <h2 className="text-xl font-bold text-white">Invoice Preview</h2>
                <p className="text-sm text-slate-300">Sale #{selectedSale?.id} - {new Date(selectedSale?.timestamp).toLocaleDateString()}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = previewPdf;
                    link.download = `INV-${selectedSale?.id}.pdf`;
                    link.click();
                  }}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 font-bold text-slate-900 transition-colors hover:bg-white/10"
                >
                  <Download size={18} /> Download
                </button>
                <button
                  onClick={() => {
                    if (previewPdf) printPdfUrl(previewPdf);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/15 px-4 py-2 font-bold text-cyan-50 transition-colors hover:bg-cyan-500/25"
                >
                  <Printer size={18} /> Print
                </button>
                <button
                  onClick={() => setPreviewPdf(null)}
                  className="rounded-xl p-2 text-slate-400 transition-all hover:bg-white/10 hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-slate-900/90 p-8">
              <iframe src={previewPdf} className="h-full w-full rounded-lg bg-white shadow-lg" title="Invoice Preview" />
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </div>
              <div>
                <h3 className="font-black text-slate-900">Delete Audit Records</h3>
                <p className="text-xs text-slate-500">This action cannot be undone</p>
              </div>
            </div>
            <p className="mb-5 text-sm text-slate-700">
              You are about to permanently delete <strong>{selectedLogIds.size}</strong> audit record{selectedLogIds.size !== 1 ? 's' : ''}. Once deleted, these entries will no longer appear in the audit trail.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeleteLogs}
                disabled={deletingLogs}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {deletingLogs ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditVault;

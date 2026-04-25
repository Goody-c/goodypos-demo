import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import {
  TrendingUp,
  ShoppingCart,
  Package,
  AlertCircle,
  ArrowRightLeft,
  Banknote,
  CreditCard,
  CheckCircle2,
  Lock,
  Loader2,
  Download,
  Home,
  Activity,
  WalletCards,
  ShieldCheck,
  TriangleAlert,
  Clock,
  RefreshCw,
  Timer,
} from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { useNotification } from '../../context/NotificationContext';

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getGreeting = (date = new Date()) => {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
};

const formatRoleLabel = (role: unknown) => String(role || 'TEAM_MEMBER')
  .split('_')
  .filter(Boolean)
  .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}`)
  .join(' ');

const DASHBOARD_REQUEST_TIMEOUT_MS = 4500;
const defaultDashboardStats = { total: 0, cash: 0, transfer: 0, pos: 0, count: 0 };
const defaultDailyReminders = {
  totalCount: 0,
  outstandingCount: 0,
  collectionCount: 0,
  overdueOutstandingCount: 0,
  overdueCollectionCount: 0,
  outstandingSales: [],
  marketCollections: [],
};
const defaultAuditSummary = {
  highRiskCount: 0,
  priceChangesToday: 0,
  discountsToday: 0,
  stockAdjustmentsToday: 0,
  recentHighRisk: [],
};

const withDashboardTimeout = async <T,>(promise: Promise<T>, fallback: T, timeoutMs = DASHBOARD_REQUEST_TIMEOUT_MS): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn('Dashboard request fallback:', error);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const mapLowStockItems = (analyticsData: any) => {
  const lowStockItems = Array.isArray(analyticsData?.lowStockItems)
    ? analyticsData.lowStockItems
    : [];

  return lowStockItems.map((item: any) => {
    const stock = Math.max(0, Number(item?.stock || 0));
    return {
      ...item,
      displayStock: stock,
      stockMessage: `${stock} unit(s) remaining`,
    };
  });
};

const StoreOwnerDashboard: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [stats, setStats] = useState<any>(defaultDashboardStats);
  const [store, setStore] = useState<any>(null);
  const [lowStock, setLowStock] = useState<any[]>([]);
  const [staffSales, setStaffSales] = useState<any>(null);
  const [teamSales, setTeamSales] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [dailyReminders, setDailyReminders] = useState<any>(defaultDailyReminders);
  const [activityFeed, setActivityFeed] = useState<any[]>([]);
  const [auditSummary, setAuditSummary] = useState<any>(defaultAuditSummary);
  const [selectedStaffDate, setSelectedStaffDate] = useState(() => getLocalDateValue());
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [autoRefreshTick, setAutoRefreshTick] = useState(0);
  const AUTO_REFRESH_SECS = 300;
  const dashboardRequestIdRef = useRef(0);
  const deferredLoadTimerRef = useRef<number | null>(null);

  // Profile Password Change State
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileForm, setProfileForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinForm, setPinForm] = useState({ currentPin: '', currentPassword: '', newPin: '', confirmPin: '' });
  const [changingPin, setChangingPin] = useState(false);

  useEffect(() => {
    void loadDashboard();

    return () => {
      dashboardRequestIdRef.current += 1;
      if (deferredLoadTimerRef.current != null) {
        window.clearTimeout(deferredLoadTimerRef.current);
        deferredLoadTimerRef.current = null;
      }
    };
  }, [user?.role, selectedStaffDate]);

  const loadDashboard = async (silent = false) => {
    const isLeadership = user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER' || user?.role === 'ACCOUNTANT';
    const canViewReminders = isLeadership;
    const requestId = ++dashboardRequestIdRef.current;

    if (deferredLoadTimerRef.current != null) {
      window.clearTimeout(deferredLoadTimerRef.current);
      deferredLoadTimerRef.current = null;
    }

    if (!silent) setLoading(true);

    try {
      const [zReport, storeData] = await Promise.all([
        withDashboardTimeout(appFetch('/api/reports/z-report'), defaultDashboardStats),
        withDashboardTimeout(appFetch('/api/store/settings'), null),
      ]);

      if (dashboardRequestIdRef.current !== requestId) return;

      setStats(zReport || defaultDashboardStats);
      setStore(storeData);
    } catch (err) {
      if (dashboardRequestIdRef.current !== requestId) return;
      console.error(err);
      setStats(defaultDashboardStats);
    } finally {
      if (dashboardRequestIdRef.current === requestId) {
        if (!silent) setLoading(false);
      }
    }

    deferredLoadTimerRef.current = window.setTimeout(() => {
      void Promise.all([
        user?.role === 'STAFF'
          ? withDashboardTimeout(appFetch('/api/reports/my-sales-chart'), null)
          : Promise.resolve(null),
        isLeadership
          ? withDashboardTimeout(appFetch(`/api/reports/staff-sales-chart?date=${encodeURIComponent(selectedStaffDate)}&days=7`), null)
          : Promise.resolve(null),
        withDashboardTimeout(appFetch('/api/analytics'), null),
        user?.role === 'STORE_ADMIN'
          ? withDashboardTimeout(appFetch('/api/system-logs/summary'), defaultAuditSummary)
          : Promise.resolve(null),
        canViewReminders
          ? withDashboardTimeout(appFetch('/api/reminders/daily'), defaultDailyReminders)
          : Promise.resolve(null),
        withDashboardTimeout(appFetch('/api/dashboard/activity-feed?limit=8'), { items: [] }),
      ])
        .then(([staffSalesData, teamSalesData, analyticsData, auditData, reminderData, activityData]) => {
          if (dashboardRequestIdRef.current !== requestId) return;

          setStaffSales(staffSalesData);
          setTeamSales(teamSalesData);
          setInsights(analyticsData);
          setLowStock(mapLowStockItems(analyticsData));
          setDailyReminders(reminderData || defaultDailyReminders);
          setActivityFeed(Array.isArray(activityData?.items) ? activityData.items : []);
          setAuditSummary(auditData || defaultAuditSummary);
        })
        .catch((error) => {
          if (dashboardRequestIdRef.current === requestId) {
            console.warn('Deferred dashboard load fallback:', error);
          }
        })
        .finally(() => {
          if (dashboardRequestIdRef.current === requestId) {
            deferredLoadTimerRef.current = null;
          }
        });
    }, 120);
  };

  // Live clock + auto-refresh ticker (every second)
  useEffect(() => {
    const id = window.setInterval(() => {
      setCurrentTime(new Date());
      setAutoRefreshTick(t => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Trigger silent reload every AUTO_REFRESH_SECS seconds
  useEffect(() => {
    if (autoRefreshTick > 0 && autoRefreshTick % AUTO_REFRESH_SECS === 0) {
      void loadDashboard(true);
    }
  }, [autoRefreshTick]);

  const handleManualRefresh = async () => {
    if (isRefreshing || loading) return;
    setIsRefreshing(true);
    setAutoRefreshTick(0);
    await loadDashboard(true);
    setIsRefreshing(false);
  };

  const handleDownloadZReport = async () => {
    if (!stats || !store) return;
    const { generateZReportPDF } = await import('../../lib/pdf');
    const { doc, filename } = await generateZReportPDF(stats, store);
    doc.save(filename);
  };

  const handleProfilePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profileForm.newPassword !== profileForm.confirmPassword) {
      showNotification({ message: 'New passwords do not match', type: 'error' });
      return;
    }
    setChangingPassword(true);
    try {
      await appFetch('/api/auth/profile/password', {
        method: 'PUT',
        body: JSON.stringify({
          currentPassword: profileForm.currentPassword,
          newPassword: profileForm.newPassword
        })
      });
      showNotification({ message: 'Password changed successfully', type: 'success' });
      setShowProfileModal(false);
      setProfileForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      showNotification({ message: String(err.message), type: 'error' });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleProfilePinChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinForm.newPin !== pinForm.confirmPin) {
      showNotification({ message: 'New PIN values do not match', type: 'error' });
      return;
    }
    if (!/^\d{4,6}$/.test(pinForm.newPin)) {
      showNotification({ message: 'PIN must be 4-6 digits', type: 'warning' });
      return;
    }

    setChangingPin(true);
    try {
      await appFetch('/api/auth/profile/pin', {
        method: 'PUT',
        body: JSON.stringify({
          currentPin: pinForm.currentPin,
          currentPassword: pinForm.currentPassword,
          newPin: pinForm.newPin,
        })
      });
      showNotification({ message: 'PIN updated successfully', type: 'success' });
      setShowPinModal(false);
      setPinForm({ currentPin: '', currentPassword: '', newPin: '', confirmPin: '' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err), type: 'error' });
    } finally {
      setChangingPin(false);
    }
  };

  const closePinModal = () => {
    setShowPinModal(false);
    setPinForm({ currentPin: '', currentPassword: '', newPin: '', confirmPin: '' });
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  const isStaff = user?.role === 'STAFF';
  const isLeadership = user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER';
  const canRecoverPinWithPassword = user?.role === 'STORE_ADMIN' || user?.role === 'SYSTEM_ADMIN';
  const chartData = isStaff
    ? (staffSales?.trend || [])
    : [
        { name: 'Cash', value: Number(stats?.cash || 0) },
        { name: 'Transfer', value: Number(stats?.transfer || 0) },
        { name: 'POS', value: Number(stats?.pos || 0) }
      ];
  const chartMaxValue = Math.max(...chartData.map((item: any) => Number(isStaff ? item.total : item.value) || 0), 1);
  const teamChartMaxValue = Math.max(
    1,
    ...(teamSales?.staff || []).flatMap((member: any) => (member.trend || []).map((point: any) => Number(point.total) || 0))
  );
  const selectedStaffDateLabel = new Date(`${selectedStaffDate}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const paymentMix = isStaff
    ? [
        { label: 'Cash', value: Number(staffSales?.cash || 0) },
        { label: 'Transfer', value: Number(staffSales?.transfer || 0) },
        { label: 'POS', value: Number(staffSales?.pos || 0) },
      ]
    : [
        { label: 'Cash', value: Number(stats?.cash || 0) },
        { label: 'Transfer', value: Number(stats?.transfer || 0) },
        { label: 'POS', value: Number(stats?.pos || 0) },
      ];
  const strongestChannel = [...paymentMix].sort((a, b) => b.value - a.value)[0] || { label: 'No sales', value: 0 };
  const liveTransactionCount = isStaff ? Number(staffSales?.count || 0) : Number(teamSales?.summary?.count || 0);
  const liveSalesTotal = isStaff ? Number(staffSales?.total || 0) : Number(teamSales?.summary?.total || stats?.total || 0);
  const averageTicket = liveTransactionCount > 0 ? liveSalesTotal / liveTransactionCount : 0;
  const lowStockSummary = lowStock.length === 0
    ? 'Inventory healthy'
    : `${lowStock.length} product${lowStock.length === 1 ? '' : 's'} need attention`;
  const topSellers = Array.isArray(insights?.topSellingProducts) ? insights.topSellingProducts : [];
  const restockSuggestions = Array.isArray(insights?.restockSuggestions) ? insights.restockSuggestions : [];
  const staffAnnouncement = String(store?.staff_announcement_text || '').trim();
  const hasStaffAnnouncement = Boolean(store?.staff_announcement_active) && Boolean(staffAnnouncement);
  const outstandingReminderAmount = Array.isArray(dailyReminders?.outstandingSales)
    ? dailyReminders.outstandingSales.reduce((sum: number, sale: any) => sum + (Number(sale?.amount_due || 0) || 0), 0)
    : 0;
  const overdueReminderCount = Number(dailyReminders?.overdueOutstandingCount || 0) + Number(dailyReminders?.overdueCollectionCount || 0);
  const visibleQuickActions = [
    { label: 'New Sale', description: 'Open the POS terminal and start a checkout.', to: '/pos', icon: ShoppingCart, roles: ['STORE_ADMIN', 'MANAGER', 'STAFF'] },
    { label: 'Attendance', description: 'Clock in, clock out, and review today’s shift log.', to: '/attendance', icon: Activity, roles: ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF'] },
    { label: 'Inventory', description: 'Add stock, adjust counts, or review low items.', to: '/inventory', icon: Package, roles: ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF'] },
    { label: 'Purchases', description: 'Create supplier orders and receive incoming stock.', to: '/purchases', icon: Package, roles: ['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER'] },
    { label: 'Invoices', description: 'Review recent sales, pending payments, and printouts.', to: '/invoices', icon: Download, roles: ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF'] },
    { label: 'Expenses', description: 'Record spending without leaving the dashboard flow.', to: '/expenses', icon: Banknote, roles: ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT'] },
    { label: 'Transfer Vault', description: 'Track transfer confirmations and internal fund moves.', to: '/transfer-vault', icon: ArrowRightLeft, roles: ['STORE_ADMIN', 'MANAGER'] },
    { label: 'Sales Reports', description: 'Open reports for daily totals and trends.', to: '/reports', icon: TrendingUp, roles: ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT'] },
  ].filter((entry) => entry.roles.includes(String(user?.role || '')));
  const smartAlerts = [
    {
      title: 'Low Stock Watch',
      count: lowStock.length,
      tone: lowStock.length > 0 ? 'amber' : 'emerald',
      detail: lowStock.length > 0 ? lowStockSummary : 'Inventory is healthy right now.',
      actionLabel: 'Open Inventory',
      to: '/inventory',
      roles: ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF'],
    },
    {
      title: 'Outstanding Debts',
      count: Number(dailyReminders?.outstandingCount || 0),
      tone: Number(dailyReminders?.outstandingCount || 0) > 0 ? 'rose' : 'emerald',
      detail: Number(dailyReminders?.outstandingCount || 0) > 0
        ? `${formatCurrency(outstandingReminderAmount)} awaiting payment from customers.`
        : 'No unpaid customer balances at the moment.',
      actionLabel: 'View Invoices',
      to: '/invoices',
      roles: ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT'],
    },
    {
      title: 'Collections Due',
      count: Number(dailyReminders?.collectionCount || 0),
      tone: overdueReminderCount > 0 ? 'amber' : 'sky',
      detail: Number(dailyReminders?.collectionCount || 0) > 0
        ? `${overdueReminderCount} overdue follow-up${overdueReminderCount === 1 ? '' : 's'} need attention.`
        : 'No open market collections or due reminders.',
      actionLabel: 'Open Market Collections',
      to: '/market-collections',
      roles: ['STORE_ADMIN', 'MANAGER'],
    },
  ].filter((alert) => alert.roles.includes(String(user?.role || '')));
  const formatActivityTime = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? 'Just now'
      : parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const greeting = getGreeting();
  const roleLabel = formatRoleLabel(user?.role);
  const dashboardStoreLabel = String(store?.name || store?.store_name || 'Your store').trim();

  // Live clock display
  const timeDisplay = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

  // Auto-refresh countdown
  const refreshCountdownSecs = AUTO_REFRESH_SECS - (autoRefreshTick % AUTO_REFRESH_SECS);
  const countdownMin = String(Math.floor(refreshCountdownSecs / 60)).padStart(2, '0');
  const countdownSec = String(refreshCountdownSecs % 60).padStart(2, '0');

  // Shift elapsed since midnight
  const shiftElapsed = (() => {
    const midnight = new Date(currentTime);
    midnight.setHours(0, 0, 0, 0);
    const elapsed = Math.floor((currentTime.getTime() - midnight.getTime()) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  })();

  // Payment mix donut ring
  const donutCash = Number(isStaff ? (staffSales?.cash || 0) : stats.cash);
  const donutTransfer = Number(isStaff ? (staffSales?.transfer || 0) : stats.transfer);
  const donutPos = Number(isStaff ? (staffSales?.pos || 0) : stats.pos);
  const donutTotal = donutCash + donutTransfer + donutPos;
  const donutR = 36;
  const donutCirc = 2 * Math.PI * donutR;
  const donutSegments = [
    { value: donutCash, color: '#10b981', label: 'Cash', bg: 'bg-emerald-900/200' },
    { value: donutTransfer, color: '#3b82f6', label: 'Transfer', bg: 'bg-blue-900/200' },
    { value: donutPos, color: '#8b5cf6', label: 'POS', bg: 'bg-violet-500' },
  ];
  let donutCumLen = 0;
  const donutCircles = donutTotal > 0
    ? donutSegments.map((seg, i) => {
        const dashLen = (seg.value / donutTotal) * donutCirc;
        const dashOffset = donutCirc / 4 - donutCumLen;
        donutCumLen += dashLen;
        return (
          <circle
            key={i}
            cx="50" cy="50" r={donutR}
            fill="none"
            stroke={seg.color}
            strokeWidth="13"
            strokeLinecap="butt"
            strokeDasharray={`${dashLen} ${donutCirc - dashLen}`}
            strokeDashoffset={dashOffset}
          />
        );
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-7xl overflow-x-hidden space-y-6 sm:space-y-8">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-600">{greeting}</p>
            <h1 className="text-2xl font-bold text-slate-900">{dashboardStoreLabel} Dashboard</h1>
            <p className="text-slate-500">Live sales, stock movement, and reminders for the current shift.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">
              {roleLabel}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">
              Focus date: {selectedStaffDateLabel}
            </span>
            <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${lowStock.length > 0 ? 'border border-amber-200 bg-amber-900/20 text-amber-400' : 'border border-emerald-200 bg-emerald-900/20 text-emerald-400'}`}>
              {lowStock.length > 0 ? lowStockSummary : 'Inventory healthy'}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          {/* Live clock + refresh row */}
          <div className="flex items-center justify-end gap-2">
            <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 font-mono text-sm font-bold text-white">
              <Clock size={14} className="shrink-0" />
              {timeDisplay}
            </div>
            <button
              onClick={() => void handleManualRefresh()}
              disabled={isRefreshing || loading}
              title="Click to refresh now"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              <span className="font-mono">{countdownMin}:{countdownSec}</span>
            </button>
          </div>
          {/* Action buttons row */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link to="/" className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-700 sm:w-auto">
              <Home size={16} /> Home
            </Link>
            <button
              onClick={() => setShowProfileModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-700 sm:w-auto"
            >
              <Lock size={16} /> My Password
            </button>
            <button
              onClick={() => setShowPinModal(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-700 sm:w-auto"
            >
              <Lock size={16} /> My PIN
            </button>
            <button
              onClick={handleDownloadZReport}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800 sm:w-auto"
            >
              <Download size={16} /> Download Z-Report
            </button>
            <div className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-100 px-4 py-2 text-center text-xs font-bold uppercase tracking-widest text-green-700 sm:w-auto">
              <CheckCircle2 size={16} /> Ledger Active
            </div>
          </div>
        </div>
      </header>

      {hasStaffAnnouncement && (
        <section className="rounded-2xl border border-red-700 bg-gradient-to-r from-red-600 via-red-600 to-rose-600 p-4 shadow-lg shadow-red-200/50">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white/15 p-3 text-white ring-1 ring-white/20">
              <AlertCircle size={20} />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-red-100">Quick Staff Announcement</p>
              <h2 className="mt-1 text-lg font-black text-white">{staffAnnouncement}</h2>
              <p className="mt-1 text-sm text-red-50/95">This reminder was posted by the store owner and stays visible here until it is cleared.</p>
            </div>
          </div>
        </section>
      )}

      {/* ── TODAY AT A GLANCE ── */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_auto]">
        {/* Payment Mix Donut Ring */}
        <div className="sm:col-span-2 xl:col-span-1 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm flex items-center gap-6">
          <div className="relative h-28 w-28 shrink-0">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-0">
              <circle cx="50" cy="50" r={donutR} fill="none" stroke="#f1f5f9" strokeWidth="13" />
              {donutCircles ?? (
                <circle cx="50" cy="50" r={donutR} fill="none" stroke="#e2e8f0" strokeWidth="13" strokeDasharray={`${donutCirc} 0`} />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">Total</span>
              <span className="text-[11px] font-black text-slate-900 leading-tight">{formatCurrency(donutTotal)}</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400 mb-3">Payment Mix</p>
            <div className="space-y-2">
              {donutSegments.map((seg) => {
                const pct = donutTotal > 0 ? Math.round((seg.value / donutTotal) * 100) : 0;
                return (
                  <div key={seg.label}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2.5 w-2.5 rounded-full ${seg.bg}`} />
                        <span className="text-xs font-bold text-slate-300">{seg.label}</span>
                      </div>
                      <span className="text-xs font-black text-slate-900">{pct}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${seg.bg} transition-all duration-500`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Shift Elapsed Timer */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Shift Elapsed</p>
            <div className="rounded-lg bg-indigo-100 p-1.5 text-indigo-600"><Timer size={14} /></div>
          </div>
          <p className="text-3xl font-black text-slate-900 font-mono tracking-tight">{shiftElapsed}</p>
          <p className="mt-2 text-xs text-slate-500">Since midnight · {selectedStaffDateLabel}</p>
        </div>

        {/* Auto-refresh countdown */}
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Next Sync</p>
            <button
              onClick={() => void handleManualRefresh()}
              disabled={isRefreshing || loading}
              className="rounded-lg bg-slate-100 p-1.5 text-slate-600 hover:bg-slate-200 disabled:opacity-50 transition-colors"
              title="Refresh now"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <p className="text-3xl font-black text-slate-900 font-mono tracking-tight">{countdownMin}:{countdownSec}</p>
          <p className="mt-2 text-xs text-slate-500">Auto-refreshes every 5 min. Click to sync now.</p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Quick Actions</h2>
              <p className="text-sm text-slate-500">Jump into the tasks store teams use most often.</p>
            </div>
            <div className="rounded-xl bg-slate-100 p-2 text-slate-300"><Activity size={18} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleQuickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.label}
                  to={action.to}
                  className="group rounded-2xl border border-slate-200 bg-slate-50 p-4 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-sm"
                >
                  <div className="mb-3 inline-flex rounded-xl bg-slate-900 p-2 text-white">
                    <Icon size={18} />
                  </div>
                  <p className="font-bold text-slate-900">{action.label}</p>
                  <p className="mt-1 text-xs text-slate-500">{action.description}</p>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Smart Alerts</h2>
              <p className="text-sm text-slate-500">Low-risk reminders that help you act early.</p>
            </div>
            <div className="rounded-xl bg-amber-100 p-2 text-amber-600"><TriangleAlert size={18} /></div>
          </div>
          <div className="space-y-3">
            {smartAlerts.map((alert) => {
              const toneClasses = alert.tone === 'rose'
                ? 'border-rose-200 bg-rose-900/20 text-rose-400'
                : alert.tone === 'amber'
                  ? 'border-amber-200 bg-amber-900/20 text-amber-400'
                  : alert.tone === 'sky'
                    ? 'border-sky-200 bg-sky-50 text-sky-700'
                    : 'border-emerald-200 bg-emerald-900/20 text-emerald-400';

              return (
                <div key={alert.title} className={`rounded-2xl border p-4 ${toneClasses}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.24em]">{alert.title}</p>
                      <p className="mt-1 text-2xl font-black">{alert.count}</p>
                    </div>
                    <Link to={alert.to} className="rounded-full bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-300 shadow-sm">
                      {alert.actionLabel}
                    </Link>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{alert.detail}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Recent Activity Timeline</h2>
            <p className="text-sm text-slate-500">Latest sales, stock edits, and expenses from your store.</p>
          </div>
          <div className="rounded-xl bg-slate-100 p-2 text-slate-300"><Activity size={18} /></div>
        </div>

        <div className="space-y-3">
          {activityFeed.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              No recent activity yet. New sales, stock edits, and expenses will appear here automatically.
            </div>
          ) : activityFeed.map((entry: any) => {
            const Icon = entry.type === 'expense' ? Banknote : entry.type === 'stock' ? Package : ShoppingCart;
            const iconClasses = entry.type === 'expense'
              ? 'bg-rose-100 text-rose-600'
              : entry.type === 'stock'
                ? 'bg-amber-100 text-amber-600'
                : 'bg-emerald-100 text-emerald-600';
            const amountText = Number(entry.amount || 0) > 0
              ? (entry.type === 'expense' ? `-${formatCurrency(entry.amount)}` : formatCurrency(entry.amount))
              : null;

            return (
              <Link
                key={entry.id}
                to={entry.href || '#'}
                className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 transition-colors hover:bg-white sm:flex-row sm:items-start"
              >
                <div className={`inline-flex rounded-xl p-2 ${iconClasses}`}>
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900">{entry.title}</p>
                      <p className="text-sm text-slate-600">{entry.detail}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{formatActivityTime(String(entry.timestamp || ''))}</p>
                      {amountText && <p className="mt-1 text-sm font-black text-slate-900">{amountText}</p>}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {user?.role === 'STORE_ADMIN' && (
        <section className={`rounded-2xl border p-4 shadow-sm ${Number(auditSummary?.highRiskCount || 0) > 0 ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-900/20'}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className={`rounded-2xl p-3 ${Number(auditSummary?.highRiskCount || 0) > 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                <TriangleAlert size={22} />
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Owner Activity Feed</p>
                <h2 className="text-xl font-black text-slate-900">
                  {Number(auditSummary?.highRiskCount || 0) > 0
                    ? `${auditSummary.highRiskCount} high-risk audit alert${Number(auditSummary.highRiskCount) === 1 ? '' : 's'} today`
                    : 'No high-risk audit alerts today'}
                </h2>
                <p className="mt-1 text-sm text-slate-600">Price changes, sale deletions, and stock edits update here automatically while you work.</p>
              </div>
            </div>
            <Link to="/audit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800">
              <ShieldCheck size={16} /> Open Audit Vault
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-300 shadow-sm">Price changes: {Number(auditSummary?.priceChangesToday || 0)}</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-300 shadow-sm">Discounts: {Number(auditSummary?.discountsToday || 0)}</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-300 shadow-sm">Stock edits: {Number(auditSummary?.stockAdjustmentsToday || 0)}</span>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-slate-100 rounded-xl text-slate-600"><TrendingUp /></div>
            <span className="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded">+12%</span>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">{isStaff ? 'My Sales Today' : 'Daily Total'}</p>
          <h3 className="text-2xl font-black text-slate-900">{formatCurrency(isStaff ? (staffSales?.total || 0) : stats.total)}</h3>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-green-100 rounded-xl text-green-600"><Banknote /></div>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">{isStaff ? 'My Cash Sales' : 'Cash In Hand'}</p>
          <h3 className="text-2xl font-black text-slate-900">{formatCurrency(isStaff ? (staffSales?.cash || 0) : stats.cash)}</h3>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-blue-100 rounded-xl text-blue-600"><ArrowRightLeft /></div>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">{isStaff ? 'My Transfers' : 'Bank Transfers'}</p>
          <h3 className="text-2xl font-black text-slate-900">{formatCurrency(isStaff ? (staffSales?.transfer || 0) : stats.transfer)}</h3>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex justify-between items-start mb-4">
            <div className="p-3 bg-purple-100 rounded-xl text-purple-600"><CreditCard /></div>
          </div>
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-1">{isStaff ? 'Transactions Today' : 'POS Terminal'}</p>
          <h3 className="text-2xl font-black text-slate-900">{isStaff ? (staffSales?.count || 0) : formatCurrency(stats.pos)}</h3>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Avg Ticket</span>
            <div className="rounded-lg bg-sky-100 p-2 text-sky-600"><WalletCards size={16} /></div>
          </div>
          <p className="mt-3 text-xl font-black text-slate-900">{formatCurrency(averageTicket)}</p>
          <p className="mt-1 text-xs text-slate-500">Based on {liveTransactionCount} completed sale{liveTransactionCount === 1 ? '' : 's'}.</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Best Channel</span>
            <div className="rounded-lg bg-violet-100 p-2 text-violet-600"><Activity size={16} /></div>
          </div>
          <p className="mt-3 text-xl font-black text-slate-900">{strongestChannel.label}</p>
          <p className="mt-1 text-xs text-slate-500">{formatCurrency(strongestChannel.value)} collected through this route.</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Stock Watch</span>
            <div className={`rounded-lg p-2 ${lowStock.length === 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
              {lowStock.length === 0 ? <ShieldCheck size={16} /> : <TriangleAlert size={16} />}
            </div>
          </div>
          <p className="mt-3 text-xl font-black text-slate-900">{lowStock.length}</p>
          <p className="mt-1 text-xs text-slate-500">{lowStockSummary}</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Sales Pulse</span>
            <div className="rounded-lg bg-emerald-100 p-2 text-emerald-600"><ShoppingCart size={16} /></div>
          </div>
          <p className="mt-3 text-xl font-black text-slate-900">{liveTransactionCount}</p>
          <p className="mt-1 text-xs text-slate-500">{isStaff ? 'Your confirmed transactions today.' : `${teamSales?.summary?.activeStaff || 0} team member(s) active for ${selectedStaffDateLabel}.`}</p>
        </div>
      </div>

      {isLeadership && (
        <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Trending Top Sellers</h2>
                <p className="text-sm text-slate-500">Best-performing products from the last 14 days.</p>
              </div>
              <div className="rounded-xl bg-emerald-100 p-2 text-emerald-600"><TrendingUp size={18} /></div>
            </div>
            <div className="space-y-3">
              {topSellers.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No product movement yet. Sales insights will appear here automatically.</p>
              ) : topSellers.map((product: any, index: number) => (
                <div key={product.id || index} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-900">{product.name}</p>
                    <p className="text-xs text-slate-500">{product.category || 'General'} · {product.quantity || 0} sold</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-slate-900">{formatCurrency(product.revenue || 0)}</p>
                    <p className="text-[11px] text-emerald-600">Stock {product.stock || 0}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Quick Restock Suggestions</h2>
                <p className="text-sm text-slate-500">Products most likely to run short soon.</p>
              </div>
              <div className="rounded-xl bg-amber-100 p-2 text-amber-600"><TriangleAlert size={18} /></div>
            </div>
            <div className="space-y-3">
              {restockSuggestions.length === 0 ? (
                <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No urgent restock actions right now.</p>
              ) : restockSuggestions.map((product: any, index: number) => (
                <div key={product.id || index} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{product.name}</p>
                      <p className="text-xs text-slate-500">{product.category || 'General'} · {product.quantity || 0} sold in 14 days</p>
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-amber-400">
                      Restock {product.suggestedReorder || 1}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600">
                    <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-100">Current stock: {product.stock || 0}</span>
                    <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-100">Avg/day: {product.avgDailySales || 0}</span>
                    <span className="rounded-full bg-white px-2 py-1 ring-1 ring-slate-100">Days left: {product.daysLeft ?? '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <TrendingUp size={20} /> {isStaff ? 'My Sales Chart' : 'Z-Report Visualizer'}
          </h2>
          <div className="h-[300px] rounded-2xl bg-slate-50 p-6">
            {isStaff ? (
              <div className="flex h-full items-end gap-3 overflow-x-auto no-scrollbar">
                {chartData.map((item: any) => {
                  const barHeight = Math.max(12, ((Number(item.total) || 0) / chartMaxValue) * 100);
                  return (
                    <div key={item.date} className="flex min-w-[64px] flex-1 flex-col items-center justify-end gap-3">
                      <span className="text-[11px] font-semibold text-slate-500">{formatCurrency(item.total)}</span>
                      <div className="flex h-52 w-full items-end rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
                        <div
                          className="w-full rounded-lg bg-slate-900 transition-all duration-300"
                          style={{ height: `${barHeight}%` }}
                        />
                      </div>
                      <div className="text-center">
                        <span className="block text-xs font-bold uppercase tracking-wide text-slate-600">{item.label}</span>
                        <span className="text-[10px] text-slate-400">{item.count} sale{item.count === 1 ? '' : 's'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full items-end gap-4">
                {chartData.map((item: any) => {
                  const barHeight = Math.max(12, (Number(item.value || 0) / chartMaxValue) * 100);
                  return (
                    <div key={item.name} className="flex flex-1 flex-col items-center justify-end gap-3">
                      <span className="text-xs font-semibold text-slate-500">{formatCurrency(item.value)}</span>
                      <div className="flex h-52 w-full items-end rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
                        <div
                          className="w-full rounded-lg bg-slate-900 transition-all duration-300"
                          style={{ height: `${barHeight}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{item.name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:p-8">
          <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
            <AlertCircle className="text-red-500" size={20} /> Low Stock Pulse
          </h2>
          <p className="text-sm text-slate-500 mb-6">Critical inventory alerts that need quick attention.</p>
          <div className="flex-1 space-y-4 overflow-x-hidden overflow-y-auto max-h-[300px]">
            {lowStock.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                <CheckCircle2 size={48} />
                <p className="text-sm font-bold">Inventory is healthy</p>
              </div>
            ) : (
              lowStock.map((p: any) => (
                <div key={p.id} className="flex items-center gap-4 p-4 bg-red-50 rounded-xl border border-red-100 animate-pulse">
                  <div className="p-2 bg-white rounded-lg text-red-600 shadow-sm">
                    <Package size={20} />
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="text-sm font-bold text-red-900 truncate">{p.name}</p>
                    <p className="text-xs text-red-700">{p.stockMessage || 'Critical Stock Level'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-black text-red-900">{p.displayStock ?? p.stock}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <Link
            to="/inventory"
            className="w-full mt-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-colors inline-flex items-center justify-center"
          >
            View Full Inventory
          </Link>
        </div>
      </div>

      {isLeadership && (
        <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Staff Sales Chart</h2>
              <p className="text-sm text-slate-500">Daily performance for {selectedStaffDateLabel} plus the previous 6 days.</p>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              View date
              <input
                type="date"
                value={selectedStaffDate}
                onChange={(e) => setSelectedStaffDate(e.target.value)}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-300 outline-none focus:ring-2 focus:ring-slate-900"
              />
            </label>
          </div>

          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Team Total</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{formatCurrency(teamSales?.summary?.total || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Transactions</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{teamSales?.summary?.count || 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Active Staff</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{teamSales?.summary?.activeStaff || 0}</p>
            </div>
          </div>

          {teamSales?.staff?.length ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {teamSales.staff.map((member: any) => (
                <div key={member.id} className="min-w-0 overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-bold text-slate-900">{member.username}</h3>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{member.role}</p>
                    </div>
                    <div className="text-left sm:shrink-0 sm:text-right">
                      <p className="text-xs font-semibold text-slate-500">Selected day</p>
                      <p className="text-lg font-black text-slate-900">{formatCurrency(member.selectedDateTotal || 0)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs sm:text-sm md:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Sales</p>
                      <p className="mt-1 text-lg font-black text-slate-900">{member.selectedDateCount || 0}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Cash</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(member.cash || 0)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Transfer</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(member.transfer || 0)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">POS</p>
                      <p className="mt-1 text-sm font-black text-slate-900">{formatCurrency(member.pos || 0)}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-end gap-2 overflow-x-auto no-scrollbar">
                    {member.trend.map((point: any) => {
                      const barHeight = Math.max(10, ((Number(point.total) || 0) / teamChartMaxValue) * 100);
                      return (
                        <div key={point.date} className="flex min-w-[56px] flex-1 flex-col items-center justify-end gap-2">
                          <span className="text-[10px] font-semibold text-slate-500">{formatCurrency(point.total)}</span>
                          <div className="flex h-28 w-full items-end rounded-lg bg-slate-50 p-1.5 ring-1 ring-slate-100">
                            <div className="w-full rounded-md bg-slate-900" style={{ height: `${barHeight}%` }} />
                          </div>
                          <div className="text-center">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">{point.label}</p>
                            <p className="text-[10px] text-slate-400">{point.count}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
              No staff or manager sales data found for this store yet.
            </div>
          )}
        </section>
      )}

      {/* Profile Password Modal */}
      {showProfileModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl text-slate-900">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-900">Change My Password</h2>
              <button onClick={() => setShowProfileModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                <Home size={24} />
              </button>
            </div>
            <form onSubmit={handleProfilePasswordChange} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Current Password</label>
                <input
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={profileForm.currentPassword}
                  onChange={e => setProfileForm({...profileForm, currentPassword: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">New Password</label>
                <input
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={profileForm.newPassword}
                  onChange={e => setProfileForm({...profileForm, newPassword: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Confirm New Password</label>
                <input
                  required
                  type="password"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={profileForm.confirmPassword}
                  onChange={e => setProfileForm({...profileForm, confirmPassword: e.target.value})}
                  placeholder="••••••••"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={changingPassword}
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2"
                >
                  {changingPassword ? <Loader2 className="animate-spin" size={18} /> : <Lock size={18} />}
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPinModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[70]">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl text-slate-900">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Set My Checkout PIN</h2>
                <p className="text-sm text-slate-500">Use this PIN to confirm Smart Retail Mode sales under your own name.</p>
              </div>
              <button onClick={closePinModal} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                <Home size={24} />
              </button>
            </div>
            <form onSubmit={handleProfilePinChange} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Current PIN (leave blank if none yet)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={pinForm.currentPin}
                  onChange={e => setPinForm({...pinForm, currentPin: (e.target.value.match(/\d/g) || []).join('').slice(0, 6)})}
                  placeholder="1234"
                />
              </div>
              {canRecoverPinWithPassword && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-700 mb-2">Forgot PIN?</p>
                  <p className="text-xs text-slate-600 mb-3">As Store Owner, you can use your normal login password instead of the current PIN.</p>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Login Password (optional fallback)</label>
                  <input
                    type="password"
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                    value={pinForm.currentPassword}
                    onChange={e => setPinForm({ ...pinForm, currentPassword: e.target.value })}
                    placeholder="Enter your account password if PIN is forgotten"
                  />
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">New PIN</label>
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={pinForm.newPin}
                  onChange={e => setPinForm({...pinForm, newPin: (e.target.value.match(/\d/g) || []).join('').slice(0, 6)})}
                  placeholder="4-6 digits"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Confirm New PIN</label>
                <input
                  required
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 text-slate-900 placeholder:text-slate-400"
                  value={pinForm.confirmPin}
                  onChange={e => setPinForm({...pinForm, confirmPin: (e.target.value.match(/\d/g) || []).join('').slice(0, 6)})}
                  placeholder="Repeat PIN"
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={closePinModal}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={changingPin}
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2"
                >
                  {changingPin ? <Loader2 className="animate-spin" size={18} /> : <Lock size={18} />}
                  Save PIN
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoreOwnerDashboard;

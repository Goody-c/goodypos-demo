import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import {
  LayoutDashboard,
  LayoutGrid,
  Package,
  Users,
  Settings as SettingsIcon,
  ShoppingCart,
  ShieldAlert,
  LogOut,
  Store,
  ArrowRightLeft,
  BarChart3,
  UserCircle,
  FileText,
  Banknote,
  Menu,
  Moon,
  SunMedium,
  WalletCards,
  RotateCcw,
  Wrench,
  Clock3,
  X,
} from 'lucide-react';

const Login = lazy(() => import('./pages/Login'));
const SystemAdminDashboard = lazy(() => import('./pages/SystemAdmin/Dashboard'));
const StoreOwnerDashboard = lazy(() => import('./pages/StoreOwner/Dashboard'));
const HandoverNotes = lazy(() => import('./pages/StoreOwner/HandoverNotes'));
const Attendance = lazy(() => import('./pages/StoreOwner/Attendance'));
const Customers = lazy(() => import('./pages/StoreOwner/Customers'));
const Inventory = lazy(() => import('./pages/StoreOwner/Inventory'));
const ProductOverview = lazy(() => import('./pages/StoreOwner/ProductOverview'));
const Staff = lazy(() => import('./pages/StoreOwner/Staff'));
const Settings = lazy(() => import('./pages/StoreOwner/Settings'));
const Reports = lazy(() => import('./pages/StoreOwner/Reports'));
const TransferVault = lazy(() => import('./pages/StoreOwner/TransferVault'));
const Proformas = lazy(() => import('./pages/StoreOwner/Proformas'));
const POS = lazy(() => import('./pages/POS/POS'));
const AuditVault = lazy(() => import('./pages/Audit/AuditVault'));
const Analytics = lazy(() => import('./pages/StoreOwner/Analytics'));
const Expenses = lazy(() => import('./pages/StoreOwner/Expenses'));
const FinancialReports = lazy(() => import('./pages/StoreOwner/FinancialReports'));
const Purchases = lazy(() => import('./pages/StoreOwner/Purchases'));
const MarketCollections = lazy(() => import('./pages/StoreOwner/MarketCollections'));
const VendorPayables = lazy(() => import('./pages/StoreOwner/VendorPayables'));
const SourcedItems = lazy(() => import('./pages/StoreOwner/SourcedItems'));
const ConsignmentHub = lazy(() => import('./pages/StoreOwner/ConsignmentHub'));
const Layaway = lazy(() => import('./pages/StoreOwner/Layaway'));
const Repairs = lazy(() => import('./pages/StoreOwner/Repairs'));
const Returns = lazy(() => import('./pages/StoreOwner/Returns'));
const StockAdjustments = lazy(() => import('./pages/StoreOwner/StockAdjustments'));
const AboutGoodyPos = lazy(() => import('./pages/StoreOwner/AboutGoodyPos'));
const VendorPortal = lazy(() => import('./pages/VendorPortal'));

const ProtectedRoute: React.FC<{ children: React.ReactNode; roles?: string[] }> = ({ children, roles }) => {
  const { user, loading } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" />;
  return <>{children}</>;
};

const PageLoader: React.FC = () => (
  <div className="flex h-screen items-center justify-center bg-[var(--bg)] text-[var(--ink)] transition-colors">
    Loading...
  </div>
);

const ThemeToggleButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 ${compact ? 'min-w-10 px-2.5' : ''}`}
      title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDarkMode ? <SunMedium size={16} /> : <Moon size={16} />}
      {!compact && <span>{isDarkMode ? 'Light mode' : 'Dark mode'}</span>}
    </button>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement | null>(null);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    setMobileMenuOpen(false);

    const frame = window.requestAnimationFrame(() => {
      mainContentRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);
  const navLinkClass = 'flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors min-h-[44px]';;
  const isNavRouteActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };
  const getNavLinkClass = (path: string, extraClass = '') => {
    const isActive = isNavRouteActive(path);
    return `${navLinkClass} ${isActive ? 'bg-slate-800 text-white shadow-[0_10px_30px_-18px_rgba(56,189,248,0.95)] ring-1 ring-sky-400/40' : 'text-slate-100 hover:bg-slate-800/80'} ${extraClass}`.trim();
  };

  const normalizedRole = String(user?.role || '');
  const hasManagementAccess = normalizedRole === 'STORE_ADMIN' || normalizedRole === 'MANAGER' || normalizedRole === 'ACCOUNTANT';
  const hasRepairAccess = ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF'].includes(normalizedRole);
  const hasFinancialReportAccess = normalizedRole === 'STORE_ADMIN' || normalizedRole === 'ACCOUNTANT';
  const hasAuditVaultAccess = normalizedRole === 'STORE_ADMIN';
  const canUsePos = ['STORE_ADMIN', 'MANAGER', 'STAFF'].includes(normalizedRole);
  const canAccessConsignmentHub = ['STORE_ADMIN', 'MANAGER', 'STAFF'].includes(normalizedRole);
  const canAccessSourcedItems = ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF'].includes(normalizedRole);
  const canAccessInvoices = ['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF'].includes(normalizedRole);
  const canAccessProcurementTools = ['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER'].includes(normalizedRole);
  const canAccessProformas = ['STORE_ADMIN', 'MANAGER', 'STAFF'].includes(normalizedRole);



  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--ink)] transition-colors duration-200 lg:flex">
      <div
        className={`fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm transition-opacity lg:hidden ${mobileMenuOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        onClick={closeMobileMenu}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col bg-slate-900 text-white shadow-2xl transition-transform duration-200 print:hidden sm:w-72 sm:max-w-[85vw] lg:static lg:w-64 lg:max-w-none lg:translate-x-0 ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-5 text-xl font-bold sm:text-2xl">
          <div className="flex items-center gap-2">
            <ShieldAlert className="text-red-500" />
            Goody-POS
          </div>
          <button onClick={closeMobileMenu} className="rounded-lg p-2.5 min-w-[44px] min-h-[44px] text-slate-300 hover:bg-slate-800 lg:hidden">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
          {user?.role === 'SYSTEM_ADMIN' ? (
            <Link to="/admin" onClick={closeMobileMenu} className={getNavLinkClass('/admin')}>
              <Store size={18} /> Command Center
            </Link>
          ) : (
            <>
              <div>
                <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500/75">Main</p>
                <div className="space-y-1">
                  <Link to="/" onClick={closeMobileMenu} className={getNavLinkClass('/')}>
                    <LayoutDashboard size={18} /> Dashboard
                  </Link>
                  {canUsePos && (
                    <Link to="/pos" onClick={closeMobileMenu} className={getNavLinkClass('/pos')}>
                      <ShoppingCart size={18} /> POS Terminal
                    </Link>
                  )}
                  <Link to="/inventory" onClick={closeMobileMenu} className={getNavLinkClass('/inventory')}>
                    <Package size={18} /> Inventory
                  </Link>
                  <Link to="/product-overview" onClick={closeMobileMenu} className={getNavLinkClass('/product-overview')}>
                    <LayoutGrid size={18} /> Product Overview
                  </Link>
                  {canAccessInvoices && (
                    <Link to="/invoices" onClick={closeMobileMenu} className={getNavLinkClass('/invoices')}>
                      <FileText size={18} /> Invoices
                    </Link>
                  )}
                </div>
              </div>

              <div className="border-t border-slate-800/80 pt-2">
                <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500/75">Operations</p>
                <div className="space-y-1">
                  <Link to="/handover-notes" onClick={closeMobileMenu} className={getNavLinkClass('/handover-notes')}>
                    <FileText size={18} /> Staff Handover
                  </Link>
                  <Link to="/attendance" onClick={closeMobileMenu} className={getNavLinkClass('/attendance')}>
                    <Clock3 size={18} /> Attendance & Clock-In
                  </Link>
                  {hasRepairAccess && (
                    <Link to="/repairs" onClick={closeMobileMenu} className={getNavLinkClass('/repairs')}>
                      <Wrench size={18} /> Repairs & Warranty
                    </Link>
                  )}
                  {hasRepairAccess && (
                    <Link to="/layaways" onClick={closeMobileMenu} className={getNavLinkClass('/layaways')}>
                      <WalletCards size={18} /> Installment Plan
                    </Link>
                  )}
                  {canAccessProformas && (
                    <Link to="/pro-formas" onClick={closeMobileMenu} className={getNavLinkClass('/pro-formas')}>
                      <FileText size={18} /> Pro-forma Invoices
                    </Link>
                  )}
                  {canAccessSourcedItems && (
                    <Link to="/sourced-items" onClick={closeMobileMenu} className={getNavLinkClass('/sourced-items')}>
                      <Package size={18} /> Sourced Items
                    </Link>
                  )}
                </div>
              </div>

              {(canAccessProcurementTools || hasManagementAccess || canAccessConsignmentHub) && (
                <div className="border-t border-slate-800/80 pt-2">
                  <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500/75">Management</p>
                  <div className="space-y-1">
                    {canAccessConsignmentHub && !hasManagementAccess && (
                      <Link to="/consignment-hub" onClick={closeMobileMenu} className={getNavLinkClass('/consignment-hub')}>
                        <Package size={18} /> Consignment Hub
                      </Link>
                    )}
                    {canAccessProcurementTools && (
                      <>
                        <Link to="/purchases" onClick={closeMobileMenu} className={getNavLinkClass('/purchases')}>
                          <Package size={18} /> Purchases & Suppliers
                        </Link>
                        <Link to="/stock-adjustments" onClick={closeMobileMenu} className={getNavLinkClass('/stock-adjustments')}>
                          <SettingsIcon size={18} /> Stock Adjustments
                        </Link>
                      </>
                    )}
                    {hasManagementAccess && (
                      <>
                        <Link to="/analytics" onClick={closeMobileMenu} className={getNavLinkClass('/analytics')}>
                          <BarChart3 size={18} /> Real-Time Analytics
                        </Link>
                        <Link to="/customers" onClick={closeMobileMenu} className={getNavLinkClass('/customers')}>
                          <UserCircle size={18} /> Customers
                        </Link>
                        <Link to="/expenses" onClick={closeMobileMenu} className={getNavLinkClass('/expenses')}>
                          <Banknote size={18} /> Expense Tracker
                        </Link>
                        <Link to="/vendor-payables" onClick={closeMobileMenu} className={getNavLinkClass('/vendor-payables')}>
                          <WalletCards size={18} /> Vendor Payables
                        </Link>
                        {canAccessConsignmentHub && (
                          <Link to="/consignment-hub" onClick={closeMobileMenu} className={getNavLinkClass('/consignment-hub')}>
                            <Package size={18} /> Consignment Hub
                          </Link>
                        )}
                        {hasFinancialReportAccess && (
                          <Link to="/financial-reports" onClick={closeMobileMenu} className={getNavLinkClass('/financial-reports')}>
                            <BarChart3 size={18} /> Financial Reports
                          </Link>
                        )}
                        {normalizedRole !== 'ACCOUNTANT' && (
                          <>
                            <Link to="/market-collections" onClick={closeMobileMenu} className={getNavLinkClass('/market-collections')}>
                              <Package size={18} /> Market Collections
                            </Link>
                            <Link to="/returns" onClick={closeMobileMenu} className={getNavLinkClass('/returns')}>
                              <RotateCcw size={18} /> Returns & Refunds
                            </Link>
                            <Link to="/staff" onClick={closeMobileMenu} className={getNavLinkClass('/staff')}>
                              <Users size={18} /> Staff Management
                            </Link>
                            <Link to="/transfer-vault" onClick={closeMobileMenu} className={getNavLinkClass('/transfer-vault')}>
                              <ArrowRightLeft size={18} /> Transfer Vault
                            </Link>
                            <Link to="/settings" onClick={closeMobileMenu} className={getNavLinkClass('/settings')}>
                              <SettingsIcon size={18} /> Store Settings
                            </Link>
                          </>
                        )}
                        {hasAuditVaultAccess && (
                          <Link to="/audit" onClick={closeMobileMenu} className={getNavLinkClass('/audit')}>
                            <ShieldAlert size={18} /> Audit Vault
                          </Link>
                        )}
                        <Link to="/reports" onClick={closeMobileMenu} className={getNavLinkClass('/reports')}>
                          <BarChart3 size={18} /> Sales Reports
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="border-t border-slate-800/80 pt-2">
                <p className="mb-1 px-3 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500/75">Info</p>
                <div className="space-y-1">
                  <Link
                    to="/about-goody-pos"
                    onClick={closeMobileMenu}
                    className={getNavLinkClass('/about-goody-pos', (isNavRouteActive('/about-goody-pos') || isNavRouteActive('/about-developer')) ? 'border border-fuchsia-300/80 bg-gradient-to-r from-violet-700 to-fuchsia-600 text-white shadow-[0_10px_30px_-12px_rgba(217,70,239,0.95)] ring-1 ring-fuchsia-300/60' : 'border border-fuchsia-500/20 bg-gradient-to-r from-violet-900/70 to-slate-900 text-fuchsia-50 hover:bg-violet-800/80')}
                  >
                    <UserCircle size={18} /> About Goody POS
                  </Link>
                </div>
              </div>
            </>
          )}
        </nav>

      </aside>

      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 hidden items-center justify-between gap-4 border-b border-slate-200 bg-[var(--surface)] px-6 py-3 shadow-sm backdrop-blur lg:flex">
          <div>
            <p className="text-sm font-bold text-[var(--ink)]">Goody POS</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{user?.role || 'Staff'}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
                {user?.username?.[0]?.toUpperCase() || '?'}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[var(--ink)]">{user?.username}</p>
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{user?.role || 'Staff'}</p>
              </div>
            </div>
            <ThemeToggleButton compact />
            <button
              onClick={() => logout()}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-600 transition hover:bg-red-100"
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </header>

        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-[var(--surface)] px-4 py-3 shadow-sm backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 min-w-[44px] min-h-[44px] text-slate-600"
            >
              <Menu size={18} />
            </button>
            <ThemeToggleButton compact />
          </div>
          <div className="flex items-center gap-2 text-right">
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-bold text-[var(--ink)]">{user?.username}</p>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{user?.role || 'Staff'}</p>
            </div>
            <button
              onClick={() => logout()}
              className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-red-50 p-2.5 min-w-[44px] min-h-[44px] text-red-600 transition hover:bg-red-100"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        <main ref={mainContentRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 pb-6 sm:p-6 lg:p-8 print:hidden">
          {children}
        </main>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/vendor-portal/:storeId" element={<VendorPortal />} />

            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['SYSTEM_ADMIN']}>
                  <Layout><SystemAdminDashboard /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF']}>
                  <Layout><StoreOwnerDashboard /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/pos"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'STAFF']}>
                  <POS />
                </ProtectedRoute>
              }
            />

            <Route
              path="/handover-notes"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF']}>
                  <Layout><HandoverNotes /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/attendance"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF']}>
                  <Layout><Attendance /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/inventory"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF']}>
                  <Layout><Inventory /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/product-overview"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF']}>
                  <Layout><ProductOverview /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/pro-formas"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'STAFF']}>
                  <Layout><Proformas /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/invoices"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF']}>
                  <Layout><Reports /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/about-goody-pos"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER', 'STAFF']}>
                  <Layout><AboutGoodyPos /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/about-developer"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER', 'STAFF']}>
                  <Navigate to="/about-goody-pos" replace />
                </ProtectedRoute>
              }
            />

            <Route
              path="/analytics"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']}>
                  <Layout><Analytics /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']}>
                  <Layout><Customers /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/expenses"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']}>
                  <Layout><Expenses /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/sourced-items"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF']}>
                  <Layout><SourcedItems /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/consignment-hub"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'STAFF']}>
                  <Layout><ConsignmentHub /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/vendor-payables"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']}>
                  <Layout><VendorPayables /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/purchases"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']}>
                  <Layout><Purchases /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/financial-reports"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'ACCOUNTANT']}>
                  <Layout><FinancialReports /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/repairs"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF']}>
                  <Layout><Repairs /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/layaways"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF']}>
                  <Layout><Layaway /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/returns"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER']}>
                  <Layout><Returns /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/stock-adjustments"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']}>
                  <Layout><StockAdjustments /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/market-collections"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER']}>
                  <Layout><MarketCollections /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/staff"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER']}>
                  <Layout><Staff /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/audit"
              element={
                <ProtectedRoute roles={['STORE_ADMIN']}>
                  <Layout><AuditVault /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/transfer-vault"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER']}>
                  <Layout><TransferVault /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/reports"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER']}>
                  <Layout><Reports /></Layout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute roles={['STORE_ADMIN', 'MANAGER']}>
                  <Layout><Settings /></Layout>
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </Router>
  );
};

export default App;

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRightLeft,
  Banknote,
  BarChart3,
  BookOpen,
  ChevronDown,
  Clock3,
  CreditCard,
  Home,
  MessageCircle,
  MonitorSmartphone,
  Package,
  QrCode,
  ReceiptText,
  RefreshCcw,
  ScanLine,
  Settings as SettingsIcon,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  UserCircle2,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';

const TABS = ['Overview', 'Features', "What's New", 'Guides', 'Support'] as const;
type Tab = (typeof TABS)[number];

const AboutDeveloper: React.FC = () => {
  const fallbackPhoto = '/developer-photo-placeholder.svg';
  const [photoSrc, setPhotoSrc] = useState('/developer-photo.jpg');
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [openGuideIndex, setOpenGuideIndex] = useState<number | null>(0);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');

  const stats = useMemo(
    () => [
      { value: '80+', label: 'Business Features' },
      { value: '2', label: 'Store Modes' },
      { value: 'A4 + Thermal', label: 'PDF Formats' },
      { value: 'Offline', label: 'Windows + macOS' },
    ],
    []
  );

  const modes = useMemo(
    () => [
      {
        tag: 'Mode 01',
        title: 'Supermarket',
        subtitle: 'Fast-moving retail',
        desc: 'Optimized for grocery and FMCG operations — quick stock handling, rapid checkout, and clean daily summaries.',
        accent: 'from-emerald-500/20 to-teal-500/20',
        border: 'border-emerald-400/30',
        tagColor: 'text-emerald-300',
        dot: 'bg-emerald-400',
      },
      {
        tag: 'Mode 02',
        title: 'Smart Retail',
        subtitle: 'Electronics & devices',
        desc: 'Built for gadget shops — condition-aware stock, PIN-protected checkout, and vendor consignment workflows.',
        accent: 'from-amber-500/20 to-orange-500/20',
        border: 'border-amber-400/30',
        tagColor: 'text-amber-300',
        dot: 'bg-amber-400',
      },
    ],
    []
  );

  const pillars = useMemo(
    () => [
      {
        icon: <CreditCard size={20} />,
        title: 'Sales & Checkout',
        color: 'text-violet-600',
        bg: 'bg-violet-50',
        border: 'border-violet-100',
        items: ['POS terminal with split payments', 'Discounts & promo pricing', 'Pay-later & layaway', 'WhatsApp receipt sharing'],
      },
      {
        icon: <ReceiptText size={20} />,
        title: 'Invoices & Documents',
        color: 'text-sky-600',
        bg: 'bg-sky-50',
        border: 'border-sky-100',
        items: ['A4 + thermal PDF layouts', 'Invoice number search', 'Store-color branded PDFs', 'Customer statements'],
      },
      {
        icon: <Package size={20} />,
        title: 'Inventory & Stock',
        color: 'text-emerald-600',
        bg: 'bg-emerald-900/20',
        border: 'border-emerald-700/30',
        items: ['Inline double-tap editing', 'Auto barcode generator', 'Barcode label printing', 'Stock adjustments & loss control'],
      },
      {
        icon: <BarChart3 size={20} />,
        title: 'Analytics & Finance',
        color: 'text-amber-600',
        bg: 'bg-amber-900/20',
        border: 'border-amber-700/30',
        items: ['Real-time dashboards', 'Expense tracker & profit', 'Financial ledger & CSV export', 'Z-reports & end-of-day PDFs'],
      },
      {
        icon: <UserCircle2 size={20} />,
        title: 'Vendor & Supply',
        color: 'text-rose-600',
        bg: 'bg-rose-900/20',
        border: 'border-rose-700/30',
        items: ['Vendor portal & payables', 'Consignment hub', 'Purchases & suppliers', 'Market collections ledger'],
      },
      {
        icon: <ShieldCheck size={20} />,
        title: 'Security & Team',
        color: 'text-indigo-600',
        bg: 'bg-indigo-900/20',
        border: 'border-indigo-700/30',
        items: ['Audit vault & oversight', 'PIN-protected gadget checkout', 'Staff management & roles', 'Attendance & handover notes'],
      },
    ],
    []
  );

  const recentUpgrades = useMemo(
    () => [
      { icon: <ShieldCheck size={16} />, title: 'Data Retention & Archive Workspace', label: 'Owner-safe cleanup', desc: 'Preview deletions, download JSON backup + activity archive PDF, then confirm guarded cleanup with explicit safety checks.' },
      { icon: <BarChart3 size={16} />, title: 'Retention Activity Archive PDF', label: 'Pre-delete reporting', desc: 'Before cleanup, generates a polished archive report with key totals, top products, staff performance, and date-range context.' },
      { icon: <Package size={16} />, title: 'Sourced Items Server Pagination', label: 'Faster heavy lists', desc: 'Server-side pagination for smoother browsing, quicker load times, and better stability as records grow.' },
      { icon: <BarChart3 size={16} />, title: 'Analytics & Query Performance Tuning', label: 'Speed improvements', desc: 'Sales trend queries, analytics calculations, and backup paths optimized to reduce repeated scans under larger datasets.' },
      { icon: <ReceiptText size={16} />, title: 'System-Color Branded PDFs', label: 'Sharper documents', desc: 'Invoices, statements, slips, and reports now follow the store document color for polished, consistent brand presentation.' },
      { icon: <Package size={16} />, title: 'Market Collection Slip Redesign', label: 'Cleaner print flow', desc: 'Collection slips open in the same tab with a styled layout that is easier to print, review, and share.' },
      { icon: <UserCircle2 size={16} />, title: 'Vendor Portal & Payables Workspace', label: 'Vendor visibility', desc: 'Portal access, payables review, status visibility, and cleaner bank detail handling for supplier workflows.' },
      { icon: <Package size={16} />, title: 'Consignment Hub & Sourced Items', label: 'Linked stock flows', desc: 'Approvals, returns, and linked records so vendor stock stays organized from intake to settlement.' },
      { icon: <ShieldCheck size={16} />, title: 'PostgreSQL Production Core', label: 'Data reliability', desc: 'Stronger PostgreSQL-first backend for steadier operations, safer scaling, and cleaner production readiness.' },
      { icon: <MonitorSmartphone size={16} />, title: 'Offline Windows + macOS Releases', label: 'Ready to deploy', desc: 'Release packages include the required runtime so stores can install and launch without internet or a separate Node setup.' },
      { icon: <ReceiptText size={16} />, title: 'Store Signature on Documents', label: 'Branded paperwork', desc: 'Upload a signature once and have it appear across invoices, pro-formas, statements, analytics, Z-reports, and receipts.' },
      { icon: <BarChart3 size={16} />, title: 'Modern Dashboard Workspace', label: 'Faster decisions', desc: 'Quick actions, smart alerts, and a recent activity timeline so store teams can spot the next task instantly.' },
    ],
    []
  );

  const features = useMemo(
    () => [
      { icon: <CreditCard size={16} />, title: 'POS Terminal & Mixed Payments', desc: 'Fast checkout with cash, transfer, and POS split payment support, receipt preview, and smooth sale completion.' },
      { icon: <ReceiptText size={16} />, title: 'Invoice Center', desc: 'Dedicated invoice tab with preview, item specs, padded invoice-number search, and clean customer-facing presentation.' },
      { icon: <ReceiptText size={16} />, title: 'Store Signature on Documents', desc: 'Upload once and apply across invoices, pro-formas, statements, analytics, Z-reports, and receipts.' },
      { icon: <ReceiptText size={16} />, title: 'Pro-forma Invoices', desc: 'Generate quotations and reserved-sale documents with expiry dates, branded PDFs, and instant sharing.' },
      { icon: <MessageCircle size={16} />, title: 'WhatsApp Receipt Sharing', desc: 'Share receipts, invoices, pro-formas, orders, and follow-up messages to any number inside WhatsApp.' },
      { icon: <ReceiptText size={16} />, title: 'A4 & Thermal PDF Printing', desc: 'Professional documents in both A4 and thermal sizes with totals, notes, signatures, and better branding.' },
      { icon: <Package size={16} />, title: 'Inventory Management', desc: 'Create, edit, search, sort, and monitor products, categories, images, pricing, stock, and imported items.' },
      { icon: <Package size={16} />, title: 'Inline Product Editing', desc: 'Update product name, category, price, and stock directly inside the inventory list with double-tap editing.' },
      { icon: <MonitorSmartphone size={16} />, title: 'Dedicated Product Overview', desc: 'Full product workspace with Overview, Pricing, Stock, and Specs tabs for clearer day-to-day product review.' },
      { icon: <QrCode size={16} />, title: 'Auto Barcode Generator', desc: 'Automatically create unique barcodes and quick codes for products without manual barcode setup.' },
      { icon: <ScanLine size={16} />, title: 'Barcode Label Printing', desc: 'Print single or bulk barcode labels with multiple-copy support and sheet presets like 2x5, 3x7, and 4x10.' },
      { icon: <RefreshCcw size={16} />, title: 'Dual Business Mode', desc: 'Switch between Supermarket Mode and Smart Retail Mode with condition-based stock and device-friendly workflows.' },
      { icon: <BarChart3 size={16} />, title: 'Real-Time Analytics', desc: 'Live owner and manager dashboards for today&apos;s sales, payment split, sales trends, and business performance.' },
      { icon: <Clock3 size={16} />, title: 'Attendance & Clock-In', desc: 'Staff clock in and out with shift notes while leadership tracks presence, sessions, and hours worked.' },
      { icon: <Banknote size={16} />, title: 'Expense Tracker', desc: 'Record store expenses, filter by date, remove errors, and compare spending directly against business profit.' },
      { icon: <CreditCard size={16} />, title: 'Discounts & Promo Pricing', desc: 'Apply percentage or fixed discounts during checkout, save promo notes, and show clear breakdown on invoices.' },
      { icon: <ReceiptText size={16} />, title: 'Customer Statements', desc: 'Generate customer account statements with invoice totals, outstanding balance, PDF output, and WhatsApp sharing.' },
      { icon: <CreditCard size={16} />, title: 'Pay-Later & Debt Tracking', desc: 'Save sales with due dates, notes, amount paid, and outstanding balances for customer debt management.' },
      { icon: <CreditCard size={16} />, title: 'Layaway & Installment Plans', desc: 'Track part payments, due dates, locked items, balance follow-up, and installment reminders.' },
      { icon: <ArrowRightLeft size={16} />, title: 'Receivables & Transfer Vault', desc: 'Manage pending transfers, verify receipts, record settlement payments, and remind customers when money is due.' },
      { icon: <Package size={16} />, title: 'Purchases & Suppliers', desc: 'Create purchase orders, manage supplier records, receive incoming stock, and log restock activity into inventory.' },
      { icon: <Package size={16} />, title: 'Market Collections Ledger', desc: 'Track goods given to neighboring shops, generate 5-digit references, and mark each collection as sold or returned.' },
      { icon: <MessageCircle size={16} />, title: 'Collector WhatsApp Updates', desc: 'Send initial notices plus sold, returned, and resend updates with tracking references and due dates.' },
      { icon: <ShieldCheck size={16} />, title: 'PIN-Protected Gadget Checkout', desc: 'Require PIN approval before gadget sales are completed, with sales recorded under the confirmed PIN owner.' },
      { icon: <ShieldCheck size={16} />, title: 'PIN Recovery & Team Reset', desc: 'Store Owners can recover their own PIN with password fallback and reset staff or manager PINs when needed.' },
      { icon: <UserCircle2 size={16} />, title: 'Customer Management', desc: 'Quick add, attach, search, and manage customer records with invoice history and better follow-up visibility.' },
      { icon: <Users size={16} />, title: 'Staff Management & Role Control', desc: 'Add staff accounts, assign roles, reset passwords or checkout PINs, and review sales history.' },
      { icon: <RefreshCcw size={16} />, title: 'Repairs & Warranty Tracker', desc: 'Log customer devices, assign statuses, track technician progress, record payments, and send update reminders.' },
      { icon: <RefreshCcw size={16} />, title: 'Returns & Refunds', desc: 'Process full or partial returns from invoices, restock eligible items, and keep a clean returns history.' },
      { icon: <Package size={16} />, title: 'Stock Adjustments & Loss Control', desc: 'Record damaged, lost, found, internal-use, and restock changes with notes and staff traceability.' },
      { icon: <ShieldCheck size={16} />, title: 'Audit Vault', desc: 'Track sensitive actions, stock adjustments, and accountability records with stronger internal oversight.' },
      { icon: <ShieldCheck size={16} />, title: 'PostgreSQL-Powered Core', desc: 'Production data runs on a PostgreSQL-first engine for better reliability, cleaner scaling, and steadier operations.' },
      { icon: <MonitorSmartphone size={16} />, title: 'Offline Desktop Release', desc: 'Mac and Windows builds ship with the needed runtime so installation can happen without internet or a separate Node install.' },
      { icon: <SettingsIcon size={16} />, title: 'Receipt Layout & Brand Controls', desc: 'Configure receipt paper size, header, footer, bank details, and other document presentation settings.' },
      { icon: <Banknote size={16} />, title: 'Currency & Regional Format', desc: 'Choose the store currency with a searchable picker and keep pricing, receipts, and reports aligned with the region.' },
      { icon: <BarChart3 size={16} />, title: 'Big-Store Performance Scaling', desc: 'Server-side pagination, search optimization, and lighter rendering for large product and sales databases.' },
    ],
    []
  );

  const guides = useMemo(
    () => [
      {
        icon: <ShoppingCart size={18} />,
        title: 'Making a Sale at the POS Terminal',
        color: 'text-violet-600',
        bg: 'bg-violet-50',
        border: 'border-violet-200',
        accent: 'bg-violet-600',
        steps: [
          'Go to POS Terminal from the sidebar.',
          'Search for a product by name or scan its barcode — it will be added to the cart.',
          'Adjust quantity by tapping the item in the cart, or remove it with the trash icon.',
          'Apply a discount (percentage or fixed amount) using the discount button if needed.',
          'Select the payment method: Cash, Transfer, POS, or a split combination.',
          'Enter the amount received, review the receipt preview, then tap Complete Sale.',
          'Share the receipt via WhatsApp or print it directly from the receipt screen.',
        ],
      },
      {
        icon: <Package size={18} />,
        title: 'Adding & Editing Products in Inventory',
        color: 'text-emerald-600',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        accent: 'bg-emerald-600',
        steps: [
          'Open Inventory from the sidebar.',
          'Click Add Product and fill in the product name, category, price, and stock quantity.',
          'Upload a product image (optional) and set a barcode or let the system auto-generate one.',
          'Save the product — it will appear in the inventory list and be available at the POS.',
          'To edit, double-tap any product row directly in the inventory list to update name, price, or stock inline.',
          'Use the search bar and category filters to quickly locate products in large inventories.',
        ],
      },
      {
        icon: <ReceiptText size={18} />,
        title: 'Finding & Sharing Invoices',
        color: 'text-sky-600',
        bg: 'bg-sky-50',
        border: 'border-sky-200',
        accent: 'bg-sky-600',
        steps: [
          'Go to Invoices from the sidebar.',
          'Use the search bar to find an invoice by invoice number, customer name, or date.',
          'Click any invoice to open the full preview with itemized breakdown and totals.',
          'Download the invoice as a PDF in A4 or thermal layout using the download button.',
          'Tap the WhatsApp button to send the invoice directly to a customer\'s phone number.',
          'For pro-forma quotations, use Pro-forma Invoices in the Operations section instead.',
        ],
      },
      {
        icon: <Clock3 size={18} />,
        title: 'Staff Attendance & Clock-In',
        color: 'text-amber-600',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        accent: 'bg-amber-600',
        steps: [
          'Go to Attendance & Clock-In from the sidebar.',
          'Staff members tap Clock In at the start of their shift — the time is automatically recorded.',
          'Add an optional shift note when clocking in (e.g. handover context, task for the day).',
          'At the end of the shift, tap Clock Out to log the session end time.',
          'Managers and owners can view all staff attendance records, filter by date, and see total hours worked.',
          'Use the Staff Handover section to leave structured notes for the incoming shift.',
        ],
      },
      {
        icon: <Wrench size={18} />,
        title: 'Logging a Repair or Warranty Job',
        color: 'text-rose-600',
        bg: 'bg-rose-50',
        border: 'border-rose-200',
        accent: 'bg-rose-600',
        steps: [
          'Open Repairs & Warranty from the sidebar under Operations.',
          'Click New Repair and enter the customer name, device details, and fault description.',
          'Assign a technician and set the initial status (e.g. Received, In Progress).',
          'Save the job — it receives a unique repair reference number.',
          'Update the status as work progresses: In Progress → Ready for Pickup → Completed.',
          'Record any payment collected against the repair job before marking it complete.',
          'Send a WhatsApp update to the customer when the device is ready for pickup.',
        ],
      },
      {
        icon: <CreditCard size={18} />,
        title: 'Setting Up an Installment Plan (Layaway)',
        color: 'text-indigo-600',
        bg: 'bg-indigo-50',
        border: 'border-indigo-200',
        accent: 'bg-indigo-600',
        steps: [
          'Go to Installment Plan from the sidebar under Operations.',
          'Click New Layaway and select or search for the customer.',
          'Add the product(s) being reserved and set the total price.',
          'Enter the initial deposit amount and the agreed payment due date.',
          'Save the plan — the item is locked for the customer and tracked separately from regular stock.',
          'Record each subsequent payment against the layaway as the customer pays in installments.',
          'Once fully paid, mark the plan as Complete to release the item for final handover.',
        ],
      },
      {
        icon: <Banknote size={18} />,
        title: 'Tracking Expenses',
        color: 'text-orange-600',
        bg: 'bg-orange-50',
        border: 'border-orange-200',
        accent: 'bg-orange-600',
        steps: [
          'Open Expense Tracker from the sidebar under Management.',
          'Click Add Expense and enter the description, amount, and category (e.g. Utilities, Supplies).',
          'Set the date of the expense and save.',
          'All expenses are listed chronologically — use the date filter to narrow down a specific period.',
          'The dashboard and analytics automatically deduct expenses when calculating net profit.',
          'Export expense data to CSV from the Financial Reports section for accounting or review.',
        ],
      },
      {
        icon: <Users size={18} />,
        title: 'Managing Staff & Roles',
        color: 'text-teal-600',
        bg: 'bg-teal-50',
        border: 'border-teal-200',
        accent: 'bg-teal-600',
        steps: [
          'Go to Staff Management from the sidebar under Management.',
          'Click Add Staff and fill in the username, role, and initial password.',
          'Assign a role: Staff, Manager, Accountant, or Procurement Officer — each has different access levels.',
          'The new staff member can log in immediately using the credentials you set.',
          'To reset a password or checkout PIN, find the staff member in the list and use the Reset options.',
          'View each staff member\'s sales history and performance directly from their profile.',
          'Remove a staff account by selecting the account and choosing the deactivate or delete option.',
        ],
      },
    ],
    []
  );

  const faqItems = useMemo(
    () => [
      { question: 'What does Goody POS cover?', answer: 'Goody POS covers checkout, inventory, invoices, customer statements, reports, expenses, staff tools, repairs, layaway, purchases, transfers, market collections, consignment, and vendor workflows in one system.' },
      { question: 'Does it support consignment and sourced items?', answer: 'Yes. The app includes Consignment Hub, Sourced Items, Vendor Payables, and settlement tracking so vendor-linked stock can move from intake to sale and payout cleanly.' },
      { question: 'Can I use a vendor portal?', answer: 'Yes. Vendor Portal support is part of the broader supplier workflow, with activity visibility and WhatsApp-ready follow-up for vendor communication.' },
      { question: 'Can I print on both A4 and thermal paper?', answer: 'Yes. Goody POS supports A4 and thermal layouts for invoices, receipts, statements, reports, and market-collection slips.' },
      { question: 'Does Goody POS work offline?', answer: 'Yes. The desktop releases are packaged for offline startup so stores can install and launch without relying on a separate Node setup or always-on internet.' },
    ],
    []
  );

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">

      {/* ── HERO (always visible) ── */}
      <section className="relative overflow-hidden rounded-[32px] bg-[radial-gradient(ellipse_at_top_left,#7c3aed_0%,#4f46e5_28%,#0f172a_65%,#020617_100%)] p-8 text-white shadow-[0_40px_100px_-40px_rgba(79,70,229,0.8)] sm:p-12">
        <div className="pointer-events-none absolute -right-24 -top-20 h-72 w-72 rounded-full bg-fuchsia-500/25 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-16 left-1/3 h-64 w-64 rounded-full bg-indigo-400/20 blur-[80px]" />
        <div className="pointer-events-none absolute bottom-0 right-1/4 h-48 w-48 rounded-full bg-amber-400/15 blur-[70px]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:48px_48px]" />

        <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.3em] text-fuchsia-200 backdrop-blur">
              <Sparkles size={12} /> Goody Technology Limited
            </div>
            <h1 className="text-4xl font-black leading-tight sm:text-6xl" style={{ fontFamily: 'var(--font-display)' }}>
              Built for real<br />
              <span className="bg-gradient-to-r from-fuchsia-300 via-violet-200 to-sky-300 bg-clip-text text-transparent">retail businesses.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-8 text-white/82">
              Goody POS is one platform for sales, invoices, inventory, analytics, staff coordination, and vendor workflows — designed to feel calm, clear, and dependable every day.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {['POS Terminal', 'Smart Retail', 'Market Collections', 'Offline Desktop', 'PostgreSQL Core', 'Security + Scale'].map((b) => (
                <span key={b} className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold text-white/92 backdrop-blur">{b}</span>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-start gap-4 lg:items-end">
            <Link to="/" className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white backdrop-blur transition hover:bg-white/20">
              <Home size={15} /> Home
            </Link>
            <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/10 backdrop-blur">
              <img
                src={photoSrc}
                alt="Goody"
                className="h-48 w-40 object-cover object-top"
                onError={() => { if (photoSrc !== fallbackPhoto) setPhotoSrc(fallbackPhoto); }}
              />
              <div className="px-4 py-3">
                <p className="text-xs font-black text-white">Founder · Developer</p>
                <p className="text-[10px] text-white/72">Problem Solver</p>
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-2xl border border-white/15 bg-white/10 px-5 py-4 backdrop-blur transition hover:bg-white/15">
              <p className="text-2xl font-black text-white sm:text-3xl" style={{ fontFamily: 'var(--font-display)' }}>{s.value}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/65">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── TAB BAR ── */}
      <div className="flex overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm gap-1 scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
              activeTab === tab
                ? 'bg-violet-600 text-white shadow-sm'
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── TAB CONTENT ── */}

      {activeTab === 'Overview' && (
        <div className="space-y-5">
          {/* Two Modes */}
          <section className="grid gap-4 sm:grid-cols-2">
            {modes.map((m) => (
              <div key={m.title} className={`relative overflow-hidden rounded-[28px] border bg-[linear-gradient(135deg,#0f172a,#1e1b4b)] p-6 ${m.border}`}>
                <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-60 ${m.accent}`} />
                <div className="relative z-10">
                  <div className="mb-3 flex items-center gap-2">
                    <div className={`h-2 w-2 rounded-full ${m.dot}`} />
                    <span className={`text-[10px] font-black uppercase tracking-[0.3em] ${m.tagColor}`}>{m.tag}</span>
                  </div>
                  <p className="text-2xl font-black text-white" style={{ fontFamily: 'var(--font-display)' }}>{m.title}</p>
                  <p className="mt-0.5 text-xs font-bold text-white/72">{m.subtitle}</p>
                  <p className="mt-3 text-sm leading-7 text-white/80">{m.desc}</p>
                </div>
              </div>
            ))}
          </section>

          {/* Philosophy */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { title: 'Clean workflows', desc: 'Fast actions, less clutter, and clearer checkout, reporting, and admin flows.', accent: 'border-violet-200 bg-violet-50', label: 'text-violet-700' },
              { title: 'Real business focus', desc: 'Built around what owners, managers, and staff actually face every day.', accent: 'border-sky-200 bg-sky-50', label: 'text-sky-700' },
              { title: 'Security + accountability', desc: 'Protected actions, PIN tools, audit visibility, and safer store-wide workflows.', accent: 'border-emerald-200 bg-emerald-50', label: 'text-emerald-700' },
              { title: 'Modern presentation', desc: 'Polished cards, better PDFs, branded documents, and cleaner mobile responsiveness.', accent: 'border-amber-200 bg-amber-50', label: 'text-amber-700' },
            ].map((c) => (
              <div key={c.title} className={`rounded-2xl border p-5 ${c.accent}`}>
                <p className={`text-sm font-black ${c.label}`}>{c.title}</p>
                <p className="mt-2 text-xs leading-6 text-slate-600">{c.desc}</p>
              </div>
            ))}
          </section>
        </div>
      )}

      {activeTab === 'Features' && (
        <div className="space-y-5">
          {/* Pillars */}
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6">
              <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-violet-600">What's inside</p>
              <h2 className="text-2xl font-black text-slate-900 sm:text-3xl" style={{ fontFamily: 'var(--font-display)' }}>Six pillars of the platform</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pillars.map((p) => (
                <div key={p.title} className={`rounded-2xl border p-5 ${p.bg} ${p.border}`}>
                  <div className={`mb-3 inline-flex rounded-xl bg-white p-2.5 shadow-sm ${p.color}`}>{p.icon}</div>
                  <p className={`text-sm font-black ${p.color}`}>{p.title}</p>
                  <ul className="mt-3 space-y-1.5">
                    {p.items.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs text-slate-300">
                        <span className="mt-0.5 shrink-0 text-slate-400">→</span>{item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Full Feature List */}
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-violet-600">Complete feature list</p>
                <h2 className="text-2xl font-black text-slate-900 sm:text-3xl" style={{ fontFamily: 'var(--font-display)' }}>Everything in the box</h2>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-700">
                <Zap size={11} /> Recently updated
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {features.map((f) => (
                <div key={f.title} className="group rounded-2xl border border-slate-100 bg-[linear-gradient(180deg,#fff,#f8fafc)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="mb-3 inline-flex rounded-xl bg-gradient-to-br from-violet-100 to-amber-100 p-2 text-violet-600 transition group-hover:scale-110">{f.icon}</div>
                  <p className="text-[13px] font-black text-slate-900">{f.title}</p>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {activeTab === "What's New" && (
        <section className="rounded-[28px] border border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc_50%,#f5f3ff)] p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-violet-600">What's been added</p>
              <h2 className="text-2xl font-black text-slate-900 sm:text-3xl" style={{ fontFamily: 'var(--font-display)' }}>Recent upgrades</h2>
            </div>
            <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-violet-700">Continuously updated</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {recentUpgrades.map((u) => (
              <div key={u.title} className="group flex gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                <div className="mt-0.5 shrink-0 rounded-xl bg-gradient-to-br from-violet-100 to-sky-100 p-2 text-violet-600 transition group-hover:scale-110">{u.icon}</div>
                <div>
                  <span className="mb-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">{u.label}</span>
                  <p className="text-sm font-black text-slate-900">{u.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{u.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'Guides' && (
        <section className="rounded-[28px] border border-slate-100 bg-[linear-gradient(135deg,#ffffff,#f8fafc_50%,#eff6ff)] p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-violet-600">Step-by-step</p>
              <h2 className="text-2xl font-black text-slate-900 sm:text-3xl" style={{ fontFamily: 'var(--font-display)' }}>How to use key features</h2>
            </div>
            <span className="flex items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-sky-700">
              <BookOpen size={11} /> Guides
            </span>
          </div>
          <div className="space-y-2">
            {guides.map((guide, index) => {
              const expanded = openGuideIndex === index;
              return (
                <div key={guide.title} className={`overflow-hidden rounded-2xl border transition-all duration-200 ${expanded ? `${guide.border} ${guide.bg}` : 'border-slate-200 bg-white'}`}>
                  <button
                    type="button"
                    onClick={() => setOpenGuideIndex(expanded ? null : index)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`rounded-xl p-2 text-white ${expanded ? guide.accent : 'bg-slate-200 text-slate-500'} transition-colors`}>{guide.icon}</span>
                      <span className={`text-sm font-black ${expanded ? guide.color : 'text-slate-900'}`}>{guide.title}</span>
                    </div>
                    <ChevronDown className={`shrink-0 transition-transform duration-300 ${expanded ? `rotate-180 ${guide.color}` : 'text-slate-400'}`} size={16} />
                  </button>
                  {expanded && (
                    <div className="border-t border-slate-200/60 px-5 py-4">
                      <ol className="space-y-3">
                        {guide.steps.map((step, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black text-white ${guide.accent}`}>{i + 1}</span>
                            <span className="text-sm leading-6 text-slate-600">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {activeTab === 'Support' && (
        <div className="space-y-5">
          {/* FAQ */}
          <section className="rounded-[28px] border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-6">
              <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-violet-600">FAQ</p>
              <h2 className="text-2xl font-black text-slate-900 sm:text-3xl" style={{ fontFamily: 'var(--font-display)' }}>Common questions</h2>
            </div>
            <div className="space-y-2">
              {faqItems.map((item, index) => {
                const expanded = openFaqIndex === index;
                return (
                  <div key={item.question} className={`overflow-hidden rounded-2xl border transition ${expanded ? 'border-violet-200 bg-violet-50' : 'border-slate-200 bg-white'}`}>
                    <button
                      type="button"
                      onClick={() => setOpenFaqIndex(expanded ? null : index)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                    >
                      <span className={`text-sm font-black ${expanded ? 'text-violet-900' : 'text-slate-900'}`}>{item.question}</span>
                      <ChevronDown className={`shrink-0 transition-transform duration-300 ${expanded ? 'rotate-180 text-violet-600' : 'text-slate-400'}`} size={16} />
                    </button>
                    {expanded && (
                      <div className="border-t border-violet-100 px-5 py-4 text-sm leading-7 text-slate-600">{item.answer}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Contact */}
          <section className="relative overflow-hidden rounded-[28px] bg-[radial-gradient(ellipse_at_bottom_right,#7c3aed_0%,#1e1b4b_50%,#0f172a_100%)] p-8 text-white shadow-[0_24px_80px_-40px_rgba(124,58,237,0.6)]">
            <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-violet-400/20 blur-[70px]" />
            <div className="pointer-events-none absolute -bottom-10 right-0 h-48 w-48 rounded-full bg-fuchsia-400/20 blur-[60px]" />
            <div className="relative z-10">
              <p className="mb-1 text-[11px] font-black uppercase tracking-[0.3em] text-fuchsia-200">Get in touch</p>
              <h2 className="text-2xl font-black sm:text-3xl" style={{ fontFamily: 'var(--font-display)' }}>Questions or support?</h2>
              <p className="mt-2 max-w-lg text-sm text-white/82">Reach out on X, by email, or through in-app support. Response time is typically within 1 hour.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="https://x.com/goody_apps" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white backdrop-blur transition hover:bg-white/20">
                  <span className="rounded-xl bg-white/10 p-2 text-amber-300"><MessageCircle size={15} /></span>
                  <span>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/68">Business X</span>
                    <span className="block text-sm font-semibold text-white">@goody_apps</span>
                  </span>
                </a>
                <a href="mailto:contact@goodyapps.com" className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-5 py-3 text-white backdrop-blur transition hover:bg-white/20">
                  <span className="rounded-xl bg-white/10 p-2 text-sky-300"><MessageCircle size={15} /></span>
                  <span>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/68">Email</span>
                    <span className="block text-sm font-semibold text-white">contact@goodyapps.com</span>
                  </span>
                </a>
                <div className="flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-5 py-3 backdrop-blur">
                  <span className="rounded-xl bg-white/10 p-2 text-fuchsia-300"><UserCircle2 size={15} /></span>
                  <span>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-white/68">Support</span>
                    <span className="block text-sm font-semibold text-white">In-app · X DM · 1 hour response</span>
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

    </div>
  );
};

export default AboutDeveloper;

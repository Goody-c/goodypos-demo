import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  CheckCircle2,
  Home,
  Loader2,
  LockKeyhole,
  MessageCircle,
  PackagePlus,
  Plus,
  Search,
  Trash2,
  WalletCards,
  X,
  TrendingUp,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';
import { formatCurrency, openWhatsAppShare } from '../../lib/utils';

const STATUS_FILTERS = ['ALL', 'PENDING', 'COMPLETED', 'OVERDUE'] as const;
const PLAN_TYPES = ['LAYAWAY', 'INSTALLMENT'] as const;
const PAYMENT_FREQUENCIES = ['WEEKLY', 'BIWEEKLY', 'MONTHLY'] as const;

const getDefaultDueDate = () => {
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  return nextWeek.toISOString().split('T')[0];
};

const formatDateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

const normalizeConditionKey = (value?: string | null) => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
const formatConditionLabel = (value?: string | null) => String(value || 'STANDARD').replace(/_/g, ' ');

const flattenSpecsText = (value?: unknown): string => {
  if (value == null) return '';

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';

    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return flattenSpecsText(JSON.parse(trimmed));
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => flattenSpecsText(entry)).filter(Boolean).slice(0, 4).join(' • ');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferredKeys = ['short_description', 'description', 'summary', 'details', 'model', 'brand', 'color', 'storage', 'ram', 'size'];
    const preferredValues = preferredKeys.map((key) => flattenSpecsText(record[key])).filter(Boolean);
    if (preferredValues.length) {
      return preferredValues.slice(0, 3).join(' • ');
    }

    return Object.entries(record)
      .filter(([key]) => !['quick_code', 'barcode', 'thumbnail', 'image', 'images'].includes(key.toLowerCase()))
      .map(([, entry]) => flattenSpecsText(entry))
      .filter(Boolean)
      .slice(0, 3)
      .join(' • ');
  }

  return String(value);
};

const getConditionOptions = (product: any) => {
  if (!product?.condition_matrix) return [];

  return Object.keys(product.condition_matrix || {})
    .filter((key) => product?.condition_matrix?.[key])
    .map((key) => ({
      value: key.toUpperCase(),
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    }));
};

const defaultPaymentDraft = (dueDate?: string | null) => ({
  cash: '',
  transfer: '',
  pos: '',
  note: '',
  due_date: dueDate || '',
});

const getPlanTypeFromSale = (sale: any) => {
  const explicitType = String(sale?.sale_channel || '').trim().toUpperCase();
  if (explicitType === 'LAYAWAY' || explicitType === 'INSTALLMENT') {
    return explicitType;
  }

  const note = String(sale?.note || '').toLowerCase();
  if (note.includes('installment plan')) return 'INSTALLMENT';
  if (note.includes('layaway plan')) return 'LAYAWAY';
  return 'STANDARD';
};

const formatPlanEntry = (sale: any) => {
  const saleChannel = getPlanTypeFromSale(sale);
  const amountDue = Math.max(0, Number(sale?.amount_due || 0) || 0);
  const amountPaid = Math.max(0, Number(sale?.amount_paid || 0) || 0);
  const dueDate = String(sale?.due_date || '').trim() || null;
  const isDueOverdue = Boolean(dueDate) && amountDue > 0 && new Date(`${dueDate}T23:59:59`).getTime() < Date.now();
  const schedule = dueDate && amountDue > 0
    ? [{ installment_number: 1, due_date: dueDate, amount: amountDue }]
    : [];

  return {
    ...sale,
    sale_channel: saleChannel,
    reference_code: `PLAN-${sale?.id || '—'}`,
    locked_until_paid: amountDue > 0,
    is_due_overdue: isDueOverdue,
    next_installment_due_date: dueDate,
    next_installment_amount: amountDue,
    payment_plan: sale?.payment_plan || {
      type: saleChannel,
      installment_count: schedule.length || 1,
      payment_frequency: 'MONTHLY',
      deposit_paid: amountPaid,
      balance_due: amountDue,
      schedule,
    },
    items: Array.isArray(sale?.items) ? sale.items : [],
  };
};

const Layaway: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ activeCount: 0, overdueCount: 0, lockedCount: 0, outstandingBalance: 0 });
  const [products, setProducts] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedCondition, setSelectedCondition] = useState('NEW');
  const [selectedQuantity, setSelectedQuantity] = useState('1');
  const [draftItems, setDraftItems] = useState<any[]>([]);
  const [paymentDrafts, setPaymentDrafts] = useState<Record<number, { cash: string; transfer: string; pos: string; note: string; due_date: string }>>({});
  const [storeMode, setStoreMode] = useState<string>('SUPERMARKET');
  const [sharePlan, setSharePlan] = useState<any>(null);
  const [sharePhone, setSharePhone] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState({
    sale_channel: 'LAYAWAY',
    customer_id: '',
    customer_name: '',
    customer_phone: '',
    customer_address: '',
    due_date: getDefaultDueDate(),
    installment_count: '3',
    payment_frequency: 'MONTHLY',
    cash: '',
    transfer: '',
    pos: '',
    note: '',
  });

  const canCreatePlans = ['STORE_ADMIN', 'MANAGER', 'STAFF'].includes(String(user?.role || ''));
  const canManagePayments = ['STORE_ADMIN', 'MANAGER', 'STAFF', 'ACCOUNTANT'].includes(String(user?.role || ''));

  const getItemMeta = (item: any) => {
    const linkedProduct = products.find((product) => Number(product.id) === Number(item?.product_id));
    return {
      quickCode: String(item?.quick_code || item?.product_quick_code || linkedProduct?.quick_code || '').trim(),
      shortDescription: flattenSpecsText(item?.specs_at_sale || item?.product_specs || linkedProduct?.specs || ''),
    };
  };

  useEffect(() => {
    void loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [pendingSalesData, productData, customerData, storeData] = await Promise.all([
        appFetch('/api/sales/pending'),
        appFetch('/api/products?limit=500&offset=0'),
        appFetch('/api/customers'),
        appFetch('/api/store/settings'),
      ]);

      const rawPendingSales = Array.isArray(pendingSalesData) ? pendingSalesData : [];
      const nextPlans = rawPendingSales
        .map((entry: any) => formatPlanEntry(entry))
        .filter((entry: any) => ['LAYAWAY', 'INSTALLMENT'].includes(String(entry.sale_channel || '').toUpperCase()));
      const productItems = Array.isArray(productData?.items)
        ? productData.items
        : (Array.isArray(productData) ? productData : []);
      const customerItems = Array.isArray(customerData) ? customerData : [];

      setPlans(nextPlans);
      setSummary({
        activeCount: nextPlans.filter((entry: any) => String(entry.status || '').toUpperCase() === 'PENDING').length,
        overdueCount: nextPlans.filter((entry: any) => Boolean(entry.is_due_overdue)).length,
        lockedCount: nextPlans.filter((entry: any) => Boolean(entry.locked_until_paid)).length,
        outstandingBalance: nextPlans.reduce((sum: number, entry: any) => sum + (Number(entry.amount_due || 0) || 0), 0),
      });
      setProducts(productItems);
      setCustomers(customerItems);
      setStoreMode(String(storeData?.mode || 'SUPERMARKET').toUpperCase());
      setPaymentDrafts((prev) => {
        const next = { ...prev };
        nextPlans.forEach((plan: any) => {
          if (!next[plan.id]) {
            next[plan.id] = defaultPaymentDraft(plan.next_installment_due_date || plan.due_date || '');
          }
        });
        return next;
      });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load installment plans'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const selectedProduct = useMemo(
    () => products.find((product) => Number(product.id) === Number(selectedProductId)),
    [products, selectedProductId]
  );

  const filteredProductOptions = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;

    return products.filter((product) => {
      const name = String(product?.name || '').toLowerCase();
      const quickCode = String(product?.quick_code || '').toLowerCase();
      return name.includes(query) || quickCode.includes(query);
    });
  }, [productSearch, products]);

  const isGadgetMode = storeMode === 'GADGET';

  const getAvailableUnits = (product: any, conditionValue?: string | null) => {
    if (!product) return 0;
    if (isGadgetMode && product?.condition_matrix) {
      const key = normalizeConditionKey(conditionValue || selectedCondition);
      return Number(product.condition_matrix?.[key]?.stock || 0) || 0;
    }
    return Number(product?.stock || 0) || 0;
  };

  const getUnitPrice = (product: any, conditionValue?: string | null) => {
    if (!product) return 0;
    if (isGadgetMode && product?.condition_matrix) {
      const key = normalizeConditionKey(conditionValue || selectedCondition);
      return Number(product.condition_matrix?.[key]?.price || product?.price || 0) || 0;
    }
    return Number(product?.price || 0) || 0;
  };

  const resetForm = () => {
    setForm({
      sale_channel: 'LAYAWAY',
      customer_id: '',
      customer_name: '',
      customer_phone: '',
      customer_address: '',
      due_date: getDefaultDueDate(),
      installment_count: '3',
      payment_frequency: 'MONTHLY',
      cash: '',
      transfer: '',
      pos: '',
      note: '',
    });
    setSelectedProductId('');
    setSelectedCondition('NEW');
    setSelectedQuantity('1');
    setProductSearch('');
    setDraftItems([]);
  };

  const handleCustomerPick = (customerId: string) => {
    const selectedCustomer = customers.find((entry) => Number(entry.id) === Number(customerId));
    setForm((prev) => ({
      ...prev,
      customer_id: customerId,
      customer_name: selectedCustomer?.name || prev.customer_name,
      customer_phone: selectedCustomer?.phone || prev.customer_phone,
      customer_address: selectedCustomer?.address || prev.customer_address,
    }));
  };

  const handleAddDraftItem = () => {
    const product = products.find((item) => Number(item.id) === Number(selectedProductId));
    if (!product) {
      showNotification({ message: 'Select an inventory item first.', type: 'warning' });
      return;
    }

    const quantity = Math.max(1, Number(selectedQuantity) || 1);
    const condition = isGadgetMode && product.condition_matrix ? selectedCondition : null;
    const available = getAvailableUnits(product, condition);
    if (quantity > available) {
      showNotification({ message: `Only ${available} unit(s) are available for ${product.name}.`, type: 'warning' });
      return;
    }

    const unitPrice = getUnitPrice(product, condition);
    setDraftItems((prev) => {
      const existingIndex = prev.findIndex((entry) => Number(entry.product_id) === Number(product.id) && String(entry.condition || '') === String(condition || ''));
      if (existingIndex >= 0) {
        const next = [...prev];
        const nextQty = Number(next[existingIndex].quantity || 0) + quantity;
        if (nextQty > available) {
          showNotification({ message: `You cannot lock more than ${available} unit(s) of ${product.name}.`, type: 'error' });
          return prev;
        }
        next[existingIndex] = {
          ...next[existingIndex],
          quick_code: next[existingIndex].quick_code || product.quick_code || '',
          specs_at_sale: next[existingIndex].specs_at_sale || product.specs || {},
          quantity: nextQty,
          subtotal: Number((nextQty * unitPrice).toFixed(2)),
        };
        return next;
      }

      return [
        ...prev,
        {
          product_id: Number(product.id),
          name: product.name,
          quick_code: product.quick_code || '',
          specs_at_sale: product.specs || {},
          condition,
          quantity,
          price_at_sale: unitPrice,
          subtotal: Number((quantity * unitPrice).toFixed(2)),
        },
      ];
    });

    setSelectedProductId('');
    setSelectedQuantity('1');
    setProductSearch('');
  };

  const removeDraftItem = (index: number) => {
    setDraftItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const depositAmount = useMemo(
    () => (Number(form.cash || 0) || 0) + (Number(form.transfer || 0) || 0) + (Number(form.pos || 0) || 0),
    [form.cash, form.pos, form.transfer]
  );

  const planTotal = useMemo(
    () => draftItems.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0),
    [draftItems]
  );

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!draftItems.length) {
      showNotification({ message: 'Add at least one product to the payment plan.', type: 'warning' });
      return;
    }
    if (!form.customer_id && !form.customer_name.trim()) {
      showNotification({ message: 'Choose a customer or enter the customer name.', type: 'warning' });
      return;
    }
    if (!form.customer_id && !form.customer_phone.trim()) {
      showNotification({ message: 'Add a customer phone number for reminders.', type: 'warning' });
      return;
    }
    if (depositAmount > planTotal) {
      showNotification({ message: 'Deposit cannot be more than the total plan amount.', type: 'error' });
      return;
    }

    setSaving(true);
    try {
      let customerId = Number(form.customer_id) || null;
      if (!customerId) {
        const normalizedPhone = String(form.customer_phone || '').replace(/\D/g, '');
        const existingCustomer = customers.find((entry) => String(entry?.phone || '').replace(/\D/g, '') === normalizedPhone);
        if (existingCustomer?.id) {
          customerId = Number(existingCustomer.id);
        } else {
          const createdCustomer = await appFetch('/api/customers', {
            method: 'POST',
            body: JSON.stringify({
              name: form.customer_name.trim(),
              phone: form.customer_phone,
              address: form.customer_address,
            }),
          });
          customerId = Number(createdCustomer?.id) || null;
        }
      }

      const paymentMethods = {
        cash: Number(form.cash || 0) || 0,
        transfer: Number(form.transfer || 0) || 0,
        pos: Number(form.pos || 0) || 0,
      };
      const payload = {
        sale_channel: form.sale_channel,
        customer_id: customerId,
        customer_name: form.customer_name.trim(),
        customer_phone: form.customer_phone,
        customer_address: form.customer_address.trim(),
        due_date: form.due_date,
        installment_count: Math.max(1, Number(form.installment_count || 1) || 1),
        payment_frequency: form.payment_frequency || 'MONTHLY',
        payment_methods: paymentMethods,
        items: draftItems.map((item) => ({
          product_id: Number(item.product_id),
          quantity: Number(item.quantity) || 1,
          condition: item.condition || null,
        })),
        note: form.note.trim(),
      };

      const result = await appFetch('/api/layaways', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showNotification({
        message: `Payment plan #${result?.id || ''} created successfully.`,
        type: 'success',
        presentation: 'toast',
        duration: 1800,
      });
      resetForm();
      setShowCreateModal(false);
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to create layaway plan'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const updatePaymentDraft = (planId: number, field: 'cash' | 'transfer' | 'pos' | 'note' | 'due_date', value: string) => {
    setPaymentDrafts((prev) => ({
      ...prev,
      [planId]: {
        ...(prev[planId] || defaultPaymentDraft('')),
        [field]: value,
      },
    }));
  };

  const handleRecordPayment = async (plan: any) => {
    const draft = paymentDrafts[plan.id] || defaultPaymentDraft(plan.next_installment_due_date || plan.due_date || '');
    const paymentTotal = (Number(draft.cash || 0) || 0) + (Number(draft.transfer || 0) || 0) + (Number(draft.pos || 0) || 0);

    if (paymentTotal <= 0 && !draft.note.trim() && !draft.due_date.trim()) {
      showNotification({ message: 'Enter a payment amount or update note/due date before saving.', type: 'warning' });
      return;
    }

    setActionId(Number(plan.id));
    try {
      await appFetch(`/api/sales/${plan.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({
          payment_methods: {
            cash: Number(draft.cash || 0) || 0,
            transfer: Number(draft.transfer || 0) || 0,
            pos: Number(draft.pos || 0) || 0,
          },
          note: draft.note,
          due_date: draft.due_date || plan.due_date || null,
        }),
      });

      showNotification({
        message: `${plan.reference_code || `Plan #${plan.id}`} updated successfully.`,
        type: 'success',
        presentation: 'toast',
        duration: 1700,
      });
      setPaymentDrafts((prev) => ({
        ...prev,
        [plan.id]: defaultPaymentDraft(draft.due_date || plan.next_installment_due_date || plan.due_date || ''),
      }));
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save installment payment'), type: 'error' });
    } finally {
      setActionId(null);
    }
  };

  const handleCancelPlan = async (plan: any) => {
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Cancel ${plan.reference_code || `plan #${plan.id}`} and release its locked items back to stock?`);
      if (!confirmed) return;
    }

    setActionId(Number(plan.id));
    try {
      await appFetch(`/api/sales/${plan.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Layaway plan cancelled and items released back to stock.' }),
      });
      showNotification({ message: `${plan.reference_code || `Plan #${plan.id}`} cancelled successfully.`, type: 'success', presentation: 'toast', duration: 1700 });
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to cancel plan'), type: 'error' });
    } finally {
      setActionId(null);
    }
  };

  const openReminderShareModal = (plan: any) => {
    setSharePlan(plan);
    setSharePhone(String(plan?.customer_phone || ''));
  };

  const handleSendReminder = (plan = sharePlan, targetPhone = sharePhone) => {
    if (!plan) return;

    openWhatsAppShare({
      phone: targetPhone,
      title: `Hello ${plan.customer_name || 'customer'}, this is a payment reminder for your ${String(plan.sale_channel || 'LAYAWAY').toLowerCase()} plan ${plan.reference_code || `#${plan.id}`}.`,
      lines: [
        `Plan Total: ${formatCurrency(Number(plan.total || 0) || 0)}`,
        `Amount Paid: ${formatCurrency(Number(plan.amount_paid || 0) || 0)}`,
        `Balance Remaining: ${formatCurrency(Number(plan.amount_due || 0) || 0)}`,
        plan.next_installment_due_date ? `Next Due Date: ${formatDateLabel(plan.next_installment_due_date)}` : '',
        plan.next_installment_amount ? `Suggested Next Payment: ${formatCurrency(Number(plan.next_installment_amount || 0) || 0)}` : '',
        plan.locked_until_paid ? 'Your item remains reserved and locked for you until the full balance is cleared.' : 'Your item is fully paid and ready for release.',
      ],
    });

    setSharePlan(null);
    showNotification({
      message: targetPhone
        ? `WhatsApp reminder opened for ${plan.customer_name}.`
        : 'WhatsApp opened. You can now choose any contact even if the saved number is not on WhatsApp.',
      type: 'success',
      presentation: 'toast',
      duration: 1600,
    });
  };

  const filteredPlans = useMemo(() => {
    const query = search.trim().toLowerCase();

    return plans.filter((plan) => {
      const normalizedStatus = String(plan.status || '').toUpperCase();
      const matchesStatus = statusFilter === 'ALL'
        ? true
        : statusFilter === 'OVERDUE'
          ? Boolean(plan.is_due_overdue)
          : normalizedStatus === statusFilter;

      const itemSearchTokens = Array.isArray(plan.items)
        ? plan.items.flatMap((item: any) => {
            const meta = getItemMeta(item);
            return [item.name, meta.quickCode, meta.shortDescription];
          })
        : [];

      const matchesSearch = !query || [
        plan.reference_code,
        plan.customer_name,
        plan.customer_phone,
        plan.sale_channel,
        ...itemSearchTokens,
      ].some((value) => String(value || '').toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });
  }, [plans, products, search, statusFilter]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" size={30} /></div>;
  }

  const inputCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-colors';

  return (
    <div className="relative isolate space-y-5 overflow-hidden rounded-[30px] border border-slate-200 bg-[linear-gradient(180deg,#f5f8ff_0%,#ffffff_60%,#f8fafc_100%)] p-3 sm:p-4 lg:p-5">
      <div className="pointer-events-none absolute -left-16 top-0 h-48 w-48 rounded-full bg-indigo-200/20 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-sky-200/15 blur-3xl" />

      {/* ── Header ── */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">Payment Plans</p>
          <h1 className="text-2xl font-black text-slate-900">Layaway & Installments</h1>
          <p className="mt-0.5 text-sm text-slate-500">Part-payment plans with due dates, reminders, and item locking.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-900/20 px-3 py-2 text-sm font-bold text-emerald-400">
            <LockKeyhole size={14} /> {summary.lockedCount} locked
          </div>
          {canCreatePlans && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              <PackagePlus size={14} /> New Plan
            </button>
          )}
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
            <Home size={14} /> Home
          </Link>
        </div>
      </header>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { label: 'Active Plans', value: summary.activeCount || 0, sub: 'Customers paying in parts', color: 'text-sky-700', bg: 'bg-sky-50 border-sky-100', icon: <WalletCards size={15} className="text-sky-600" /> },
          { label: 'Outstanding', value: formatCurrency(Number(summary.outstandingBalance || 0)), sub: 'Still expected from customers', color: 'text-amber-800', bg: 'bg-gradient-to-br from-amber-50 via-white to-yellow-50 border-amber-200', icon: <CalendarDays size={15} className="text-amber-700" /> },
          { label: 'Overdue', value: summary.overdueCount || 0, sub: 'Needs follow-up today', color: summary.overdueCount > 0 ? 'text-rose-800' : 'text-slate-700', bg: summary.overdueCount > 0 ? 'bg-gradient-to-br from-rose-50 via-white to-pink-50 border-rose-200' : 'bg-slate-50 border-slate-200', icon: <CalendarDays size={15} className={summary.overdueCount > 0 ? 'text-rose-700' : 'text-slate-500'} /> },
          { label: 'Total Deposits', value: formatCurrency(plans.reduce((s, p) => s + (Number(p.payment_plan?.deposit_paid || 0) || 0), 0)), sub: 'Collected at plan creation', color: 'text-emerald-800', bg: 'bg-gradient-to-br from-emerald-50 via-white to-teal-50 border-emerald-200', icon: <CheckCircle2 size={15} className="text-emerald-700" /> },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-2xl border px-4 py-3 ${stat.bg}`}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{stat.label}</p>
              {stat.icon}
            </div>
            <p className={`text-[2.15rem] font-black leading-none ${stat.color}`}>{stat.value}</p>
            <p className="mt-1 text-[12px] font-semibold text-slate-600">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Plans At a Glance ── */}
      {plans.length > 0 && (() => {
        const now = Date.now();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        const activePlans = plans.filter((p) => String(p.status || '').toUpperCase() !== 'COMPLETED');
        const overdue = activePlans.filter((p) => p.is_due_overdue);
        const dueSoon = activePlans.filter((p) => !p.is_due_overdue && p.next_installment_due_date && new Date(`${p.next_installment_due_date}T23:59:59`).getTime() - now <= oneWeekMs);
        const upcoming = activePlans.filter((p) => !p.is_due_overdue && (!p.next_installment_due_date || new Date(`${p.next_installment_due_date}T23:59:59`).getTime() - now > oneWeekMs));

        const PlanRow = ({ plan, tier }: { plan: any; tier: 'overdue' | 'soon' | 'ok' }) => {
          const total = Number(plan.total || 0);
          const paid = Number(plan.amount_paid || 0);
          const due = Number(plan.amount_due || 0);
          const progressPct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
          const dueDate = plan.next_installment_due_date || plan.due_date;
          const daysLeft = dueDate ? Math.ceil((new Date(`${dueDate}T23:59:59`).getTime() - now) / 86400000) : null;
          const barColor = tier === 'overdue' ? 'bg-rose-900/200' : tier === 'soon' ? 'bg-amber-400' : 'bg-emerald-900/200';
          const trackColor = tier === 'overdue' ? 'bg-rose-100' : tier === 'soon' ? 'bg-amber-100' : 'bg-slate-100';

          return (
            <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-black text-slate-900">{plan.customer_name || 'Customer'}</span>
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-slate-500">{plan.sale_channel}</span>
                  {tier === 'overdue' && <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-rose-600">Overdue</span>}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400 truncate">
                  {Array.isArray(plan.items) && plan.items.length > 0 ? plan.items.map((i: any) => i.name).join(', ') : '—'}
                </p>
                <div className={`mt-1.5 h-1.5 w-full overflow-hidden rounded-full ${trackColor}`}>
                  <div className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${progressPct}%` }} />
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-black text-slate-900">{formatCurrency(due)}</p>
                <p className="text-[10px] text-slate-400">balance</p>
                {daysLeft !== null && (
                  <p className={`mt-0.5 text-[10px] font-bold ${tier === 'overdue' ? 'text-rose-600' : tier === 'soon' ? 'text-amber-600' : 'text-slate-400'}`}>
                    {tier === 'overdue' ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                  </p>
                )}
              </div>
            </div>
          );
        };

        return (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100">
                  <TrendingUp size={15} className="text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">Plans at a Glance</h2>
                  <p className="text-xs text-slate-500">Active plans sorted by urgency.</p>
                </div>
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              {/* Overdue */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={13} className="text-rose-500" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-rose-600">Overdue ({overdue.length})</p>
                </div>
                <div className="space-y-2">
                  {overdue.length === 0
                    ? <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs text-slate-400">None overdue 🎉</p>
                    : overdue.map((p) => <PlanRow key={p.id} plan={p} tier="overdue" />)
                  }
                </div>
              </div>

              {/* Due this week */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <Clock size={13} className="text-amber-500" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-amber-600">Due This Week ({dueSoon.length})</p>
                </div>
                <div className="space-y-2">
                  {dueSoon.length === 0
                    ? <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs text-slate-400">Nothing due this week</p>
                    : dueSoon.map((p) => <PlanRow key={p.id} plan={p} tier="soon" />)
                  }
                </div>
              </div>

              {/* Upcoming */}
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-500" />
                  <p className="text-[11px] font-black uppercase tracking-widest text-emerald-600">Upcoming ({upcoming.length})</p>
                </div>
                <div className="space-y-2">
                  {upcoming.length === 0
                    ? <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs text-slate-400">No upcoming plans</p>
                    : upcoming.map((p) => <PlanRow key={p.id} plan={p} tier="ok" />)
                  }
                </div>
              </div>
            </div>
          </section>
        );
      })()}

      {/* ── Create Plan Modal ── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-3">
          <div className="relative my-4 w-[calc(100%-1.5rem)] max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100">
                  <PackagePlus size={13} className="text-indigo-500" />
                </div>
                <div>
                  <h2 className="text-sm font-black text-slate-900">Create a payment plan</h2>
                  <p className="text-[11px] text-slate-500">Stock is locked immediately on creation.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-3 space-y-2">
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <LockKeyhole size={13} className="mt-0.5 shrink-0 text-amber-600" />
                <span>Creating a plan immediately reduces available stock so the item stays <strong>locked</strong> for that customer until the balance is paid or the plan is cancelled.</span>
              </div>

              <form onSubmit={handleCreatePlan} className="space-y-2">

                {/* Customer section */}
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Customer</p>
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    <select value={form.customer_id} onChange={(e) => handleCustomerPick(e.target.value)} className={inputCls}>
                      <option value="">Choose existing customer</option>
                      {customers.map((c) => <option key={c.id} value={c.id}>{c.name} • {c.phone}</option>)}
                    </select>
                    <input value={form.customer_name} onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))} placeholder="Customer name *" className={inputCls} />
                    <input value={form.customer_phone} onChange={(e) => setForm((prev) => ({ ...prev, customer_phone: e.target.value }))} placeholder="Phone number *" className={inputCls} />
                  </div>
                  <input value={form.customer_address} onChange={(e) => setForm((prev) => ({ ...prev, customer_address: e.target.value }))} placeholder="Address (optional)" className={`${inputCls} mt-1.5`} />
                </div>

                {/* Plan settings */}
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Plan Settings</p>
                  <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                    <select value={form.sale_channel} onChange={(e) => setForm((prev) => ({ ...prev, sale_channel: e.target.value }))} className={inputCls}>
                      {PLAN_TYPES.map((type) => <option key={type} value={type}>{type === 'LAYAWAY' ? 'Layaway' : 'Installment'}</option>)}
                    </select>
                    <input type="date" value={form.due_date} onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))} className={inputCls} />
                    <input type="number" min="1" max="24" value={form.installment_count} onChange={(e) => setForm((prev) => ({ ...prev, installment_count: e.target.value }))} placeholder="Installments (e.g. 3)" className={inputCls} />
                    <select value={form.payment_frequency} onChange={(e) => setForm((prev) => ({ ...prev, payment_frequency: e.target.value }))} className={inputCls}>
                      {PAYMENT_FREQUENCIES.map((f) => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div className="mt-1.5">
                    <textarea value={form.note} onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))} rows={1} placeholder="Plan note — agreed timeline, pickup details, etc." className={inputCls} />
                  </div>
                </div>

                {/* Initial deposit */}
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Initial Deposit (optional)</p>
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    <input type="number" min="0" step="0.01" value={form.cash} onChange={(e) => setForm((prev) => ({ ...prev, cash: e.target.value }))} placeholder="Cash" className={inputCls} />
                    <input type="number" min="0" step="0.01" value={form.transfer} onChange={(e) => setForm((prev) => ({ ...prev, transfer: e.target.value }))} placeholder="Transfer" className={inputCls} />
                    <input type="number" min="0" step="0.01" value={form.pos} onChange={(e) => setForm((prev) => ({ ...prev, pos: e.target.value }))} placeholder="POS terminal" className={inputCls} />
                  </div>
                </div>

                {/* Items */}
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-400">Items to Lock</p>
                  <input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Search by name or quick code…" className={`${inputCls} mb-2`} />
                  {/* product selector — full width */}
                  <select value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} className={`${inputCls} mb-2`}>
                    <option value="">Select product to lock</option>
                    {filteredProductOptions.map((product) => {
                      const condKey = normalizeConditionKey(selectedCondition);
                      const condStock = isGadgetMode && product.condition_matrix
                        ? Number((product.condition_matrix as Record<string, any>)?.[condKey]?.stock || 0) || 0
                        : null;
                      const totalStock = isGadgetMode && product.condition_matrix
                        ? Object.values(product.condition_matrix as Record<string, any>).reduce((sum: number, slot: any) => sum + (Number(slot?.stock || 0) || 0), 0)
                        : Number(product.stock || 0);
                      const displayStock = condStock !== null ? condStock : totalStock;
                      return (
                        <option key={product.id} value={product.id}>
                          {product.name}{product.quick_code ? ` • QC ${product.quick_code}` : ''} — {displayStock} avail.
                        </option>
                      );
                    })}
                  </select>
                  {/* condition / qty / add row */}
                  <div className={`grid gap-2 ${isGadgetMode ? 'grid-cols-[1fr_1fr_auto]' : 'grid-cols-[1fr_auto]'}`}>
                    {isGadgetMode && selectedProduct?.condition_matrix ? (
                      <select value={selectedCondition} onChange={(e) => setSelectedCondition(e.target.value)} className={inputCls}>
                        {getConditionOptions(selectedProduct).map((o) => {
                          const condKey = normalizeConditionKey(o.value);
                          const condStock = Number((selectedProduct.condition_matrix as Record<string, any>)?.[condKey]?.stock || 0) || 0;
                          return <option key={o.value} value={o.value}>{o.label} — {condStock} avail.</option>;
                        })}
                      </select>
                    ) : isGadgetMode ? (
                      <div className="flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">Standard stock</div>
                    ) : null}
                    <input type="number" min="1" value={selectedQuantity} onChange={(e) => setSelectedQuantity(e.target.value)} className={inputCls} />
                    <button type="button" onClick={handleAddDraftItem} className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors">
                      <Plus size={14} /> Add
                    </button>
                  </div>
                  {draftItems.length > 0 && (
                    <div className="mt-1.5 space-y-1.5">
                      {draftItems.map((item, index) => {
                        const meta = getItemMeta(item);
                        return (
                          <div key={`${item.product_id}-${item.condition || 'standard'}-${index}`} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="text-sm font-bold text-slate-900">{item.name}</p>
                                {meta.quickCode && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-black text-sky-700">QC {meta.quickCode}</span>}
                              </div>
                              <p className="text-xs text-slate-500">{formatConditionLabel(item.condition)} · Qty {item.quantity} · {formatCurrency(Number(item.price_at_sale || 0))} each</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-sm font-black text-slate-900">{formatCurrency(Number(item.subtotal || 0))}</span>
                              <button type="button" onClick={() => removeDraftItem(index)} className="rounded border border-rose-200 bg-rose-50 p-1 text-rose-600 hover:bg-rose-100 transition-colors"><Trash2 size={11} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Summary bar */}
                <div className="grid gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm sm:grid-cols-3">
                  <div className="text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Plan Total</p>
                    <p className="mt-0.5 text-base font-black text-indigo-900">{formatCurrency(planTotal)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Deposit Today</p>
                    <p className="mt-0.5 text-base font-black text-indigo-900">{formatCurrency(depositAmount)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Balance Due</p>
                    <p className="mt-0.5 text-base font-black text-indigo-900">{formatCurrency(Math.max(0, planTotal - depositAmount))}</p>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setShowCreateModal(false); resetForm(); }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <PackagePlus size={14} />}
                    {saving ? 'Saving plan…' : 'Create payment plan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Plans List ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">Open & Completed Plans</h2>
            <p className="text-xs text-slate-500">Track payments, due dates, and send reminders.</p>
          </div>
          <div className="flex gap-2">
            <label className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 sm:flex-none">
              <Search size={14} className="shrink-0 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer, code, product…" className="w-full bg-transparent text-sm outline-none sm:w-52" />
            </label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number])}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {STATUS_FILTERS.map((f) => <option key={f} value={f}>{f === 'ALL' ? 'All plans' : f}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {filteredPlans.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
              <WalletCards size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">No plans match the current filter.</p>
            </div>
          ) : filteredPlans.map((plan) => {
            const draft = paymentDrafts[plan.id] || defaultPaymentDraft(plan.next_installment_due_date || plan.due_date || '');
            const isSaving = actionId === Number(plan.id);
            const isCompleted = String(plan.status || '').toUpperCase() === 'COMPLETED';

            return (
              <div key={plan.id} className={`rounded-2xl border ${plan.is_due_overdue ? 'border-rose-200 bg-rose-900/20/30' : 'border-slate-200 bg-slate-50/50'} p-4`}>
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start">

                  {/* Left: plan info */}
                  <div className="flex-1 space-y-3">
                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-[10px] font-black tracking-widest text-white">{plan.reference_code || `PLAN-${plan.id}`}</span>
                      <span className={`rounded-lg px-2.5 py-1 text-[10px] font-black tracking-widest ${plan.sale_channel === 'INSTALLMENT' ? 'bg-blue-100 text-blue-400' : 'bg-violet-100 text-violet-700'}`}>
                        {String(plan.sale_channel || 'LAYAWAY')}
                      </span>
                      <span className={`rounded-lg px-2.5 py-1 text-[10px] font-black tracking-widest ${plan.locked_until_paid ? 'bg-amber-100 text-amber-400' : 'bg-emerald-100 text-emerald-400'}`}>
                        {plan.locked_until_paid ? '🔒 LOCKED' : '✓ RELEASED'}
                      </span>
                      {isCompleted && <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-[10px] font-black tracking-widest text-emerald-400">COMPLETED</span>}
                      {plan.is_due_overdue && <span className="rounded-lg bg-rose-100 px-2.5 py-1 text-[10px] font-black tracking-widest text-rose-400">OVERDUE</span>}
                    </div>

                    {/* Customer */}
                    <div>
                      <h3 className="text-base font-black text-slate-900">{plan.customer_name || 'Customer'}</h3>
                      <p className="text-xs text-slate-500">{plan.customer_phone || 'No phone'} · Due {formatDateLabel(plan.next_installment_due_date || plan.due_date)}</p>
                    </div>

                    {/* Items */}
                    <div className="space-y-1.5">
                      {(Array.isArray(plan.items) ? plan.items : []).map((item: any, index: number) => {
                        const meta = getItemMeta(item);
                        return (
                          <div key={`${plan.id}-${item.product_id}-${index}`} className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2">
                            <p className="font-bold text-slate-900 text-sm">{item.name}</p>
                            {meta.quickCode && <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-black text-sky-700">QC {meta.quickCode}</span>}
                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">×{item.quantity}</span>
                            {item.condition && <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-700">{formatConditionLabel(item.condition)}</span>}
                            {meta.shortDescription && <span className="text-[11px] text-slate-400">{meta.shortDescription}</span>}
                          </div>
                        );
                      })}
                    </div>

                    {/* Schedule */}
                    {Array.isArray(plan.payment_plan?.schedule) && plan.payment_plan.schedule.length > 0 && (
                      <div className="rounded-xl border border-slate-200 bg-white p-3">
                        <p className="mb-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Schedule</p>
                        <div className="space-y-1">
                          {plan.payment_plan.schedule.map((entry: any) => (
                            <div key={`${plan.id}-s-${entry.installment_number}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-300">
                              <span>Installment {entry.installment_number}</span>
                              <span className="font-bold">{formatDateLabel(entry.due_date)} · {formatCurrency(Number(entry.amount || 0))}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: amounts + actions */}
                  <div className="w-full shrink-0 rounded-2xl border border-slate-200 bg-white p-4 xl:w-80">
                    <div className="mb-3 grid grid-cols-2 gap-2">
                      {[
                        { label: 'Plan Total', value: formatCurrency(Number(plan.total || 0)), color: 'text-slate-900' },
                        { label: 'Paid', value: formatCurrency(Number(plan.amount_paid || 0)), color: 'text-emerald-400' },
                        { label: 'Balance', value: formatCurrency(Number(plan.amount_due || 0)), color: 'text-amber-400' },
                        { label: 'Next Due', value: formatCurrency(Number(plan.next_installment_amount || 0)), color: 'text-slate-900' },
                      ].map((row) => (
                        <div key={row.label} className="rounded-xl bg-slate-50 px-3 py-2.5">
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{row.label}</p>
                          <p className={`mt-0.5 text-sm font-black ${row.color}`}>{row.value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => openReminderShareModal(plan)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-900/20 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-100 transition-colors"
                      >
                        <MessageCircle size={13} /> Remind
                      </button>
                      {canManagePayments && !isCompleted && (
                        <button type="button" onClick={() => handleCancelPlan(plan)} disabled={isSaving}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-900/20 px-3 py-2 text-xs font-bold text-rose-400 hover:bg-rose-100 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 size={13} /> Cancel
                        </button>
                      )}
                    </div>

                    {canManagePayments && !isCompleted && (
                      <div className="space-y-2.5 border-t border-slate-100 pt-3">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Record Payment</p>
                        <div className="grid grid-cols-2 gap-2">
                          <input type="number" min="0" step="0.01" value={draft.cash} onChange={(e) => updatePaymentDraft(plan.id, 'cash', e.target.value)} placeholder="Cash" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                          <input type="number" min="0" step="0.01" value={draft.transfer} onChange={(e) => updatePaymentDraft(plan.id, 'transfer', e.target.value)} placeholder="Transfer" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                          <input type="number" min="0" step="0.01" value={draft.pos} onChange={(e) => updatePaymentDraft(plan.id, 'pos', e.target.value)} placeholder="POS" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                          <input type="date" value={draft.due_date} onChange={(e) => updatePaymentDraft(plan.id, 'due_date', e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300" />
                        </div>
                        <textarea value={draft.note} onChange={(e) => updatePaymentDraft(plan.id, 'note', e.target.value)} rows={2}
                          placeholder="Payment note / update"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
                        />
                        <button type="button" onClick={() => handleRecordPayment(plan)} disabled={isSaving}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                        >
                          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <WalletCards size={14} />}
                          {isSaving ? 'Saving…' : 'Record payment'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <WhatsAppShareModal
        isOpen={Boolean(sharePlan)}
        phone={sharePhone}
        recipientName={sharePlan?.customer_name || 'customer'}
        title="Send Installment Reminder"
        description={`Send this reminder to ${sharePlan?.customer_name || 'the customer'} or any other WhatsApp number.`}
        infoText="If the saved phone number is not on WhatsApp, clear the field and choose any contact directly inside WhatsApp."
        onPhoneChange={setSharePhone}
        onClose={() => setSharePlan(null)}
        onShare={() => handleSendReminder(sharePlan, sharePhone)}
      />
    </div>
  );
};

export default Layaway;

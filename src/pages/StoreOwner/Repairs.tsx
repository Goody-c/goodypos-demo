import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
  Plus,
  Search,
  ShieldCheck,
  Smartphone,
  Wrench,
  X,
} from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';
import { formatCurrency, openWhatsAppShare } from '../../lib/utils';

const STATUS_OPTIONS = ['ALL', 'RECEIVED', 'DIAGNOSING', 'AWAITING_PARTS', 'IN_REPAIR', 'READY', 'DELIVERED', 'CANCELLED'] as const;
const WARRANTY_OPTIONS = ['IN_WARRANTY', 'OUT_OF_WARRANTY', 'NO_WARRANTY'] as const;

const getDefaultPromisedDate = () => {
  const nextThreeDays = new Date();
  nextThreeDays.setDate(nextThreeDays.getDate() + 3);
  return nextThreeDays.toISOString().split('T')[0];
};

const formatDateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
};

const getStatusClasses = (status?: string | null, isOverdue?: boolean) => {
  if (isOverdue) return 'border-rose-200 bg-rose-900/20 text-rose-400';

  const normalized = String(status || 'RECEIVED').toUpperCase();
  if (normalized === 'READY') return 'border-emerald-200 bg-emerald-900/20 text-emerald-400';
  if (normalized === 'DELIVERED') return 'border-blue-200 bg-blue-900/20 text-blue-400';
  if (normalized === 'CANCELLED') return 'border-slate-200 bg-slate-100 text-slate-300';
  if (normalized === 'AWAITING_PARTS') return 'border-amber-200 bg-amber-900/20 text-amber-400';
  return 'border-purple-200 bg-purple-900/20 text-purple-700';
};

const getWarrantyClasses = (status?: string | null) => {
  const normalized = String(status || 'NO_WARRANTY').toUpperCase();
  if (normalized === 'IN_WARRANTY') return 'border-emerald-200 bg-emerald-900/20 text-emerald-400';
  if (normalized === 'OUT_OF_WARRANTY') return 'border-amber-200 bg-amber-900/20 text-amber-400';
  return 'border-slate-200 bg-slate-100 text-slate-300';
};

const Repairs: React.FC = () => {
  const { user } = useAuth();
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>('ALL');
  const [shareTicket, setShareTicket] = useState<any>(null);
  const [sharePhone, setSharePhone] = useState('');
  const [updateDrafts, setUpdateDrafts] = useState<Record<number, any>>({});
  const [form, setForm] = useState({
    customer_name: '',
    customer_phone: '',
    device_name: '',
    brand: '',
    model: '',
    imei_serial: '',
    issue_summary: '',
    accessories: '',
    purchase_reference: '',
    warranty_status: 'NO_WARRANTY',
    technician_name: '',
    promised_date: getDefaultPromisedDate(),
    estimated_cost: '',
    intake_notes: '',
  });

  const canManageRepairs = user?.role === 'STORE_ADMIN' || user?.role === 'MANAGER' || user?.role === 'STAFF';

  useEffect(() => {
    void loadRepairs();
  }, []);

  useEffect(() => {
    setUpdateDrafts((previous) => {
      const next = { ...previous };
      tickets.forEach((ticket) => {
        if (!next[ticket.id]) {
          next[ticket.id] = {
            status: ticket.status || 'RECEIVED',
            technician_name: ticket.technician_name || '',
            final_cost: String(ticket.final_cost || ticket.estimated_cost || ''),
            amount_paid: String(ticket.amount_paid || ''),
            internal_notes: ticket.internal_notes || '',
          };
        }
      });
      return next;
    });
  }, [tickets]);

  const loadRepairs = async () => {
    try {
      const result = await appFetch('/api/repairs');
      setTickets(Array.isArray(result) ? result : []);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load repair tickets'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm({
      customer_name: '',
      customer_phone: '',
      device_name: '',
      brand: '',
      model: '',
      imei_serial: '',
      issue_summary: '',
      accessories: '',
      purchase_reference: '',
      warranty_status: 'NO_WARRANTY',
      technician_name: '',
      promised_date: getDefaultPromisedDate(),
      estimated_cost: '',
      intake_notes: '',
    });
  };

  const summary = useMemo(() => {
    const openCount = tickets.filter((ticket) => !['DELIVERED', 'CANCELLED'].includes(String(ticket.status || '').toUpperCase())).length;
    const readyCount = tickets.filter((ticket) => String(ticket.status || '').toUpperCase() === 'READY').length;
    const overdueCount = tickets.filter((ticket) => Boolean(ticket.is_overdue)).length;
    const outstandingBalance = tickets.reduce((sum, ticket) => sum + (Number(ticket.amount_due || 0) || 0), 0);

    return {
      openCount,
      readyCount,
      overdueCount,
      outstandingBalance,
    };
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const normalizedStatus = String(ticket.status || '').toUpperCase();
      const matchesStatus = statusFilter === 'ALL' ? true : normalizedStatus === statusFilter;
      const matchesSearch = !query || [
        ticket.ticket_number,
        ticket.customer_name,
        ticket.customer_phone,
        ticket.device_name,
        ticket.brand,
        ticket.model,
        ticket.imei_serial,
        ticket.issue_summary,
      ].some((value) => String(value || '').toLowerCase().includes(query));

      return matchesStatus && matchesSearch;
    });
  }, [search, statusFilter, tickets]);

  const updateDraftField = (ticketId: number, field: string, value: string) => {
    setUpdateDrafts((previous) => ({
      ...previous,
      [ticketId]: {
        ...previous[ticketId],
        [field]: value,
      },
    }));
  };

  const handleCreateRepair = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.customer_name.trim()) {
      showNotification({ message: 'Customer name is required.', type: 'warning' });
      return;
    }
    if (!form.device_name.trim()) {
      showNotification({ message: 'Device name is required.', type: 'warning' });
      return;
    }
    if (!form.issue_summary.trim()) {
      showNotification({ message: 'Describe the reported issue before saving.', type: 'warning' });
      return;
    }

    setSavingNew(true);
    try {
      const result = await appFetch('/api/repairs', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          estimated_cost: Number(form.estimated_cost || 0) || 0,
        }),
      });

      showNotification({
        message: `Repair ticket ${result?.ticket?.ticket_number || ''} created successfully.`,
        type: 'success',
        presentation: 'toast',
        duration: 1800,
      });
      resetForm();
      setShowCreateModal(false);
      await loadRepairs();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to create repair ticket'), type: 'error' });
    } finally {
      setSavingNew(false);
    }
  };

  const handleSaveUpdate = async (ticket: any, overrideStatus?: string) => {
    const draft = updateDrafts[ticket.id] || {};
    setActionId(Number(ticket.id));

    try {
      await appFetch(`/api/repairs/${ticket.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: overrideStatus || draft.status || ticket.status,
          technician_name: draft.technician_name ?? ticket.technician_name,
          final_cost: Number(draft.final_cost || 0) || 0,
          amount_paid: Number(draft.amount_paid || 0) || 0,
          internal_notes: draft.internal_notes ?? ticket.internal_notes,
        }),
      });

      showNotification({
        message: `${ticket.ticket_number} updated successfully.`,
        type: 'success',
        presentation: 'toast',
        duration: 1700,
      });
      await loadRepairs();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to update repair ticket'), type: 'error' });
    } finally {
      setActionId(null);
    }
  };

  const openWhatsAppModal = (ticket: any) => {
    setShareTicket(ticket);
    setSharePhone(String(ticket?.customer_phone || ''));
  };

  const handleSendWhatsApp = (ticket = shareTicket, targetPhone = sharePhone) => {
    if (!ticket) return;

    openWhatsAppShare({
      phone: targetPhone,
      title: `Hello ${ticket.customer_name}, here is the latest update on your repair ticket ${ticket.ticket_number}.`,
      lines: [
        `Device: ${ticket.device_name}`,
        `Status: ${String(ticket.status_label || ticket.status || 'RECEIVED').replace(/_/g, ' ')}`,
        `Technician: ${ticket.technician_name || 'Assigned soon'}`,
        `Outstanding balance: ${formatCurrency(Number(ticket.amount_due || 0) || 0)}`,
        ticket.status === 'READY' ? 'Your device is ready for pickup.' : 'We will keep you updated as work progresses.',
      ],
    });

    setShareTicket(null);
    showNotification({
      message: targetPhone
        ? `WhatsApp update opened for ${ticket.customer_name}.`
        : 'WhatsApp opened. You can choose any contact even if the saved repair phone is not on WhatsApp.',
      type: 'success',
      presentation: 'toast',
      duration: 1600,
    });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-indigo-900/20 p-3 text-indigo-600">
                <Wrench size={22} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-slate-900">Warranty & Repair Tracker</h1>
                <p className="text-sm text-slate-500">Track device intake, repair progress, warranty status, pickup readiness, and balances.</p>
              </div>
            </div>
          </div>

          {canManageRepairs && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700"
            >
              <Plus size={15} /> New Intake
            </button>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              {
                label: 'Open Jobs',
                value: String(summary.openCount),
                cardClass: 'border-slate-200 bg-slate-50',
                labelClass: 'text-slate-500',
                valueClass: 'text-slate-900',
              },
              {
                label: 'Ready',
                value: String(summary.readyCount),
                cardClass: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-teal-50',
                labelClass: 'text-emerald-700',
                valueClass: 'text-emerald-800',
              },
              {
                label: 'Overdue',
                value: String(summary.overdueCount),
                cardClass: 'border-rose-200 bg-gradient-to-br from-rose-50 via-white to-pink-50',
                labelClass: 'text-rose-700',
                valueClass: 'text-rose-800',
              },
              {
                label: 'Outstanding',
                value: formatCurrency(summary.outstandingBalance),
                cardClass: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-yellow-50',
                labelClass: 'text-amber-700',
                valueClass: 'text-amber-800',
              },
            ].map((item) => (
              <div key={item.label} className={`rounded-2xl border px-4 py-3 ${item.cardClass}`}>
                <p className={`text-[11px] font-black uppercase tracking-widest ${item.labelClass}`}>{item.label}</p>
                <p className={`mt-1 text-[2.15rem] font-black leading-none ${item.valueClass}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4">
          <div className="relative my-6 w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100">
                  <Wrench size={15} className="text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900">New repair intake</h2>
                  <p className="text-xs text-slate-500">Fill in device and customer details to open a ticket.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowCreateModal(false); resetForm(); }}
                className="rounded-xl border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6">
              <form onSubmit={handleCreateRepair} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <input value={form.customer_name} onChange={(e) => setForm((prev) => ({ ...prev, customer_name: e.target.value }))} placeholder="Customer name" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={form.customer_phone} onChange={(e) => setForm((prev) => ({ ...prev, customer_phone: e.target.value }))} placeholder="Phone number" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={form.device_name} onChange={(e) => setForm((prev) => ({ ...prev, device_name: e.target.value }))} placeholder="Device name" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={form.imei_serial} onChange={(e) => setForm((prev) => ({ ...prev, imei_serial: e.target.value }))} placeholder="IMEI / Serial" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={form.brand} onChange={(e) => setForm((prev) => ({ ...prev, brand: e.target.value }))} placeholder="Brand" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={form.model} onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))} placeholder="Model" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={form.purchase_reference} onChange={(e) => setForm((prev) => ({ ...prev, purchase_reference: e.target.value }))} placeholder="Purchase ref / invoice no." className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input value={form.accessories} onChange={(e) => setForm((prev) => ({ ...prev, accessories: e.target.value }))} placeholder="Accessories dropped" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <select value={form.warranty_status} onChange={(e) => setForm((prev) => ({ ...prev, warranty_status: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400">
                    {WARRANTY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                  <input value={form.technician_name} onChange={(e) => setForm((prev) => ({ ...prev, technician_name: e.target.value }))} placeholder="Technician name" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input type="date" value={form.promised_date} onChange={(e) => setForm((prev) => ({ ...prev, promised_date: e.target.value }))} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                  <input type="number" min="0" step="0.01" value={form.estimated_cost} onChange={(e) => setForm((prev) => ({ ...prev, estimated_cost: e.target.value }))} placeholder="Estimated repair cost" className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>

                <textarea value={form.issue_summary} onChange={(e) => setForm((prev) => ({ ...prev, issue_summary: e.target.value }))} placeholder="Reported fault / issue summary" rows={3} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                <textarea value={form.intake_notes} onChange={(e) => setForm((prev) => ({ ...prev, intake_notes: e.target.value }))} placeholder="Intake notes (screen condition, battery issue, missing parts, etc.)" rows={3} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />

                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => { setShowCreateModal(false); resetForm(); }} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={savingNew} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {savingNew ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                    {savingNew ? 'Saving intake...' : 'Create repair ticket'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Repair jobs</h2>
            <p className="text-sm text-slate-500">Monitor every intake from diagnosis to pickup.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <Search size={16} className="text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ticket, customer, device, IMEI" className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400 sm:w-64" />
            </label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400">
              {STATUS_OPTIONS.map((option) => (
                <option key={option} value={option}>{option === 'ALL' ? 'All statuses' : option.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {filteredTickets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No repair tickets match your current filter.
            </div>
          ) : filteredTickets.map((ticket) => {
            const draft = updateDrafts[ticket.id] || {};
            const isSaving = actionId === Number(ticket.id);

            return (
              <div key={ticket.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-black tracking-widest text-white">{ticket.ticket_number}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black tracking-widest ${getStatusClasses(ticket.status, ticket.is_overdue)}`}>
                        {String(ticket.status_label || ticket.status).replace(/_/g, ' ')}
                      </span>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black tracking-widest ${getWarrantyClasses(ticket.warranty_status)}`}>
                        {String(ticket.warranty_status || 'NO_WARRANTY').replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-lg font-black text-slate-900">{ticket.customer_name}</h3>
                      <p className="text-sm text-slate-500">{ticket.device_name}{ticket.brand || ticket.model ? ` • ${[ticket.brand, ticket.model].filter(Boolean).join(' ')}` : ''}</p>
                    </div>

                    <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
                      <p className="inline-flex items-center gap-2"><Smartphone size={14} className="text-slate-400" /> IMEI/Serial: <span className="font-semibold text-slate-900">{ticket.imei_serial || '—'}</span></p>
                      <p className="inline-flex items-center gap-2"><Clock3 size={14} className="text-slate-400" /> Promised: <span className="font-semibold text-slate-900">{formatDateLabel(ticket.promised_date)}</span></p>
                      <p>Phone: <span className="font-semibold text-slate-900">{ticket.customer_phone || '—'}</span></p>
                      <p>Technician: <span className="font-semibold text-slate-900">{ticket.technician_name || 'Unassigned'}</span></p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-300">
                      <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Reported issue</p>
                      <p className="mt-1">{ticket.issue_summary}</p>
                      {ticket.intake_notes ? <p className="mt-2 text-xs text-slate-500">Intake note: {ticket.intake_notes}</p> : null}
                      {ticket.accessories ? <p className="mt-1 text-xs text-slate-500">Accessories: {ticket.accessories}</p> : null}
                    </div>
                  </div>

                  <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 xl:max-w-md">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Estimate</p>
                        <p className="mt-1 font-black text-slate-900">{formatCurrency(Number(ticket.estimated_cost || 0) || 0)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Due</p>
                        <p className="mt-1 font-black text-amber-400">{formatCurrency(Number(ticket.amount_due || 0) || 0)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Final Cost</p>
                        <p className="mt-1 font-black text-slate-900">{formatCurrency(Number(ticket.final_cost || 0) || 0)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Paid</p>
                        <p className="mt-1 font-black text-emerald-400">{formatCurrency(Number(ticket.amount_paid || 0) || 0)}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => openWhatsAppModal(ticket)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-900/20 px-3 py-2 text-xs font-bold text-emerald-400 hover:bg-emerald-100">
                        <MessageCircle size={14} /> WhatsApp update
                      </button>
                      {canManageRepairs && ticket.status !== 'READY' && ticket.status !== 'DELIVERED' && ticket.status !== 'CANCELLED' && (
                        <button type="button" onClick={() => handleSaveUpdate(ticket, 'READY')} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-900/20 px-3 py-2 text-xs font-bold text-blue-400 hover:bg-blue-100">
                          <CheckCircle2 size={14} /> Mark ready
                        </button>
                      )}
                      {canManageRepairs && ticket.status !== 'DELIVERED' && ticket.status !== 'CANCELLED' && (
                        <button type="button" onClick={() => handleSaveUpdate(ticket, 'DELIVERED')} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-300 hover:bg-slate-200">
                          <ShieldCheck size={14} /> Mark delivered
                        </button>
                      )}
                    </div>

                    {canManageRepairs && (
                      <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <select value={draft.status ?? ticket.status} onChange={(e) => updateDraftField(ticket.id, 'status', e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400">
                            {STATUS_OPTIONS.filter((option) => option !== 'ALL').map((option) => (
                              <option key={option} value={option}>{option.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                          <input value={draft.technician_name ?? ticket.technician_name ?? ''} onChange={(e) => updateDraftField(ticket.id, 'technician_name', e.target.value)} placeholder="Technician name" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                          <input type="number" min="0" step="0.01" value={draft.final_cost ?? ''} onChange={(e) => updateDraftField(ticket.id, 'final_cost', e.target.value)} placeholder="Final repair cost" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                          <input type="number" min="0" step="0.01" value={draft.amount_paid ?? ''} onChange={(e) => updateDraftField(ticket.id, 'amount_paid', e.target.value)} placeholder="Amount paid" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                        </div>
                        <textarea value={draft.internal_notes ?? ''} onChange={(e) => updateDraftField(ticket.id, 'internal_notes', e.target.value)} placeholder="Internal update notes" rows={2} className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-400" />
                        <button type="button" onClick={() => handleSaveUpdate(ticket)} disabled={isSaving} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Wrench size={16} />}
                          {isSaving ? 'Saving update...' : 'Save update'}
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
        isOpen={Boolean(shareTicket)}
        phone={sharePhone}
        recipientName={shareTicket?.customer_name || 'customer'}
        title="Send Repair Update"
        description={`Send this repair update to ${shareTicket?.customer_name || 'the customer'} or any other WhatsApp number.`}
        infoText="If the saved phone number is not on WhatsApp, clear the field and choose any contact directly inside WhatsApp."
        onPhoneChange={setSharePhone}
        onClose={() => setShareTicket(null)}
        onShare={() => handleSendWhatsApp(shareTicket, sharePhone)}
      />
    </div>
  );
};

export default Repairs;

import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import {
  ArrowRightLeft,
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  Loader2,
  MessageCircle,
  User,
  WalletCards,
  X,
} from 'lucide-react';
import { formatCurrency, openWhatsAppShare } from '../../lib/utils';
import { useNotification } from '../../context/NotificationContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';

const TransferVault: React.FC = () => {
  const { showNotification } = useNotification();
  const [pendingSales, setPendingSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [savingSettlement, setSavingSettlement] = useState(false);
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [confirmSale, setConfirmSale] = useState<any>(null);
  const [shareReminderSale, setShareReminderSale] = useState<any>(null);
  const [shareReminderPhone, setShareReminderPhone] = useState('');
  const [settlementForm, setSettlementForm] = useState({ cash: '', transfer: '', pos: '', note: '' });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    void loadPendingSales();
  }, []);

  const DEMO_PENDING_SALES = [
    {
      id: 118, sale_channel: 'LAYAWAY', status: 'PENDING', customer_name: 'Michael Thompson', customer_phone: '(312) 555-0183',
      timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      total: 1299, amount_paid: 300, amount_due: 999,
      payment_methods: { cash: 300 }, note: 'Layaway — $300 down, $999 balance over 3 months',
    },
    {
      id: 119, sale_channel: 'INSTALLMENT', status: 'PENDING', customer_name: 'Sophie Müller', customer_phone: '+49 170 555 0202',
      timestamp: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      total: 2400, amount_paid: 800, amount_due: 1600,
      payment_methods: { transfer: 800 }, note: 'Installment plan — MacBook Air M2, 3 monthly payments',
    },
    {
      id: 120, sale_channel: 'LAYAWAY', status: 'PENDING', customer_name: 'James Carter', customer_phone: '(310) 555-0195',
      timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      total: 780, amount_paid: 200, amount_due: 580,
      payment_methods: { cash: 200 }, note: 'Layaway — Samsung Galaxy S24 Ultra, biweekly payments',
    },
    {
      id: 121, sale_channel: 'INSTALLMENT', status: 'PENDING', customer_name: 'Isabella Rossi', customer_phone: '+39 333 100 0006',
      timestamp: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() + 12 * 24 * 60 * 60 * 1000).toISOString(),
      total: 1850, amount_paid: 650, amount_due: 1200,
      payment_methods: { pos: 650 }, note: 'Installment — iPad Pro + Apple Pencil, 4 monthly payments',
    },
    {
      id: 122, sale_channel: 'PAY_LATER', status: 'PENDING', customer_name: 'Oliver Bennett', customer_phone: '+44 7700 900183',
      timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      total: 450, amount_paid: 0, amount_due: 450,
      payment_methods: {}, note: 'Pay later — balance due on delivery confirmation',
    },
  ];

  const loadPendingSales = async () => {
    try {
      await appFetch('/api/sales/pending');
      setPendingSales(DEMO_PENDING_SALES);
    } catch (err) {
      console.error(err);
      setPendingSales(DEMO_PENDING_SALES);
    } finally {
      setLoading(false);
    }
  };

  const openConfirmModal = (sale: any) => {
    setConfirmSale(sale);
  };

  const closeConfirmModal = () => {
    if (confirming) return;
    setConfirmSale(null);
  };

  const handleConfirm = async (sale = confirmSale) => {
    if (!sale?.id) return;

    const saleId = Number(sale.id);
    setConfirming(saleId);
    try {
      await appFetch(`/api/sales/${saleId}/confirm`, { method: 'PUT' });
      setConfirmSale(null);
      await loadPendingSales();
      showNotification({ message: 'Pending sale confirmed successfully', type: 'success' });
    } catch (err) {
      showNotification({ message: String(err), type: 'error' });
    } finally {
      setConfirming(null);
    }
  };

  const openSettlementModal = (sale: any) => {
    setSelectedSale(sale);
    setSettlementForm({ cash: '', transfer: '', pos: '', note: '' });
  };

  const closeSettlementModal = () => {
    setSelectedSale(null);
    setSettlementForm({ cash: '', transfer: '', pos: '', note: '' });
  };

  const handleSaveSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSale) return;

    const nextPayments = {
      cash: Number(settlementForm.cash || 0),
      transfer: Number(settlementForm.transfer || 0),
      pos: Number(settlementForm.pos || 0),
    };

    if (nextPayments.cash + nextPayments.transfer + nextPayments.pos <= 0) {
      showNotification({ message: 'Enter at least one payment amount to settle this debt', type: 'warning' });
      return;
    }

    setSavingSettlement(true);
    try {
      await appFetch(`/api/sales/${selectedSale.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({ payment_methods: nextPayments, note: settlementForm.note }),
      });
      showNotification({ message: 'Outstanding payment updated successfully', type: 'success' });
      closeSettlementModal();
      await loadPendingSales();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to record payment'), type: 'error' });
    } finally {
      setSavingSettlement(false);
    }
  };

  const openReminderShareModal = (sale: any) => {
    setShareReminderSale(sale);
    setShareReminderPhone(String(sale?.customer_phone || ''));
  };

  const handleSendReminder = (sale = shareReminderSale, targetPhone = shareReminderPhone) => {
    if (!sale) return;

    openWhatsAppShare({
      phone: targetPhone,
      title: `Hello ${sale.customer_name || 'customer'}, this is a payment reminder from Goody POS.`,
      lines: [
        `Sale ID: #${sale.id}`,
        `Date: ${sale.timestamp ? new Date(sale.timestamp).toLocaleString() : '—'}`,
        `Total Sale Value: ${formatCurrency(Number(sale.total || 0))}`,
        `Amount Paid: ${formatCurrency(Number(sale.amount_paid || 0))}`,
        `Outstanding Balance: ${formatCurrency(Number(sale.amount_due || 0))}`,
        sale?.due_date ? `Due Date: ${new Date(sale.due_date).toLocaleDateString()}` : '',
        sale?.note ? `Note: ${sale.note}` : '',
        '',
        'Please reach out or complete the balance at your earliest convenience. Thank you.',
      ],
    });

    setShareReminderSale(null);
    showNotification({
      message: targetPhone
        ? 'Payment reminder opened in WhatsApp.'
        : 'Choose any contact inside WhatsApp to send this reminder.',
      type: 'success'
    });
  };

  const totalReceivables = useMemo(
    () => pendingSales.reduce((sum, sale) => sum + (Number(sale.amount_due) || 0), 0),
    [pendingSales]
  );

  const totalPages = Math.max(1, Math.ceil(pendingSales.length / PAGE_SIZE));
  const pagedSales = pendingSales.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Receivables & Transfer Vault</h1>
          <p className="text-slate-500">Track pay-later balances, send reminders, and confirm pending transfers.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
            <Home size={16} /> Home
          </Link>
          <div className="flex items-center gap-2 rounded-xl border border-amber-700/30 bg-amber-900/20 px-4 py-2 font-bold text-amber-400">
            <Clock size={18} /> {pendingSales.length} Open Pending Sale{pendingSales.length === 1 ? '' : 's'}
          </div>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Outstanding Receivables</span>
            <div className="rounded-xl bg-amber-900/20 p-2 text-amber-600"><WalletCards size={18} /></div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{formatCurrency(totalReceivables)}</p>
          <p className="mt-1 text-xs text-slate-500">Current customer debts and pending balances.</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Pending Count</span>
            <div className="rounded-xl bg-sky-50 p-2 text-sky-600"><ArrowRightLeft size={18} /></div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{pendingSales.length}</p>
          <p className="mt-1 text-xs text-slate-500">Transfers awaiting approval or debts awaiting settlement.</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Amount Already Paid</span>
            <div className="rounded-xl bg-emerald-900/20 p-2 text-emerald-600"><Banknote size={18} /></div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{formatCurrency(pendingSales.reduce((sum, sale) => sum + (Number(sale.amount_paid) || 0), 0))}</p>
          <p className="mt-1 text-xs text-slate-500">Total received so far from open pending sales.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {pagedSales.map((sale) => (
          <div key={sale.id} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-slate-50 p-4 text-slate-400">
                  <ArrowRightLeft size={30} />
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-bold text-slate-900">Sale #{sale.id}</h3>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-400">
                      Pending
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                    <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(sale.timestamp).toLocaleString()}</span>
                    <span className="flex items-center gap-1"><User size={14} /> {sale.customer_name || 'Walk-in Customer'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {Object.entries(sale.payment_methods || {}).map(([method, amount]: any) => Number(amount) > 0 && (
                      <span key={method} className="rounded-full border border-slate-100 bg-slate-50 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-500">
                        {method}: {formatCurrency(Number(amount) || 0)}
                      </span>
                    ))}
                    {sale.customer_phone && (
                      <span className="rounded-full border border-emerald-700/30 bg-emerald-900/20 px-2.5 py-1 text-[10px] font-bold text-emerald-400">
                        {sale.customer_phone}
                      </span>
                    )}
                  </div>
                  {sale.note && <p className="text-sm text-slate-600">{sale.note}</p>}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[360px]">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</p>
                  <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(sale.total)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Paid</p>
                  <p className="mt-1 text-lg font-black text-emerald-300">{formatCurrency(sale.amount_paid || 0)}</p>
                </div>
                <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-400">Due</p>
                  <p className="mt-1 text-lg font-black text-amber-300">{formatCurrency(sale.amount_due || 0)}</p>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {(sale.amount_due || 0) > 0 && (
                <>
                  <button
                    onClick={() => openReminderShareModal(sale)}
                    className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 font-bold text-white transition-colors hover:bg-green-700"
                  >
                    <MessageCircle size={16} /> WhatsApp Reminder
                  </button>
                  <button
                    onClick={() => openSettlementModal(sale)}
                    className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 font-bold text-white transition-colors hover:bg-slate-800"
                  >
                    <Banknote size={16} /> Record Payment
                  </button>
                </>
              )}

              {(sale.amount_due || 0) <= 0 && (
                <button
                  onClick={() => openConfirmModal(sale)}
                  disabled={confirming === Number(sale.id)}
                  className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 font-bold text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                >
                  {confirming === Number(sale.id) ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                  Confirm Receipt
                </button>
              )}
            </div>
          </div>
        ))}

        {pendingSales.length > PAGE_SIZE && (
          <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500">Page {page} of {totalPages} &bull; {pendingSales.length} total records</p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        {pendingSales.length === 0 && (
          <div className="rounded-3xl border-2 border-dashed border-slate-100 bg-white py-20 text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-slate-50">
              <CheckCircle2 className="text-slate-200" size={40} />
            </div>
            <h3 className="text-lg font-bold text-slate-900">No open receivables</h3>
            <p className="text-slate-500">All pending transfers and customer debts are fully settled.</p>
          </div>
        )}
      </div>

      <WhatsAppShareModal
        isOpen={Boolean(shareReminderSale)}
        phone={shareReminderPhone}
        recipientName={shareReminderSale?.customer_name || 'customer'}
        title="Send Payment Reminder"
        description={`Send this reminder to ${shareReminderSale?.customer_name || 'the customer'} or any other WhatsApp number.`}
        infoText="If the saved phone number is not on WhatsApp, clear the field and choose any contact directly inside WhatsApp."
        buttonLabel="Send Reminder"
        onPhoneChange={setShareReminderPhone}
        onClose={() => setShareReminderSale(null)}
        onShare={() => handleSendReminder(shareReminderSale, shareReminderPhone)}
      />

      {confirmSale && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-emerald-700/30 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-emerald-900/20 p-3 text-emerald-600">
                  <CheckCircle2 size={28} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900">Confirm Receipt</h2>
                  <p className="text-sm text-slate-500">
                    Mark Sale #{confirmSale.id} as fully received and remove it from the pending list.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeConfirmModal}
                disabled={confirming === Number(confirmSale.id)}
                className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-300 disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 p-4 text-sm text-emerald-950">
                <p>
                  <span className="font-bold">Customer:</span> {confirmSale.customer_name || 'Walk-in Customer'}
                </p>
                <p className="mt-1">
                  <span className="font-bold">Date:</span>{' '}
                  {confirmSale.timestamp ? new Date(confirmSale.timestamp).toLocaleString() : '—'}
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Total</p>
                  <p className="mt-1 text-lg font-black text-slate-900">{formatCurrency(confirmSale.total || 0)}</p>
                </div>
                <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Paid</p>
                  <p className="mt-1 text-lg font-black text-emerald-300">{formatCurrency(confirmSale.amount_paid || 0)}</p>
                </div>
                <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-400">Due</p>
                  <p className="mt-1 text-lg font-black text-amber-300">{formatCurrency(confirmSale.amount_due || 0)}</p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeConfirmModal}
                  disabled={confirming === Number(confirmSale.id)}
                  className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirm(confirmSale)}
                  disabled={confirming === Number(confirmSale.id)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {confirming === Number(confirmSale.id) ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                  {confirming === Number(confirmSale.id) ? 'Confirming...' : 'Yes, Confirm Receipt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedSale && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Record Payment</h2>
                <p className="text-sm text-slate-500">Add a new payment to settle Sale #{selectedSale.id}.</p>
              </div>
              <button onClick={closeSettlementModal} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveSettlement} className="space-y-4">
              <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 p-4 text-sm text-amber-300">
                Outstanding Balance: <span className="font-black">{formatCurrency(selectedSale.amount_due || 0)}</span>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-300">Cash</label>
                  <input type="number" min="0" step="0.01" value={settlementForm.cash} onChange={(e) => setSettlementForm((prev) => ({ ...prev, cash: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-300">Transfer</label>
                  <input type="number" min="0" step="0.01" value={settlementForm.transfer} onChange={(e) => setSettlementForm((prev) => ({ ...prev, transfer: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-300">POS</label>
                  <input type="number" min="0" step="0.01" value={settlementForm.pos} onChange={(e) => setSettlementForm((prev) => ({ ...prev, pos: e.target.value }))} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900" />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-300">Note</label>
                <textarea value={settlementForm.note} onChange={(e) => setSettlementForm((prev) => ({ ...prev, note: e.target.value }))} rows={3} placeholder="Optional note about this payment" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900" />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={closeSettlementModal} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-bold text-slate-600 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={savingSettlement} className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                  {savingSettlement ? 'Saving...' : 'Save Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransferVault;

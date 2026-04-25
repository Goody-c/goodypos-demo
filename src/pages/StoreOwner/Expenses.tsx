import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  CalendarRange,
  Home,
  Loader2,
  Plus,
  ReceiptText,
  Trash2,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useNotification } from '../../context/NotificationContext';
import { formatCurrency } from '../../lib/utils';
import ConfirmActionModal from '../../components/ConfirmActionModal';

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const expenseCategories = ['Operations', 'Transport', 'Utilities', 'Salary', 'Restock', 'Marketing', 'Maintenance', 'Other'];

const Expenses: React.FC = () => {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<any>(null);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ totalExpenses: 0, count: 0, categoryBreakdown: [] });
  const [analytics, setAnalytics] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ from: getLocalDateValue(), to: getLocalDateValue() });
  const [form, setForm] = useState({
    title: '',
    amount: '',
    category: 'Operations',
    spent_at: `${getLocalDateValue()}T12:00`,
    note: '',
  });

  useEffect(() => {
    void loadData();
  }, [filters.from, filters.to]);

  const loadData = async () => {
    try {
      setLoading(true);
      const query = new URLSearchParams();
      if (filters.from) query.set('from', filters.from);
      if (filters.to) query.set('to', filters.to);

      const [expenseData, analyticsData] = await Promise.all([
        appFetch(`/api/expenses?${query.toString()}`),
        appFetch('/api/analytics'),
      ]);

      setExpenses(Array.isArray(expenseData?.expenses) ? expenseData.expenses : []);
      setSummary(expenseData?.summary || { totalExpenses: 0, count: 0, categoryBreakdown: [] });
      setAnalytics(analyticsData || null);
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to load expenses'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setForm({
      title: '',
      amount: '',
      category: 'Operations',
      spent_at: `${getLocalDateValue()}T12:00`,
      note: '',
    });
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      showNotification({ message: 'Expense title is required', type: 'warning' });
      return;
    }

    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showNotification({ message: 'Enter a valid expense amount', type: 'warning' });
      return;
    }

    setSaving(true);
    try {
      await appFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          amount,
          category: form.category,
          note: form.note.trim(),
          spent_at: new Date(form.spent_at).toISOString(),
        }),
      });

      showNotification({ message: 'Expense recorded successfully', type: 'success' });
      setShowModal(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save expense'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteExpense = (expense: any) => {
    setExpenseToDelete(expense);
  };

  const handleDeleteExpense = async (expense = expenseToDelete) => {
    if (!expense?.id) return;

    const id = Number(expense.id);
    setDeletingId(id);
    try {
      await appFetch(`/api/expenses/${id}`, { method: 'DELETE' });
      setExpenseToDelete(null);
      showNotification({ message: 'Expense deleted successfully', type: 'success' });
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to delete expense'), type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const topCategories = useMemo(() => Array.isArray(summary?.categoryBreakdown) ? summary.categoryBreakdown.slice(0, 4) : [], [summary]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Expense Tracker</h1>
          <p className="text-slate-500">Record operating expenses and watch net profit after cost.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/" className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
            <Home size={16} /> Home
          </Link>
          <button
            onClick={() => {
              resetForm();
              setShowModal(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-800"
          >
            <Plus size={16} /> Add Expense
          </button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Expenses in View</span>
            <div className="rounded-xl bg-rose-900/20 p-2 text-rose-600"><ReceiptText size={18} /></div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{formatCurrency(summary?.totalExpenses || 0)}</p>
          <p className="mt-1 text-xs text-slate-500">{summary?.count || 0} recorded expense item(s).</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Gross Profit</span>
            <div className="rounded-xl bg-emerald-900/20 p-2 text-emerald-600"><TrendingUp size={18} /></div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{formatCurrency(analytics?.grossProfit || analytics?.netProfit || 0)}</p>
          <p className="mt-1 text-xs text-slate-500">Based on selling price minus product cost.</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Net After Expenses</span>
            <div className="rounded-xl bg-blue-900/20 p-2 text-blue-600"><WalletCards size={18} /></div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{formatCurrency(analytics?.netProfitAfterExpenses || 0)}</p>
          <p className="mt-1 text-xs text-slate-500">Gross profit minus your operating expenses.</p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-slate-600">Outstanding Receivables</span>
            <div className="rounded-xl bg-amber-900/20 p-2 text-amber-600"><Banknote size={18} /></div>
          </div>
          <p className="mt-3 text-3xl font-black text-slate-900">{formatCurrency(analytics?.pendingReceivables || 0)}</p>
          <p className="mt-1 text-xs text-slate-500">{analytics?.pendingReceivableCount || 0} pay-later sale(s) still open.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Recent Expenses</h2>
              <p className="text-sm text-slate-500">Filter by date and manage operating costs.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
                <CalendarRange size={14} />
                <input type="date" value={filters.from} onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))} className="bg-transparent outline-none" />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
                To
                <input type="date" value={filters.to} onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))} className="bg-transparent outline-none" />
              </label>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {expenses.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No expenses found for the selected date range.</div>
            ) : expenses.map((expense) => (
              <div key={expense.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-slate-900">{expense.title}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{expense.category || 'General'}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{new Date(expense.spent_at).toLocaleString()} {expense.created_by_username ? `• by ${expense.created_by_username}` : ''}</p>
                  {expense.note && <p className="mt-2 text-sm text-slate-600">{expense.note}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-lg font-black text-slate-900">{formatCurrency(expense.amount || 0)}</p>
                  <button
                    onClick={() => requestDeleteExpense(expense)}
                    disabled={deletingId === Number(expense.id)}
                    className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="Delete expense"
                  >
                    {deletingId === Number(expense.id) ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="space-y-6">
          <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Top Expense Categories</h2>
            <div className="mt-4 space-y-3">
              {topCategories.length === 0 ? (
                <p className="text-sm text-slate-500">No category totals yet.</p>
              ) : topCategories.map((entry: any) => (
                <div key={entry.category} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-slate-700">{entry.category}</span>
                    <span className="font-black text-slate-900">{formatCurrency(entry.total || 0)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{entry.count || 0} item(s)</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 p-4 shadow-sm">
            <h2 className="text-lg font-bold text-emerald-300">Profit Tip</h2>
            <p className="mt-2 text-sm text-emerald-300">
              Add each product cost in `Inventory` to get more accurate gross profit and net profit after expenses.
            </p>
          </div>
        </aside>
      </div>

      <ConfirmActionModal
        isOpen={Boolean(expenseToDelete)}
        title="Delete Expense Entry"
        description="This expense record will be removed from your tracker and profit summary."
        confirmLabel="Yes, Delete Expense"
        tone="danger"
        loading={deletingId === Number(expenseToDelete?.id)}
        onClose={() => setExpenseToDelete(null)}
        onConfirm={() => handleDeleteExpense(expenseToDelete)}
        details={expenseToDelete ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-slate-300">
            <p><span className="font-bold text-slate-900">Title:</span> {expenseToDelete.title}</p>
            <p className="mt-1"><span className="font-bold text-slate-900">Amount:</span> {formatCurrency(expenseToDelete.amount || 0)}</p>
            <p className="mt-1"><span className="font-bold text-slate-900">Date:</span> {expenseToDelete.spent_at ? new Date(expenseToDelete.spent_at).toLocaleString() : '—'}</p>
          </div>
        ) : null}
      />

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <div className="w-[calc(100%-1.5rem)] max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Add Expense</h2>
                <p className="text-sm text-slate-500">Track running business costs and net profit.</p>
              </div>
              <button onClick={() => setShowModal(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-bold text-slate-300">Expense Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g. Fuel for delivery"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900"
                  required
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-300">Amount</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900"
                    required
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-bold text-slate-300">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    {expenseCategories.map((category) => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-300">Spent At</label>
                <input
                  type="datetime-local"
                  value={form.spent_at}
                  onChange={(e) => setForm((prev) => ({ ...prev, spent_at: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold text-slate-300">Note</label>
                <textarea
                  value={form.note}
                  onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
                  rows={3}
                  placeholder="Optional details about this expense"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-bold text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Expenses;

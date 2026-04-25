import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  Download,
  FileSpreadsheet,
  Home,
  Loader2,
  ReceiptText,
  TrendingUp,
  WalletCards,
  DollarSign,
  PiggyBank,
  Plus,
  X,
} from 'lucide-react';
import { appFetch } from '../../lib/api';
import { useNotification } from '../../context/NotificationContext';
import { downloadCsv, formatCurrency } from '../../lib/utils';

const getLocalDateValue = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const expenseCategories = ['Operations', 'Transport', 'Utilities', 'Salary', 'Rent', 'Fuel', 'Internet', 'Other'];

const FinancialReports: React.FC = () => {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(true);
  const [savingExpense, setSavingExpense] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [reportData, setReportData] = useState<any>({ ledger: [], summary: {} });
  const [expenses, setExpenses] = useState<any[]>([]);
  const [filters, setFilters] = useState({
    period: 'daily',
    from: getLocalDateValue(new Date(Date.now() - (29 * 24 * 60 * 60 * 1000))),
    to: getLocalDateValue(),
  });
  const [expenseForm, setExpenseForm] = useState({
    title: '',
    amount: '',
    category: 'Operations',
    spent_at: `${getLocalDateValue()}T12:00`,
    note: '',
  });

  useEffect(() => {
    void loadData();
  }, [filters.period, filters.from, filters.to]);

  const loadData = async () => {
    try {
      setLoading(true);
      const ledgerQuery = new URLSearchParams({ period: filters.period, from: filters.from, to: filters.to });
      const expenseQuery = new URLSearchParams({ from: filters.from, to: filters.to });
      const [ledgerResponse, expenseResponse] = await Promise.all([
        appFetch(`/api/reports/financial-ledger?${ledgerQuery.toString()}`),
        appFetch(`/api/expenses?${expenseQuery.toString()}`),
      ]);
      setReportData(ledgerResponse || { ledger: [], summary: {} });
      setExpenses(Array.isArray(expenseResponse?.expenses) ? expenseResponse.expenses : []);
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to load financial reports'), type: 'error' });
      setReportData({ ledger: [], summary: {} });
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseForm.title.trim()) { showNotification({ message: 'Expense title is required', type: 'warning' }); return; }
    const amount = Number(expenseForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { showNotification({ message: 'Enter a valid expense amount', type: 'warning' }); return; }
    setSavingExpense(true);
    try {
      await appFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({ title: expenseForm.title.trim(), amount, category: expenseForm.category, note: expenseForm.note.trim(), spent_at: new Date(expenseForm.spent_at).toISOString() }),
      });
      setExpenseForm({ title: '', amount: '', category: 'Operations', spent_at: `${getLocalDateValue()}T12:00`, note: '' });
      setShowExpenseModal(false);
      showNotification({ message: 'Expense saved successfully', type: 'success' });
      await loadData();
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save expense'), type: 'error' });
    } finally {
      setSavingExpense(false);
    }
  };

  const handleExportLedger = () => {
    const ledgerRows = Array.isArray(reportData?.ledger) ? reportData.ledger : [];
    if (!ledgerRows.length) { showNotification({ message: 'There is no ledger data to export for this date range.', type: 'warning' }); return; }
    downloadCsv(`financial-ledger-${filters.period}-${filters.from}-to-${filters.to}.csv`, ledgerRows.map((row: any) => ({
      Date: row.label,
      'Total Sales': Number(row.totalSales || 0).toFixed(2),
      'Total Cost': Number(row.totalCost || 0).toFixed(2),
      'Total Discounts': Number(row.totalDiscounts || 0).toFixed(2),
      'Net Profit': Number(row.netProfit || 0).toFixed(2),
      'Moniepoint Total': Number(row.moniepointTotal || 0).toFixed(2),
      'Cash Total': Number(row.cashTotal || 0).toFixed(2),
      'Transfer Total': Number(row.transferTotal || 0).toFixed(2),
      'Tax Collected': Number(row.taxCollected || 0).toFixed(2),
      'Business Revenue': Number(row.businessRevenue || 0).toFixed(2),
    })));
    showNotification({ message: 'Financial ledger exported as CSV successfully', type: 'success' });
  };

  const handleExportExpenses = () => {
    if (!expenses.length) { showNotification({ message: 'There are no expenses to export for this date range.', type: 'warning' }); return; }
    downloadCsv(`expenses-${filters.from}-to-${filters.to}.csv`, expenses.map((expense: any) => ({
      Date: new Date(expense.spent_at).toLocaleString(),
      Title: expense.title,
      Category: expense.category || 'General',
      Amount: Number(expense.amount || 0).toFixed(2),
      Note: expense.note || '',
      'Recorded By': expense.created_by_username || '',
    })));
    showNotification({ message: 'Expense report exported as CSV successfully', type: 'success' });
  };

  const summary = reportData?.summary || {};
  const ledgerRows = useMemo(() => Array.isArray(reportData?.ledger) ? reportData.ledger : [], [reportData]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <header className="relative overflow-hidden rounded-[28px] bg-[radial-gradient(ellipse_at_top_left,#1e3a5f_0%,#1e293b_45%,#0f172a_100%)]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-blue-600/20 blur-3xl" />
          <div className="absolute -right-16 top-8 h-56 w-56 rounded-full bg-emerald-900/200/15 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-40 w-64 rounded-full bg-indigo-900/200/10 blur-2xl" />
          <div className="hero-grid-overlay absolute inset-0 opacity-[0.04]" />
        </div>
        <div className="relative z-10 flex flex-col gap-4 px-6 pt-6 pb-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-bold text-white/70 backdrop-blur">
              <DollarSign size={11} /> Financial Reports
            </div>
            <h1 className="text-2xl font-black text-white sm:text-3xl">Financial Reports</h1>
            <p className="mt-1 text-sm text-white/60">Accounting ledger, true net profit, and export-ready CSV reports.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/" className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-2 text-sm font-bold text-white/80 backdrop-blur transition-colors hover:bg-white/20">
              <Home size={15} /> Home
            </Link>
            <button
              type="button"
              onClick={handleExportLedger}
              className="flex items-center gap-2 rounded-xl bg-emerald-900/200 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-400"
            >
              <Download size={15} /> Export Ledger CSV
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="relative z-10 mt-4 grid grid-cols-2 gap-3 px-6 pb-6 sm:grid-cols-3 xl:grid-cols-5">
          {[
            { label: 'Business Revenue', value: formatCurrency(summary?.businessRevenue || 0), sub: 'Sales less VAT/tax collected', icon: TrendingUp, color: 'text-emerald-300', bg: 'bg-emerald-900/200/15 border-emerald-400/20' },
            { label: 'Tax Collected', value: formatCurrency(summary?.taxCollected || 0), sub: reportData?.vatEnabled ? `VAT active at ${Number(reportData?.vatPercentage || 0)}%` : 'VAT/tax disabled', icon: ReceiptText, color: 'text-amber-300', bg: 'bg-amber-900/200/15 border-amber-400/20' },
            { label: 'Net Profit', value: formatCurrency(summary?.netProfit || 0), sub: 'Revenue minus product cost', icon: WalletCards, color: 'text-blue-300', bg: 'bg-blue-900/200/15 border-blue-400/20' },
            { label: 'Expenses', value: formatCurrency(summary?.totalExpenses || 0), sub: 'Shop costs in this window', icon: Banknote, color: 'text-rose-300', bg: 'bg-rose-900/200/15 border-rose-400/20' },
            { label: 'True Net Profit', value: formatCurrency(summary?.trueNetProfit || 0), sub: 'Net profit minus expenses', icon: PiggyBank, color: 'text-emerald-100', bg: 'bg-emerald-400/10 border-emerald-300/25', highlight: true },
          ].map(({ label, value, sub, icon: Icon, color, bg, highlight }) => (
            <div key={label} className={`rounded-2xl border backdrop-blur p-4 ${bg}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[11px] font-bold uppercase tracking-wide ${highlight ? 'text-white' : 'text-white/60'}`}>{label}</span>
                <Icon size={14} className={color} />
              </div>
              <p className={`mt-2 text-xl font-black ${highlight ? 'text-emerald-100' : 'text-white'}`}>{value}</p>
              <p className={`mt-0.5 text-[10px] ${highlight ? 'text-white/75' : 'text-white/40'}`}>{sub}</p>
            </div>
          ))}
        </div>
      </header>

      {/* Ledger */}
      <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-bold text-slate-900">Daily / Monthly Ledger</h2>
            <p className="text-xs text-slate-500">Discounts, cost, cash, Moniepoint, and profit per period.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={filters.period}
              onChange={(e) => setFilters((prev) => ({ ...prev, period: e.target.value === 'monthly' ? 'monthly' : 'daily' }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-300 outline-none focus:border-slate-400"
            >
              <option value="daily">Daily Ledger</option>
              <option value="monthly">Monthly Ledger</option>
            </select>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-300 outline-none focus:border-slate-400"
            />
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-300 outline-none focus:border-slate-400"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Total Sales</th>
                <th className="px-5 py-3">Total Cost</th>
                <th className="px-5 py-3">Discounts</th>
                <th className="px-5 py-3">Net Profit</th>
                <th className="px-5 py-3">Moniepoint</th>
                <th className="px-5 py-3">Cash</th>
                <th className="px-5 py-3">Tax</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {ledgerRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-slate-400">No financial records found for the selected period.</td>
                </tr>
              ) : ledgerRows.map((row: any) => (
                <tr key={row.date} className="transition-colors hover:bg-slate-50/60">
                  <td className="px-5 py-3.5 font-bold text-slate-900">{row.label}</td>
                  <td className="px-5 py-3.5 font-semibold text-slate-700">{formatCurrency(row.totalSales || 0)}</td>
                  <td className="px-5 py-3.5 text-slate-500">{formatCurrency(row.totalCost || 0)}</td>
                  <td className="px-5 py-3.5 text-slate-500">{formatCurrency(row.totalDiscounts || 0)}</td>
                  <td className="px-5 py-3.5 font-bold text-emerald-600">{formatCurrency(row.netProfit || 0)}</td>
                  <td className="px-5 py-3.5 text-slate-500">{formatCurrency(row.moniepointTotal || 0)}</td>
                  <td className="px-5 py-3.5 text-slate-500">{formatCurrency(row.cashTotal || 0)}</td>
                  <td className="px-5 py-3.5 text-slate-500">{formatCurrency(row.taxCollected || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Expenses */}
      <div className="grid gap-6 xl:grid-cols-1">
        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-4">
            <div>
              <h2 className="font-bold text-slate-900">Recent Expenses in View</h2>
              <p className="mt-0.5 text-xs text-slate-500">High-contrast entries for easy review and printing.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleExportExpenses}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                <Download size={13} /> Export CSV
              </button>
              <button
                type="button"
                onClick={() => setShowExpenseModal(true)}
                className="flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-slate-800"
              >
                <Plus size={13} /> Record Expense
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-50">
            {expenses.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-400">No expenses recorded in the selected date range.</div>
            ) : expenses.slice(0, 10).map((expense: any) => (
              <div key={expense.id} className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-slate-50/60">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900">{expense.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-500">
                      {expense.category || 'General'}
                    </span>
                    <span className="text-xs text-slate-400">{new Date(expense.spent_at).toLocaleString()}</span>
                  </div>
                  {expense.note && <p className="mt-1.5 text-xs text-slate-500 line-clamp-1">{expense.note}</p>}
                </div>
                <p className="shrink-0 text-base font-black text-slate-900">{formatCurrency(expense.amount || 0)}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Record Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center justify-between bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-5">
              <div>
                <h2 className="text-lg font-black text-white">Record Expense</h2>
                <p className="mt-0.5 text-xs text-white/60">Add shop running costs to keep profit accurate.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowExpenseModal(false)}
                className="rounded-xl p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal body */}
            <form onSubmit={handleSaveExpense} className="space-y-3 p-6">
              <input
                value={expenseForm.title}
                onChange={(e) => setExpenseForm((prev) => ({ ...prev, title: e.target.value }))}
                placeholder="e.g. Fuel for Generator"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="Amount"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                />
                <select
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
                >
                  {expenseCategories.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <input
                type="datetime-local"
                value={expenseForm.spent_at}
                onChange={(e) => setExpenseForm((prev) => ({ ...prev, spent_at: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
              />
              <textarea
                rows={3}
                value={expenseForm.note}
                onChange={(e) => setExpenseForm((prev) => ({ ...prev, note: e.target.value }))}
                placeholder="Optional note or receipt reference"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none transition focus:border-slate-400 focus:bg-white"
              />
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingExpense}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                >
                  {savingExpense ? <Loader2 className="animate-spin" size={15} /> : <Banknote size={15} />}
                  {savingExpense ? 'Saving...' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default FinancialReports;

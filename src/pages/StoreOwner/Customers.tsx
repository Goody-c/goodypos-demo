import React, { useEffect, useMemo, useRef, useState } from 'react';
import { appFetch } from '../../lib/api';
import {
  Phone,
  MapPin,
  TrendingUp,
  Calendar,
  Search,
  Loader2,
  ArrowUpDown,
  Trophy,
  Plus,
  X,
  Hash,
  FileText,
  Download,
  Upload,
  MessageCircle,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { downloadCsv, formatCurrency, openWhatsAppShare, parseCsv } from '../../lib/utils';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';
import ConfirmActionModal from '../../components/ConfirmActionModal';

const getInvoiceItemLabel = (item: any, index: number) => {
  const baseName = String(item?.product_name || item?.name || `Item ${index + 1}`).trim();
  if (item?.item_source === 'CONSIGNMENT' || item?.is_consignment) {
    return baseName;
  }
  if (item?.item_source === 'SOURCED' || item?.is_sourced) {
    return baseName;
  }
  return baseName;
};

const Customers: React.FC = () => {
  const { showNotification } = useNotification();
  const { user } = useAuth();
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', address: '' });
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [customerToDelete, setCustomerToDelete] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'total_investment',
    direction: 'desc'
  });
  const [showInvoicesModal, setShowInvoicesModal] = useState(false);
  const [selectedCustomerInvoices, setSelectedCustomerInvoices] = useState<any[]>([]);
  const [invoiceCustomer, setInvoiceCustomer] = useState<any>(null);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [showWhatsAppShareModal, setShowWhatsAppShareModal] = useState(false);
  const [whatsAppSharePhone, setWhatsAppSharePhone] = useState('');
  const importCustomersRef = useRef<HTMLInputElement>(null);

  const canManageCustomers = ['SYSTEM_ADMIN', 'STORE_ADMIN', 'MANAGER'].includes(String(user?.role || ''));
  const canDeleteCustomers = ['SYSTEM_ADMIN', 'STORE_ADMIN'].includes(String(user?.role || ''));

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      const data = await appFetch('/api/customers/stats');
      setCustomers(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetCustomerModal = () => {
    setCustomerForm({ name: '', phone: '', address: '' });
    setEditingCustomer(null);
    setShowAddModal(false);
  };

  const openAddCustomerModal = () => {
    if (!canManageCustomers) {
      showNotification({ message: 'Only managers and store admins can add or edit customers.', type: 'warning' });
      return;
    }

    setEditingCustomer(null);
    setCustomerForm({ name: '', phone: '', address: '' });
    setShowAddModal(true);
  };

  const openEditCustomerModal = (customer: any) => {
    if (!canManageCustomers) {
      showNotification({ message: 'Only managers and store admins can edit customers.', type: 'warning' });
      return;
    }

    setEditingCustomer(customer);
    setCustomerForm({
      name: String(customer?.name || ''),
      phone: String(customer?.phone || ''),
      address: String(customer?.address || ''),
    });
    setShowAddModal(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const savedCustomer = await appFetch(editingCustomer ? `/api/customers/${editingCustomer.id}` : '/api/customers', {
        method: editingCustomer ? 'PUT' : 'POST',
        body: JSON.stringify(customerForm)
      });

      if (editingCustomer && Number(invoiceCustomer?.id) === Number(savedCustomer?.id)) {
        setInvoiceCustomer((current: any) => current ? { ...current, ...savedCustomer } : current);
      }

      resetCustomerModal();
      await loadCustomers();
      showNotification({
        message: editingCustomer ? 'Customer updated successfully' : 'Customer added successfully',
        type: 'success'
      });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to save customer'), type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const requestDeleteCustomer = (customer: any) => {
    if (!canDeleteCustomers) {
      showNotification({ message: 'Only store admins can delete customers.', type: 'warning' });
      return;
    }
    if (Number(customer?.pending_outstanding || 0) > 0) {
      showNotification({ message: 'Customers with outstanding balance cannot be deleted.', type: 'warning' });
      return;
    }
    setCustomerToDelete(customer);
  };

  const handleDeleteCustomer = async (customer = customerToDelete) => {
    if (!customer?.id) return;

    const customerId = Number(customer.id);
    setDeletingId(customerId);
    try {
      await appFetch(`/api/customers/${customerId}`, { method: 'DELETE' });
      setCustomerToDelete(null);
      if (Number(invoiceCustomer?.id) === customerId) {
        closeCustomerInvoices();
      }
      await loadCustomers();
      showNotification({ message: 'Customer deleted successfully', type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to delete customer'), type: 'error' });
    } finally {
      setDeletingId(null);
    }
  };

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const openCustomerInvoices = async (customer: any) => {
    setInvoiceCustomer(customer);
    setShowInvoicesModal(true);
    setLoadingInvoices(true);

    try {
      const data = await appFetch(`/api/customers/${customer.id}/invoices`);
      setInvoiceCustomer(data?.customer || customer);
      setSelectedCustomerInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to load invoices'), type: 'error' });
      setShowInvoicesModal(false);
    } finally {
      setLoadingInvoices(false);
    }
  };

  const closeCustomerInvoices = () => {
    setShowInvoicesModal(false);
    setSelectedCustomerInvoices([]);
    setInvoiceCustomer(null);
  };

  const customerStatementSummary = useMemo(() => {
    return selectedCustomerInvoices.reduce(
      (acc, invoice) => {
        const total = Number(invoice?.total) || 0;
        const paid = Number(invoice?.amount_paid) || 0;
        const due = Number.isFinite(Number(invoice?.amount_due)) ? Number(invoice.amount_due) : Math.max(0, total - paid);
        const timestamp = invoice?.timestamp ? new Date(invoice.timestamp).getTime() : 0;

        acc.totalBilled += total;
        acc.totalPaid += paid;
        acc.totalOutstanding += due;
        if (String(invoice?.status || '').toUpperCase() === 'PENDING' || due > 0) {
          acc.pendingCount += 1;
        }
        if (timestamp > acc.lastActivityTs) {
          acc.lastActivityTs = timestamp;
        }
        return acc;
      },
      {
        invoiceCount: selectedCustomerInvoices.length,
        totalBilled: 0,
        totalPaid: 0,
        totalOutstanding: 0,
        pendingCount: 0,
        lastActivityTs: 0,
      }
    );
  }, [selectedCustomerInvoices]);

  const handleDownloadCustomerStatement = async () => {
    if (!invoiceCustomer) return;
    if (!selectedCustomerInvoices.length) {
      showNotification({ message: 'There are no invoices to include in this statement yet.', type: 'warning' });
      return;
    }

    try {
      const [{ generateCustomerStatementPDF }, store] = await Promise.all([
        import('../../lib/pdf'),
        appFetch('/api/store/settings').catch(() => null),
      ]);
      const { doc, filename } = await generateCustomerStatementPDF(invoiceCustomer, selectedCustomerInvoices, store || {});
      doc.save(filename);
      showNotification({ message: 'Customer statement downloaded successfully', type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to generate customer statement'), type: 'error' });
    }
  };

  const openCustomerStatementShare = () => {
    if (!invoiceCustomer) return;
    if (!selectedCustomerInvoices.length) {
      showNotification({ message: 'There are no invoices to share for this customer yet.', type: 'warning' });
      return;
    }

    setWhatsAppSharePhone(String(invoiceCustomer.phone || ''));
    setShowWhatsAppShareModal(true);
  };

  const handleShareCustomerStatement = (targetPhone = whatsAppSharePhone) => {
    if (!invoiceCustomer) return;
    if (!selectedCustomerInvoices.length) {
      showNotification({ message: 'There are no invoices to share for this customer yet.', type: 'warning' });
      return;
    }

    const recentLines = selectedCustomerInvoices.slice(0, 6).map((invoice) => {
      const due = Number.isFinite(Number(invoice?.amount_due))
        ? Number(invoice.amount_due)
        : Math.max(0, (Number(invoice?.total) || 0) - (Number(invoice?.amount_paid) || 0));
      return `• Invoice #${invoice.id}: ${formatCurrency(Number(invoice?.total) || 0)} total, ${formatCurrency(due)} due`;
    });

    const message = [
      `Hello ${invoiceCustomer.name || 'Customer'}, here is your account statement from our store.`,
      '',
      `Invoices: ${customerStatementSummary.invoiceCount}`,
      `Total billed: ${formatCurrency(customerStatementSummary.totalBilled)}`,
      `Amount paid: ${formatCurrency(customerStatementSummary.totalPaid)}`,
      `Outstanding balance: ${formatCurrency(customerStatementSummary.totalOutstanding)}`,
      recentLines.length ? '' : null,
      recentLines.length ? 'Recent invoices:' : null,
      ...recentLines,
    ].filter(Boolean).join('\n');

    openWhatsAppShare({
      phone: targetPhone,
      title: `Customer statement for ${invoiceCustomer.name || 'Customer'}`,
      lines: message.split('\n'),
    });

    setShowWhatsAppShareModal(false);
    showNotification({
      message: targetPhone
        ? `WhatsApp statement opened for ${invoiceCustomer.name || 'Customer'}.`
        : 'WhatsApp opened. You can now choose any contact to send the customer statement.',
      type: 'success',
      presentation: 'toast',
      duration: 1600,
    });
  };

  const handleExportCustomers = () => {
    try {
      const rows = customers.map((customer) => ({
        customer_code: customer.customer_code || '',
        name: customer.name,
        phone: customer.phone,
        address: customer.address || '',
        purchase_count: customer.purchase_count || 0,
        total_investment: customer.total_investment || 0,
        last_visit: customer.last_visit || '',
        created_at: customer.created_at || '',
      }));
      downloadCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      showNotification({ message: `Exported ${rows.length} customers`, type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to export customers'), type: 'error' });
    }
  };

  const handleImportCustomers = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        showNotification({ message: 'No customer rows were found in the selected CSV file.', type: 'warning' });
        return;
      }

      const result = await appFetch('/api/import/customers', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });

      await loadCustomers();
      showNotification({ message: `Imported ${result.importedCount || rows.length} customers successfully`, type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to import customers'), type: 'error' });
    } finally {
      e.target.value = '';
    }
  };

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const sortedCustomers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return [...customers]
      .filter((customer) => (
        String(customer.name || '').toLowerCase().includes(normalizedSearch)
        || String(customer.phone || '').includes(normalizedSearch)
        || String(customer.customer_code || '').includes(normalizedSearch)
      ))
      .sort((a, b) => {
        const aValue = a[sortConfig.key] || 0;
        const bValue = b[sortConfig.key] || 0;
        if (sortConfig.direction === 'asc') {
          return aValue > bValue ? 1 : -1;
        }
        return aValue < bValue ? 1 : -1;
      });
  }, [customers, search, sortConfig]);

  useEffect(() => { setPage(1); }, [search, sortConfig]);

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="space-y-8">
      <header className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customer Loyalty</h1>
          <p className="text-slate-500">Track purchase history and reward your top investors</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <input
            ref={importCustomersRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportCustomers}
          />
          <button
            onClick={handleExportCustomers}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-50 transition-all"
          >
            <Download size={16} /> Export CSV
          </button>
          <button
            onClick={() => importCustomersRef.current?.click()}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-bold text-slate-300 hover:bg-slate-200 transition-all"
          >
            <Upload size={16} /> Import CSV
          </button>
          {canManageCustomers && (
            <button 
              onClick={openAddCustomerModal}
              className="flex items-center gap-2 bg-slate-900 text-white px-6 py-2 rounded-xl font-bold hover:bg-slate-800 transition-all"
            >
              <Plus size={20} />
              Add Customer
            </button>
          )}
          <div className="flex items-center gap-3 bg-slate-100 px-4 py-2 rounded-xl">
            <Trophy className="text-amber-500" />
            <span className="text-sm font-bold text-slate-300">Top 10 Ranking Active</span>
          </div>
        </div>
      </header>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input 
              type="text"
              placeholder="Search by name, phone or ID..."
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[760px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-gray-100">
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Customer ID</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Customer</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Contact</th>
                <th 
                  className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-900"
                  onClick={() => handleSort('purchase_count')}
                >
                  <div className="flex items-center gap-2">
                    Purchases <ArrowUpDown size={14} />
                  </div>
                </th>
                <th 
                  className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-900"
                  onClick={() => handleSort('total_investment')}
                >
                  <div className="flex items-center gap-2">
                    Total Investment <ArrowUpDown size={14} />
                  </div>
                </th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest">Last Visit</th>
                <th className="p-4 text-xs font-bold text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedCustomers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((customer, index) => (
                <tr key={customer.id} className="border-b border-gray-50 hover:bg-slate-50 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2 font-mono text-sm font-bold text-slate-500">
                      <Hash size={14} />
                      {customer.customer_code || 'N/A'}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                        index < 3 ? 'bg-amber-100 text-amber-400' : 'bg-slate-100 text-slate-300'
                      }`}>
                        {index < 3 ? <Trophy size={18} /> : customer.name[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900">{customer.name}</p>
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <MapPin size={12} /> {customer.address || 'No address'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2 text-slate-600 font-medium">
                      <Phone size={16} className="text-slate-400" />
                      {customer.phone}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={16} className="text-green-500" />
                      <span className="font-bold text-slate-900">{customer.purchase_count} items</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className="font-black text-slate-900">{formatCurrency(customer.total_investment || 0)}</span>
                  </td>
                  <td className="p-4">
                    <div className="flex items-center gap-2 text-slate-500 text-sm">
                      <Calendar size={16} />
                      {customer.last_visit ? new Date(customer.last_visit).toLocaleDateString() : 'Never'}
                    </div>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        onClick={() => openCustomerInvoices(customer)}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-slate-200 transition-colors"
                      >
                        <FileText size={16} /> View
                      </button>
                      {canManageCustomers && (
                        <button
                          onClick={() => openEditCustomerModal(customer)}
                          className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-900/20 px-3 py-2 text-sm font-bold text-blue-400 hover:bg-blue-100 transition-colors"
                        >
                          <Pencil size={16} /> Edit
                        </button>
                      )}
                      {canDeleteCustomers && (
                        <button
                          onClick={() => requestDeleteCustomer(customer)}
                          disabled={deletingId === Number(customer.id) || Number(customer.pending_outstanding || 0) > 0}
                          title={Number(customer.pending_outstanding || 0) > 0 ? 'Customer has outstanding balance and cannot be deleted' : 'Delete customer'}
                          className="inline-flex items-center gap-2 rounded-xl border border-red-500 bg-red-900/40 px-3 py-2 text-sm font-bold text-red-400 transition-colors hover:bg-red-800/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingId === Number(customer.id) ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {sortedCustomers.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    No customers found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {sortedCustomers.length > PAGE_SIZE && (
            <div className="flex items-center justify-center gap-3 py-4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-sm font-semibold text-slate-600">
                Page {page} of {Math.ceil(sortedCustomers.length / PAGE_SIZE)} &bull; {sortedCustomers.length} customers
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(Math.ceil(sortedCustomers.length / PAGE_SIZE), p + 1))}
                disabled={page === Math.ceil(sortedCustomers.length / PAGE_SIZE)}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {showInvoicesModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white max-w-5xl w-full rounded-3xl p-8 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex justify-between items-start mb-6 gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Customer Invoices</h2>
                <p className="text-sm text-slate-500">
                  {invoiceCustomer?.name || 'Customer'} • {invoiceCustomer?.phone || 'No phone'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {customerStatementSummary.lastActivityTs
                    ? `Last invoice activity: ${new Date(customerStatementSummary.lastActivityTs).toLocaleString()}`
                    : 'No statement activity yet'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={openCustomerStatementShare}
                  className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-900/20 px-3 py-2 text-sm font-bold text-emerald-400 hover:bg-emerald-100 transition-colors"
                >
                  <MessageCircle size={16} /> Share
                </button>
                <button
                  onClick={handleDownloadCustomerStatement}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-slate-200 transition-colors"
                >
                  <Download size={16} /> Statement PDF
                </button>
                <button onClick={closeCustomerInvoices} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
              <div className="rounded-2xl bg-slate-900 px-4 py-3 text-white">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-300">Invoices</p>
                <p className="mt-2 text-2xl font-black">{customerStatementSummary.invoiceCount}</p>
              </div>
              <div className="rounded-2xl bg-blue-900/20 px-4 py-3 border border-blue-700/30">
                <p className="text-[11px] uppercase tracking-[0.2em] text-blue-600">Total Billed</p>
                <p className="mt-2 text-xl font-black text-slate-900">{formatCurrency(customerStatementSummary.totalBilled)}</p>
              </div>
              <div className="rounded-2xl bg-emerald-900/20 px-4 py-3 border border-emerald-700/30">
                <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-600">Amount Paid</p>
                <p className="mt-2 text-xl font-black text-slate-900">{formatCurrency(customerStatementSummary.totalPaid)}</p>
              </div>
              <div className="rounded-2xl bg-amber-900/20 px-4 py-3 border border-amber-700/30">
                <p className="text-[11px] uppercase tracking-[0.2em] text-amber-600">Outstanding</p>
                <p className="mt-2 text-xl font-black text-slate-900">{formatCurrency(customerStatementSummary.totalOutstanding)}</p>
                <p className="text-xs text-amber-400 mt-1">{customerStatementSummary.pendingCount} pending invoice(s)</p>
              </div>
            </div>

            <div className="flex-1 overflow-auto space-y-4 pr-1">
              {loadingInvoices ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="animate-spin text-slate-500" />
                </div>
              ) : selectedCustomerInvoices.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <FileText size={42} className="mx-auto mb-3" />
                  <p className="font-semibold">No invoices found for this customer yet.</p>
                </div>
              ) : (
                selectedCustomerInvoices.map((invoice) => (
                  <div key={invoice.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-lg font-bold text-slate-900">Invoice #{invoice.id}</p>
                        <p className="text-sm text-slate-500">{new Date(invoice.timestamp).toLocaleString()} • Cashier: {invoice.user_username || 'System'}</p>
                      </div>
                      <div className="text-left md:text-right">
                        <p className="text-xl font-black text-slate-900">{formatCurrency(invoice.total)}</p>
                        <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                          invoice.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                          invoice.status === 'PENDING' ? 'bg-amber-100 text-amber-400' : 'bg-red-100 text-red-700'
                        }`}>
                          {invoice.status}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Amount Paid</p>
                        <p className="mt-1 text-lg font-black text-emerald-400">{formatCurrency(Number(invoice.amount_paid) || 0)}</p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Outstanding</p>
                        <p className="mt-1 text-lg font-black text-amber-400">
                          {formatCurrency(Number.isFinite(Number(invoice.amount_due)) ? Number(invoice.amount_due) : Math.max(0, (Number(invoice.total) || 0) - (Number(invoice.amount_paid) || 0)))}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Due Date</p>
                        <p className="mt-1 text-sm font-bold text-slate-300">{invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'No due date'}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {(invoice.items || []).map((item: any, index: number) => (
                        <div key={`${invoice.id}-${item.id}`} className="flex items-start justify-between gap-4 rounded-xl bg-white px-4 py-3 border border-slate-100">
                          <div>
                            <p className="font-semibold text-slate-900">{getInvoiceItemLabel(item, index)}</p>
                            <p className="text-xs text-slate-500">
                              {item.quantity} × {formatCurrency(item.price_at_sale)}
                              {item.condition ? ` • ${String(item.condition).replace(/_/g, ' ')}` : ''}
                            </p>
                          </div>
                          <span className="font-bold text-slate-900">{formatCurrency(item.subtotal)}</span>
                        </div>
                      ))}
                    </div>

                    {(invoice.discount_amount || invoice.discount_note) && (
                      <div className="rounded-xl border border-amber-200 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
                        <span className="font-bold">Discount applied:</span> {formatCurrency(Number(invoice.discount_amount) || 0)}
                        {invoice.discount_note ? ` • ${invoice.discount_note}` : ''}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200">
                      {Object.entries(invoice.payment_methods || {}).map(([method, amount]: any) => amount > 0 && (
                        <span key={method} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-300 border border-slate-200">
                          {method}: {formatCurrency(amount)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <WhatsAppShareModal
        isOpen={showWhatsAppShareModal && Boolean(invoiceCustomer)}
        phone={whatsAppSharePhone}
        recipientName={invoiceCustomer?.name || 'customer'}
        title="Share Customer Statement"
        description={`Send this statement to ${invoiceCustomer?.name || 'the customer'} or any other WhatsApp number.`}
        infoText="If the saved phone number is not on WhatsApp, clear the field and choose any contact directly inside WhatsApp."
        onPhoneChange={setWhatsAppSharePhone}
        onClose={() => setShowWhatsAppShareModal(false)}
        onShare={() => handleShareCustomerStatement(whatsAppSharePhone)}
      />

      <ConfirmActionModal
        isOpen={Boolean(customerToDelete)}
        title="Delete Customer"
        description="This removes the customer from your loyalty list. Customers with invoice history cannot be deleted."
        confirmLabel="Yes, Delete Customer"
        tone="danger"
        loading={deletingId === Number(customerToDelete?.id)}
        onClose={() => setCustomerToDelete(null)}
        onConfirm={() => { void handleDeleteCustomer(customerToDelete); }}
        details={customerToDelete ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-900">
            <p><span className="font-bold">Name:</span> {customerToDelete.name}</p>
            <p className="mt-1"><span className="font-bold">Phone:</span> {customerToDelete.phone || '—'}</p>
            <p className="mt-1"><span className="font-bold">Purchases:</span> {customerToDelete.purchase_count || 0}</p>
          </div>
        ) : undefined}
      />

      {/* Add Customer Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100]">
          <div className="bg-white max-w-md w-[calc(100%-1.5rem)] rounded-2xl p-8 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-900">{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</h2>
              <button onClick={resetCustomerModal} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSaveCustomer} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Full Name</label>
                <input 
                  required
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={customerForm.name}
                  onChange={e => setCustomerForm({...customerForm, name: e.target.value})}
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Phone Number</label>
                <input 
                  required
                  type="text"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={customerForm.phone}
                  onChange={e => setCustomerForm({...customerForm, phone: e.target.value})}
                  placeholder="e.g. +233801234567"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Address (Optional)</label>
                <textarea 
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                  value={customerForm.address}
                  onChange={e => setCustomerForm({...customerForm, address: e.target.value})}
                  placeholder="e.g. 123 Street Name, City"
                  rows={3}
                />
              </div>
              <div className="flex gap-4 pt-4">
                <button 
                  type="button"
                  onClick={resetCustomerModal}
                  className="flex-1 p-3 border border-slate-200 rounded-xl font-bold hover:bg-slate-50 text-slate-600"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={saving}
                  className="flex-1 p-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 flex items-center justify-center gap-2"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : editingCustomer ? <Pencil size={18} /> : <Plus size={18} />}
                  {editingCustomer ? 'Update Customer' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;

import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { appFetch } from '../../lib/api';
import {
  Search,
  FileText,
  Download,
  Printer,
  X,
  Loader2,
  Calendar,
  Home,
  UserCircle,
  Upload,
  MessageCircle,
  Share2,
  RotateCcw,
} from 'lucide-react';
import { downloadCsv, formatCurrency, openWhatsAppShare, parseCsv, printPdfUrl } from '../../lib/utils';
import { useNotification } from '../../context/NotificationContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';
import ReturnSaleModal from '../../components/ReturnSaleModal';

const formatSpecLabel = (value: string) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const IGNORED_ITEM_SPEC_KEYS = new Set([
  'sourced_item',
  'sourced_item_name',
  'sourced_vendor_name',
  'sourced_vendor_phone',
  'sourced_vendor_reference',
  'sourced_product_specs',
  'sourced_cost_price',
  'consignment_item',
  'consignment_item_id',
  'consignment_item_name',
  'vendor_name',
  'vendor_phone',
  'vendor_address',
  'imei_serial',
  'condition_matrix',
  '__condition_matrix',
]);

const flattenItemSpecEntries = (value: any, parentLabel = ''): Array<{ label: string; value: string }> => {
  if (value == null || value === '') return [];

  if (Array.isArray(value)) {
    const joined = value.map((entry) => String(entry ?? '').trim()).filter(Boolean).join(', ');
    return joined ? [{ label: parentLabel || 'Details', value: joined }] : [];
  }

  if (typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
      const normalizedKey = String(key || '').trim().toLowerCase();
      if (IGNORED_ITEM_SPEC_KEYS.has(normalizedKey) || normalizedKey.includes('condition_matrix')) {
        return [];
      }

      if ((normalizedKey === 'public_specs' || normalizedKey === 'specs' || normalizedKey === 'specs_at_sale')
        && nestedValue != null
        && typeof nestedValue === 'object'
      ) {
        return flattenItemSpecEntries(nestedValue, parentLabel);
      }

      const nextLabel = [parentLabel, formatSpecLabel(key)].filter(Boolean).join(' ');

      if (nestedValue != null && typeof nestedValue === 'object') {
        return flattenItemSpecEntries(nestedValue, nextLabel);
      }

      const normalizedValue = String(nestedValue ?? '').trim();
      return normalizedValue ? [{ label: nextLabel || formatSpecLabel(key), value: normalizedValue }] : [];
    });
  }

  const normalizedValue = String(value).trim();
  return normalizedValue ? [{ label: parentLabel || 'Details', value: normalizedValue }] : [];
};

const getItemSpecEntries = (item: any): Array<{ label: string; value: string }> => {
  const source = item?.specs_at_sale || item?.specs || {};
  if (!source || typeof source !== 'object') return [];

  return flattenItemSpecEntries(source)
    .filter((entry) => String(entry.value || '').trim() && String(entry.value) !== '[object Object]')
    .filter((entry) => entry.value);
};

const SALES_PAGE_SIZE = 50;

const formatInvoiceNumber = (value: string | number | null | undefined) => {
  const digits = String(value ?? '').replace(/\D+/g, '');
  if (!digits) return '000000';
  return digits.slice(-6).padStart(6, '0');
};

const toFreshPdfUrl = (pdfPath: string) => {
  const url = new URL(pdfPath, window.location.origin);
  url.searchParams.set('v', String(Date.now()));
  return url.toString();
};

const Reports: React.FC = () => {
  const location = useLocation();
  const { showNotification } = useNotification();
  const [sales, setSales] = useState<any[]>([]);
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesPage, setSalesPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedSale, setSelectedSale] = useState<any>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [showWhatsAppShareModal, setShowWhatsAppShareModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [whatsAppSharePhone, setWhatsAppSharePhone] = useState('');
  const importSalesRef = useRef<HTMLInputElement>(null);
  const deferredSearch = useDeferredValue(search.trim());

  useEffect(() => {
    setSalesPage(1);
  }, [deferredSearch]);

  useEffect(() => {
    void loadSales(salesPage, deferredSearch);
  }, [salesPage, deferredSearch]);

  const loadSales = async (page = salesPage, searchTerm = deferredSearch) => {
    try {
      setLoading(true);
      const query = new URLSearchParams({
        limit: String(SALES_PAGE_SIZE),
        offset: String((page - 1) * SALES_PAGE_SIZE),
      });

      if (searchTerm) {
        query.set('search', searchTerm);
      }

      const data = await appFetch(`/api/sales?${query.toString()}`);
      const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      const total = Array.isArray(data) ? items.length : Number(data?.total || 0);
      setSales(items);
      setSalesTotal(total);
    } catch (err) {
      console.error(err);
      setSales([]);
      setSalesTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const isInvoicesTab = location.pathname === '/invoices';

  const filteredSales = useMemo(() => {
    const term = deferredSearch.toLowerCase();
    const numericTerm = deferredSearch.replace(/\D+/g, '');
    if (!term) return sales;

    return sales.filter((sale) => {
      const invoiceNumber = formatInvoiceNumber(sale.id);
      return (
        sale.id.toString().includes(term) ||
        (numericTerm ? invoiceNumber.includes(numericTerm) : false) ||
        String(sale.status || '').toLowerCase().includes(term) ||
        String(sale.customer_name || '').toLowerCase().includes(term) ||
        String(sale.customer_phone || '').includes(deferredSearch)
      );
    });
  }, [sales, deferredSearch]);

  const showTableLoadingState = loading && sales.length === 0;
  const totalPages = Math.max(1, Math.ceil((salesTotal || 0) / SALES_PAGE_SIZE));
  const pageStart = salesTotal === 0 ? 0 : ((salesPage - 1) * SALES_PAGE_SIZE) + 1;
  const pageEnd = salesTotal === 0 ? 0 : Math.min(salesPage * SALES_PAGE_SIZE, salesTotal);

  const openPreview = async (sale: any) => {
    setLoadingInvoice(true);
    try {
      const invoice = await appFetch(`/api/sales/${sale.id}/details`);
      setSelectedSale(invoice);
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to load invoice details'), type: 'error' });
    } finally {
      setLoadingInvoice(false);
    }
  };

  const closePreview = () => {
    setSelectedSale(null);
    setLoadingInvoice(false);
    setShowReturnModal(false);
  };

  const openWhatsAppShareModal = (sale: any) => {
    if (!sale) return;
    setWhatsAppSharePhone(String(sale.customer_phone || ''));
    setShowWhatsAppShareModal(true);
  };

  const openReturnModal = async (sale: any) => {
    if (!sale) return;
    if (String(sale.status || '').toUpperCase() === 'VOIDED') {
      showNotification({ message: 'Voided sales cannot be returned again.', type: 'error' });
      return;
    }

    setLoadingInvoice(true);
    try {
      const invoice = sale?.items ? sale : await appFetch(`/api/sales/${sale.id}/details`);
      setSelectedSale(invoice);
      setShowReturnModal(true);
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to load return details'), type: 'error' });
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleReturnProcessed = async (payload?: any) => {
    const refreshedSaleId = Number(payload?.sale?.id || selectedSale?.id || 0);

    if (payload?.sale) {
      setSelectedSale(payload.sale);
    } else if (refreshedSaleId) {
      const invoice = await appFetch(`/api/sales/${refreshedSaleId}/details`);
      setSelectedSale(invoice);
    }

    await loadSales(salesPage, deferredSearch);
  };

  const ensureInvoicePdf = async (sale: any) => {
    if (!sale) {
      throw new Error('Invoice not found');
    }

    const invoice = sale?.items ? sale : await appFetch(`/api/sales/${sale.id}/details`);
    let pdfPath = '';
    let pdfFile: File | null = null;

    const [{ generateSalePDF }, store] = await Promise.all([
      import('../../lib/pdf'),
      appFetch('/api/store/settings'),
    ]);

    const { doc, filename } = await generateSalePDF(invoice, {
      ...store,
      receipt_paper_size: 'A4',
    });
    const pdfBlob = doc.output('blob');
    const pdfData = doc.output('datauristring');
    pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });

    try {
      const uploadResult = await appFetch(`/api/sales/${invoice.id}/pdf`, {
        method: 'POST',
        body: JSON.stringify({ pdf_data: pdfData, filename }),
      });

      pdfPath = String(uploadResult?.path || '').trim();
      if (pdfPath) {
        setSales((prev) => prev.map((entry) => (Number(entry.id) === Number(invoice.id) ? { ...entry, pdf_path: pdfPath } : entry)));
        setSelectedSale((prev: any) => (prev && Number(prev.id) === Number(invoice.id) ? { ...prev, pdf_path: pdfPath } : prev));
      }
    } catch (uploadError) {
      console.warn('Generated invoice PDF could not be saved. Continuing with a local file.', uploadError);
      pdfPath = String(invoice?.pdf_path || '').trim();
    }

    if (pdfPath) {
      return {
        invoice,
        pdfUrl: toFreshPdfUrl(pdfPath),
        pdfFile,
        isGeneratedLocally: false,
      };
    }

    const localUrl = URL.createObjectURL(pdfFile);
    return {
      invoice,
      pdfUrl: localUrl,
      pdfFile,
      isGeneratedLocally: true,
    };
  };

  const handleDownloadInvoicePdf = async (sale: any) => {
    if (!sale) return;

    try {
      const { invoice, pdfUrl, pdfFile, isGeneratedLocally } = await ensureInvoicePdf(sale);

      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = pdfFile?.name || `invoice-${invoice.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      if (isGeneratedLocally && pdfUrl.startsWith('blob:')) {
        window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
      }

      showNotification({ message: 'A4 invoice PDF downloaded successfully.', type: 'success' });
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to download invoice PDF'), type: 'error' });
    }
  };

  const handlePrintInvoicePdf = async (sale: any) => {
    if (!sale) return;

    try {
      const { pdfUrl, isGeneratedLocally } = await ensureInvoicePdf(sale);
      printPdfUrl(pdfUrl);

      if (isGeneratedLocally && pdfUrl.startsWith('blob:')) {
        window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
      }
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to print invoice PDF'), type: 'error' });
    }
  };

  const handleSharePdf = async (sale: any) => {
    if (!sale) return;

    try {
      const { invoice, pdfUrl, pdfFile, isGeneratedLocally } = await ensureInvoicePdf(sale);

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && pdfFile) {
        try {
          const canShareFiles = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [pdfFile] });
          if (canShareFiles) {
            await navigator.share({ files: [pdfFile] });
            showNotification({ message: 'Invoice PDF shared successfully', type: 'success' });
            if (isGeneratedLocally && pdfUrl.startsWith('blob:')) {
              window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
            }
            return;
          }
        } catch (shareErr) {
          console.warn('Native PDF share unavailable, using fallback:', shareErr);
        }
      }

      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = pdfFile?.name || `invoice-${invoice.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();

      if (isGeneratedLocally && pdfUrl.startsWith('blob:')) {
        window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
      }

      showNotification({ message: 'A4 invoice PDF downloaded as a single file for sharing.', type: 'success' });
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to share invoice PDF'), type: 'error' });
    }
  };

  const handleShareToWhatsApp = async (sale: any, targetPhone = whatsAppSharePhone) => {
    if (!sale) return;

    const ensured = await ensureInvoicePdf(sale).catch((error) => {
      console.warn('Could not attach a PDF link for WhatsApp sharing.', error);
      return null;
    });

    const invoice = ensured?.invoice || sale;

    const itemLines = Array.isArray(invoice.items)
      ? invoice.items.map((item: any, index: number) => {
          const itemName = String(item?.product_name || item?.name || `Item ${index + 1}`);
          const quantity = Number(item?.quantity || 0);
          const unitPrice = Number(item?.price_at_sale || 0);
          const lineTotal = Number(item?.subtotal ?? (unitPrice * quantity)) || 0;
          return `${index + 1}. ${itemName} — ${quantity} × ${formatCurrency(unitPrice)} = ${formatCurrency(lineTotal)}`;
        })
      : [];

    const paymentBreakdownLines = Object.entries(invoice.payment_methods || {})
      .filter(([, amount]) => Number(amount) > 0)
      .map(([method, amount]) => `${String(method).toUpperCase()}: ${formatCurrency(Number(amount) || 0)}`);

    openWhatsAppShare({
      phone: targetPhone,
      title: `${invoice.customer_name || 'Customer'}, here is your receipt from Goody POS.`,
      lines: [
        `Invoice: #${invoice.id}`,
        `Date: ${invoice.timestamp ? new Date(invoice.timestamp).toLocaleString() : '—'}`,
        `Cashier: ${invoice.user_username || 'Store Staff'}`,
        '',
        'Items:',
        ...itemLines,
        '',
        'Payment Breakdown:',
        ...(paymentBreakdownLines.length ? paymentBreakdownLines : ['No payment breakdown available']),
        '',
        `Subtotal: ${formatCurrency(Number(invoice.subtotal ?? invoice.total ?? 0))}`,
        `Tax: ${formatCurrency(Number(invoice.tax_amount || 0))}`,
        `Total: ${formatCurrency(Number(invoice.total || 0))}`,
      ],
    });

    if (ensured?.isGeneratedLocally && ensured.pdfUrl.startsWith('blob:')) {
      window.setTimeout(() => URL.revokeObjectURL(ensured.pdfUrl), 60000);
    }

    setShowWhatsAppShareModal(false);
  };

  const handleExportSales = async () => {
    try {
      const query = new URLSearchParams();
      if (deferredSearch) {
        query.set('search', deferredSearch);
      }

      const data = await appFetch(`/api/sales${query.toString() ? `?${query.toString()}` : ''}`);
      const exportSales = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
      const rows = exportSales.map((sale) => ({
        sale_id: sale.id,
        timestamp: sale.timestamp,
        status: sale.status,
        customer_name: sale.customer_name || 'Walk-in Customer',
        customer_phone: sale.customer_phone || '',
        customer_address: sale.customer_address || '',
        cashier: sale.user_username || 'System',
        subtotal: sale.subtotal || sale.total,
        tax_amount: sale.tax_amount || 0,
        tax_percentage: sale.tax_percentage || 0,
        total: sale.total || 0,
        payment_cash: sale.payment_methods?.cash || 0,
        payment_transfer: sale.payment_methods?.transfer || 0,
        payment_pos: sale.payment_methods?.pos || 0,
      }));

      downloadCsv(`sales-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      showNotification({ message: `Exported ${rows.length} sales records`, type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to export sales'), type: 'error' });
    }
  };

  const handleImportSales = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (!rows.length) {
        showNotification({ message: 'No sales rows were found in the selected CSV file.', type: 'warning' });
        return;
      }

      const result = await appFetch('/api/import/sales', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      });

      await loadSales();
      showNotification({ message: `Imported ${result.importedCount || rows.length} sales successfully`, type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err?.message || err || 'Failed to import sales'), type: 'error' });
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-3">
          <div className="inline-flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
            <Link
              to="/invoices"
              className={`rounded-xl px-3 py-2 text-sm font-bold transition-colors ${isInvoicesTab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Invoice Tab
            </Link>
            <Link
              to="/reports"
              className={`rounded-xl px-3 py-2 text-sm font-bold transition-colors ${!isInvoicesTab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
            >
              Reports Tab
            </Link>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{isInvoicesTab ? 'Invoice Center' : 'Sales History & Reports'}</h1>
            <p className="text-slate-500">{isInvoicesTab ? 'View, print, and share invoices instantly on WhatsApp.' : 'View and manage all store transactions and reports.'}</p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <input
            ref={importSalesRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleImportSales}
          />
          <Link to="/" className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
            <Home size={16} /> Home
          </Link>
          <button
            onClick={handleExportSales}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-300 transition-colors hover:bg-slate-50"
          >
            <Download size={16} /> Export CSV
          </button>
          <button
            onClick={() => importSalesRef.current?.click()}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-4 py-2 text-sm font-bold text-slate-300 transition-colors hover:bg-slate-200"
          >
            <Upload size={16} /> Import CSV
          </button>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-slate-400" size={16} />}
              <input
                type="text"
                placeholder={isInvoicesTab ? 'Search by invoice no. (e.g. 000120), customer or status...' : 'Search by ID, customer or status...'}
                className="pl-10 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </header>

      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-bold text-slate-600">
            Showing <span className="text-slate-900">{pageStart}-{pageEnd}</span> of <span className="text-slate-900">{salesTotal}</span> record(s)
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSalesPage(1)}
              disabled={salesPage === 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setSalesPage((prev) => Math.max(1, prev - 1))}
              disabled={salesPage === 1}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Prev
            </button>
            <span className="text-xs font-bold text-slate-500">Page {salesPage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setSalesPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={salesPage >= totalPages}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[720px] border-collapse text-left md:min-w-[860px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest">{isInvoicesTab ? 'Invoice No.' : 'Sale ID'}</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Date</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Customer</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Total</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Payment</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Status</th>
              <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {showTableLoadingState ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-500">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span>{isInvoicesTab ? 'Loading invoices...' : 'Loading sales...'}</span>
                  </div>
                </td>
              </tr>
            ) : (
              <>
                {filteredSales.map((sale) => (
                  <tr key={sale.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                    <td className="p-4 font-mono text-slate-900">
                      <div>
                        <p className="font-bold">#{isInvoicesTab ? formatInvoiceNumber(sale.id) : sale.id}</p>
                        {isInvoicesTab && <p className="text-[11px] font-semibold text-slate-500">Sale ID {sale.id}</p>}
                      </div>
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} />
                        {new Date(sale.timestamp).toLocaleString()}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2 text-sm text-slate-300">
                        <UserCircle size={16} className="text-slate-400" />
                        <div>
                          <p className="font-semibold text-slate-900">{sale.customer_name || 'Walk-in Customer'}</p>
                          <p className="text-xs text-slate-500">{sale.customer_phone || 'No phone attached'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="font-bold text-slate-900">{formatCurrency(sale.total)}</p>
                      {Number(sale.discount_amount || 0) > 0 && (
                        <p className="mt-1 text-xs font-semibold text-emerald-400">
                          Discount {formatCurrency(Number(sale.discount_amount || 0))}{sale.discount_note ? ` • ${sale.discount_note}` : ''}
                        </p>
                      )}
                      {Number(sale.returned_amount || 0) > 0 && (
                        <p className="mt-1 text-xs font-semibold text-amber-400">
                          Returned {formatCurrency(Number(sale.returned_amount || 0))} · Net {formatCurrency(Number(sale.net_total || sale.total || 0))}
                        </p>
                      )}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(sale.payment_methods || {}).map(([method, amount]: any) => amount > 0 && (
                          <span key={method} className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-bold uppercase text-slate-500">
                            {method}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                          sale.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                          sale.status === 'PENDING' ? 'bg-amber-100 text-amber-400' : 'bg-red-100 text-red-700'
                        }`}>
                          {sale.status}
                        </span>
                        {String(sale.return_status || 'NONE') !== 'NONE' && (
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${sale.return_status === 'FULL' ? 'bg-rose-100 text-rose-400' : 'bg-indigo-100 text-indigo-400'}`}>
                            {sale.return_status === 'FULL' ? 'Full Return' : 'Partial Return'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        {sale.status !== 'VOIDED' && (
                          <button
                            onClick={() => openReturnModal(sale)}
                            className="p-2 text-amber-600 hover:text-amber-400 hover:bg-amber-900/20 rounded-lg transition-all"
                            title="Process return / refund"
                          >
                            <RotateCcw size={18} />
                          </button>
                        )}
                        <button
                          onClick={() => handleSharePdf(sale)}
                          className="p-2 text-indigo-600 hover:text-indigo-400 hover:bg-indigo-900/20 rounded-lg transition-all"
                          title="Share as PDF"
                        >
                          <Share2 size={18} />
                        </button>
                        <button
                          onClick={() => openPreview(sale)}
                          className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                          title="View Invoice"
                        >
                          <FileText size={20} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      {isInvoicesTab ? 'No invoices match your current search.' : 'No sales match your current search.'}
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
          </table>
        </div>
      </div>

      <WhatsAppShareModal
        isOpen={showWhatsAppShareModal && Boolean(selectedSale)}
        phone={whatsAppSharePhone}
        recipientName={selectedSale?.customer_name || 'customer'}
        onPhoneChange={setWhatsAppSharePhone}
        onClose={() => setShowWhatsAppShareModal(false)}
        onShare={() => handleShareToWhatsApp(selectedSale, whatsAppSharePhone)}
      />

      <ReturnSaleModal
        isOpen={showReturnModal && Boolean(selectedSale)}
        sale={selectedSale}
        onClose={() => setShowReturnModal(false)}
        onSuccess={handleReturnProcessed}
      />

      {/* Side panel backdrop */}
      {(selectedSale || loadingInvoice) && (
        <div
          className="fixed inset-0 bg-slate-900/30 z-[90]"
          onClick={closePreview}
        />
      )}

      {/* Side panel */}
      <div className={`fixed inset-y-0 right-0 z-[100] flex w-full max-w-[560px] flex-col bg-white shadow-2xl transition-transform duration-300 ease-in-out ${(selectedSale || loadingInvoice) ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Invoice Details</h2>
              <p className="text-xs text-slate-500">
                {selectedSale ? `#${formatInvoiceNumber(selectedSale.id)} · ${new Date(selectedSale.timestamp).toLocaleString()}` : 'Loading...'}
              </p>
            </div>
            <button
              onClick={closePreview}
              className="ml-2 rounded-xl p-2 text-slate-400 transition-all hover:bg-slate-100 hover:text-slate-900"
            >
              <X size={20} />
            </button>
          </div>

          {selectedSale && (
            <div className="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              {selectedSale.status !== 'VOIDED' && (
                <button
                  onClick={() => openReturnModal(selectedSale)}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-900/200 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 transition-colors"
                >
                  <RotateCcw size={13} /> Return
                </button>
              )}
              <button
                onClick={() => handleSharePdf(selectedSale)}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 transition-colors"
              >
                <Share2 size={13} /> Share PDF
              </button>
              <button
                onClick={() => openWhatsAppShareModal(selectedSale)}
                className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 transition-colors"
              >
                <MessageCircle size={13} /> WhatsApp
              </button>
              {selectedSale?.pdf_path && (
                <>
                  <button
                    onClick={() => handleDownloadInvoicePdf(selectedSale)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-100 transition-colors"
                  >
                    <Download size={13} /> A4 PDF
                  </button>
                  <button
                    onClick={() => handlePrintInvoicePdf(selectedSale)}
                    className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 transition-colors"
                  >
                    <Printer size={13} /> Print
                  </button>
                </>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
          {loadingInvoice && !selectedSale ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-slate-400" size={24} />
            </div>
          ) : selectedSale ? (
            <div className="space-y-4">
                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Customer</p>
                        <p className="font-bold text-slate-900">{selectedSale.customer_name || 'Walk-in Customer'}</p>
                        <p className="text-sm text-slate-500">{selectedSale.customer_phone || 'No phone attached'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Cashier</p>
                        <p className="font-bold text-slate-900">{selectedSale.user_username || 'System'}</p>
                        <p className="text-sm text-slate-500">{selectedSale.customer_address || 'No customer address'}</p>
                        {selectedSale.discount_note && (
                          <p className="mt-2 inline-flex rounded-full border border-emerald-700/30 bg-emerald-900/20 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                            Promo: {selectedSale.discount_note}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">Status</p>
                        <div className="flex flex-wrap gap-2">
                          <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                            selectedSale.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                            selectedSale.status === 'PENDING' ? 'bg-amber-100 text-amber-400' : 'bg-red-100 text-red-700'
                          }`}>
                            {selectedSale.status}
                          </span>
                          {String(selectedSale.return_status || 'NONE') !== 'NONE' && (
                            <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${selectedSale.return_status === 'FULL' ? 'bg-rose-100 text-rose-400' : 'bg-indigo-100 text-indigo-400'}`}>
                              {selectedSale.return_status === 'FULL' ? 'Full Return' : 'Partial Return'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-slate-100">
                    <div className="p-5 border-b border-slate-100">
                      <h3 className="font-bold text-slate-900">Items Purchased</h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {(selectedSale.items || []).map((item: any) => {
                        const specEntries = getItemSpecEntries(item);

                        return (
                          <div key={`${selectedSale.id}-${item.id}`} className="p-4 flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900">{item.product_name || item.name || 'Product'}</p>
                              <p className="text-sm text-slate-500">
                                {item.quantity} × {formatCurrency(item.price_at_sale)}
                              </p>

                              {(specEntries.length > 0 || item.condition || item.imei_serial || Number(item.returned_quantity || 0) > 0 || Number(item.returnable_quantity || 0) > 0) && (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {specEntries.map((spec) => (
                                    <span
                                      key={`${selectedSale.id}-${item.id}-${spec.label}`}
                                      className="rounded-full border border-indigo-700/30 bg-indigo-900/20 px-2.5 py-1 text-[11px] font-medium text-indigo-400"
                                    >
                                      <span className="font-bold">{spec.label}:</span> {spec.value}
                                    </span>
                                  ))}
                                  {item.condition && (
                                    <span className="rounded-full border border-amber-700/30 bg-amber-900/20 px-2.5 py-1 text-[11px] font-medium text-amber-400">
                                      <span className="font-bold">Condition:</span> {String(item.condition).replace(/_/g, ' ')}
                                    </span>
                                  )}
                                  {Number(item.returned_quantity || 0) > 0 && (
                                    <span className="rounded-full border border-rose-700/30 bg-rose-900/20 px-2.5 py-1 text-[11px] font-medium text-rose-400">
                                      <span className="font-bold">Returned:</span> {item.returned_quantity}
                                    </span>
                                  )}
                                  {Number(item.returnable_quantity || 0) > 0 && (
                                    <span className="rounded-full border border-emerald-700/30 bg-emerald-900/20 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                                      <span className="font-bold">Returnable:</span> {item.returnable_quantity}
                                    </span>
                                  )}
                                  {item.imei_serial && (
                                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                                      <span className="font-bold">IMEI/Serial:</span> {item.imei_serial}
                                    </span>
                                  )}
                                  {Number(item.price_markup || 0) > 0 && (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-900/20 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                                      <span className="font-bold">Price Markup:</span> +{formatCurrency(Number(item.price_markup || 0))} per unit ({formatCurrency(Number(item.base_price_at_sale || item.price_at_sale || 0))} → {formatCurrency(Number(item.price_at_sale || 0))})
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                            <p className="font-bold text-slate-900">{formatCurrency(item.subtotal)}</p>
                          </div>
                        );
                      })}
                      {(selectedSale.items || []).length === 0 && (
                        <div className="p-6 text-sm text-slate-500">No line items found for this sale.</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Net Sale Value</p>
                        <p className="mt-2 text-xl font-black text-slate-900">{formatCurrency(Number(selectedSale.net_total || selectedSale.total || 0))}</p>
                      </div>
                      <div className="rounded-2xl border border-amber-700/30 bg-amber-900/20 p-4">
                        <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">Returned Value</p>
                        <p className="mt-2 text-xl font-black text-amber-300">{formatCurrency(Number(selectedSale.returned_amount || 0))}</p>
                      </div>
                      <div className="rounded-2xl border border-emerald-700/30 bg-emerald-900/20 p-4">
                        <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">Refunded</p>
                        <p className="mt-2 text-xl font-black text-emerald-300">{formatCurrency(Number(selectedSale.refunded_amount || 0))}</p>
                      </div>
                      <div className="rounded-2xl border border-indigo-700/30 bg-indigo-900/20 p-4">
                        <p className="text-[11px] font-black uppercase tracking-widest text-indigo-400">Credit Balance</p>
                        <p className="mt-2 text-xl font-black text-indigo-300">{formatCurrency(Number(selectedSale.credit_balance || 0))}</p>
                      </div>
                      {(() => {
                        const totalMarkup = (selectedSale.items || []).reduce((sum: number, it: any) => {
                          const markup = Number(it.price_markup || 0);
                          const qty = Math.max(1, Number(it.quantity || 1));
                          return sum + (markup > 0 ? markup * qty : 0);
                        }, 0);
                        return totalMarkup > 0 ? (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-900/20 p-4 md:col-span-4">
                            <p className="text-[11px] font-black uppercase tracking-widest text-emerald-400">Price Markup (Extra Profit)</p>
                            <p className="mt-2 text-xl font-black text-emerald-300">{formatCurrency(totalMarkup)}</p>
                            <p className="mt-1 text-[11px] text-emerald-600">Staff sold items above base price — extra revenue captured for the shop.</p>
                          </div>
                        ) : null;
                      })()}
                    </div>

                    {Array.isArray(selectedSale.returns) && selectedSale.returns.length > 0 && (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">Return Activity</p>
                        <div className="mt-3 space-y-2">
                          {selectedSale.returns.map((entry: any) => (
                            <div key={entry.id} className="rounded-2xl border border-slate-100 bg-white px-3 py-3 text-sm text-slate-300">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-bold text-slate-900">Return #{entry.id} · {String(entry.return_type || 'REFUND').replace(/_/g, ' ')}</p>
                                <span className="font-black text-slate-900">{formatCurrency(Number(entry.returned_value || 0))}</span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">Refunded {formatCurrency(Number(entry.refund_amount || 0))} via {String(entry.refund_method || 'cash').replace(/_/g, ' ')} · {new Date(entry.created_at).toLocaleString()}</p>
                              <p className="mt-2">{entry.reason}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Payment Breakdown</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(selectedSale.payment_methods || {}).map(([method, amount]: any) => amount > 0 && (
                            <span key={method} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-300">
                              {method}: {formatCurrency(amount)}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between text-slate-600">
                          <span>Subtotal</span>
                          <span className="font-semibold">{formatCurrency(selectedSale.subtotal || selectedSale.total)}</span>
                        </div>
                        {Number(selectedSale.discount_amount || 0) > 0 && (
                          <div className="flex justify-between text-emerald-400">
                            <span>Discount</span>
                            <span className="font-semibold">-{formatCurrency(selectedSale.discount_amount || 0)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-slate-600">
                          <span>Tax</span>
                          <span className="font-semibold">{formatCurrency(selectedSale.tax_amount || 0)}</span>
                        </div>
                        <div className="mt-2 flex justify-between rounded-2xl border border-amber-200 bg-amber-900/20 px-4 py-3 text-base font-black text-amber-300 shadow-sm">
                          <span>Total</span>
                          <span>{formatCurrency(selectedSale.total)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
            </div>
          ) : null}
          </div>
      </div>
    </div>
  );
};

export default Reports;

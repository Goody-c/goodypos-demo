import React, { useState, useEffect } from 'react';
import { appFetch } from '../../lib/api';
import { FileText, Eye, CheckCircle, Trash2, Plus, AlertCircle, MessageCircle, Share2 } from 'lucide-react';
import { formatCurrency, normalizeLogoDataUrl, openWhatsAppShare } from '../../lib/utils';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../../context/NotificationContext';
import WhatsAppShareModal from '../../components/WhatsAppShareModal';

const Proformas: React.FC = () => {
  const { showNotification } = useNotification();
  const [proformas, setProformas] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<any>(null);
  const [selectedProforma, setSelectedProforma] = useState<any>(null);
  const [showWhatsAppShareModal, setShowWhatsAppShareModal] = useState(false);
  const [whatsAppSharePhone, setWhatsAppSharePhone] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [proformasData, storeData] = await Promise.all([
        appFetch('/api/pro-formas'),
        appFetch('/api/store/settings')
      ]);
      const normalizedLogo = await normalizeLogoDataUrl(storeData?.logo);
      setProformas(proformasData);
      setStore({ ...storeData, logo: normalizedLogo || storeData?.logo || null });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const prepareProformaPdf = async (proforma: any) => {
    const { generateProformaPDF } = await import('../../lib/pdf');
    const { doc, filename } = await generateProformaPDF(proforma, {
      ...store,
      receipt_paper_size: 'A4',
    });

    const pdfBlob = doc.output('blob');
    const pdfFile = new File([pdfBlob], filename, { type: 'application/pdf' });
    const pdfUrl = URL.createObjectURL(pdfFile);

    return { pdfFile, pdfUrl };
  };

  const handleShareProformaPdf = async (proforma: any) => {
    try {
      const { pdfFile, pdfUrl } = await prepareProformaPdf(proforma);

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        try {
          const canShareFiles = typeof navigator.canShare !== 'function' || navigator.canShare({ files: [pdfFile] });
          if (canShareFiles) {
            await navigator.share({ files: [pdfFile] });
            showNotification({ message: 'A4 pro-forma PDF shared successfully', type: 'success' });
            window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
            return;
          }
        } catch (shareErr) {
          console.warn('Native PDF share unavailable, using download fallback:', shareErr);
        }
      }

      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = pdfFile.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60000);
      showNotification({ message: 'A4 pro-forma PDF downloaded for sharing', type: 'success' });
    } catch (err: any) {
      console.error(err);
      showNotification({ message: String(err?.message || err || 'Failed to share pro-forma PDF'), type: 'error' });
    }
  };

  const handlePrint = async (proforma: any) => {
    const { generateProformaPDF } = await import('../../lib/pdf');
    const { doc, filename } = await generateProformaPDF(proforma, {
      ...store,
      receipt_paper_size: 'A4',
    });
    doc.save(filename);
  };

  const openProformaWhatsAppShare = (proforma: any) => {
    if (!proforma) return;
    setSelectedProforma(proforma);
    setWhatsAppSharePhone(String(proforma.customer_phone || ''));
    setShowWhatsAppShareModal(true);
  };

  const handleShareProformaToWhatsApp = (targetPhone = whatsAppSharePhone) => {
    if (!selectedProforma) return;

    const itemLines = Array.isArray(selectedProforma.items)
      ? selectedProforma.items.map((item: any, index: number) => {
          const itemName = String(item?.name || item?.product_name || `Item ${index + 1}`);
          const quantity = Number(item?.quantity || 0);
          const unitPrice = Number(item?.price_at_sale ?? item?.price ?? 0);
          const lineTotal = Number(item?.subtotal ?? (unitPrice * quantity)) || 0;
          const specs = item?.specs_at_sale || item?.specs || {};
          const specLine = Object.entries(specs)
            .map(([key, value]) => `${String(key).replace(/_/g, ' ')}: ${String(value ?? '').trim()}`)
            .filter((entry) => !entry.endsWith(':'))
            .join(', ');

          return [
            `${index + 1}. ${itemName} — ${quantity} × ${formatCurrency(unitPrice)} = ${formatCurrency(lineTotal)}`,
            specLine ? `   Specs: ${specLine}` : '',
            item?.condition ? `   Condition: ${String(item.condition).replace(/_/g, ' ')}` : '',
            item?.imei_serial ? `   IMEI/Serial: ${item.imei_serial}` : '',
          ].filter(Boolean).join('\n');
        })
      : [];

    const paymentInfo = store?.receipt_show_bank_details === false || store?.receipt_show_bank_details === 0
      ? ['Payment details available on request.']
      : [
          `Bank: ${store?.bank_name || 'Not configured'}`,
          `Account No: ${store?.account_number || 'Not configured'}`,
          `Account Name: ${store?.account_name || store?.name || 'Not configured'}`,
        ];

    openWhatsAppShare({
      phone: targetPhone,
      title: `${selectedProforma.customer_name || 'Customer'}, here is your pro-forma invoice from ${store?.name || 'Goody POS'}.`,
      lines: [
        `Pro-forma No: PRO-${new Date(selectedProforma.created_at).getFullYear()}-${String(selectedProforma.id).padStart(3, '0')}`,
        `Date: ${selectedProforma.created_at ? new Date(selectedProforma.created_at).toLocaleString() : '—'}`,
        `Valid Until: ${selectedProforma.expiry_date ? new Date(selectedProforma.expiry_date).toLocaleString() : '—'}`,
        '',
        'Items:',
        ...(itemLines.length ? itemLines : ['No line items available']),
        '',
        'Payment Details:',
        ...paymentInfo,
        '',
        `Subtotal: ${formatCurrency(Number(selectedProforma.subtotal ?? selectedProforma.total ?? 0))}`,
        `Tax: ${formatCurrency(Number(selectedProforma.tax_amount || 0))}`,
        `Total: ${formatCurrency(Number(selectedProforma.total || 0))}`,
      ],
    });

    setShowWhatsAppShareModal(false);
  };

  const handleConvertToSale = async (proforma: any) => {
    // Navigate with the proforma data to prefill POS.
    navigate('/pos', { state: { loadProforma: proforma } });
  };

  const handleCancel = async (id: number) => {
    try {
      await appFetch(`/api/pro-formas/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CANCELLED' })
      });
      loadData();
      showNotification({ message: 'Pro-forma has been cancelled and stock released', type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err.message), type: 'error' });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await appFetch(`/api/pro-formas/${id}`, {
        method: 'DELETE'
      });
      loadData();
      showNotification({ message: 'Pro-forma deleted successfully', type: 'success' });
    } catch (err: any) {
      showNotification({ message: String(err.message), type: 'error' });
    }
  };

  if (loading) return <div className="p-8">Loading...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black text-slate-900 flex items-center gap-3">
            <FileText className="text-indigo-600" size={32} />
            Pro-forma Hub
          </h1>
          <p className="text-slate-500 mt-1">Manage quotations and stock reservations</p>
        </div>
        <button 
          onClick={() => navigate('/pos')}
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
        >
          <Plus size={20} /> New Pro-forma
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-widest">
                <th className="p-4 font-bold">Invoice #</th>
                <th className="p-4 font-bold">Customer</th>
                <th className="p-4 font-bold">Date Created</th>
                <th className="p-4 font-bold">Expiry Date</th>
                <th className="p-4 font-bold text-right">Total Amount</th>
                <th className="p-4 font-bold text-center">Status</th>
                <th className="p-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {proformas.map((p: any) => {
                const isExpired = new Date(p.expiry_date) < new Date() && p.status === 'PENDING';
                const displayStatus = isExpired ? 'EXPIRED' : p.status;
                
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-mono text-sm font-bold text-slate-300">
                      PRO-{new Date(p.created_at).getFullYear()}-{p.id.toString().padStart(3, '0')}
                    </td>
                    <td className="p-4 font-bold text-slate-900">
                      {p.customer_name || 'Walk-in Customer'}
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      {new Date(p.created_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      <span className={isExpired ? 'text-red-500 font-bold' : ''}>
                        {new Date(p.expiry_date).toLocaleString()}
                      </span>
                    </td>
                    <td className="p-4 text-right font-bold text-slate-900">
                      {formatCurrency(p.total)}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        displayStatus === 'PENDING' ? 'bg-amber-100 text-amber-400' :
                        displayStatus === 'CONVERTED' ? 'bg-emerald-100 text-emerald-400' :
                        displayStatus === 'EXPIRED' ? 'bg-red-100 text-red-700' :
                        'bg-slate-100 text-slate-300'
                      }`}>
                        {displayStatus}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => handleShareProformaPdf(p)}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-900/20 rounded-lg transition-colors"
                          title="Share A4 PDF"
                        >
                          <Share2 size={18} />
                        </button>
                        <button 
                          onClick={() => openProformaWhatsAppShare(p)}
                          className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          title="Share on WhatsApp"
                        >
                          <MessageCircle size={18} />
                        </button>
                        <button 
                          onClick={() => handlePrint(p)}
                          className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-900/20 rounded-lg transition-colors"
                          title="View / Print PDF"
                        >
                          <Eye size={18} />
                        </button>
                        
                        {displayStatus === 'PENDING' && (
                          <>
                            <button 
                              onClick={() => handleConvertToSale(p)}
                              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-900/20 rounded-lg transition-colors"
                              title="Convert to Sale"
                            >
                              <CheckCircle size={18} />
                            </button>
                            <button 
                              onClick={() => handleCancel(p.id)}
                              className="p-2 text-slate-400 hover:text-amber-600 hover:bg-amber-900/20 rounded-lg transition-colors"
                              title="Cancel Reservation"
                            >
                              <AlertCircle size={18} />
                            </button>
                          </>
                        )}
                        
                        <button 
                          onClick={() => handleDelete(p.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete Permanently"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {proformas.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500">
                    No pro-forma invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <WhatsAppShareModal
        isOpen={showWhatsAppShareModal && Boolean(selectedProforma)}
        phone={whatsAppSharePhone}
        recipientName={selectedProforma?.customer_name || 'customer'}
        onPhoneChange={setWhatsAppSharePhone}
        onClose={() => setShowWhatsAppShareModal(false)}
        onShare={() => handleShareProformaToWhatsApp(whatsAppSharePhone)}
      />
    </div>
  );
};

export default Proformas;

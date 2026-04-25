import React from 'react';
import { MessageCircle, X } from 'lucide-react';

type WhatsAppShareModalProps = {
  isOpen: boolean;
  phone: string;
  recipientName?: string;
  title?: string;
  description?: string;
  infoText?: string;
  buttonLabel?: string;
  onPhoneChange: (value: string) => void;
  onClose: () => void;
  onShare: () => void;
};

const WhatsAppShareModal: React.FC<WhatsAppShareModalProps> = ({
  isOpen,
  phone,
  recipientName,
  title = 'Share on WhatsApp',
  description,
  infoText = 'The full receipt summary, item list, cashier name, payment breakdown, and PDF link will be included.',
  buttonLabel = 'Share Now',
  onPhoneChange,
  onClose,
  onShare,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 inline-flex rounded-2xl bg-green-100 p-3 text-green-700">
              <MessageCircle size={20} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            <p className="text-sm text-slate-500">
              {description || `Send this receipt to ${recipientName || 'a customer'} or any other WhatsApp number.`}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-bold text-slate-700">WhatsApp number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              placeholder="e.g. 08012345678 or +2348012345678"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition focus:ring-2 focus:ring-green-600"
            />
            <p className="mt-2 text-xs text-slate-500">
              Leave this blank to choose a contact directly inside WhatsApp.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            {infoText}
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onShare}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-green-700"
          >
            <MessageCircle size={16} /> {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppShareModal;

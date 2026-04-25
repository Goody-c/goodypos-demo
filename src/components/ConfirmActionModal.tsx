import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';

type ConfirmActionModalProps = {
  isOpen: boolean;
  title: string;
  description: string;
  details?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning' | 'success';
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

const toneStyles = {
  danger: {
    iconWrap: 'border border-red-200 bg-red-50 text-red-600',
    confirmButton: 'bg-red-600 text-white hover:bg-red-700',
  },
  warning: {
    iconWrap: 'border border-amber-200 bg-amber-900/20 text-amber-600',
    confirmButton: 'bg-amber-900/200 text-slate-950 hover:bg-amber-400',
  },
  success: {
    iconWrap: 'border border-emerald-200 bg-emerald-900/20 text-emerald-600',
    confirmButton: 'bg-emerald-600 text-white hover:bg-emerald-700',
  },
} as const;

const ConfirmActionModal: React.FC<ConfirmActionModalProps> = ({
  isOpen,
  title,
  description,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'warning',
  loading = false,
  onClose,
  onConfirm,
}) => {
  if (!isOpen) return null;

  const styles = toneStyles[tone];
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm">
      <div className="w-[calc(100%-1.5rem)] max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`rounded-2xl p-3 ${styles.iconWrap}`}>
              <Icon size={28} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900">{title}</h2>
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {details && <div className="mb-5">{details}</div>}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`flex flex-1 items-center justify-center gap-2 rounded-2xl px-4 py-3 font-bold transition-colors disabled:opacity-50 ${styles.confirmButton}`}
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Icon size={18} />}
            {loading ? 'Please wait...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmActionModal;

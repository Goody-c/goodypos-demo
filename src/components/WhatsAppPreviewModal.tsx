import React, { useState } from 'react';
import { MessageCircle, X, Image } from 'lucide-react';

type WhatsAppPreviewModalProps = {
  isOpen: boolean;
  title?: string;
  lines: string[];
  onClose: () => void;
  onSend: () => void;
  sendingLabel?: string;
  storeName?: string;
};

const buildShareImage = (title: string, lines: string[], storeName?: string): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const DPR = 2; // retina
    const W = 680;
    const filteredLines = lines.filter(Boolean);

    // --- Layout constants ---
    const OUTER_PAD = 36;
    const HEADER_H = 88;
    const CARD_RADIUS = 20;
    const LINE_H = 30;
    const BODY_TOP_PAD = 28;
    const BODY_BOT_PAD = 32;
    const FOOTER_H = 52;
    const DIVIDER_LINES = filteredLines.reduce<number[]>((acc, l, i) => l === '---' ? [...acc, i] : acc, []);

    const bodyH = BODY_TOP_PAD + filteredLines.length * LINE_H + BODY_BOT_PAD;
    const H = HEADER_H + bodyH + FOOTER_H + OUTER_PAD * 2;

    const canvas = document.createElement('canvas');
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('Canvas not supported')); return; }
    ctx.scale(DPR, DPR);

    const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    };

    // ── Outer background ──
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle dot-grid texture
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    for (let gx = 0; gx < W; gx += 22) {
      for (let gy = 0; gy < H; gy += 22) {
        ctx.beginPath();
        ctx.arc(gx, gy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Card ──
    const cardX = OUTER_PAD;
    const cardY = OUTER_PAD;
    const cardW = W - OUTER_PAD * 2;
    const cardH = H - OUTER_PAD * 2;

    // Card shadow
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 8;
    roundRect(cardX, cardY, cardW, cardH, CARD_RADIUS);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // ── Header gradient strip ──
    const hdrGrad = ctx.createLinearGradient(cardX, 0, cardX + cardW, 0);
    hdrGrad.addColorStop(0, '#1a5c38');
    hdrGrad.addColorStop(0.5, '#25D366');
    hdrGrad.addColorStop(1, '#128C7E');
    ctx.fillStyle = hdrGrad;
    ctx.beginPath();
    ctx.moveTo(cardX + CARD_RADIUS, cardY);
    ctx.lineTo(cardX + cardW - CARD_RADIUS, cardY);
    ctx.quadraticCurveTo(cardX + cardW, cardY, cardX + cardW, cardY + CARD_RADIUS);
    ctx.lineTo(cardX + cardW, cardY + HEADER_H);
    ctx.lineTo(cardX, cardY + HEADER_H);
    ctx.lineTo(cardX, cardY + CARD_RADIUS);
    ctx.quadraticCurveTo(cardX, cardY, cardX + CARD_RADIUS, cardY);
    ctx.closePath();
    ctx.fill();

    // WhatsApp icon circle
    const iconCx = cardX + 36;
    const iconCy = cardY + HEADER_H / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.arc(iconCx, iconCy, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✉', iconCx, iconCy + 1);

    // Header title
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = `600 11px sans-serif`;
    if (storeName) {
      ctx.fillText(storeName.toUpperCase() + '  •  VENDOR PORTAL', cardX + 68, cardY + 32);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 22px sans-serif`;
    ctx.fillText(title, cardX + 68, cardY + 60);

    // ── Body ──
    const bodyStartY = cardY + HEADER_H + BODY_TOP_PAD;
    const textX = cardX + 28;
    const maxTextW = cardW - 56;

    filteredLines.forEach((line, i) => {
      const y = bodyStartY + i * LINE_H;

      if (line === '---') {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(textX, y + LINE_H / 2);
        ctx.lineTo(textX + maxTextW, y + LINE_H / 2);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      // Detect label: value pattern
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0 && colonIdx < 30 && !line.startsWith('Please') && !line.match(/^\d+\./)) {
        const label = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();

        ctx.fillStyle = '#64748b';
        ctx.font = `600 12.5px sans-serif`;
        ctx.fillText(label + ':', textX, y + 20);

        const labelW = ctx.measureText(label + ':  ').width;
        ctx.fillStyle = '#0f172a';
        ctx.font = `500 13px sans-serif`;
        // Truncate if too wide
        let displayValue = value;
        while (ctx.measureText(displayValue).width > maxTextW - labelW && displayValue.length > 6) {
          displayValue = displayValue.slice(0, -4) + '…';
        }
        ctx.fillText(displayValue, textX + labelW, y + 20);
      } else if (line.match(/^\d+\./)) {
        // Numbered list item — highlight number
        const dotIdx = line.indexOf('.');
        const num = line.slice(0, dotIdx + 1);
        const rest = line.slice(dotIdx + 1).trim();

        ctx.fillStyle = '#25D366';
        ctx.font = `bold 13px sans-serif`;
        ctx.fillText(num, textX, y + 20);
        const numW = ctx.measureText(num + '  ').width;

        ctx.fillStyle = '#1e293b';
        ctx.font = `500 13px sans-serif`;
        let displayRest = rest;
        while (ctx.measureText(displayRest).width > maxTextW - numW && displayRest.length > 6) {
          displayRest = displayRest.slice(0, -4) + '…';
        }
        ctx.fillText(displayRest, textX + numW, y + 20);
      } else {
        // Plain line
        ctx.fillStyle = '#334155';
        ctx.font = `500 13px sans-serif`;
        let display = line;
        while (ctx.measureText(display).width > maxTextW && display.length > 6) {
          display = display.slice(0, -4) + '…';
        }
        ctx.fillText(display, textX, y + 20);
      }
    });

    // ── Footer ──
    const footerY = cardY + cardH - FOOTER_H;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(cardX, footerY);
    ctx.lineTo(cardX + cardW, footerY);
    ctx.lineTo(cardX + cardW, footerY + FOOTER_H - CARD_RADIUS);
    ctx.quadraticCurveTo(cardX + cardW, footerY + FOOTER_H, cardX + cardW - CARD_RADIUS, footerY + FOOTER_H);
    ctx.lineTo(cardX + CARD_RADIUS, footerY + FOOTER_H);
    ctx.quadraticCurveTo(cardX, footerY + FOOTER_H, cardX, footerY + FOOTER_H - CARD_RADIUS);
    ctx.lineTo(cardX, footerY);
    ctx.closePath();
    ctx.fill();

    // Footer divider
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cardX, footerY);
    ctx.lineTo(cardX + cardW, footerY);
    ctx.stroke();

    // Footer text
    ctx.fillStyle = '#94a3b8';
    ctx.font = `500 11px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText((storeName || '') + (storeName ? '  •  ' : '') + new Date().toLocaleDateString(), cardX + cardW / 2, footerY + 31);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate image'));
    }, 'image/png');
  });
};

const WhatsAppPreviewModal: React.FC<WhatsAppPreviewModalProps> = ({
  isOpen,
  title = 'Acknowledgement',
  lines,
  onClose,
  onSend,
  sendingLabel = 'Send to WhatsApp',
  storeName,
}) => {
  const [sharingImage, setSharingImage] = useState(false);

  if (!isOpen) return null;

  const handleShareAsImage = async () => {
    setSharingImage(true);
    try {
      const blob = await buildShareImage(title, lines, storeName);
      const file = new File([blob], `${title.replace(/\s+/g, '-')}.png`, { type: 'image/png' });

      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        // Fallback: download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // User cancelled or share failed — silently ignore
    } finally {
      setSharingImage(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">WhatsApp Preview</p>
            <h3 className="text-lg font-black text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close WhatsApp preview"
          >
            <X size={18} />
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <pre className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">{lines.filter(Boolean).join('\n')}</pre>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleShareAsImage}
            disabled={sharingImage}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-black uppercase tracking-wider text-slate-700 hover:bg-slate-200 disabled:opacity-50"
          >
            <Image size={14} /> {sharingImage ? 'Preparing…' : 'Share as Image'}
          </button>
          <button
            type="button"
            onClick={onSend}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl bg-green-600 px-3 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-green-700"
          >
            <MessageCircle size={14} /> {sendingLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppPreviewModal;

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getCurrencyConfig, readCurrencyPreference } from './currency';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, options?: { currencyCode?: string }) {
  const numericAmount = Number(amount) || 0;
  const absoluteAmount = Math.abs(numericAmount);
  const preferredCurrency = options?.currencyCode
    ? getCurrencyConfig(options.currencyCode)
    : readCurrencyPreference();

  try {
    return new Intl.NumberFormat(preferredCurrency.locale, {
      style: 'currency',
      currency: preferredCurrency.code,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: Number.isInteger(absoluteAmount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(numericAmount).replace(/\s(?=\d)/, '\u00A0');
  } catch {
    const formatted = absoluteAmount.toLocaleString(preferredCurrency.locale || 'en-US', {
      minimumFractionDigits: Number.isInteger(absoluteAmount) ? 0 : 2,
      maximumFractionDigits: 2,
    });
    return `${numericAmount < 0 ? '-' : ''}${preferredCurrency.symbol}\u00A0${formatted}`;
  }
}

export async function normalizeImageDataUrl(
  imageValue: unknown,
  options?: {
    maxWidth?: number;
    maxHeight?: number;
    mimeType?: 'image/png' | 'image/jpeg';
    quality?: number;
  }
): Promise<string | null> {
  const src = String(imageValue ?? '').trim();
  if (!src) return null;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return src;
  }

  const maxWidth = Math.max(1, Number(options?.maxWidth) || 512);
  const maxHeight = Math.max(1, Number(options?.maxHeight) || maxWidth);
  const mimeType = options?.mimeType || 'image/png';
  const quality = typeof options?.quality === 'number' ? options.quality : undefined;

  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || image.width || 1;
        const sourceHeight = image.naturalHeight || image.height || 1;
        const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sourceWidth * scale));
        canvas.height = Math.max(1, Math.round(sourceHeight * scale));

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(mimeType, quality));
      } catch {
        resolve(src);
      }
    };
    image.onerror = () => resolve(src);
    image.src = src;
  });
}

export async function normalizeLogoDataUrl(logo: unknown): Promise<string | null> {
  return normalizeImageDataUrl(logo, { maxWidth: 512, maxHeight: 512, mimeType: 'image/png' });
}

export async function normalizeSignatureDataUrl(signature: unknown): Promise<string | null> {
  return normalizeImageDataUrl(signature, { maxWidth: 900, maxHeight: 260, mimeType: 'image/png' });
}

export function printPdfUrl(url: string) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';

  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (error) {
        console.error('PDF print failed:', error);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }, 250);
  };

  iframe.src = url;
  document.body.appendChild(iframe);

  window.setTimeout(() => {
    iframe.remove();
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }, 60000);
}

export function normalizePhoneForWhatsApp(phone: unknown, defaultCountryCode = '234') {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith(defaultCountryCode)) return digits;
  if (digits.startsWith('0')) return `${defaultCountryCode}${digits.slice(1)}`;
  if (digits.length <= 10) return `${defaultCountryCode}${digits}`;
  return digits;
}

export function promptForWhatsAppNumber(initialPhone?: unknown) {
  const normalized = normalizePhoneForWhatsApp(initialPhone);

  if (typeof window === 'undefined') {
    return normalized;
  }

  const response = window.prompt(
    'Enter a WhatsApp number. Leave it blank to choose a contact inside WhatsApp.',
    normalized
  );

  if (response === null) {
    return null;
  }

  return normalizePhoneForWhatsApp(response);
}

export function openWhatsAppShare(options: {
  phone?: unknown;
  title?: string;
  lines?: Array<unknown>;
  link?: string;
}) {
  const phone = normalizePhoneForWhatsApp(options.phone);
  const message = [
    String(options.title || '').trim(),
    ...(options.lines || []).map((line) => String(line ?? '').trim()),
    String(options.link || '').trim(),
  ].filter(Boolean).join('\n');

  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  if (typeof window !== 'undefined') {
    const openedWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!openedWindow) {
      window.location.assign(url);
    }
  }

  return url;
}

const escapeCsvValue = (value: unknown) => {
  const normalized = String(value ?? '');
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
};

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    throw new Error('There is no data to export.');
  }

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ].join('\r\n');

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let currentValue = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentValue.trim());
      currentValue = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }
      currentRow.push(currentValue.trim());
      if (currentRow.some((cell) => cell !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = '';
      continue;
    }

    currentValue += char;
  }

  if (currentValue || currentRow.length) {
    currentRow.push(currentValue.trim());
    if (currentRow.some((cell) => cell !== '')) {
      rows.push(currentRow);
    }
  }

  if (!rows.length) {
    return [] as Array<Record<string, string>>;
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((header) => header.replace(/^\uFEFF/, '').trim());

  return dataRows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']))
  );
}

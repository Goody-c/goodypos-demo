import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getCurrencyConfig, readCurrencyPreference } from './currency';
import { loadPdfFonts } from './pdfFontLoader';

const BRAND = {
  navy: [15, 23, 42] as [number, number, number],
  blue: [37, 99, 235] as [number, number, number],
  slate: [71, 85, 105] as [number, number, number],
  light: [248, 250, 252] as [number, number, number],
  border: [203, 213, 225] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
};

const DEFAULT_DOCUMENT_COLOR = '#F4BD4A';
const PDF_FONT_FAMILY = 'GoodyUnicode';
const PDF_STANDARD_FAMILIES = new Set(['helvetica', 'times', 'courier']);

const normalizePdfFontStyle = (style?: string) => {
  const normalized = String(style || 'normal').toLowerCase();
  if (normalized === 'bold' || normalized === 'italic' || normalized === 'bolditalic') {
    return normalized as 'normal' | 'bold' | 'italic' | 'bolditalic';
  }
  return 'normal' as const;
};

const ensurePdfFontSupport = async (doc: jsPDF) => {
  const pdfDoc = doc as jsPDF & { __goodyUnicodeReady?: boolean; __goodySetFontWrapped?: boolean };
  if (pdfDoc.__goodyUnicodeReady) {
    return true;
  }

  try {
    const { regular, bold, italic, boldItalic } = await loadPdfFonts();

    doc.addFileToVFS('NotoSans-Regular.ttf', regular);
    doc.addFileToVFS('NotoSans-Bold.ttf', bold);
    doc.addFileToVFS('NotoSans-Italic.ttf', italic);
    doc.addFileToVFS('NotoSans-BoldItalic.ttf', boldItalic);

    doc.addFont('NotoSans-Regular.ttf', PDF_FONT_FAMILY, 'normal', 'Identity-H');
    doc.addFont('NotoSans-Bold.ttf', PDF_FONT_FAMILY, 'bold', 'Identity-H');
    doc.addFont('NotoSans-Italic.ttf', PDF_FONT_FAMILY, 'italic', 'Identity-H');
    doc.addFont('NotoSans-BoldItalic.ttf', PDF_FONT_FAMILY, 'bolditalic', 'Identity-H');

    if (!pdfDoc.__goodySetFontWrapped) {
      const originalSetFont = doc.setFont.bind(doc);
      doc.setFont = ((fontName?: string, fontStyle?: string, fontWeight?: number | string) => {
        const requestedFamily = String(fontName || PDF_FONT_FAMILY).toLowerCase();
        const nextFamily = PDF_STANDARD_FAMILIES.has(requestedFamily) ? PDF_FONT_FAMILY : (fontName || PDF_FONT_FAMILY);
        return originalSetFont(nextFamily, normalizePdfFontStyle(fontStyle), fontWeight);
      }) as typeof doc.setFont;
      pdfDoc.__goodySetFontWrapped = true;
    }

    if (typeof (doc as any).setLanguage === 'function') {
      (doc as any).setLanguage('en-NG');
    }

    doc.setFont(PDF_FONT_FAMILY, 'normal');
    pdfDoc.__goodyUnicodeReady = true;
    return true;
  } catch (error) {
    console.warn('Unicode PDF font setup failed, falling back to default fonts.', error);
    return false;
  }
};

const createPdfDoc = async (options: any) => {
  const doc = new jsPDF({ putOnlyUsedFonts: true, ...options });
  await ensurePdfFontSupport(doc);
  return doc;
};

const normalizeHexColor = (value: any, fallback = DEFAULT_DOCUMENT_COLOR) => {
  const raw = String(value ?? '').trim();
  const longHex = raw.match(/^#?([0-9a-fA-F]{6})$/);
  if (longHex) return `#${longHex[1].toUpperCase()}`;

  const shortHex = raw.match(/^#?([0-9a-fA-F]{3})$/);
  if (shortHex) {
    const expanded = shortHex[1].toUpperCase().split('').map(char => `${char}${char}`).join('');
    return `#${expanded}`;
  }

  return fallback;
};

const hexToRgb = (value: any, fallback = DEFAULT_DOCUMENT_COLOR): [number, number, number] => {
  const hex = normalizeHexColor(value, fallback).slice(1);
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
};

const tintColor = (rgb: [number, number, number], amount: number): [number, number, number] => {
  return rgb.map(value => Math.round(value + (255 - value) * amount)) as [number, number, number];
};

const getContrastTextColor = (
  rgb: [number, number, number],
  light = BRAND.white,
  dark = BRAND.navy,
): [number, number, number] => {
  const [r, g, b] = rgb;
  const luminance = (0.299 * r) + (0.587 * g) + (0.114 * b);
  return luminance > 170 ? dark : light;
};

const resolveDocumentAccent = (store: any) => hexToRgb(store?.document_color || DEFAULT_DOCUMENT_COLOR);

const shouldShowStoreNameOnDocuments = (store: any) => {
  const hasLogo = Boolean(String(store?.logo ?? '').trim());
  if (!hasLogo) return true;
  return store?.show_store_name_on_documents === true || Number(store?.show_store_name_on_documents) === 1;
};

const drawContainedImage = (
  doc: jsPDF,
  imageSrc: any,
  x: number,
  y: number,
  maxWidth: number,
  maxHeight: number,
  align: 'left' | 'center' | 'right' = 'center'
) => {
  const src = String(imageSrc ?? '').trim();
  if (!src) return false;

  try {
    const properties = doc.getImageProperties(src) as any;
    const sourceWidth = Math.max(1, Number(properties?.width || properties?.w || 1));
    const sourceHeight = Math.max(1, Number(properties?.height || properties?.h || 1));
    const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
    const renderWidth = Math.max(1, sourceWidth * scale);
    const renderHeight = Math.max(1, sourceHeight * scale);
    const renderX = align === 'right'
      ? x + maxWidth - renderWidth
      : align === 'left'
        ? x
        : x + (maxWidth - renderWidth) / 2;
    const renderY = y + (maxHeight - renderHeight) / 2;
    const format = /^data:image\/png/i.test(src) ? 'PNG' : 'JPEG';

    doc.addImage(src, format, renderX, renderY, renderWidth, renderHeight);
    return true;
  } catch {
    return false;
  }
};

export const normalizeLogoDataUrl = async (logo: any): Promise<string | null> => {
  const src = String(logo ?? '').trim();
  if (!src) return null;
  if (/^data:image\/(png|jpeg|jpg);/i.test(src)) return src;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return src;
  }

  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || image.width || 1;
        const sourceHeight = image.naturalHeight || image.height || 1;
        const maxSide = 512;
        const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
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
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(src);
      }
    };
    image.onerror = () => resolve(src);
    image.src = src;
  });
};

const safeText = (value: any, fallback = '—') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const getInvoiceItemLabel = (item: any, index: number) => {
  const baseName = safeText(item?.product_name || item?.name || `Item ${index + 1}`);
  if (item?.item_source === 'CONSIGNMENT' || item?.is_consignment) {
    return baseName;
  }
  if (item?.item_source === 'SOURCED' || item?.is_sourced) {
    return baseName;
  }
  return baseName;
};

const getTotalPaidFromPaymentMethods = (paymentMethods: any) => {
  const methods = typeof paymentMethods === 'string'
    ? JSON.parse(paymentMethods || '{}')
    : (paymentMethods || {});

  return ['cash', 'transfer', 'pos'].reduce(
    (sum, key) => sum + Math.max(0, Number(methods?.[key]) || 0),
    0
  );
};

const resolveReceiptHeaderNote = (store: any) => String(store?.receipt_header_note || '').trim();

const resolveReceiptFooterNote = (store: any, fallback = 'Thank you for your business!') => {
  const note = String(store?.receipt_footer_note || '').trim();
  return note || fallback;
};

const shouldShowBankDetails = (store: any) => store?.receipt_show_bank_details !== false && store?.receipt_show_bank_details !== 0;

const formatDocumentDate = (value?: string) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toLocaleString() : date.toLocaleString();
};

const NAIRA_SYMBOL = '\u20A6';
let activePdfCurrencyCode: string | undefined;

const setActivePdfCurrency = (currencyCode?: unknown) => {
  const normalizedCode = String(currencyCode ?? '').trim().toUpperCase();
  activePdfCurrencyCode = normalizedCode || undefined;
};

const resolvePdfCurrencyConfig = (currencyCode?: unknown) => {
  const normalizedCode = String(currencyCode ?? '').trim().toUpperCase();
  if (normalizedCode) {
    return getCurrencyConfig(normalizedCode);
  }

  if (activePdfCurrencyCode) {
    return getCurrencyConfig(activePdfCurrencyCode);
  }

  return readCurrencyPreference();
};

const formatPdfAmount = (amount: number, currencyCode?: unknown) => {
  const numericAmount = Number(amount) || 0;
  const currency = resolvePdfCurrencyConfig(currencyCode);
  return new Intl.NumberFormat(currency.locale || 'en-US', {
    minimumFractionDigits: Number.isInteger(numericAmount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(numericAmount);
};

const formatPdfInlineCurrency = (amount: number, currencyCode?: unknown) => {
  const numericAmount = Number(amount) || 0;
  const prefix = numericAmount < 0 ? '-' : '';
  const currency = resolvePdfCurrencyConfig(currencyCode);
  const symbol = String(currency.symbol || currency.code || '$').trim();
  return `${prefix}${symbol} ${formatPdfAmount(Math.abs(numericAmount), currency.code)}`;
};

const formatPercentage = (value: number) => {
  const numericValue = Number(value) || 0;
  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
};

const drawCurrencySymbol = (
  doc: jsPDF,
  x: number,
  y: number,
  fontSize: number,
  color: [number, number, number],
  currencyCode?: unknown,
) => {
  const currency = resolvePdfCurrencyConfig(currencyCode);
  const symbol = String(currency.symbol || currency.code || '$').trim();

  doc.setTextColor(...color);
  doc.setDrawColor(...color);
  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.setFontSize(fontSize);

  if (symbol === NAIRA_SYMBOL) {
    doc.text('N', x, y);

    const width = doc.getTextWidth('N');
    const barInset = Math.max(0.06, fontSize * 0.012);
    const topBarY = y - fontSize * 0.24;
    const lowerBarY = y - fontSize * 0.08;
    doc.setLineWidth(Math.max(0.12, fontSize * 0.012));
    doc.line(x - barInset, topBarY, x + width + barInset, topBarY);
    doc.line(x - barInset, lowerBarY, x + width + barInset, lowerBarY);
    return width;
  }

  doc.text(symbol, x, y);
  return doc.getTextWidth(symbol);
};

const drawCurrencyValue = (
  doc: jsPDF,
  amount: number,
  x: number,
  y: number,
  options?: {
    align?: 'left' | 'right';
    fontSize?: number;
    font?: 'helvetica' | 'times' | 'courier';
    fontStyle?: 'normal' | 'bold' | 'italic' | 'bolditalic';
    color?: [number, number, number];
    currencyCode?: unknown;
  }
) => {
  const align = options?.align || 'left';
  const fontSize = options?.fontSize || 10;
  const font = options?.font || 'helvetica';
  const fontStyle = options?.fontStyle || 'bold';
  const color = options?.color || BRAND.navy;
  const numericAmount = Number(amount) || 0;
  const amountText = formatPdfAmount(Math.abs(numericAmount), options?.currencyCode);
  const prefix = numericAmount < 0 ? '-' : '';
  const unicodeText = formatPdfInlineCurrency(numericAmount, options?.currencyCode);
  const symbolSize = Math.max(6.8, fontSize * 0.8);
  const gap = Math.max(0.7, fontSize * 0.1);
  const canUseUnicodeFont = Boolean((doc as jsPDF & { __goodyUnicodeReady?: boolean }).__goodyUnicodeReady);

  doc.setTextColor(...color);
  doc.setFont(font, fontStyle);
  doc.setFontSize(fontSize);

  if (canUseUnicodeFont) {
    if (typeof (doc as any).setCharSpace === 'function') {
      (doc as any).setCharSpace(Math.max(0.08, fontSize * 0.012));
    }

    if (align === 'right') {
      doc.text(unicodeText, x, y, { align: 'right' });
    } else {
      doc.text(unicodeText, x, y);
    }

    if (typeof (doc as any).setCharSpace === 'function') {
      (doc as any).setCharSpace(0);
    }
    return;
  }

  const numberText = `${prefix ? `${prefix} ` : ''}${amountText}`;
  if (align === 'right') {
    doc.text(numberText, x, y, { align: 'right' });
    const textWidth = doc.getTextWidth(numberText);
    const symbolX = x - textWidth - gap - Math.max(3.5, symbolSize * 0.24);
    drawCurrencySymbol(doc, symbolX, y, symbolSize, color, options?.currencyCode);
    return;
  }

  const symbolWidth = drawCurrencySymbol(doc, x, y, symbolSize, color, options?.currencyCode);
  doc.setFont(font, fontStyle);
  doc.setFontSize(fontSize);
  doc.text(numberText, x + symbolWidth + gap, y);
};

const getTextWidthWithSpacing = (
  doc: jsPDF,
  text: string,
  fontSize: number,
  font: 'helvetica' | 'times' | 'courier' = 'helvetica',
  fontStyle: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'bold',
  includeCurrencyCharSpacing = false
) => {
  doc.setFont(font, fontStyle);
  doc.setFontSize(fontSize);
  const baseWidth = doc.getTextWidth(text);

  const hasUnicodeFont = Boolean((doc as jsPDF & { __goodyUnicodeReady?: boolean }).__goodyUnicodeReady);
  if (!includeCurrencyCharSpacing || !hasUnicodeFont) {
    return baseWidth;
  }

  const charSpacing = Math.max(0.08, fontSize * 0.012);
  return baseWidth + Math.max(0, text.length - 1) * charSpacing;
};

const getFittedPdfFontSize = (
  doc: jsPDF,
  text: string,
  maxWidth: number,
  preferredSize: number,
  minSize: number,
  font: 'helvetica' | 'times' | 'courier' = 'helvetica',
  fontStyle: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'bold',
  includeCurrencyCharSpacing = false
) => {
  let nextSize = preferredSize;

  while (nextSize > minSize) {
    if (getTextWidthWithSpacing(doc, text, nextSize, font, fontStyle, includeCurrencyCharSpacing) <= maxWidth) {
      break;
    }
    nextSize = Number((nextSize - 0.2).toFixed(2));
  }

  return Math.max(minSize, nextSize);
};

const getCurrencyTextWidth = (
  doc: jsPDF,
  amount: number,
  fontSize: number,
  font: 'helvetica' | 'times' | 'courier' = 'helvetica',
  fontStyle: 'normal' | 'bold' | 'italic' | 'bolditalic' = 'bold'
) => {
  return getTextWidthWithSpacing(doc, formatPdfInlineCurrency(amount), fontSize, font, fontStyle, true);
};

const drawResponsiveCurrencySummaryRow = (
  doc: jsPDF,
  config: {
    label: string;
    amount: number;
    x: number;
    rightX: number;
    y: number;
    color: [number, number, number];
    fontSize?: number;
    minFontSize?: number;
  }
) => {
  const {
    label,
    amount,
    x,
    rightX,
    y,
    color,
    fontSize = 9.8,
    minFontSize = 8.2,
  } = config;

  const rowWidth = Math.max(24, rightX - x);
  const gap = 4;
  let labelFontSize = fontSize;
  let amountFontSize = fontSize;
  let labelWidth = 0;
  let amountWidth = 0;

  while (labelFontSize > minFontSize || amountFontSize > minFontSize) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(labelFontSize);
    labelWidth = doc.getTextWidth(label);
    amountWidth = getCurrencyTextWidth(doc, amount, amountFontSize, 'helvetica', 'bold');

    if (labelWidth + amountWidth + gap <= rowWidth) {
      break;
    }

    if (amountWidth >= labelWidth && amountFontSize > minFontSize) {
      amountFontSize = Number(Math.max(minFontSize, amountFontSize - 0.25).toFixed(2));
      continue;
    }

    if (labelFontSize > minFontSize) {
      labelFontSize = Number(Math.max(minFontSize, labelFontSize - 0.25).toFixed(2));
      continue;
    }

    break;
  }

  doc.setTextColor(...color);
  doc.setFont('helvetica', 'bold');

  const shouldStack = labelWidth + amountWidth + gap > rowWidth;

  if (!shouldStack) {
    doc.setFontSize(labelFontSize);
    doc.text(label, x, y);
    drawCurrencyValue(doc, amount, rightX, y, {
      align: 'right',
      fontSize: amountFontSize,
      color,
      font: 'helvetica',
      fontStyle: 'bold',
    });
    return y + Math.max(5.8, Math.max(labelFontSize, amountFontSize) * 0.44 + 1.8);
  }

  doc.setFontSize(labelFontSize);
  const labelLines = doc.splitTextToSize(label, Math.max(24, rowWidth * 0.84));
  doc.text(labelLines, x, y);

  const lineHeight = Math.max(4.2, labelFontSize * 0.44);
  const amountY = y + labelLines.length * lineHeight + 1.1;
  drawCurrencyValue(doc, amount, rightX, amountY, {
    align: 'right',
    fontSize: amountFontSize,
    color,
    font: 'helvetica',
    fontStyle: 'bold',
  });

  return amountY + Math.max(5.4, amountFontSize * 0.46 + 1.8);
};

const drawResponsiveCurrencyTotalBox = (
  doc: jsPDF,
  config: {
    label: string;
    amount: number;
    x: number;
    y: number;
    width: number;
    fillColor: [number, number, number];
    textColor: [number, number, number];
    preferredFontSize?: number;
    minFontSize?: number;
  }
) => {
  const {
    label,
    amount,
    x,
    y,
    width,
    fillColor,
    textColor,
    preferredFontSize = 12.4,
    minFontSize = 8.6,
  } = config;

  const labelX = x + 4;
  const amountRightX = x + width - 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(preferredFontSize);
  const labelWidth = doc.getTextWidth(label);
  const inlineAvailableWidth = Math.max(14, amountRightX - (labelX + labelWidth + 4));
  const inlineAmountFontSize = getFittedPdfFontSize(
    doc,
    formatPdfInlineCurrency(amount),
    inlineAvailableWidth,
    preferredFontSize,
    minFontSize,
    'helvetica',
    'bold',
    true
  );
  const inlineAmountWidth = getCurrencyTextWidth(doc, amount, inlineAmountFontSize, 'helvetica', 'bold');
  const useStackedLayout = inlineAmountWidth > inlineAvailableWidth;
  const boxHeight = useStackedLayout ? 15 : 11;

  doc.setFillColor(...fillColor);
  doc.roundedRect(x, y, width, boxHeight, 2.2, 2.2, 'F');
  doc.setTextColor(...textColor);
  doc.setFont('helvetica', 'bold');

  if (useStackedLayout) {
    doc.setFontSize(10.6);
    doc.text(label, labelX, y + 4.9);
    const stackedFontSize = getFittedPdfFontSize(
      doc,
      formatPdfInlineCurrency(amount),
      Math.max(18, width - 8),
      10.8,
      8.2,
      'helvetica',
      'bold',
      true
    );
    drawCurrencyValue(doc, amount, amountRightX, y + 11.2, {
      align: 'right',
      fontSize: stackedFontSize,
      color: textColor,
      font: 'helvetica',
      fontStyle: 'bold',
    });
  } else {
    doc.setFontSize(preferredFontSize);
    doc.text(label, labelX, y + 7.1);
    drawCurrencyValue(doc, amount, amountRightX, y + 7.1, {
      align: 'right',
      fontSize: inlineAmountFontSize,
      color: textColor,
      font: 'helvetica',
      fontStyle: 'bold',
    });
  }

  return boxHeight;
};

const getAutoTableTextY = (cell: any) => {
  if (cell?.textPos?.y != null) return cell.textPos.y;
  const baseY = Number(cell?.y ?? 0);
  const height = Number(cell?.height ?? 0);
  return baseY + Math.max(4.5, height / 2 + 1.5);
};

const buildReference = (prefix: string, id: string | number | undefined, dateValue?: string) => {
  const year = new Date(dateValue || Date.now()).getFullYear();
  const serial = id != null
    ? String(id).padStart(4, '0')
    : Math.floor(1000 + Math.random() * 9000).toString();

  return `${prefix}-${year}-${serial}`;
};

const getSpecValue = (specs: any, keys: string[]) => {
  for (const key of keys) {
    const value = specs?.[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
};

const formatSpecLabel = (value: string) => String(value || '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (char) => char.toUpperCase());

const IGNORED_SPEC_KEYS = new Set([
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

const flattenSpecEntries = (specs: any, parentLabel = ''): Array<[string, string]> => {
  if (specs == null || specs === '') return [];

  if (Array.isArray(specs)) {
    const joined = specs
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .join(', ');
    return joined ? [[parentLabel || 'Details', joined]] : [];
  }

  if (typeof specs === 'object') {
    return Object.entries(specs).flatMap(([key, value]) => {
      const normalizedKey = String(key || '').trim().toLowerCase();
      if (normalizedKey.startsWith('__') || IGNORED_SPEC_KEYS.has(normalizedKey) || normalizedKey.includes('condition_matrix')) {
        return [];
      }

      if ((normalizedKey === 'public_specs' || normalizedKey === 'specs' || normalizedKey === 'specs_at_sale')
        && value != null
        && typeof value === 'object'
      ) {
        return flattenSpecEntries(value, parentLabel);
      }

      const label = [parentLabel, formatSpecLabel(key)].filter(Boolean).join(' ');
      if (value != null && typeof value === 'object' && !Array.isArray(value)) {
        return flattenSpecEntries(value, label);
      }

      const normalizedValue = Array.isArray(value)
        ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean).join(', ')
        : String(value ?? '').trim();

      return normalizedValue ? [[label || formatSpecLabel(key), normalizedValue]] : [];
    });
  }

  const normalized = String(specs).trim();
  return normalized ? [[parentLabel || 'Details', normalized]] : [];
};

const getItemDetailLines = (item: any) => {
  const specs = item.specs || item.specs_at_sale || {};
  const explicitPublicSpecs = (specs && typeof specs === 'object' && specs.public_specs && typeof specs.public_specs === 'object')
    ? specs.public_specs
    : (item?.public_specs && typeof item.public_specs === 'object' ? item.public_specs : null);
  const isSpecialSaleItem = Boolean(item?.is_consignment || item?.item_source === 'CONSIGNMENT' || item?.is_sourced || item?.item_source === 'SOURCED');
  const publicSpecs = explicitPublicSpecs || (isSpecialSaleItem ? {} : specs);
  const storage = getSpecValue(publicSpecs, ['Storage', 'storage', 'ROM', 'rom']);
  const ram = getSpecValue(publicSpecs, ['RAM', 'ram', 'Memory', 'memory']);
  const processor = getSpecValue(publicSpecs, ['Processor', 'processor', 'CPU', 'cpu', 'Chip', 'chip']);
  const condition = item.selectedCondition || item.condition;
  const specEntries = flattenSpecEntries(publicSpecs);

  const detailLines: string[] = [];
  const smartSpecs = [
    storage,
    ram ? (ram.toLowerCase().includes('ram') ? ram : `${ram} RAM`) : '',
    processor,
  ].filter(Boolean);
  const hasPublicFacingSpecs = smartSpecs.length > 0 || specEntries.length > 0;

  if (smartSpecs.length > 0) {
    detailLines.push(`Specs: ${smartSpecs.join(' • ')}`);
  }

  const sourcedProductSpecs = String(
    item.sourced_product_specs || specs?.sourced_product_specs || ''
  ).trim();
  if (sourcedProductSpecs) {
    detailLines.push(`Specs: ${sourcedProductSpecs}`);
  }

  const featuredKeys = new Set([
    'storage',
    'rom',
    'ram',
    'memory',
    'processor',
    'cpu',
    'chip',
    'sourced item',
    'sourced item name',
    'sourced vendor name',
    'sourced vendor address',
    'sourced vendor phone',
    'sourced vendor reference',
    'sourced product specs',
    'sourced cost price',
    'consignment item',
    'consignment item id',
    'consignment item name',
    'vendor name',
    'vendor phone',
    'vendor address',
    'imei serial',
    'public specs condition matrix',
    'condition matrix',
    'last sold at',
    'last returned at',
    'last sold quantity',
    'last returned quantity',
    'sold amount total',
    'sold quantity total',
    'returned amount total',
    'returned quantity total',
  ]);
  const remainingSpecs = specEntries.filter(([label]) => !featuredKeys.has(label.toLowerCase()));
  for (let index = 0; index < remainingSpecs.length; index += 2) {
    const line = remainingSpecs
      .slice(index, index + 2)
      .map(([label, value]) => `${label}: ${value}`)
      .join(' • ');

    if (line) {
      detailLines.push(line);
    }
  }

  if (condition) {
    const conditionLabel = String(condition).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    detailLines.push(`Condition: ${conditionLabel}`);
  }

  if (!detailLines.length && item.imei_serial) {
    detailLines.push(`IMEI/Serial: ${item.imei_serial}`);
  } else if (item.imei_serial && !detailLines.some((line) => /imei\/serial/i.test(line))) {
    detailLines.push(`IMEI/Serial: ${item.imei_serial}`);
  }

  return detailLines;
};

const resolveCustomer = (record: any) => {
  const customer = record?.customer || {};

  return {
    name: customer.name || record?.customer_name || 'Walk-in Customer',
    phone: customer.phone || record?.customer_phone || '',
    address: customer.address || record?.customer_address || '',
  };
};

const ensureSpace = (doc: jsPDF, startY: number, neededHeight: number, bottomMargin = 18) => {
  const pageHeight = Number(doc.internal.pageSize?.getHeight?.() || 297);
  if (startY + neededHeight > pageHeight - bottomMargin) {
    doc.addPage();
    return 18;
  }
  return startY;
};

const drawHeader = (
  doc: jsPDF,
  store: any,
  options: { title: string; reference: string; date: string; subtext?: string }
) => {
  const accent = resolveDocumentAccent(store);
  const accentStripe = tintColor(accent, 0.28);
  const headerText = getContrastTextColor(accent);

  doc.setFillColor(...accent);
  doc.roundedRect(14, 12, 182, 34, 4, 4, 'F');
  doc.setFillColor(...accentStripe);
  doc.rect(14, 12, 5, 34, 'F');

  doc.setTextColor(...headerText);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(safeText(store?.name, 'GOODY-POS').toUpperCase(), 24, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const contactLines = [safeText(store?.address, ''), safeText(store?.phone, '')].filter(Boolean);
  if (contactLines.length > 0) {
    doc.text(contactLines, 24, 28);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(options.title, 190, 21, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Reference No: ${options.reference}`, 190, 29, { align: 'right' });
  doc.text(`Date: ${options.date}`, 190, 34, { align: 'right' });
  if (options.subtext) {
    doc.text(options.subtext, 190, 39, { align: 'right' });
  }

  doc.setTextColor(...BRAND.navy);
  return 54;
};

const drawCustomerBlock = (doc: jsPDF, customer: { name: string; phone: string; address: string }, startY: number) => {
  const addressLines = doc.splitTextToSize(safeText(customer.address, 'Not provided'), 118);
  const blockHeight = 22 + Math.max(addressLines.length - 1, 0) * 4.5;

  doc.setFillColor(...BRAND.light);
  doc.setDrawColor(...BRAND.border);
  doc.roundedRect(14, startY, 182, blockHeight, 3, 3, 'FD');

  doc.setTextColor(...BRAND.slate);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('BILL TO', 20, startY + 7);

  doc.setTextColor(...BRAND.navy);
  doc.setFontSize(10);
  doc.text('Full Name:', 20, startY + 14);
  doc.text('Phone Number:', 20, startY + 20);
  doc.text('Physical Address:', 20, startY + 26);

  doc.setFont('helvetica', 'normal');
  doc.text(safeText(customer.name, 'Walk-in Customer'), 52, startY + 14);
  doc.text(safeText(customer.phone, 'Not provided'), 52, startY + 20);
  doc.text(addressLines, 52, startY + 26);

  return startY + blockHeight + 8;
};

const resolveReceiptPaperSize = (store: any) => {
  if (store?.receipt_paper_size === 'A4') return 'A4';
  if (store?.receipt_paper_size === 'THERMAL_58') return 'THERMAL_58';
  return 'THERMAL';
};

const generateThermalSalePDF = async (sale: any, store: any) => {
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const timestamp = sale?.timestamp || new Date().toISOString();
  const reference = buildReference('RCT', sale?.id, timestamp);
  const customer = resolveCustomer(sale);
  const subtotalAmount = Math.max(0, Number(sale?.subtotal ?? sale?.total) || 0);
  const discountAmount = Math.max(0, Number(sale?.discount_amount || 0) || 0);
  const showDiscountOnInvoice = sale?.show_discount_on_invoice !== false;
  const taxAmount = Math.max(0, Number(sale?.tax_amount || 0) || 0);
  const taxPercentage = Math.max(0, Number(sale?.tax_percentage || 0) || 0);
  const receiptHeaderNote = resolveReceiptHeaderNote(store);
  const receiptFooterNote = resolveReceiptFooterNote(store, 'Thank you for choosing Goody-POS');

  // Paper dimensions — 58mm or 80mm thermal
  const paperWidth = store?.receipt_paper_size === 'THERMAL_58' ? 58 : 80;
  const margin = paperWidth === 58 ? 4 : 6;
  const rEdge = paperWidth - margin;       // right content edge
  const center = paperWidth / 2;           // horizontal center
  const textWidth = rEdge - margin;        // usable text width
  const qtyX = margin + textWidth * 0.58;  // qty column x

  const detailLineCount = items.reduce((count: number, item: any) => {
    const wrappedNameLines = Math.max(1, Math.ceil(safeText(item?.name, '').length / 18));
    const extraTotalLine = Number(item?.quantity ?? 1) > 1 ? 1 : 0;
    return count + wrappedNameLines + getItemDetailLines(item).length + extraTotalLine + 1;
  }, 0);
  const signatureAreaHeight = store?.signature_image ? 20 : 0;
  const docHeight = Math.max(140, 94 + detailLineCount * 4.4 + (customer?.phone || customer?.address ? 18 : 8) + signatureAreaHeight);
  const doc = await createPdfDoc({ unit: 'mm', format: [paperWidth, docHeight] });

  let y = 8;
  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.text(safeText(store?.name, 'GOODY-POS'), center, y, { align: 'center' });

  y += 5;
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  const headerLines = [
    safeText(store?.address, ''),
    safeText(store?.phone, ''),
    `Receipt No: ${reference}`,
    `Date: ${formatDocumentDate(timestamp)}`,
    ...(receiptHeaderNote ? doc.splitTextToSize(receiptHeaderNote, textWidth) : []),
  ].filter(Boolean);
  doc.text(headerLines, center, y, { align: 'center' });
  y += headerLines.length * 3.8 + 2;

  doc.line(margin, y, rEdge, y);
  y += 5;

  const customerLines = [
    `Customer: ${safeText(customer.name, 'Walk-in Customer')}`,
    customer.phone ? `Phone: ${customer.phone}` : '',
    customer.address ? `Address: ${customer.address}` : '',
  ].filter(Boolean);
  doc.text(customerLines, margin, y);
  y += customerLines.length * 3.8 + 2;

  doc.line(margin, y, rEdge, y);
  y += 5;

  const drawThermalAmount = (
    amount: number,
    lineY: number,
    options?: { fontSize?: number; fontStyle?: 'normal' | 'bold'; color?: [number, number, number] }
  ) => {
    const color = options?.color || ([0, 0, 0] as [number, number, number]);
    let fontSize = options?.fontSize || 7.2;
    const maxAmountWidth = 24;
    const amountText = formatPdfAmount(amount);

    while (fontSize > 5.4) {
      doc.setFont('helvetica', options?.fontStyle || 'bold');
      doc.setFontSize(fontSize);
      const totalWidth = doc.getTextWidth(amountText) + Math.max(4.4, fontSize * 0.58);
      if (totalWidth <= maxAmountWidth) {
        break;
      }
      fontSize -= 0.3;
    }

    drawCurrencyValue(doc, amount, rEdge, lineY, {
      align: 'right',
      font: 'helvetica',
      fontStyle: options?.fontStyle || 'bold',
      fontSize,
      color,
    });
  };

  doc.setFont('courier', 'bold');
  doc.setFontSize(8);
  doc.text('ITEM', margin, y);
  doc.text('QTY', qtyX, y, { align: 'right' });
  doc.text('PRICE', rEdge, y, { align: 'right' });
  y += 4.2;

  doc.setFont('courier', 'normal');
  items.forEach((item: any, index: number) => {
    const quantity = Math.max(1, Number(item.quantity ?? 1) || 1);
    const unitPrice = Number(item.price_at_sale ?? item.price ?? 0) || 0;
    const lineTotal = unitPrice * quantity;
    const details = getItemDetailLines(item);
    const itemNameLines = doc.splitTextToSize(getInvoiceItemLabel(item, index), textWidth * 0.55);

    doc.setFont('courier', 'bold');
    doc.setFontSize(7.8);
    itemNameLines.forEach((line: string, index: number) => {
      doc.text(line, margin, y);
      if (index === 0) {
        doc.text(`x${quantity}`, qtyX, y, { align: 'right' });
        drawThermalAmount(unitPrice, y, { fontSize: 7, fontStyle: 'bold' });
      }
      y += 3.5;
    });

    if (quantity > 1) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(6.4);
      doc.text('Line total', margin + 2, y);
      drawThermalAmount(lineTotal, y, { fontSize: 6.2, fontStyle: 'normal' });
      y += 3.1;
    }

    if (details.length > 0) {
      doc.setFont('courier', 'normal');
      doc.setFontSize(6.6);
      details.forEach((line) => {
        const wrappedDetailLines = doc.splitTextToSize(line, textWidth);
        wrappedDetailLines.forEach((detailLine: string) => {
          doc.text(detailLine, margin + 2, y);
          y += 2.9;
        });
      });
    }

    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, rEdge, y);
    y += 3.6;
  });

  doc.setFont('courier', 'normal');
  doc.setFontSize(7.2);
  doc.text('Subtotal', margin, y);
  drawThermalAmount(subtotalAmount, y, { fontSize: 6.8, fontStyle: 'normal' });
  y += 3.8;

  if (discountAmount > 0 && showDiscountOnInvoice) {
    const discountLabel = `Discount${sale?.discount_note ? ` (${String(sale.discount_note).trim()})` : ''}`;
    const discountLabelLines = doc.splitTextToSize(discountLabel, textWidth * 0.65);
    discountLabelLines.forEach((line: string, index: number) => {
      doc.text(line, margin, y);
      if (index === 0) {
        drawThermalAmount(-discountAmount, y, { fontSize: 6.6, fontStyle: 'normal' });
      }
      y += 3.2;
    });
  }

  if (taxAmount > 0 || taxPercentage > 0) {
    doc.text(`Tax (${formatPercentage(taxPercentage)}%)`, margin, y);
    drawThermalAmount(taxAmount, y, { fontSize: 6.6, fontStyle: 'normal' });
    y += 3.8;
  }

  doc.setFont('courier', 'bold');
  doc.setFontSize(9.2);
  doc.text('TOTAL', margin, y);
  drawThermalAmount(Number(sale?.total) || 0, y, { fontSize: 8.4, fontStyle: 'bold' });
  y += 5.6;

  const paymentData = typeof sale?.payment_methods === 'string'
    ? JSON.parse(sale.payment_methods || '{}')
    : (sale?.payment_methods || {});
  const amountPaid = Number(sale?.amount_paid ?? getTotalPaidFromPaymentMethods(paymentData)) || 0;
  const amountDue = Math.max(
    0,
    Number((sale?.amount_due != null ? Number(sale.amount_due) : (Number(sale?.total || 0) - amountPaid)).toFixed(2)) || 0
  );

  doc.setFont('courier', 'normal');
  doc.setFontSize(6.8);
  Object.entries(paymentData).forEach(([method, amount]) => {
    if (Number(amount) > 0) {
      doc.text(String(method).toUpperCase(), margin, y);
      drawThermalAmount(Number(amount), y, { fontSize: 6.4, fontStyle: 'normal' });
      y += 3.4;
    }
  });

  if (amountPaid > 0) {
    doc.text('Amount Paid', margin, y);
    drawThermalAmount(amountPaid, y, { fontSize: 6.4, fontStyle: 'normal' });
    y += 3.4;
  }

  if (amountDue > 0) {
    doc.setFont('courier', 'bold');
    doc.text('Outstanding Balance', margin, y);
    drawThermalAmount(amountDue, y, { fontSize: 6.4, fontStyle: 'bold' });
    y += 3.6;
    doc.setFont('courier', 'normal');

    if (sale?.due_date) {
      const dueDate = new Date(sale.due_date);
      const dueLabel = Number.isNaN(dueDate.getTime()) ? String(sale.due_date) : dueDate.toLocaleDateString();
      const dueText = doc.splitTextToSize(`Due Date: ${dueLabel}`, textWidth);
      dueText.forEach((line: string) => {
        doc.text(line, margin, y);
        y += 3.2;
      });
    }
  }

  y += 2;
  doc.line(margin, y, rEdge, y);
  y += 5;
  doc.setFont('courier', 'italic');
  const thermalFooterLines = doc.splitTextToSize(receiptFooterNote, textWidth);
  doc.text(thermalFooterLines, center, y, { align: 'center' });

  if (store?.signature_image) {
    y += thermalFooterLines.length * 3.2 + 5;
    doc.setDrawColor(160, 160, 160);
    const sigX = rEdge - 32;
    doc.line(sigX, y, rEdge, y);
    drawContainedImage(doc, store.signature_image, sigX, y - 10, 32, 8, 'right');
    doc.setFont('courier', 'normal');
    doc.setFontSize(6.2);
    doc.text('Authorized Signatory', rEdge, y + 3.5, { align: 'right' });
  }

  return {
    doc,
    filename: `${reference}.pdf`,
  };
};

const generateA4SalePDF = async (sale: any, store: any) => {
  const doc = await createPdfDoc({ unit: 'mm', format: 'a4' });
  const timestamp = sale?.timestamp || new Date().toISOString();
  const issueDate = new Date(timestamp);
  const issueDateLabel = Number.isNaN(issueDate.getTime()) ? new Date().toLocaleDateString() : issueDate.toLocaleDateString();
  const dueDate = sale?.due_date ? new Date(sale.due_date) : null;
  const dueDateLabel = dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toLocaleDateString() : issueDateLabel;
  const reference = sale?.id != null ? String(sale.id).padStart(6, '0') : buildReference('INV', sale?.id, timestamp);
  const customer = resolveCustomer(sale);
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const totalAmount = Number(sale?.total) || 0;
  const taxAmount = Math.max(0, Number(sale?.tax_amount) || 0);
  const taxPercentage = Math.max(0, Number(sale?.tax_percentage) || 0);
  const subtotalAmount = Math.max(0, Number(sale?.subtotal ?? (totalAmount - taxAmount)) || 0);
  const discountAmount = Math.max(0, Number(sale?.discount_amount || 0) || 0);
  const showDiscountOnInvoice = sale?.show_discount_on_invoice !== false;
  const paymentData = typeof sale?.payment_methods === 'string'
    ? JSON.parse(sale.payment_methods || '{}')
    : (sale?.payment_methods || {});
  const amountPaid = Number(sale?.amount_paid ?? getTotalPaidFromPaymentMethods(paymentData)) || 0;
  const amountDue = Math.max(
    0,
    Number((sale?.amount_due != null ? Number(sale.amount_due) : (totalAmount - amountPaid)).toFixed(2)) || 0
  );
  const receiptHeaderNote = resolveReceiptHeaderNote(store);
  const receiptFooterNote = resolveReceiptFooterNote(
    store,
    sale?.status === 'PENDING'
      ? 'Pending transfer orders remain subject to payment confirmation before release.'
      : 'Please retain this invoice for warranty support and store records.'
  );
  const accent = resolveDocumentAccent(store);
  const darkCard = [63, 63, 63] as [number, number, number];
  const textDark = [38, 38, 38] as [number, number, number];
  const textMuted = [108, 108, 108] as [number, number, number];
  const borderLight = [210, 210, 210] as [number, number, number];

  const showStoreNameOnDocument = shouldShowStoreNameOnDocuments(store);
  const logoRendered = drawContainedImage(doc, store?.logo, 14, 10, 46, 24, 'left');

  if (!logoRendered) {
    doc.setFillColor(...accent);
    doc.roundedRect(14, 12, 20, 20, 3, 3, 'F');
    doc.setTextColor(...BRAND.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(safeText(store?.name, 'G').charAt(0).toUpperCase(), 24, 25, { align: 'center' });
  }

  doc.setTextColor(...textDark);
  let storeInfoY = logoRendered ? 38 : 49;

  if (showStoreNameOnDocument || !logoRendered) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    const storeNameLines = doc.splitTextToSize(safeText(store?.name, 'Your Business Name'), 58);
    doc.text(storeNameLines, 14, logoRendered ? 36 : 42);
    storeInfoY = (logoRendered ? 36 : 42) + storeNameLines.length * 4.8 + 2;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const storeContactLines = [
    ...doc.splitTextToSize(safeText(store?.address, ''), 62),
    safeText(store?.phone, ''),
  ].filter(Boolean);
  if (storeContactLines.length > 0) {
    doc.text(storeContactLines, 14, storeInfoY);
  }

  const receiptHeaderLines = receiptHeaderNote ? doc.splitTextToSize(receiptHeaderNote, 62) : [];
  if (receiptHeaderLines.length > 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...accent);
    doc.text(receiptHeaderLines, 14, storeInfoY + storeContactLines.length * 4.4 + 5);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`Invoice ${reference}`, 195, 18, { align: 'right' });
  doc.setFontSize(8);
  doc.text('Tax invoice', 195, 23, { align: 'right' });

  const billToY = Math.max(60, 49 + storeContactLines.length * 4.4 + (receiptHeaderLines.length > 0 ? receiptHeaderLines.length * 3.8 + 7 : 7));

  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('BILL TO', 14, billToY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const customerLines = [
    safeText(customer.name, 'Walk-in Customer'),
    customer.phone ? `Phone: ${customer.phone}` : '',
    ...doc.splitTextToSize(safeText(customer.address, 'Address not provided'), 55),
  ].filter(Boolean);
  doc.text(customerLines, 14, billToY + 6);

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Issue date:', 148, billToY + 4);
  doc.text('Due date:', 148, billToY + 12);
  doc.text('Reference:', 148, billToY + 20);

  doc.setTextColor(...textDark);
  doc.text(issueDateLabel, 195, billToY + 4, { align: 'right' });
  doc.text(dueDateLabel, 195, billToY + 12, { align: 'right' });
  doc.text(String(reference), 195, billToY + 20, { align: 'right' });

  const cardY = billToY + 28;
  const cardHeights = 15;
  const cards = [
    { x: 14, w: 43, label: 'Invoice No.', value: String(reference), fill: accent, text: BRAND.white },
    { x: 57, w: 43, label: 'Issue date', value: issueDateLabel, fill: accent, text: BRAND.white },
    { x: 100, w: 43, label: 'Due date', value: dueDateLabel, fill: accent, text: BRAND.white },
    {
      x: 143,
      w: 52,
      label: amountDue > 0 ? 'Balance due' : 'Invoice total',
      amount: amountDue > 0 ? amountDue : totalAmount,
      fill: darkCard,
      text: BRAND.white,
      currency: true,
    },
  ];

  cards.forEach(card => {
    doc.setFillColor(...card.fill);
    doc.rect(card.x, cardY, card.w, cardHeights, 'F');
    doc.setTextColor(...card.text);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(card.label, card.x + 2, cardY + 4.8);

    if ('currency' in card && card.currency) {
      drawCurrencyValue(doc, card.amount, card.x + card.w - 2, cardY + 11.8, {
        align: 'right',
        fontSize: 13.5,
        color: card.text,
        font: 'helvetica',
        fontStyle: 'bold',
      });
    } else {
      doc.setFontSize(11.5);
      doc.text(card.value, card.x + 2, cardY + 11.5);
    }
  });

  const tableStartY = cardY + cardHeights + 10;

  const bodyRows = items.map((item: any, index: number) => {
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.price_at_sale ?? item.price ?? 0);
    const detailLines = getItemDetailLines(item);

    return [
      [getInvoiceItemLabel(item, index), ...detailLines].join('\n'),
      Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2),
      unitPrice,
      unitPrice * quantity,
    ];
  });

  autoTable(doc, {
    startY: tableStartY,
    margin: { left: 14, right: 14 },
    head: [['Description', 'Quantity', 'Unit price', 'Amount']],
    body: bodyRows,
    theme: 'grid',
    headStyles: {
      fillColor: BRAND.white,
      textColor: textDark,
      fontStyle: 'bold',
      lineColor: borderLight,
      lineWidth: 0.2,
      fontSize: 8.5,
    },
    styles: {
      fontSize: 9,
      cellPadding: 3.2,
      lineColor: borderLight,
      lineWidth: 0.2,
      textColor: textDark,
      valign: 'top',
    },
    alternateRowStyles: { fillColor: [252, 252, 252] },
    columnStyles: {
      0: { cellWidth: 98, fontStyle: 'bold' },
      1: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 32, halign: 'right' },
      3: { cellWidth: 29, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) {
        data.cell.text = [''];
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) {
        drawCurrencyValue(doc, Number(data.cell.raw || 0), data.cell.x + data.cell.width - 2, getAutoTableTextY(data.cell), {
          align: 'right',
          fontSize: 8.8,
          color: textDark,
          font: 'helvetica',
          fontStyle: 'bold',
        });
      }
    },
  });

  const finalY = (doc as any).lastAutoTable.finalY as number;
  const noteHeading = discountAmount > 0 && showDiscountOnInvoice && sale?.discount_note ? 'Discount / Promo Note' : 'Terms & Conditions';
  const noteBody = discountAmount > 0 && showDiscountOnInvoice && sale?.discount_note
    ? `Applied promo: ${String(sale.discount_note).trim()}. ${receiptFooterNote}`
    : receiptFooterNote;
  const noteLines = doc.splitTextToSize(noteBody, 82);
  const pageHeight = Number(doc.internal.pageSize?.getHeight?.() || 297);
  const footerLineY = pageHeight - 17;
  const footerTextY = pageHeight - 12.5;
  const summaryRows = [
    { label: 'Subtotal:', amount: subtotalAmount, color: textDark, fontSize: 11.5 },
    ...(discountAmount > 0 && showDiscountOnInvoice ? [{ label: 'Discount:', amount: -discountAmount, color: accent, fontSize: 9.8 }] : []),
    { label: `Tax (${formatPercentage(taxPercentage)}%)`, amount: taxAmount, color: textDark, fontSize: 9.8 },
    { label: 'Amount paid:', amount: amountPaid, color: textDark, fontSize: 9.8 },
    { label: 'Outstanding balance:', amount: amountDue, color: amountDue > 0 ? accent : textDark, fontSize: 9.8 },
  ];
  const summaryRowsHeight = 12 + summaryRows.reduce((total, row) => {
    const estimatedAmountLength = formatPdfInlineCurrency(row.amount).length;
    if (estimatedAmountLength >= 14 || String(row.label).length > 16) return total + 12;
    if (estimatedAmountLength >= 11) return total + 9;
    return total + 7;
  }, 0);
  const estimatedTotalBoxHeight = formatPdfInlineCurrency(totalAmount).length >= 14 ? 15 : 11;
  const totalBoxYRelative = summaryRowsHeight + 1;
  const signatureLabelYRelative = totalBoxYRelative + estimatedTotalBoxHeight + 5.5;
  const signatureTextYRelative = signatureLabelYRelative + 13;
  const noteBlockHeight = 11 + noteLines.length * 3.8;
  const rightBlockHeight = signatureTextYRelative + 6;
  const summaryY = ensureSpace(doc, finalY + 7, Math.max(noteBlockHeight, rightBlockHeight), 20);

  let currentSummaryY = summaryY + 3.5;
  summaryRows.forEach((row) => {
    currentSummaryY = drawResponsiveCurrencySummaryRow(doc, {
      label: row.label,
      amount: row.amount,
      x: 132,
      rightX: 195,
      y: currentSummaryY,
      color: row.color,
      fontSize: row.fontSize,
      minFontSize: 8.2,
    });
  });

  doc.setDrawColor(...borderLight);
  doc.line(132, currentSummaryY - 2.2, 195, currentSummaryY - 2.2);

  const totalBoxY = currentSummaryY + 1.2;
  const totalBoxHeight = drawResponsiveCurrencyTotalBox(doc, {
    label: 'Total:',
    amount: totalAmount,
    x: 130,
    y: totalBoxY,
    width: 65,
    fillColor: accent,
    textColor: BRAND.white,
    preferredFontSize: 12.4,
    minFontSize: 8.8,
  });

  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Issued by, signature:', 192, totalBoxY + totalBoxHeight + 5.5, { align: 'right' });
  doc.setDrawColor(170, 170, 170);
  doc.line(148, totalBoxY + totalBoxHeight + 20, 194, totalBoxY + totalBoxHeight + 20);
  const hasSaleSignature = drawContainedImage(doc, store?.signature_image, 148, totalBoxY + totalBoxHeight + 6.5, 46, 12, 'right');
  if (!hasSaleSignature) {
    doc.setFont('times', 'bolditalic');
    doc.setFontSize(21);
    doc.text(safeText(store?.name, 'Goody POS'), 195, totalBoxY + totalBoxHeight + 18.5, { align: 'right' });
  }

  const noteY = summaryY + 3.5;
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(noteHeading, 14, noteY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.1);
  doc.setTextColor(...textMuted);
  doc.text(noteLines, 14, noteY + 5.5);

  doc.setDrawColor(120, 120, 120);
  doc.line(14, footerLineY, 196, footerLineY);
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(safeText(store?.phone, ''), 14, footerTextY);
  doc.text('Goody-POS', 105, footerTextY, { align: 'center' });
  doc.text(safeText(store?.address, ''), 195, footerTextY, { align: 'right' });

  return {
    doc,
    filename: `INV-${reference}.pdf`,
  };
};

export const generateSalePDF = async (sale: any, store: any) => {
  setActivePdfCurrency(store?.currency_code);

  if (resolveReceiptPaperSize(store) !== 'A4') {
    return generateThermalSalePDF(sale, store);
  }

  return generateA4SalePDF(sale, store);
};

export const generateCustomerStatementPDF = async (customer: any, invoices: any[], store: any) => {
  setActivePdfCurrency(store?.currency_code);
  const doc = await createPdfDoc({ unit: 'mm', format: 'a4' });
  const statementDate = new Date().toLocaleString();
  const statementReference = buildReference('CST', customer?.id, statementDate);
  const normalizedCustomer = {
    name: customer?.name || 'Walk-in Customer',
    phone: customer?.phone || '',
    address: customer?.address || '',
  };

  const accent = resolveDocumentAccent(store);
  const accentSoft = tintColor(accent, 0.9);
  const accentText = getContrastTextColor(accent);
  const border = [226, 232, 240] as [number, number, number];
  const textDark = [15, 23, 42] as [number, number, number];
  const textMuted = [100, 116, 139] as [number, number, number];

  const totalBilled = (invoices || []).reduce((sum, invoice) => sum + (Number(invoice?.total) || 0), 0);
  const totalPaid = (invoices || []).reduce((sum, invoice) => sum + (Number(invoice?.amount_paid) || 0), 0);
  const totalOutstanding = (invoices || []).reduce((sum, invoice) => sum + (Number(invoice?.amount_due) || 0), 0);

  let y = drawHeader(doc, store, {
    title: 'Customer Statement',
    reference: statementReference,
    date: statementDate,
    subtext: `${normalizedCustomer.name} • ${safeText(customer?.customer_code, 'No ID')}`,
  });

  y = drawCustomerBlock(doc, normalizedCustomer, y);

  const cardY = y + 1;
  const cards = [
    { x: 14, label: 'Invoices', value: String((invoices || []).length), fill: accent, textColor: accentText, width: 38, kind: 'count' as const },
    { x: 58, label: 'Total Billed', amount: totalBilled, fill: BRAND.blue, textColor: BRAND.white, width: 42, kind: 'amount' as const },
    { x: 106, label: 'Amount Paid', amount: totalPaid, fill: [22, 163, 74] as [number, number, number], textColor: BRAND.white, width: 42, kind: 'amount' as const },
    { x: 154, label: 'Outstanding', amount: totalOutstanding, fill: totalOutstanding > 0 ? accent : BRAND.slate, textColor: totalOutstanding > 0 ? accentText : BRAND.white, width: 42, kind: 'amount' as const },
  ];

  cards.forEach((card) => {
    doc.setFillColor(...card.fill);
    doc.roundedRect(card.x, cardY, card.width, 18, 3, 3, 'F');
    doc.setTextColor(...card.textColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(card.label, card.x + 2.8, cardY + 5.8);

    if (card.kind === 'amount') {
      drawCurrencyValue(doc, Number(card.amount || 0), card.x + card.width - 2.5, cardY + 13.2, {
        align: 'right',
        fontSize: 10.4,
        color: card.textColor,
        font: 'helvetica',
        fontStyle: 'bold',
      });
    } else {
      doc.setFontSize(13);
      doc.text(card.value, card.x + 2.8, cardY + 13.5);
    }
  });

  const rows = (invoices || []).map((invoice: any) => [
    `#${invoice?.id ?? '—'}`,
    invoice?.timestamp ? new Date(invoice.timestamp).toLocaleDateString() : '—',
    String(invoice?.status || 'UNKNOWN').toUpperCase(),
    Number(invoice?.total || 0),
    Number(invoice?.amount_paid || 0),
    Number(invoice?.amount_due || 0),
  ]);

  autoTable(doc, {
    startY: cardY + 26,
    margin: { left: 14, right: 14 },
    head: [['Invoice', 'Date', 'Status', 'Total', 'Paid', 'Due']],
    body: rows,
    theme: 'grid',
    headStyles: {
      fillColor: accent,
      textColor: accentText,
      fontStyle: 'bold',
      fontSize: 9,
      lineColor: border,
      lineWidth: 0.2,
    },
    styles: {
      fontSize: 8.4,
      cellPadding: 3.2,
      lineColor: border,
      lineWidth: 0.2,
      textColor: textDark,
      valign: 'middle',
    },
    alternateRowStyles: { fillColor: [249, 250, 251] },
    columnStyles: {
      0: { cellWidth: 24, halign: 'left', fontStyle: 'bold' },
      1: { cellWidth: 28, halign: 'left' },
      2: { cellWidth: 28, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 34, halign: 'right' },
      5: { cellWidth: 34, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const status = String(data.cell.raw || '').toUpperCase();
        if (status === 'PENDING') {
          data.cell.styles.textColor = [180, 83, 9];
        } else if (status === 'COMPLETED') {
          data.cell.styles.textColor = [22, 101, 52];
        }
      }

      if (data.section === 'body' && data.column.index >= 3) {
        data.cell.text = [''];
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index >= 3) {
        const amount = Number(data.cell.raw || 0);
        drawCurrencyValue(doc, amount, data.cell.x + data.cell.width - 2, getAutoTableTextY(data.cell), {
          align: 'right',
          fontSize: 8.3,
          color: data.column.index === 5 && amount > 0 ? accent : textDark,
          font: 'helvetica',
          fontStyle: 'bold',
        });
      }
    },
  });

  const finalY = (doc as any).lastAutoTable.finalY as number;
  const noteY = ensureSpace(doc, finalY + 12, 34);
  doc.setFillColor(...accentSoft);
  doc.setDrawColor(...border);
  doc.roundedRect(14, noteY, 116, 22, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...textDark);
  doc.text('Statement Note', 20, noteY + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.4);
  doc.setTextColor(...textMuted);
  doc.text(
    doc.splitTextToSize(
      totalOutstanding > 0
        ? `This statement shows an outstanding balance of ${formatPdfInlineCurrency(totalOutstanding)}. Kindly contact ${safeText(store?.name, 'the store')} to settle pending invoices.`
        : 'This customer statement is fully settled at the time of generation.',
      104,
    ),
    20,
    noteY + 12,
  );

  const statementSignatureY = ensureSpace(doc, noteY + 6, 24);
  doc.setDrawColor(...border);
  doc.line(138, statementSignatureY + 12, 190, statementSignatureY + 12);
  const hasStatementSignature = drawContainedImage(doc, store?.signature_image, 138, statementSignatureY, 52, 10, 'right');
  if (!hasStatementSignature) {
    doc.setTextColor(...textDark);
    doc.setFont('times', 'italic');
    doc.setFontSize(14);
    doc.text(safeText(store?.name, 'Goody POS'), 190, statementSignatureY + 10, { align: 'right' });
  }
  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text('Authorized Signatory', 190, statementSignatureY + 17, { align: 'right' });

  return {
    doc,
    filename: `customer-statement-${safeText(customer?.name, 'customer').replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.pdf`,
  };
};

export const generateZReportPDF = async (stats: any, store: any) => {
  setActivePdfCurrency(store?.currency_code);
  const doc = await createPdfDoc({ unit: 'mm', format: 'a4' });
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const reportName = `Z-Report-${now.toISOString().split('T')[0]}`;
  const accent = resolveDocumentAccent(store);
  const accentSoft = tintColor(accent, 0.95);
  const textDark = [24, 24, 27] as [number, number, number];
  const textMuted = [82, 82, 91] as [number, number, number];
  const border = [212, 212, 216] as [number, number, number];
  const total = Number(stats?.total || 0) || 0;
  const cash = Number(stats?.cash || 0) || 0;
  const transfer = Number(stats?.transfer || 0) || 0;
  const pos = Number(stats?.pos || 0) || 0;
  const reconciledTotal = cash + transfer + pos;
  const variance = Number((total - reconciledTotal).toFixed(2)) || 0;

  doc.setDrawColor(...border);
  doc.roundedRect(12, 12, 186, 273, 3, 3, 'S');
  doc.setFillColor(...accent);
  doc.rect(14, 14, 4, 24, 'F');

  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(safeText(store?.name, 'STORE'), 22, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const headerLines = [safeText(store?.address, ''), safeText(store?.phone, '')].filter(Boolean);
  if (headerLines.length > 0) {
    doc.text(headerLines, 22, 28);
  }

  doc.setFillColor(...accentSoft);
  doc.setDrawColor(...border);
  doc.roundedRect(132, 14, 62, 24, 2.5, 2.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...textMuted);
  doc.text('REPORT TYPE', 136, 20);
  doc.text('DATE', 136, 27.5);
  doc.text('TIME', 136, 35);

  doc.setTextColor(...textDark);
  doc.text('END-OF-DAY Z REPORT', 190, 20, { align: 'right' });
  doc.text(dateStr, 190, 27.5, { align: 'right' });
  doc.text(timeStr, 190, 35, { align: 'right' });

  doc.setDrawColor(...border);
  doc.line(14, 45, 196, 45);

  doc.setFillColor(...accentSoft);
  doc.roundedRect(14, 50, 182, 14, 2.5, 2.5, 'FD');
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Daily Sales Reconciliation Summary', 20, 59.2);

  autoTable(doc, {
    startY: 74,
    margin: { left: 14, right: 14 },
    head: [['Account Description', 'Amount']],
    body: [
      ['Total sales recorded', total],
      ['Cash in hand', cash],
      ['Bank transfers', transfer],
      ['POS terminal', pos],
      ['Reconciled total', reconciledTotal],
      ['Variance', variance],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [245, 245, 245],
      textColor: textDark,
      fontStyle: 'bold',
      fontSize: 10,
      lineColor: border,
      lineWidth: 0.25,
    },
    styles: {
      fontSize: 9.5,
      cellPadding: 4,
      lineColor: border,
      lineWidth: 0.2,
      textColor: textDark,
    },
    columnStyles: {
      0: { cellWidth: 112, fontStyle: 'bold' },
      1: { cellWidth: 60, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index >= 4) {
        data.cell.styles.fillColor = accentSoft;
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.column.index === 1) {
        data.cell.text = [''];
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.column.index === 1) {
        const emphasize = data.row.index >= 4;
        const amount = Number(data.cell.raw || 0);
        drawCurrencyValue(doc, amount, data.cell.x + data.cell.width - 4, getAutoTableTextY(data.cell), {
          align: 'right',
          fontSize: emphasize ? 10 : 9.3,
          color: amount < 0 ? accent : textDark,
          font: 'helvetica',
          fontStyle: 'bold',
        });
      }
    },
  });

  const finalY = (doc as any).lastAutoTable.finalY as number;

  doc.setFillColor(...accentSoft);
  doc.setDrawColor(...border);
  doc.roundedRect(14, finalY + 10, 182, 26, 2.5, 2.5, 'FD');
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Accounting Note', 20, finalY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...textMuted);
  doc.text('This Z-report is intended for end-of-day reconciliation of all completed sales and payment channels recorded for the store.', 20, finalY + 24);

  const signatureY = Math.max(finalY + 56, 235);
  doc.setDrawColor(...border);
  doc.line(20, signatureY, 84, signatureY);
  doc.line(126, signatureY, 190, signatureY);
  const hasReviewedSignature = drawContainedImage(doc, store?.signature_image, 126, signatureY - 14, 64, 12, 'right');
  if (!hasReviewedSignature) {
    doc.setTextColor(...textDark);
    doc.setFont('times', 'italic');
    doc.setFontSize(14);
    doc.text(safeText(store?.name, 'Store Owner'), 190, signatureY - 3, { align: 'right' });
  }
  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Prepared by', 20, signatureY + 5);
  doc.text('Reviewed by', 190, signatureY + 5, { align: 'right' });

  doc.line(14, 279, 196, 279);
  doc.setFontSize(8);
  doc.text('Generated by Goody-POS', 14, 284);
  doc.text(`${dateStr} • ${timeStr}`, 196, 284, { align: 'right' });

  return {
    doc,
    filename: `${reportName}.pdf`,
  };
};

export const generateAnalyticsPDF = async (analytics: any, store: any, user?: any) => {
  setActivePdfCurrency(store?.currency_code);
  const doc = await createPdfDoc({ unit: 'mm', format: 'a4' });
  const accent = resolveDocumentAccent(store);
  const accentSoft = tintColor(accent, 0.9);
  const textDark = [30, 41, 59] as [number, number, number];
  const textMuted = [100, 116, 139] as [number, number, number];
  const border = [226, 232, 240] as [number, number, number];
  const now = new Date();
  const reportName = `Analytics-Report-${now.toISOString().split('T')[0]}`;

  doc.setFillColor(...accent);
  doc.roundedRect(14, 12, 182, 24, 4, 4, 'F');
  doc.setTextColor(...BRAND.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(safeText(store?.name, 'Goody POS'), 20, 23);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Real-Time Analytics Report', 20, 30);
  doc.text(now.toLocaleString(), 190, 24, { align: 'right' });
  if (user?.role) {
    doc.text(`Role: ${user.role}`, 190, 30, { align: 'right' });
  }

  autoTable(doc, {
    startY: 46,
    margin: { left: 14, right: 14 },
    head: [['Inventory Metric', 'Value']],
    body: [
      ['Total Items in Stock', String(analytics?.totalItems || 0)],
      ['Inventory Wealth (Cost)', formatPdfInlineCurrency(analytics?.totalCost || 0)],
      ['Potential Revenue (Selling)', formatPdfInlineCurrency(analytics?.potentialRevenue || 0)],
    ],
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 10, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' } },
  });

  let currentY = (doc as any).lastAutoTable.finalY + 10;

  const insightsRows: Array<[string, string]> = [];
  if (analytics?.netProfit != null) insightsRows.push(['Net Profit', formatPdfInlineCurrency(analytics.netProfit || 0)]);
  if (analytics?.missingCostItemCount != null) {
    insightsRows.push([
      'Missing Cost Data',
      analytics?.costFallbackEnabled
        ? `${analytics?.defaultedCostItemCount || 0} defaulted to selling price`
        : `${analytics?.missingCostItemCount || 0} item(s) excluded`,
    ]);
  }
  if (analytics?.imeiAgingPercentage != null) insightsRows.push(['IMEI Aging (>60 days)', `${analytics.imeiAgingPercentage || 0}%`]);
  if (analytics?.todaySales != null) insightsRows.push(['Today Sales', formatPdfInlineCurrency(analytics.todaySales || 0)]);
  if (analytics?.dailyTarget != null) insightsRows.push(['Daily Target', formatPdfInlineCurrency(analytics.dailyTarget || 0)]);

  if (insightsRows.length > 0) {
    autoTable(doc, {
      startY: currentY,
      margin: { left: 14, right: 14 },
      head: [['Performance Insight', 'Value']],
      body: insightsRows,
      theme: 'grid',
      headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
      styles: { fontSize: 9.5, lineColor: border, textColor: textDark },
      columnStyles: { 1: { halign: 'right' } },
    });
    currentY = (doc as any).lastAutoTable.finalY + 10;
  }

  const topCustomers = Array.isArray(analytics?.topCustomers) && analytics.topCustomers.length > 0
    ? analytics.topCustomers.map((c: any, index: number) => [`${index + 1}. ${safeText(c.name, 'Customer')}`, formatPdfInlineCurrency(c.total_spend || 0)])
    : [['No customer data', '—']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: 14, right: 106 },
    head: [['Top Customers', 'Spend']],
    body: topCustomers,
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 8.8, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' } },
  });

  const lowStockRows = Array.isArray(analytics?.lowStockItems) && analytics.lowStockItems.length > 0
    ? analytics.lowStockItems.map((item: any) => [safeText(item.name, 'Item'), `${item.stock ?? 0}`])
    : [['No low stock items', '—']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: 108, right: 14 },
    head: [['Low Stock Item', 'Qty']],
    body: lowStockRows,
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 8.8, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' } },
  });

  currentY = Math.max((doc as any).lastAutoTable.finalY, currentY + 30) + 10;

  const salesTrendRows = Array.isArray(analytics?.salesTrend) && analytics.salesTrend.length > 0
    ? analytics.salesTrend.map((entry: any) => [safeText(entry.date, 'Day'), formatPdfInlineCurrency(entry.total || 0)])
    : [['No sales trend data', '—']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: 14, right: 106 },
    head: [['Sales Trend (Last 7 Days)', 'Amount']],
    body: salesTrendRows,
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 8.8, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' } },
  });

  const categoryRows = Array.isArray(analytics?.categoryTrend) && analytics.categoryTrend.length > 0
    ? analytics.categoryTrend.map((entry: any) => [safeText(entry.category, 'Category'), `${entry.quantity || 0}`])
    : [['No category trend data', '—']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: 108, right: 14 },
    head: [['Fastest Moving Category', 'Qty']],
    body: categoryRows,
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 8.8, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' } },
  });

  const finalY = Math.max((doc as any).lastAutoTable.finalY, currentY + 30) + 12;
  doc.setFillColor(...accentSoft);
  doc.roundedRect(14, finalY, 182, 18, 3, 3, 'F');
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.text('This report summarizes live inventory and sales performance metrics from Goody-POS.', 20, finalY + 11);

  const analyticsSignatureY = ensureSpace(doc, finalY + 28, 20);
  doc.setDrawColor(...border);
  doc.line(140, analyticsSignatureY, 190, analyticsSignatureY);
  const hasAnalyticsSignature = drawContainedImage(doc, store?.signature_image, 140, analyticsSignatureY - 12, 50, 10, 'right');
  if (!hasAnalyticsSignature) {
    doc.setTextColor(...textDark);
    doc.setFont('times', 'italic');
    doc.setFontSize(14);
    doc.text(safeText(store?.name, 'Goody POS'), 190, analyticsSignatureY - 2, { align: 'right' });
  }
  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  doc.text('Authorized Signatory', 190, analyticsSignatureY + 5, { align: 'right' });

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Generated by Goody-POS', 105, 286, { align: 'center' });

  return {
    doc,
    filename: `${reportName}.pdf`
  };
};

export const generateStoreActivityArchivePDF = async (summary: any, store: any, user?: any) => {
  setActivePdfCurrency(store?.currency_code);

  const doc = await createPdfDoc({ unit: 'mm', format: 'a4' });
  const accent = resolveDocumentAccent(store);
  const textDark = [15, 23, 42] as [number, number, number];
  const textMuted = [100, 116, 139] as [number, number, number];
  const border = [226, 232, 240] as [number, number, number];
  const now = new Date();
  const rangeLabel = String(summary?.range?.label || 'Selected retention window');

  doc.setFillColor(...accent);
  doc.roundedRect(14, 12, 182, 24, 4, 4, 'F');
  doc.setTextColor(...BRAND.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(safeText(store?.name || summary?.store?.name, 'Goody POS'), 20, 23);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Store Activity Archive Report', 20, 30);
  doc.text(now.toLocaleString(), 190, 24, { align: 'right' });
  doc.text(`Range: ${rangeLabel}`, 190, 30, { align: 'right' });

  autoTable(doc, {
    startY: 44,
    margin: { left: 14, right: 14 },
    head: [['Key Metric', 'Value']],
    body: [
      ['Sales Count', String(summary?.totals?.sales_count || 0)],
      ['Sales Total', formatPdfInlineCurrency(summary?.totals?.sales_total || 0)],
      ['Discount Total', formatPdfInlineCurrency(summary?.totals?.discount_total || 0)],
      ['Tax Total', formatPdfInlineCurrency(summary?.totals?.tax_total || 0)],
      ['Expense Count', String(summary?.totals?.expense_count || 0)],
      ['Expense Total', formatPdfInlineCurrency(summary?.totals?.expense_total || 0)],
    ],
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 10, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' } },
  });

  const normalizeArchiveProductName = (value: any) => {
    const raw = String(value || '').trim();
    if (raw === '__SOURCED_PLACEHOLDER__') return 'Sourced Item';
    if (raw === '__CONSIGNMENT_PLACEHOLDER__') return 'Consignment Item';
    return raw || 'Product';
  };

  const topProducts = Array.isArray(summary?.topProducts) && summary.topProducts.length > 0
    ? summary.topProducts.map((row: any, index: number) => [
        `${index + 1}. ${safeText(normalizeArchiveProductName(row?.name), 'Product')}`,
        String(Number(row?.quantity || 0) || 0),
        formatPdfInlineCurrency(row?.revenue || 0),
      ])
    : [['No product activity', '0', '0.00']];

  let currentY = (doc as any).lastAutoTable.finalY + 10;
  autoTable(doc, {
    startY: currentY,
    margin: { left: 14, right: 106 },
    head: [['Top Product', 'Qty', 'Revenue']],
    body: topProducts,
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 8.8, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  });

  const topStaff = Array.isArray(summary?.topStaff) && summary.topStaff.length > 0
    ? summary.topStaff.map((row: any, index: number) => [
        `${index + 1}. ${safeText(row?.username, 'Staff')}`,
        String(Number(row?.sales_count || 0) || 0),
        formatPdfInlineCurrency(row?.sales_total || 0),
      ])
    : [['No staff activity', '0', '0.00']];

  autoTable(doc, {
    startY: currentY,
    margin: { left: 108, right: 14 },
    head: [['Top Staff', 'Sales', 'Total']],
    body: topStaff,
    theme: 'grid',
    headStyles: { fillColor: accent, textColor: BRAND.white, fontStyle: 'bold' },
    styles: { fontSize: 8.8, lineColor: border, textColor: textDark },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
  });

  currentY = Math.max((doc as any).lastAutoTable.finalY, currentY + 30) + 12;
  doc.setFillColor(...tintColor(accent, 0.9));
  doc.roundedRect(14, currentY, 182, 20, 3, 3, 'F');
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Pre-Deletion Archive Confirmation', 20, currentY + 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...textMuted);
  doc.text(`Generated by ${safeText(user?.username, 'System')} on ${now.toLocaleString()}`, 20, currentY + 14);

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Generated by Goody-POS', 105, 286, { align: 'center' });

  return {
    doc,
    filename: `store-activity-archive-${now.toISOString().slice(0, 10)}.pdf`,
  };
};

export const generateMarketCollectionSlipPDF = async (entry: any, store: any) => {
  setActivePdfCurrency(store?.currency_code);

  const doc = await createPdfDoc({ unit: 'mm', format: [88, 150] });
  const accent = resolveDocumentAccent(store);
  const accentSoft = tintColor(accent, 0.9);
  const accentText = getContrastTextColor(accent);
  const textDark = [15, 23, 42] as [number, number, number];
  const textMuted = [100, 116, 139] as [number, number, number];
  const border = [226, 232, 240] as [number, number, number];
  const items = Array.isArray(entry?.items) ? entry.items : [];
  const status = String(entry?.status || 'OPEN').toUpperCase();
  const trackingCode = safeText(entry?.tracking_code, `MC-${entry?.id ?? '—'}`);
  const collectorName = safeText(entry?.collector_name, 'Walk-in Collector');
  const collectorPhone = safeText(entry?.phone, 'No phone');
  const totalValue = Number(entry?.total_value || 0) || 0;
  const note = String(entry?.note || '').trim();

  const formatCollectionDate = (value?: unknown) => {
    const rawValue = String(value || '').trim();
    if (!rawValue) return '—';
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
      ? new Date(`${rawValue}T12:00:00`)
      : new Date(rawValue);
    return Number.isNaN(parsed.getTime()) ? rawValue : parsed.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  };

  doc.setFillColor(...BRAND.light);
  doc.rect(0, 0, 88, 150, 'F');

  doc.setFillColor(...accent);
  doc.roundedRect(6, 6, 76, 20, 4, 4, 'F');
  doc.setTextColor(...accentText);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(safeText(store?.name, 'Goody POS'), 44, 14, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.text('Market Collection Slip', 44, 20, { align: 'center' });

  doc.setFillColor(...accentSoft);
  doc.roundedRect(6, 30, 76, 18, 3, 3, 'F');
  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('REFERENCE', 44, 35.5, { align: 'center' });
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(trackingCode, 44, 43.5, { align: 'center' });

  doc.setFillColor(...BRAND.white);
  doc.setDrawColor(...border);
  doc.roundedRect(6, 52, 76, 22, 3, 3, 'FD');
  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text('COLLECTOR', 10, 58.5);
  doc.text('STATUS', 58, 58.5);
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(collectorName, 10, 64.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.text(collectorPhone, 10, 69.5);
  doc.setFont('helvetica', 'bold');
  doc.text(status, 58, 64.5);

  doc.setFillColor(...BRAND.white);
  doc.setDrawColor(...border);
  doc.roundedRect(6, 78, 36, 16, 3, 3, 'FD');
  doc.roundedRect(46, 78, 36, 16, 3, 3, 'FD');
  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.2);
  doc.text('DUE DATE', 10, 84);
  doc.text('CREATED', 50, 84);
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(formatCollectionDate(entry?.expected_return_date), 10, 89.5);
  doc.text(formatCollectionDate(entry?.created_at), 50, 89.5);

  autoTable(doc, {
    startY: 98,
    margin: { left: 6, right: 6 },
    head: [['Item', 'Qty']],
    body: (items.length ? items : [{ name: 'No items recorded', quantity: '—', condition: null }]).map((item: any) => [
      `${safeText(item?.name, 'Item')}${item?.condition ? ` (${String(item.condition).replace(/_/g, ' ')})` : ''}`,
      String(item?.quantity ?? 1),
    ]),
    theme: 'grid',
    headStyles: {
      fillColor: accent,
      textColor: accentText,
      fontStyle: 'bold',
      fontSize: 7,
      lineColor: border,
      lineWidth: 0.15,
    },
    styles: {
      fontSize: 6.8,
      cellPadding: 2,
      lineColor: border,
      lineWidth: 0.15,
      textColor: textDark,
      valign: 'middle',
    },
    columnStyles: {
      0: { cellWidth: 58 },
      1: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
    },
  });

  const finalY = Math.min(124, Number((doc as any).lastAutoTable?.finalY || 108) + 4);

  doc.setFillColor(...accentSoft);
  doc.roundedRect(6, finalY, 76, 12, 3, 3, 'F');
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('TOTAL VALUE', 10, finalY + 7.7);
  drawCurrencyValue(doc, totalValue, 78, finalY + 7.8, {
    align: 'right',
    fontSize: 9.2,
    color: textDark,
    font: 'helvetica',
    fontStyle: 'bold',
    currencyCode: store?.currency_code,
  });

  if (note) {
    const noteY = finalY + 16;
    doc.setFillColor(...BRAND.white);
    doc.setDrawColor(...border);
    doc.roundedRect(6, noteY, 76, 16, 3, 3, 'FD');
    doc.setTextColor(...textMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.2);
    doc.text('NOTE', 10, noteY + 5.5);
    doc.setTextColor(...textDark);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.8);
    doc.text(doc.splitTextToSize(note, 68), 10, noteY + 10);
  }

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.4);
  doc.text('Generated by Goody-POS', 44, 145, { align: 'center' });

  return {
    doc,
    filename: `market-collection-${trackingCode}.pdf`,
    pdfUrl: doc.output('bloburl'),
  };
};

export const generateProformaPDF = async (proforma: any, store: any) => {
  setActivePdfCurrency(store?.currency_code);
  const doc = await createPdfDoc({ unit: 'mm', format: 'a4' });
  const createdAt = proforma?.created_at || new Date().toISOString();
  const createdDate = new Date(createdAt);
  const validUntil = new Date(proforma?.expiry_date || createdAt);
  const reference = buildReference('PRO', proforma?.id, createdAt);
  const customer = resolveCustomer(proforma);
  const items = Array.isArray(proforma?.items) ? proforma.items : [];
  const totalAmount = Number(proforma?.total) || 0;
  const taxAmount = Math.max(0, Number(proforma?.tax_amount) || 0);
  const taxPercentage = Math.max(0, Number(proforma?.tax_percentage) || 0);
  const subtotalAmount = Math.max(0, Number(proforma?.subtotal ?? (totalAmount - taxAmount)) || 0);
  const receiptHeaderNote = resolveReceiptHeaderNote(store);
  const receiptFooterNote = resolveReceiptFooterNote(store, 'Thanks for your business!');
  const showBankDetails = shouldShowBankDetails(store);
  const discountAmount = 0;
  const validityDays = Math.max(1, Math.ceil((validUntil.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)));
  const accent = resolveDocumentAccent(store);
  const dark = [45, 45, 52] as [number, number, number];
  const textDark = [36, 36, 36] as [number, number, number];
  const textMuted = [108, 108, 108] as [number, number, number];
  const border = [218, 218, 218] as [number, number, number];
  const createdLabel = createdDate.toLocaleDateString();
  const dueLabel = Number.isNaN(validUntil.getTime()) ? createdLabel : validUntil.toLocaleDateString();
  const infoStartX = 138;

  doc.setFillColor(248, 248, 248);
  doc.rect(0, 0, 210, 297, 'F');

  doc.setDrawColor(...border);
  doc.setLineWidth(0.5);
  doc.line(14, 44, 196, 44);

  doc.setFillColor(...dark);
  doc.rect(132, 16, 64, 18, 'F');
  doc.setFillColor(...accent);
  doc.rect(174, 16, 22, 7, 'F');
  doc.rect(14, 276, 182, 3, 'F');
  doc.setFillColor(...dark);
  doc.rect(14, 279, 100, 4, 'F');
  doc.rect(130, 279, 66, 4, 'F');

  const showStoreNameOnDocument = shouldShowStoreNameOnDocuments(store);
  const logoRendered = drawContainedImage(doc, store?.logo, 20, 16, 24, 18, 'left');

  if (!logoRendered) {
    doc.setFillColor(...accent);
    doc.roundedRect(20, 18, 16, 16, 4, 4, 'F');
    doc.setTextColor(...BRAND.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(safeText(store?.name, 'G').charAt(0).toUpperCase(), 28, 29, { align: 'center' });
  }

  doc.setTextColor(...textDark);
  let contactY = 29;

  if (showStoreNameOnDocument || !logoRendered) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(safeText(store?.name, 'Goody POS'), 42, 24);
    contactY = 29;
  } else {
    contactY = 25.5;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...textMuted);
  doc.text(safeText(store?.address, 'Business address'), 42, contactY);
  if (store?.phone) {
    doc.text(safeText(store?.phone), 42, contactY + 4.5);
  }
  if (receiptHeaderNote) {
    doc.setTextColor(...accent);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.2);
    doc.text(doc.splitTextToSize(receiptHeaderNote, 84), 20, 40.5);
  }

  doc.setTextColor(...BRAND.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('PRO FORMA', 186, 28, { align: 'right' });

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Invoice To:', 20, 59);

  doc.setTextColor(...accent);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(safeText(customer.name, 'Walk-in Customer').toUpperCase(), 20, 66.5);

  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.7);
  const customerLines = [
    customer.phone ? `P: ${customer.phone}` : '',
    customer.address ? `A: ${customer.address}` : '',
  ].filter(Boolean);
  if (customerLines.length > 0) {
    doc.text(doc.splitTextToSize(customerLines.join('\n'), 74), 20, 72);
  }

  doc.setFillColor(...dark);
  doc.roundedRect(infoStartX, 58, 50, 8, 1.5, 1.5, 'F');
  doc.setTextColor(...BRAND.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(`PROFORMA NO: ${reference}`, infoStartX + 25, 63.3, { align: 'center' });

  const infoRows = [
    ...(showBankDetails ? [['Account No', safeText(store?.account_number, 'Not set')] as [string, string]] : []),
    ['Invoice Date', createdLabel],
    ['Valid Until', dueLabel],
    ['Terms', `${validityDays} day${validityDays === 1 ? '' : 's'}`],
  ];

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  infoRows.forEach(([label, value], index) => {
    const y = 72 + index * 5.5;
    doc.text(`${label}`, infoStartX, y);
    doc.setTextColor(...textDark);
    doc.text(String(value), 188, y, { align: 'right' });
    doc.setTextColor(...textMuted);
  });

  const bodyRows = items.map((item: any) => {
    const quantity = Number(item.quantity ?? 1);
    const unitPrice = Number(item.price_at_sale ?? item.price ?? 0);
    const details = getItemDetailLines(item);

    return [
      [safeText(item.name), ...details].join('\n'),
      Number.isInteger(quantity) ? quantity.toString() : quantity.toFixed(2),
      unitPrice,
      unitPrice * quantity,
    ];
  });

  autoTable(doc, {
    startY: 94,
    margin: { left: 20, right: 20 },
    head: [['Item description', 'Quantity', 'Unit Price', 'Total Price']],
    body: bodyRows,
    theme: 'grid',
    headStyles: {
      textColor: BRAND.white,
      fontStyle: 'bold',
      fontSize: 9.2,
      halign: 'center',
      lineColor: border,
      lineWidth: 0.2,
    },
    styles: {
      fontSize: 8.8,
      cellPadding: 3.5,
      lineColor: border,
      lineWidth: 0.2,
      textColor: textDark,
      valign: 'top',
    },
    alternateRowStyles: { fillColor: [244, 244, 244] },
    columnStyles: {
      0: { cellWidth: 82, fontStyle: 'bold' },
      1: { cellWidth: 24, halign: 'center', fontStyle: 'bold' },
      2: { cellWidth: 32, halign: 'right' },
      3: { cellWidth: 32, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 0 || data.column.index === 2) {
          data.cell.styles.fillColor = accent;
        } else {
          data.cell.styles.fillColor = dark;
        }
      }

      if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) {
        data.cell.text = [''];
      }
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) {
        drawCurrencyValue(doc, Number(data.cell.raw || 0), data.cell.x + data.cell.width - 2, getAutoTableTextY(data.cell), {
          align: 'right',
          fontSize: 8.7,
          color: textDark,
          font: 'helvetica',
          fontStyle: 'bold',
        });
      }
    },
  });

  const finalY = (doc as any).lastAutoTable.finalY as number;
  const summaryY = ensureSpace(doc, finalY + 10, 92);

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Payment method', 20, summaryY + 4);

  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(
    showBankDetails
      ? [
          `Account: ${safeText(store?.account_number, 'Not configured')}`,
          `Bank: ${safeText(store?.bank_name, 'Not configured')}`,
          `Account Name: ${safeText(store?.account_name || store?.name, 'Not configured')}`,
        ]
      : ['Payment details are intentionally hidden on this pro-forma.', 'Share the approved payment channel manually when needed.'],
    20,
    summaryY + 11
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...textMuted);
  doc.text('Terms & Conditions:', 20, summaryY + 31);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.8);
  doc.text(
    doc.splitTextToSize(
      `This quotation is valid for ${validityDays} day${validityDays === 1 ? '' : 's'}. Payment confirms acceptance of pricing, and item release follows successful payment confirmation.`,
      78
    ),
    20,
    summaryY + 36
  );

  const summaryX = 138;
  const summaryWidth = 50;
  const summaryRows = [
    { label: 'Sub Total', amount: subtotalAmount },
    { label: `Vat & Tax ${formatPercentage(taxPercentage)}%`, amount: taxAmount },
    { label: 'Discount 0%', amount: discountAmount },
  ];

  let currentSummaryRowY = summaryY + 4;
  summaryRows.forEach((row) => {
    currentSummaryRowY = drawResponsiveCurrencySummaryRow(doc, {
      label: row.label,
      amount: row.amount,
      x: summaryX,
      rightX: 188,
      y: currentSummaryRowY,
      color: textDark,
      fontSize: 10.2,
      minFontSize: 8.4,
    });
  });

  const grandTotalBoxY = currentSummaryRowY + 1.5;
  const grandTotalBoxHeight = drawResponsiveCurrencyTotalBox(doc, {
    label: 'Grand Total',
    amount: totalAmount,
    x: summaryX - 2,
    y: grandTotalBoxY,
    width: summaryWidth + 4,
    fillColor: accent,
    textColor: BRAND.white,
    preferredFontSize: 11.5,
    minFontSize: 8.6,
  });

  const footerY = Math.max(grandTotalBoxY + grandTotalBoxHeight + 20, 248);
  doc.setTextColor(...textDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(receiptFooterNote, 100), 20, footerY + 4);

  doc.setDrawColor(170, 170, 170);
  doc.line(146, footerY + 10, 188, footerY + 10);
  const hasProformaSignature = drawContainedImage(doc, store?.signature_image, 146, footerY - 2, 42, 10, 'right');
  if (!hasProformaSignature) {
    doc.setFont('times', 'italic');
    doc.setFontSize(21);
    doc.text(safeText(store?.name, 'Goody POS'), 188, footerY + 6, { align: 'right' });
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Authorized Signatory', 188, footerY + 15, { align: 'right' });

  doc.setTextColor(...textMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const contactFooter = [safeText(store?.phone, ''), safeText(store?.address, ''), safeText(store?.account_name || '', '')]
    .filter(Boolean)
    .join('   •   ');
  if (contactFooter) {
    doc.text(contactFooter, 105, 271, { align: 'center' });
  }

  return {
    doc,
    filename: `${reference}.pdf`,
  };
};

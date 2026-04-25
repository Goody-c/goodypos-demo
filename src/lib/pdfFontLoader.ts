type LoadedPdfFonts = {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
};

const PDF_FONT_FILES = {
  regular: 'NotoSans-Regular.ttf',
  bold: 'NotoSans-Bold.ttf',
  italic: 'NotoSans-Italic.ttf',
  boldItalic: 'NotoSans-BoldItalic.ttf',
} as const;

let cachedPdfFontsPromise: Promise<LoadedPdfFonts> | null = null;

const resolvePublicFontUrl = (fileName: string) => {
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(`fonts/${fileName}`, document.baseURI).toString();
  }

  return `/fonts/${fileName}`;
};

const arrayBufferToBinaryString = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let result = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    result += String.fromCharCode(...chunk);
  }

  return result;
};

const fetchFontBinary = async (fileName: string) => {
  const response = await fetch(resolvePublicFontUrl(fileName), { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Failed to load PDF font asset: ${fileName}`);
  }

  const buffer = await response.arrayBuffer();
  return arrayBufferToBinaryString(buffer);
};

export const loadPdfFonts = async (): Promise<LoadedPdfFonts> => {
  if (!cachedPdfFontsPromise) {
    cachedPdfFontsPromise = Promise.all([
      fetchFontBinary(PDF_FONT_FILES.regular),
      fetchFontBinary(PDF_FONT_FILES.bold),
      fetchFontBinary(PDF_FONT_FILES.italic),
      fetchFontBinary(PDF_FONT_FILES.boldItalic),
    ]).then(([regular, bold, italic, boldItalic]) => ({
      regular,
      bold,
      italic,
      boldItalic,
    }));
  }

  return cachedPdfFontsPromise;
};

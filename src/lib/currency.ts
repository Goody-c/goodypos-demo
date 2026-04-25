import { safeStorage } from './storage';

export type CurrencyOption = {
  code: string;
  label: string;
  symbol: string;
  locale: string;
};

export const POPULAR_CURRENCIES: CurrencyOption[] = [
  { code: 'USD', label: 'US Dollar', symbol: '$', locale: 'en-US' },
  { code: 'NGN', label: 'Nigerian Naira', symbol: '₦', locale: 'en-NG' },
  { code: 'EUR', label: 'Euro', symbol: '€', locale: 'de-DE' },
  { code: 'GBP', label: 'British Pound Sterling', symbol: '£', locale: 'en-GB' },
  { code: 'GHS', label: 'Ghanaian Cedi', symbol: 'GH₵', locale: 'en-GH' },
  { code: 'KES', label: 'Kenyan Shilling', symbol: 'KSh', locale: 'en-KE' },
  { code: 'UGX', label: 'Ugandan Shilling', symbol: 'USh', locale: 'en-UG' },
  { code: 'TZS', label: 'Tanzanian Shilling', symbol: 'TSh', locale: 'sw-TZ' },
  { code: 'RWF', label: 'Rwandan Franc', symbol: 'RF', locale: 'en-RW' },
  { code: 'ZAR', label: 'South African Rand', symbol: 'R', locale: 'en-ZA' },
  { code: 'XOF', label: 'West African CFA Franc', symbol: 'CFA', locale: 'fr-SN' },
  { code: 'XAF', label: 'Central African CFA Franc', symbol: 'FCFA', locale: 'fr-CM' },
  { code: 'EGP', label: 'Egyptian Pound', symbol: 'E£', locale: 'ar-EG' },
  { code: 'MAD', label: 'Moroccan Dirham', symbol: 'MAD', locale: 'fr-MA' },
  { code: 'TND', label: 'Tunisian Dinar', symbol: 'TND', locale: 'fr-TN' },
  { code: 'AED', label: 'UAE Dirham', symbol: 'د.إ', locale: 'ar-AE' },
  { code: 'SAR', label: 'Saudi Riyal', symbol: '﷼', locale: 'ar-SA' },
  { code: 'QAR', label: 'Qatari Riyal', symbol: 'ر.ق', locale: 'ar-QA' },
  { code: 'KWD', label: 'Kuwaiti Dinar', symbol: 'KD', locale: 'ar-KW' },
  { code: 'BHD', label: 'Bahraini Dinar', symbol: 'BD', locale: 'ar-BH' },
  { code: 'OMR', label: 'Omani Rial', symbol: 'ر.ع.', locale: 'ar-OM' },
  { code: 'INR', label: 'Indian Rupee', symbol: '₹', locale: 'en-IN' },
  { code: 'PKR', label: 'Pakistani Rupee', symbol: '₨', locale: 'en-PK' },
  { code: 'BDT', label: 'Bangladeshi Taka', symbol: '৳', locale: 'bn-BD' },
  { code: 'LKR', label: 'Sri Lankan Rupee', symbol: 'Rs', locale: 'en-LK' },
  { code: 'NPR', label: 'Nepalese Rupee', symbol: 'रू', locale: 'en-NP' },
  { code: 'CNY', label: 'Chinese Yuan', symbol: '¥', locale: 'zh-CN' },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥', locale: 'ja-JP' },
  { code: 'KRW', label: 'South Korean Won', symbol: '₩', locale: 'ko-KR' },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$', locale: 'en-SG' },
  { code: 'MYR', label: 'Malaysian Ringgit', symbol: 'RM', locale: 'ms-MY' },
  { code: 'THB', label: 'Thai Baht', symbol: '฿', locale: 'th-TH' },
  { code: 'IDR', label: 'Indonesian Rupiah', symbol: 'Rp', locale: 'id-ID' },
  { code: 'PHP', label: 'Philippine Peso', symbol: '₱', locale: 'en-PH' },
  { code: 'VND', label: 'Vietnamese Dong', symbol: '₫', locale: 'vi-VN' },
  { code: 'HKD', label: 'Hong Kong Dollar', symbol: 'HK$', locale: 'zh-HK' },
  { code: 'TWD', label: 'New Taiwan Dollar', symbol: 'NT$', locale: 'zh-TW' },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$', locale: 'en-AU' },
  { code: 'NZD', label: 'New Zealand Dollar', symbol: 'NZ$', locale: 'en-NZ' },
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'CA$', locale: 'en-CA' },
  { code: 'MXN', label: 'Mexican Peso', symbol: 'MX$', locale: 'es-MX' },
  { code: 'BRL', label: 'Brazilian Real', symbol: 'R$', locale: 'pt-BR' },
  { code: 'ARS', label: 'Argentine Peso', symbol: 'AR$', locale: 'es-AR' },
  { code: 'CLP', label: 'Chilean Peso', symbol: 'CLP$', locale: 'es-CL' },
  { code: 'COP', label: 'Colombian Peso', symbol: 'COP$', locale: 'es-CO' },
  { code: 'PEN', label: 'Peruvian Sol', symbol: 'S/', locale: 'es-PE' },
  { code: 'DOP', label: 'Dominican Peso', symbol: 'RD$', locale: 'es-DO' },
  { code: 'JMD', label: 'Jamaican Dollar', symbol: 'J$', locale: 'en-JM' },
  { code: 'CHF', label: 'Swiss Franc', symbol: 'CHF', locale: 'de-CH' },
  { code: 'SEK', label: 'Swedish Krona', symbol: 'kr', locale: 'sv-SE' },
  { code: 'NOK', label: 'Norwegian Krone', symbol: 'kr', locale: 'nb-NO' },
  { code: 'DKK', label: 'Danish Krone', symbol: 'kr', locale: 'da-DK' },
  { code: 'PLN', label: 'Polish Złoty', symbol: 'zł', locale: 'pl-PL' },
  { code: 'CZK', label: 'Czech Koruna', symbol: 'Kč', locale: 'cs-CZ' },
  { code: 'HUF', label: 'Hungarian Forint', symbol: 'Ft', locale: 'hu-HU' },
  { code: 'RON', label: 'Romanian Leu', symbol: 'lei', locale: 'ro-RO' },
  { code: 'TRY', label: 'Turkish Lira', symbol: '₺', locale: 'tr-TR' },
  { code: 'RUB', label: 'Russian Ruble', symbol: '₽', locale: 'ru-RU' },
  { code: 'UAH', label: 'Ukrainian Hryvnia', symbol: '₴', locale: 'uk-UA' },
  { code: 'ILS', label: 'Israeli New Shekel', symbol: '₪', locale: 'he-IL' },
];

const DEFAULT_CURRENCY = POPULAR_CURRENCIES[0];
const STORAGE_KEY = 'goodypos_currency_config';
const currencyMap = new Map(POPULAR_CURRENCIES.map((entry) => [entry.code, entry]));

export const getCurrencyConfig = (code?: unknown): CurrencyOption => {
  const normalizedCode = String(code || '').trim().toUpperCase();
  return currencyMap.get(normalizedCode) || DEFAULT_CURRENCY;
};

export const readCurrencyPreference = (): CurrencyOption => {
  const raw = safeStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_CURRENCY;

  try {
    const parsed = JSON.parse(raw) as Partial<CurrencyOption>;
    return getCurrencyConfig(parsed?.code);
  } catch {
    return DEFAULT_CURRENCY;
  }
};

export const applyCurrencyPreferenceFromStore = (store: { currency_code?: unknown } | null | undefined) => {
  const resolved = getCurrencyConfig(store?.currency_code);
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(resolved));
  return resolved;
};

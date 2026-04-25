import { safeStorage } from './storage';
import { applyCurrencyPreferenceFromStore } from './currency';

export const appFetch = async (url: string, options: RequestInit = {}) => {
  const token = safeStorage.getItem('ominous_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers, cache: options.cache ?? 'no-store' });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : await response.text();
  const authMessage = typeof data === 'object'
    ? String(data?.error || '')
    : String(data || '');
  const shouldForceLogout = response.status === 401 && /unauthorized|invalid token/i.test(authMessage);

  if (shouldForceLogout) {
    safeStorage.removeItem('ominous_token');
    safeStorage.removeItem('ominous_user');
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
    return { error: 'Unauthorized', status: 401 };
  }

  if (!response.ok) {
    const message = typeof data === 'object'
      ? (data.error || 'Something went wrong')
      : (() => {
          const text = String(data || '').trim();
          if (/<!doctype html|<html/i.test(text)) {
            return `Request failed (${response.status} ${response.statusText || 'Server Error'})`;
          }
          return text || `Request failed (${response.status})`;
        })();

    throw new Error(message);
  }

  if (/\/api\/store\/settings$/i.test(url) && typeof data === 'object' && data) {
    applyCurrencyPreferenceFromStore(data as { currency_code?: unknown });
  }

  return data;
};

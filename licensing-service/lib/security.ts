import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env.js';

const LICENSE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DASHBOARD_ACCESS_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export const normalizeLicenseKey = (value: unknown) => {
  const compact = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  if (!compact) return '';

  const prefixMatch = compact.match(/^[A-Z]{3}(?=[A-Z0-9]{5,}$)/);
  if (prefixMatch) {
    const prefix = prefixMatch[0];
    const remainder = compact.slice(prefix.length);
    const groupedRemainder = remainder.match(/.{1,5}/g)?.join('-') || remainder;
    return groupedRemainder ? `${prefix}-${groupedRemainder}` : prefix;
  }

  return compact.match(/.{1,5}/g)?.join('-') || compact;
};

export const generateLicenseKey = (prefix = 'GDP') => {
  const chars = Array.from(randomBytes(15), (byte) => LICENSE_CHARS[byte % LICENSE_CHARS.length]);
  const parts = [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10, 15)].map((segment) => segment.join(''));
  return `${prefix}-${parts.join('-')}`;
};

export const hashDeviceFingerprint = (value: unknown) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return createHash('sha256').update(normalized).digest('hex');
};

const signPayload = (payload: Record<string, unknown>) => {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', env.licenseSigningSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
};

export const signLicenseSnapshot = (payload: Record<string, unknown>) => signPayload(payload);

export const signDashboardAccessToken = () => signPayload({
  type: 'dashboard-access',
  exp: Date.now() + DASHBOARD_ACCESS_TOKEN_TTL_MS,
});

export const verifyDashboardAccessToken = (token: unknown) => {
  const raw = String(token || '').trim();
  if (!raw) return false;

  const [body, signature] = raw.split('.');
  if (!body || !signature) return false;

  const expected = createHmac('sha256', env.licenseSigningSecret).update(body).digest('base64url');
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { type?: string; exp?: number };
    return payload.type === 'dashboard-access' && Number(payload.exp || 0) > Date.now();
  } catch {
    return false;
  }
};

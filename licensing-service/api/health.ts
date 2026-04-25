import { ensureMethod, sendJson, type ApiRequest, type ApiResponse } from '../lib/http.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!ensureMethod(req, res, ['GET'])) return;

  const requiredEnv = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ADMIN_API_KEY',
    'LICENSE_SIGNING_SECRET',
  ] as const;

  const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());

  sendJson(res, 200, {
    ok: true,
    service: 'goodypos-license-service',
    activationRequiresInternet: true,
    activationMode: 'one-time-online-activation',
    configured: missingEnv.length === 0,
    missingEnv,
    timestamp: new Date().toISOString(),
  });
}

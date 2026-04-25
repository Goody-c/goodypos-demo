import { env } from '../../lib/env.js';
import { ensureMethod, readJsonBody, sendJson, type ApiRequest, type ApiResponse } from '../../lib/http.js';
import { signDashboardAccessToken } from '../../lib/security.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!ensureMethod(req, res, ['POST'])) return;

  try {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const password = String(body.password || '').trim();

    if (!password) {
      sendJson(res, 400, {
        ok: false,
        error: 'Password is required',
      });
      return;
    }

    if (password !== env.dashboardAccessPassword) {
      sendJson(res, 401, {
        ok: false,
        error: 'Invalid dashboard password',
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      message: 'Dashboard unlocked successfully',
      token: signDashboardAccessToken(),
      expiresInHours: 12,
    });
  } catch (error) {
    console.error('Failed to unlock dashboard:', error);
    sendJson(res, 500, {
      ok: false,
      error: 'Failed to unlock dashboard',
    });
  }
}

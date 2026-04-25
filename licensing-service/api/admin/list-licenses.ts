import { ensureMethod, getQueryParams, requireAdmin, sendJson, type ApiRequest, type ApiResponse } from '../../lib/http.js';
import { listLicenses, sanitizeLicense, type LicenseStatus } from '../../lib/licenses.js';

const VALID_STATUSES: LicenseStatus[] = ['UNUSED', 'ACTIVE', 'REVOKED', 'EXPIRED'];

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!ensureMethod(req, res, ['GET'])) return;
  if (!requireAdmin(req, res)) return;

  try {
    const searchParams = getQueryParams(req);
    const rawStatus = String(searchParams.get('status') || '').trim().toUpperCase();
    const requestedStatus = VALID_STATUSES.includes(rawStatus as LicenseStatus)
      ? (rawStatus as LicenseStatus)
      : undefined;

    const licenses = await listLicenses(requestedStatus);

    sendJson(res, 200, {
      ok: true,
      count: licenses.length,
      licenses: licenses.map(sanitizeLicense),
    });
  } catch (error) {
    console.error('Failed to list licenses:', error);
    sendJson(res, 500, {
      ok: false,
      error: 'Failed to list licenses',
    });
  }
}

import { ensureMethod, readJsonBody, requireAdmin, sendJson, type ApiRequest, type ApiResponse } from '../../lib/http.js';
import { getLicenseByKey, recordLicenseEvent, sanitizeLicense, updateLicenseById } from '../../lib/licenses.js';
import { normalizeLicenseKey } from '../../lib/security.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!ensureMethod(req, res, ['POST'])) return;
  if (!requireAdmin(req, res)) return;

  try {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const licenseKey = normalizeLicenseKey(body.licenseKey);
    const reason = String(body.reason || '').trim();

    if (!licenseKey) {
      sendJson(res, 400, {
        ok: false,
        error: 'licenseKey is required',
      });
      return;
    }

    const license = await getLicenseByKey(licenseKey);
    if (!license) {
      sendJson(res, 404, {
        ok: false,
        error: 'License key not found',
      });
      return;
    }

    const mergedNotes = [license.notes || '', reason ? `Revoked: ${reason}` : '']
      .filter(Boolean)
      .join('\n');

    const updated = await updateLicenseById(license.id, {
      status: 'REVOKED',
      revoked_at: new Date().toISOString(),
      validation_due_at: null,
      notes: mergedNotes || null,
    });

    await recordLicenseEvent(updated.id, 'revoked', { reason });

    sendJson(res, 200, {
      ok: true,
      message: 'License revoked successfully',
      license: sanitizeLicense(updated),
    });
  } catch (error) {
    console.error('Failed to revoke license:', error);
    sendJson(res, 500, {
      ok: false,
      error: 'Failed to revoke license',
    });
  }
}

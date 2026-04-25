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

    const mergedNotes = [license.notes || '', reason ? `Device reset: ${reason}` : '']
      .filter(Boolean)
      .join('\n');

    const updated = await updateLicenseById(license.id, {
      status: 'UNUSED',
      device_fingerprint_hash: null,
      activated_device_name: null,
      activated_at: null,
      last_validated_at: null,
      validation_due_at: null,
      store_name: null,
      store_mode: null,
      revoked_at: null,
      notes: mergedNotes || null,
    });

    await recordLicenseEvent(updated.id, 'device_reset', { reason });

    sendJson(res, 200, {
      ok: true,
      message: 'Device binding reset successfully',
      license: sanitizeLicense(updated),
    });
  } catch (error) {
    console.error('Failed to reset device:', error);
    sendJson(res, 500, {
      ok: false,
      error: 'Failed to reset device binding',
    });
  }
}

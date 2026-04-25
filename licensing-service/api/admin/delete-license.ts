import { ensureMethod, readJsonBody, requireAdmin, sendJson, type ApiRequest, type ApiResponse } from '../../lib/http.js';
import { deleteLicenseById, getLicenseByKey, sanitizeLicense } from '../../lib/licenses.js';
import { normalizeLicenseKey } from '../../lib/security.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!ensureMethod(req, res, ['POST'])) return;
  if (!requireAdmin(req, res)) return;

  try {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const licenseKey = normalizeLicenseKey(body.licenseKey);

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

    const deleted = await deleteLicenseById(license.id);

    sendJson(res, 200, {
      ok: true,
      message: 'License deleted successfully',
      license: sanitizeLicense(deleted),
    });
  } catch (error) {
    console.error('Failed to delete license:', error);
    sendJson(res, 500, {
      ok: false,
      error: 'Failed to delete license',
    });
  }
}

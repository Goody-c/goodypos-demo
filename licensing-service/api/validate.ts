import { ensureMethod, readJsonBody, sendJson, type ApiRequest, type ApiResponse } from '../lib/http.js';
import {
  getLicenseByKey,
  isLicenseExpired,
  recordLicenseEvent,
  sanitizeLicense,
  updateLicenseById,
} from '../lib/licenses.js';
import { hashDeviceFingerprint, normalizeLicenseKey, signLicenseSnapshot } from '../lib/security.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!ensureMethod(req, res, ['POST'])) return;

  try {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const licenseKey = normalizeLicenseKey(body.licenseKey);
    const deviceFingerprint = String(body.deviceFingerprint || '').trim();

    if (!licenseKey || !deviceFingerprint) {
      sendJson(res, 400, {
        ok: false,
        error: 'licenseKey and deviceFingerprint are required',
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

    if (license.status === 'REVOKED') {
      sendJson(res, 403, {
        ok: false,
        error: 'License has been revoked',
      });
      return;
    }

    if (license.status === 'UNUSED') {
      sendJson(res, 409, {
        ok: false,
        error: 'License has not been activated yet',
      });
      return;
    }

    if (isLicenseExpired(license)) {
      const expired = await updateLicenseById(license.id, { status: 'EXPIRED' });
      await recordLicenseEvent(expired.id, 'expired', { source: 'validate' });
      sendJson(res, 403, {
        ok: false,
        error: 'License has expired',
      });
      return;
    }

    const deviceHash = hashDeviceFingerprint(deviceFingerprint);
    if (!deviceHash || license.device_fingerprint_hash !== deviceHash) {
      sendJson(res, 409, {
        ok: false,
        error: 'Device fingerprint does not match the activated device',
      });
      return;
    }

    const now = new Date();
    const forwardedFor = Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : req.headers['x-forwarded-for'];
    const ipAddress = String(forwardedFor || '').split(',')[0].trim() || null;
    const existingMetadata = (license.metadata || {}) as Record<string, unknown>;

    const updated = await updateLicenseById(license.id, {
      status: 'ACTIVE',
      last_validated_at: now.toISOString(),
      validation_due_at: null,
      metadata: {
        ...existingMetadata,
        activationRequiresInternet: true,
        oneDeviceOnly: true,
        activationMode: 'ONLINE_ONLY_FIRST_ACTIVATION',
        appVersion: typeof body.appVersion === 'string' ? body.appVersion : (existingMetadata.appVersion ?? null),
        lastSeenIp: ipAddress,
      },
    });

    await recordLicenseEvent(updated.id, 'validated', {
      appVersion: body.appVersion || null,
      ipAddress,
    });

    const cacheToken = signLicenseSnapshot({
      licenseId: updated.id,
      licenseKey: updated.license_key,
      deviceHash,
      status: updated.status,
      plan: updated.plan,
      expiresAt: updated.expires_at,
      validationDueAt: null,
      storeMode: updated.store_mode,
      storeName: updated.store_name,
    });

    sendJson(res, 200, {
      ok: true,
      message: 'License validated successfully',
      license: sanitizeLicense(updated),
      cacheToken,
      policy: {
        activationRequiresInternet: true,
        oneLicensePerDevice: true,
        periodicRevalidationRequired: false,
      },
    });
  } catch (error) {
    console.error('Failed to validate license:', error);
    const message = error instanceof Error ? error.message : 'Failed to validate license';
    sendJson(res, 500, {
      ok: false,
      error: message,
    });
  }
}

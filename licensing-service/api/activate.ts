import { ensureMethod, readJsonBody, sendJson, type ApiRequest, type ApiResponse } from '../lib/http.js';
import {
  getLicenseByDeviceHash,
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
    const deviceName = String(body.deviceName || '').trim();
    const storeName = String(body.storeName || '').trim();
    const storeModeRaw = String(body.storeMode || '').trim().toUpperCase();
    const storeMode = storeModeRaw === 'SUPERMARKET' || storeModeRaw === 'GADGET'
      ? storeModeRaw
      : null;

    if (!licenseKey || !deviceFingerprint || !storeMode) {
      sendJson(res, 400, {
        ok: false,
        error: 'licenseKey, deviceFingerprint, and storeMode are required',
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

    if (isLicenseExpired(license)) {
      const expired = await updateLicenseById(license.id, { status: 'EXPIRED' });
      await recordLicenseEvent(expired.id, 'expired', { source: 'activate' });
      sendJson(res, 403, {
        ok: false,
        error: 'License has expired',
      });
      return;
    }

    if (license.store_mode_allowed !== 'ANY' && license.store_mode_allowed !== storeMode) {
      sendJson(res, 403, {
        ok: false,
        error: `License only allows ${license.store_mode_allowed} mode`,
      });
      return;
    }

    const deviceHash = hashDeviceFingerprint(deviceFingerprint);
    if (!deviceHash) {
      sendJson(res, 400, {
        ok: false,
        error: 'Invalid deviceFingerprint',
      });
      return;
    }

    const now = new Date();
    const existingDeviceLicense = await getLicenseByDeviceHash(deviceHash);

    if (existingDeviceLicense && existingDeviceLicense.id !== license.id) {
      const priorStatus = existingDeviceLicense.status === 'REVOKED'
        ? 'REVOKED'
        : isLicenseExpired(existingDeviceLicense)
          ? 'EXPIRED'
          : 'UNUSED';
      const priorMetadata = (existingDeviceLicense.metadata || {}) as Record<string, unknown>;

      const releasedLicense = await updateLicenseById(existingDeviceLicense.id, {
        status: priorStatus,
        device_fingerprint_hash: null,
        activated_device_name: null,
        activated_at: priorStatus === 'UNUSED' ? null : existingDeviceLicense.activated_at,
        last_validated_at: null,
        validation_due_at: null,
        store_name: priorStatus === 'UNUSED' ? null : existingDeviceLicense.store_name,
        store_mode: priorStatus === 'UNUSED' ? null : existingDeviceLicense.store_mode,
        revoked_at: priorStatus === 'UNUSED' ? null : existingDeviceLicense.revoked_at,
        metadata: {
          ...priorMetadata,
          lastBindingResetAt: now.toISOString(),
          lastBindingResetReason: 'Auto-released because this device is activating a different genuine license.',
          replacedByLicenseKey: license.license_key,
        },
      });

      await recordLicenseEvent(releasedLicense.id, 'device_binding_released', {
        reason: 'Auto-released for genuine license activation on the same device',
        replacedByLicenseKey: license.license_key,
        replacedByStoreName: storeName || null,
        replacedByStoreMode: storeMode,
      });
    }

    const movedFromAnotherDevice = Boolean(license.device_fingerprint_hash && license.device_fingerprint_hash !== deviceHash);
    if (movedFromAnotherDevice && license.status === 'ACTIVE') {
      // License is already bound to a different machine — block activation
      await recordLicenseEvent(license.id, 'device_rebind_blocked', {
        blockedDeviceName: deviceName || null,
        existingDeviceName: license.activated_device_name || null,
        storeName: storeName || null,
        storeMode,
      });
      sendJson(res, 409, {
        ok: false,
        error: `This license is already active on another device (${license.activated_device_name || 'unknown device'}). Contact the system owner to transfer the license.`,
      });
      return;
    }
    if (movedFromAnotherDevice) {
      await recordLicenseEvent(license.id, 'device_rebind_requested', {
        previousDeviceName: license.activated_device_name || null,
        nextDeviceName: deviceName || null,
        storeName: storeName || null,
        storeMode,
      });
    }
    const forwardedFor = Array.isArray(req.headers['x-forwarded-for'])
      ? req.headers['x-forwarded-for'][0]
      : req.headers['x-forwarded-for'];
    const ipAddress = String(forwardedFor || '').split(',')[0].trim() || null;
    const existingMetadata = (license.metadata || {}) as Record<string, unknown>;
    const wasActivatedAlready = Boolean(license.activated_at);

    const updated = await updateLicenseById(license.id, {
      status: 'ACTIVE',
      device_fingerprint_hash: deviceHash,
      activated_device_name: deviceName || license.activated_device_name,
      activated_at: license.activated_at || now.toISOString(),
      last_validated_at: now.toISOString(),
      validation_due_at: null,
      store_name: storeName || license.store_name,
      store_mode: storeMode,
      metadata: {
        ...existingMetadata,
        activationRequiresInternet: true,
        oneDeviceOnly: true,
        activationMode: 'ONLINE_ONLY_FIRST_ACTIVATION',
        appVersion: typeof body.appVersion === 'string' ? body.appVersion : (existingMetadata.appVersion ?? null),
        lastSeenIp: ipAddress,
      },
    });

    await recordLicenseEvent(updated.id, wasActivatedAlready ? 'revalidated' : 'activated', {
      deviceName,
      storeName,
      storeMode,
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
      message: wasActivatedAlready
        ? 'License is already active on this device and has been refreshed'
        : movedFromAnotherDevice
          ? 'License activated successfully and moved to this device'
          : 'License activated successfully',
      license: sanitizeLicense(updated),
      cacheToken,
      policy: {
        activationRequiresInternet: true,
        oneLicensePerDevice: true,
        periodicRevalidationRequired: false,
      },
    });
  } catch (error) {
    console.error('Failed to activate license:', error);
    const message = error instanceof Error ? error.message : 'Failed to activate license';
    const isDeviceConflict = /device_fingerprint_hash|already linked to another license|already bound to another device/i.test(message);
    sendJson(res, isDeviceConflict ? 409 : 500, {
      ok: false,
      error: isDeviceConflict
        ? 'This device is already linked to another license. Ask the Super System Owner to reset the old device binding before using a new key.'
        : message,
    });
  }
}

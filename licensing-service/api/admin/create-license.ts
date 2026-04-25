import { env } from '../../lib/env.js';
import { ensureMethod, readJsonBody, requireAdmin, sendJson, type ApiRequest, type ApiResponse } from '../../lib/http.js';
import { calculateExpiryAt, insertLicense, recordLicenseEvent, sanitizeLicense, type StoreMode } from '../../lib/licenses.js';
import { generateLicenseKey } from '../../lib/security.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!ensureMethod(req, res, ['POST'])) return;
  if (!requireAdmin(req, res)) return;

  try {
    const body = await readJsonBody<Record<string, unknown>>(req);
    const rawStoreMode = String(body.storeModeAllowed || body.store_mode_allowed || 'ANY').trim().toUpperCase();
    const storeModeAllowed: StoreMode = rawStoreMode === 'SUPERMARKET' || rawStoreMode === 'GADGET' ? rawStoreMode : 'ANY';
    const plan = String(body.plan || 'STANDARD').trim().toUpperCase() || 'STANDARD';
    const issuedToName = String(body.issuedToName || '').trim() || null;
    const issuedToEmail = String(body.issuedToEmail || '').trim().toLowerCase() || null;
    const notes = String(body.notes || '').trim() || null;
    const lifetimeRequested = body.isLifetime === true
      || String(body.validityDays ?? '').trim().toUpperCase() === 'LIFETIME'
      || Number(body.validityDays) === 0;

    const validityDaysRaw = Number(body.validityDays ?? env.defaultLicenseDurationDays);
    const validityDays = lifetimeRequested
      ? 0
      : Number.isFinite(validityDaysRaw) && validityDaysRaw > 0
        ? Math.floor(validityDaysRaw)
        : env.defaultLicenseDurationDays;

    const requestedExpiry = typeof body.expiresAt === 'string' ? new Date(body.expiresAt) : null;
    const expiresAt = lifetimeRequested
      ? null
      : requestedExpiry && !Number.isNaN(requestedExpiry.getTime())
        ? requestedExpiry.toISOString()
        : calculateExpiryAt(validityDays);

    const metadata = typeof body.metadata === 'object' && body.metadata !== null
      ? (body.metadata as Record<string, unknown>)
      : {};

    const license = await insertLicense({
      license_key: generateLicenseKey(),
      status: 'UNUSED',
      plan,
      store_mode_allowed: storeModeAllowed,
      issued_to_name: issuedToName,
      issued_to_email: issuedToEmail,
      notes,
      metadata: {
        ...metadata,
        activationRequiresInternet: true,
        oneDeviceOnly: true,
        activationMode: 'ONLINE_ONLY_FIRST_ACTIVATION',
        licenseTerm: lifetimeRequested ? 'LIFETIME' : `${validityDays}_DAYS`,
        createdFrom: 'goodypos-super-owner',
      },
      validation_interval_days: 0,
      valid_from: new Date().toISOString(),
      expires_at: expiresAt,
      device_fingerprint_hash: null,
      activated_device_name: null,
      store_name: null,
      store_mode: null,
      activated_at: null,
      last_validated_at: null,
      validation_due_at: null,
      revoked_at: null,
    });

    await recordLicenseEvent(license.id, 'created', {
      storeModeAllowed,
      plan,
      validityDays,
      lifetimeRequested,
      issuedToName,
      issuedToEmail,
    });

    sendJson(res, 201, {
      ok: true,
      message: 'License created successfully',
      license: sanitizeLicense(license),
      policy: {
        activationRequiresInternet: true,
        oneLicensePerDevice: true,
        periodicRevalidationRequired: false,
      },
    });
  } catch (error) {
    console.error('Failed to create license:', error);
    sendJson(res, 500, {
      ok: false,
      error: 'Failed to create license',
    });
  }
}

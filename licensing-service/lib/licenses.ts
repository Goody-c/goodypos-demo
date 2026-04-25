import { env } from './env.js';
import { supabase } from './supabase.js';

export type LicenseStatus = 'UNUSED' | 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export type StoreMode = 'SUPERMARKET' | 'GADGET' | 'ANY';

export interface LicenseRecord {
  id: string;
  license_key: string;
  status: LicenseStatus;
  plan: string;
  store_mode_allowed: StoreMode;
  device_fingerprint_hash: string | null;
  activated_device_name: string | null;
  issued_to_name: string | null;
  issued_to_email: string | null;
  store_name: string | null;
  store_mode: 'SUPERMARKET' | 'GADGET' | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  validation_interval_days: number;
  valid_from: string;
  expires_at: string | null;
  activated_at: string | null;
  last_validated_at: string | null;
  validation_due_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export const calculateExpiryAt = (durationDays = env.defaultLicenseDurationDays) => {
  const expires = new Date();
  expires.setUTCDate(expires.getUTCDate() + durationDays);
  return expires.toISOString();
};

export const getLicenseByKey = async (licenseKey: string) => {
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('license_key', licenseKey)
    .maybeSingle();

  if (error) throw error;
  return data as LicenseRecord | null;
};

export const getLicenseByDeviceHash = async (deviceHash: string) => {
  const { data, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('device_fingerprint_hash', deviceHash)
    .maybeSingle();

  if (error) throw error;
  return data as LicenseRecord | null;
};

export const insertLicense = async (payload: Partial<LicenseRecord>) => {
  const { data, error } = await supabase
    .from('licenses')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data as LicenseRecord;
};

export const updateLicenseById = async (licenseId: string, patch: Partial<LicenseRecord>) => {
  const { data, error } = await supabase
    .from('licenses')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', licenseId)
    .select('*')
    .single();

  if (error) throw error;
  return data as LicenseRecord;
};

export const deleteLicenseById = async (licenseId: string) => {
  const { data, error } = await supabase
    .from('licenses')
    .delete()
    .eq('id', licenseId)
    .select('*')
    .single();

  if (error) throw error;
  return data as LicenseRecord;
};

export const listLicenses = async (status?: LicenseStatus) => {
  let query = supabase
    .from('licenses')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as LicenseRecord[];
};

export const recordLicenseEvent = async (licenseId: string, eventType: string, details: Record<string, unknown> = {}) => {
  const { error } = await supabase.from('license_events').insert({
    license_id: licenseId,
    event_type: eventType,
    details,
  });

  if (error) {
    console.error(`License event logging failed for ${eventType}:`, error);
    return false;
  }

  return true;
};

export const isLicenseExpired = (license: Pick<LicenseRecord, 'expires_at'>) => {
  if (!license.expires_at) return false;
  return new Date(license.expires_at).getTime() < Date.now();
};

export const sanitizeLicense = (license: LicenseRecord) => ({
  id: license.id,
  licenseKey: license.license_key,
  status: license.status,
  plan: license.plan,
  storeModeAllowed: license.store_mode_allowed,
  storeName: license.store_name,
  storeMode: license.store_mode,
  validationIntervalDays: license.validation_interval_days,
  activatedAt: license.activated_at,
  lastValidatedAt: license.last_validated_at,
  validationDueAt: license.validation_due_at,
  expiresAt: license.expires_at,
  issuedToName: license.issued_to_name,
  issuedToEmail: license.issued_to_email,
  notes: license.notes,
  metadata: license.metadata || {},
});

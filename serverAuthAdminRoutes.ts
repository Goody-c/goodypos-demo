import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import { seedDemoData } from './serverDemoSeeder';

// In-memory store: IPs that hit the recovery endpoint (flagged for login audit)
const recoveryFlaggedIps = new Set<string>();

// Rate limit: track failed recovery attempts per IP
const recoveryFailedAttempts = new Map<string, { count: number; lockUntil: number }>();
const RECOVERY_MAX_ATTEMPTS = 3;
const RECOVERY_LOCKOUT_MS = 15 * 60 * 1000;

const getRecoveryAuditPath = () => {
  const dataDir = String(process.env.GOODY_POS_DATA_DIR || '').trim() || process.cwd();
  return path.join(dataDir, 'recovery-audit.log');
};

const writeAuditLog = (line: string) => {
  try {
    const entry = `[${new Date().toISOString()}] ${line}\n`;
    fs.appendFileSync(getRecoveryAuditPath(), entry, 'utf8');
  } catch { /* non-fatal */ }
};

type AuthAdminRouteDependencies = {
  app: Express;
  postgresPool: Pool;
  authenticate: any;
  authorize: (roles: string[]) => any;
  checkStoreLock: any;
  coreReadRepository: any;
  coreWriteRepository: any;
  findStoreById: (storeId: unknown) => Promise<any>;
  findUserById: (userId: unknown) => Promise<any>;
  normalizeStaffAnnouncement: (value: any) => { text: string; active: boolean; updated_at: string | null };
  safeJsonParse: (value: any, fallback: any) => any;
  getLoginAttemptKey: (username: string, ipAddress?: string) => string;
  getRemainingLockoutMs: (key: string) => number;
  registerFailedLogin: (key: string) => { remainingAttempts: number; lockUntil: number };
  clearLoginAttempt: (key: string) => void;
  activateRemoteStoreLicense: (args: { licenseKey: string; storeName: string; storeMode: 'SUPERMARKET' | 'GADGET' }) => Promise<any>;
  markExpiredProformas: () => Promise<void>;
  normalizePin: (value: unknown) => string;
  hashPin: (pin: string) => string;
  verifyPin: (pin: string, hash: string) => boolean;
  resolveCheckoutActorByPin: (storeId: unknown, pin: unknown) => Promise<any>;
  LICENSE_REQUIRED_FOR_NEW_STORES: boolean;
  LICENSE_DEVICE_NAME: string;
  JWT_SECRET: string;
  JWT_EXPIRY: string;
};

export const registerAuthAdminRoutes = ({
  app,
  postgresPool,
  authenticate,
  authorize,
  checkStoreLock,
  coreReadRepository,
  coreWriteRepository,
  findStoreById,
  findUserById,
  normalizeStaffAnnouncement,
  safeJsonParse,
  getLoginAttemptKey,
  getRemainingLockoutMs,
  registerFailedLogin,
  clearLoginAttempt,
  activateRemoteStoreLicense,
  markExpiredProformas,
  normalizePin,
  hashPin,
  verifyPin,
  resolveCheckoutActorByPin,
  LICENSE_REQUIRED_FOR_NEW_STORES,
  LICENSE_DEVICE_NAME,
  JWT_SECRET,
  JWT_EXPIRY,
}: AuthAdminRouteDependencies) => {
  // Hidden admin recovery — requires GOODY_POS_RECOVERY_CODE env var to be set
  app.post('/api/auth/admin-reset', async (req: any, res: any) => {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');
    const recoveryCode = String(process.env.GOODY_POS_RECOVERY_CODE || '').trim();
    if (!recoveryCode) {
      writeAuditLog(`RECOVERY_DISABLED — attempt from ${ip}`);
      return res.status(403).json({ error: 'Recovery is not enabled on this server.' });
    }

    // Rate limit check
    const attempt = recoveryFailedAttempts.get(ip);
    if (attempt && attempt.lockUntil > Date.now()) {
      const minsLeft = Math.ceil((attempt.lockUntil - Date.now()) / 60000);
      writeAuditLog(`RECOVERY_BLOCKED — ${ip} is locked out (${minsLeft} min remaining)`);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${minsLeft} minute(s).` });
    }

    const { code, newPassword, newUsername } = req.body;
    if (!code || String(code).trim() !== recoveryCode) {
      // Register failed attempt
      const current = recoveryFailedAttempts.get(ip) || { count: 0, lockUntil: 0 };
      current.count += 1;
      if (current.count >= RECOVERY_MAX_ATTEMPTS) {
        current.lockUntil = Date.now() + RECOVERY_LOCKOUT_MS;
        writeAuditLog(`RECOVERY_LOCKOUT — ${ip} locked out after ${current.count} failed attempts`);
      } else {
        writeAuditLog(`RECOVERY_FAILED — ${ip} wrong code (attempt ${current.count}/${RECOVERY_MAX_ATTEMPTS})`);
      }
      recoveryFailedAttempts.set(ip, current);
      recoveryFlaggedIps.add(ip);
      return res.status(401).json({ error: 'Invalid recovery code.' });
    }

    // Correct code — clear rate limit
    recoveryFailedAttempts.delete(ip);

    const hasNewPassword = newPassword && String(newPassword).length > 0;
    const hasNewUsername = newUsername && String(newUsername).trim().length > 0;

    if (!hasNewPassword && !hasNewUsername) {
      return res.status(400).json({ error: 'Provide a new password, a new username, or both.' });
    }
    if (hasNewPassword && String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (hasNewUsername) {
      const trimmed = String(newUsername).trim();
      if (trimmed.length < 2 || trimmed.length > 100) {
        return res.status(400).json({ error: 'Username must be 2–100 characters.' });
      }
      // Fetch the current SYSTEM_ADMIN's username to allow reusing their own username
      const currentAdminResult = await postgresPool.query(
        `SELECT username FROM users WHERE role = 'SYSTEM_ADMIN' ORDER BY id ASC LIMIT 1`,
      );
      const currentAdminUsername = String(currentAdminResult.rows[0]?.username ?? '').trim();
      const isReusingSameUsername = currentAdminUsername.length > 0 &&
        currentAdminUsername.toLowerCase() === trimmed.toLowerCase();

      if (!isReusingSameUsername) {
        const conflict = await postgresPool.query(
          `SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND role != 'SYSTEM_ADMIN' LIMIT 1`,
          [trimmed],
        );
        if ((conflict.rowCount ?? 0) > 0) {
          return res.status(400).json({ error: 'That username belongs to a store account. Choose a different username.' });
        }
      }
    }

    try {
      const adminRow = await postgresPool.query(
        `SELECT id FROM users WHERE role = 'SYSTEM_ADMIN' ORDER BY id ASC LIMIT 1`,
      );
      if ((adminRow.rowCount ?? 0) === 0) {
        return res.status(404).json({ error: 'No SYSTEM_ADMIN account found.' });
      }
      const adminId = adminRow.rows[0].id;

      const setClauses: string[] = [];
      const params: any[] = [];

      if (hasNewPassword) {
        params.push(bcrypt.hashSync(String(newPassword), 10));
        setClauses.push(`password = $${params.length}`);
      }
      if (hasNewUsername) {
        params.push(String(newUsername).trim());
        setClauses.push(`username = $${params.length}`);
      }

      params.push(adminId);
      await postgresPool.query(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${params.length}`,
        params,
      );

      const updatedRow = await postgresPool.query(
        `SELECT username FROM users WHERE id = $1`,
        [adminId],
      );

      const finalUsername = updatedRow.rows[0]?.username ?? 'SYSTEM_ADMIN';
      recoveryFlaggedIps.add(ip);
      writeAuditLog(`RECOVERY_SUCCESS — ${ip} reset SYSTEM_ADMIN account (username: ${finalUsername}, password_changed: ${hasNewPassword}, username_changed: ${hasNewUsername})`);
      res.json({ success: true, username: finalUsername });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('unique')) {
        return res.status(400).json({ error: 'That username belongs to a store account. Choose a different one.' });
      }
      res.status(500).json({ error: msg || 'Database error during reset.' });
    }
  });

  app.get('/api/admin/recovery-audit-log', authenticate, authorize(['SYSTEM_ADMIN']), (_req: any, res: any) => {
    try {
      const logPath = getRecoveryAuditPath();
      if (!fs.existsSync(logPath)) return res.json({ lines: [] });
      const raw = fs.readFileSync(logPath, 'utf8');
      const lines = raw.trim().split('\n').filter(Boolean).reverse(); // newest first
      res.json({ lines });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Could not read audit log.' });
    }
  });

  app.get('/api/public/store-announcement', async (req: any, res: any) => {
    const username = String(req.query.username || '').trim();

    if (!username) {
      return res.json({ active: false, message: null, updated_at: null });
    }

    try {
      const userResult = await postgresPool.query(
        'SELECT store_id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
        [username],
      );
      const matchedUser = userResult.rows[0] as { store_id?: number | null } | undefined;
      if (!matchedUser?.store_id) {
        return res.json({ active: false, message: null, updated_at: null });
      }

      const store = await findStoreById(matchedUser.store_id);
      if (!store) {
        return res.json({ active: false, message: null, updated_at: null });
      }

      const announcement = normalizeStaffAnnouncement(store);
      return res.json({
        active: announcement.active,
        message: announcement.active ? announcement.text : null,
        updated_at: announcement.updated_at,
        store_name: store.name || null,
      });
    } catch (err: any) {
      return res.json({ active: false, message: null, updated_at: null, error: err?.message || null });
    }
  });

  const getLicenseDeviceMismatchMessage = (store: any) => {
    if (!store) return null;

    const licenseStatus = String(store.license_status || '').trim().toUpperCase();
    const licensedDeviceName = String(store.license_device_name || '').trim();
    const hasActiveLicenseBinding = (Boolean(store.license_key) || licenseStatus === 'ACTIVE') && licensedDeviceName;

    if (!hasActiveLicenseBinding || licensedDeviceName === LICENSE_DEVICE_NAME) {
      return null;
    }

    return `This store license is already activated on ${licensedDeviceName}. This device is ${LICENSE_DEVICE_NAME}. Ask the Super System Owner to reset or transfer the license before using this store here.`;
  };

  app.get('/api/auth/verify', authenticate, async (req: any, res: any) => {
    if (req.user?.role !== 'SYSTEM_ADMIN') {
      const linkedStore = await findStoreById(req.user?.store_id);
      const licenseMismatchMessage = getLicenseDeviceMismatchMessage(linkedStore);
      if (licenseMismatchMessage) {
        return res.status(403).json({ valid: false, error: licenseMismatchMessage });
      }
    }

    res.json({ valid: true, user: req.user });
  });

  app.post('/api/auth/login', async (req: any, res: any) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const attemptKey = getLoginAttemptKey(username, req.ip);
    const remainingLockoutMs = getRemainingLockoutMs(attemptKey);
    if (remainingLockoutMs > 0) {
      return res.status(429).json({
        error: `Too many login attempts. Try again in ${Math.ceil(remainingLockoutMs / 60000)} minute(s).`,
      });
    }

    const userResult = await postgresPool.query(
      'SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username],
    );
    const user: any = userResult.rows[0] || null;
    const passwordMatches = Boolean(user?.password) && bcrypt.compareSync(password, user.password);

    if (!user || !passwordMatches) {
      const { remainingAttempts, lockUntil } = registerFailedLogin(attemptKey);

      if (lockUntil > Date.now()) {
        return res.status(429).json({
          error: `Too many login attempts. Account locked for ${Math.ceil((lockUntil - Date.now()) / 60000)} minute(s).`,
        });
      }

      return res.status(401).json({
        error: `Invalid credentials.${remainingAttempts > 0 ? ` ${remainingAttempts} attempt(s) remaining before temporary lockout.` : ''}`,
      });
    }

    clearLoginAttempt(attemptKey);

    // If this IP previously hit the recovery endpoint, audit the login
    const loginIp = String(req.ip || req.socket?.remoteAddress || 'unknown');
    if (recoveryFlaggedIps.has(loginIp)) {
      writeAuditLog(`FLAGGED_IP_LOGIN — ${loginIp} logged in as "${user.username}" (role: ${user.role}) — this IP previously attempted emergency recovery`);
    }

    if (user.role !== 'SYSTEM_ADMIN') {
      const normalizedStoreId = Number(user.store_id || 0);
      const linkedStore = Number.isInteger(normalizedStoreId) && normalizedStoreId > 0
        ? await findStoreById(normalizedStoreId)
        : null;

      if (!linkedStore) {
        return res.status(403).json({
          error: 'This store account is not linked to an active store yet. Ask the system admin to assign or recreate it.',
        });
      }

      const licenseMismatchMessage = getLicenseDeviceMismatchMessage(linkedStore);
      if (licenseMismatchMessage) {
        return res.status(403).json({ error: licenseMismatchMessage });
      }
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, store_id: user.store_id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY as any },
    );

    res.json({ token, user: { id: user.id, username: user.username, role: user.role, store_id: user.store_id } });
  });

  app.get('/api/admin/stores', authenticate, authorize(['SYSTEM_ADMIN']), async (_req: any, res: any) => {
    try {
      const stores = await coreReadRepository.listAdminStores();

      res.json(stores.map((s: any) => {
        const customSpecs = safeJsonParse(s.custom_specs, []);
        return {
          ...s,
          custom_specs: Array.isArray(customSpecs) ? customSpecs : [],
        };
      }));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load stores' });
    }
  });

  app.post('/api/admin/stores', authenticate, authorize(['SYSTEM_ADMIN']), async (req: any, res: any) => {
    const { name, mode } = req.body;
    const rawLicenseKey = String(req.body?.licenseKey ?? req.body?.license_key ?? '').trim();
    const normalizedLicenseKey = rawLicenseKey
      ? (() => {
          const compact = rawLicenseKey.toUpperCase().replace(/[^A-Z0-9]/g, '');
          const prefixMatch = compact.match(/^[A-Z]{3}(?=[A-Z0-9]{5,}$)/);
          if (!prefixMatch) return compact.match(/.{1,5}/g)?.join('-') || rawLicenseKey.toUpperCase();
          const prefix = prefixMatch[0];
          const remainder = compact.slice(prefix.length);
          const groupedRemainder = remainder.match(/.{1,5}/g)?.join('-') || remainder;
          return groupedRemainder ? `${prefix}-${groupedRemainder}` : prefix;
        })()
      : '';

    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: 'Store name required (max 255 chars)' });
    }
    if (!['SUPERMARKET', 'GADGET'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid store mode. Must be SUPERMARKET or GADGET' });
    }
    if (LICENSE_REQUIRED_FOR_NEW_STORES && !normalizedLicenseKey) {
      return res.status(400).json({ error: 'A one-time license key from the Super System Owner is required to deploy a new store.' });
    }

    let licenseActivation: any = null;
    if (normalizedLicenseKey) {
      try {
        licenseActivation = await activateRemoteStoreLicense({
          licenseKey: normalizedLicenseKey,
          storeName: String(name).trim(),
          storeMode: mode,
        });
      } catch (err: any) {
        return res.status(400).json({ error: String(err?.message || err || 'License activation failed') });
      }
    }

    try {
      const remoteLicense = licenseActivation?.license || null;
      const defaultPaperSize = mode === 'GADGET' ? 'A4' : 'THERMAL';
      const insertResult = await postgresPool.query(
        `INSERT INTO stores (
          name,
          mode,
          receipt_paper_size,
          license_key,
          license_status,
          license_plan,
          license_cache_token,
          license_activated_at,
          license_last_validated_at,
          license_device_name
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id`,
        [
          name,
          mode,
          defaultPaperSize,
          remoteLicense?.licenseKey || null,
          remoteLicense?.status || 'UNLICENSED',
          remoteLicense?.plan || null,
          licenseActivation?.cacheToken || null,
          remoteLicense?.activatedAt || null,
          remoteLicense?.lastValidatedAt || null,
          remoteLicense ? LICENSE_DEVICE_NAME : null,
        ],
      );

      const storeId = Number(insertResult.rows[0]?.id);

      res.json({
        id: storeId,
        licenseActivated: Boolean(remoteLicense),
        license: remoteLicense,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/admin/stores/:id/lock', authenticate, authorize(['SYSTEM_ADMIN']), async (req: any, res: any) => {
    const { is_locked } = req.body;
    const store = await findStoreById(req.params.id);

    if (!store) {
      return res.status(404).json({ error: 'Store not found' });
    }

    await postgresPool.query('UPDATE stores SET is_locked = $1 WHERE id = $2', [is_locked ? 1 : 0, store.id]);
    res.json({ success: true });
  });

  app.delete('/api/admin/stores/:id', authenticate, authorize(['SYSTEM_ADMIN']), async (req: any, res: any) => {
    const storeId = Number(req.params.id);

    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({ error: 'Invalid store id' });
    }

    const store = await coreReadRepository.getStoreById(storeId) as { id: number; name: string } | null;
    if (!store) {
      return res.json({ success: true, alreadyDeleted: true, message: 'Store was already removed' });
    }

    try {
      await coreWriteRepository.deleteStore({ storeId });
      res.json({ success: true, message: `Store ${store.name} deleted successfully` });
    } catch (err: any) {
      console.error('Failed to delete store:', err);
      res.status(500).json({ error: `Failed to delete store: ${err.message}` });
    }
  });

  app.post('/api/admin/maintenance/mark-expired-proformas', authenticate, authorize(['SYSTEM_ADMIN']), async (_req: any, res: any) => {
    try {
      await markExpiredProformas();
      const countResult = await postgresPool.query("SELECT COUNT(*) as count FROM pro_formas WHERE status = 'EXPIRED'");
      res.json({
        success: true,
        message: 'Pro-forma expiry check completed',
        totalExpired: Number(countResult.rows[0]?.count || 0),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/users', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN', 'MANAGER']), async (req: any, res: any) => {
    try {
      const limit = 100;
      const offset = (parseInt(req.query.page || '1', 10) - 1) * limit;
      const users = await coreReadRepository.listAdminUsers({
        viewerRole: String(req.user.role || ''),
        viewerStoreId: req.user.store_id == null ? null : Number(req.user.store_id),
        requestedStoreId: req.query.store_id == null || req.query.store_id === '' ? null : Number(req.query.store_id),
        limit,
        offset,
      });

      res.json({ users, limit, offset, hasMore: users.length === limit });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load users' });
    }
  });

  app.put('/api/admin/users/:id/password', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    const targetUserResult = await postgresPool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [req.params.id]);
    const targetUser: any = targetUserResult.rows[0] || null;
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    if (String(targetUser.username || '').toLowerCase().startsWith('demo_')) {
      return res.status(403).json({ error: 'Demo accounts cannot have their password changed.' });
    }

    if (req.user.role === 'SYSTEM_ADMIN') {
      await postgresPool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.params.id]);
    } else if (req.user.role === 'STORE_ADMIN') {
      if (targetUser.store_id !== req.user.store_id) {
        return res.status(403).json({ error: 'Forbidden: User belongs to another store' });
      }
      if (targetUser.role === 'SYSTEM_ADMIN' || targetUser.role === 'STORE_ADMIN') {
        return res.status(403).json({ error: 'Forbidden: Cannot reset password for this role' });
      }
      await postgresPool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.params.id]);
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.json({ success: true });
  });

  app.put('/api/admin/users/:id/pin', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const nextPin = normalizePin(req.body?.pin ?? req.body?.newPin);

    if (!/^\d{4,6}$/.test(nextPin)) {
      return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    }

    const targetUser = await findUserById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (String((targetUser as any).username || '').toLowerCase().startsWith('demo_')) {
      return res.status(403).json({ error: 'Demo accounts cannot have their PIN changed.' });
    }

    if (req.user.role === 'STORE_ADMIN') {
      if (targetUser.store_id !== req.user.store_id) {
        return res.status(403).json({ error: 'Forbidden: User belongs to another store' });
      }
      if (!['MANAGER', 'PROCUREMENT_OFFICER', 'STAFF'].includes(String(targetUser.role || ''))) {
        return res.status(403).json({ error: 'Forbidden: Store Owner can only reset staff, procurement, or manager PINs' });
      }
    }

    await postgresPool.query('UPDATE users SET pin = $1 WHERE id = $2', [hashPin(nextPin), targetUser.id]);
    res.json({ success: true });
  });

  app.put('/api/auth/profile/password', authenticate, async (req: any, res: any) => {
    const { currentPassword, newPassword } = req.body;

    if (String(req.user?.username || '').toLowerCase().startsWith('demo_')) {
      return res.status(403).json({ error: 'Demo accounts cannot change their password.' });
    }

    if (!['SYSTEM_ADMIN', 'STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Role not authorized to change own password' });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.password || !bcrypt.compareSync(currentPassword, user.password)) {
      return res.status(401).json({ error: 'Invalid current password' });
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await postgresPool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);
    res.json({ success: true });
  });

  app.put('/api/auth/profile/pin', authenticate, async (req: any, res: any) => {
    if (String(req.user?.username || '').toLowerCase().startsWith('demo_')) {
      return res.status(403).json({ error: 'Demo accounts cannot change their PIN.' });
    }

    const currentPin = normalizePin(req.body?.currentPin);
    const newPin = normalizePin(req.body?.newPin);
    const currentPassword = String(req.body?.currentPassword ?? '');

    if (!/^\d{4,6}$/.test(newPin)) {
      return res.status(400).json({ error: 'New PIN must be 4-6 digits' });
    }

    const user = await findUserById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasExistingPin = Boolean(String(user.pin || '').trim());
    const canRecoverWithPassword = ['STORE_ADMIN', 'SYSTEM_ADMIN'].includes(String(req.user?.role || ''));
    const hasCurrentPinInput = /^\d{4,6}$/.test(currentPin);
    const hasPasswordFallback = currentPassword.length > 0;

    if (hasExistingPin) {
      if (hasCurrentPinInput) {
        if (!verifyPin(currentPin, String(user.pin || ''))) {
          return res.status(400).json({ error: 'Current PIN is incorrect' });
        }
        if (currentPin === newPin) {
          return res.status(400).json({ error: 'New PIN must be different from the current PIN' });
        }
      } else if (canRecoverWithPassword && hasPasswordFallback) {
        if (!user.password || !bcrypt.compareSync(currentPassword, String(user.password || ''))) {
          return res.status(400).json({ error: 'Login password is incorrect' });
        }
        if (verifyPin(newPin, String(user.pin || ''))) {
          return res.status(400).json({ error: 'New PIN must be different from the current PIN' });
        }
      } else {
        return res.status(400).json({
          error: canRecoverWithPassword
            ? 'Enter your current PIN, or use your login password if you forgot it'
            : 'Current PIN is required to change your PIN',
        });
      }
    }

    await postgresPool.query('UPDATE users SET pin = $1 WHERE id = $2', [hashPin(newPin), req.user.id]);
    res.json({ success: true });
  });

  app.post('/api/auth/checkout-pin/verify', authenticate, checkStoreLock, async (req: any, res: any) => {
    const storeSettings = req.store || await findStoreById(req.user.store_id);
    if (!storeSettings) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const isGadgetMode = String(storeSettings.mode || '').toUpperCase() === 'GADGET';
    const pinCheckoutEnabled = isGadgetMode && Number(storeSettings?.pin_checkout_enabled ?? 1) === 1;

    if (!pinCheckoutEnabled) {
      return res.json({ success: true, required: false, user: req.user });
    }

    const normalizedCheckoutPin = normalizePin(req.body?.pin);
    if (!/^\d{4,6}$/.test(normalizedCheckoutPin)) {
      return res.status(400).json({ error: 'Checkout PIN must be 4-6 digits' });
    }

    const resolvedActor = await resolveCheckoutActorByPin(req.user.store_id, normalizedCheckoutPin);
    if (!resolvedActor) {
      return res.status(400).json({ error: 'Invalid checkout PIN for this store' });
    }

    res.json({
      success: true,
      required: true,
      user: {
        id: resolvedActor.id,
        username: resolvedActor.username,
        role: resolvedActor.role,
        store_id: resolvedActor.store_id ?? null,
      },
    });
  });

  app.post('/api/admin/users', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const { username, password, role, store_id, pin } = req.body;
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername || normalizedUsername.length < 2 || normalizedUsername.length > 100) {
      return res.status(400).json({ error: 'Username must be between 2 and 100 characters' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (pin && !/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be 4-6 digits' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const hashedPin = pin ? hashPin(pin) : null;

    const rawTargetStoreId = req.user.role === 'SYSTEM_ADMIN' ? store_id : req.user.store_id;
    const targetStoreId = rawTargetStoreId == null || rawTargetStoreId === '' ? null : Number(rawTargetStoreId);
    const targetRole = req.user.role === 'SYSTEM_ADMIN'
      ? role
      : (role === 'MANAGER'
        ? 'MANAGER'
        : role === 'ACCOUNTANT'
          ? 'ACCOUNTANT'
          : role === 'PROCUREMENT_OFFICER'
            ? 'PROCUREMENT_OFFICER'
            : 'STAFF');

    if (targetRole !== 'SYSTEM_ADMIN' && targetStoreId === null) {
      return res.status(400).json({ error: 'Select a store before creating a store owner or staff account.' });
    }

    if (targetStoreId !== null) {
      if (!Number.isInteger(targetStoreId) || targetStoreId <= 0) {
        return res.status(400).json({ error: 'Invalid store id' });
      }

      if (!(await findStoreById(targetStoreId))) {
        return res.status(404).json({ error: 'Store not found' });
      }
    }

    const existingUsernameResult = await postgresPool.query(
      'SELECT id, role, store_id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [normalizedUsername],
    );
    const existingUsername = existingUsernameResult.rows[0] as any;
    if (existingUsername) {
      return res.status(400).json({ error: 'Username already exists. Use a different store-owner or staff username.' });
    }

    if (req.user.role === 'SYSTEM_ADMIN' && targetRole === 'STORE_ADMIN' && targetStoreId !== null) {
      const existingOwnerResult = await postgresPool.query(
        `SELECT id, username FROM users WHERE store_id = $1 AND role = 'STORE_ADMIN' ORDER BY id ASC LIMIT 1`,
        [targetStoreId],
      );
      const existingOwner = existingOwnerResult.rows[0] as { id: number; username: string } | undefined;

      if (existingOwner) {
        return res.status(400).json({
          error: `This store already has a store owner (${existingOwner.username}). Reset that account or remove it before creating another owner.`,
        });
      }
    }

    try {
      const insertResult = await postgresPool.query(
        'INSERT INTO users (username, password, role, store_id, pin) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [normalizedUsername, hashedPassword, targetRole, targetStoreId, hashedPin],
      );
      const userId = Number(insertResult.rows[0]?.id);
      res.json({ id: userId });
    } catch (err: any) {
      const errorMessage = String(err?.message || err || 'Failed to create user');
      if (errorMessage.toLowerCase().includes('unique')) {
        return res.status(400).json({ error: 'Username already exists. Use a different store-owner or staff username.' });
      }
      res.status(400).json({ error: errorMessage });
    }
  });

  app.delete('/api/admin/users/:id', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const user = await findUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.user.role !== 'SYSTEM_ADMIN') {
      if (user.store_id !== req.user.store_id || user.role === 'STORE_ADMIN') {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    try {
      await coreWriteRepository.deleteUser({
        userId: Number(user.id),
        actorUserId: Number(req.user.id),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error('Failed to delete user:', err);
      const message = String(err?.message || 'Failed to delete user');
      res.status(400).json({ error: message });
    }
  });

  // ── Demo Data Seeder ──────────────────────────────────────────────────────
  app.post('/api/admin/seed-demo', authenticate, authorize(['SYSTEM_ADMIN']), async (_req: any, res: any) => {
    try {
      const result = await seedDemoData(postgresPool);
      res.json(result);
    } catch (err: any) {
      console.error('Demo seed error:', err);
      res.status(500).json({ error: err.message });
    }
  });
};

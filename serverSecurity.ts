import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';

type SecurityHelperOptions = {
  postgresPool: Pool;
  jwtSecret: string;
  maxLoginAttempts: number;
  lockoutDurationMs: number;
};

type LoginAttemptRecord = {
  count: number;
  lockUntil: number;
  lastAttemptAt: number;
};

export const createSecurityHelpers = ({
  postgresPool,
  jwtSecret,
  maxLoginAttempts,
  lockoutDurationMs,
}: SecurityHelperOptions) => {
  const loginAttempts = new Map<string, LoginAttemptRecord>();

  const getLoginAttemptKey = (username: string, ipAddress?: string) => `${String(ipAddress ?? 'unknown')}:${String(username).trim().toLowerCase()}`;

  const getRemainingLockoutMs = (key: string) => {
    const attempt = loginAttempts.get(key);
    if (!attempt) {
      return 0;
    }

    const remaining = attempt.lockUntil - Date.now();
    if (remaining <= 0) {
      loginAttempts.delete(key);
      return 0;
    }

    return remaining;
  };

  const registerFailedLogin = (key: string) => {
    const now = Date.now();
    const current = loginAttempts.get(key);
    const nextCount = !current || current.lockUntil <= now ? 1 : current.count + 1;
    const lockUntil = nextCount >= maxLoginAttempts ? now + lockoutDurationMs : 0;

    loginAttempts.set(key, {
      count: nextCount,
      lockUntil,
      lastAttemptAt: now,
    });

    return {
      remainingAttempts: Math.max(0, maxLoginAttempts - nextCount),
      lockUntil,
    };
  };

  const clearLoginAttempt = (key: string) => {
    loginAttempts.delete(key);
  };

  const normalizePin = (value: unknown): string => String(value ?? '').replace(/\D/g, '').slice(0, 6);
  const hashPin = (pin: string): string => bcrypt.hashSync(normalizePin(pin), 10);
  const verifyPin = (pin: string, hash: string): boolean => {
    const normalizedPin = normalizePin(pin);
    const storedHash = String(hash || '').trim();

    if (!normalizedPin || !storedHash) {
      return false;
    }

    try {
      return bcrypt.compareSync(normalizedPin, storedHash);
    } catch {
      return storedHash === normalizedPin;
    }
  };

  const resolveCheckoutActorByPin = async (storeId: unknown, pin: unknown) => {
    const normalizedStoreId = Number(storeId);
    const normalizedPin = normalizePin(pin);

    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0 || !/^\d{4,6}$/.test(normalizedPin)) {
      return null;
    }

    const result = await postgresPool.query(`
      SELECT id, username, role, store_id, pin
      FROM users
      WHERE store_id = $1
        AND role IN ('STORE_ADMIN', 'MANAGER', 'STAFF')
        AND pin IS NOT NULL
    `, [normalizedStoreId]);

    const candidates = result.rows as any[];
    return candidates.find((candidate) => verifyPin(normalizedPin, String(candidate?.pin || ''))) || null;
  };

  const findUserById = async (userId: unknown) => {
    const normalizedUserId = Number(userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      return null;
    }

    const result = await postgresPool.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [normalizedUserId]);
    return result.rows[0] || null;
  };

  const findStoreById = async (storeId: unknown) => {
    const normalizedStoreId = Number(storeId);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
      return null;
    }

    const result = await postgresPool.query('SELECT * FROM stores WHERE id = $1 LIMIT 1', [normalizedStoreId]);
    return result.rows[0] || null;
  };

  const authenticate = async (req: any, res: any, next: any) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const decoded = jwt.verify(token, jwtSecret) as any;
      const currentUser = await findUserById(decoded?.id);

      if (!currentUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      req.user = {
        id: currentUser.id,
        username: currentUser.username,
        role: currentUser.role,
        store_id: currentUser.store_id ?? null,
      };
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  const authorize = (roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };

  const checkStoreLock = async (req: any, res: any, next: any) => {
    if (req.user.role === 'SYSTEM_ADMIN') return next();

    const normalizedStoreId = Number(req.user.store_id || 0);
    if (!Number.isInteger(normalizedStoreId) || normalizedStoreId <= 0) {
      return res.status(403).json({ error: 'This account is not linked to an active store. Ask the system admin to reassign it.' });
    }

    const store = await findStoreById(normalizedStoreId);
    if (!store) {
      return res.status(403).json({ error: 'This account is linked to a store that no longer exists. Ask the system admin to fix it.' });
    }

    req.store = store;

    if (Number(store.is_locked) === 1) {
      return res.status(403).json({ error: 'Store is locked by System Administrator' });
    }

    next();
  };

  return {
    getLoginAttemptKey,
    getRemainingLockoutMs,
    registerFailedLogin,
    clearLoginAttempt,
    normalizePin,
    hashPin,
    verifyPin,
    resolveCheckoutActorByPin,
    findUserById,
    findStoreById,
    authenticate,
    authorize,
    checkStoreLock,
  };
};

export const ensureRootSystemOwner = async ({
  postgresPool,
  rootUsername = 'Goody',
  initialAdminPassword,
}: {
  postgresPool: Pool;
  rootUsername?: string;
  initialAdminPassword: string;
}) => {
  const existingResult = await postgresPool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [rootUsername]);
  if (existingResult.rows[0]) {
    return;
  }

  const hashedPassword = bcrypt.hashSync(initialAdminPassword, 10);
  console.warn('⚠️  Initial admin password: Check INITIAL_ADMIN_PASSWORD environment variable. Change on first login.');

  const oldAdminResult = await postgresPool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', ['admin']);
  const oldAdmin = oldAdminResult.rows[0];
  if (oldAdmin) {
    await postgresPool.query('UPDATE users SET username = $1, password = $2 WHERE id = $3', [rootUsername, hashedPassword, oldAdmin.id]);
    console.log('✅ Root System Owner updated to: Goody');
  } else {
    await postgresPool.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3)', [rootUsername, hashedPassword, 'SYSTEM_ADMIN']);
    console.log('✅ Root System Owner created: Goody');
  }
};

import { test, expect } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

test('system admin can open Manage All Users and see the store user list', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const adminPassword = 'Admin123!';

  const created = db.transaction(() => {
    const systemAdminId = Number(
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .run(`manage_users_admin_${stamp}`, bcrypt.hashSync(adminPassword, 10), 'SYSTEM_ADMIN').lastInsertRowid,
    );
    const storeId = Number(
      db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`Manage Users Store ${stamp}`, 'SUPERMARKET').lastInsertRowid,
    );
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(`manage_owner_${stamp}`, bcrypt.hashSync('Owner123!', 10), 'STORE_ADMIN', storeId).lastInsertRowid,
    );
    const staffId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(`manage_staff_${stamp}`, bcrypt.hashSync('Staff123!', 10), 'STAFF', storeId).lastInsertRowid,
    );

    return { systemAdminId, storeId, ownerId, staffId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `manage_users_admin_${stamp}`, password: adminPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    await page.addInitScript(({ token, user }) => {
      window.localStorage.setItem('ominous_token', token);
      window.localStorage.setItem('ominous_user', JSON.stringify(user));
    }, { token: loginBody.token, user: loginBody.user });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Manage Users Store ${stamp}`)).toBeVisible();

    const storeCard = page.locator('div.bg-white').filter({
      has: page.getByRole('heading', { name: `Manage Users Store ${stamp}` }),
    }).first();
    await storeCard.getByTitle('Manage All Users').click();

    await expect(page.getByRole('heading', { name: 'Manage Users', exact: true })).toBeVisible();
    await expect(page.getByText(`manage_owner_${stamp}`)).toBeVisible();
    await expect(page.getByText(`manage_staff_${stamp}`)).toBeVisible();
  } finally {
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id IN (?, ?, ?)').run(created.systemAdminId, created.ownerId, created.staffId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id IN (?, ?, ?)').run(created.systemAdminId, created.ownerId, created.staffId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(created.systemAdminId, created.ownerId, created.staffId);
    db.prepare('DELETE FROM stores WHERE id = ?').run(created.storeId);
    db.close();
  }
});

test('system admin can delete a user with stock history without crashing the server', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const adminPassword = 'Admin123!';

  const created = db.transaction(() => {
    const systemAdminId = Number(
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .run(`delete_hist_admin_${stamp}`, bcrypt.hashSync(adminPassword, 10), 'SYSTEM_ADMIN').lastInsertRowid,
    );
    const storeId = Number(
      db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`Delete History Store ${stamp}`, 'GADGET').lastInsertRowid,
    );
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(`delete_hist_owner_${stamp}`, bcrypt.hashSync('Owner123!', 10), 'STORE_ADMIN', storeId).lastInsertRowid,
    );
    const staffId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(`delete_hist_staff_${stamp}`, bcrypt.hashSync('Staff123!', 10), 'PROCUREMENT_OFFICER', storeId).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, price, stock, cost) VALUES (?, ?, ?, ?, ?)')
        .run(storeId, `Delete History Product ${stamp}`, 1000, 5, 600).lastInsertRowid,
    );

    db.prepare('INSERT INTO stock_adjustments (store_id, product_id, adjusted_by, quantity_before, quantity_change, quantity_after, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(storeId, productId, staffId, 5, -1, 4, 'Delete user regression coverage');

    return { systemAdminId, storeId, ownerId, staffId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `delete_hist_admin_${stamp}`, password: adminPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const response = await request.delete(`/api/admin/users/${created.staffId}`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const body = await response.json();

    expect(response.ok(), JSON.stringify(body)).toBeTruthy();
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(created.staffId)).toBeUndefined();
  } finally {
    try {
      db.prepare('DELETE FROM stock_adjustments WHERE product_id = ?').run(created.productId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id IN (?, ?, ?)').run(created.systemAdminId, created.ownerId, created.staffId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id IN (?, ?, ?)').run(created.systemAdminId, created.ownerId, created.staffId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(created.systemAdminId, created.ownerId, created.staffId);
    db.prepare('DELETE FROM products WHERE id = ?').run(created.productId);
    db.prepare('DELETE FROM stores WHERE id = ?').run(created.storeId);
    db.close();
  }
});

test('system admin must select a store before creating a store owner', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const adminPassword = 'Admin123!';
  const adminUsername = `missing_store_admin_${stamp}`;

  const created = db.transaction(() => {
    const systemAdminId = Number(
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .run(adminUsername, bcrypt.hashSync(adminPassword, 10), 'SYSTEM_ADMIN').lastInsertRowid,
    );

    return { systemAdminId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: adminUsername, password: adminPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const response = await request.post('/api/admin/users', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        username: `missing_store_owner_${stamp}`,
        password: 'Owner123!',
        role: 'STORE_ADMIN',
        store_id: '',
      },
    });
    const body = await response.json();

    expect(response.ok(), JSON.stringify(body)).toBeFalsy();
    expect(String(body?.error || '').toLowerCase()).toContain('select a store');
  } finally {
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id = ?').run(created.systemAdminId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id = ?').run(created.systemAdminId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id = ?').run(created.systemAdminId);
    db.close();
  }
});

test('system admin cannot create a store owner with the same username ignoring case', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const adminPassword = 'Admin123!';
  const adminUsername = `CaseOwner${stamp}`;
  const conflictingOwnerUsername = adminUsername.toLowerCase();

  const created = db.transaction(() => {
    const systemAdminId = Number(
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)')
        .run(adminUsername, bcrypt.hashSync(adminPassword, 10), 'SYSTEM_ADMIN').lastInsertRowid,
    );
    const storeId = Number(
      db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`Case Conflict Store ${stamp}`, 'SUPERMARKET').lastInsertRowid,
    );

    return { systemAdminId, storeId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: adminUsername, password: adminPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const response = await request.post('/api/admin/users', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        username: conflictingOwnerUsername,
        password: 'Owner123!',
        role: 'STORE_ADMIN',
        store_id: String(created.storeId),
      },
    });
    const body = await response.json();

    expect(response.ok(), JSON.stringify(body)).toBeFalsy();
    expect(String(body?.error || '').toLowerCase()).toContain('username already exists');
  } finally {
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id = ?').run(created.systemAdminId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id = ?').run(created.systemAdminId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id = ?').run(created.systemAdminId);
    db.prepare('DELETE FROM stores WHERE id = ?').run(created.storeId);
    db.close();
  }
});

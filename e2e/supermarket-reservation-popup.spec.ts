import { test, expect } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

test('supermarket items with no pending pro-forma should not show the reservation popup', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const ownerPassword = 'Reserve123!';

  const created = db.transaction(() => {
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`Reservation Store ${stamp}`, 'SUPERMARKET').lastInsertRowid);
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(`reservation_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost, condition_matrix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(storeId, `Reservation Item ${stamp}`, `RSV${stamp}`, `RS${String(stamp).slice(-4)}`, 3200, 4, 2000, '{}').lastInsertRowid,
    );

    return { storeId, ownerId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `reservation_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    await page.addInitScript(({ token, user }) => {
      window.localStorage.setItem('ominous_token', token);
      window.localStorage.setItem('ominous_user', JSON.stringify(user));
    }, { token: loginBody.token, user: loginBody.user });

    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder(/search (product|item) \/ scan barcode \/ quick code/i).fill(`Reservation Item ${stamp}`);
    await page.getByText(`Reservation Item ${stamp}`).first().click();

    await expect(page.getByText(/stock reservation alert/i)).not.toBeVisible();
    await expect(page.getByRole('button', { name: /pay now/i })).toBeEnabled();
    await expect(page.getByText('1 Items')).toBeVisible();
  } finally {
    db.prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = ?)').run(created.storeId);
    db.prepare('DELETE FROM sales WHERE store_id = ?').run(created.storeId);
    db.prepare('DELETE FROM products WHERE id = ?').run(created.productId);
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id = ?').run(created.ownerId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id = ?').run(created.ownerId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id = ?').run(created.ownerId);
    db.prepare('DELETE FROM stores WHERE id = ?').run(created.storeId);
    db.close();
  }
});

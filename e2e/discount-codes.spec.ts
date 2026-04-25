import { test, expect } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

test('store owner can create a discount code and cashiers can apply it at checkout', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const ownerPassword = 'Discount123!';

  const created = db.transaction(() => {
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`Discount Store ${stamp}`, 'SUPERMARKET').lastInsertRowid);
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(`discount_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(storeId, `Discount Item ${stamp}`, `DISC${stamp}`, `DC${String(stamp).slice(-4)}`, 10000, 12, 6500).lastInsertRowid,
    );

    return { storeId, ownerId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `discount_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    await page.addInitScript(({ token, user }) => {
      window.localStorage.setItem('ominous_token', token);
      window.localStorage.setItem('ominous_user', JSON.stringify(user));
    }, { token: loginBody.token, user: loginBody.user });

    await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/checkout discount codes/i)).toBeVisible();

    await page.getByLabel(/code name/i).fill('Welcome 10');
    await page.getByLabel(/^discount code$/i).fill('WELCOME10');
    await page.getByLabel(/value/i).fill('10');
    await page.getByRole('button', { name: /add code/i }).click();

    await expect(page.getByText(/welcome 10/i)).toBeVisible();
    await expect(page.getByText('WELCOME10', { exact: true }).first()).toBeVisible();

    await page.goto('/pos', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder(/search (product|item) \/ scan barcode \/ quick code/i).fill(`Discount Item ${stamp}`);
    await page.getByText(`Discount Item ${stamp}`).first().click();

    const payNowButton = page.getByRole('button', { name: /pay now/i });
    await expect(payNowButton).toBeEnabled();
    await payNowButton.click();

    await page.getByLabel(/^discount code$/i).fill('WELCOME10');
    await page.getByRole('button', { name: /apply code/i }).click();

    await expect(page.getByText(/discount applied/i)).toBeVisible();
    await expect(page.getByText(/welcome 10/i).first()).toBeVisible();
    const discountSummary = page.locator('div').filter({ has: page.getByText(/discount applied/i) }).first();
    await expect(discountSummary).toContainText(/1,000(?:\.00)?/i);
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

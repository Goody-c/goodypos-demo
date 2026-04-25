import { test, expect } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

test('analytics missing-cost queue stays condition-specific after saving one gadget cost', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const ownerPassword = 'Analytics123!';

  const created = db.transaction(() => {
    const storeId = Number(
      db.prepare('INSERT INTO stores (name, mode, default_missing_cost_to_price) VALUES (?, ?, 0)')
        .run(`Analytics Store ${stamp}`, 'GADGET').lastInsertRowid,
    );

    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(`analytics_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId).lastInsertRowid,
    );

    const onlyNewMissingId = Number(
      db.prepare('INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost, condition_matrix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          storeId,
          `Only New Missing ${stamp}`,
          `ANM${stamp}`,
          `ANM${String(stamp).slice(-4)}`,
          0,
          0,
          0,
          JSON.stringify({
            new: { price: 180000, stock: 1, cost: 0 },
            used: { price: 140000, stock: 1, cost: 95000 },
            open_box: { price: 0, stock: 0, cost: 0 },
          }),
        ).lastInsertRowid,
    );

    const twoMissingId = Number(
      db.prepare('INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost, condition_matrix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          storeId,
          `Two Missing Conditions ${stamp}`,
          `AMC${stamp}`,
          `AMC${String(stamp).slice(-4)}`,
          0,
          0,
          0,
          JSON.stringify({
            new: { price: 220000, stock: 1, cost: 0 },
            used: { price: 165000, stock: 1, cost: 0 },
            open_box: { price: 0, stock: 0, cost: 0 },
          }),
        ).lastInsertRowid,
    );

    const baseCostShouldNotHideId = Number(
      db.prepare('INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost, condition_matrix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          storeId,
          `Base Cost Should Not Hide Missing ${stamp}`,
          `ACH${stamp}`,
          `ACH${String(stamp).slice(-4)}`,
          0,
          0,
          45000,
          JSON.stringify({
            new: { price: 90000, stock: 1, cost: 0 },
            used: { price: 65000, stock: 1, cost: 30000 },
            open_box: { price: 0, stock: 0, cost: 0 },
          }),
        ).lastInsertRowid,
    );

    const zeroStockSecondConditionId = Number(
      db.prepare('INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost, condition_matrix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          storeId,
          `Zero Stock Second Condition ${stamp}`,
          `AZS${stamp}`,
          `AZS${String(stamp).slice(-4)}`,
          0,
          0,
          0,
          JSON.stringify({
            new: { price: 700, stock: 70, cost: 0 },
            used: { price: 0, stock: 0, cost: 0 },
            open_box: { price: 700, stock: 0, cost: 0 },
          }),
        ).lastInsertRowid,
    );

    return { storeId, ownerId, onlyNewMissingId, twoMissingId, baseCostShouldNotHideId, zeroStockSecondConditionId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `analytics_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    await page.addInitScript(({ token, user }) => {
      window.localStorage.setItem('ominous_token', token);
      window.localStorage.setItem('ominous_user', JSON.stringify(user));
    }, { token: loginBody.token, user: loginBody.user });

    await page.goto('/analytics', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /real-time analytics/i })).toBeVisible();
    await expect(page.getByText(/quick cost update queue/i)).toBeVisible();

    const onlyNewCard = page.locator('div.rounded-xl.border.border-amber-200.bg-white').filter({
      has: page.getByText(`Only New Missing ${stamp}`, { exact: true }),
    }).first();

    await expect(onlyNewCard).toBeVisible();
    await expect(onlyNewCard.getByPlaceholder(/set new buying cost/i)).toBeVisible();
    await expect(onlyNewCard.getByPlaceholder(/set used buying cost/i)).toHaveCount(0);

    const baseCostCard = page.locator('div.rounded-xl.border.border-amber-200.bg-white').filter({
      has: page.getByText(`Base Cost Should Not Hide Missing ${stamp}`, { exact: true }),
    }).first();

    await expect(baseCostCard).toBeVisible();
    await expect(baseCostCard.getByPlaceholder(/set new buying cost/i)).toBeVisible();
    await expect(baseCostCard.getByPlaceholder(/set used buying cost/i)).toHaveCount(0);

    const twoMissingCard = page.locator('div.rounded-xl.border.border-amber-200.bg-white').filter({
      has: page.getByText(`Two Missing Conditions ${stamp}`, { exact: true }),
    }).first();

    await expect(twoMissingCard).toBeVisible();
    const newInput = twoMissingCard.getByPlaceholder(/set new buying cost/i);
    const usedInput = twoMissingCard.getByPlaceholder(/set used buying cost/i);

    await expect(newInput).toBeVisible();
    await expect(usedInput).toBeVisible();

    await newInput.fill('120000');
    await newInput.press('Enter');

    await expect(page.getByText(/updated successfully/i)).toBeVisible();
    await expect(twoMissingCard).toBeVisible();
    await expect(twoMissingCard.getByPlaceholder(/set used buying cost/i)).toBeVisible();
    await expect(twoMissingCard.getByPlaceholder(/set new buying cost/i)).toHaveCount(0);

    const zeroStockSecondCard = page.locator('div.rounded-xl.border.border-amber-200.bg-white').filter({
      has: page.getByText(`Zero Stock Second Condition ${stamp}`, { exact: true }),
    }).first();

    await expect(zeroStockSecondCard).toBeVisible();
    const zeroStockNewInput = zeroStockSecondCard.getByPlaceholder(/set new buying cost/i);
    const zeroStockOpenBoxInput = zeroStockSecondCard.getByPlaceholder(/set open box buying cost/i);

    await expect(zeroStockNewInput).toBeVisible();
    await expect(zeroStockOpenBoxInput).toBeVisible();

    await zeroStockNewInput.fill('400');
    await zeroStockNewInput.press('Enter');

    await expect(page.getByText(/updated successfully/i)).toBeVisible();
    await expect(zeroStockSecondCard).toBeVisible();
    await expect(zeroStockSecondCard.getByPlaceholder(/set new buying cost/i)).toHaveCount(0);
    await expect(zeroStockSecondCard.getByPlaceholder(/set open box buying cost/i)).toBeVisible();
  } finally {
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM products WHERE id IN (?, ?, ?, ?)').run(created.onlyNewMissingId, created.twoMissingId, created.baseCostShouldNotHideId, created.zeroStockSecondConditionId);
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id = ?').run(created.ownerId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id = ?').run(created.ownerId);
    } catch {}
    try {
      db.prepare('DELETE FROM system_logs WHERE store_id = ? OR user_id = ?').run(created.storeId, created.ownerId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id = ?').run(created.ownerId);
    db.prepare('DELETE FROM stores WHERE id = ?').run(created.storeId);
    db.close();
  }
});

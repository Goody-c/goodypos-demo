import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

type SeededContext = {
  storeId: number;
  ownerId: number;
  productId: number;
  ownerUsername: string;
  ownerPassword: string;
  productName: string;
};

const seedOwnerAndProduct = (db: InstanceType<typeof Database>, stamp: number): SeededContext => {
  const ownerPassword = 'Collect123!';
  const ownerUsername = `market_owner_${stamp}`;
  const productName = `Collection Item ${stamp}`;

  return db.transaction(() => {
    const storeId = Number(
      db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)')
        .run(`Market Collection Store ${stamp}`, 'SUPERMARKET').lastInsertRowid,
    );

    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)')
        .run(ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId).lastInsertRowid,
    );

    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, barcode, quick_code, price, stock, cost, condition_matrix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(storeId, productName, `MC${stamp}`, `MC${String(stamp).slice(-4)}`, 4500, 6, 3000, null).lastInsertRowid,
    );

    return { storeId, ownerId, productId, ownerUsername, ownerPassword, productName };
  })();
};

const loginAsOwner = async (request: APIRequestContext, page: Page, context: SeededContext) => {
  const loginResponse = await request.post('/api/auth/login', {
    data: { username: context.ownerUsername, password: context.ownerPassword },
    failOnStatusCode: false,
  });
  const loginBody = await loginResponse.json().catch(() => ({}));
  expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

  await page.addInitScript(({ token, user }) => {
    window.localStorage.setItem('ominous_token', token);
    window.localStorage.setItem('ominous_user', JSON.stringify(user));
  }, { token: loginBody.token, user: loginBody.user });
};

const installClipboardSpy = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__copiedTexts = [];

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copiedTexts.push(String(text));
        },
      },
    });
  });
};

const installWindowOpenSpy = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__openCalls = [];
    const originalOpen = window.open.bind(window);
    window.open = ((...args: any[]) => {
      (window as any).__openCalls.push(args.map((value) => String(value ?? '')));
      return originalOpen(...args);
    }) as typeof window.open;
  });
};

const createCollectionThroughUi = async (page: Page, context: SeededContext, stamp: number, note: string) => {
  await page.goto('/market-collections', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /new market collection/i })).toBeVisible();

  await page.getByLabel(/collector name/i).fill(`Collector ${stamp}`);
  await page.getByLabel(/phone number/i).fill('08012345678');
  await page.getByLabel(/expected return/i).fill('2030-01-15');
  await page.getByRole('combobox').first().selectOption(String(context.productId));
  await page.getByRole('button', { name: /add item/i }).click();
  await expect(page.locator('p', { hasText: context.productName }).first()).toBeVisible();

  await page.getByLabel(/note/i).fill(note);
  await page.getByRole('button', { name: /save market collection/i }).click();
  await expect(page.getByText(/collection saved with ref/i)).toBeVisible();

  await page.getByPlaceholder(/search collector, phone, or ref/i).fill(`Collector ${stamp}`);
  await expect(page.getByText(`Collector ${stamp}`).first()).toBeVisible();
  await expect(page.getByText(note)).toBeVisible();
};

const cleanupSeededData = (db: InstanceType<typeof Database>, context: SeededContext) => {
  try {
    db.prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = ?)').run(context.storeId);
  } catch {}
  try {
    db.prepare('DELETE FROM sales_returns WHERE store_id = ?').run(context.storeId);
  } catch {}
  try {
    db.prepare('DELETE FROM sales WHERE store_id = ?').run(context.storeId);
  } catch {}
  try {
    db.prepare('DELETE FROM market_collections WHERE store_id = ?').run(context.storeId);
  } catch {}
  try {
    db.prepare('DELETE FROM users_role_upgrade WHERE id = ?').run(context.ownerId);
  } catch {}
  try {
    db.prepare('DELETE FROM users_legacy_roles WHERE id = ?').run(context.ownerId);
  } catch {}
  try {
    db.prepare('DELETE FROM products WHERE id = ?').run(context.productId);
  } catch {}
  try {
    db.prepare('DELETE FROM users WHERE id = ?').run(context.ownerId);
  } catch {}
  try {
    db.prepare('DELETE FROM stores WHERE id = ?').run(context.storeId);
  } catch {}
};

test('store owner can create and mark a market collection as sold', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const context = seedOwnerAndProduct(db, stamp);

  try {
    await loginAsOwner(request, page, context);
    await createCollectionThroughUi(page, context, stamp, 'Sell and close this collection.');

    await page.getByRole('button', { name: /mark as sold/i }).click();
    await expect(page.getByText(/converted to sale/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /resend sold message/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /mark as sold/i })).toHaveCount(0);
  } finally {
    cleanupSeededData(db, context);
    db.close();
  }
});

test('store owner can return a market collection back to inventory', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 1;
  const context = seedOwnerAndProduct(db, stamp);

  try {
    await loginAsOwner(request, page, context);
    await createCollectionThroughUi(page, context, stamp, 'Return this item to stock.');

    await page.getByRole('button', { name: 'Returned', exact: true }).last().click();
    await expect(page.getByText(/returned to available inventory/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /resend return message/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /mark as sold/i })).toHaveCount(0);
  } finally {
    cleanupSeededData(db, context);
    db.close();
  }
});

test('store owner can copy a market collection reference code', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 2;
  const context = seedOwnerAndProduct(db, stamp);

  try {
    await installClipboardSpy(page);
    await loginAsOwner(request, page, context);
    await createCollectionThroughUi(page, context, stamp, 'Copy this collection code.');

    const badgeText = await page.locator('span', { hasText: /Ref\s+\d+/ }).first().innerText();
    const trackingCode = badgeText.replace(/^Ref\s+/i, '').trim();

    await page.getByRole('button', { name: /copy code/i }).first().click();
    await expect(page.getByText(/tracking code .* copied/i)).toBeVisible();

    const copiedTexts = await page.evaluate(() => (window as any).__copiedTexts || []);
    expect(copiedTexts.at(-1)).toBe(trackingCode);
  } finally {
    cleanupSeededData(db, context);
    db.close();
  }
});

test('print slip opens in the current tab for a market collection', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 3;
  const context = seedOwnerAndProduct(db, stamp);

  try {
    await installWindowOpenSpy(page);
    await loginAsOwner(request, page, context);
    await createCollectionThroughUi(page, context, stamp, 'Print this slip in the same tab.');

    const popupPromise = page.waitForEvent('popup', { timeout: 1500 }).catch(() => null);
    await page.getByRole('button', { name: /print slip/i }).first().click();

    const popup = await popupPromise;
    expect(popup).toBeNull();
    await expect(page.getByText(/pop-up blocked/i)).toHaveCount(0);

    const openCalls = await page.evaluate(() => (window as any).__openCalls || []);
    expect(openCalls).toHaveLength(0);
  } finally {
    cleanupSeededData(db, context);
    db.close();
  }
});

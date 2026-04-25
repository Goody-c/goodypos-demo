import { test, expect } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

test('system admin can delete a store with related records', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const storeName = `Delete Test ${stamp}`;
  const username = `delete_test_${stamp}`;
  const adminUsername = `sys_delete_test_${stamp}`;
  const adminPassword = 'DeleteTest123!';
  const phone = `0800${String(stamp).slice(-7)}`;
  const orderNumber = `PO-${stamp}`;
  const trackingCode = `MC-${stamp}`;
  const ticketNumber = `RT-${stamp}`;

  const ids = db.transaction(() => {
    const systemAdminId = Number(
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(adminUsername, bcrypt.hashSync(adminPassword, 10), 'SYSTEM_ADMIN').lastInsertRowid,
    );
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(storeName, 'GADGET').lastInsertRowid);
    const userId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id) VALUES (?, ?, ?, ?)').run(username, bcrypt.hashSync('StoreUser123!', 10), 'STORE_ADMIN', storeId).lastInsertRowid,
    );
    const categoryId = Number(
      db.prepare('INSERT INTO categories (store_id, name) VALUES (?, ?)').run(storeId, `Category ${stamp}`).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, category_id, price, stock, cost) VALUES (?, ?, ?, ?, ?, ?)').run(storeId, `Product ${stamp}`, categoryId, 100, 5, 60).lastInsertRowid,
    );
    const customerId = Number(
      db.prepare('INSERT INTO customers (store_id, name, phone) VALUES (?, ?, ?)').run(storeId, `Customer ${stamp}`, phone).lastInsertRowid,
    );
    const saleId = Number(
      db.prepare('INSERT INTO sales (store_id, subtotal, total, user_id, payment_methods) VALUES (?, ?, ?, ?, ?)').run(storeId, 100, 100, userId, JSON.stringify({ cash: 100 })).lastInsertRowid,
    );
    const supplierId = Number(
      db.prepare('INSERT INTO suppliers (store_id, name) VALUES (?, ?)').run(storeId, `Supplier ${stamp}`).lastInsertRowid,
    );

    db.prepare('INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, subtotal) VALUES (?, ?, ?, ?, ?)').run(saleId, productId, 1, 100, 100);
    db.prepare('INSERT INTO sales_returns (sale_id, store_id, processed_by, reason, items, returned_value, refund_amount) VALUES (?, ?, ?, ?, ?, ?, ?)').run(saleId, storeId, userId, 'Regression test', JSON.stringify([{ productId, quantity: 1 }]), 100, 100);
    db.prepare('INSERT INTO stock_adjustments (store_id, product_id, adjusted_by, quantity_before, quantity_change, quantity_after, note) VALUES (?, ?, ?, ?, ?, ?, ?)').run(storeId, productId, userId, 5, -1, 4, 'Regression test');
    db.prepare('INSERT INTO pro_formas (store_id, customer_id, items, total, expiry_date) VALUES (?, ?, ?, ?, ?)').run(storeId, customerId, JSON.stringify([{ productId, quantity: 1 }]), 100, '2099-01-01');
    db.prepare('INSERT INTO expenses (store_id, title, amount, created_by) VALUES (?, ?, ?, ?)').run(storeId, 'Regression expense', 25, userId);
    db.prepare('INSERT INTO system_activity_logs (store_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(storeId, userId, 'TEST_DELETE', 'activity log');
    db.prepare('INSERT INTO system_logs (store_id, user_id, user_name, action_type, description) VALUES (?, ?, ?, ?, ?)').run(storeId, userId, username, 'TEST_DELETE', 'system log');
    db.prepare('INSERT INTO transaction_flags (store_id, sale_id, flagged_by, note) VALUES (?, ?, ?, ?)').run(storeId, saleId, userId, 'flag note');
    db.prepare('INSERT INTO purchase_orders (store_id, supplier_id, order_number, items, created_by) VALUES (?, ?, ?, ?, ?)').run(storeId, supplierId, orderNumber, JSON.stringify([{ productId, quantity: 1 }]), userId);
    db.prepare('INSERT INTO market_collections (store_id, collector_name, phone, items, expected_return_date, tracking_code, created_by, converted_sale_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(storeId, `Collector ${stamp}`, phone + '9', JSON.stringify([{ productId, quantity: 1 }]), '2099-01-02', trackingCode, userId, saleId);
    db.prepare('INSERT INTO repair_tickets (store_id, ticket_number, customer_name, device_name, issue_summary, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(storeId, ticketNumber, `Repair Customer ${stamp}`, 'Phone', 'No power', userId, userId);
    db.prepare('INSERT INTO internal_messages (store_id, sender_id, recipient_id, message_text) VALUES (?, ?, ?, ?)').run(storeId, userId, userId, 'hello');

    return { systemAdminId, storeId, userId, saleId, productId, supplierId, customerId };
  })();

  const loginResponse = await request.post('/api/auth/login', {
    data: { username: adminUsername, password: adminPassword },
  });
  const loginBody = await loginResponse.json();
  expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

  const response = await request.delete(`/api/admin/stores/${ids.storeId}`, {
    headers: { Authorization: `Bearer ${loginBody.token}` },
  });

  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBeTruthy();
  expect(body.success).toBe(true);

  expect(db.prepare('SELECT id FROM stores WHERE id = ?').get(ids.storeId)).toBeUndefined();
  expect(Number((db.prepare('SELECT COUNT(*) AS count FROM users WHERE store_id = ?').get(ids.storeId) as any)?.count || 0)).toBe(0);
  expect(Number((db.prepare('SELECT COUNT(*) AS count FROM system_activity_logs WHERE store_id = ?').get(ids.storeId) as any)?.count || 0)).toBe(0);
  expect(Number((db.prepare('SELECT COUNT(*) AS count FROM system_logs WHERE store_id = ?').get(ids.storeId) as any)?.count || 0)).toBe(0);

  db.prepare('DELETE FROM users WHERE id = ?').run(ids.systemAdminId);
  db.close();
});

test('deleting the same store twice returns a safe success response', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const storeName = `Delete Twice Store ${stamp}`;
  const adminUsername = `delete_twice_admin_${stamp}`;
  const adminPassword = 'DeleteTwice123!';

  const ids = db.transaction(() => {
    const systemAdminId = Number(
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(adminUsername, bcrypt.hashSync(adminPassword, 10), 'SYSTEM_ADMIN').lastInsertRowid,
    );
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(storeName, 'SUPERMARKET').lastInsertRowid);
    return { systemAdminId, storeId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: adminUsername, password: adminPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const firstDelete = await request.delete(`/api/admin/stores/${ids.storeId}`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    expect(firstDelete.ok()).toBeTruthy();

    const secondDelete = await request.delete(`/api/admin/stores/${ids.storeId}`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const secondBody = await secondDelete.json();
    expect(secondDelete.ok(), JSON.stringify(secondBody)).toBeTruthy();
    expect(secondBody.success).toBe(true);
  } finally {
    try {
      db.prepare('DELETE FROM stores WHERE id = ?').run(ids.storeId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id = ?').run(ids.systemAdminId);
    db.close();
  }
});

test('system admin store delete is resilient to repeated confirm clicks in the UI', async ({ request, page }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const storeName = `UI Delete Store ${stamp}`;
  const adminUsername = `ui_delete_admin_${stamp}`;
  const adminPassword = 'DeleteUi123!';

  const ids = db.transaction(() => {
    const systemAdminId = Number(
      db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(adminUsername, bcrypt.hashSync(adminPassword, 10), 'SYSTEM_ADMIN').lastInsertRowid,
    );
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(storeName, 'SUPERMARKET').lastInsertRowid);
    return { systemAdminId, storeId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: adminUsername, password: adminPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    await page.addInitScript(({ token, user }) => {
      window.localStorage.setItem('ominous_token', token);
      window.localStorage.setItem('ominous_user', JSON.stringify(user));
    }, { token: loginBody.token, user: loginBody.user });

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    const storeCard = page.locator('div.bg-white.p-6.rounded-2xl').filter({ has: page.getByText(storeName) }).first();
    await expect(storeCard).toBeVisible();

    await storeCard.getByTitle(/delete store/i).click();

    const confirmButton = page.getByRole('button', { name: /yes, delete store/i });
    await expect(confirmButton).toBeVisible();
    await confirmButton.dblclick();

    await expect(page.getByText(/store deleted successfully/i)).toBeVisible();
    await expect(page.getByText(storeName)).not.toBeVisible();
    await expect(page.getByText(/store not found/i)).not.toBeVisible();
  } finally {
    try {
      db.prepare('DELETE FROM stores WHERE id = ?').run(ids.storeId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id = ?').run(ids.systemAdminId);
    db.close();
  }
});

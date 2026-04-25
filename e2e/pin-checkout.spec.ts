import { test, expect } from '@playwright/test';
import Database from '../localDataStore.mjs';
import bcrypt from 'bcryptjs';
import path from 'node:path';

const dataRootDir = String(process.env.GOODY_POS_DATA_DIR || process.cwd());
const dbPath = path.join(dataRootDir, 'pos.db');

test.describe.configure({ mode: 'serial' });

test('gadget checkout requires a valid staff PIN and records the sale under the PIN owner', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now();
  const managerPin = '1234';
  const staffPin = '4321';

  const created = db.transaction(() => {
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`PIN Gadget Store ${stamp}`, 'GADGET').lastInsertRowid);
    const managerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_manager_${stamp}`, bcrypt.hashSync('Manager123!', 10), 'MANAGER', storeId, bcrypt.hashSync(managerPin, 10)).lastInsertRowid,
    );
    const staffId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_staff_${stamp}`, bcrypt.hashSync('Staff123!', 10), 'STAFF', storeId, bcrypt.hashSync(staffPin, 10)).lastInsertRowid,
    );
    const customerId = Number(
      db.prepare('INSERT INTO customers (store_id, name, phone) VALUES (?, ?, ?)')
        .run(storeId, `PIN Customer ${stamp}`, `080${String(stamp).slice(-8)}`).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, price, stock, cost) VALUES (?, ?, ?, ?, ?)')
        .run(storeId, `Phone ${stamp}`, 250000, 4, 180000).lastInsertRowid,
    );

    return { storeId, managerId, staffId, customerId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `pin_manager_${stamp}`, password: 'Manager123!' },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const missingPinResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 250000,
        total: 250000,
        payment_methods: { cash: 250000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 250000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const missingPinBody = await missingPinResponse.json();
    expect(missingPinResponse.status(), JSON.stringify(missingPinBody)).toBe(400);
    expect(String(missingPinBody.error || '')).toMatch(/pin/i);

    const updatePinResponse = await request.put('/api/auth/profile/pin', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        currentPin: managerPin,
        newPin: '5678',
      },
    });
    const updatePinBody = await updatePinResponse.json();
    expect(updatePinResponse.ok(), JSON.stringify(updatePinBody)).toBeTruthy();

    const saleResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 250000,
        total: 250000,
        payment_methods: { cash: 250000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        checkout_pin: staffPin,
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 250000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const saleBody = await saleResponse.json();
    expect(saleResponse.ok(), JSON.stringify(saleBody)).toBeTruthy();

    const savedSale = db.prepare('SELECT id, user_id FROM sales WHERE id = ?').get(Number(saleBody.id)) as { id: number; user_id: number } | undefined;
    expect(savedSale?.user_id).toBe(created.staffId);
  } finally {
    db.prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = ?)').run(created.storeId);
    db.prepare('DELETE FROM sales WHERE store_id = ?').run(created.storeId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(created.customerId);
    db.prepare('DELETE FROM products WHERE id = ?').run(created.productId);
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id IN (?, ?)').run(created.managerId, created.staffId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id IN (?, ?)').run(created.managerId, created.staffId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(created.managerId, created.staffId);
    db.prepare('DELETE FROM stores WHERE id = ?').run(created.storeId);
    db.close();
  }
});

test('store owner can reset forgotten team PINs for staff and managers', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 10;
  const ownerPassword = 'Owner123!';
  const oldManagerPin = '2233';
  const oldStaffPin = '3344';
  const newManagerPin = '8899';
  const newStaffPin = '7788';

  const created = db.transaction(() => {
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`PIN Reset Store ${stamp}`, 'GADGET').lastInsertRowid);
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId, bcrypt.hashSync('1111', 10)).lastInsertRowid,
    );
    const managerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_reset_manager_${stamp}`, bcrypt.hashSync('Manager123!', 10), 'MANAGER', storeId, bcrypt.hashSync(oldManagerPin, 10)).lastInsertRowid,
    );
    const staffId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_reset_staff_${stamp}`, bcrypt.hashSync('Staff123!', 10), 'STAFF', storeId, bcrypt.hashSync(oldStaffPin, 10)).lastInsertRowid,
    );
    const customerId = Number(
      db.prepare('INSERT INTO customers (store_id, name, phone) VALUES (?, ?, ?)')
        .run(storeId, `Reset PIN Customer ${stamp}`, `081${String(stamp).slice(-8)}`).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, price, stock, cost) VALUES (?, ?, ?, ?, ?)')
        .run(storeId, `Reset PIN Phone ${stamp}`, 180000, 5, 120000).lastInsertRowid,
    );

    return { storeId, ownerId, managerId, staffId, customerId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `pin_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const resetManagerResponse = await request.put(`/api/admin/users/${created.managerId}/pin`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: { pin: newManagerPin },
    });
    const resetManagerBody = await resetManagerResponse.json();
    expect(resetManagerResponse.ok(), JSON.stringify(resetManagerBody)).toBeTruthy();

    const resetStaffResponse = await request.put(`/api/admin/users/${created.staffId}/pin`, {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: { pin: newStaffPin },
    });
    const resetStaffBody = await resetStaffResponse.json();
    expect(resetStaffResponse.ok(), JSON.stringify(resetStaffBody)).toBeTruthy();

    const oldPinSaleResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 180000,
        total: 180000,
        payment_methods: { cash: 180000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        checkout_pin: oldManagerPin,
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 180000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const oldPinSaleBody = await oldPinSaleResponse.json();
    expect(oldPinSaleResponse.status(), JSON.stringify(oldPinSaleBody)).toBe(400);

    const newPinSaleResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 180000,
        total: 180000,
        payment_methods: { cash: 180000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        checkout_pin: newManagerPin,
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 180000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const newPinSaleBody = await newPinSaleResponse.json();
    expect(newPinSaleResponse.ok(), JSON.stringify(newPinSaleBody)).toBeTruthy();

    const savedSale = db.prepare('SELECT id, user_id FROM sales WHERE id = ?').get(Number(newPinSaleBody.id)) as { id: number; user_id: number } | undefined;
    expect(savedSale?.user_id).toBe(created.managerId);
  } finally {
    db.prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = ?)').run(created.storeId);
    db.prepare('DELETE FROM sales WHERE store_id = ?').run(created.storeId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(created.customerId);
    db.prepare('DELETE FROM products WHERE id = ?').run(created.productId);
    try {
      db.prepare('DELETE FROM users_role_upgrade WHERE id IN (?, ?, ?)').run(created.ownerId, created.managerId, created.staffId);
    } catch {}
    try {
      db.prepare('DELETE FROM users_legacy_roles WHERE id IN (?, ?, ?)').run(created.ownerId, created.managerId, created.staffId);
    } catch {}
    db.prepare('DELETE FROM users WHERE id IN (?, ?, ?)').run(created.ownerId, created.managerId, created.staffId);
    db.prepare('DELETE FROM stores WHERE id = ?').run(created.storeId);
    db.close();
  }
});

test('store owner can disable gadget checkout PIN requirement per store', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 20;
  const ownerPassword = 'Toggle123!';

  const created = db.transaction(() => {
    const storeId = Number(
      db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)')
        .run(`PIN Toggle Store ${stamp}`, 'GADGET').lastInsertRowid,
    );
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_toggle_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId, bcrypt.hashSync('1122', 10)).lastInsertRowid,
    );
    const customerId = Number(
      db.prepare('INSERT INTO customers (store_id, name, phone) VALUES (?, ?, ?)')
        .run(storeId, `Toggle Customer ${stamp}`, `082${String(stamp).slice(-8)}`).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, price, stock, cost) VALUES (?, ?, ?, ?, ?)')
        .run(storeId, `Toggle Phone ${stamp}`, 99000, 3, 70000).lastInsertRowid,
    );

    return { storeId, ownerId, customerId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `pin_toggle_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const disablePinResponse = await request.put('/api/store/settings', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: { pin_checkout_enabled: false },
    });
    const disablePinBody = await disablePinResponse.json();
    expect(disablePinResponse.ok(), JSON.stringify(disablePinBody)).toBeTruthy();

    const settingsResponse = await request.get('/api/store/settings', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const settingsBody = await settingsResponse.json();
    expect(settingsResponse.ok(), JSON.stringify(settingsBody)).toBeTruthy();
    expect(settingsBody.pin_checkout_enabled).toBe(false);

    const saleResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 99000,
        total: 99000,
        payment_methods: { cash: 99000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 99000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const saleBody = await saleResponse.json();
    expect(saleResponse.ok(), JSON.stringify(saleBody)).toBeTruthy();

    const savedSale = db.prepare('SELECT id, user_id FROM sales WHERE id = ?').get(Number(saleBody.id)) as { id: number; user_id: number } | undefined;
    expect(savedSale?.user_id).toBe(created.ownerId);
  } finally {
    db.prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = ?)').run(created.storeId);
    db.prepare('DELETE FROM sales WHERE store_id = ?').run(created.storeId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(created.customerId);
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

test('invalid gadget checkout PIN does not invalidate the logged-in user session', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 30;
  const ownerPassword = 'NoLogout123!';

  const created = db.transaction(() => {
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`PIN Session Store ${stamp}`, 'GADGET').lastInsertRowid);
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_session_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId, bcrypt.hashSync('5566', 10)).lastInsertRowid,
    );
    const customerId = Number(
      db.prepare('INSERT INTO customers (store_id, name, phone) VALUES (?, ?, ?)')
        .run(storeId, `No Logout Customer ${stamp}`, `083${String(stamp).slice(-8)}`).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, price, stock, cost) VALUES (?, ?, ?, ?, ?)')
        .run(storeId, `No Logout Phone ${stamp}`, 125000, 2, 90000).lastInsertRowid,
    );

    return { storeId, ownerId, customerId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `pin_session_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const invalidPinResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 125000,
        total: 125000,
        payment_methods: { cash: 125000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        checkout_pin: '9999',
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 125000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const invalidPinBody = await invalidPinResponse.json();
    expect(invalidPinResponse.status(), JSON.stringify(invalidPinBody)).toBe(400);
    expect(String(invalidPinBody.error || '')).toMatch(/invalid checkout pin/i);

    const stillAuthorizedResponse = await request.get('/api/store/settings', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
    });
    const stillAuthorizedBody = await stillAuthorizedResponse.json();
    expect(stillAuthorizedResponse.ok(), JSON.stringify(stillAuthorizedBody)).toBeTruthy();
    expect(Number(stillAuthorizedBody.id)).toBe(created.storeId);
  } finally {
    db.prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = ?)').run(created.storeId);
    db.prepare('DELETE FROM sales WHERE store_id = ?').run(created.storeId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(created.customerId);
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

test('store owner can recover own PIN using login password when the current PIN is forgotten', async ({ request }) => {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');

  const stamp = Date.now() + 40;
  const ownerPassword = 'Recover123!';
  const oldPin = '2468';
  const newPin = '1357';

  const created = db.transaction(() => {
    const storeId = Number(db.prepare('INSERT INTO stores (name, mode) VALUES (?, ?)').run(`PIN Recover Store ${stamp}`, 'GADGET').lastInsertRowid);
    const ownerId = Number(
      db.prepare('INSERT INTO users (username, password, role, store_id, pin) VALUES (?, ?, ?, ?, ?)')
        .run(`pin_recover_owner_${stamp}`, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId, bcrypt.hashSync(oldPin, 10)).lastInsertRowid,
    );
    const customerId = Number(
      db.prepare('INSERT INTO customers (store_id, name, phone) VALUES (?, ?, ?)')
        .run(storeId, `Recover PIN Customer ${stamp}`, `084${String(stamp).slice(-8)}`).lastInsertRowid,
    );
    const productId = Number(
      db.prepare('INSERT INTO products (store_id, name, price, stock, cost) VALUES (?, ?, ?, ?, ?)')
        .run(storeId, `Recover PIN Phone ${stamp}`, 150000, 3, 100000).lastInsertRowid,
    );

    return { storeId, ownerId, customerId, productId };
  })();

  try {
    const loginResponse = await request.post('/api/auth/login', {
      data: { username: `pin_recover_owner_${stamp}`, password: ownerPassword },
    });
    const loginBody = await loginResponse.json();
    expect(loginResponse.ok(), JSON.stringify(loginBody)).toBeTruthy();

    const recoverResponse = await request.put('/api/auth/profile/pin', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        currentPassword: ownerPassword,
        newPin,
      },
    });
    const recoverBody = await recoverResponse.json();
    expect(recoverResponse.ok(), JSON.stringify(recoverBody)).toBeTruthy();

    const oldPinSaleResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 150000,
        total: 150000,
        payment_methods: { cash: 150000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        checkout_pin: oldPin,
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 150000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const oldPinSaleBody = await oldPinSaleResponse.json();
    expect(oldPinSaleResponse.status(), JSON.stringify(oldPinSaleBody)).toBe(400);

    const newPinSaleResponse = await request.post('/api/sales', {
      headers: { Authorization: `Bearer ${loginBody.token}` },
      data: {
        subtotal: 150000,
        total: 150000,
        payment_methods: { cash: 150000, transfer: 0, pos: 0 },
        customer_id: created.customerId,
        checkout_pin: newPin,
        items: [
          {
            product_id: created.productId,
            quantity: 1,
            price_at_sale: 150000,
            condition: 'NEW',
            specs_at_sale: {},
          },
        ],
      },
    });
    const newPinSaleBody = await newPinSaleResponse.json();
    expect(newPinSaleResponse.ok(), JSON.stringify(newPinSaleBody)).toBeTruthy();

    const savedSale = db.prepare('SELECT id, user_id FROM sales WHERE id = ?').get(Number(newPinSaleBody.id)) as { id: number; user_id: number } | undefined;
    expect(savedSale?.user_id).toBe(created.ownerId);
  } finally {
    db.prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE store_id = ?)').run(created.storeId);
    db.prepare('DELETE FROM sales WHERE store_id = ?').run(created.storeId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(created.customerId);
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

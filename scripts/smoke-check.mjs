#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import Database from '../localDataStore.mjs';

const BASE_URL = String(process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const hasExplicitSmokeCredentials = Boolean(process.env.SMOKE_USERNAME || process.env.SMOKE_PASSWORD);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRootDir = path.resolve(scriptDir, '..');
const isLocalSmokeTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE_URL);
const allowLocalSmokeBootstrap = String(process.env.GOODY_POS_ENABLE_LOCAL_SMOKE_BOOTSTRAP || '').trim().toLowerCase() === 'true';

let username = String(process.env.SMOKE_USERNAME || process.env.ROOT_USERNAME || 'Goody').trim();
let password = String(process.env.SMOKE_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD || '').trim();
let procurementUsername = String(process.env.SMOKE_PROCUREMENT_USERNAME || '').trim();
let procurementPassword = String(process.env.SMOKE_PROCUREMENT_PASSWORD || '').trim();

const results = [];

const icons = {
  pass: '✅',
  warn: '⚠️',
  fail: '❌',
};

const record = (status, label, details = '') => {
  results.push({ status, label, details });
  console.log(`${icons[status]} ${label}${details ? ` — ${details}` : ''}`);
};

const resolveLocalDbPath = () => {
  const configuredDataDir = String(process.env.GOODY_POS_DATA_DIR || '').trim();
  const dataRoot = configuredDataDir ? path.resolve(configuredDataDir) : repoRootDir;
  return path.join(dataRoot, 'pos.db');
};

const ensureLocalSmokeAccount = () => {
  if (!isLocalSmokeTarget || !allowLocalSmokeBootstrap) return null;

  const dbPath = resolveLocalDbPath();
  if (!fs.existsSync(dbPath)) return null;

  const smokeUsername = String(process.env.SMOKE_USERNAME || 'smoke_test_owner').trim() || 'smoke_test_owner';
  const smokePassword = String(process.env.SMOKE_PASSWORD || 'SmokeTest123!').trim() || 'SmokeTest123!';
  const procurementSmokeUsername = String(process.env.SMOKE_PROCUREMENT_USERNAME || 'smoke_test_procurement').trim() || 'smoke_test_procurement';
  const procurementSmokePassword = String(process.env.SMOKE_PROCUREMENT_PASSWORD || smokePassword).trim() || smokePassword;

  let db;
  try {
    db = new Database(dbPath, { fileMustExist: true });

    const store = db.prepare(`
      SELECT id, name
      FROM stores
      ORDER BY CASE WHEN COALESCE(is_locked, 0) = 0 THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get();

    if (!store?.id) {
      return null;
    }

    const hashedPassword = bcrypt.hashSync(smokePassword, 10);
    const hashedPin = bcrypt.hashSync('1234', 10);
    const hashedProcurementPassword = bcrypt.hashSync(procurementSmokePassword, 10);
    const hashedProcurementPin = bcrypt.hashSync('1234', 10);
    const existingUser = db.prepare(`
      SELECT id
      FROM users
      WHERE LOWER(username) = LOWER(?)
      LIMIT 1
    `).get(smokeUsername);
    const existingProcurementUser = db.prepare(`
      SELECT id
      FROM users
      WHERE LOWER(username) = LOWER(?)
      LIMIT 1
    `).get(procurementSmokeUsername);

    if (existingUser?.id) {
      db.prepare(`
        UPDATE users
        SET password = ?, role = 'STORE_ADMIN', store_id = ?, pin = ?
        WHERE id = ?
      `).run(hashedPassword, Number(store.id), hashedPin, Number(existingUser.id));
    } else {
      db.prepare(`
        INSERT INTO users (username, password, role, store_id, pin)
        VALUES (?, ?, 'STORE_ADMIN', ?, ?)
      `).run(smokeUsername, hashedPassword, Number(store.id), hashedPin);
    }

    if (existingProcurementUser?.id) {
      db.prepare(`
        UPDATE users
        SET password = ?, role = 'PROCUREMENT_OFFICER', store_id = ?, pin = ?
        WHERE id = ?
      `).run(hashedProcurementPassword, Number(store.id), hashedProcurementPin, Number(existingProcurementUser.id));
    } else {
      db.prepare(`
        INSERT INTO users (username, password, role, store_id, pin)
        VALUES (?, ?, 'PROCUREMENT_OFFICER', ?, ?)
      `).run(procurementSmokeUsername, hashedProcurementPassword, Number(store.id), hashedProcurementPin);
    }

    return {
      username: smokeUsername,
      password: smokePassword,
      procurementUsername: procurementSmokeUsername,
      procurementPassword: procurementSmokePassword,
      storeName: String(store.name || `Store #${store.id}`),
    };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // ignore close issues during smoke prep
    }
  }
};

const summarizeCollection = (data) => {
  if (Array.isArray(data)) return `${data.length} item(s)`;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.items)) return `${data.items.length} item(s)`;
    if (Array.isArray(data.contacts)) return `${data.contacts.length} contact(s)`;
    if (Array.isArray(data.messages)) return `${data.messages.length} message(s)`;
    if (Array.isArray(data.repairs)) return `${data.repairs.length} repair(s)`;
    if (Array.isArray(data.expenses)) return `${data.expenses.length} expense(s)`;
    if (Array.isArray(data.customers)) return `${data.customers.length} customer(s)`;
    if (Array.isArray(data.proformas)) return `${data.proformas.length} record(s)`;
    if (typeof data.total === 'number') return `total ${data.total}`;
  }
  return 'ok';
};

const safeJsonParse = (value, fallback = null) => {
  try {
    if (value == null || value === '') return fallback;
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

const pickSaleCandidate = (products = []) => {
  for (const product of products) {
    const conditionMatrix = safeJsonParse(product?.condition_matrix, null);
    if (conditionMatrix && typeof conditionMatrix === 'object') {
      for (const [condition, slot] of Object.entries(conditionMatrix)) {
        const stock = Number(slot?.stock || 0);
        const price = Number(slot?.price || 0);
        if (stock > 0 && price > 0) {
          return {
            productId: Number(product.id),
            name: String(product.name || `Product #${product.id}`),
            price,
            condition,
            currentStock: stock,
          };
        }
      }
    }

    const stock = Number(product?.stock || 0);
    const price = Number(product?.price || 0);
    if (stock > 0 && price > 0) {
      return {
        productId: Number(product.id),
        name: String(product.name || `Product #${product.id}`),
        price,
        condition: null,
        currentStock: stock,
      };
    }
  }

  return null;
};

const request = async (path, options = {}, token) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    };

    const response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : await response.text();

    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
};

console.log(`\n🔎 GoodyPOS smoke audit starting against ${BASE_URL}\n`);

if (!hasExplicitSmokeCredentials) {
  const localSmokeAccount = ensureLocalSmokeAccount();
  if (localSmokeAccount) {
    username = localSmokeAccount.username;
    password = localSmokeAccount.password;
    procurementUsername = localSmokeAccount.procurementUsername || procurementUsername;
    procurementPassword = localSmokeAccount.procurementPassword || procurementPassword;
    record('pass', 'Local smoke account ready', `${localSmokeAccount.username} on ${localSmokeAccount.storeName}`);
  }
}

try {
  const health = await request('/api/health');
  if (!health.ok) {
    record('fail', 'Backend health check', `HTTP ${health.status}`);
    process.exit(1);
  }
  record('pass', 'Backend health check', `${health.data.environment || 'unknown'} mode`);

  const versionInfo = await request('/api/app/version');
  if (!versionInfo.ok) {
    record('fail', 'App version endpoint', `HTTP ${versionInfo.status}`);
    process.exit(1);
  }
  record('pass', 'App version endpoint', `v${versionInfo.data?.version || 'unknown'}`);
} catch (error) {
  record('fail', 'Backend health check', error instanceof Error ? error.message : String(error));
  console.log('\nStart the app first with `npm run dev` or `npm start`, then run `npm run smoke`.');
  process.exit(1);
}

if (!username || !password) {
  record('warn', 'Login skipped', 'Set SMOKE_USERNAME and SMOKE_PASSWORD for protected route checks.');
} else {
  let token = '';
  let user = null;
  let smokeCustomer = null;

  try {
    const login = await request('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });

    if (!login.ok || !login.data?.token) {
      const detail = `HTTP ${login.status} ${login.data?.error || 'Unable to authenticate'}`.trim();
      if (hasExplicitSmokeCredentials) {
        record('fail', 'Login', detail);
        process.exit(1);
      }

      record('warn', 'Protected route checks skipped', `${detail}. Set SMOKE_USERNAME and SMOKE_PASSWORD to an active Store Owner or Manager account for full app coverage.`);
      const passCount = results.filter((entry) => entry.status === 'pass').length;
      const warnCount = results.filter((entry) => entry.status === 'warn').length;
      const failCount = results.filter((entry) => entry.status === 'fail').length;
      console.log(`\nSummary: ${passCount} passed, ${warnCount} warning(s), ${failCount} failed.\n`);
      process.exit(failCount > 0 ? 1 : 0);
    }

    token = login.data.token;
    user = login.data.user || null;
    record('pass', 'Login', `${user?.username || username} (${user?.role || 'unknown role'})`);

    const verify = await request('/api/auth/verify', {}, token);
    if (!verify.ok) {
      record('fail', 'Token verification', `HTTP ${verify.status}`);
    } else {
      record('pass', 'Token verification', 'authenticated');
    }

    const checks = [];

    if (String(user?.role || '') === 'SYSTEM_ADMIN') {
      checks.push({ label: 'Admin stores', path: '/api/admin/stores' });
    }

    if (user?.store_id) {
      checks.push(
        { label: 'Store settings', path: '/api/store/settings' },
        { label: 'Products list', path: '/api/products?limit=5&offset=0' },
        { label: 'Categories list', path: '/api/categories' },
        { label: 'Stock adjustments list', path: '/api/stock-adjustments' },
        { label: 'Inventory daily summary', path: '/api/inventory/daily-summary' },
        { label: 'Held carts list', path: '/api/pos/holds' },
        { label: 'Customers list', path: '/api/customers' },
        { label: 'Sales list', path: '/api/sales?limit=5&offset=0' },
        { label: 'Analytics summary', path: '/api/analytics' },
        { label: 'Dashboard activity feed', path: '/api/dashboard/activity-feed' },
        { label: 'Pro-formas list', path: '/api/pro-formas' },
        { label: 'Internal chat contacts', path: '/api/internal-messages/contacts' },
        { label: 'Handover notes list', path: '/api/handover-notes' },
        { label: 'Attendance summary', path: '/api/attendance' },
        { label: 'Repairs list', path: '/api/repairs' },
        { label: 'Inventory batches list', path: '/api/inventory/batches' },
        { label: 'My sales chart', path: '/api/reports/my-sales-chart' },
        { label: 'Z-report', path: '/api/reports/z-report' }
      );

      if (['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT'].includes(String(user?.role || ''))) {
        checks.push(
          { label: 'Expenses list', path: '/api/expenses' },
          { label: 'Daily reminders', path: '/api/reminders/daily' },
          { label: 'Staff sales chart', path: '/api/reports/staff-sales-chart' }
        );
      }

      if (['STORE_ADMIN', 'MANAGER'].includes(String(user?.role || ''))) {
        checks.push(
          { label: 'Staff sales history', path: `/api/reports/staff-sales-history/${user.id}` },
          { label: 'Market collections list', path: '/api/market-collections' },
          { label: 'Layaway plans', path: '/api/layaways' },
          { label: 'Returns list', path: '/api/returns' }
        );
      }

      if (['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER'].includes(String(user?.role || ''))) {
        checks.push(
          { label: 'Suppliers list', path: '/api/suppliers' },
          { label: 'Purchase orders list', path: '/api/purchase-orders' }
        );
      }

      if (['STORE_ADMIN', 'MANAGER'].includes(String(user?.role || ''))) {
        checks.push({ label: 'Pending sales list', path: '/api/sales/pending' });
      }

      if (['STORE_ADMIN', 'ACCOUNTANT'].includes(String(user?.role || ''))) {
        checks.push(
          { label: 'Financial ledger', path: '/api/reports/financial-ledger' },
          { label: 'Audit flags list', path: '/api/audit-flags' }
        );
      }

      if (String(user?.role || '') === 'STORE_ADMIN') {
        checks.push(
          { label: 'Store export', path: '/api/admin/store/export' },
          { label: 'System log summary', path: '/api/system-logs/summary' },
          { label: 'System logs', path: '/api/system-logs?limit=20' }
        );
        
        checks.push({
          label: 'Chat cleanup dry-run',
          path: '/api/internal-messages/cleanup',
          method: 'POST',
          body: { older_than_value: 365, older_than_unit: 'days', dry_run: true },
        });
      }
    } else {
      record('warn', 'Store feature checks skipped', 'Logged-in user is not attached to a store. Use a Store Owner account for full feature coverage.');
    }

    for (const check of checks) {
      try {
        const response = await request(check.path, {
          method: check.method || 'GET',
          body: check.body,
        }, token);

        if (!response.ok) {
          record('fail', check.label, `HTTP ${response.status} ${response.data?.error || ''}`.trim());
          continue;
        }

        if (check.label === 'Store export') {
          const hasExpandedPayload = Array.isArray(response.data?.suppliers)
            && Array.isArray(response.data?.purchaseOrders)
            && Array.isArray(response.data?.inventoryBatches)
            && Array.isArray(response.data?.transactionFlags)
            && Array.isArray(response.data?.internalMessages)
            && Array.isArray(response.data?.staffAttendance)
            && Array.isArray(response.data?.repairTickets);

          if (!hasExpandedPayload) {
            record('fail', check.label, 'Expanded backup payload is missing one or more new table collections');
            continue;
          }
        }

        const details = check.label === 'Chat cleanup dry-run'
          ? `${Number(response.data?.wouldDeleteCount || 0)} message(s) would be cleared`
          : summarizeCollection(response.data);

        record('pass', check.label, details);
      } catch (error) {
        record('fail', check.label, error instanceof Error ? error.message : String(error));
      }
    }

    if (user?.store_id) {
      try {
        const uniqueSuffix = `${Date.now()}`.slice(-6);
        const smokeCustomerPhone = `070${uniqueSuffix.padStart(6, '0')}`;
        const customerCreate = await request('/api/customers', {
          method: 'POST',
          body: {
            name: `Smoke Customer ${uniqueSuffix}`,
            phone: smokeCustomerPhone,
            address: 'Smoke sync validation',
          },
        }, token);

        if (!customerCreate.ok) {
          record('fail', 'Customer create', `HTTP ${customerCreate.status} ${customerCreate.data?.error || ''}`.trim());
        } else {
          smokeCustomer = {
            id: Number(customerCreate.data?.id || 0) || null,
            name: `Smoke Customer ${uniqueSuffix}`,
            phone: smokeCustomerPhone,
            address: 'Smoke sync validation',
          };
          record('pass', 'Customer create', `#${customerCreate.data?.id || 'new'} ${customerCreate.data?.customer_code || ''}`.trim());

          const customerLookup = await request(`/api/customers/search?phone=${encodeURIComponent(smokeCustomerPhone)}`, {}, token);
          if (!customerLookup.ok || !customerLookup.data?.id) {
            record('fail', 'Customer lookup', `HTTP ${customerLookup.status} ${customerLookup.data?.error || 'Customer not found after create'}`.trim());
          } else {
            smokeCustomer = {
              id: Number(customerLookup.data?.id || smokeCustomer?.id || 0) || null,
              name: String(customerLookup.data?.name || smokeCustomer?.name || smokeCustomerPhone),
              phone: String(customerLookup.data?.phone || smokeCustomer?.phone || smokeCustomerPhone),
              address: String(customerLookup.data?.address || smokeCustomer?.address || 'Smoke sync validation'),
            };
            record('pass', 'Customer lookup', String(customerLookup.data?.name || smokeCustomerPhone));

            const invoicesResponse = await request(`/api/customers/${smokeCustomer.id}/invoices`, {}, token);
            if (!invoicesResponse.ok) {
              record('fail', 'Customer invoices', `HTTP ${invoicesResponse.status} ${invoicesResponse.data?.error || ''}`.trim());
            } else {
              record('pass', 'Customer invoices', summarizeCollection(invoicesResponse.data?.invoices || []));
            }
          }
        }
      } catch (error) {
        record('fail', 'Customer create', error instanceof Error ? error.message : String(error));
      }

      try {
        const userSuffix = `${Date.now()}`.slice(-6);
        const managedUsername = `smoke_staff_${userSuffix}`;
        const userCreate = await request('/api/admin/users', {
          method: 'POST',
          body: {
            username: managedUsername,
            password: 'smoke123',
            role: 'STAFF',
            pin: '1234',
          },
        }, token);

        if (!userCreate.ok || !userCreate.data?.id) {
          record('fail', 'User create', `HTTP ${userCreate.status} ${userCreate.data?.error || ''}`.trim());
        } else {
          const managedUserId = Number(userCreate.data.id);
          record('pass', 'User create', `#${managedUserId} ${managedUsername}`);

          const userPinUpdate = await request(`/api/admin/users/${managedUserId}/pin`, {
            method: 'PUT',
            body: { pin: '4321' },
          }, token);

          if (!userPinUpdate.ok) {
            record('fail', 'User pin update', `HTTP ${userPinUpdate.status} ${userPinUpdate.data?.error || ''}`.trim());
          } else {
            record('pass', 'User pin update', `#${managedUserId}`);
          }

          const userPasswordUpdate = await request(`/api/admin/users/${managedUserId}/password`, {
            method: 'PUT',
            body: { password: 'smoke456' },
          }, token);

          if (!userPasswordUpdate.ok) {
            record('fail', 'User password update', `HTTP ${userPasswordUpdate.status} ${userPasswordUpdate.data?.error || ''}`.trim());
          } else {
            record('pass', 'User password update', `#${managedUserId}`);
          }

          const userDelete = await request(`/api/admin/users/${managedUserId}`, {
            method: 'DELETE',
          }, token);

          if (!userDelete.ok) {
            record('fail', 'User delete', `HTTP ${userDelete.status} ${userDelete.data?.error || ''}`.trim());
          } else {
            record('pass', 'User delete', `#${managedUserId} removed`);
          }
        }
      } catch (error) {
        record('fail', 'User create', error instanceof Error ? error.message : String(error));
      }

      try {
        const expenseSuffix = `${Date.now()}`.slice(-6);
        const expenseCreate = await request('/api/expenses', {
          method: 'POST',
          body: {
            title: `Smoke Expense ${expenseSuffix}`,
            category: 'Testing',
            amount: 123.45,
            note: 'Auto-generated expense validation',
          },
        }, token);

        if (!expenseCreate.ok || !expenseCreate.data?.id) {
          record('fail', 'Expense create', `HTTP ${expenseCreate.status} ${expenseCreate.data?.error || ''}`.trim());
        } else {
          record('pass', 'Expense create', `#${expenseCreate.data.id}`);
          const expenseDelete = await request(`/api/expenses/${expenseCreate.data.id}`, {
            method: 'DELETE',
          }, token);

          if (!expenseDelete.ok) {
            record('fail', 'Expense delete', `HTTP ${expenseDelete.status} ${expenseDelete.data?.error || ''}`.trim());
          } else {
            record('pass', 'Expense delete', `#${expenseCreate.data.id} removed`);
          }
        }
      } catch (error) {
        record('fail', 'Expense create', error instanceof Error ? error.message : String(error));
      }

      try {
        const [storeSettingsResponse, productsResponse] = await Promise.all([
          request('/api/store/settings', {}, token),
          request('/api/products?limit=50&offset=0', {}, token),
        ]);

        const products = Array.isArray(productsResponse.data?.items)
          ? productsResponse.data.items
          : Array.isArray(productsResponse.data)
            ? productsResponse.data
            : [];
        const saleCandidate = pickSaleCandidate(products);

        if (!storeSettingsResponse.ok || !saleCandidate) {
          record('warn', 'Transactional sales checks skipped', !storeSettingsResponse.ok ? `Store settings HTTP ${storeSettingsResponse.status}` : 'No in-stock product with a valid price was available.');
        } else {
          const requiresCheckoutPin = String(storeSettingsResponse.data?.mode || '').toUpperCase() === 'GADGET'
            && Number(storeSettingsResponse.data?.pin_checkout_enabled ?? 1) === 1;
          const saleTotal = Number(saleCandidate.price.toFixed(2));
          const transactionSuffix = `${Date.now()}`.slice(-6);
          const expectedReturnDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          const saleBody = {
            subtotal: saleTotal,
            tax_amount: 0,
            tax_percentage: 0,
            total: saleTotal,
            payment_methods: { cash: saleTotal, transfer: 0, pos: 0 },
            items: [{
              product_id: saleCandidate.productId,
              quantity: 1,
              price_at_sale: saleTotal,
              ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
            }],
            status: 'COMPLETED',
            ...(requiresCheckoutPin ? { checkout_pin: '1234' } : {}),
          };

          const categoryCreate = await request('/api/categories', {
            method: 'POST',
            body: {
              name: `Smoke Category ${transactionSuffix}`,
              description: 'Auto-generated category validation',
            },
          }, token);

          if (!categoryCreate.ok || !categoryCreate.data?.id) {
            record('fail', 'Category create', `HTTP ${categoryCreate.status} ${categoryCreate.data?.error || ''}`.trim());
          } else {
            record('pass', 'Category create', `#${categoryCreate.data.id}`);

            const categoryUpdate = await request(`/api/categories/${categoryCreate.data.id}`, {
              method: 'PUT',
              body: {
                name: `Smoke Category ${transactionSuffix} Updated`,
                description: 'Auto-generated category update validation',
              },
            }, token);

            if (!categoryUpdate.ok) {
              record('fail', 'Category update', `HTTP ${categoryUpdate.status} ${categoryUpdate.data?.error || ''}`.trim());
            } else {
              record('pass', 'Category update', `#${categoryCreate.data.id} updated`);
            }

            const categoryDelete = await request(`/api/categories/${categoryCreate.data.id}`, {
              method: 'DELETE',
            }, token);

            if (!categoryDelete.ok) {
              record('fail', 'Category delete', `HTTP ${categoryDelete.status} ${categoryDelete.data?.error || ''}`.trim());
            } else {
              record('pass', 'Category delete', `#${categoryCreate.data.id} removed`);
            }
          }

          const productCreate = await request('/api/products', {
            method: 'POST',
            body: {
              name: `Smoke Product ${transactionSuffix}`,
              category: `Smoke Product Group ${transactionSuffix}`,
              price: saleTotal,
              stock: 2,
              cost: Math.max(0, Number((saleTotal / 2).toFixed(2))),
              specs: { color: 'black' },
            },
          }, token);

          if (!productCreate.ok || !productCreate.data?.id) {
            record('fail', 'Product create', `HTTP ${productCreate.status} ${productCreate.data?.error || ''}`.trim());
          } else {
            record('pass', 'Product create', `#${productCreate.data.id}`);

            const productUpdate = await request(`/api/products/${productCreate.data.id}`, {
              method: 'PUT',
              body: {
                name: `Smoke Product ${transactionSuffix} Updated`,
                barcode: productCreate.data?.barcode || null,
                category: `Smoke Product Group ${transactionSuffix}`,
                price: Number((saleTotal + 1).toFixed(2)),
                stock: 3,
                cost: Math.max(0, Number((saleTotal / 2).toFixed(2))),
                specs: { color: 'silver' },
              },
            }, token);

            if (!productUpdate.ok) {
              record('fail', 'Product update', `HTTP ${productUpdate.status} ${productUpdate.data?.error || ''}`.trim());
            } else {
              record('pass', 'Product update', `#${productCreate.data.id} updated`);
            }

            const productDelete = await request(`/api/products/${productCreate.data.id}`, {
              method: 'DELETE',
            }, token);

            if (!productDelete.ok) {
              record('fail', 'Product delete', `HTTP ${productDelete.status} ${productDelete.data?.error || ''}`.trim());
            } else {
              record('pass', 'Product delete', `#${productCreate.data.id} archived`);
            }
          }

          const holdCreate = await request('/api/pos/hold', {
            method: 'POST',
            body: {
              customer_name: smokeCustomer?.name || `Smoke Hold ${transactionSuffix}`,
              note: 'Auto-generated hold validation',
              cart_data: [{
                product_id: saleCandidate.productId,
                name: saleCandidate.name,
                quantity: 1,
                price_at_sale: saleTotal,
                subtotal: saleTotal,
                ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
              }],
            },
          }, token);

          if (!holdCreate.ok || !holdCreate.data?.id) {
            record('fail', 'POS hold create', `HTTP ${holdCreate.status} ${holdCreate.data?.error || ''}`.trim());
          } else {
            const holdId = Number(holdCreate.data.id);
            record('pass', 'POS hold create', `#${holdId}`);

            const holdsList = await request('/api/pos/holds', {}, token);
            const holdRows = Array.isArray(holdsList.data) ? holdsList.data : [];
            const createdHold = holdRows.find((entry) => Number(entry?.id) === holdId);

            if (!holdsList.ok || !createdHold) {
              record('fail', 'POS hold list', `HTTP ${holdsList.status} ${holdsList.data?.error || 'Created hold not found'}`.trim());
            } else {
              record('pass', 'POS hold list', `#${holdId} visible`);
            }

            const holdDelete = await request(`/api/pos/holds/${holdId}`, {
              method: 'DELETE',
            }, token);

            if (!holdDelete.ok) {
              record('fail', 'POS hold delete', `HTTP ${holdDelete.status} ${holdDelete.data?.error || ''}`.trim());
            } else {
              record('pass', 'POS hold delete', `#${holdId} removed`);
            }
          }

          const importProductName = `Smoke Import Product ${transactionSuffix}`;
          const productImport = await request('/api/import/products', {
            method: 'POST',
            body: {
              rows: [{
                name: importProductName,
                category: `Smoke Import Category ${transactionSuffix}`,
                price: saleTotal,
                stock: 2,
                cost: Math.max(0, Number((saleTotal / 2).toFixed(2))),
              }],
            },
          }, token);

          if (!productImport.ok || Number(productImport.data?.importedCount || 0) < 1) {
            record('fail', 'Product import', `HTTP ${productImport.status} ${productImport.data?.error || ''}`.trim());
          } else {
            record('pass', 'Product import', `${productImport.data.importedCount} row(s)`);

            const importedProductsResponse = await request('/api/products?limit=500&offset=0', {}, token);
            const importedProducts = Array.isArray(importedProductsResponse.data?.items)
              ? importedProductsResponse.data.items
              : Array.isArray(importedProductsResponse.data)
                ? importedProductsResponse.data
                : [];
            const importedProduct = importedProducts.find((entry) => String(entry?.name || '') === importProductName);

            if (!importedProductsResponse.ok || !importedProduct?.id) {
              record('fail', 'Product import lookup', `HTTP ${importedProductsResponse.status} ${importedProductsResponse.data?.error || 'Imported product not found'}`.trim());
            } else {
              record('pass', 'Product import lookup', `#${importedProduct.id}`);
              await request(`/api/products/${importedProduct.id}`, { method: 'DELETE' }, token);
            }
          }

          const importCustomerPhone = `081${transactionSuffix.padStart(7, '0').slice(-7)}`;
          const customerImport = await request('/api/import/customers', {
            method: 'POST',
            body: {
              rows: [{
                name: `Smoke Import Customer ${transactionSuffix}`,
                phone: importCustomerPhone,
                address: 'Smoke customer import validation',
              }],
            },
          }, token);

          if (!customerImport.ok || Number(customerImport.data?.importedCount || 0) < 1) {
            record('fail', 'Customer import', `HTTP ${customerImport.status} ${customerImport.data?.error || ''}`.trim());
          } else {
            record('pass', 'Customer import', `${customerImport.data.importedCount} row(s)`);

            const importedCustomerLookup = await request(`/api/customers/search?phone=${encodeURIComponent(importCustomerPhone)}`, {}, token);
            if (!importedCustomerLookup.ok || !importedCustomerLookup.data?.id) {
              record('fail', 'Customer import lookup', `HTTP ${importedCustomerLookup.status} ${importedCustomerLookup.data?.error || 'Imported customer not found'}`.trim());
            } else {
              record('pass', 'Customer import lookup', `#${importedCustomerLookup.data.id}`);
            }
          }

          const salesImport = await request('/api/import/sales', {
            method: 'POST',
            body: {
              rows: [{
                customer_name: `Smoke Imported Sale ${transactionSuffix}`,
                customer_phone: `082${transactionSuffix.padStart(7, '0').slice(-7)}`,
                customer_address: 'Smoke sales import validation',
                product_name: saleCandidate.name,
                barcode: saleCandidate.barcode || '',
                quantity: 1,
                price_at_sale: saleTotal,
                subtotal: saleTotal,
                total: saleTotal,
                tax_amount: 0,
                tax_percentage: 0,
                status: 'COMPLETED',
                ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
              }],
            },
          }, token);

          if (!salesImport.ok || Number(salesImport.data?.importedCount || 0) < 1) {
            record('fail', 'Sales import', `HTTP ${salesImport.status} ${salesImport.data?.error || ''}`.trim());
          } else {
            record('pass', 'Sales import', `${salesImport.data.importedCount} row(s)`);
          }

          const supplierCreate = await request('/api/suppliers', {
            method: 'POST',
            body: {
              name: `Smoke Supplier ${transactionSuffix}`,
              phone: `090${transactionSuffix.padStart(6, '0')}`,
              email: `smoke-supplier-${transactionSuffix}@example.com`,
              address: 'Smoke sync validation',
              note: 'Auto-generated supplier validation',
            },
          }, token);

          if (!supplierCreate.ok || !supplierCreate.data?.supplier?.id) {
            record('fail', 'Supplier create', `HTTP ${supplierCreate.status} ${supplierCreate.data?.error || ''}`.trim());
          } else {
            const supplierId = Number(supplierCreate.data.supplier.id);
            record('pass', 'Supplier create', `#${supplierId}`);

            const purchaseOrderBody = {
              supplier_id: supplierId,
              expected_date: expectedReturnDate,
              note: 'Auto-generated purchase order validation',
              items: [{
                product_id: saleCandidate.productId,
                quantity: 1,
                unit_cost: Math.max(0, Number((saleTotal / 2).toFixed(2))),
                batch_code: `SMK-${transactionSuffix}`,
                expiry_date: expectedReturnDate,
                ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
              }],
            };

            const purchaseOrderCreate = await request('/api/purchase-orders', {
              method: 'POST',
              body: purchaseOrderBody,
            }, token);

            if (!purchaseOrderCreate.ok || !purchaseOrderCreate.data?.order?.id) {
              record('fail', 'Purchase order create', `HTTP ${purchaseOrderCreate.status} ${purchaseOrderCreate.data?.error || ''}`.trim());
            } else {
              const purchaseOrderId = Number(purchaseOrderCreate.data.order.id);
              record('pass', 'Purchase order create', `#${purchaseOrderId}`);

              const purchaseOrderReceive = await request(`/api/purchase-orders/${purchaseOrderId}/receive`, {
                method: 'POST',
              }, token);

              if (!purchaseOrderReceive.ok) {
                record('fail', 'Purchase order receive', `HTTP ${purchaseOrderReceive.status} ${purchaseOrderReceive.data?.error || ''}`.trim());
              } else {
                record('pass', 'Purchase order receive', `#${purchaseOrderId} received`);
              }
            }

            const purchaseOrderCancelCreate = await request('/api/purchase-orders', {
              method: 'POST',
              body: {
                ...purchaseOrderBody,
                note: 'Auto-generated purchase order cancel validation',
              },
            }, token);

            if (!purchaseOrderCancelCreate.ok || !purchaseOrderCancelCreate.data?.order?.id) {
              record('fail', 'Purchase order create for cancel', `HTTP ${purchaseOrderCancelCreate.status} ${purchaseOrderCancelCreate.data?.error || ''}`.trim());
            } else {
              const cancelOrderId = Number(purchaseOrderCancelCreate.data.order.id);
              const purchaseOrderCancel = await request(`/api/purchase-orders/${cancelOrderId}/cancel`, {
                method: 'POST',
              }, token);

              if (!purchaseOrderCancel.ok) {
                record('fail', 'Purchase order cancel', `HTTP ${purchaseOrderCancel.status} ${purchaseOrderCancel.data?.error || ''}`.trim());
              } else {
                record('pass', 'Purchase order cancel', `#${cancelOrderId} cancelled`);
              }
            }
          }

          const proFormaCreate = await request('/api/pro-formas', {
            method: 'POST',
            body: {
              customer_id: smokeCustomer?.id || null,
              customer_name: smokeCustomer?.name || `Smoke Customer ${transactionSuffix}`,
              customer_phone: smokeCustomer?.phone || `070${transactionSuffix.padStart(6, '0')}`,
              customer_address: smokeCustomer?.address || 'Smoke sync validation',
              items: [{
                product_id: saleCandidate.productId,
                quantity: 1,
                name: saleCandidate.name,
                price_at_sale: saleTotal,
                subtotal: saleTotal,
                ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
              }],
              subtotal: saleTotal,
              tax_amount: 0,
              tax_percentage: 0,
              total: saleTotal,
              expiry_hours: 24,
            },
          }, token);

          if (!proFormaCreate.ok || !proFormaCreate.data?.id) {
            record('fail', 'Pro-forma create', `HTTP ${proFormaCreate.status} ${proFormaCreate.data?.error || ''}`.trim());
          } else {
            record('pass', 'Pro-forma create', `#${proFormaCreate.data.id}`);

            const proFormaStatus = await request(`/api/pro-formas/${proFormaCreate.data.id}/status`, {
              method: 'PUT',
              body: { status: 'APPROVED' },
            }, token);

            if (!proFormaStatus.ok) {
              record('fail', 'Pro-forma status update', `HTTP ${proFormaStatus.status} ${proFormaStatus.data?.error || ''}`.trim());
            } else {
              record('pass', 'Pro-forma status update', `#${proFormaCreate.data.id} approved`);
            }

            const proFormaDelete = await request(`/api/pro-formas/${proFormaCreate.data.id}`, {
              method: 'DELETE',
            }, token);

            if (!proFormaDelete.ok) {
              record('fail', 'Pro-forma delete', `HTTP ${proFormaDelete.status} ${proFormaDelete.data?.error || ''}`.trim());
            } else {
              record('pass', 'Pro-forma delete', `#${proFormaCreate.data.id} removed`);
            }
          }

          const handoverCreate = await request('/api/handover-notes', {
            method: 'POST',
            body: {
              note: `Smoke handover validation ${transactionSuffix}`,
              priority: 'IMPORTANT',
              is_pinned: false,
            },
          }, token);

          if (!handoverCreate.ok || !handoverCreate.data?.note?.id) {
            record('fail', 'Handover note create', `HTTP ${handoverCreate.status} ${handoverCreate.data?.error || ''}`.trim());
          } else {
            const handoverNoteId = Number(handoverCreate.data.note.id);
            record('pass', 'Handover note create', `#${handoverNoteId}`);

            const handoverPin = await request(`/api/handover-notes/${handoverNoteId}/pin`, {
              method: 'PUT',
              body: { is_pinned: true },
            }, token);

            if (!handoverPin.ok) {
              record('fail', 'Handover note pin', `HTTP ${handoverPin.status} ${handoverPin.data?.error || ''}`.trim());
            } else {
              record('pass', 'Handover note pin', `#${handoverNoteId} pinned`);
            }

            const handoverDelete = await request(`/api/handover-notes/${handoverNoteId}`, {
              method: 'DELETE',
            }, token);

            if (!handoverDelete.ok) {
              record('fail', 'Handover note delete', `HTTP ${handoverDelete.status} ${handoverDelete.data?.error || ''}`.trim());
            } else {
              record('pass', 'Handover note delete', `#${handoverNoteId} removed`);
            }
          }

          let attendanceClockIn = await request('/api/attendance/clock-in', {
            method: 'POST',
            body: { note: 'Auto-generated attendance validation' },
          }, token);

          if (!attendanceClockIn.ok && String(attendanceClockIn.data?.error || '').toLowerCase().includes('active shift')) {
            await request('/api/attendance/clock-out', {
              method: 'POST',
              body: { note: 'Auto-closed previous smoke shift' },
            }, token);

            attendanceClockIn = await request('/api/attendance/clock-in', {
              method: 'POST',
              body: { note: 'Auto-generated attendance validation' },
            }, token);
          }

          if (!attendanceClockIn.ok || !attendanceClockIn.data?.entry?.id) {
            record('fail', 'Attendance clock in', `HTTP ${attendanceClockIn.status} ${attendanceClockIn.data?.error || ''}`.trim());
          } else {
            const attendanceId = Number(attendanceClockIn.data.entry.id);
            record('pass', 'Attendance clock in', `#${attendanceId}`);

            const attendanceClockOut = await request('/api/attendance/clock-out', {
              method: 'POST',
              body: { note: 'Auto-generated attendance close validation' },
            }, token);

            if (!attendanceClockOut.ok) {
              record('fail', 'Attendance clock out', `HTTP ${attendanceClockOut.status} ${attendanceClockOut.data?.error || ''}`.trim());
            } else {
              record('pass', 'Attendance clock out', `#${attendanceId} closed`);
            }
          }

          const repairCreate = await request('/api/repairs', {
            method: 'POST',
            body: {
              customer_name: smokeCustomer?.name || `Smoke Repair Customer ${transactionSuffix}`,
              customer_phone: smokeCustomer?.phone || `070${transactionSuffix.padStart(6, '0')}`,
              device_name: `Smoke Device ${transactionSuffix}`,
              brand: 'Goody',
              model: 'POS',
              issue_summary: 'Auto-generated repair validation',
              accessories: 'Charging cable',
              technician_name: 'Smoke Tech',
              intake_notes: 'Auto-generated repair creation check',
              internal_notes: 'Auto-generated repair update check',
              promised_date: expectedReturnDate,
              estimated_cost: saleTotal,
              warranty_status: 'NO_WARRANTY',
            },
          }, token);

          if (!repairCreate.ok || !repairCreate.data?.ticket?.id) {
            record('fail', 'Repair ticket create', `HTTP ${repairCreate.status} ${repairCreate.data?.error || ''}`.trim());
          } else {
            record('pass', 'Repair ticket create', `#${repairCreate.data.ticket.id}`);

            const repairUpdate = await request(`/api/repairs/${repairCreate.data.ticket.id}`, {
              method: 'PATCH',
              body: {
                status: 'READY',
                technician_name: 'Smoke Tech',
                final_cost: saleTotal,
                amount_paid: Math.max(0, Number((saleTotal / 2).toFixed(2))),
                internal_notes: 'Auto-generated repair ready check',
              },
            }, token);

            if (!repairUpdate.ok) {
              record('fail', 'Repair ticket update', `HTTP ${repairUpdate.status} ${repairUpdate.data?.error || ''}`.trim());
            } else {
              record('pass', 'Repair ticket update', `#${repairCreate.data.ticket.id} ready`);
            }
          }

          const layawayCreate = await request('/api/layaways', {
            method: 'POST',
            body: {
              sale_channel: 'LAYAWAY',
              due_date: expectedReturnDate,
              note: 'Auto-generated layaway validation',
              customer_id: smokeCustomer?.id || undefined,
              customer_name: smokeCustomer?.name || `Smoke Layaway ${transactionSuffix}`,
              customer_phone: smokeCustomer?.phone || `070${transactionSuffix.padStart(6, '0')}`,
              customer_address: smokeCustomer?.address || 'Smoke sync validation',
              payment_methods: { cash: 0, transfer: 0, pos: 0 },
              items: [{
                product_id: saleCandidate.productId,
                quantity: 1,
                ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
              }],
            },
          }, token);

          if (!layawayCreate.ok || !layawayCreate.data?.sale?.id) {
            record('fail', 'Layaway create', `HTTP ${layawayCreate.status} ${layawayCreate.data?.error || ''}`.trim());
          } else {
            record('pass', 'Layaway create', `#${layawayCreate.data.sale.id}`);

            const layawaySettle = await request(`/api/sales/${layawayCreate.data.sale.id}/settle`, {
              method: 'POST',
              body: {
                payment_methods: { cash: saleTotal, transfer: 0, pos: 0 },
                note: 'Auto-generated layaway settlement validation',
              },
            }, token);

            if (!layawaySettle.ok) {
              record('fail', 'Layaway settle', `HTTP ${layawaySettle.status} ${layawaySettle.data?.error || ''}`.trim());
            } else {
              record('pass', 'Layaway settle', `#${layawayCreate.data.sale.id} completed`);
            }
          }

          const returnSale = await request('/api/sales', {
            method: 'POST',
            body: saleBody,
          }, token);

          if (!returnSale.ok || !returnSale.data?.id) {
            record('fail', 'Sale create', `HTTP ${returnSale.status} ${returnSale.data?.error || ''}`.trim());
          } else {
            record('pass', 'Sale create', `#${returnSale.data.id} ${saleCandidate.name}`);

            const saleDetails = await request(`/api/sales/${returnSale.data.id}/details`, {}, token);
            const firstSaleItem = Array.isArray(saleDetails.data?.items) ? saleDetails.data.items[0] : null;

            if (!saleDetails.ok || !firstSaleItem?.id) {
              record('fail', 'Sale details', `HTTP ${saleDetails.status} ${saleDetails.data?.error || 'Missing sale item data'}`.trim());
            } else {
              record('pass', 'Sale details', `${saleDetails.data?.items?.length || 0} item(s)`);

              const returnResponse = await request(`/api/sales/${returnSale.data.id}/returns`, {
                method: 'POST',
                body: {
                  reason: 'Smoke return validation',
                  note: 'Auto-generated by smoke check',
                  return_type: 'RETURN_ONLY',
                  refund_method: 'cash',
                  refund_amount: 0,
                  restock_items: true,
                  items: [{ sale_item_id: Number(firstSaleItem.id), quantity: 1 }],
                },
              }, token);

              if (!returnResponse.ok) {
                record('fail', 'Sale return', `HTTP ${returnResponse.status} ${returnResponse.data?.error || ''}`.trim());
              } else {
                record('pass', 'Sale return', `#${returnResponse.data?.return?.id || 'ok'} processed`);
              }
            }
          }

          if (!procurementUsername || !procurementPassword) {
            record('warn', 'Stock recount checks skipped', 'No procurement smoke account is configured for approval coverage.');
          } else {
            const procurementLogin = await request('/api/auth/login', {
              method: 'POST',
              body: { username: procurementUsername, password: procurementPassword },
            });

            if (!procurementLogin.ok || !procurementLogin.data?.token) {
              record('fail', 'Procurement login', `HTTP ${procurementLogin.status} ${procurementLogin.data?.error || 'Unable to authenticate procurement smoke account'}`.trim());
            } else {
              const procurementToken = procurementLogin.data.token;
              const procurementUser = procurementLogin.data.user || null;

              if (procurementUser?.id && user?.id) {
                const chatSend = await request('/api/internal-messages', {
                  method: 'POST',
                  body: {
                    recipient_id: Number(user.id),
                    message: `Smoke chat validation ${transactionSuffix}`,
                  },
                }, procurementToken);

                if (!chatSend.ok || !chatSend.data?.message?.id) {
                  record('fail', 'Internal message send', `HTTP ${chatSend.status} ${chatSend.data?.error || ''}`.trim());
                } else {
                  record('pass', 'Internal message send', `#${chatSend.data.message.id}`);

                  const chatFetch = await request(`/api/internal-messages?with_user_id=${encodeURIComponent(String(procurementUser.id))}`, {}, token);
                  if (!chatFetch.ok || !Array.isArray(chatFetch.data?.messages)) {
                    record('fail', 'Internal message thread', `HTTP ${chatFetch.status} ${chatFetch.data?.error || ''}`.trim());
                  } else {
                    record('pass', 'Internal message thread', `${chatFetch.data.messages.length} message(s)`);
                  }
                }
              }

              const nextCountQuantity = Math.max(1, Number(saleCandidate.currentStock || 0) + 1);
              const rejectRecount = await request('/api/stock-adjustments', {
                method: 'POST',
                body: {
                  product_id: saleCandidate.productId,
                  quantity: nextCountQuantity + 1,
                  adjustment_mode: 'SET',
                  adjustment_type: 'COUNT',
                  note: 'Smoke recount reject validation',
                  ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
                },
              }, procurementToken);

              if (!rejectRecount.ok || !rejectRecount.data?.adjustment?.id) {
                record('fail', 'Stock recount submit', `HTTP ${rejectRecount.status} ${rejectRecount.data?.error || ''}`.trim());
              } else {
                record('pass', 'Stock recount submit', `#${rejectRecount.data.adjustment.id}`);
                const rejectResponse = await request(`/api/stock-adjustments/${rejectRecount.data.adjustment.id}/reject`, {
                  method: 'POST',
                  body: { approval_note: 'Smoke reject validation' },
                }, token);

                if (!rejectResponse.ok) {
                  record('fail', 'Stock recount reject', `HTTP ${rejectResponse.status} ${rejectResponse.data?.error || ''}`.trim());
                } else {
                  record('pass', 'Stock recount reject', `#${rejectRecount.data.adjustment.id} rejected`);
                }
              }

              const approveRecount = await request('/api/stock-adjustments', {
                method: 'POST',
                body: {
                  product_id: saleCandidate.productId,
                  quantity: nextCountQuantity,
                  adjustment_mode: 'SET',
                  adjustment_type: 'COUNT',
                  note: 'Smoke recount approval validation',
                  ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
                },
              }, procurementToken);

              if (!approveRecount.ok || !approveRecount.data?.adjustment?.id) {
                record('fail', 'Stock recount submit for approval', `HTTP ${approveRecount.status} ${approveRecount.data?.error || ''}`.trim());
              } else {
                const approveResponse = await request(`/api/stock-adjustments/${approveRecount.data.adjustment.id}/approve`, {
                  method: 'POST',
                  body: { approval_note: 'Smoke approval validation' },
                }, token);

                if (!approveResponse.ok) {
                  record('fail', 'Stock recount approve', `HTTP ${approveResponse.status} ${approveResponse.data?.error || ''}`.trim());
                } else {
                  record('pass', 'Stock recount approve', `#${approveRecount.data.adjustment.id} approved`);
                }
              }
            }
          }

          const voidSale = await request('/api/sales', {
            method: 'POST',
            body: saleBody,
          }, token);

          if (!voidSale.ok || !voidSale.data?.id) {
            record('fail', 'Sale create for void', `HTTP ${voidSale.status} ${voidSale.data?.error || ''}`.trim());
          } else {
            const flagResponse = await request(`/api/sales/${voidSale.data.id}/flag`, {
              method: 'POST',
              body: {
                issue_type: 'CHECK_REQUIRED',
                note: 'Smoke audit flag validation',
              },
            }, token);

            if (!flagResponse.ok) {
              record('fail', 'Sale flag', `HTTP ${flagResponse.status} ${flagResponse.data?.error || ''}`.trim());
            } else {
              record('pass', 'Sale flag', `#${flagResponse.data?.id || 'ok'}`);
            }

            const voidResponse = await request(`/api/sales/${voidSale.data.id}/void`, {
              method: 'POST',
              body: { reason: 'Smoke void validation' },
            }, token);

            if (!voidResponse.ok) {
              record('fail', 'Sale void', `HTTP ${voidResponse.status} ${voidResponse.data?.error || ''}`.trim());
            } else {
              record('pass', 'Sale void', `#${voidSale.data.id} voided`);
            }
          }

          const collectionItem = {
            product_id: saleCandidate.productId,
            quantity: 1,
            ...(saleCandidate.condition ? { condition: saleCandidate.condition } : {}),
          };

          const returnCollectionCreate = await request('/api/market-collections', {
            method: 'POST',
            body: {
              collector_name: `Smoke Collector ${transactionSuffix}`,
              phone: `080${transactionSuffix.padStart(6, '0')}`,
              expected_return_date: expectedReturnDate,
              note: 'Auto-generated market collection return check',
              items: [collectionItem],
            },
          }, token);

          if (!returnCollectionCreate.ok || !returnCollectionCreate.data?.collection?.id) {
            record('fail', 'Market collection create', `HTTP ${returnCollectionCreate.status} ${returnCollectionCreate.data?.error || ''}`.trim());
          } else {
            record('pass', 'Market collection create', `#${returnCollectionCreate.data.collection.id}`);
            const returnCollectionResponse = await request(`/api/market-collections/${returnCollectionCreate.data.collection.id}/return`, {
              method: 'POST',
            }, token);

            if (!returnCollectionResponse.ok) {
              record('fail', 'Market collection return', `HTTP ${returnCollectionResponse.status} ${returnCollectionResponse.data?.error || ''}`.trim());
            } else {
              record('pass', 'Market collection return', `#${returnCollectionCreate.data.collection.id} returned`);
            }
          }

          const soldCollectionCreate = await request('/api/market-collections', {
            method: 'POST',
            body: {
              collector_name: `Smoke Buyer ${transactionSuffix}`,
              phone: `081${transactionSuffix.padStart(6, '0')}`,
              expected_return_date: expectedReturnDate,
              note: 'Auto-generated market collection sold check',
              items: [collectionItem],
            },
          }, token);

          if (!soldCollectionCreate.ok || !soldCollectionCreate.data?.collection?.id) {
            record('fail', 'Market collection create for sold', `HTTP ${soldCollectionCreate.status} ${soldCollectionCreate.data?.error || ''}`.trim());
          } else {
            const markSoldResponse = await request(`/api/market-collections/${soldCollectionCreate.data.collection.id}/mark-sold`, {
              method: 'POST',
            }, token);

            if (!markSoldResponse.ok) {
              record('fail', 'Market collection mark sold', `HTTP ${markSoldResponse.status} ${markSoldResponse.data?.error || ''}`.trim());
            } else {
              record('pass', 'Market collection mark sold', `sale #${markSoldResponse.data?.saleId || 'ok'}`);
            }
          }
        }
      } catch (error) {
        record('fail', 'Transactional sales checks', error instanceof Error ? error.message : String(error));
      }
    }
  } catch (error) {
    record('fail', 'Smoke audit runtime', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const passCount = results.filter((entry) => entry.status === 'pass').length;
const warnCount = results.filter((entry) => entry.status === 'warn').length;
const failCount = results.filter((entry) => entry.status === 'fail').length;

console.log(`\nSummary: ${passCount} passed, ${warnCount} warning(s), ${failCount} failed.\n`);

process.exit(failCount > 0 ? 1 : 0);

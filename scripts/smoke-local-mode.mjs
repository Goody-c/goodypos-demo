#!/usr/bin/env node
/**
 * Smoke test for local SQLite mode.
 * Starts the server and exercises critical API paths through HTTP.
 * No direct database access — everything goes through the adapter.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const tmpDir = path.join(projectRoot, 'tmp-release-test-data');
const dbPath = path.join(tmpDir, 'pos.db');

// Clean slate
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
fs.mkdirSync(tmpDir, { recursive: true });

const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = 'SmokeTest123!';

let server;
let passed = 0;
let failed = 0;
const failures = [];

const assert = (condition, label) => {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ❌ ${label}`);
  }
};

const api = async (method, path, body, token) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let json;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, ok: res.ok, json };
};

const waitForServer = async (maxMs = 30000) => {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const res = await fetch(`${BASE}/api/health`).catch(() => null);
      if (res?.ok) return true;
    } catch { /* keep trying */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

const cleanup = () => {
  if (server && !server.killed) {
    server.kill('SIGTERM');
  }
};
process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

console.log('\n🔧 Starting local-mode smoke test...\n');

// Start server in local mode
server = spawn('npx', ['tsx', 'server.ts'], {
  cwd: projectRoot,
  env: {
    ...process.env,
    PORT: String(PORT),
    GOODY_POS_DB_PROVIDER: 'local',
    GOODY_POS_POSTGRES_URL: '',
    DATABASE_URL: '',
    GOODY_POS_DATA_DIR: tmpDir,
    INITIAL_ADMIN_PASSWORD: ADMIN_PASSWORD,
    JWT_SECRET: 'smoke-test-secret',
    NODE_ENV: 'production',
    LICENSE_REQUIRED_FOR_NEW_STORES: '',
    GOODY_POS_LICENSE_REQUIRED_FOR_NEW_STORES: '',
    GOODY_POS_LICENSE_API_URL: '',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (d) => { serverOutput += d.toString(); });
server.stderr.on('data', (d) => { serverOutput += d.toString(); });

try {
  console.log('⏳ Waiting for server to start...');
  const serverUp = await waitForServer();
  assert(serverUp, 'Server starts in local mode');
  if (!serverUp) {
    console.log('\n  Server output:\n', serverOutput);
    throw new Error('Server did not start');
  }

  // ----- Auth -----
  console.log('\n📋 Authentication:');
  const loginRes = await api('POST', '/api/auth/login', {
    username: 'Goody',
    password: ADMIN_PASSWORD,
  });
  assert(loginRes.ok, 'System admin can log in');
  const token = loginRes.json?.token;
  assert(Boolean(token), 'Login returns JWT token');

  const badLogin = await api('POST', '/api/auth/login', {
    username: 'Goody',
    password: 'wrong_password',
  });
  assert(!badLogin.ok, 'Bad password is rejected');

  // ----- Store Creation -----
  console.log('\n📋 Store Management:');
  const storeRes = await api('POST', '/api/admin/stores', {
    name: 'Smoke Test Store',
    mode: 'SUPERMARKET',
  }, token);
  assert(storeRes.ok, `Create store (status ${storeRes.status})`);
  const storeId = storeRes.json?.id;
  assert(typeof storeId === 'number' && storeId > 0, `Store has valid ID: ${storeId}`);

  // ----- User Creation -----
  console.log('\n📋 User Management:');
  const ownerRes = await api('POST', '/api/admin/users', {
    username: 'smoke_owner',
    password: 'Owner123!',
    role: 'STORE_ADMIN',
    store_id: storeId,
  }, token);
  assert(ownerRes.ok, `Create store owner (status ${ownerRes.status})`);

  const staffRes = await api('POST', '/api/admin/users', {
    username: 'smoke_staff',
    password: 'Staff123!',
    role: 'STAFF',
    store_id: storeId,
  }, token);
  assert(staffRes.ok, `Create staff user (status ${staffRes.status})`);

  // Login as owner
  const ownerLogin = await api('POST', '/api/auth/login', {
    username: 'smoke_owner',
    password: 'Owner123!',
  });
  assert(ownerLogin.ok, 'Store owner can log in');
  const ownerToken = ownerLogin.json?.token;

  // ----- Products -----
  console.log('\n📋 Products:');
  const prodRes = await api('POST', '/api/products', {
    name: 'Smoke Test Widget',
    price: 99.99,
    stock: 50,
    cost: 45.00,
    category: 'Test Category',
  }, ownerToken);
  assert(prodRes.ok, `Create product (status ${prodRes.status})`);
  const productId = prodRes.json?.id;

  const prodList = await api('GET', '/api/products', null, ownerToken);
  assert(prodList.ok && Array.isArray(prodList.json), 'List products returns array');
  assert(prodList.json?.length >= 1, `Product list has items: ${prodList.json?.length}`);

  // ----- Customers -----
  console.log('\n📋 Customers:');
  const custRes = await api('POST', '/api/customers', {
    name: 'Smoke Test Customer',
    phone: '+2348012345678',
    address: '123 Test Street',
  }, ownerToken);
  assert(custRes.ok, `Create customer (status ${custRes.status})`);
  const customerId = custRes.json?.id;

  const custList = await api('GET', '/api/customers', null, ownerToken);
  assert(custList.ok, 'List customers');

  // ----- Sales -----
  console.log('\n📋 Sales:');
  if (productId) {
    // Check if product has condition_matrix (GADGET stores require condition)
    const prodDetail = prodList.json?.find(p => p.id === productId);
    let cm = prodDetail?.condition_matrix;
    if (typeof cm === 'string') try { cm = JSON.parse(cm); } catch { cm = null; }
    const hasCondition = cm && typeof cm === 'object' && Object.keys(cm).length > 0;
    const firstCondition = hasCondition ? Object.keys(cm)[0] : null;

    const saleItem = { product_id: productId, quantity: 2, price_at_sale: 99.99 };
    if (firstCondition) saleItem.condition = firstCondition;

    const saleRes = await api('POST', '/api/sales', {
      items: [saleItem],
      subtotal: 199.98,
      total: 199.98,
      payment_methods: { cash: 199.98, transfer: 0, pos: 0 },
      customer_id: customerId || undefined,
      customer_name: 'Smoke Test Customer',
      status: 'COMPLETED',
    }, ownerToken);
    assert(saleRes.ok, `Create sale (status ${saleRes.status}${saleRes.ok ? '' : ' - ' + (saleRes.json?.error || '')})`);

    const salesList = await api('GET', '/api/sales', null, ownerToken);
    assert(salesList.ok, 'List sales');
  } else {
    console.log('  ⚠️  Skipped sales test (no product ID)');
  }

  // ----- Reporting / Analytics -----
  console.log('\n📋 Reporting:');
  const dashFeed = await api('GET', '/api/dashboard/activity-feed?limit=5', null, ownerToken);
  assert(dashFeed.ok, `Dashboard activity feed (status ${dashFeed.status})`);

  const zReport = await api('GET', '/api/reports/z-report', null, ownerToken);
  assert(zReport.ok, `Z-report (status ${zReport.status})`);

  const analytics = await api('GET', '/api/analytics', null, ownerToken);
  assert(analytics.ok, `Analytics (status ${analytics.status})`);

  // ----- Duplicate customer phone check (REGEXP_REPLACE path) -----
  console.log('\n📋 Phone Duplicate Detection (REGEXP_REPLACE):');
  const dupCust = await api('POST', '/api/customers', {
    name: 'Duplicate Phone Customer',
    phone: '+234-801-234-5678',
    address: '',
  }, ownerToken);
  assert(!dupCust.ok || dupCust.json?.error, 'Duplicate phone number is detected/rejected');

  // ----- Financial Ledger (uses JSONB extraction) -----
  console.log('\n📋 Financial Ledger (JSON extraction):');
  const ledger = await api('GET', '/api/reports/financial-ledger', null, ownerToken);
  assert(ledger.ok, `Financial ledger (status ${ledger.status})`);

  // ----- Data Retention Preview (uses ::timestamptz casts) -----
  console.log('\n📋 Data Retention Preview:');
  const retentionPreview = await api('POST', '/api/admin/store/retention/preview', {
    mode: 'custom',
    fromDate: '2020-01-01',
    toDate: '2025-01-01',
  }, ownerToken);
  assert(retentionPreview.ok, `Retention preview (status ${retentionPreview.status})`);

  // ----- Summary -----
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`\n✅ Passed: ${passed}  ❌ Failed: ${failed}\n`);

  if (failures.length > 0) {
    console.log('Failed tests:');
    failures.forEach(f => console.log(`  - ${f}`));
    console.log('');

    // Show relevant server errors
    const lines = serverOutput.split('\n');
    const errorLines = lines.filter(l => /error|fail|exception/i.test(l) && !/login attempt/i.test(l));
    if (errorLines.length > 0) {
      console.log('Server errors:');
      errorLines.slice(-15).forEach(l => console.log(`  ${l}`));
    }
  }

  process.exitCode = failed > 0 ? 1 : 0;
} catch (err) {
  console.error('\n💥 Smoke test crashed:', err.message);
  console.log('\n  Server output (last 20 lines):');
  serverOutput.split('\n').slice(-20).forEach(l => console.log(`  ${l}`));
  process.exitCode = 1;
} finally {
  cleanup();
  // Give server time to shut down
  await new Promise(r => setTimeout(r, 1000));
}

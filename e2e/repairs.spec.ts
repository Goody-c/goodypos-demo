import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const connectionString = String(process.env.GOODY_POS_POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://goody@localhost:5432/goodypos').trim();

type RepairSeedContext = {
  storeId: number;
  ownerId: number;
  ownerUsername: string;
  ownerPassword: string;
};

const seedRepairOwner = async (client: Client, stamp: number): Promise<RepairSeedContext> => {
  const ownerPassword = 'Repair123!';
  const ownerUsername = `repair_owner_${stamp}`;

  const storeResult = await client.query(
    'INSERT INTO stores (name, mode) VALUES ($1, $2) RETURNING id',
    [`Repair Store ${stamp}`, 'GADGET'],
  );
  const storeId = Number(storeResult.rows[0]?.id || 0);

  const ownerResult = await client.query(
    'INSERT INTO users (username, password, role, store_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [ownerUsername, bcrypt.hashSync(ownerPassword, 10), 'STORE_ADMIN', storeId],
  );
  const ownerId = Number(ownerResult.rows[0]?.id || 0);

  return { storeId, ownerId, ownerUsername, ownerPassword };
};

const loginAsRepairOwner = async (request: APIRequestContext, page: Page, context: RepairSeedContext) => {
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

  return loginBody;
};

const createRepairTicket = async (request: APIRequestContext, page: Page, authToken: string, stamp: number) => {
  const customerName = `Repair Customer ${stamp}`;
  const deviceName = `Phone ${stamp}`;
  const imei = `IMEI-${stamp}`;
  const technician = `Tech ${stamp}`;

  const createResponse = await request.post('/api/repairs', {
    headers: { Authorization: `Bearer ${authToken}` },
    data: {
      customer_name: customerName,
      customer_phone: '08099887766',
      device_name: deviceName,
      imei_serial: imei,
      brand: 'Samsung',
      model: 'Galaxy S',
      technician_name: technician,
      estimated_cost: 4500,
      issue_summary: 'Screen flickers after charging.',
      intake_notes: 'Customer dropped charger with the device.',
    },
  });
  const createBody = await createResponse.json().catch(() => ({}));
  expect(createResponse.ok(), JSON.stringify(createBody)).toBeTruthy();

  await page.goto('/repairs', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /warranty & repair tracker/i })).toBeVisible();

  await expect(page.getByRole('heading', { name: customerName })).toBeVisible();
  await expect(page.getByText(deviceName).first()).toBeVisible();

  return { customerName, deviceName, imei, technician };
};

const cleanupRepairSeed = async (client: Client, context: RepairSeedContext) => {
  try { await client.query('DELETE FROM repair_tickets WHERE store_id = $1', [context.storeId]); } catch {}
  try { await client.query('DELETE FROM users_role_upgrade WHERE id = $1', [context.ownerId]); } catch {}
  try { await client.query('DELETE FROM users_legacy_roles WHERE id = $1', [context.ownerId]); } catch {}
  try { await client.query('DELETE FROM users WHERE id = $1', [context.ownerId]); } catch {}
  try { await client.query('DELETE FROM stores WHERE id = $1', [context.storeId]); } catch {}
};

test('store owner can create a repair ticket and mark it ready', async ({ request, page }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now();
  const context = await seedRepairOwner(client, stamp);

  try {
    const loginBody = await loginAsRepairOwner(request, page, context);
    await createRepairTicket(request, page, String(loginBody.token || ''), stamp);

    await page.getByRole('button', { name: /mark ready/i }).click();
    await expect(page.getByRole('button', { name: /mark ready/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /mark delivered/i })).toBeVisible();
  } finally {
    await cleanupRepairSeed(client, context);
    await client.end();
  }
});

test('store owner can update a repair ticket and then mark it delivered', async ({ request, page }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 1;
  const context = await seedRepairOwner(client, stamp);

  try {
    const loginBody = await loginAsRepairOwner(request, page, context);
    const details = await createRepairTicket(request, page, String(loginBody.token || ''), stamp);

    await page.getByPlaceholder('Technician name').last().fill('Senior Bench Tech');
    await page.getByPlaceholder('Final repair cost').fill('6000');
    await page.getByPlaceholder('Amount paid').fill('2500');
    await page.getByPlaceholder('Internal update notes').fill('Screen replaced and charging port cleaned.');
    await page.getByRole('combobox').last().selectOption('IN_REPAIR');
    await page.getByRole('button', { name: /save update/i }).click();

    await expect(page.getByText('Senior Bench Tech').first()).toBeVisible();

    await page.getByRole('button', { name: /mark delivered/i }).click();

    await page.getByPlaceholder(/search ticket, customer, device, imei/i).fill(details.imei);
    await expect(page.getByRole('heading', { name: details.customerName })).toBeVisible();
    await expect(page.getByRole('button', { name: /mark delivered/i })).toHaveCount(0);
  } finally {
    await cleanupRepairSeed(client, context);
    await client.end();
  }
});

test('store owner can open and close the repair WhatsApp update modal', async ({ request, page }) => {
  const client = new Client({ connectionString });
  await client.connect();

  const stamp = Date.now() + 2;
  const context = await seedRepairOwner(client, stamp);

  try {
    const loginBody = await loginAsRepairOwner(request, page, context);
    const details = await createRepairTicket(request, page, String(loginBody.token || ''), stamp);

    await page.getByRole('button', { name: /whatsapp update/i }).click();
    await expect(page.getByText(/send repair update/i)).toBeVisible();
    await expect(page.getByText(new RegExp(`Send this repair update to ${details.customerName}`, 'i'))).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByText(/send repair update/i)).toHaveCount(0);
  } finally {
    await cleanupRepairSeed(client, context);
    await client.end();
  }
});

import { expect, test } from '@playwright/test';

test('vendor portal shows collected metrics and supports collected filter', async ({ page }) => {
  await page.route('**/api/vendor-portal/1/profile?vid=12345', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        store: {
          id: 1,
          name: 'Demo Store',
          currency_code: 'USD',
        },
        vendor: {
          id: '12345',
          name: 'Vendor Demo',
          phone: '08000000000',
          address: 'Lagos',
        },
        summary: {
          total_records: 2,
          active_units: 5,
          collected_records: 1,
          collected_units: 2,
          sold_units: 2,
          sold_amount: 2400,
          returned_units: 0,
          customer_return_events: 0,
          customer_returned_units: 0,
          pending_payout: 450,
          settled_payout: 800,
          sourced_payout: 0,
          consignment_payout: 1250,
          total_payout_generated: 1250,
        },
        items: [
          {
            id: 1,
            quick_code: 'QC101',
            item_name: 'Samsung A54',
            imei_serial: '123',
            status: 'approved',
            quantity: 3,
            sold_quantity: 2,
            sold_amount: 2400,
            returned_quantity: 0,
            agreed_payout: 600,
            selling_price: 1200,
            updated_at: '2026-04-13T12:00:00.000Z',
          },
          {
            id: 2,
            quick_code: 'QC102',
            item_name: 'iPhone XR',
            imei_serial: '124',
            status: 'approved',
            quantity: 2,
            sold_quantity: 0,
            sold_amount: 0,
            returned_quantity: 0,
            agreed_payout: 500,
            selling_price: 900,
            updated_at: '2026-04-13T12:00:00.000Z',
          },
        ],
        customer_returns: [],
        activities: [],
      }),
    });
  });

  await page.goto('/vendor-portal/1', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter Vendor ID').fill('12345');
  await page.getByRole('button', { name: 'View Profile' }).click();

  await expect(page.locator('p', { hasText: /^Collected Units$/ }).first()).toBeVisible();
  await expect(page.locator('p', { hasText: /^Collected Amount$/ }).first()).toBeVisible();
  await expect(page.locator('span', { hasText: /^Collected by vendor$/ }).first()).toBeVisible();

  await page.getByRole('button', { name: /Collected \(1\)/i }).click();
  await expect(page.getByText('Samsung A54')).toBeVisible();
  await expect(page.getByText('iPhone XR')).toHaveCount(0);
});

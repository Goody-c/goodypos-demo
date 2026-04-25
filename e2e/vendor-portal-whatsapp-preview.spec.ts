import { expect, test } from '@playwright/test';

test('vendor portal WhatsApp acknowledgement preview opens, cancels, and sends', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__lastOpenedUrl = '';
    const originalOpen = window.open.bind(window);
    window.open = ((url?: string | URL | undefined, target?: string | undefined, features?: string | undefined) => {
      (window as any).__lastOpenedUrl = String(url || '');
      return originalOpen(url, target, features);
    }) as typeof window.open;
  });

  await page.route('**/api/vendor-portal/1/profile?vid=12345', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        store: { id: 1, name: 'Demo Store', currency_code: 'USD' },
        vendor: { id: '12345', name: 'Vendor Demo', phone: '08000000000', address: 'Lagos' },
        summary: {
          total_records: 1,
          active_units: 2,
          collected_records: 1,
          collected_units: 1,
          sold_units: 1,
          sold_amount: 1200,
          returned_units: 0,
          customer_return_events: 0,
          customer_returned_units: 0,
          pending_payout: 200,
          settled_payout: 0,
          sourced_payout: 0,
          consignment_payout: 200,
          total_payout_generated: 200,
        },
        items: [
          {
            id: 1,
            quick_code: 'QC101',
            item_name: 'Samsung A54',
            imei_serial: '123',
            status: 'approved',
            quantity: 1,
            sold_quantity: 1,
            sold_amount: 1200,
            returned_quantity: 0,
            agreed_payout: 800,
            selling_price: 1200,
            updated_at: '2026-04-13T12:00:00.000Z',
          },
        ],
        customer_returns: [
          {
            return_id: 501,
            sale_id: 100,
            item_name: 'Samsung A54',
            quantity: 1,
            returned_value: 1200,
            refund_amount: 300,
            refund_method: 'cash',
            return_type: 'REFUND',
            reason: 'Customer changed mind',
            created_at: '2026-04-13T12:00:00.000Z',
          },
        ],
        activities: [
          {
            id: 99,
            item_name: 'Samsung A54',
            amount_due: 200,
            source_type: 'CONSIGNMENT',
            status: 'UNPAID',
            note: 'Awaiting vendor confirmation',
            sale_timestamp: '2026-04-13T12:00:00.000Z',
            created_at: '2026-04-13T12:00:00.000Z',
            settled_at: null,
          },
        ],
      }),
    });
  });

  await page.goto('/vendor-portal/1', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter Vendor ID').fill('12345');
  await page.getByRole('button', { name: 'View Profile' }).click();

  await page.getByRole('button', { name: /WhatsApp Ack/i }).first().click();
  await expect(page.getByText('WhatsApp Preview')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('WhatsApp Preview')).toHaveCount(0);

  await page.getByRole('button', { name: /WhatsApp Ack/i }).first().click();
  await page.getByRole('button', { name: /Send to WhatsApp/i }).click();
  await expect(page.getByText('WhatsApp Preview')).toHaveCount(0);

});

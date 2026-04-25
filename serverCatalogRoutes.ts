import type { Pool } from 'pg';

type CatalogRouteDependencies = {
  app: any;
  postgresPool: Pool;
  authenticate: any;
  authorize: (roles: string[]) => any;
  checkStoreLock: any;
  coreReadRepository: any;
  coreWriteRepository: any;
  findStoreById: (storeId: unknown) => Promise<any>;
  safeJsonParse: (value: any, fallback: any) => any;
  normalizeStoreDiscountCodes: (value: unknown) => any[];
  normalizeStaffAnnouncement: (value: any) => { text: string; active: boolean; updated_at: string | null };
  normalizeStoreSignatureImage: (value: unknown) => string | null;
  clampChatCleanupReminderDay: (value: unknown) => number;
  clampChatRetentionValue: (value: unknown) => number;
  normalizeChatRetentionUnit: (value: unknown) => 'days' | 'months';
  isChatCleanupReminderDue: (store: any, referenceDate?: Date) => boolean;
  getProductTotalStock: (product: any) => number;
  formatStockAdjustmentEntry: (entry: any) => any;
  normalizeRecountStatus: (value: unknown) => string;
  getAuditActorLabel: (role: unknown) => string;
  logAuditEvent: (payload: any) => Promise<void>;
  formatAuditCurrency: (value: unknown) => string;
  normalizeProductBarcode: (value: any) => string;
  generateUniqueBarcode: (storeId: number, maxAttempts?: number) => Promise<string | null>;
  generateUniqueQuickCode: (maxAttempts?: number, excludeProductId?: number | null, preferredCandidate?: string | null) => Promise<string | null>;
  reconcileInventoryBatchQuantity: (payload: { productId: number; storeId: number; condition?: string | null; targetStock: number }) => Promise<void>;
};

export const registerCatalogRoutes = ({
  app,
  postgresPool,
  authenticate,
  authorize,
  checkStoreLock,
  coreReadRepository,
  coreWriteRepository,
  findStoreById,
  safeJsonParse,
  normalizeStoreDiscountCodes,
  normalizeStaffAnnouncement,
  normalizeStoreSignatureImage,
  clampChatCleanupReminderDay,
  clampChatRetentionValue,
  normalizeChatRetentionUnit,
  isChatCleanupReminderDue,
  getProductTotalStock,
  formatStockAdjustmentEntry,
  normalizeRecountStatus,
  getAuditActorLabel,
  logAuditEvent,
  formatAuditCurrency,
  normalizeProductBarcode,
  generateUniqueBarcode,
  generateUniqueQuickCode,
  reconcileInventoryBatchQuantity,
}: CatalogRouteDependencies) => {
  app.get('/api/products/reservation-check', authenticate, async (req: any, res: any) => {
    const store_id = req.user.store_id;
    const { product_id, quantity } = req.query;
    const now = new Date().toISOString();

    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'Product ID and quantity required' });
    }

    try {
      const product = (await postgresPool.query('SELECT * FROM products WHERE id = $1 AND store_id = $2', [product_id, store_id])).rows[0] || null;
      if (!product) return res.status(404).json({ error: 'Product not found' });

      const store = await findStoreById(store_id);
      const productWithMode = { ...product, mode: product?.mode || store?.mode || null };

      const activeProformas = (await postgresPool.query(`
        SELECT * FROM pro_formas
        WHERE store_id = $1 AND expiry_date > $2 AND status = 'PENDING'
      `, [store_id, now])).rows;

      let totalReserved = 0;
      const reservations: any[] = [];

      for (const p of activeProformas) {
        const items = JSON.parse(p.items);
        const item = items.find((i: any) => i.id === Number(product_id));
        if (item) {
          totalReserved += item.quantity;
          reservations.push({
            customer_name: p.customer_name || 'Unknown Customer',
            expiry_date: p.expiry_date,
            reserved_quantity: item.quantity,
          });
        }
      }

      const totalStock = Math.max(0, Number(getProductTotalStock(productWithMode)) || 0);
      const requestedQuantity = Math.max(1, Number(quantity) || 0);
      const availableAfterReservations = totalStock - totalReserved;
      const hasActiveReservations = reservations.length > 0;
      const conflict = hasActiveReservations && requestedQuantity > availableAfterReservations;
      const outOfStock = requestedQuantity > Math.max(0, availableAfterReservations);

      res.json({
        conflict,
        outOfStock,
        hasActiveReservations,
        totalStock,
        totalReserved,
        availableAfterReservations,
        reservations,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/store/settings', authenticate, async (req: any, res: any) => {
    try {
      const store = await coreReadRepository.getStoreById(Number(req.user.store_id));
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }

      const customSpecs = safeJsonParse(store.custom_specs, []);

      res.json({
        ...store,
        custom_specs: Array.isArray(customSpecs) ? customSpecs : [],
        discount_codes: normalizeStoreDiscountCodes(store.discount_codes),
        staff_announcement_text: normalizeStaffAnnouncement(store).text,
        staff_announcement_active: normalizeStaffAnnouncement(store).active,
        staff_announcement_updated_at: normalizeStaffAnnouncement(store).updated_at,
        currency_code: /^[A-Z]{3}$/.test(String(store.currency_code || '').toUpperCase()) ? String(store.currency_code).toUpperCase() : 'USD',
        receipt_paper_size: store.receipt_paper_size || 'A4',
        document_color: /^#([0-9A-Fa-f]{6})$/.test(String(store.document_color || '')) ? String(store.document_color).toUpperCase() : '#F4BD4A',
        show_store_name_on_documents: store.show_store_name_on_documents === true || Number(store.show_store_name_on_documents) === 1,
        signature_image: normalizeStoreSignatureImage(store.signature_image),
        tax_enabled: Boolean(store.tax_enabled),
        tax_percentage: Math.max(0, Number(store.tax_percentage) || 0),
        receipt_header_note: String(store.receipt_header_note || ''),
        receipt_footer_note: String(store.receipt_footer_note || 'Thank you for your business!'),
        receipt_show_bank_details: store.receipt_show_bank_details !== false && store.receipt_show_bank_details !== 0,
        default_missing_cost_to_price: store.default_missing_cost_to_price === true || Number(store.default_missing_cost_to_price) === 1,
        pin_checkout_enabled: store.pin_checkout_enabled !== 0,
        vendor_portal_enabled: store.vendor_portal_enabled === 1 || store.vendor_portal_enabled === true,
        chat_cleanup_reminders_enabled: store.chat_cleanup_reminders_enabled !== 0,
        chat_cleanup_reminder_day: clampChatCleanupReminderDay(store.chat_cleanup_reminder_day),
        chat_retention_value: clampChatRetentionValue(store.chat_retention_value),
        chat_retention_unit: normalizeChatRetentionUnit(store.chat_retention_unit),
        last_chat_cleanup_at: store.last_chat_cleanup_at || null,
        chat_cleanup_reminder_due: isChatCleanupReminderDue(store),
      });
    } catch (err: any) {
      console.error('Store settings read error:', err);
      res.status(500).json({ error: err.message || 'Failed to load store settings' });
    }
  });

  app.put('/api/store/settings', authenticate, authorize(['STORE_ADMIN']), checkStoreLock, async (req: any, res: any) => {
    const currentStore = await findStoreById(req.user.store_id);
    if (!currentStore) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const payload = { ...currentStore, ...(req.body || {}) };
    const {
      name,
      logo,
      address,
      phone,
      custom_specs,
      bank_name,
      account_number,
      account_name,
      currency_code,
      receipt_paper_size,
      document_color,
      show_store_name_on_documents,
      signature_image,
      tax_enabled,
      tax_percentage,
      receipt_header_note,
      receipt_footer_note,
      receipt_show_bank_details,
      default_missing_cost_to_price,
      discount_codes,
      staff_announcement_text,
      staff_announcement_active,
      staff_announcement_updated_at,
      pin_checkout_enabled,
      vendor_portal_enabled,
      chat_cleanup_reminders_enabled,
      chat_cleanup_reminder_day,
      chat_retention_value,
      chat_retention_unit,
      last_chat_cleanup_at,
    } = payload;

    let resolvedCustomSpecs: string[] = [];
    if (Array.isArray(custom_specs)) {
      resolvedCustomSpecs = custom_specs.map((entry) => String(entry || '').trim()).filter(Boolean);
    } else {
      try {
        const parsed = JSON.parse(String(custom_specs || '[]'));
        resolvedCustomSpecs = Array.isArray(parsed) ? parsed.map((entry) => String(entry || '').trim()).filter(Boolean) : [];
      } catch {
        resolvedCustomSpecs = [];
      }
    }

    const resolvedCurrencyCode = /^[A-Z]{3}$/.test(String(currency_code || '').trim().toUpperCase())
      ? String(currency_code).trim().toUpperCase()
      : 'USD';
    const resolvedPaperSize = ['THERMAL', 'THERMAL_58', 'A4'].includes(receipt_paper_size) ? receipt_paper_size : 'THERMAL';
    const resolvedDocumentColor = /^#([0-9A-Fa-f]{6})$/.test(String(document_color || '')) ? String(document_color).toUpperCase() : '#F4BD4A';
    const resolvedShowStoreNameOnDocuments = show_store_name_on_documents === true ? 1 : 0;
    const hasSignatureImageInput = signature_image != null && String(signature_image).trim() !== '';
    const resolvedSignatureImage = normalizeStoreSignatureImage(signature_image);
    if (hasSignatureImageInput && !resolvedSignatureImage) {
      return res.status(400).json({ error: 'Invalid signature image. Please upload a PNG, JPG, or JPEG around 900 × 260 px.' });
    }
    const resolvedTaxEnabled = tax_enabled ? 1 : 0;
    const resolvedTaxPercentage = Math.min(100, Math.max(0, Number(tax_percentage) || 0));
    const resolvedReceiptHeaderNote = String(receipt_header_note || '').trim();
    const resolvedReceiptFooterNote = String(receipt_footer_note || '').trim() || 'Thank you for your business!';
    const resolvedShowBankDetails = receipt_show_bank_details === false ? 0 : 1;
    const resolvedDefaultMissingCost = default_missing_cost_to_price ? 1 : 0;
    const resolvedDiscountCodes = normalizeStoreDiscountCodes(discount_codes);
    const resolvedAnnouncementText = String(staff_announcement_text || '').trim().slice(0, 240);
    const resolvedAnnouncementActive = Boolean(resolvedAnnouncementText) && staff_announcement_active !== false ? 1 : 0;
    const resolvedAnnouncementUpdatedAt = resolvedAnnouncementText
      ? String(staff_announcement_updated_at || new Date().toISOString())
      : null;
    const resolvedPinCheckoutEnabled = pin_checkout_enabled === false ? 0 : 1;
    const resolvedVendorPortalEnabled = vendor_portal_enabled === true ? 1 : 0;
    const resolvedChatCleanupRemindersEnabled = chat_cleanup_reminders_enabled === false ? 0 : 1;
    const resolvedChatCleanupReminderDay = clampChatCleanupReminderDay(chat_cleanup_reminder_day);
    const resolvedChatRetentionValue = clampChatRetentionValue(chat_retention_value);
    const resolvedChatRetentionUnit = normalizeChatRetentionUnit(chat_retention_unit);
    const resolvedLastChatCleanupAt = last_chat_cleanup_at ? String(last_chat_cleanup_at) : null;

    try {
      await coreWriteRepository.updateStoreSettings({
        storeId: Number(req.user.store_id),
        name: String(name || currentStore.name || '').trim() || String(currentStore.name || 'Store'),
        logo: logo || null,
        signatureImage: resolvedSignatureImage,
        address: address || null,
        phone: phone || null,
        customSpecs: resolvedCustomSpecs,
        bankName: bank_name || null,
        accountNumber: account_number || null,
        accountName: account_name || null,
        currencyCode: resolvedCurrencyCode,
        receiptPaperSize: resolvedPaperSize,
        documentColor: resolvedDocumentColor,
        showStoreNameOnDocuments: resolvedShowStoreNameOnDocuments,
        taxEnabled: resolvedTaxEnabled,
        taxPercentage: resolvedTaxPercentage,
        receiptHeaderNote: resolvedReceiptHeaderNote,
        receiptFooterNote: resolvedReceiptFooterNote,
        receiptShowBankDetails: resolvedShowBankDetails,
        defaultMissingCostToPrice: resolvedDefaultMissingCost,
        discountCodes: resolvedDiscountCodes,
        staffAnnouncementText: resolvedAnnouncementText,
        staffAnnouncementActive: resolvedAnnouncementActive,
        staffAnnouncementUpdatedAt: resolvedAnnouncementUpdatedAt,
        pinCheckoutEnabled: resolvedPinCheckoutEnabled,
        vendorPortalEnabled: resolvedVendorPortalEnabled,
        chatCleanupRemindersEnabled: resolvedChatCleanupRemindersEnabled,
        chatCleanupReminderDay: resolvedChatCleanupReminderDay,
        chatRetentionValue: resolvedChatRetentionValue,
        chatRetentionUnit: resolvedChatRetentionUnit,
        lastChatCleanupAt: resolvedLastChatCleanupAt,
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error('Store settings update error:', err);
      res.status(500).json({ error: err.message || 'Failed to save store settings' });
    }
  });

  app.get('/api/vendor-portal/config', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const store = await coreReadRepository.getStoreById(storeId);
      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }

      const baseUrl = buildVendorPortalBaseUrl(req);
      const path = `/vendor-portal/${storeId}`;
      res.json({
        enabled: store.vendor_portal_enabled === 1 || store.vendor_portal_enabled === true,
        portal_url: baseUrl ? `${baseUrl}${path}` : path,
        store_id: storeId,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load vendor portal config' });
    }
  });

  app.put('/api/vendor-portal/config', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const enabled = req.body?.enabled === true ? 1 : 0;
      const storeId = Number(req.user.store_id);
      await postgresPool.query('UPDATE stores SET vendor_portal_enabled = $1 WHERE id = $2', [enabled, storeId]);

      const baseUrl = buildVendorPortalBaseUrl(req);
      const path = `/vendor-portal/${storeId}`;
      res.json({
        success: true,
        enabled: enabled === 1,
        portal_url: baseUrl ? `${baseUrl}${path}` : path,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update vendor portal config' });
    }
  });

  app.get('/api/vendor-portal/:storeId/profile', async (req: any, res: any) => {
    try {
      const storeId = Math.max(0, Number(req.params.storeId || 0) || 0);
      const vid = String(req.query?.vid || '').trim();

      if (!Number.isInteger(storeId) || storeId <= 0) {
        return res.status(400).json({ error: 'Invalid store id.' });
      }
      if (!/^\d{3,}$/.test(vid)) {
        return res.status(400).json({ error: 'Enter a valid vendor id.' });
      }

      const storeRow = (await postgresPool.query(
        'SELECT id, name, currency_code, vendor_portal_enabled FROM stores WHERE id = $1 LIMIT 1',
        [storeId],
      )).rows[0] as any;

      if (!storeRow) {
        return res.status(404).json({ error: 'Store not found.' });
      }
      if (!(storeRow.vendor_portal_enabled === 1 || storeRow.vendor_portal_enabled === true)) {
        return res.status(403).json({ error: 'Vendor portal is currently disabled by this store.' });
      }

      const consignmentRows = (await postgresPool.query(`
        SELECT id, quick_code, vendor_name, vendor_phone, vendor_address, item_name, imei_serial, quantity, status, agreed_payout, selling_price, public_specs, updated_at
        FROM consignment_items
        WHERE store_id = $1
      `, [storeId])).rows as any[];

      const toExpandedVendorSignature = (name: unknown, phone: unknown, address: unknown) => {
        const normalizedName = String(name || '').trim().toLowerCase();
        const normalizedPhone = String(phone || '').trim().toLowerCase();
        const normalizedAddress = String(address || '').trim().toLowerCase();
        return [normalizedName, normalizedPhone, normalizedAddress].filter(Boolean).join('|') || 'unknown-vendor';
      };

      const getVendorIdCandidates = (row: any) => {
        const legacySignature = getVendorSignature(row?.vendor_name, null, null);
        const expandedSignature = toExpandedVendorSignature(row?.vendor_name, row?.vendor_phone, row?.vendor_address);
        const candidates = new Set<string>();
        candidates.add(calculateVendorIdFromSignature(legacySignature));
        candidates.add(calculateVendorIdFromSignature(expandedSignature));
        return candidates;
      };

      const targetRow = consignmentRows.find((row) => {
        return getVendorIdCandidates(row).has(vid);
      });

      if (!targetRow) {
        return res.status(404).json({ error: 'Vendor profile not found for that id.' });
      }

      const normalizedTargetVendorName = normalizeVendorKey(targetRow.vendor_name);
      const vendorRows = consignmentRows.filter((row) => normalizeVendorKey(row.vendor_name) === normalizedTargetVendorName);

      let soldUnits = 0;
      let soldAmount = 0;
      let returnedUnits = 0;
      let activeUnits = 0;
      let collectedRecords = 0;
      let collectedUnits = 0;

      const items = vendorRows
        .sort((a, b) => Number(new Date(b.updated_at || 0).getTime()) - Number(new Date(a.updated_at || 0).getTime()))
        .map((row) => {
          const specs = parsePublicSpecs(row.public_specs);
          const itemSoldQty = Math.max(0, Math.trunc(Number(specs?.__sold_quantity_total || 0) || 0));
          const itemSoldAmount = Math.max(0, Number(specs?.__sold_amount_total || 0) || 0);
          const itemReturnedQty = Math.max(0, Math.trunc(Number(specs?.__returned_quantity_total || 0) || 0));
          const itemQuantity = Math.max(0, Math.trunc(Number(row.quantity || 0) || 0));
          const status = normalizeConsignmentStatus(row.status);
          if (status === 'approved' || status === 'pending') {
            activeUnits += itemQuantity;
          }
          if (status === 'returned') {
            collectedRecords += 1;
            collectedUnits += itemQuantity;
          }
          soldUnits += itemSoldQty;
          soldAmount += itemSoldAmount;
          returnedUnits += itemReturnedQty;

          return {
            id: Number(row.id || 0),
            quick_code: String(row.quick_code || '').trim(),
            item_name: String(row.item_name || 'Item'),
            imei_serial: String(row.imei_serial || ''),
            status,
            quantity: itemQuantity,
            sold_quantity: itemSoldQty,
            sold_amount: Number(itemSoldAmount.toFixed(2)),
            returned_quantity: itemReturnedQty,
            returned_reason: String(specs?.__last_returned_reason || '').trim(),
            return_history: Array.isArray(specs?.__return_history) ? specs.__return_history : [],
            agreed_payout: Math.max(0, Number(row.agreed_payout || 0) || 0),
            selling_price: Math.max(0, Number(row.selling_price || 0) || 0),
            updated_at: row.updated_at || null,
          };
        });

      const payableRows = (await postgresPool.query(`
        SELECT
          vp.id,
          vp.item_name,
          vp.amount_due,
          vp.status,
          vp.note,
          vp.created_at,
          vp.settled_at,
          COALESCE(
            vp.source_type,
            CASE
              WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'consignment_item')::boolean, false) THEN 'CONSIGNMENT'
              WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'sourced_item')::boolean, false) THEN 'SOURCED'
              ELSE 'SOURCED'
            END,
            'SOURCED'
          ) AS source_type,
          s.timestamp as sale_timestamp
        FROM vendor_payables vp
        LEFT JOIN sales s ON s.id = vp.sale_id
        LEFT JOIN sale_items si ON si.id = vp.sale_item_id
        WHERE vp.store_id = $1
          AND LOWER(COALESCE(vp.vendor_name, '')) = LOWER($2)
        ORDER BY vp.created_at DESC, vp.id DESC
        LIMIT 50
      `, [storeId, String(targetRow.vendor_name || '')])).rows as any[];

      const pendingPayout = payableRows
        .filter((row) => String(row.status || '').toUpperCase() !== 'SETTLED')
        .reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);
      const settledPayout = payableRows
        .filter((row) => String(row.status || '').toUpperCase() === 'SETTLED')
        .reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);
      const sourcedPayout = payableRows
        .filter((row) => String(row.source_type || 'SOURCED').toUpperCase() === 'SOURCED')
        .reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);
      const consignmentPayout = payableRows
        .filter((row) => String(row.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT')
        .reduce((sum, row) => sum + Math.max(0, Number(row.amount_due || 0) || 0), 0);

      const returnRows = (await postgresPool.query(`
        SELECT id, sale_id, returned_value, refund_amount, refund_method, return_type, reason, created_at, items
        FROM sales_returns
        WHERE store_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 250
      `, [storeId])).rows as any[];

      const customerReturns: Array<{
        return_id: number;
        sale_id: number;
        item_name: string;
        quantity: number;
        returned_value: number;
        refund_amount: number;
        refund_method: string;
        return_type: string;
        reason: string;
        created_at: string | null;
      }> = [];

      returnRows.forEach((row) => {
        let parsedItems: any[] = [];
        if (Array.isArray(row?.items)) {
          parsedItems = row.items;
        } else {
          try {
            const parsed = JSON.parse(String(row?.items || '[]'));
            parsedItems = Array.isArray(parsed) ? parsed : [];
          } catch {
            parsedItems = [];
          }
        }

        parsedItems.forEach((item: any) => {
          const specs = item?.specs_at_sale && typeof item.specs_at_sale === 'object'
            ? item.specs_at_sale
            : (() => {
                try {
                  const parsed = JSON.parse(String(item?.specs_at_sale || '{}'));
                  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
                } catch {
                  return {};
                }
              })();
          const sourceType = String(item?.item_source || '').toUpperCase();
          const candidateVendorName = sourceType === 'SOURCED'
            ? String(item?.sourced_vendor_name || specs?.sourced_vendor_name || '')
            : String(specs?.vendor_name || item?.vendor_name || '');
          if (!candidateVendorName) return;

          if (normalizeVendorKey(candidateVendorName) !== normalizedTargetVendorName) {
            return;
          }

          customerReturns.push({
            return_id: Number(row?.id || 0),
            sale_id: Number(row?.sale_id || 0),
            item_name: String(item?.name || item?.product_name || specs?.consignment_item_name || 'Vendor Item'),
            quantity: Math.max(0, Math.trunc(Number(item?.quantity || 0) || 0)),
            returned_value: Math.max(0, Number(item?.subtotal || 0) || 0),
            refund_amount: Math.max(0, Number(row?.refund_amount || 0) || 0),
            refund_method: String(row?.refund_method || 'cash').toLowerCase(),
            return_type: String(row?.return_type || 'REFUND').toUpperCase(),
            reason: String(row?.reason || '').trim(),
            created_at: row?.created_at || null,
          });
        });
      });

      const customerReturnedUnits = customerReturns.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0) || 0), 0);
      const collectedUnitsTotal = Math.max(0, collectedUnits + customerReturnedUnits);
      const collectedRecordsTotal = Math.max(0, collectedRecords + customerReturns.length);

      res.json({
        store: {
          id: Number(storeRow.id || storeId),
          name: String(storeRow.name || 'Store'),
          currency_code: /^[A-Z]{3}$/.test(String(storeRow.currency_code || '').toUpperCase()) ? String(storeRow.currency_code).toUpperCase() : 'USD',
        },
        vendor: {
          id: vid,
          name: String(targetRow.vendor_name || 'Unknown Vendor'),
          phone: String(targetRow.vendor_phone || '').trim(),
          address: String(targetRow.vendor_address || '').trim(),
        },
        summary: {
          total_records: items.length,
          active_units: activeUnits,
          collected_records: collectedRecordsTotal,
          collected_units: collectedUnitsTotal,
          sold_units: soldUnits,
          sold_amount: Number(soldAmount.toFixed(2)),
          returned_units: returnedUnits,
          customer_return_events: customerReturns.length,
          customer_returned_units: customerReturnedUnits,
          pending_payout: Number(pendingPayout.toFixed(2)),
          settled_payout: Number(settledPayout.toFixed(2)),
          sourced_payout: Number(sourcedPayout.toFixed(2)),
          consignment_payout: Number(consignmentPayout.toFixed(2)),
          total_payout_generated: Number((pendingPayout + settledPayout).toFixed(2)),
        },
        items,
        customer_returns: customerReturns,
        activities: payableRows.map((row) => ({
          id: Number(row.id || 0),
          item_name: String(row.item_name || 'Item'),
          amount_due: Math.max(0, Number(row.amount_due || 0) || 0),
          source_type: String(row.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'SOURCED',
          status: String(row.status || 'UNPAID').toUpperCase(),
          note: row.note || null,
          sale_timestamp: row.sale_timestamp || null,
          created_at: row.created_at || null,
          settled_at: row.settled_at || null,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load vendor profile.' });
    }
  });

  app.get('/api/products', authenticate, checkStoreLock, async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const normalizedSearch = rawSearch.toLowerCase();
      const requestedCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
      const requestedStockStatus = typeof req.query.stock_status === 'string' ? req.query.stock_status.trim().toLowerCase() : 'all';
      const sortBy = typeof req.query.sort === 'string' ? req.query.sort : 'recent';
      const hasPaginationQuery = req.query.limit !== undefined || req.query.offset !== undefined;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 60));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const productQuery = await coreReadRepository.listProducts({
        storeId,
        search: normalizedSearch,
        category: requestedCategory,
        stockStatus: requestedStockStatus,
        sortBy,
        limit,
        offset,
        paginate: hasPaginationQuery,
      });
      const products = productQuery.rows;

      const openCollections = await coreReadRepository.listOpenMarketCollections(storeId) as any[];

      const onCollectionMap = new Map<number, number>();
      openCollections.forEach((row) => {
        safeJsonParse(row?.items, []).forEach((item: any) => {
          const productId = Number(item?.product_id) || 0;
          const quantity = Math.max(0, Number(item?.quantity) || 0);
          if (productId > 0 && quantity > 0) {
            onCollectionMap.set(productId, (onCollectionMap.get(productId) || 0) + quantity);
          }
        });
      });

      const canViewCostFields = ['STORE_ADMIN', 'SYSTEM_ADMIN', 'ACCOUNTANT', 'PROCUREMENT_OFFICER'].includes(String(req.user?.role || ''));
      const storeRow = (await postgresPool.query('SELECT mode FROM stores WHERE id = $1 LIMIT 1', [storeId])).rows[0];
      const isSupermarketMode = String(storeRow?.mode || '').toUpperCase() === 'SUPERMARKET';

      const formattedProducts = products.map((p: any) => {
        const onCollectionQuantity = onCollectionMap.get(Number(p.id)) || 0;
        const parsedConditionMatrix = isSupermarketMode ? null : (
          typeof p.condition_matrix === 'string'
            ? safeJsonParse(p.condition_matrix, null)
            : (p.condition_matrix || null)
        );
        const sanitizedConditionMatrix = !isSupermarketMode && !canViewCostFields && parsedConditionMatrix
          ? Object.fromEntries(Object.entries(parsedConditionMatrix).map(([key, value]: any) => [
              key,
              {
                ...value,
                cost: null,
                cost_price: null,
                costPrice: null,
              },
            ]))
          : parsedConditionMatrix;

        return {
          ...p,
          cost: canViewCostFields ? Number(p.cost || 0) || 0 : null,
          category: p.category_name || p.category || 'General',
          category_id: p.category_id || null,
          specs: typeof p.specs === 'string' ? safeJsonParse(p.specs, {}) : (p.specs || {}),
          condition_matrix: sanitizedConditionMatrix,
          on_collection_quantity: onCollectionQuantity,
          inventory_status: onCollectionQuantity > 0 ? 'ON_COLLECTION' : 'AVAILABLE',
        };
      });

      if (hasPaginationQuery) {
        return res.json({
          items: formattedProducts,
          total: Number(productQuery.total || 0),
          limit,
          offset,
        });
      }

      res.json(formattedProducts);
    } catch (err: any) {
      console.error('Products read error:', err);
      res.status(500).json({ error: err.message || 'Failed to load products' });
    }
  });

  const normalizeConsignmentStatus = (value: unknown) => {
    const status = String(value || '').trim().toLowerCase();
    if (['approved', 'rejected', 'sold', 'returned'].includes(status)) {
      return status;
    }
    return 'pending';
  };

  const getVendorSignature = (name: unknown, _phone: unknown, _address: unknown) => {
    const normalizedName = String(name || '').trim().toLowerCase();
    return normalizedName || 'unknown-vendor';
  };

  const calculateVendorIdFromSignature = (signature: string) => {
    let hash = 0;
    for (let i = 0; i < signature.length; i += 1) {
      hash = ((hash * 31) + signature.charCodeAt(i)) % 90000;
    }
    return String(hash + 10000).padStart(5, '0');
  };

  const normalizeVendorKey = (value: unknown) => String(value || '').trim().toLowerCase();

  const buildVendorPortalBaseUrl = (req: any) => {
    const origin = String(req.headers?.origin || '').trim();
    if (origin) return origin;

    const host = String(req.get?.('host') || '').trim();
    if (!host) return '';

    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = forwardedProto || req.protocol || 'http';
    return `${protocol}://${host}`;
  };

  const parsePublicSpecs = (value: unknown) => {
    if (!value) return {} as Record<string, any>;
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
    try {
      const parsed = JSON.parse(String(value || '{}'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };

  const getConditionMatrixTotalStock = (publicSpecs: Record<string, any>) => {
    const matrix = publicSpecs && typeof publicSpecs === 'object' ? publicSpecs.__condition_matrix : null;
    if (!matrix || typeof matrix !== 'object') {
      return 0;
    }

    return ['new', 'open_box', 'used']
      .map((key) => Math.max(0, Math.trunc(Number((matrix as any)?.[key]?.stock || 0) || 0)))
      .reduce((sum, value) => sum + value, 0);
  };

  const resolveConsignmentInventoryState = (row: any, publicSpecs: Record<string, any>) => {
    const normalizedStatus = normalizeConsignmentStatus(row?.status);
    const rawQuantity = Math.max(0, Math.trunc(Number(row?.quantity || 0) || 0));
    const matrixQuantity = getConditionMatrixTotalStock(publicSpecs);
    const effectiveQuantity = Math.max(rawQuantity, matrixQuantity);

    let nextStatus = normalizedStatus;
    if (normalizedStatus === 'approved' || normalizedStatus === 'sold') {
      nextStatus = effectiveQuantity <= 0 ? 'sold' : 'approved';
    }

    return {
      rawQuantity,
      effectiveQuantity,
      normalizedStatus,
      nextStatus,
    };
  };

  const normalizeProductChangeRequestStatus = (value: unknown) => {
    const status = String(value || '').trim().toUpperCase();
    if (status === 'APPROVED' || status === 'REJECTED') return status;
    return 'PENDING';
  };

  const parseProductChangePayload = (value: unknown) => {
    if (!value) return {} as Record<string, any>;
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
    try {
      const parsed = JSON.parse(String(value || '{}'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };

  const resolveCategoryForProductPayload = async (storeId: number, rawCategory: unknown, rawCategoryId: unknown) => {
    let categoryName = String(rawCategory || '').trim() || null;
    let selectedCategoryId = Number(rawCategoryId || 0) || null;

    if (selectedCategoryId != null) {
      const byId = (await postgresPool.query('SELECT id, name FROM categories WHERE store_id = $1 AND id = $2 LIMIT 1', [storeId, selectedCategoryId])).rows[0] as { id: number; name: string } | undefined;
      if (byId) {
        categoryName = byId.name;
      } else {
        selectedCategoryId = null;
      }
    }

    if (!selectedCategoryId && categoryName) {
      const existing = (await postgresPool.query('SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1', [storeId, categoryName])).rows[0] as { id: number; name: string } | undefined;
      if (existing) {
        selectedCategoryId = existing.id;
        categoryName = existing.name;
      }
    }

    if (!selectedCategoryId && categoryName) {
      const inserted = await postgresPool.query('INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [storeId, categoryName, null]);
      selectedCategoryId = Number(inserted.rows[0]?.id || 0) || null;
    }

    return { categoryName, selectedCategoryId };
  };

  const applyProductChangeRequest = async (requestRow: any, _reviewer: any) => {
    const payload = parseProductChangePayload(requestRow?.payload);
    const storeId = Number(requestRow?.store_id || 0);
    const requestType = String(requestRow?.request_type || '').trim().toUpperCase();

    const name = String(payload?.name || '').trim();
    const thumbnail = payload?.thumbnail || null;
    const specs = payload?.specs && typeof payload.specs === 'object' ? payload.specs : {};
    const conditionMatrix = payload?.condition_matrix && typeof payload.condition_matrix === 'object' ? payload.condition_matrix : null;
    const price = Math.max(0, Number(payload?.price || 0) || 0);
    const stock = Math.max(0, Math.trunc(Number(payload?.stock || 0) || 0));
    const cost = Math.max(0, Number(payload?.cost || 0) || 0);
    const normalizedBarcode = normalizeProductBarcode(payload?.barcode);

    if (!name || name.length > 255) {
      throw new Error('Requested product has invalid name.');
    }

    if (requestType === 'CREATE') {
      if (normalizedBarcode) {
        const existingBarcode = (await postgresPool.query('SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND deleted_at IS NULL LIMIT 1', [storeId, normalizedBarcode])).rows[0] as { id: number } | undefined;
        if (existingBarcode) {
          throw new Error('Cannot approve request: barcode already exists for another product.');
        }
      }

      const resolvedBarcode = normalizedBarcode || await generateUniqueBarcode(storeId);
      if (!resolvedBarcode) {
        throw new Error('Failed to generate unique barcode during approval.');
      }

      const quickCode = await generateUniqueQuickCode();
      if (!quickCode) {
        throw new Error('Failed to generate unique quick code during approval.');
      }

      const { categoryName, selectedCategoryId } = await resolveCategoryForProductPayload(storeId, payload?.category, payload?.category_id);

      const insertResult = await postgresPool.query(`
        INSERT INTO products (store_id, name, barcode, category, category_id, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `, [
        storeId,
        name,
        resolvedBarcode,
        categoryName || null,
        selectedCategoryId,
        thumbnail,
        quickCode,
        JSON.stringify(specs || {}),
        JSON.stringify(conditionMatrix),
        price,
        stock,
        cost,
        new Date().toISOString(),
      ]);

      const productId = Number(insertResult.rows[0].id);

      return { productId, action: 'CREATE', barcode: resolvedBarcode, quickCode };
    }

    if (requestType !== 'UPDATE') {
      throw new Error('Unsupported product change request type.');
    }

    const productId = Number(requestRow?.product_id || 0);
    if (!productId) {
      throw new Error('Request is missing product reference.');
    }

    const existingProduct = (await postgresPool.query('SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1', [productId, storeId])).rows[0] || null;
    if (!existingProduct) {
      throw new Error('Cannot approve request: product no longer exists.');
    }

    if (normalizedBarcode) {
      const conflictingProduct = (await postgresPool.query('SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND id != $3 AND deleted_at IS NULL LIMIT 1', [storeId, normalizedBarcode, productId])).rows[0] as { id: number } | undefined;
      if (conflictingProduct) {
        throw new Error('Cannot approve request: barcode already exists for another product.');
      }
    }

    const { categoryName, selectedCategoryId } = await resolveCategoryForProductPayload(storeId, payload?.category, payload?.category_id);

    await postgresPool.query(`
      UPDATE products
      SET name = $1, barcode = $2, category = $3, category_id = $4, thumbnail = $5, specs = $6, condition_matrix = $7, price = $8, stock = $9, cost = $10
      WHERE id = $11 AND store_id = $12
    `, [
      name,
      normalizedBarcode || null,
      categoryName || null,
      selectedCategoryId,
      thumbnail,
      JSON.stringify(specs || {}),
      JSON.stringify(conditionMatrix),
      price,
      stock,
      cost,
      productId,
      storeId,
    ]);

    if (conditionMatrix) {
      for (const conditionKey of ['new', 'used', 'open_box']) {
        await reconcileInventoryBatchQuantity({
          productId,
          storeId,
          condition: conditionKey,
          targetStock: Number((conditionMatrix as any)?.[conditionKey]?.stock || 0) || 0,
        });
      }
    } else {
      await reconcileInventoryBatchQuantity({
        productId,
        storeId,
        condition: null,
        targetStock: stock,
      });
    }

    return { productId, action: 'UPDATE', barcode: normalizedBarcode || null, quickCode: String(existingProduct.quick_code || '') };
  };

  app.get('/api/pos/search-items', authenticate, checkStoreLock, async (req: any, res: any) => {
    try {
      const rows = await coreReadRepository.searchUnifiedPosCatalog({
        storeId: Number(req.user.store_id),
        search: typeof req.query.search === 'string' ? req.query.search.trim() : '',
        limit: Math.max(1, Math.min(300, Number(req.query.limit) || 120)),
      });

      const items = rows.map((row: any) => {
        const sourceType = String(row.source_type || 'INVENTORY').toUpperCase();
        const isConsignment = sourceType === 'CONSIGNMENT';
        const specs = parsePublicSpecs(row.specs);
        const consignmentMatrixQuantity = isConsignment ? getConditionMatrixTotalStock(specs) : 0;
        const normalizedConsignmentQuantity = isConsignment
          ? Math.max(
              0,
              Math.trunc(Number(row.consignment_quantity || row.stock || 0) || 0),
              consignmentMatrixQuantity,
            )
          : 0;

        return {
          id: Number(row.id),
          name: String(row.name || '').trim(),
          barcode: String(row.barcode || '').trim(),
          quick_code: String(row.quick_code || '').trim(),
          thumbnail: String(row.thumbnail || '').trim(),
          price: Number(row.price || 0) || 0,
          stock: isConsignment ? normalizedConsignmentQuantity : (Number(row.stock || 0) || 0),
          mode: 'GADGET',
          specs,
          condition_matrix: row.condition_matrix ? parsePublicSpecs(row.condition_matrix) : null,
          is_consignment: isConsignment,
          consignment_item_id: isConsignment ? Number(row.consignment_item_id || 0) || null : null,
          vendor_name: isConsignment ? String(row.vendor_name || '').trim() : '',
          imei_serial: isConsignment ? String(row.imei_serial || '').trim() : '',
          consignment_quantity: normalizedConsignmentQuantity,
          agreed_payout: isConsignment ? Math.max(0, Number(row.agreed_payout || 0) || 0) : 0,
          item_source: isConsignment ? 'CONSIGNMENT' : 'INVENTORY',
        };
      }).filter((item: any) => item.name);

      res.json(items);
    } catch (err: any) {
      console.error('Unified POS search error:', err);
      res.status(500).json({ error: err.message || 'Failed to search POS catalog' });
    }
  });

  app.get('/api/consignment-items', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    try {
      const rawSearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const normalizedSearch = rawSearch.toLowerCase();
      const statusQuery = typeof req.query.status === 'string' ? req.query.status.trim() : 'all';
      const isVendorIdSearch = /^\d{3,}$/.test(rawSearch);

      const rows = await coreReadRepository.listConsignmentItems({
        storeId: Number(req.user.store_id),
        search: isVendorIdSearch ? '' : rawSearch,
        status: statusQuery,
      });

      let normalizedRows = rows.map((row: any) => {
        const publicSpecs = parsePublicSpecs(row.public_specs);
        const state = resolveConsignmentInventoryState(row, publicSpecs);

        return {
          ...row,
          quantity: state.effectiveQuantity,
          agreed_payout: Math.max(0, Number(row.agreed_payout || 0) || 0),
          selling_price: Math.max(0, Number(row.selling_price || 0) || 0),
          public_specs: publicSpecs,
          status: state.nextStatus,
          __needs_heal: state.rawQuantity !== state.effectiveQuantity || state.normalizedStatus !== state.nextStatus,
        };
      });

      if (isVendorIdSearch) {
        normalizedRows = normalizedRows.filter((row: any) => {
          const vendorId = calculateVendorIdFromSignature(getVendorSignature(row.vendor_name, row.vendor_phone, row.vendor_address));
          if (vendorId.includes(rawSearch)) return true;

          const haystack = [
            row.item_name,
            row.vendor_name,
            row.quick_code,
            row.imei_serial,
            row.vendor_phone,
            row.vendor_address,
          ].map((entry) => String(entry || '').toLowerCase()).join(' ');

          return haystack.includes(normalizedSearch);
        });
      }

      const rowsToHeal = normalizedRows.filter((entry: any) => entry.__needs_heal && Number(entry.id || 0) > 0);
      if (rowsToHeal.length > 0) {
        await Promise.all(rowsToHeal.map((entry: any) => postgresPool.query(
          'UPDATE consignment_items SET quantity = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND store_id = $4',
          [
            Math.max(0, Math.trunc(Number(entry.quantity || 0) || 0)),
            String(entry.status || 'pending'),
            Number(entry.id),
            Number(req.user.store_id),
          ],
        )));
      }

      res.json(normalizedRows.map(({ __needs_heal, ...entry }: any) => entry));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load consignment items' });
    }
  });

  app.get('/api/consignment-vendors', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    try {
      const rows = (await postgresPool.query(`
        SELECT vendor_name, vendor_phone, vendor_address, MAX(updated_at) AS last_used_at
        FROM consignment_items
        WHERE store_id = $1
          AND TRIM(COALESCE(vendor_name, '')) != ''
        GROUP BY vendor_name, vendor_phone, vendor_address
        ORDER BY LOWER(vendor_name) ASC, MAX(updated_at) DESC
      `, [Number(req.user.store_id)])).rows;

      res.json(rows.map((row: any) => ({
        vendor_name: String(row.vendor_name || '').trim(),
        vendor_phone: String(row.vendor_phone || '').trim(),
        vendor_address: String(row.vendor_address || '').trim(),
        last_used_at: row.last_used_at || null,
      })).filter((row: any) => row.vendor_name));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load saved vendors' });
    }
  });

  app.get('/api/consignment-vendor-bank-details', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    try {
      const vendorName = String(req.query?.vendor_name || '').trim();
      if (vendorName.length < 2) {
        return res.status(400).json({ error: 'Vendor name is required.' });
      }

      const row = (await postgresPool.query(`
        SELECT vendor_name, bank_name, account_number, account_name, bank_note, updated_at
        FROM consignment_vendor_bank_details
        WHERE store_id = $1 AND vendor_key = $2
        LIMIT 1
      `, [Number(req.user.store_id), normalizeVendorKey(vendorName)])).rows[0] as any;

      res.json({
        vendor_name: vendorName,
        bank_name: String(row?.bank_name || '').trim(),
        account_number: String(row?.account_number || '').trim(),
        account_name: String(row?.account_name || '').trim(),
        bank_note: String(row?.bank_note || '').trim(),
        updated_at: row?.updated_at || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load vendor bank details' });
    }
  });

  app.put('/api/consignment-vendor-bank-details', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const vendorName = String(req.body?.vendor_name || '').trim();
      const bankName = String(req.body?.bank_name || '').trim().slice(0, 120);
      const accountNumber = String(req.body?.account_number || '').trim().slice(0, 40);
      const accountName = String(req.body?.account_name || '').trim().slice(0, 120);
      const bankNote = String(req.body?.bank_note || '').trim().slice(0, 240);

      if (vendorName.length < 2) {
        return res.status(400).json({ error: 'Vendor name is required.' });
      }

      const result = await postgresPool.query(`
        INSERT INTO consignment_vendor_bank_details (
          store_id, vendor_name, vendor_key, bank_name, account_number, account_name, bank_note, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (store_id, vendor_key)
        DO UPDATE SET
          vendor_name = EXCLUDED.vendor_name,
          bank_name = EXCLUDED.bank_name,
          account_number = EXCLUDED.account_number,
          account_name = EXCLUDED.account_name,
          bank_note = EXCLUDED.bank_note,
          updated_at = CURRENT_TIMESTAMP
        RETURNING vendor_name, bank_name, account_number, account_name, bank_note, updated_at
      `, [
        Number(req.user.store_id),
        vendorName,
        normalizeVendorKey(vendorName),
        bankName || null,
        accountNumber || null,
        accountName || null,
        bankNote || null,
      ]);

      const row = result.rows[0] as any;
      res.json({
        vendor_name: String(row?.vendor_name || vendorName).trim(),
        bank_name: String(row?.bank_name || '').trim(),
        account_number: String(row?.account_number || '').trim(),
        account_name: String(row?.account_name || '').trim(),
        bank_note: String(row?.bank_note || '').trim(),
        updated_at: row?.updated_at || null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to save vendor bank details' });
    }
  });

  app.post('/api/consignment-items', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const payload = req.body || {};
    const vendorName = String(payload.vendor_name || '').trim();
    const vendorPhone = String(payload.vendor_phone || '').trim();
    const vendorAddress = String(payload.vendor_address || '').trim();
    const itemName = String(payload.item_name || '').trim();
    const imeiSerial = String(payload.imei_serial || '').trim();
    const quickCode = String(payload.quick_code || '').trim().toUpperCase().replace(/\s+/g, '');
    const quantity = Math.max(1, Math.trunc(Number(payload.quantity || 0) || 1));
    const agreedPayout = Math.max(0, Number(payload.agreed_payout || 0) || 0);
    const sellingPrice = Math.max(0, Number(payload.selling_price || 0) || 0);
    const internalCondition = String(payload.internal_condition || '').trim() || null;
    const publicSpecs = parsePublicSpecs(payload.public_specs);

    if (vendorName.length < 2) {
      return res.status(400).json({ error: 'Vendor name is required.' });
    }
    if (itemName.length < 2) {
      return res.status(400).json({ error: 'Item name is required.' });
    }
    if (agreedPayout <= 0 || sellingPrice <= 0) {
      return res.status(400).json({ error: 'Agreed payout and selling price must be greater than zero.' });
    }

    try {
      const created = await coreWriteRepository.createConsignmentItem({
        storeId: Number(req.user.store_id),
        quickCode: quickCode || null,
        vendorName,
        vendorPhone: vendorPhone || null,
        vendorAddress: vendorAddress || null,
        itemName,
        imeiSerial: imeiSerial || null,
        quantity,
        agreedPayout,
        sellingPrice,
        publicSpecs,
        internalCondition,
        addedBy: Number(req.user.id),
      });

      logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'CONSIGNMENT_ADD',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} added consignment item ${itemName} from ${vendorName}.`,
        newValue: {
          consignment_item_id: Number(created?.id || 0),
          quick_code: created?.quick_code || null,
          imei_serial: created?.imei_serial || null,
          agreed_payout: agreedPayout,
          selling_price: sellingPrice,
        },
      });

      res.json({
        ...created,
        quantity: Math.max(0, Math.trunc(Number(created?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(created?.public_specs),
        status: normalizeConsignmentStatus(created?.status),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create consignment item' });
    }
  });

  app.put('/api/consignment-items/:id', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const consignmentItemId = Number(req.params.id);
    const payload = req.body || {};
    const vendorName = String(payload.vendor_name || '').trim();
    const vendorPhone = String(payload.vendor_phone || '').trim();
    const vendorAddress = String(payload.vendor_address || '').trim();
    const itemName = String(payload.item_name || '').trim();
    const imeiSerial = String(payload.imei_serial || '').trim();
    const quickCode = String(payload.quick_code || '').trim().toUpperCase().replace(/\s+/g, '');
    const quantity = Math.max(1, Math.trunc(Number(payload.quantity || 0) || 1));
    const agreedPayout = Math.max(0, Number(payload.agreed_payout || 0) || 0);
    const sellingPrice = Math.max(0, Number(payload.selling_price || 0) || 0);
    const internalCondition = String(payload.internal_condition || '').trim() || null;
    const publicSpecs = parsePublicSpecs(payload.public_specs);

    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: 'Invalid consignment item ID.' });
    }
    if (vendorName.length < 2 || itemName.length < 2) {
      return res.status(400).json({ error: 'Vendor and item name are required.' });
    }

    try {
      const existing = await coreReadRepository.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: 'Consignment item not found.' });
      }

      // Preserve internal tracking fields (__ prefixed) from the existing record so that
      // editing an item does not wipe out sold/returned quantity trackers.
      // __condition_matrix is excluded from preservation — it must be updated by the edit.
      const existingPublicSpecs = parsePublicSpecs(existing.public_specs);
      const preservedInternalFields = Object.fromEntries(
        Object.entries(existingPublicSpecs).filter(([key]) => key.startsWith('__') && key !== '__condition_matrix'),
      );
      const mergedPublicSpecs = { ...publicSpecs, ...preservedInternalFields };

      const updated = await coreWriteRepository.updateConsignmentItem({
        storeId: Number(req.user.store_id),
        consignmentItemId,
        quickCode: quickCode || null,
        vendorName,
        vendorPhone: vendorPhone || null,
        vendorAddress: vendorAddress || null,
        itemName,
        imeiSerial: imeiSerial || null,
        quantity,
        agreedPayout,
        sellingPrice,
        publicSpecs: mergedPublicSpecs,
        internalCondition,
      });

      logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'CONSIGNMENT_EDIT',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} edited consignment item ${itemName}; status moved to pending approval.`,
        oldValue: {
          status: normalizeConsignmentStatus(existing?.status),
          selling_price: Number(existing?.selling_price || 0) || 0,
        },
        newValue: {
          status: 'pending',
          selling_price: sellingPrice,
          agreed_payout: agreedPayout,
        },
      });

      res.json({
        ...updated,
        quantity: Math.max(0, Math.trunc(Number(updated?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to update consignment item' });
    }
  });

  app.post('/api/consignment-items/:id/approve', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: 'Invalid consignment item ID.' });
    }

    try {
      const updated = await coreWriteRepository.reviewConsignmentItem({
        storeId: Number(req.user.store_id),
        consignmentItemId,
        reviewerId: Number(req.user.id),
        action: 'APPROVE',
      });
      if (!updated) {
        return res.status(404).json({ error: 'Consignment item not found.' });
      }

      res.json({
        ...updated,
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to approve consignment item' });
    }
  });

  app.post('/api/consignment-items/:id/reject', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: 'Invalid consignment item ID.' });
    }

    try {
      const updated = await coreWriteRepository.reviewConsignmentItem({
        storeId: Number(req.user.store_id),
        consignmentItemId,
        reviewerId: Number(req.user.id),
        action: 'REJECT',
      });
      if (!updated) {
        return res.status(404).json({ error: 'Consignment item not found.' });
      }

      res.json({
        ...updated,
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to reject consignment item' });
    }
  });

  app.post('/api/consignment-items/:id/return', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const consignmentItemId = Number(req.params.id);
    const requestedReturnQuantity = Math.max(1, Math.trunc(Number(req.body?.quantity || 0) || 1));
    const collectionReason = String(req.body?.reason || '').trim().slice(0, 200);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: 'Invalid consignment item ID.' });
    }

    try {
      const existing = await coreReadRepository.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: 'Consignment item not found.' });
      }

      const publicSpecs = parsePublicSpecs(existing.public_specs);
      const state = resolveConsignmentInventoryState(existing, publicSpecs);
      if (state.nextStatus === 'sold' || state.effectiveQuantity <= 0) {
        return res.status(400).json({ error: 'Sold items cannot be returned to vendor.' });
      }
      if (state.nextStatus === 'rejected' || state.nextStatus === 'returned') {
        return res.status(400).json({ error: 'This item is not available for return-to-vendor updates.' });
      }
      if (requestedReturnQuantity > state.effectiveQuantity) {
        return res.status(400).json({ error: `Only ${state.effectiveQuantity} unit(s) are available to return.` });
      }

      const nextQuantity = Math.max(0, state.effectiveQuantity - requestedReturnQuantity);
      const nextStatus = nextQuantity <= 0 ? 'returned' : 'approved';
      const matrix = publicSpecs && typeof publicSpecs === 'object' ? publicSpecs.__condition_matrix : null;
      const currentReturnedTotal = Math.max(0, Math.trunc(Number(publicSpecs?.__returned_quantity_total || 0) || 0));
      const nowIso = new Date().toISOString();
      publicSpecs.__returned_quantity_total = currentReturnedTotal + requestedReturnQuantity;
      publicSpecs.__last_returned_quantity = requestedReturnQuantity;
      publicSpecs.__last_returned_at = nowIso;
      if (collectionReason) {
        publicSpecs.__last_returned_reason = collectionReason;
      } else {
        delete publicSpecs.__last_returned_reason;
      }
      // Append to history log
      const existingHistory = Array.isArray(publicSpecs.__return_history) ? publicSpecs.__return_history : [];
      existingHistory.push({
        quantity: requestedReturnQuantity,
        reason: collectionReason || null,
        at: nowIso,
        by: req.user.username || null,
      });
      publicSpecs.__return_history = existingHistory;

      if (matrix && typeof matrix === 'object') {
        let remainingToDeduct = requestedReturnQuantity;
        for (const key of ['new', 'open_box', 'used']) {
          if (remainingToDeduct <= 0) break;
          const stock = Math.max(0, Math.trunc(Number((matrix as any)?.[key]?.stock || 0) || 0));
          if (stock <= 0) continue;
          const deduction = Math.min(stock, remainingToDeduct);
          (matrix as any)[key] = {
            ...(typeof (matrix as any)[key] === 'object' ? (matrix as any)[key] : {}),
            stock: stock - deduction,
          };
          remainingToDeduct -= deduction;
        }
      }

      const updated = (await postgresPool.query(`
        UPDATE consignment_items
        SET quantity = $1,
            status = $2,
            public_specs = $3::jsonb,
            approved_by = $4,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $5 AND store_id = $6
        RETURNING *
      `, [
        nextQuantity,
        nextStatus,
        JSON.stringify(publicSpecs || {}),
        Number(req.user.id),
        consignmentItemId,
        Number(req.user.store_id),
      ])).rows[0];

      if (!updated) {
        return res.status(404).json({ error: 'Consignment item not found.' });
      }

      logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'CONSIGNMENT_RETURN',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} returned ${requestedReturnQuantity} unit(s) of consignment item ${existing.item_name || `#${consignmentItemId}`} to vendor ${existing.vendor_name || 'N/A'}${collectionReason ? `. Reason: ${collectionReason}` : ''}.`,
        oldValue: {
          status: state.nextStatus,
          quantity: state.effectiveQuantity,
          quick_code: existing.quick_code || null,
        },
        newValue: {
          status: nextStatus,
          quantity: nextQuantity,
          returned_quantity: requestedReturnQuantity,
          consignment_item_id: consignmentItemId,
        },
      });

      res.json({
        ...updated,
        quantity: Math.max(0, Math.trunc(Number(updated?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to return consignment item to vendor' });
    }
  });

  app.post('/api/consignment-items/:id/recalculate-sold', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: 'Invalid consignment item ID.' });
    }

    try {
      const existing = await coreReadRepository.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: 'Consignment item not found.' });
      }

      let netSoldQty: number;
      let netSoldAmount: number;

      const manualQty = req.body?.soldQty;
      const manualAmount = req.body?.soldAmount;

      if (manualQty !== undefined && manualQty !== null) {
        // Manager provided explicit values — use them directly.
        netSoldQty = Math.max(0, Math.trunc(Number(manualQty) || 0));
        netSoldAmount = Math.max(0, Number(manualAmount ?? 0) || 0);
      } else {
        // Reconstruct from actual sale_items records.
        const salesRows = (await postgresPool.query(`
          SELECT si.id, si.quantity, si.subtotal, si.price_at_sale
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE s.store_id = $1
            AND (si.specs_at_sale::jsonb->>'consignment_item_id')::int = $2
        `, [Number(req.user.store_id), consignmentItemId])).rows;

        const totalSoldQty = salesRows.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.quantity) || 0), 0);
        const totalSoldAmount = salesRows.reduce((sum: number, row: any) => {
          const subtotal = Math.max(0, Number(row.subtotal) || 0);
          return sum + (subtotal > 0 ? subtotal : Math.max(0, Number(row.price_at_sale) || 0) * Math.max(0, Number(row.quantity) || 0));
        }, 0);

        const returnRows = (await postgresPool.query(`
          SELECT sr.items FROM sales_returns sr WHERE sr.store_id = $1
        `, [Number(req.user.store_id)])).rows;

        let totalReturnedQty = 0;
        let totalReturnedAmount = 0;
        for (const row of returnRows) {
          const items = safeJsonParse(row.items, [] as any[]);
          for (const item of items) {
            const itemConsignmentId = Math.max(0, Number(item?.consignment_item_id || 0) || 0);
            if (itemConsignmentId === consignmentItemId) {
              totalReturnedQty += Math.max(0, Number(item.quantity) || 0);
              totalReturnedAmount += Math.max(0, Number(item.subtotal) || 0);
            }
          }
        }

        netSoldQty = Math.max(0, totalSoldQty - totalReturnedQty);
        netSoldAmount = Number(Math.max(0, totalSoldAmount - totalReturnedAmount).toFixed(2));
      }

      const publicSpecs = parsePublicSpecs(existing.public_specs);
      publicSpecs.__sold_quantity_total = netSoldQty;
      publicSpecs.__sold_amount_total = netSoldAmount;
      if (netSoldQty > 0 && !publicSpecs.__last_sold_at) {
        publicSpecs.__last_sold_at = existing.updated_at || new Date().toISOString();
      }

      const updated = (await postgresPool.query(`
        UPDATE consignment_items
        SET public_specs = $1::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND store_id = $3
        RETURNING *
      `, [
        JSON.stringify(publicSpecs),
        consignmentItemId,
        Number(req.user.store_id),
      ])).rows[0];

      res.json({
        ...updated,
        quantity: Math.max(0, Math.trunc(Number(updated?.quantity || 0) || 0)),
        public_specs: parsePublicSpecs(updated?.public_specs),
        status: normalizeConsignmentStatus(updated?.status),
        recalculated: { soldQty: netSoldQty, soldAmount: netSoldAmount },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to recalculate sold stats' });
    }
  });

  app.delete('/api/consignment-vendors', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const vendorName = String(req.query?.vendor_name || '').trim();
    if (vendorName.length < 2) {
      return res.status(400).json({ error: 'vendor_name query param is required.' });
    }
    try {
      const storeId = Number(req.user.store_id);
      const rows = (await postgresPool.query(
        "SELECT id, quantity FROM consignment_items WHERE store_id = $1 AND LOWER(TRIM(vendor_name)) = LOWER($2)",
        [storeId, vendorName],
      )).rows as any[];

      if (rows.length === 0) {
        return res.json({ deleted: true, vendor_name: vendorName, deleted_count: 0 });
      }

      const hasActiveStock = rows.some((row) => {
        const qty = Math.max(0, Math.trunc(Number(row.quantity || 0) || 0));
        return qty > 0;
      });

      if (hasActiveStock) {
        return res.status(409).json({ error: 'Cannot delete this vendor — one or more of their items still have stock (quantity > 0). Reduce quantity to 0 first.' });
      }

      const ids = rows.map((r) => Number(r.id));
      await postgresPool.query(
        `DELETE FROM consignment_items WHERE store_id = $1 AND id = ANY($2::int[])`,
        [storeId, ids],
      );

      logAuditEvent({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'CONSIGNMENT_VENDOR_DELETE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} deleted all consignment items (${ids.length}) for vendor "${vendorName}".`,
        oldValue: { vendor_name: vendorName, deleted_count: ids.length },
        newValue: null,
      });

      res.json({ deleted: true, vendor_name: vendorName, deleted_count: ids.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete vendor.' });
    }
  });

  app.delete('/api/consignment-items/:id', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const consignmentItemId = Number(req.params.id);
    if (!Number.isInteger(consignmentItemId) || consignmentItemId <= 0) {
      return res.status(400).json({ error: 'Invalid consignment item ID.' });
    }
    try {
      const existing = await coreReadRepository.getConsignmentItemById(Number(req.user.store_id), consignmentItemId);
      if (!existing) {
        return res.status(404).json({ error: 'Consignment item not found.' });
      }
      const currentQty = Math.max(0, Math.trunc(Number(existing.quantity || 0) || 0));
      if (currentQty > 0) {
        return res.status(409).json({ error: 'Cannot delete an item that still has stock. Reduce quantity to 0 first.' });
      }
      await postgresPool.query(
        'DELETE FROM consignment_items WHERE id = $1 AND store_id = $2',
        [consignmentItemId, Number(req.user.store_id)],
      );
      res.json({ deleted: true, id: consignmentItemId });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete consignment item.' });
    }
  });

  app.get('/api/inventory/daily-summary', authenticate, checkStoreLock, async (req: any, res: any) => {
    const getLocalDateKey = (date = new Date()) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const requestedDate = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : getLocalDateKey();
    const requestedDays = Math.max(7, Math.min(21, Number(req.query.days) || 14));

    try {
      const summary = await coreReadRepository.getInventoryDailySummary(Number(req.user.store_id), requestedDate, requestedDays);
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load inventory summary' });
    }
  });

  app.get('/api/stock-adjustments', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const rows = await coreReadRepository.listStockAdjustments({
        storeId: Number(req.user.store_id),
        search: typeof req.query.search === 'string' ? req.query.search.trim() : '',
        typeFilter: typeof req.query.type === 'string' ? req.query.type.trim() : '',
        productIdFilter: Number(req.query.productId),
      });

      res.json(rows.map((row: any) => formatStockAdjustmentEntry(row)));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load stock adjustments' });
    }
  });

  app.post('/api/stock-adjustments', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const productId = Number(req.body?.product_id);
    const rawQuantity = Number(req.body?.quantity);
    const condition = req.body?.condition;
    const note = String(req.body?.note || '').trim().slice(0, 500);
    const adjustmentMode = ['INCREASE', 'DECREASE', 'SET'].includes(String(req.body?.adjustment_mode || '').toUpperCase())
      ? String(req.body?.adjustment_mode || '').toUpperCase()
      : 'DECREASE';
    const adjustmentType = ['DAMAGED', 'LOST', 'FOUND', 'MANUAL', 'INTERNAL_USE', 'RESTOCK', 'COUNT'].includes(String(req.body?.adjustment_type || '').toUpperCase())
      ? String(req.body?.adjustment_type || '').toUpperCase()
      : 'MANUAL';

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Select a valid product to adjust.' });
    }

    if (!Number.isFinite(rawQuantity) || rawQuantity < 0) {
      return res.status(400).json({ error: 'Enter a valid quantity for this stock adjustment.' });
    }

    if (adjustmentMode !== 'SET' && rawQuantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than zero.' });
    }

    try {
      const createdAdjustment = await coreWriteRepository.createStockAdjustment({
        storeId,
        productId,
        rawQuantity,
        condition,
        note: note || null,
        adjustmentMode: adjustmentMode as 'INCREASE' | 'DECREASE' | 'SET',
        adjustmentType: adjustmentType as 'DAMAGED' | 'LOST' | 'FOUND' | 'MANUAL' | 'INTERNAL_USE' | 'RESTOCK' | 'COUNT',
        userId: Number(req.user.id),
        userRole: String(req.user.role || ''),
      });

      const nextStatus = normalizeRecountStatus(createdAdjustment?.recount_status);
      const isPendingRecount = nextStatus === 'PENDING';
      const actionDescription = isPendingRecount
        ? `${getAuditActorLabel(req.user.role)} ${req.user.username} submitted a stock recount for ${createdAdjustment?.product_name || `Product #${productId}`} and is awaiting approval.`
        : `${getAuditActorLabel(req.user.role)} ${req.user.username} adjusted ${createdAdjustment?.product_name || `Product #${productId}`} stock from ${Number(createdAdjustment?.quantity_before || 0) || 0} to ${Number(createdAdjustment?.quantity_after || 0) || 0}${createdAdjustment?.condition ? ` (${String(createdAdjustment.condition).replace(/_/g, ' ')})` : ''}.`;

      logAuditEvent({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'STOCK_ADJUST',
        description: actionDescription,
        oldValue: {
          quantity_before: Number(createdAdjustment?.quantity_before || 0) || 0,
          adjustment_type: createdAdjustment?.adjustment_type || adjustmentType,
        },
        newValue: {
          quantity_after: Number(createdAdjustment?.quantity_after || 0) || 0,
          quantity_change: Number(createdAdjustment?.quantity_change || 0) || 0,
          recount_status: nextStatus,
          note: createdAdjustment?.note || note || null,
        },
      });

      res.json({ success: true, adjustment: formatStockAdjustmentEntry(createdAdjustment) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to save stock adjustment' });
    }
  });

  app.post('/api/stock-adjustments/:id/approve', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const adjustmentId = Number(req.params.id);
    const approvalNote = String(req.body?.approval_note || '').trim().slice(0, 500);

    if (!Number.isInteger(adjustmentId) || adjustmentId <= 0) {
      return res.status(400).json({ error: 'Invalid stock count record.' });
    }

    try {
      const approvedAdjustment = await coreWriteRepository.reviewStockAdjustment({
        storeId,
        adjustmentId,
        approvalNote: approvalNote || null,
        approvedBy: Number(req.user.id),
        action: 'APPROVE',
      });

      logAuditEvent({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'STOCK_ADJUST',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} approved stock recount #${adjustmentId} for ${approvedAdjustment?.product_name || 'inventory item'}.`,
        oldValue: { recount_status: 'PENDING' },
        newValue: {
          recount_status: 'APPROVED',
          quantity_after: Number(approvedAdjustment?.quantity_after || 0) || 0,
          approval_note: approvalNote || null,
        },
      });

      res.json({ success: true, adjustment: formatStockAdjustmentEntry(approvedAdjustment) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to approve stock recount' });
    }
  });

  app.post('/api/stock-adjustments/:id/reject', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const adjustmentId = Number(req.params.id);
    const approvalNote = String(req.body?.approval_note || '').trim().slice(0, 500);

    if (!Number.isInteger(adjustmentId) || adjustmentId <= 0) {
      return res.status(400).json({ error: 'Invalid stock count record.' });
    }

    try {
      const rejectedAdjustment = await coreWriteRepository.reviewStockAdjustment({
        storeId,
        adjustmentId,
        approvalNote: approvalNote || null,
        approvedBy: Number(req.user.id),
        action: 'REJECT',
      });

      logAuditEvent({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'STOCK_ADJUST',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} rejected stock recount #${adjustmentId} for ${rejectedAdjustment?.product_name || 'inventory item'}.`,
        oldValue: { recount_status: 'PENDING' },
        newValue: {
          recount_status: 'REJECTED',
          approval_note: approvalNote || null,
        },
      });

      res.json({ success: true, adjustment: formatStockAdjustmentEntry(rejectedAdjustment) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to reject stock recount' });
    }
  });

  app.post('/api/products', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const { name, barcode, category, category_id, thumbnail, specs, condition_matrix, price, stock, cost } = req.body;
    const canEditCost = ['STORE_ADMIN', 'SYSTEM_ADMIN'].includes(String(req.user?.role || ''));

    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: 'Product name required (max 255 chars)' });
    }
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ error: 'Selling price must be zero or greater.' });
    }
    if (typeof stock !== 'number' || stock < 0 || !Number.isInteger(stock)) {
      return res.status(400).json({ error: 'Stock must be a positive integer' });
    }

    const normalizedCost = canEditCost ? Number(cost ?? 0) : 0;
    if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
      return res.status(400).json({ error: 'Cost must be zero or greater.' });
    }

    const storeForMode = (await postgresPool.query('SELECT mode FROM stores WHERE id = $1 LIMIT 1', [req.user.store_id])).rows[0];
    const isSupermarketStore = String(storeForMode?.mode || '').toUpperCase() === 'SUPERMARKET';

    let normalizedConditionMatrix = isSupermarketStore ? null : (condition_matrix || null);
    if (!isSupermarketStore && condition_matrix) {
      const requiredConditions = ['new', 'used', 'open_box'];
      normalizedConditionMatrix = {} as any;

      for (const cond of requiredConditions) {
        const slot = condition_matrix[cond];
        if (!slot || typeof slot.price !== 'number' || typeof slot.stock !== 'number') {
          return res.status(400).json({ error: `Invalid condition_matrix for ${cond}. Must have price and stock.` });
        }

        const slotPrice = Math.max(0, Number(slot.price) || 0);
        const slotStock = Math.max(0, Number(slot.stock) || 0);
        const slotCost = canEditCost
          ? Math.max(0, Number(slot.cost ?? slot.cost_price ?? slot.costPrice ?? 0) || 0)
          : 0;

        if ((slotStock > 0 || slotCost > 0) && slotPrice <= 0) {
          return res.status(400).json({ error: `Selling price is required for ${cond.replace('_', ' ')} items.` });
        }

        normalizedConditionMatrix[cond] = {
          ...slot,
          price: slotPrice,
          stock: slotStock,
          cost: slotCost,
        };
      }
    }

    const hasAnyConditionPricing = Boolean(normalizedConditionMatrix)
      && ['new', 'used', 'open_box'].some((cond) => Number((normalizedConditionMatrix as any)?.[cond]?.price || 0) > 0);

    const hasValidMainPrice = Number(price) > 0;
    if (!hasValidMainPrice && !hasAnyConditionPricing) {
      return res.status(400).json({ error: 'Selling price must be greater than zero. Condition-based pricing can be an alternative for gadgets.' });
    }

    const normalizedBarcode = normalizeProductBarcode(barcode);
    if (normalizedBarcode) {
      const existingBarcode = (await postgresPool.query('SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND deleted_at IS NULL LIMIT 1', [req.user.store_id, normalizedBarcode])).rows[0] as { id: number } | undefined;
      if (existingBarcode) {
        return res.status(400).json({ error: 'Barcode already exists for another product in this store' });
      }
    }

    const isStaffRequest = String(req.user?.role || '').toUpperCase() === 'STAFF';

    if (isStaffRequest) {
      try {
        const requestPayload = {
          name,
          barcode: normalizedBarcode || null,
          category: category || null,
          category_id: category_id || null,
          thumbnail: thumbnail || null,
          specs: specs || {},
          condition_matrix: normalizedConditionMatrix,
          price,
          stock,
          cost: normalizedCost,
        };

        const requestResult = await postgresPool.query(`
          INSERT INTO product_change_requests (store_id, request_type, product_id, payload, status, requested_by)
          VALUES ($1, 'CREATE', NULL, $2, 'PENDING', $3)
          RETURNING id
        `, [
          req.user.store_id,
          JSON.stringify(requestPayload),
          Number(req.user.id),
        ]);

        await logAuditEvent({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          userName: req.user.username,
          actionType: 'PRODUCT_CHANGE_REQUEST',
          description: `${getAuditActorLabel(req.user.role)} ${req.user.username} submitted a product create request for ${name}.`,
          newValue: {
            request_id: Number(requestResult.rows[0]?.id || 0),
            request_type: 'CREATE',
            name,
            price,
            stock,
          },
        });

        return res.json({
          pendingApproval: true,
          request_id: Number(requestResult.rows[0]?.id || 0),
          message: 'Product request submitted for manager approval.',
        });
      } catch (err: any) {
        return res.status(400).json({ error: err.message || 'Failed to submit product approval request' });
      }
    }

    const resolvedBarcode = normalizedBarcode || await generateUniqueBarcode(req.user.store_id);
    if (!resolvedBarcode) {
      return res.status(500).json({ error: 'Failed to generate unique barcode' });
    }

    const quick_code = await generateUniqueQuickCode();
    if (!quick_code) {
      return res.status(500).json({ error: 'Failed to generate unique quick code' });
    }

    let categoryName = category || null;
    let selectedCategoryId = category_id || null;
    if (!selectedCategoryId && categoryName) {
      const existing = (await postgresPool.query('SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2)', [req.user.store_id, categoryName.trim()])).rows[0] as { id: number; name: string } | undefined;
      if (existing) {
        selectedCategoryId = existing.id;
        categoryName = existing.name;
      }
    }
    if (!selectedCategoryId && categoryName) {
      const inserted = await postgresPool.query('INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [req.user.store_id, categoryName.trim(), null]);
      selectedCategoryId = inserted.rows[0]?.id || selectedCategoryId;
    }

    try {
      const result = await postgresPool.query(`
        INSERT INTO products (store_id, name, barcode, category, category_id, thumbnail, quick_code, specs, condition_matrix, price, stock, cost, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id
      `, [
        req.user.store_id,
        name,
        resolvedBarcode,
        categoryName || null,
        selectedCategoryId,
        thumbnail || null,
        quick_code,
        JSON.stringify(specs || {}),
        JSON.stringify(normalizedConditionMatrix),
        price,
        stock,
        normalizedCost,
        new Date().toISOString(),
      ]);

      const productId = Number(result.rows[0].id);

      await logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'PRODUCT_ADD',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} added new product ${name} at ${formatAuditCurrency(price)} with opening stock ${Number(stock) || 0}.`,
        newValue: {
          productId,
          name,
          price,
          stock,
          barcode: resolvedBarcode,
        },
      });

      res.json({
        id: productId,
        quick_code,
        barcode: resolvedBarcode,
        autoGeneratedBarcode: !normalizedBarcode,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/products/:id', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    const { name, barcode, category, category_id, thumbnail, specs, condition_matrix, price, stock, cost } = req.body;
    const productId = Number(req.params.id);
    const canEditCost = ['STORE_ADMIN', 'SYSTEM_ADMIN'].includes(String(req.user?.role || ''));

    if (!Number.isInteger(productId) || productId <= 0) {
      return res.status(400).json({ error: 'Invalid product id' });
    }
    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: 'Product name required (max 255 chars)' });
    }
    if (typeof price !== 'number' || price < 0) {
      return res.status(400).json({ error: 'Selling price must be zero or greater.' });
    }
    if (typeof stock !== 'number' || stock < 0 || !Number.isInteger(stock)) {
      return res.status(400).json({ error: 'Stock must be a positive integer' });
    }

    const existingProduct = (await postgresPool.query('SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1', [productId, req.user.store_id])).rows[0] || null;
    if (!existingProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const normalizedCost = canEditCost ? Number(cost ?? existingProduct.cost ?? 0) : Number(existingProduct.cost || 0);
    if (!Number.isFinite(normalizedCost) || normalizedCost < 0) {
      return res.status(400).json({ error: 'Cost must be zero or greater.' });
    }

    const storeForModePut = (await postgresPool.query('SELECT mode FROM stores WHERE id = $1 LIMIT 1', [req.user.store_id])).rows[0];
    const isSupermarketStorePut = String(storeForModePut?.mode || '').toUpperCase() === 'SUPERMARKET';

    const existingMatrix = safeJsonParse(existingProduct.condition_matrix, {});
    let normalizedConditionMatrix = isSupermarketStorePut ? null : (condition_matrix || null);
    if (!isSupermarketStorePut && condition_matrix) {
      const requiredConditions = ['new', 'used', 'open_box'];
      normalizedConditionMatrix = {} as any;
      for (const cond of requiredConditions) {
        const slot = condition_matrix[cond];
        if (!slot || typeof slot.price !== 'number' || typeof slot.stock !== 'number') {
          return res.status(400).json({ error: `Invalid condition_matrix for ${cond}. Must have price and stock.` });
        }

        const slotPrice = Math.max(0, Number(slot.price) || 0);
        const slotStock = Math.max(0, Number(slot.stock) || 0);
        const preservedCost = Math.max(0, Number(existingMatrix?.[cond]?.cost ?? 0) || 0);
        const slotCost = canEditCost
          ? Math.max(0, Number(slot.cost ?? slot.cost_price ?? slot.costPrice ?? preservedCost) || 0)
          : preservedCost;

        if ((slotStock > 0 || slotCost > 0) && slotPrice <= 0) {
          return res.status(400).json({ error: `Selling price is required for ${cond.replace('_', ' ')} items.` });
        }

        normalizedConditionMatrix[cond] = {
          ...slot,
          price: slotPrice,
          stock: slotStock,
          cost: slotCost,
        };
      }
    }

    const hasAnyConditionPricing = Boolean(normalizedConditionMatrix)
      && ['new', 'used', 'open_box'].some((cond) => Number((normalizedConditionMatrix as any)?.[cond]?.price || 0) > 0);

    const hasValidMainPrice = Number(price) > 0;
    if (!hasValidMainPrice && !hasAnyConditionPricing) {
      return res.status(400).json({ error: 'Selling price must be greater than zero. Condition-based pricing can be an alternative for gadgets.' });
    }

    const normalizedBarcode = normalizeProductBarcode(barcode);
    if (normalizedBarcode) {
      const conflictingProduct = (await postgresPool.query('SELECT id FROM products WHERE store_id = $1 AND barcode = $2 AND id != $3 AND deleted_at IS NULL LIMIT 1', [req.user.store_id, normalizedBarcode, productId])).rows[0] as { id: number } | undefined;
      if (conflictingProduct) {
        return res.status(400).json({ error: 'Barcode already exists for another product in this store' });
      }
    }

    let categoryName = category || null;
    let selectedCategoryId = category_id || null;
    if (!selectedCategoryId && categoryName) {
      const existing = (await postgresPool.query('SELECT id, name FROM categories WHERE store_id = $1 AND LOWER(name) = LOWER($2)', [req.user.store_id, categoryName.trim()])).rows[0] as { id: number; name: string } | undefined;
      if (existing) {
        selectedCategoryId = existing.id;
        categoryName = existing.name;
      }
    }
    if (!selectedCategoryId && categoryName) {
      const inserted = await postgresPool.query('INSERT INTO categories (store_id, name, description) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id', [req.user.store_id, categoryName.trim(), null]);
      selectedCategoryId = inserted.rows[0]?.id || selectedCategoryId;
    }

    try {
      await postgresPool.query(`
        UPDATE products SET name = $1, barcode = $2, category = $3, category_id = $4, thumbnail = $5, specs = $6, condition_matrix = $7, price = $8, stock = $9, cost = $10
        WHERE id = $11 AND store_id = $12
      `, [
        name,
        normalizedBarcode || null,
        categoryName || null,
        selectedCategoryId,
        thumbnail || null,
        JSON.stringify(specs || {}),
        JSON.stringify(normalizedConditionMatrix),
        price,
        stock,
        normalizedCost,
        productId,
        req.user.store_id,
      ]);

      if (normalizedConditionMatrix) {
        for (const conditionKey of ['new', 'used', 'open_box']) {
          await reconcileInventoryBatchQuantity({
            productId,
            storeId: Number(req.user.store_id),
            condition: conditionKey,
            targetStock: Number((normalizedConditionMatrix as any)?.[conditionKey]?.stock || 0) || 0,
          });
        }
      } else {
        await reconcileInventoryBatchQuantity({
          productId,
          storeId: Number(req.user.store_id),
          condition: null,
          targetStock: Number(stock || 0) || 0,
        });
      }

      const actorLabel = getAuditActorLabel(req.user.role);
      const baseProductName = String(existingProduct.name || name || `Product #${productId}`);
      const auditEntries: Array<{ actionType: string; description: string; oldValue?: unknown; newValue?: unknown }> = [];

      if (Number(existingProduct.price || 0) !== Number(price || 0)) {
        auditEntries.push({
          actionType: 'PRICE_CHANGE',
          description: `${actorLabel} ${req.user.username} changed ${baseProductName} price from ${formatAuditCurrency(existingProduct.price)} to ${formatAuditCurrency(price)}.`,
          oldValue: { price: Number(existingProduct.price || 0) || 0 },
          newValue: { price: Number(price || 0) || 0 },
        });
      }

      if (Number(existingProduct.stock || 0) !== Number(stock || 0)) {
        auditEntries.push({
          actionType: 'STOCK_ADJUST',
          description: `${actorLabel} ${req.user.username} changed ${baseProductName} stock from ${Number(existingProduct.stock || 0) || 0} to ${Number(stock || 0) || 0} via inventory edit.`,
          oldValue: { stock: Number(existingProduct.stock || 0) || 0 },
          newValue: { stock: Number(stock || 0) || 0 },
        });
      }

      if (normalizedConditionMatrix) {
        ['new', 'open_box', 'used'].forEach((conditionKey) => {
          const previousSlot = existingMatrix?.[conditionKey] || {};
          const nextSlot = (normalizedConditionMatrix as any)?.[conditionKey] || {};
          const conditionLabel = conditionKey.replace(/_/g, ' ');
          const beforePrice = Number(previousSlot?.price || 0) || 0;
          const afterPrice = Number(nextSlot?.price || 0) || 0;
          const beforeStock = Number(previousSlot?.stock || 0) || 0;
          const afterStock = Number(nextSlot?.stock || 0) || 0;

          if (beforePrice !== afterPrice) {
            auditEntries.push({
              actionType: 'PRICE_CHANGE',
              description: `${actorLabel} ${req.user.username} changed ${baseProductName} (${conditionLabel}) price from ${formatAuditCurrency(beforePrice)} to ${formatAuditCurrency(afterPrice)}.`,
              oldValue: { condition: conditionKey, price: beforePrice },
              newValue: { condition: conditionKey, price: afterPrice },
            });
          }

          if (beforeStock !== afterStock) {
            auditEntries.push({
              actionType: 'STOCK_ADJUST',
              description: `${actorLabel} ${req.user.username} changed ${baseProductName} (${conditionLabel}) stock from ${beforeStock} to ${afterStock}.`,
              oldValue: { condition: conditionKey, stock: beforeStock },
              newValue: { condition: conditionKey, stock: afterStock },
            });
          }
        });
      }

      if (!auditEntries.length) {
        auditEntries.push({
          actionType: 'PRODUCT_UPDATE',
          description: `${actorLabel} ${req.user.username} updated ${baseProductName} details.`,
          oldValue: { name: existingProduct.name, category: existingProduct.category },
          newValue: { name, category: categoryName || existingProduct.category || null },
        });
      }

      for (const entry of auditEntries) {
        await logAuditEvent({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          userName: req.user.username,
          actionType: entry.actionType,
          description: entry.description,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
        });
      }

      res.json({ success: true, barcode: normalizedBarcode || null });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/product-change-requests', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const requestedStatus = normalizeProductChangeRequestStatus(req.query.status);
    const isStaff = req.user.role === 'STAFF';

    try {
      let query = `
        SELECT pcr.*, requester.username AS requested_by_username, reviewer.username AS reviewed_by_username
        FROM product_change_requests pcr
        LEFT JOIN users requester ON requester.id = pcr.requested_by
        LEFT JOIN users reviewer ON reviewer.id = pcr.reviewed_by
        WHERE pcr.store_id = $1 AND pcr.status = $2
      `;
      const params: any[] = [Number(req.user.store_id), requestedStatus];

      // Staff users can only see their own requests
      if (isStaff) {
        query += ` AND pcr.requested_by = $3`;
        params.push(Number(req.user.id));
      }

      query += ` ORDER BY pcr.created_at DESC, pcr.id DESC`;

      const rows = (await postgresPool.query(query, params)).rows;

      res.json(rows.map((row) => ({
        ...row,
        payload: parseProductChangePayload(row.payload),
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load product change requests' });
    }
  });

  app.post('/api/product-change-requests/:id/approve', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ error: 'Invalid request ID.' });
    }

    try {
      const requestRow = (await postgresPool.query(`
        SELECT * FROM product_change_requests
        WHERE id = $1 AND store_id = $2 AND status = 'PENDING'
        LIMIT 1
      `, [requestId, Number(req.user.store_id)])).rows[0] || null;

      if (!requestRow) {
        return res.status(404).json({ error: 'Pending product change request not found.' });
      }

      const payloadOverride = parseProductChangePayload(req.body?.payload);
      const hasPayloadOverride = payloadOverride && typeof payloadOverride === 'object' && Object.keys(payloadOverride).length > 0;
      const effectiveRequestRow = hasPayloadOverride
        ? { ...requestRow, payload: payloadOverride }
        : requestRow;

      const applied = await applyProductChangeRequest(effectiveRequestRow, req.user);

      await postgresPool.query(`
        UPDATE product_change_requests
        SET status = 'APPROVED',
            reviewed_by = $1,
            reviewed_at = CURRENT_TIMESTAMP,
            review_note = $2,
            product_id = COALESCE(product_id, $3),
            payload = COALESCE($6::jsonb, payload)
        WHERE id = $4 AND store_id = $5
      `, [
        Number(req.user.id),
        String(req.body?.note || '').trim() || null,
        Number(applied.productId || 0) || null,
        requestId,
        Number(req.user.store_id),
        hasPayloadOverride ? JSON.stringify(payloadOverride) : null,
      ]);

      await logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'PRODUCT_CHANGE_APPROVE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} approved product ${String(applied.action || '').toLowerCase()} request #${requestId}.`,
        newValue: {
          request_id: requestId,
          request_type: requestRow.request_type,
          product_id: applied.productId,
          barcode: applied.barcode || null,
          reviewer_edited_payload: hasPayloadOverride,
        },
      });

      res.json({ success: true, request_id: requestId, product_id: applied.productId, action: applied.action });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to approve product change request' });
    }
  });

  app.post('/api/product-change-requests/:id/reject', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId <= 0) {
      return res.status(400).json({ error: 'Invalid request ID.' });
    }

    try {
      const requestRow = (await postgresPool.query(`
        SELECT * FROM product_change_requests
        WHERE id = $1 AND store_id = $2 AND status = 'PENDING'
        LIMIT 1
      `, [requestId, Number(req.user.store_id)])).rows[0] || null;

      if (!requestRow) {
        return res.status(404).json({ error: 'Pending product change request not found.' });
      }

      const reviewNote = String(req.body?.note || '').trim() || null;
      await postgresPool.query(`
        UPDATE product_change_requests
        SET status = 'REJECTED',
            reviewed_by = $1,
            reviewed_at = CURRENT_TIMESTAMP,
            review_note = $2
        WHERE id = $3 AND store_id = $4
      `, [Number(req.user.id), reviewNote, requestId, Number(req.user.store_id)]);

      await logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'PRODUCT_CHANGE_REJECT',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} rejected product change request #${requestId}.`,
        newValue: {
          request_id: requestId,
          request_type: requestRow.request_type,
          review_note: reviewNote,
        },
      });

      res.json({ success: true, request_id: requestId });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to reject product change request' });
    }
  });

  app.delete('/api/products/:id', authenticate, authorize(['STORE_ADMIN']), checkStoreLock, async (req: any, res: any) => {
    const productId = Number(req.params.id);
    const existingProduct = (await postgresPool.query('SELECT id, name, price, stock FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL', [productId, req.user.store_id])).rows[0] || null;
    await postgresPool.query('UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND store_id = $2', [productId, req.user.store_id]);

    if (existingProduct) {
      await logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'DELETE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} deleted ${existingProduct.name || `Product #${req.params.id}`} from inventory.`,
        oldValue: existingProduct,
        newValue: { deleted: true },
      });
    }

    res.json({ success: true });
  });

  app.post('/api/import/products', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'No product rows provided for import' });
    }

    try {
      const result = await coreWriteRepository.importProducts({
        storeId: Number(req.user.store_id),
        rows,
      });
      res.json({ success: true, importedCount: result.importedCount });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to import products' });
    }
  });

  app.post('/api/import/customers', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'No customer rows provided for import' });
    }

    try {
      const result = await coreWriteRepository.importCustomers({
        storeId: Number(req.user.store_id),
        rows,
      });
      res.json({ success: true, importedCount: result.importedCount });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to import customers' });
    }
  });

  app.post('/api/import/sales', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'No sales rows provided for import' });
    }

    try {
      const result = await coreWriteRepository.importSales({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        rows,
      });
      res.json({ success: true, importedCount: result.importedCount });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to import sales' });
    }
  });

  app.get('/api/categories', authenticate, async (req: any, res: any) => {
    try {
      const categories = await coreReadRepository.listCategories(Number(req.user.store_id));
      res.json(categories);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load categories' });
    }
  });

  app.post('/api/categories', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), async (req: any, res: any) => {
    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    try {
      const category = await coreWriteRepository.createCategory({
        storeId: Number(req.user.store_id),
        name: name.trim(),
        description: description || null,
      });
      res.json({ id: Number(category?.id || 0), name: category?.name || name.trim(), description: category?.description || null });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/categories/:id', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), async (req: any, res: any) => {
    const { name, description } = req.body;
    const categoryId = Number(req.params.id);
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    try {
      const category = await coreWriteRepository.updateCategory({
        storeId: Number(req.user.store_id),
        categoryId,
        name: name.trim(),
        description: description || null,
      });
      if (!category) {
        return res.status(404).json({ error: 'Category not found' });
      }
      res.json({ success: true, category });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/categories/:id', authenticate, authorize(['STORE_ADMIN']), async (req: any, res: any) => {
    const categoryId = Number(req.params.id);
    const usage = (await postgresPool.query('SELECT COUNT(*) as count FROM products WHERE store_id = $1 AND category_id = $2', [req.user.store_id, categoryId])).rows[0] as { count: string } | undefined;
    if (Number(usage?.count ?? 0) > 0) {
      return res.status(400).json({ error: 'Category is in use by products and cannot be deleted' });
    }
    await coreWriteRepository.deleteCategory({ categoryId, storeId: Number(req.user.store_id) });
    res.json({ success: true });
  });

  app.get('/api/admin/inventory/deleted', authenticate, authorize(['SYSTEM_ADMIN']), async (_req: any, res: any) => {
    try {
      const products = await coreReadRepository.listDeletedProducts();
      res.json(products.map((p: any) => ({
        ...p,
        specs: p.specs ? safeJsonParse(p.specs, {}) : {},
        condition_matrix: p.condition_matrix ? safeJsonParse(p.condition_matrix, null) : null,
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load deleted inventory' });
    }
  });

  app.post('/api/admin/inventory/restore/:id', authenticate, authorize(['SYSTEM_ADMIN']), async (req: any, res: any) => {
    const productId = Number(req.params.id);
    await coreWriteRepository.restoreDeletedProduct({ productId });
    res.json({ success: true });
  });

  app.post('/api/pos/hold', authenticate, checkStoreLock, async (req: any, res: any) => {
    const { customer_name, note, cart_data } = req.body;
    const hold = await coreWriteRepository.createActiveHold({
      storeId: Number(req.user.store_id),
      userId: Number(req.user.id),
      staffName: req.user.username,
      customerName: customer_name || null,
      note: note || null,
      cartData: cart_data,
    });
    res.json({ id: Number(hold?.id || 0) });
  });

  app.get('/api/pos/holds', authenticate, checkStoreLock, async (req: any, res: any) => {
    try {
      const holds = await coreReadRepository.listActiveHolds(Number(req.user.store_id));
      res.json(holds.map((h: any) => ({ ...h, cart_data: safeJsonParse(h.cart_data, []) })));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load held carts' });
    }
  });

  app.delete('/api/pos/holds/:id', authenticate, checkStoreLock, async (req: any, res: any) => {
    const holdId = Number(req.params.id);
    await coreWriteRepository.deleteActiveHold({ holdId, storeId: Number(req.user.store_id) });
    res.json({ success: true });
  });

  app.delete('/api/admin/holds/clear', authenticate, authorize(['SYSTEM_ADMIN']), async (_req: any, res: any) => {
    await coreWriteRepository.clearActiveHolds();
    res.json({ success: true });
  });
};

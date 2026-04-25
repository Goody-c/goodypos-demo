import type { Express } from 'express';
import type { Pool } from 'pg';

type CatalogInventoryRouteDependencies = {
  app: Express;
  postgresPool: Pool;
  authenticate: any;
  authorize: (roles: string[]) => any;
  checkStoreLock: any;
  coreReadRepository: any;
  coreWriteRepository: any;
  findStoreById: (storeId: unknown) => Promise<any>;
  safeJsonParse: (value: any, fallback: any) => any;
  normalizeStoreDiscountCodes: (value: unknown) => any[];
  normalizeStaffAnnouncement: (store: any) => { text: string; active: boolean; updated_at: string | null };
  normalizeStoreSignatureImage: (value: unknown) => string | null;
  clampChatCleanupReminderDay: (value: unknown) => number;
  clampChatRetentionValue: (value: unknown) => number;
  normalizeChatRetentionUnit: (value: unknown) => string;
  isChatCleanupReminderDue: (store: any) => boolean;
  formatStockAdjustmentEntry: (row: any) => any;
  normalizeRecountStatus: (value: unknown) => string;
  getAuditActorLabel: (role: unknown) => string;
  logAuditEvent: (entry: any) => Promise<void>;
  formatAuditCurrency: (value: unknown) => string;
  normalizeProductBarcode: (value: unknown) => string;
  generateUniqueBarcode: (storeId: unknown) => Promise<string | null>;
  generateUniqueQuickCode: () => Promise<string | null>;
  reconcileInventoryBatchQuantity: (options: any) => Promise<void>;
  getProductTotalStock: (product: any) => number;
};

export const registerCatalogInventoryRoutes = ({
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
  formatStockAdjustmentEntry,
  normalizeRecountStatus,
  getAuditActorLabel,
  logAuditEvent,
  formatAuditCurrency,
  normalizeProductBarcode,
  generateUniqueBarcode,
  generateUniqueQuickCode,
  reconcileInventoryBatchQuantity,
  getProductTotalStock,
}: CatalogInventoryRouteDependencies) => {
  app.get('/api/products/reservation-check', authenticate, async (req: any, res: any) => {
    const storeId = req.user.store_id;
    const { product_id, quantity } = req.query;
    const now = new Date().toISOString();

    if (!product_id || !quantity) {
      return res.status(400).json({ error: 'Product ID and quantity required' });
    }

    try {
      const product = (await postgresPool.query('SELECT * FROM products WHERE id = $1 AND store_id = $2', [product_id, storeId])).rows[0] || null;
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }

      const store = await findStoreById(storeId);
      const productWithMode = { ...product, mode: product?.mode || store?.mode || null };

      const activeProformas = (await postgresPool.query(`
        SELECT * FROM pro_formas
        WHERE store_id = $1 AND expiry_date > $2 AND status = 'PENDING'
      `, [storeId, now])).rows;

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

      const formattedProducts = products.map((p: any) => {
        const onCollectionQuantity = onCollectionMap.get(Number(p.id)) || 0;
        const parsedConditionMatrix = typeof p.condition_matrix === 'string'
          ? safeJsonParse(p.condition_matrix, null)
          : (p.condition_matrix || null);
        const sanitizedConditionMatrix = !canViewCostFields && parsedConditionMatrix
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
      const rows: any[] = await coreReadRepository.listStockAdjustments({
        storeId: Number(req.user.store_id),
        search: typeof req.query.search === 'string' ? req.query.search.trim() : '',
        typeFilter: typeof req.query.type === 'string' ? req.query.type.trim() : '',
        productIdFilter: Number(req.query.productId),
      });

      res.json(rows.map((row) => formatStockAdjustmentEntry(row)));
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

      await logAuditEvent({
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

      await logAuditEvent({
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

      await logAuditEvent({
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

  app.post('/api/products', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
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

    let normalizedConditionMatrix = condition_matrix || null;
    if (condition_matrix) {
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

    const existingMatrix = safeJsonParse(existingProduct.condition_matrix, {});
    let normalizedConditionMatrix = condition_matrix || null;
    if (condition_matrix) {
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
};

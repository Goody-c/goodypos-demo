import type { Express } from 'express';
import type { Pool } from 'pg';

type OperationsRouteDependencies = {
  app: Express;
  postgresPool: Pool;
  authenticate: any;
  authorize: (roles: string[]) => any;
  checkStoreLock: any;
  coreReadRepository: any;
  coreWriteRepository: any;
  normalizePhone: (value: unknown) => string;
  safeJsonParse: (value: any, fallback: any) => any;
  resolveTrackedCost: (options: any) => any;
  normalizeCollectionCondition: (value: unknown) => string | null;
  normalizeSaleChannel: (value: unknown) => string;
  normalizePaymentFrequency: (value: unknown) => string;
  getTotalPaidFromPaymentMethods: (paymentMethods: any) => number;
  buildLayawayPaymentPlan: (options: any) => any;
  formatSaleResponse: (sale: any) => Promise<any>;
  formatMarketCollection: (entry: any) => any;
  formatRepairTicket: (entry: any) => any;
  formatInventoryBatch: (entry: any) => any;
  formatPurchaseOrder: (entry: any) => any;
  normalizeBatchCode: (value: unknown) => string | null;
  normalizeBatchExpiryDate: (value: unknown) => string | null;
  generateUniqueRepairTicketNumber: (storeId: number, maxAttempts?: number) => Promise<string | null>;
  generateUniquePurchaseOrderNumber: (storeId: number, maxAttempts?: number) => Promise<string | null>;
  getAuditActorLabel: (role: unknown) => string;
  logAuditEvent: (entry: any) => Promise<void>;
  logSystemActivity: (entry: any) => Promise<void>;
  formatAuditCurrency: (value: unknown) => string;
  collectUnusedMediaCleanupStats: () => Promise<{ scannedFiles: number; deletedFiles: number; deletedBytes: number }>;
  createSafetySnapshot: (reason?: string) => Promise<any>;
};

export const registerOperationsRoutes = ({
  app,
  postgresPool,
  authenticate,
  authorize,
  checkStoreLock,
  coreReadRepository,
  coreWriteRepository,
  normalizePhone,
  safeJsonParse,
  resolveTrackedCost,
  normalizeCollectionCondition,
  normalizeSaleChannel,
  normalizePaymentFrequency,
  getTotalPaidFromPaymentMethods,
  buildLayawayPaymentPlan,
  formatSaleResponse,
  formatMarketCollection,
  formatRepairTicket,
  formatInventoryBatch,
  formatPurchaseOrder,
  normalizeBatchCode,
  normalizeBatchExpiryDate,
  generateUniqueRepairTicketNumber,
  generateUniquePurchaseOrderNumber,
  getAuditActorLabel,
  logAuditEvent,
  logSystemActivity,
  formatAuditCurrency,
  collectUnusedMediaCleanupStats,
  createSafetySnapshot,
}: OperationsRouteDependencies) => {
  const normalizeStoredPhone = (value: unknown) => {
    const raw = String(value ?? '').trim();
    const digits = normalizePhone(raw);
    return raw.startsWith('+') && digits ? `+${digits}` : digits;
  };

  app.post('/api/pro-formas', authenticate, async (req: any, res: any) => {
    const {
      customer_id,
      customer_name,
      customer_phone,
      customer_address,
      items,
      subtotal,
      tax_amount,
      tax_percentage,
      total,
      expiry_hours,
      expiry_date: req_expiry_date,
    } = req.body;
    const store_id = req.user.store_id;

    if (!items || !total || (!expiry_hours && !req_expiry_date)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const parsedExpiryHours = Number(expiry_hours);
    if (!req_expiry_date && (!Number.isFinite(parsedExpiryHours) || parsedExpiryHours <= 0)) {
      return res.status(400).json({ error: 'expiry_hours must be a positive number' });
    }

    const expiry_date = req_expiry_date || new Date(Date.now() + parsedExpiryHours * 60 * 60 * 1000).toISOString();

    try {
      const normalizedTaxAmount = Math.max(0, Number(tax_amount) || 0);
      const normalizedSubtotal = typeof subtotal === 'number' && subtotal >= 0 ? subtotal : Math.max(0, Number(total) - normalizedTaxAmount);
      const normalizedTaxPercentage = Math.min(100, Math.max(0, Number(tax_percentage) || 0));

      const result = await postgresPool.query(`
        INSERT INTO pro_formas (store_id, customer_id, customer_name, customer_phone, customer_address, items, subtotal, tax_amount, tax_percentage, total, expiry_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        store_id,
        customer_id || null,
        customer_name || null,
        normalizeStoredPhone(customer_phone) || null,
        customer_address || null,
        JSON.stringify(items),
        normalizedSubtotal,
        normalizedTaxAmount,
        normalizedTaxPercentage,
        total,
        expiry_date,
      ]);

      const proFormaId = Number(result.rows[0]?.id || 0);

      res.json({ success: true, id: proFormaId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/pro-formas', authenticate, async (req: any, res: any) => {
    const store_id = Number(req.user.store_id);

    try {
      const proformas = await coreReadRepository.listProformas(store_id);

      res.json(proformas.map((p: any) => ({
        ...p,
        customer_name: p.customer_name || p.linked_customer_name || 'Walk-in Customer',
        customer_phone: p.customer_phone || p.linked_customer_phone || '',
        customer_address: p.customer_address || p.linked_customer_address || '',
        items: JSON.parse(String(p.items || '[]')),
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/pro-formas/:id/status', authenticate, async (req: any, res: any) => {
    const store_id = req.user.store_id;
    const { status } = req.body;
    const proFormaId = Number(req.params.id);
    const VALID_PRO_FORMA_STATUSES = ['PENDING', 'COMPLETED', 'EXPIRED', 'CANCELLED'];

    if (!Number.isInteger(proFormaId) || proFormaId <= 0) {
      return res.status(400).json({ error: 'Invalid pro-forma id' });
    }

    if (!status || !VALID_PRO_FORMA_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_PRO_FORMA_STATUSES.join(', ')}` });
    }

    try {
      await postgresPool.query(`
        UPDATE pro_formas
        SET status = $1
        WHERE id = $2 AND store_id = $3
      `, [status, proFormaId, store_id]);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/pro-formas/:id', authenticate, async (req: any, res: any) => {
    const store_id = req.user.store_id;
    const proFormaId = Number(req.params.id);

    if (!Number.isInteger(proFormaId) || proFormaId <= 0) {
      return res.status(400).json({ error: 'Invalid pro-forma id' });
    }

    try {
      await coreWriteRepository.deleteProForma({
        proFormaId,
        storeId: Number(store_id),
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/pro-formas/active', authenticate, async (req: any, res: any) => {
    const store_id = req.user.store_id;
    const now = new Date().toISOString();

    try {
      const activeProformas = (await postgresPool.query(`
        SELECT p.*, c.name as linked_customer_name, c.phone as linked_customer_phone, c.address as linked_customer_address
        FROM pro_formas p
        LEFT JOIN customers c ON p.customer_id = c.id
        WHERE p.store_id = $1 AND p.expiry_date > $2
      `, [store_id, now])).rows as any[];

      res.json(activeProformas.map((p) => ({
        ...p,
        customer_name: p.customer_name || p.linked_customer_name || 'Walk-in Customer',
        customer_phone: p.customer_phone || p.linked_customer_phone || '',
        customer_address: p.customer_address || p.linked_customer_address || '',
        items: JSON.parse(p.items),
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/market-collections', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);

    try {
      const rows = await coreReadRepository.listMarketCollections({ storeId });
      res.json(rows.map((row: any) => formatMarketCollection(row)));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load market collections' });
    }
  });

  app.post('/api/market-collections', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const collectorName = String(req.body?.collector_name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const expectedReturnDate = String(req.body?.expected_return_date || '').trim();
    const note = String(req.body?.note || '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (collectorName.length < 2) {
      return res.status(400).json({ error: 'Collector name is required' });
    }
    if (phone.length < 7) {
      return res.status(400).json({ error: 'Collector phone number is required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedReturnDate)) {
      return res.status(400).json({ error: 'Expected return/payment date is required' });
    }
    if (!items.length) {
      return res.status(400).json({ error: 'Select at least one inventory item for this collection' });
    }

    try {
      const storeSettings = (await postgresPool.query('SELECT default_missing_cost_to_price FROM stores WHERE id = $1', [storeId])).rows[0] as any;
      const allowCostFallback = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;

      const normalizedItems = [] as any[];
      for (const [index, rawItem] of items.entries()) {
        const quantity = Math.max(0, Number(rawItem?.quantity) || 0);
        const consignmentItemId = Number(rawItem?.consignment_item_id) || 0;

        if (consignmentItemId > 0) {
          // ── Consignment vendor item path ──
          const ci = (await postgresPool.query(
            `SELECT * FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1`,
            [consignmentItemId, storeId],
          )).rows[0] as any;

          if (!ci) throw new Error(`Consignment item #${index + 1} not found.`);
          if (!['approved', 'available'].includes(String(ci.status || '').toLowerCase())) {
            throw new Error(`${ci.item_name} is not available for collection (status: ${ci.status}).`);
          }
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Enter a valid quantity for ${ci.item_name}.`);

          const ciPublicSpecs = safeJsonParse(typeof ci.public_specs === 'string' ? ci.public_specs : JSON.stringify(ci.public_specs || {}), {});
          const ciMatrix = ciPublicSpecs?.__condition_matrix;
          const ciHasMatrix = ciMatrix && typeof ciMatrix === 'object' && Object.keys(ciMatrix).length > 0;
          const ciCondition = normalizeCollectionCondition(rawItem?.condition);
          const ciConditionKey = String(ciCondition || '').toLowerCase();

          let availableQty: number;
          let unitPrice: number;
          let unitPayout: number;

          if (ciHasMatrix && ciConditionKey && ciMatrix?.[ciConditionKey]) {
            availableQty = Number(ciMatrix[ciConditionKey]?.stock || 0);
            unitPrice = Number(ciMatrix[ciConditionKey]?.price || ci.selling_price || 0);
            unitPayout = Number(ciMatrix[ciConditionKey]?.payout || ci.agreed_payout || 0);
          } else {
            availableQty = Number(ci.quantity || 0);
            unitPrice = Number(ci.selling_price || 0);
            unitPayout = Number(ci.agreed_payout || 0);
          }

          if (quantity > availableQty) throw new Error(`Only ${availableQty} unit(s) of ${ci.item_name} available.`);

          normalizedItems.push({
            consignment_item_id: consignmentItemId,
            product_id: null,
            name: String(ci.item_name || `Item ${index + 1}`),
            quantity,
            condition: ciHasMatrix ? ciCondition : null,
            price_at_collection: unitPrice,
            cost_at_collection: unitPayout,
            subtotal: Number((unitPrice * quantity).toFixed(2)),
            category: 'Consignment',
            specs_at_collection: {},
            vendor_name: ci.vendor_name || null,
          });
        } else {
          // ── Regular inventory item path ──
          const productId = Number(rawItem?.product_id);
          const product = (await postgresPool.query(`
            SELECT p.*, COALESCE(c.name, p.category, 'General') as category_name
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = $1 AND p.store_id = $2 AND p.deleted_at IS NULL
            LIMIT 1
          `, [productId, storeId])).rows[0] as any;

          if (!product) throw new Error(`Selected item #${index + 1} is no longer available in inventory.`);
          if (!Number.isInteger(quantity) || quantity <= 0) throw new Error(`Enter a valid quantity for ${product.name}.`);

          const normalizedCondition = normalizeCollectionCondition(rawItem?.condition);
          let availableStock = Number(product.stock || 0);
          let unitPrice = Number(product.price || 0);

          if (product.condition_matrix) {
            const matrix = safeJsonParse(product.condition_matrix, {});
            const conditionKey = String(normalizedCondition || '').toLowerCase();
            if (!conditionKey || !matrix?.[conditionKey]) throw new Error(`Choose a valid condition for ${product.name}.`);
            availableStock = Number(matrix?.[conditionKey]?.stock || 0);
            unitPrice = Number(matrix?.[conditionKey]?.price || product.price || 0);
          }

          if (quantity > availableStock) throw new Error(`Only ${availableStock} unit(s) of ${product.name} are available right now.`);

          const resolvedCost = resolveTrackedCost({ product, condition: normalizedCondition, sellingPrice: unitPrice, fallbackToSelling: allowCostFallback });

          normalizedItems.push({
            product_id: productId,
            consignment_item_id: null,
            name: String(product.name || `Item ${index + 1}`),
            quantity,
            condition: normalizedCondition,
            price_at_collection: unitPrice,
            cost_at_collection: Number(resolvedCost.cost || 0),
            subtotal: Number((unitPrice * quantity).toFixed(2)),
            category: product.category_name || 'General',
            specs_at_collection: safeJsonParse(product.specs, {}),
          });
        }
      }

      const createdCollection = await coreWriteRepository.createMarketCollection({
        storeId,
        collectorName,
        phone,
        expectedReturnDate,
        note: note || null,
        createdBy: Number(req.user.id),
        items: normalizedItems,
      });

      res.json({ success: true, collection: formatMarketCollection(createdCollection) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to save market collection' });
    }
  });

  app.post('/api/market-collections/:id/mark-sold', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const collectionId = Number(req.params.id);

    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      return res.status(400).json({ error: 'Invalid collection id' });
    }

    try {
      const collection = (await postgresPool.query('SELECT * FROM market_collections WHERE id = $1 AND store_id = $2 LIMIT 1', [collectionId, storeId])).rows[0] as any;
      if (!collection) {
        return res.status(404).json({ error: 'Collection entry not found' });
      }
      if (String(collection.status || '').toUpperCase() !== 'OPEN') {
        return res.status(400).json({ error: 'Only open collections can be marked as sold' });
      }

      const formattedCollection = formatMarketCollection(collection);
      const saleSubtotal = Number(formattedCollection.total_value || 0);
      if (saleSubtotal <= 0) {
        return res.status(400).json({ error: 'This collection has no billable items to convert into a sale' });
      }

      const soldResult = await coreWriteRepository.markMarketCollectionSold({
        storeId,
        collectionId,
        soldBy: Number(req.user.id),
        collection: formattedCollection,
      });

      res.json({ success: true, saleId: soldResult.saleId, collection: formatMarketCollection(soldResult.updatedCollection) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to mark collection as sold' });
    }
  });

  app.post('/api/market-collections/:id/return', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const collectionId = Number(req.params.id);

    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      return res.status(400).json({ error: 'Invalid collection id' });
    }

    try {
      const collection = (await postgresPool.query('SELECT * FROM market_collections WHERE id = $1 AND store_id = $2 LIMIT 1', [collectionId, storeId])).rows[0] as any;
      if (!collection) {
        return res.status(404).json({ error: 'Collection entry not found' });
      }
      if (String(collection.status || '').toUpperCase() !== 'OPEN') {
        return res.status(400).json({ error: 'Only open collections can be returned to inventory' });
      }

      const formattedCollection = formatMarketCollection(collection);
      const updatedCollection = await coreWriteRepository.returnMarketCollection({
        storeId,
        collectionId,
        collection: formattedCollection,
      });

      res.json({ success: true, collection: formatMarketCollection(updatedCollection) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to return collection items to inventory' });
    }
  });

  app.get('/api/repairs', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);

    try {
      const rows = await coreReadRepository.listRepairTickets(storeId);
      res.json(rows.map((row: any) => formatRepairTicket(row)));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load repair tickets' });
    }
  });

  app.post('/api/repairs', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const customerName = String(req.body?.customer_name || '').trim();
    const customerPhone = normalizeStoredPhone(req.body?.customer_phone || '');
    const deviceName = String(req.body?.device_name || '').trim();
    const brand = String(req.body?.brand || '').trim();
    const model = String(req.body?.model || '').trim();
    const imeiSerial = String(req.body?.imei_serial || '').trim();
    const issueSummary = String(req.body?.issue_summary || '').trim();
    const accessories = String(req.body?.accessories || '').trim();
    const purchaseReference = String(req.body?.purchase_reference || '').trim();
    const technicianName = String(req.body?.technician_name || '').trim();
    const intakeNotes = String(req.body?.intake_notes || '').trim();
    const internalNotes = String(req.body?.internal_notes || '').trim();
    const promisedDate = String(req.body?.promised_date || '').trim();
    const estimatedCost = Math.max(0, Number(req.body?.estimated_cost || 0) || 0);
    const warrantyStatus = String(req.body?.warranty_status || 'NO_WARRANTY').trim().toUpperCase();
    const allowedWarrantyStatuses = ['IN_WARRANTY', 'OUT_OF_WARRANTY', 'NO_WARRANTY'];

    if (customerName.length < 2) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    if (deviceName.length < 2) {
      return res.status(400).json({ error: 'Device name is required' });
    }
    if (issueSummary.length < 3) {
      return res.status(400).json({ error: 'Describe the issue before saving this repair ticket' });
    }
    if (promisedDate && !/^\d{4}-\d{2}-\d{2}$/.test(promisedDate)) {
      return res.status(400).json({ error: 'Promised date must use YYYY-MM-DD format' });
    }
    if (!allowedWarrantyStatuses.includes(warrantyStatus)) {
      return res.status(400).json({ error: 'Invalid warranty status selected' });
    }

    try {
      const ticketNumber = await generateUniqueRepairTicketNumber(storeId);
      if (!ticketNumber) {
        return res.status(500).json({ error: 'Failed to generate a repair ticket number' });
      }

      const result = await postgresPool.query(`
        INSERT INTO repair_tickets (
          store_id, ticket_number, customer_name, customer_phone, device_name, brand, model,
          imei_serial, issue_summary, accessories, purchase_reference, warranty_status,
          technician_name, intake_notes, internal_notes, estimated_cost, final_cost,
          amount_paid, status, promised_date, created_by, updated_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 0, 0, 'RECEIVED', $17, $18, $19, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        storeId,
        ticketNumber,
        customerName,
        customerPhone || null,
        deviceName,
        brand || null,
        model || null,
        imeiSerial || null,
        issueSummary,
        accessories || null,
        purchaseReference || null,
        warrantyStatus,
        technicianName || null,
        intakeNotes || null,
        internalNotes || null,
        estimatedCost,
        promisedDate || null,
        req.user.id,
        req.user.id,
      ]);

      const repairTicketId = Number(result.rows[0]?.id || 0);
      if (typeof coreWriteRepository?.mirrorRepairTicketRecord === 'function') {
        await coreWriteRepository.mirrorRepairTicketRecord({ repairTicketId });
      }

      await logAuditEvent({
        storeId,
        userId: req.user.id,
        userName: req.user.username,
        actionType: 'REPAIR_UPDATE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} created repair ticket ${ticketNumber} for ${customerName} (${deviceName}).`,
        newValue: { ticketNumber, customerName, deviceName, status: 'RECEIVED' },
      });

      const created = (await postgresPool.query(`
        SELECT rt.*, creator.username as created_by_username, updater.username as updated_by_username
        FROM repair_tickets rt
        LEFT JOIN users creator ON rt.created_by = creator.id
        LEFT JOIN users updater ON rt.updated_by = updater.id
        WHERE rt.id = $1 AND rt.store_id = $2
      `, [repairTicketId, storeId])).rows[0] as any;

      res.json({ success: true, ticket: formatRepairTicket(created) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create repair ticket' });
    }
  });

  app.patch('/api/repairs/:id', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const repairId = Number(req.params.id);

    if (!Number.isInteger(repairId) || repairId <= 0) {
      return res.status(400).json({ error: 'Invalid repair ticket id' });
    }

    try {
      const existing = (await postgresPool.query('SELECT * FROM repair_tickets WHERE id = $1 AND store_id = $2 LIMIT 1', [repairId, storeId])).rows[0] as any;
      if (!existing) {
        return res.status(404).json({ error: 'Repair ticket not found' });
      }

      const allowedStatuses = ['RECEIVED', 'DIAGNOSING', 'AWAITING_PARTS', 'IN_REPAIR', 'READY', 'DELIVERED', 'CANCELLED'];
      const nextStatus = req.body?.status ? String(req.body.status).trim().toUpperCase() : String(existing.status || 'RECEIVED').toUpperCase();
      if (!allowedStatuses.includes(nextStatus)) {
        return res.status(400).json({ error: 'Invalid repair status' });
      }

      const technicianName = req.body?.technician_name != null ? String(req.body.technician_name || '').trim() : String(existing.technician_name || '').trim();
      const internalNotes = req.body?.internal_notes != null ? String(req.body.internal_notes || '').trim() : String(existing.internal_notes || '').trim();
      const issueSummary = req.body?.issue_summary != null ? String(req.body.issue_summary || '').trim() : String(existing.issue_summary || '').trim();
      const estimatedCost = req.body?.estimated_cost != null ? Math.max(0, Number(req.body.estimated_cost || 0) || 0) : Math.max(0, Number(existing.estimated_cost || 0) || 0);
      const finalCost = req.body?.final_cost != null ? Math.max(0, Number(req.body.final_cost || 0) || 0) : Math.max(0, Number(existing.final_cost || 0) || 0);
      const amountPaid = req.body?.amount_paid != null ? Math.max(0, Number(req.body.amount_paid || 0) || 0) : Math.max(0, Number(existing.amount_paid || 0) || 0);

      await postgresPool.query(`
        UPDATE repair_tickets
        SET status = $1, technician_name = $2, internal_notes = $3, issue_summary = $4, estimated_cost = $5, final_cost = $6, amount_paid = $7,
            updated_by = $8, updated_at = CURRENT_TIMESTAMP,
            completed_at = CASE WHEN $9 IN ('DELIVERED', 'CANCELLED') THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END
        WHERE id = $10 AND store_id = $11
      `, [
        nextStatus,
        technicianName || null,
        internalNotes || null,
        issueSummary || String(existing.issue_summary || '').trim(),
        estimatedCost,
        finalCost,
        amountPaid,
        req.user.id,
        nextStatus,
        repairId,
        storeId,
      ]);

      if (typeof coreWriteRepository?.mirrorRepairTicketRecord === 'function') {
        await coreWriteRepository.mirrorRepairTicketRecord({ repairTicketId: repairId });
      }

      await logAuditEvent({
        storeId,
        userId: req.user.id,
        userName: req.user.username,
        actionType: 'REPAIR_UPDATE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} updated repair ticket ${existing.ticket_number || `#${repairId}`} to ${nextStatus}.`,
        oldValue: { status: existing.status, technician_name: existing.technician_name, final_cost: existing.final_cost, amount_paid: existing.amount_paid },
        newValue: { status: nextStatus, technician_name: technicianName, final_cost: finalCost, amount_paid: amountPaid },
      });

      const updated = (await postgresPool.query(`
        SELECT rt.*, creator.username as created_by_username, updater.username as updated_by_username
        FROM repair_tickets rt
        LEFT JOIN users creator ON rt.created_by = creator.id
        LEFT JOIN users updater ON rt.updated_by = updater.id
        WHERE rt.id = $1 AND rt.store_id = $2
      `, [repairId, storeId])).rows[0] as any;

      res.json({ success: true, ticket: formatRepairTicket(updated) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to update repair ticket' });
    }
  });

  app.get('/api/layaways', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);

    try {
      const rows = await coreReadRepository.listLayawayPlans(storeId);
      const plans = await Promise.all(rows.map(async (row: any) => {
        const formatted = await formatSaleResponse(row);
        return {
          ...formatted,
          items: await coreReadRepository.getSaleItemsForInvoice(Number(row.id)),
        };
      }));

      res.json({
        plans,
        summary: {
          activeCount: plans.filter((entry: any) => String(entry.status || '').toUpperCase() === 'PENDING').length,
          overdueCount: plans.filter((entry: any) => Boolean(entry.is_due_overdue)).length,
          lockedCount: plans.filter((entry: any) => Boolean(entry.locked_until_paid)).length,
          outstandingBalance: plans.reduce((sum: number, entry: any) => sum + (Number(entry.amount_due || 0) || 0), 0),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load layaway plans' });
    }
  });

  app.post('/api/layaways', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const saleChannel = normalizeSaleChannel(req.body?.sale_channel || 'LAYAWAY');
    const dueDate = String(req.body?.due_date || '').trim();
    const note = String(req.body?.note || '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const installmentCount = Math.max(1, Math.min(24, Number(req.body?.installment_count) || 1));
    const paymentFrequency = normalizePaymentFrequency(req.body?.payment_frequency);
    const customerName = String(req.body?.customer_name || '').trim();
    const customerPhoneDigits = normalizePhone(req.body?.customer_phone);
    const customerPhone = normalizeStoredPhone(req.body?.customer_phone);
    const customerAddress = String(req.body?.customer_address || '').trim();
    const requestedCustomerId = Number(req.body?.customer_id) || null;
    const paymentMethods = {
      cash: Math.max(0, Number(req.body?.payment_methods?.cash) || 0),
      transfer: Math.max(0, Number(req.body?.payment_methods?.transfer) || 0),
      pos: Math.max(0, Number(req.body?.payment_methods?.pos) || 0),
    };

    if (!['LAYAWAY', 'INSTALLMENT'].includes(saleChannel)) {
      return res.status(400).json({ error: 'Choose either Layaway or Installment for this payment plan.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return res.status(400).json({ error: 'A valid first due date is required.' });
    }
    if (!items.length) {
      return res.status(400).json({ error: 'Add at least one inventory item to this plan.' });
    }
    if (!requestedCustomerId && customerName.length < 2) {
      return res.status(400).json({ error: 'Customer name is required for layaway plans.' });
    }
    if (!requestedCustomerId && customerPhoneDigits.length < 7) {
      return res.status(400).json({ error: 'Customer phone number is required for payment reminders.' });
    }

    try {
      const storeSettings = (await postgresPool.query('SELECT default_missing_cost_to_price FROM stores WHERE id = $1', [storeId])).rows[0] as any;
      const allowCostFallback = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;

      const normalizedItems = [] as any[];
      for (const [index, rawItem] of items.entries()) {
        const productId = Number(rawItem?.product_id);
        const quantity = Math.max(1, Number(rawItem?.quantity) || 1);
        const product = (await postgresPool.query(`
          SELECT p.*, COALESCE(c.name, p.category, 'General') as category_name
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          WHERE p.id = $1 AND p.store_id = $2 AND p.deleted_at IS NULL
          LIMIT 1
        `, [productId, storeId])).rows[0] as any;

        if (!product) {
          throw new Error(`Selected item #${index + 1} is no longer available in inventory.`);
        }

        const condition = normalizeCollectionCondition(rawItem?.condition);
        let unitPrice = Number(product.price || 0);
        let availableStock = Number(product.stock || 0);

        if (product.condition_matrix) {
          const matrix = safeJsonParse(product.condition_matrix, {});
          const key = String(condition || '').toLowerCase();
          if (!key || !matrix?.[key]) {
            throw new Error(`Choose a valid condition for ${product.name}.`);
          }
          unitPrice = Number(matrix?.[key]?.price || product.price || 0);
          availableStock = Number(matrix?.[key]?.stock || 0);
        }

        if (quantity > availableStock) {
          throw new Error(`Only ${availableStock} unit(s) of ${product.name} are available for this plan.`);
        }

        const resolvedCost = resolveTrackedCost({
          product,
          condition,
          sellingPrice: unitPrice,
          fallbackToSelling: allowCostFallback,
        });

        normalizedItems.push({
          product_id: productId,
          quantity,
          name: String(product.name || `Item ${index + 1}`),
          condition,
          price_at_sale: Number(unitPrice || 0),
          subtotal: Number((unitPrice * quantity).toFixed(2)),
          cost_at_sale: Number(resolvedCost.cost || 0),
          specs_at_sale: safeJsonParse(product.specs, {}),
          imei_serial: String(rawItem?.imei_serial || '').trim() || null,
        });
      }

      const subtotal = Number(normalizedItems.reduce((sum: number, item: any) => sum + (Number(item.subtotal) || 0), 0).toFixed(2));
      const amountPaid = getTotalPaidFromPaymentMethods(paymentMethods);
      if (amountPaid > subtotal + 0.01) {
        return res.status(400).json({ error: 'The amount paid cannot be more than the plan total.' });
      }

      const paymentPlan = buildLayawayPaymentPlan({
        saleChannel,
        total: subtotal,
        amountPaid,
        firstDueDate: dueDate,
        installmentCount,
        paymentFrequency,
        note,
      });
      const amountDue = Math.max(0, Number((subtotal - amountPaid).toFixed(2)) || 0);
      const nextStatus = amountDue <= 0 ? 'COMPLETED' : 'PENDING';
      const nextLockedUntilPaid = amountDue > 0 ? 1 : 0;

      const saleNoteParts = [saleChannel === 'INSTALLMENT' ? 'Installment plan' : 'Layaway plan', note].filter(Boolean);
      const createdSale = await coreWriteRepository.createLayawaySale({
        storeId,
        requestedCustomerId,
        customerName,
        customerPhone,
        customerAddress: customerAddress || null,
        subtotal,
        paymentMethods,
        nextStatus,
        saleChannel,
        paymentPlan,
        nextLockedUntilPaid,
        dueDate,
        note: saleNoteParts.join(' • ') || null,
        userId: Number(req.user.id),
        items: normalizedItems,
      });

      await logAuditEvent({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'LAYAWAY_CREATE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} created ${saleChannel === 'INSTALLMENT' ? 'an installment' : 'a layaway'} plan for ${createdSale.customer_name || customerName}.`,
        newValue: {
          saleId: createdSale.id,
          saleChannel,
          dueDate,
          total: subtotal,
          amountPaid,
          amountDue,
        },
      });

      res.json({
        success: true,
        sale: {
          ...(await formatSaleResponse(createdSale)),
          items: await coreReadRepository.getSaleItemsForInvoice(Number(createdSale.id)),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create layaway plan' });
    }
  });

  app.get('/api/reminders/daily', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);

    try {
      const { pendingSales, marketCollections: marketCollectionRows } = await coreReadRepository.getDailyReminders(storeId);

      const outstandingSales = (await Promise.all(pendingSales
        .map((sale: any) => formatSaleResponse(sale))))
        .filter((sale: any) => Number(sale.amount_due || 0) > 0)
        .map((sale: any) => ({
          ...sale,
          is_overdue: sale.due_date
            ? new Date(`${String(sale.due_date).slice(0, 10)}T23:59:59`).getTime() < Date.now()
            : false,
        }));

      const marketCollections = marketCollectionRows.map((entry: any) => formatMarketCollection(entry));

      res.json({
        generatedAt: new Date().toISOString(),
        totalCount: outstandingSales.length + marketCollections.length,
        outstandingCount: outstandingSales.length,
        collectionCount: marketCollections.length,
        overdueOutstandingCount: outstandingSales.filter((sale: any) => Boolean(sale.is_overdue)).length,
        overdueCollectionCount: marketCollections.filter((entry: any) => Boolean(entry.is_overdue)).length,
        outstandingSales,
        marketCollections,
      });
    } catch (err: any) {
      console.error('Daily reminder error:', err);
      res.status(500).json({ error: err.message || 'Failed to load daily reminders' });
    }
  });

  app.get('/api/expenses', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();

    const expenses = await coreReadRepository.listExpenses(storeId, from, to);

    const totalExpenses = expenses.reduce((sum: number, entry: any) => sum + (Number(entry.amount) || 0), 0);
    const categoryBreakdown = (Object.values(
      expenses.reduce((acc: Record<string, { category: string; total: number; count: number }>, entry: any) => {
        const category = String(entry.category || 'General').trim() || 'General';
        if (!acc[category]) {
          acc[category] = { category, total: 0, count: 0 };
        }
        acc[category].total += Number(entry.amount) || 0;
        acc[category].count += 1;
        return acc;
      }, {}),
    ) as Array<{ category: string; total: number; count: number }>).sort((a, b) => b.total - a.total);

    res.json({
      expenses: expenses.map((entry: any) => ({
        ...entry,
        amount: Number(entry.amount) || 0,
        category: entry.category || 'General',
      })),
      summary: {
        totalExpenses,
        count: expenses.length,
        categoryBreakdown,
      },
    });
  });

  app.post('/api/expenses', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), checkStoreLock, async (req: any, res: any) => {
    const title = String(req.body?.title || '').trim();
    const category = String(req.body?.category || 'General').trim() || 'General';
    const amount = Number(req.body?.amount);
    const note = String(req.body?.note || '').trim() || null;
    const spentAt = String(req.body?.spent_at || new Date().toISOString()).trim();

    if (!title) {
      return res.status(400).json({ error: 'Expense title is required' });
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Expense amount must be greater than zero' });
    }

    try {
      const expense = await coreWriteRepository.createExpense({
        storeId: Number(req.user.store_id),
        title,
        category,
        amount,
        note,
        spentAt,
        createdBy: Number(req.user.id),
      });

      await logSystemActivity({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        action: 'EXPENSE_CREATE',
        details: { expenseId: Number(expense?.id || 0), amount, category },
      });

      await logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'EXPENSE_ADD',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} recorded an expense of ${formatAuditCurrency(amount)} for ${title}.`,
        newValue: {
          expenseId: Number(expense?.id || 0),
          title,
          category,
          amount,
          note,
          spent_at: spentAt,
        },
      });

      res.json({
        id: Number(expense?.id || 0),
        title: expense?.title || title,
        category: expense?.category || category,
        amount: Number(expense?.amount || amount),
        note: expense?.note ?? note,
        spent_at: expense?.spent_at || spentAt,
        created_by: Number(expense?.created_by || req.user.id),
        created_by_username: req.user.username,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to create expense' });
    }
  });

  app.delete('/api/expenses/:id', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), checkStoreLock, async (req: any, res: any) => {
    try {
      const removed = await coreWriteRepository.deleteExpense({
        expenseId: Number(req.params.id),
        storeId: Number(req.user.store_id),
      });

      if (removed.changes > 0 && removed.expense) {
        await logSystemActivity({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          action: 'EXPENSE_DELETE',
          details: { expenseId: Number(removed.expense.id), amount: Number(removed.expense.amount || 0) },
        });

        await logAuditEvent({
          storeId: Number(req.user.store_id),
          userId: Number(req.user.id),
          userName: req.user.username,
          actionType: 'DELETE',
          description: `${getAuditActorLabel(req.user.role)} ${req.user.username} deleted expense #${removed.expense.id} (${removed.expense.title || 'Expense'}).`,
          oldValue: removed.expense,
          newValue: { deleted: true },
        });
      }

      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to delete expense' });
    }
  });

  app.post('/api/system-health/optimize', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);

    try {
      await createSafetySnapshot('pre-maintenance');
      const mediaStats = await collectUnusedMediaCleanupStats();

      const databaseRecoveredBytes = 0;
      const spaceRecoveredBytes = mediaStats.deletedBytes;

      await logSystemActivity({
        storeId,
        userId: req.user.id,
        action: 'SYSTEM_OPTIMIZE',
        details: {
          databaseRecoveredBytes,
          deletedMediaFiles: mediaStats.deletedFiles,
          deletedMediaBytes: mediaStats.deletedBytes,
        },
      });

      res.json({
        success: true,
        spaceRecoveredBytes,
        spaceRecoveredMb: Number((spaceRecoveredBytes / (1024 * 1024)).toFixed(2)),
        databaseRecoveredBytes,
        media: mediaStats,
        database: null,
        message: `Optimization Complete! ${Number((spaceRecoveredBytes / (1024 * 1024)).toFixed(2))}MB of space recovered.`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to optimize the system database' });
    }
  });

  app.post('/api/system-health/clear-expired-proformas', authenticate, authorize(['STORE_ADMIN']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);

    try {
      const deletedCount = await coreWriteRepository.clearExpiredProformas({ storeId });
      await logSystemActivity({
        storeId,
        userId: req.user.id,
        action: 'CLEAR_EXPIRED_PROFORMAS',
        details: { deletedCount },
      });

      res.json({ success: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to clear expired pro-formas' });
    }
  });

  app.post('/api/system-health/clear-old-activity-logs', authenticate, authorize(['STORE_ADMIN']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);

    try {
      const deletedCount = await coreWriteRepository.clearOldActivityLogs({ storeId });
      await logSystemActivity({
        storeId,
        userId: req.user.id,
        action: 'CLEAR_OLD_ACTIVITY_LOGS',
        details: { deletedCount },
      });

      res.json({ success: true, deletedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to clear old activity logs' });
    }
  });

  app.get('/api/suppliers', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const suppliers = await coreReadRepository.listSuppliers(Number(req.user.store_id));

      res.json({
        suppliers: suppliers.map((supplier: any) => ({
          ...supplier,
          pending_orders: Number(supplier.pending_orders || 0) || 0,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load suppliers' });
    }
  });

  app.post('/api/suppliers', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim() || null;
    const email = String(req.body?.email || '').trim() || null;
    const address = String(req.body?.address || '').trim() || null;
    const note = String(req.body?.note || '').trim() || null;

    if (!name) {
      return res.status(400).json({ error: 'Supplier name is required' });
    }

    try {
      const result = await postgresPool.query(`
        INSERT INTO suppliers (store_id, name, phone, email, address, note, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        RETURNING id
      `, [req.user.store_id, name, phone, email, address, note]);

      const supplierId = Number(result.rows[0]?.id || 0);

      const supplier = (await postgresPool.query('SELECT * FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1', [supplierId, req.user.store_id])).rows[0] as any;
      res.json({ success: true, supplier });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to save supplier' });
    }
  });

  app.get('/api/purchase-orders', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const statusFilter = String(req.query.status || '').trim().toUpperCase();
      const search = String(req.query.search || '').trim().toLowerCase();
      const rows = await coreReadRepository.listPurchaseOrders(storeId, statusFilter, search);

      const orders = rows.map((row: any) => formatPurchaseOrder(row));
      const openOrders = orders.filter((order: any) => order.status === 'ORDERED');

      res.json({
        orders,
        summary: {
          openOrders: openOrders.length,
          receivedOrders: orders.filter((order: any) => order.status === 'RECEIVED').length,
          cancelledOrders: orders.filter((order: any) => order.status === 'CANCELLED').length,
          pendingUnits: openOrders.reduce((sum: number, order: any) => sum + (Number(order.total_quantity || 0) || 0), 0),
          pendingValue: openOrders.reduce((sum: number, order: any) => sum + (Number(order.subtotal || 0) || 0), 0),
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load purchase orders' });
    }
  });

  app.post('/api/purchase-orders', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const supplierId = Number(req.body?.supplier_id);
    const expectedDate = String(req.body?.expected_date || '').trim() || null;
    const note = String(req.body?.note || '').trim() || null;
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      return res.status(400).json({ error: 'Select a valid supplier before saving this order' });
    }

    if (!rawItems.length) {
      return res.status(400).json({ error: 'Add at least one product to this purchase order' });
    }

    const supplier = (await postgresPool.query('SELECT * FROM suppliers WHERE id = $1 AND store_id = $2 LIMIT 1', [supplierId, storeId])).rows[0] as any;
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    try {
      const normalizedItems = [] as any[];
      for (const [index, item] of rawItems.entries()) {
        const productId = Number(item?.product_id);
        const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
        const unitCost = Math.max(0, Number(item?.unit_cost) || 0);
        const condition = item?.condition ? normalizeCollectionCondition(item.condition) : null;
        const batchCode = normalizeBatchCode(item?.batch_code);
        const expiryDate = normalizeBatchExpiryDate(item?.expiry_date);

        if (!Number.isInteger(productId) || productId <= 0) {
          throw new Error(`Line ${index + 1}: select a valid product.`);
        }
        if (quantity <= 0) {
          throw new Error(`Line ${index + 1}: quantity must be greater than zero.`);
        }

        const product = (await postgresPool.query('SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1', [productId, storeId])).rows[0] as any;
        if (!product) {
          throw new Error(`Line ${index + 1}: product not found.`);
        }

        if (product.condition_matrix && !condition) {
          throw new Error(`Line ${index + 1}: choose a condition for ${product.name}.`);
        }

        normalizedItems.push({
          product_id: productId,
          product_name: product.name,
          quantity,
          unit_cost: unitCost,
          line_total: Number((unitCost * quantity).toFixed(2)),
          condition,
          batch_code: batchCode,
          expiry_date: expiryDate,
        });
      }

      const subtotal = normalizedItems.reduce((sum: number, item: any) => sum + (Number(item.line_total) || 0), 0);
      const orderNumber = await generateUniquePurchaseOrderNumber(storeId);

      if (!orderNumber) {
        return res.status(500).json({ error: 'Failed to generate a unique purchase order number' });
      }

      const result = await postgresPool.query(`
        INSERT INTO purchase_orders (
          store_id, supplier_id, supplier_name, order_number, status, items,
          subtotal, note, expected_date, created_by, updated_at
        ) VALUES ($1, $2, $3, $4, 'ORDERED', $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        storeId,
        supplierId,
        supplier.name,
        orderNumber,
        JSON.stringify(normalizedItems),
        subtotal,
        note,
        expectedDate,
        req.user.id,
      ]);

      const orderId = Number(result.rows[0]?.id || 0);
      const order = (await postgresPool.query(`
        SELECT po.*, COALESCE(po.supplier_name, s.name, 'Unknown Supplier') as supplier_name,
          creator.username as created_by_username,
          receiver.username as received_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users creator ON po.created_by = creator.id
        LEFT JOIN users receiver ON po.received_by = receiver.id
        WHERE po.id = $1 AND po.store_id = $2
        LIMIT 1
      `, [orderId, storeId])).rows[0] as any;

      res.json({ success: true, order: formatPurchaseOrder(order) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to save purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/receive', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const orderId = Number(req.params.id);

    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid purchase order id' });
    }

    try {
      const receivedResult = await coreWriteRepository.receivePurchaseOrder({
        storeId,
        orderId,
        receivedBy: Number(req.user.id),
      });

      res.json({ success: true, order: formatPurchaseOrder(receivedResult.orderRow) });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to receive purchase order' });
    }
  });

  app.post('/api/purchase-orders/:id/cancel', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'Invalid purchase order id' });
    }

    const order = (await postgresPool.query('SELECT * FROM purchase_orders WHERE id = $1 AND store_id = $2 LIMIT 1', [orderId, req.user.store_id])).rows[0] as any;
    if (!order) {
      return res.status(404).json({ error: 'Purchase order not found' });
    }
    if (String(order.status || '').toUpperCase() === 'RECEIVED') {
      return res.status(400).json({ error: 'Received purchase orders cannot be cancelled' });
    }

    await postgresPool.query(`
      UPDATE purchase_orders
      SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND store_id = $2
    `, [orderId, req.user.store_id]);

    res.json({ success: true });
  });

  app.get('/api/inventory/batches', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const statusFilter = String(req.query.status || 'all').trim().toLowerCase();
      const search = String(req.query.search || '').trim().toLowerCase();
      const productId = Number(req.query.product_id || req.query.productId || 0);
      const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const rows = await coreReadRepository.listInventoryBatches(storeId);

      const filtered = rows
        .map((row: any) => formatInventoryBatch(row))
        .filter((row: any) => {
          if (productId > 0 && Number(row.product_id) !== productId) return false;
          if (search) {
            const haystack = `${row.product_name || ''} ${row.batch_code || ''} ${row.supplier_name || ''} ${row.note || ''}`.toLowerCase();
            if (!haystack.includes(search)) return false;
          }
          if (statusFilter === 'expired') return row.status === 'EXPIRED';
          if (statusFilter === 'expiring') return row.status === 'EXPIRING_SOON' || row.status === 'EXPIRED' || (typeof row.days_until_expiry === 'number' && row.days_until_expiry <= days);
          if (statusFilter === 'active') return ['ACTIVE', 'EXPIRING_SOON', 'NO_EXPIRY'].includes(String(row.status));
          return true;
        });

      const paginated = filtered.slice(offset, offset + limit);

      res.json({
        batches: paginated,
        summary: {
          total: filtered.length,
          expiringSoon: filtered.filter((row: any) => row.status === 'EXPIRING_SOON').length,
          expired: filtered.filter((row: any) => row.status === 'EXPIRED').length,
          openQuantity: filtered.reduce((sum: number, row: any) => sum + (Number(row.quantity_remaining || 0) || 0), 0),
        },
        limit,
        offset,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load inventory batches' });
    }
  });
};

import fs from 'fs';
import path from 'path';
import type { Pool } from 'pg';
import { computePayableAfterReturn, logVendorPayableMutation } from './serverVendorPayableRules';

type SalesReportingRouteDependencies = {
  app: any;
  postgresPool: Pool;
  uploadsDir: string;
  authenticate: any;
  authorize: (roles: string[]) => any;
  checkStoreLock: any;
  coreReadRepository: any;
  coreWriteRepository: any;
  findStoreById: (storeId: unknown) => Promise<any>;
  safeJsonParse: (value: any, fallback: any) => any;
  normalizePhone: (value: unknown) => string;
  normalizeSaleChannel: (value: unknown) => string;
  normalizePin: (value: unknown) => string;
  resolveCheckoutActorByPin: (storeId: unknown, pin: unknown) => Promise<any>;
  getTotalPaidFromPaymentMethods: (paymentMethods: any) => number;
  getSaleReturnsMeta: (saleId: number) => Promise<any>;
  formatSaleResponse: (sale: any) => Promise<any>;
  formatSaleReturnEntry: (entry: any) => any;
  formatMarketCollection: (entry: any) => any;
  getAuditActorLabel: (role: unknown) => string;
  formatAuditCurrency: (value: unknown) => string;
  logSystemActivity: (payload: any) => Promise<void>;
  logAuditEvent: (payload: any) => Promise<void>;
  HIGH_RISK_AUDIT_ACTIONS: string[];
  toFiniteNumberOrNull: (value: any) => number | null;
  resolveTrackedCost: (options: any) => { cost: number | null; missing: boolean; usedSellingDefault: boolean; sellingPrice: number };
  getMissingCostPriceLabels: (options: any) => { primaryLabel: string; allConditionsLabel: string | null };
  getProductTotalStock: (product: any) => number;
};

export const registerSalesReportingRoutes = ({
  app,
  postgresPool,
  uploadsDir,
  authenticate,
  authorize,
  checkStoreLock,
  coreReadRepository,
  coreWriteRepository,
  findStoreById,
  safeJsonParse,
  normalizePhone,
  normalizeSaleChannel,
  normalizePin,
  resolveCheckoutActorByPin,
  getTotalPaidFromPaymentMethods,
  getSaleReturnsMeta,
  formatSaleResponse,
  formatSaleReturnEntry,
  formatMarketCollection,
  getAuditActorLabel,
  formatAuditCurrency,
  logSystemActivity,
  logAuditEvent,
  HIGH_RISK_AUDIT_ACTIONS,
  toFiniteNumberOrNull,
  resolveTrackedCost,
  getMissingCostPriceLabels,
  getProductTotalStock,
}: SalesReportingRouteDependencies) => {
  const normalizeStoredPhone = (value: unknown) => {
    const raw = String(value ?? '').trim();
    const digits = normalizePhone(raw);
    return raw.startsWith('+') && digits ? `+${digits}` : digits;
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

  const resolveRetentionWindow = (modeRaw: unknown, fromRaw: unknown, toRaw: unknown) => {
    const mode = String(modeRaw || '').trim().toUpperCase();
    const customFrom = String(fromRaw || '').trim();
    const customTo = String(toRaw || '').trim();

    if (mode === 'ONE_YEAR') {
      const end = new Date();
      end.setFullYear(end.getFullYear() - 1);
      end.setHours(0, 0, 0, 0);
      return {
        mode: 'ONE_YEAR' as const,
        fromIso: null,
        toIso: end.toISOString(),
        label: `Before ${end.toISOString().slice(0, 10)}`,
      };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(customTo)) {
      throw new Error('Custom retention requires valid from/to dates in YYYY-MM-DD format.');
    }

    const fromDate = new Date(`${customFrom}T00:00:00.000Z`);
    const toDateInclusive = new Date(`${customTo}T23:59:59.999Z`);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDateInclusive.getTime())) {
      throw new Error('Invalid custom retention date range.');
    }
    if (fromDate.getTime() > toDateInclusive.getTime()) {
      throw new Error('Custom retention start date must be before end date.');
    }

    return {
      mode: 'CUSTOM' as const,
      fromIso: fromDate.toISOString(),
      toIso: toDateInclusive.toISOString(),
      label: `${customFrom} to ${customTo}`,
    };
  };

  const retentionPredicate = (columnName: string, fromIso: string | null, toIso: string) => {
    if (fromIso) {
      return {
        sql: `${columnName} BETWEEN $2::timestamptz AND $3::timestamptz`,
        params: [fromIso, toIso],
      };
    }

    return {
      sql: `${columnName} < $2::timestamptz`,
      params: [toIso],
    };
  };

  const resolveRetentionStoreId = (req: any) => {
    const rawStoreId = req.user.role === 'SYSTEM_ADMIN' ? req.body?.storeId : req.user.store_id;
    const storeId = Number(rawStoreId);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new Error('Store ID required');
    }
    return storeId;
  };

  const resolveRetentionRequestContext = (req: any) => {
    const storeId = resolveRetentionStoreId(req);
    const windowRange = resolveRetentionWindow(req.body?.mode, req.body?.fromDate, req.body?.toDate);
    return { storeId, windowRange };
  };

  app.get('/api/dashboard/activity-feed', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'PROCUREMENT_OFFICER', 'STAFF']), async (req: any, res: any) => {
    const limit = Math.min(12, Math.max(4, Number(req.query.limit) || 8));

    try {
      const { saleRows, stockRows, expenseRows } = await coreReadRepository.getDashboardActivityFeed({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        role: String(req.user.role || 'STAFF'),
        limit,
      });

      const items = [
        ...saleRows.map((row: any) => ({
          id: `sale-${row.id}`,
          type: 'sale',
          title: String(row.status || '').toUpperCase() === 'PENDING' ? 'Pending sale recorded' : 'Sale completed',
          detail: `${row.customer_name || 'Walk-in Customer'} • ${row.user_username || 'Staff'}`,
          timestamp: row.timestamp,
          amount: Number(row.total || 0) || 0,
          href: '/invoices',
        })),
        ...stockRows.map((row: any) => ({
          id: `stock-${row.id}`,
          type: 'stock',
          title: `${String(row.adjustment_mode || 'UPDATE').replace(/_/g, ' ')} stock update`,
          detail: `${row.product_name || 'Product'} • ${row.user_username || 'Staff'} • ${(Number(row.quantity_change || 0) > 0 ? '+' : '')}${Number(row.quantity_change || 0)} unit(s)`,
          timestamp: row.created_at,
          amount: Math.abs(Number(row.cost_impact || 0) || 0),
          href: '/inventory',
        })),
        ...expenseRows.map((row: any) => ({
          id: `expense-${row.id}`,
          type: 'expense',
          title: 'Expense recorded',
          detail: `${row.title || 'General expense'} • ${row.user_username || 'Staff'}`,
          timestamp: row.created_at,
          amount: Number(row.amount || 0) || 0,
          href: '/expenses',
        })),
      ]
        .sort((a, b) => new Date(String(b.timestamp || 0)).getTime() - new Date(String(a.timestamp || 0)).getTime())
        .slice(0, limit);

      res.json({ items });
    } catch (err: any) {
      console.error('Dashboard activity feed error:', err);
      res.status(500).json({ error: err.message || 'Failed to load dashboard activity feed' });
    }
  });

  app.get('/api/sales/pending', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    try {
      const sales = await coreReadRepository.listPendingSales(Number(req.user.store_id));
      res.json(await Promise.all(sales.map((sale: any) => formatSaleResponse(sale))));
    } catch (err: any) {
      console.error('Pending sales read error:', err);
      res.status(500).json({ error: err.message || 'Failed to load pending sales' });
    }
  });

  const confirmPendingSaleReceipt = async (saleId: number, storeId: number) => {
    const sale = (await postgresPool.query('SELECT * FROM sales WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL', [saleId, storeId])).rows[0] as any;
    if (!sale) {
      throw new Error('Sale not found');
    }

    const formattedSale = await formatSaleResponse(sale);
    if ((formattedSale.amount_due || 0) > 0) {
      throw new Error('Outstanding balance remains. Record payment before confirming this sale.');
    }

    await postgresPool.query("UPDATE sales SET status = 'COMPLETED' WHERE id = $1 AND store_id = $2", [saleId, storeId]);
    return { ...formattedSale, status: 'COMPLETED' };
  };

  app.put('/api/sales/:id/confirm', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const saleId = Number(req.params.id);
      const confirmedSale = await confirmPendingSaleReceipt(saleId, Number(req.user.store_id));
      res.json({ success: true, sale: confirmedSale });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to confirm sale receipt' });
    }
  });

  app.post('/api/sales/:id/verify', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    try {
      const saleId = Number(req.params.id);
      const confirmedSale = await confirmPendingSaleReceipt(saleId, Number(req.user.store_id));
      res.json({ success: true, sale: confirmedSale });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to verify sale' });
    }
  });

  app.post('/api/sales/:id/settle', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const saleId = Number(req.params.id);
    const incomingPayments = req.body?.payment_methods || {};
    const note = String(req.body?.note || '').trim();
    const dueDate = String(req.body?.due_date || '').trim() || null;

    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: 'Invalid sale id' });
    }

    const sale = (await postgresPool.query('SELECT * FROM sales WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL', [saleId, req.user.store_id])).rows[0] as any;
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const existingPayments = safeJsonParse(sale.payment_methods, {});
    const nextPayments = {
      cash: Math.max(0, Number(existingPayments.cash) || 0) + Math.max(0, Number(incomingPayments.cash) || 0),
      transfer: Math.max(0, Number(existingPayments.transfer) || 0) + Math.max(0, Number(incomingPayments.transfer) || 0),
      pos: Math.max(0, Number(existingPayments.pos) || 0) + Math.max(0, Number(incomingPayments.pos) || 0),
    };

    const returnMeta = await getSaleReturnsMeta(saleId);
    const returnedAmount = Math.max(0, Number(returnMeta?.returned_amount || 0));
    const amountPaid = getTotalPaidFromPaymentMethods(nextPayments);
    const netTotal = Math.max(0, Number((Number(sale.total || 0) - returnedAmount).toFixed(2)) || 0);
    const amountDue = Math.max(0, Number((netTotal - amountPaid).toFixed(2)) || 0);
    const nextStatus = amountDue <= 0 ? 'COMPLETED' : 'PENDING';
    const mergedNote = [String(sale.note || '').trim(), note].filter(Boolean).join(' • ');
    const saleChannel = normalizeSaleChannel(sale.sale_channel);
    const nextLockedUntilPaid = saleChannel === 'STANDARD' ? 0 : (amountDue > 0 ? 1 : 0);

    await postgresPool.query(`
      UPDATE sales
      SET payment_methods = $1, status = $2, due_date = $3, note = $4, locked_until_paid = $5
      WHERE id = $6 AND store_id = $7
    `, [JSON.stringify(nextPayments), nextStatus, dueDate || sale.due_date || null, mergedNote || null, nextLockedUntilPaid, saleId, req.user.store_id]);

    const updatedSale = (await postgresPool.query(`
      SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
      FROM sales s
      LEFT JOIN users u ON s.user_id = u.id
      LEFT JOIN customers c ON s.customer_id = c.id
      WHERE s.id = $1 AND s.store_id = $2
    `, [saleId, req.user.store_id])).rows[0] as any;

    res.json({ success: true, sale: await formatSaleResponse(updatedSale) });
  });

  app.post('/api/sales', authenticate, checkStoreLock, async (req: any, res: any) => {
    const {
      subtotal,
      discount_amount,
      discount_type,
      discount_value,
      discount_note,
      show_discount_on_invoice,
      tax_amount,
      tax_percentage,
      total,
      payment_methods,
      items,
      status,
      pdf_path,
      customer_id,
      due_date,
      note,
      checkout_pin,
    } = req.body;

    if (typeof total !== 'number' || total <= 0) {
      return res.status(400).json({ error: 'Total must be a positive number' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'At least one item required' });
    }
    if (!payment_methods || (typeof payment_methods.cash !== 'number' && typeof payment_methods.transfer !== 'number' && typeof payment_methods.pos !== 'number')) {
      return res.status(400).json({ error: 'Payment methods must include at least cash, transfer, or pos amount' });
    }

    for (const item of items) {
      const isSourced = Boolean(item?.is_sourced || item?.sourced_item || item?.item_source === 'SOURCED');
      if ((!isSourced && typeof item.product_id !== 'number') || typeof item.quantity !== 'number' || item.quantity <= 0) {
        return res.status(400).json({ error: 'Invalid item: quantity is required, and product_id is required for inventory items.' });
      }
      if (typeof item.price_at_sale !== 'number' || item.price_at_sale < 0) {
        return res.status(400).json({ error: 'Invalid item price' });
      }
      if (isSourced && String(item?.name || '').trim().length < 2) {
        return res.status(400).json({ error: 'Sourced items must include a valid item name.' });
      }
      if (isSourced && String(item?.sourced_vendor_name || '').trim().length < 2) {
        return res.status(400).json({ error: 'Sourced items must include a vendor name or shop reference.' });
      }
    }

    const normalizedTaxAmount = Math.max(0, Number(tax_amount) || 0);
    const normalizedSubtotal = typeof subtotal === 'number' && subtotal >= 0 ? subtotal : Math.max(0, total - normalizedTaxAmount);
    const normalizedDiscountAmount = Math.min(normalizedSubtotal, Math.max(0, Number(discount_amount) || 0));
    const normalizedDiscountType = ['PERCENTAGE', 'FIXED'].includes(String(discount_type || '').toUpperCase()) ? String(discount_type).toUpperCase() : null;
    const normalizedDiscountValue = Math.max(0, Number(discount_value) || 0);
    const normalizedDiscountNote = String(discount_note || '').trim() || null;
    const normalizedShowDiscountOnInvoice = show_discount_on_invoice !== false;
    const normalizedTaxPercentage = Math.min(100, Math.max(0, Number(tax_percentage) || 0));
    const storeSettings = req.store || await findStoreById(req.user.store_id);

    if (!storeSettings) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const isGadgetMode = String(storeSettings.mode || '').toUpperCase() === 'GADGET';
    const pinCheckoutEnabled = isGadgetMode && Number(storeSettings?.pin_checkout_enabled ?? 1) === 1;
    const normalizedCheckoutPin = normalizePin(checkout_pin);
    let saleActor = req.user as any;

    if (pinCheckoutEnabled) {
      if (!/^\d{4,6}$/.test(normalizedCheckoutPin)) {
        return res.status(400).json({ error: 'Checkout PIN is required for Gadget Mode sales' });
      }

      const resolvedActor = await resolveCheckoutActorByPin(req.user.store_id, normalizedCheckoutPin);
      if (!resolvedActor) {
        return res.status(400).json({ error: 'Invalid checkout PIN for this store' });
      }

      saleActor = resolvedActor;
    }

    const allowCostFallback = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;

    try {
      const { saleId } = await coreWriteRepository.createSale({
        storeId: Number(req.user.store_id),
        saleActorId: Number(saleActor.id),
        subtotal: normalizedSubtotal,
        discountAmount: normalizedDiscountAmount,
        discountType: normalizedDiscountType,
        discountValue: normalizedDiscountValue,
        showDiscountOnInvoice: normalizedShowDiscountOnInvoice,
        discountNote: normalizedDiscountNote,
        taxAmount: normalizedTaxAmount,
        taxPercentage: normalizedTaxPercentage,
        total,
        paymentMethods: payment_methods,
        items,
        status: ['COMPLETED', 'PENDING'].includes(status) ? status : 'COMPLETED',
        pdfPath: pdf_path || null,
        customerId: customer_id || null,
        dueDate: due_date || null,
        note: note ? String(note).trim() : null,
        allowCostFallback,
      });

      if (normalizedDiscountAmount > 0) {
        await logAuditEvent({
          storeId: Number(req.user.store_id),
          userId: Number(saleActor.id),
          userName: saleActor.username,
          actionType: 'DISCOUNT',
          description: `${getAuditActorLabel(saleActor.role)} ${saleActor.username} gave ${formatAuditCurrency(normalizedDiscountAmount)} discount on Sale #${saleId}.`,
          oldValue: { saleId, subtotal: normalizedSubtotal },
          newValue: {
            discount_amount: normalizedDiscountAmount,
            discount_type: normalizedDiscountType,
            discount_note: normalizedDiscountNote,
            total,
          },
        });
      }

      const sourcedItems = items
        .filter((item: any) => Boolean(item?.is_sourced || item?.sourced_item || item?.item_source === 'SOURCED'))
        .map((item: any) => ({
          name: String(item?.name || '').trim() || 'Sourced Item',
          vendor: String(item?.sourced_vendor_name || '').trim() || 'Unknown Vendor',
          vendor_reference: String(item?.sourced_vendor_reference || '').trim() || null,
          vendor_cost_price: Math.max(0, Number(item?.sourced_cost_price ?? item?.cost_at_sale ?? 0) || 0),
          quantity: Math.max(1, Number(item?.quantity || 1) || 1),
          selling_price: Math.max(0, Number(item?.price_at_sale || 0) || 0),
        }));

      if (sourcedItems.length > 0) {
        const totalVendorDebt = sourcedItems.reduce((sum: number, item: any) => sum + (item.vendor_cost_price * item.quantity), 0);
        const vendorLabels = Array.from(new Set(sourcedItems.map((item: any) => String(item.vendor || '').trim()).filter(Boolean))).join(', ');
        await logAuditEvent({
          storeId: Number(req.user.store_id),
          userId: Number(saleActor.id),
          userName: saleActor.username,
          actionType: 'SOURCED_SALE',
          description: `${getAuditActorLabel(saleActor.role)} ${saleActor.username} sold ${sourcedItems.length} sourced item(s) from ${vendorLabels || 'a vendor'} with vendor debt of ${formatAuditCurrency(totalVendorDebt)}.`,
          newValue: {
            saleId,
            sourced_items: sourcedItems,
            vendor_debt_total: totalVendorDebt,
          },
        });
      }

      const markupItems = items.filter((item: any) => {
        const basePrice = Number(item.base_price_at_sale ?? item.price_at_sale ?? 0);
        const salePrice = Number(item.price_at_sale || 0);
        return salePrice > basePrice + 0.001;
      });

      if (markupItems.length > 0) {
        const totalMarkup = markupItems.reduce((sum: number, item: any) => {
          const basePrice = Number(item.base_price_at_sale ?? item.price_at_sale ?? 0);
          const salePrice = Number(item.price_at_sale || 0);
          const qty = Math.max(1, Number(item.quantity || 1));
          return sum + Math.max(0, (salePrice - basePrice) * qty);
        }, 0);
        await logAuditEvent({
          storeId: Number(req.user.store_id),
          userId: Number(saleActor.id),
          userName: saleActor.username,
          actionType: 'PRICE_MARKUP',
          description: `${getAuditActorLabel(saleActor.role)} ${saleActor.username} completed Sale #${saleId} with a price markup of ${formatAuditCurrency(totalMarkup)} across ${markupItems.length} item(s).`,
          newValue: {
            saleId,
            total_markup: totalMarkup,
            markup_items: markupItems.map((item: any) => ({
              name: String(item.name || '').trim() || 'Item',
              base_price: Number(item.base_price_at_sale ?? item.price_at_sale ?? 0),
              sale_price: Number(item.price_at_sale || 0),
              quantity: Math.max(1, Number(item.quantity || 1)),
            })),
          },
        });
      }

      res.json({
        id: saleId,
        recorded_by: {
          id: Number(saleActor.id),
          username: String(saleActor.username || req.user.username),
          role: String(saleActor.role || req.user.role),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/sales', authenticate, async (req: any, res: any) => {
    try {
      const hasPaginationQuery = req.query.limit !== undefined || req.query.offset !== undefined;
      const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const result = await coreReadRepository.listSales({
        storeId: Number(req.user.store_id),
        customerId: Number(req.query.customerId || 0),
        search: typeof req.query.search === 'string' ? req.query.search : '',
        status: typeof req.query.status === 'string' ? req.query.status : '',
        limit,
        offset,
        paginate: hasPaginationQuery,
      });

      const formattedSales = await Promise.all(result.rows.map((sale: any) => formatSaleResponse(sale)));

      if (hasPaginationQuery) {
        return res.json({
          items: formattedSales,
          total: Number(result.total || 0),
          limit: result.limit,
          offset: result.offset,
        });
      }

      res.json(formattedSales);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load sales' });
    }
  });

  app.get('/api/sales/:id/details', authenticate, async (req: any, res: any) => {
    try {
      const saleId = Number(req.params.id);
      const storeId = Number(req.user.store_id);
      const { sale, items, returns } = await coreReadRepository.getSaleDetails(storeId, saleId);

      if (!sale) {
        return res.status(404).json({ error: 'Sale not found' });
      }

      res.json({
        ...(await formatSaleResponse(sale)),
        items,
        returns: returns.map((row: any) => formatSaleReturnEntry(row)),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load sale details' });
    }
  });

  app.get('/api/returns', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), async (req: any, res: any) => {
    try {
      const rows = await coreReadRepository.listReturns({
        storeId: Number(req.user.store_id),
        search: typeof req.query.search === 'string' ? req.query.search : '',
        returnType: typeof req.query.type === 'string' ? req.query.type : '',
      });

      res.json(rows.map((row: any) => formatSaleReturnEntry(row)));
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load returns' });
    }
  });

  app.post('/api/sales/:id/returns', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const saleId = Number(req.params.id);
    const normalizedReason = String(req.body?.reason || '').trim();
    const normalizedNote = String(req.body?.note || '').trim();
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const normalizedReturnType = ['REFUND', 'EXCHANGE', 'RETURN_ONLY'].includes(String(req.body?.return_type || '').toUpperCase())
      ? String(req.body?.return_type || '').toUpperCase()
      : 'REFUND';
    const normalizedRefundMethod = ['cash', 'transfer', 'pos', 'store_credit', 'other'].includes(String(req.body?.refund_method || '').toLowerCase())
      ? String(req.body?.refund_method || '').toLowerCase()
      : 'cash';
    const normalizedRestockItems = req.body?.restock_items !== false;

    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: 'Invalid sale id' });
    }

    if (normalizedReason.length < 3) {
      return res.status(400).json({ error: 'Please provide a clear reason for this return.' });
    }

    if (!requestedItems.length) {
      return res.status(400).json({ error: 'Select at least one item to return.' });
    }

    try {
      const result = await coreWriteRepository.processSaleReturn({
        storeId: Number(req.user.store_id),
        saleId,
        processedBy: Number(req.user.id),
        requestedItems,
        reason: normalizedReason,
        note: normalizedNote || null,
        refundAmount: Math.max(0, Number(req.body?.refund_amount) || 0),
        returnType: normalizedReturnType as 'REFUND' | 'EXCHANGE' | 'RETURN_ONLY',
        refundMethod: normalizedRefundMethod as 'cash' | 'transfer' | 'pos' | 'store_credit' | 'other',
        restockItems: normalizedRestockItems,
      });

      const saleDetails = await coreReadRepository.getSaleDetails(Number(req.user.store_id), saleId);

      res.json({
        success: true,
        return: formatSaleReturnEntry(result.createdReturn),
        sale: {
          ...(await formatSaleResponse(result.updatedSale)),
          items: saleDetails.items,
          returns: saleDetails.returns.map((row: any) => formatSaleReturnEntry(row)),
        },
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to process return' });
    }
  });

  app.get('/api/vendor-payables', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const statusFilter = String(req.query.status || 'ALL').trim().toUpperCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const queryParams: unknown[] = [storeId];
    const statusCondition = (statusFilter !== 'ALL')
      ? `AND UPPER(COALESCE(vp.status, 'UNPAID')) = $${queryParams.push(statusFilter)}`
      : '';

    const rows = (await postgresPool.query(`
      SELECT
        vp.*,
        COALESCE(
          vp.source_type,
          CASE
            WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'consignment_item')::boolean, false) THEN 'CONSIGNMENT'
            WHEN si.specs_at_sale IS NOT NULL AND COALESCE((si.specs_at_sale::jsonb->>'sourced_item')::boolean, false) THEN 'SOURCED'
            ELSE 'SOURCED'
          END,
          'SOURCED'
        ) AS source_type,
        cvbd.bank_name AS vendor_bank_name,
        cvbd.account_number AS vendor_account_number,
        cvbd.account_name AS vendor_account_name,
        cvbd.bank_note AS vendor_bank_note,
        s.timestamp as sale_timestamp
      FROM vendor_payables vp
      LEFT JOIN sales s ON s.id = vp.sale_id
      LEFT JOIN sale_items si ON si.id = vp.sale_item_id
      LEFT JOIN consignment_vendor_bank_details cvbd
        ON cvbd.store_id = vp.store_id
       AND cvbd.vendor_key = LOWER(TRIM(COALESCE(vp.vendor_name, '')))
      WHERE vp.store_id = $1
      ${statusCondition}
      ORDER BY vp.created_at DESC, vp.id DESC
    `, queryParams)).rows as any[];

    const rowsWithVendorId = rows.map((row) => {
      const vendorId = calculateVendorIdFromSignature(getVendorSignature(row.vendor_name, null, null));
      return {
        ...row,
        vendor_id: vendorId,
      };
    });

    const filtered = rowsWithVendorId.filter((row) => {
      if (!search) {
        return true;
      }

      return [
        String(row.vendor_name || ''),
        String(row.vendor_reference || ''),
        String(row.item_name || ''),
        String(row.source_type || ''),
        String(row.vendor_id || ''),
        `sale ${row.sale_id}`,
      ].some((value) => value.toLowerCase().includes(search));
    });

    const summary = filtered.reduce((acc: any, row: any) => {
      const amountDue = Math.max(0, Number(row.amount_due || 0) || 0);
      acc.totalRecords += 1;
      acc.totalAmountDue += amountDue;
      if (String(row.status || '').toUpperCase() === 'UNPAID') {
        acc.unpaidAmount += amountDue;
      }
      return acc;
    }, {
      totalRecords: 0,
      totalAmountDue: 0,
      unpaidAmount: 0,
    });

    res.json({
      records: filtered.map((row: any) => ({
        ...row,
        status: String(row.status || 'UNPAID').toUpperCase() === 'SETTLED' ? 'SETTLED' : 'UNPAID',
        amount_due: Math.max(0, Number(row.amount_due || 0) || 0),
        source_type: String(row.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'SOURCED',
      })),
      summary,
    });
  });

  app.patch('/api/vendor-payables/:id/status', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), checkStoreLock, async (req: any, res: any) => {
    const payableId = Number(req.params.id);
    const nextStatus = String(req.body?.status || '').trim().toUpperCase() === 'SETTLED' ? 'SETTLED' : 'UNPAID';
    const note = String(req.body?.note || '').trim() || null;

    if (!Number.isInteger(payableId) || payableId <= 0) {
      return res.status(400).json({ error: 'Invalid payable id' });
    }

    const row = (await postgresPool.query('SELECT * FROM vendor_payables WHERE id = $1 AND store_id = $2 LIMIT 1', [payableId, Number(req.user.store_id)])).rows[0] as any;
    if (!row) {
      return res.status(404).json({ error: 'Vendor payable record not found' });
    }

    const currentAmountDue = Math.max(0, Number(row.amount_due || 0) || 0);
    const normalized = computePayableAfterReturn({
      currentAmountDue,
      returnCostValue: nextStatus === 'SETTLED' ? currentAmountDue : 0,
      currentStatus: String(row.status || 'UNPAID'),
    });
    const finalAmountDue = nextStatus === 'SETTLED' ? 0 : normalized.nextAmountDue;

    await postgresPool.query(`
      UPDATE vendor_payables
      SET status = $1,
          amount_due = $2,
          settled_at = CASE WHEN $1 = 'SETTLED' THEN CURRENT_TIMESTAMP ELSE NULL END,
          note = $3
      WHERE id = $4 AND store_id = $5
    `, [nextStatus, finalAmountDue, note, payableId, Number(req.user.store_id)]);

    await logAuditEvent({
      storeId: Number(req.user.store_id),
      userId: Number(req.user.id),
      userName: req.user.username,
      actionType: 'VENDOR_PAYABLE_UPDATE',
      description: `${getAuditActorLabel(req.user.role)} ${req.user.username} marked vendor payable #${payableId} as ${nextStatus}.`,
      oldValue: {
        status: String(row.status || 'UNPAID').toUpperCase(),
        amount_due: Math.max(0, Number(row.amount_due || 0) || 0),
      },
      newValue: {
        status: nextStatus,
        amount_due: finalAmountDue,
      },
    });

    logVendorPayableMutation({
      action: 'status_changed',
      storeId: Number(req.user.store_id),
      saleId: Number(row.sale_id || 0) || undefined,
      saleItemId: Number(row.sale_item_id || 0) || undefined,
      payableId,
      sourceType: String(row.source_type || 'SOURCED').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'SOURCED',
      previousAmountDue: currentAmountDue,
      nextAmountDue: finalAmountDue,
      previousStatus: String(row.status || 'UNPAID').toUpperCase(),
      nextStatus,
      actorUserId: Number(req.user.id || 0) || undefined,
    });

    res.json({
      success: true,
      record: {
        ...row,
        status: nextStatus,
        amount_due: finalAmountDue,
        note,
        settled_at: nextStatus === 'SETTLED' ? new Date().toISOString() : null,
      },
    });
  });

  app.get('/api/sourced-items', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT', 'STAFF']), checkStoreLock, async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const search = String(req.query.search || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const offset = (page - 1) * limit;

    const baseQuery = `
      WITH sourced AS (
        SELECT
          si.id,
          si.sale_id,
          si.quantity,
          si.price_at_sale,
          si.subtotal,
          si.cost_at_sale,
          si.imei_serial,
          si.specs_at_sale,
          s.timestamp AS sale_timestamp,
          s.status AS sale_status,
          s.deleted_at AS sale_deleted_at,
          u.username AS sold_by_username,
          TRIM(COALESCE((si.specs_at_sale::jsonb ->> 'sourced_vendor_name'), '')) AS owner_name,
          TRIM(COALESCE((si.specs_at_sale::jsonb ->> 'sourced_vendor_reference'), '')) AS owner_reference,
          TRIM(COALESCE((si.specs_at_sale::jsonb ->> 'sourced_item_name'), '')) AS item_name,
          COALESCE((si.specs_at_sale::jsonb ->> 'sourced_item')::boolean, false) AS is_sourced,
          GREATEST(1, COALESCE(si.quantity, 0)) AS quantity_normalized,
          GREATEST(0, COALESCE(si.price_at_sale, 0)) AS unit_price_normalized,
          GREATEST(0, COALESCE(si.subtotal, 0)) AS subtotal_normalized,
          GREATEST(0, COALESCE((si.specs_at_sale::jsonb ->> 'sourced_cost_price')::numeric, si.cost_at_sale, 0)) AS owner_unit_cost_normalized
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN users u ON u.id = s.user_id
        WHERE s.store_id = $1
      ), filtered AS (
        SELECT
          id,
          sale_id,
          sale_timestamp,
          sold_by_username,
          COALESCE(NULLIF(item_name, ''), 'Sourced Item') AS item_name,
          COALESCE(NULLIF(imei_serial, ''), '') AS imei_serial,
          quantity_normalized AS quantity,
          unit_price_normalized AS unit_price,
          subtotal_normalized AS subtotal,
          COALESCE(NULLIF(owner_name, ''), 'Unknown Owner') AS owner_name,
          COALESCE(NULLIF(owner_reference, ''), '') AS owner_reference,
          owner_unit_cost_normalized AS owner_unit_cost,
          ROUND((owner_unit_cost_normalized * quantity_normalized)::numeric, 2) AS owner_total_cost,
          ROUND((subtotal_normalized - (owner_unit_cost_normalized * quantity_normalized))::numeric, 2) AS gross_profit
        FROM sourced
        WHERE is_sourced
          AND UPPER(COALESCE(sale_status, '')) = 'COMPLETED'
          AND sale_deleted_at IS NULL
          AND (
            $2 = '' OR
            LOWER(COALESCE(item_name, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(imei_serial, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(owner_name, '')) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(owner_reference, '')) LIKE '%' || $2 || '%' OR
            LOWER('sale ' || sale_id::text) LIKE '%' || $2 || '%' OR
            LOWER(COALESCE(sold_by_username, '')) LIKE '%' || $2 || '%'
          )
      )
    `;

    const summaryQuery = await postgresPool.query(`
      ${baseQuery}
      SELECT
        COUNT(*)::int AS total_records,
        COALESCE(SUM(quantity), 0)::numeric AS total_units,
        COALESCE(SUM(subtotal), 0)::numeric AS total_sales_value,
        COALESCE(SUM(owner_total_cost), 0)::numeric AS total_owner_cost,
        COALESCE(SUM(gross_profit), 0)::numeric AS total_gross_profit
      FROM filtered
    `, [storeId, search]);

    const pageRows = await postgresPool.query(`
      ${baseQuery}
      SELECT *
      FROM filtered
      ORDER BY sale_timestamp DESC, id DESC
      LIMIT $3 OFFSET $4
    `, [storeId, search, limit, offset]);

    const summaryRow = summaryQuery.rows[0] || {};

    res.json({
      records: pageRows.rows.map((row: any) => ({
        id: Number(row.id),
        sale_id: Number(row.sale_id),
        sale_timestamp: row.sale_timestamp,
        sold_by_username: String(row.sold_by_username || 'Unknown Staff').trim() || 'Unknown Staff',
        item_name: String(row.item_name || 'Sourced Item').trim() || 'Sourced Item',
        imei_serial: String(row.imei_serial || '').trim(),
        quantity: Number(row.quantity || 0) || 0,
        unit_price: Number(row.unit_price || 0) || 0,
        subtotal: Number(row.subtotal || 0) || 0,
        owner_name: String(row.owner_name || 'Unknown Owner').trim() || 'Unknown Owner',
        owner_reference: String(row.owner_reference || '').trim(),
        owner_unit_cost: Number(row.owner_unit_cost || 0) || 0,
        owner_total_cost: Number(row.owner_total_cost || 0) || 0,
        gross_profit: Number(row.gross_profit || 0) || 0,
      })),
      summary: {
        total_records: Number(summaryRow.total_records || 0) || 0,
        total_units: Number(summaryRow.total_units || 0) || 0,
        total_sales_value: Number(summaryRow.total_sales_value || 0) || 0,
        total_owner_cost: Number(summaryRow.total_owner_cost || 0) || 0,
        total_gross_profit: Number(summaryRow.total_gross_profit || 0) || 0,
      },
      page,
      limit,
    });
  });

  app.get('/api/system-logs', authenticate, authorize(['STORE_ADMIN']), async (req: any, res: any) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const { rows, total } = await coreReadRepository.listSystemLogs({
        storeId: Number(req.user.store_id),
        staffName: typeof req.query.staffName === 'string' ? req.query.staffName.trim() : '',
        actionType: typeof req.query.actionType === 'string' ? req.query.actionType.trim() : '',
        todayOnly: ['1', 'true', 'yes'].includes(String(req.query.todayOnly || '').toLowerCase()),
        highRiskOnly: ['1', 'true', 'yes'].includes(String(req.query.highRiskOnly || '').toLowerCase()),
        limit,
        offset,
        highRiskActions: HIGH_RISK_AUDIT_ACTIONS,
      });

      res.json({
        logs: rows.map((row: any) => ({
          ...row,
          is_high_risk: HIGH_RISK_AUDIT_ACTIONS.includes(String(row.action_type || '').toUpperCase()),
        })),
        total,
        limit,
        offset,
        highRiskActions: HIGH_RISK_AUDIT_ACTIONS,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load system logs' });
    }
  });

  app.get('/api/system-logs/summary', authenticate, authorize(['STORE_ADMIN']), async (req: any, res: any) => {
    try {
      const { todayStats, recentHighRisk } = await coreReadRepository.getSystemLogsSummary(Number(req.user.store_id));

      res.json({
        totalToday: Number(todayStats?.totalToday || 0) || 0,
        priceChangesToday: Number(todayStats?.priceChangesToday || 0) || 0,
        discountsToday: Number(todayStats?.discountsToday || 0) || 0,
        stockAdjustmentsToday: Number(todayStats?.stockAdjustmentsToday || 0) || 0,
        highRiskCount: Number(todayStats?.highRiskCount || 0) || 0,
        recentHighRisk,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load system log summary' });
    }
  });

  app.delete('/api/system-logs', authenticate, authorize(['STORE_ADMIN']), async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No log IDs provided.' });
      }
      const safeIds = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
      if (safeIds.length === 0) return res.status(400).json({ error: 'Invalid IDs.' });
      const result = await postgresPool.query(
        `DELETE FROM system_logs WHERE store_id = $1 AND id = ANY($2::int[])`,
        [storeId, safeIds],
      );
      res.json({ deleted: result.rowCount || 0 });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete logs' });
    }
  });

  app.get('/api/audit-flags', authenticate, authorize(['STORE_ADMIN', 'SYSTEM_ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    try {
      const flags = await coreReadRepository.listAuditFlags(Number(req.user.store_id));
      res.json({
        flags: flags.map((flag: any) => ({
          ...flag,
          sale_total: Number(flag.sale_total || 0) || 0,
          discount_amount: Number(flag.discount_amount || 0) || 0,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load audit flags' });
    }
  });

  app.put('/api/audit-flags/:id/resolve', authenticate, authorize(['STORE_ADMIN']), async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const flagId = Number(req.params.id);
      if (!Number.isInteger(flagId) || flagId <= 0) {
        return res.status(400).json({ error: 'Invalid flag id' });
      }
      const result = await postgresPool.query(
        `UPDATE transaction_flags
         SET status = 'RESOLVED', resolved_at = NOW(), resolved_by = $1
         WHERE id = $2 AND store_id = $3 AND status = 'OPEN'
         RETURNING id`,
        [Number(req.user.id), flagId, storeId],
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: 'Flag not found or already resolved' });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to resolve flag' });
    }
  });

  app.post('/api/sales/:id/flag', authenticate, authorize(['STORE_ADMIN', 'SYSTEM_ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    const storeId = Number(req.user.store_id);
    const saleId = Number(req.params.id);
    const issueType = String(req.body?.issue_type || 'CHECK_REQUIRED').trim().toUpperCase() || 'CHECK_REQUIRED';
    const note = String(req.body?.note || '').trim();

    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: 'Invalid sale id' });
    }
    if (!note) {
      return res.status(400).json({ error: 'Please add a note for the owner before flagging this transaction.' });
    }

    const sale = await coreReadRepository.getSaleById(storeId, saleId);
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const createdFlag = await coreWriteRepository.createTransactionFlag({
      storeId,
      saleId,
      flaggedBy: Number(req.user.id),
      issueType,
      note,
    });

    await logSystemActivity({
      storeId,
      userId: req.user.id,
      action: 'FLAG_TRANSACTION',
      details: { saleId, issueType },
    });

    await logAuditEvent({
      storeId,
      userId: Number(req.user.id),
      userName: req.user.username,
      actionType: 'AUDIT_FLAG',
      description: `${getAuditActorLabel(req.user.role)} ${req.user.username} flagged Sale #${saleId} for owner review (${issueType.replace(/_/g, ' ')}).`,
      newValue: { saleId, issueType, note },
    });

    res.json({ success: true, id: Number(createdFlag?.id || 0) });
  });

  app.post('/api/sales/:id/void', authenticate, authorize(['STORE_ADMIN', 'SYSTEM_ADMIN', 'MANAGER']), async (req: any, res: any) => {
    const { reason } = req.body;

    if (!reason || typeof reason !== 'string' || reason.length < 3) {
      return res.status(400).json({ error: 'Void reason required (min 3 characters)' });
    }

    try {
      const voidedSale = await coreWriteRepository.voidSale({
        storeId: Number(req.user.store_id),
        saleId: Number(req.params.id),
        voidedBy: Number(req.user.id),
        reason,
      });
      await logAuditEvent({
        storeId: Number(req.user.store_id),
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'DELETE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} voided Sale #${voidedSale.saleId} worth ${formatAuditCurrency(voidedSale.total)}.`,
        oldValue: { saleId: voidedSale.saleId, status: voidedSale.previousStatus, total: voidedSale.total },
        newValue: { status: 'VOIDED', reason },
      });
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/admin/store/export', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const rawStoreId = req.user.role === 'SYSTEM_ADMIN' ? req.query.storeId : req.user.store_id;
    if (!rawStoreId) return res.status(400).json({ error: 'Store ID required' });

    const storeId = Number(rawStoreId);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      return res.status(400).json({ error: 'Invalid store id' });
    }

    try {
      const exported = await coreReadRepository.exportStoreData(storeId);
      if (!exported.store) {
        return res.status(404).json({ error: 'Store not found' });
      }

      res.json({
        version: '1.7',
        timestamp: new Date().toISOString(),
        ...exported,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/store/import', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const storeId = req.user.role === 'SYSTEM_ADMIN' ? req.body.storeId : req.user.store_id;
    if (!storeId) return res.status(400).json({ error: 'Store ID required' });

    const { data, mode } = req.body;
    if (!data) return res.status(400).json({ error: 'No data provided' });
    const importMode = mode === 'merge' ? 'merge' : 'replace';

    try {
      await coreWriteRepository.importStoreData({
        storeId: Number(storeId),
        actorUserId: Number(req.user.id),
        data,
        mode: importMode,
      });

      res.json({ success: true });
    } catch (err: any) {
      console.error('Import error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/store/import/precheck', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const { data } = req.body || {};
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'No data provided for precheck' });
    }

    try {
      const products = Array.isArray(data.products) ? data.products : [];
      const categories = Array.isArray(data.categories) ? data.categories : [];
      const users = Array.isArray(data.users) ? data.users : [];
      const customers = Array.isArray(data.customers) ? data.customers : [];
      const sales = Array.isArray(data.sales) ? data.sales : [];
      const saleItems = Array.isArray(data.saleItems) ? data.saleItems : [];
      const salesReturns = Array.isArray(data.salesReturns) ? data.salesReturns : [];
      const handoverNotes = Array.isArray(data.handoverNotes)
        ? data.handoverNotes
        : (Array.isArray(data.handover_notes) ? data.handover_notes : []);

      const categoryIds = new Set(categories.map((c: any) => Number(c?.id)).filter((id: number) => Number.isInteger(id) && id > 0));
      const userIds = new Set(users.map((u: any) => Number(u?.id)).filter((id: number) => Number.isInteger(id) && id > 0));
      const customerIds = new Set(customers.map((c: any) => Number(c?.id)).filter((id: number) => Number.isInteger(id) && id > 0));
      const productIds = new Set(products.map((p: any) => Number(p?.id)).filter((id: number) => Number.isInteger(id) && id > 0));
      const saleIds = new Set(sales.map((s: any) => Number(s?.id)).filter((id: number) => Number.isInteger(id) && id > 0));

      const barcodeCounts = new Map<string, number>();
      products.forEach((p: any) => {
        const barcode = String(p?.barcode || '').trim();
        if (!barcode) return;
        barcodeCounts.set(barcode, (barcodeCounts.get(barcode) || 0) + 1);
      });

      const duplicateBarcodes = Array.from(barcodeCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([barcode, count]) => ({ barcode, count }));

      const missingCategoryRefs = products.filter((p: any) => {
        const categoryId = Number(p?.category_id);
        return Number.isInteger(categoryId) && categoryId > 0 && !categoryIds.has(categoryId);
      }).length;

      const missingSaleUserRefs = sales.filter((s: any) => {
        const userId = Number(s?.user_id);
        return Number.isInteger(userId) && userId > 0 && !userIds.has(userId);
      }).length;

      const missingSaleCustomerRefs = sales.filter((s: any) => {
        const customerId = Number(s?.customer_id);
        return Number.isInteger(customerId) && customerId > 0 && !customerIds.has(customerId);
      }).length;

      const missingSaleItemSaleRefs = saleItems.filter((si: any) => {
        const saleId = Number(si?.sale_id);
        return Number.isInteger(saleId) && saleId > 0 && !saleIds.has(saleId);
      }).length;

      const missingSaleItemProductRefs = saleItems.filter((si: any) => {
        const productId = Number(si?.product_id);
        return Number.isInteger(productId) && productId > 0 && !productIds.has(productId);
      }).length;

      const booleanInIntegerFields = {
        storeFlags: ['show_store_name_on_documents', 'tax_enabled', 'receipt_show_bank_details', 'default_missing_cost_to_price', 'pin_checkout_enabled', 'chat_cleanup_reminders_enabled']
          .filter((field) => typeof data?.store?.[field] === 'boolean').length,
        saleLedgerLocks: sales.filter((s: any) => typeof s?.is_ledger_locked === 'boolean').length,
        returnRestockFlags: salesReturns.filter((entry: any) => typeof entry?.restock_items === 'boolean').length,
        handoverPinnedFlags: handoverNotes.filter((entry: any) => typeof entry?.is_pinned === 'boolean').length,
      };

      const warnings: string[] = [];
      if (duplicateBarcodes.length > 0) warnings.push(`Duplicate barcode values found (${duplicateBarcodes.length}).`);
      if (missingCategoryRefs > 0) warnings.push(`Products referencing missing categories (${missingCategoryRefs}).`);
      if (missingSaleUserRefs > 0) warnings.push(`Sales referencing missing users (${missingSaleUserRefs}).`);
      if (missingSaleCustomerRefs > 0) warnings.push(`Sales referencing missing customers (${missingSaleCustomerRefs}).`);
      if (missingSaleItemSaleRefs > 0 || missingSaleItemProductRefs > 0) {
        warnings.push(`Sale items with broken sale/product references (${missingSaleItemSaleRefs + missingSaleItemProductRefs}).`);
      }

      const booleanTypeMismatches = Object.values(booleanInIntegerFields).reduce((sum, value) => sum + Number(value || 0), 0);
      if (booleanTypeMismatches > 0) warnings.push(`Boolean values found in integer-backed fields (${booleanTypeMismatches}); import will normalize them.`);

      res.json({
        ok: true,
        summary: {
          stores: data?.store ? 1 : 0,
          users: users.length,
          categories: categories.length,
          products: products.length,
          customers: customers.length,
          sales: sales.length,
          saleItems: saleItems.length,
          salesReturns: salesReturns.length,
        },
        warnings,
        diagnostics: {
          duplicateBarcodes: duplicateBarcodes.slice(0, 8),
          missingCategoryRefs,
          missingSaleUserRefs,
          missingSaleCustomerRefs,
          missingSaleItemSaleRefs,
          missingSaleItemProductRefs,
          booleanInIntegerFields,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Precheck failed' });
    }
  });

  app.post('/api/admin/store/retention/preview', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    try {
      const { storeId, windowRange } = resolveRetentionRequestContext(req);

      const predicates = {
        sales: retentionPredicate('timestamp', windowRange.fromIso, windowRange.toIso),
        expenses: retentionPredicate('spent_at', windowRange.fromIso, windowRange.toIso),
        stockAdjustments: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        messages: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        handover: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        attendance: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        repairs: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        collections: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        logs: retentionPredicate('timestamp', windowRange.fromIso, windowRange.toIso),
        activityLogs: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        proformas: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        holds: retentionPredicate('timestamp', windowRange.fromIso, windowRange.toIso),
      };

      const salesRows = await postgresPool.query(`SELECT id FROM sales WHERE store_id = $1 AND ${predicates.sales.sql}`, [storeId, ...predicates.sales.params]);
      const saleIds = salesRows.rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isInteger(id) && id > 0);

      const [
        saleItemsCount,
        vendorPayablesCount,
        returnsCount,
        flagsCount,
        expensesCount,
        stockAdjustmentsCount,
        messagesCount,
        handoverCount,
        attendanceCount,
        repairsCount,
        collectionsCount,
        systemLogsCount,
        activityLogsCount,
        proformasCount,
        holdsCount,
      ] = await Promise.all([
        saleIds.length > 0
          ? postgresPool.query('SELECT COUNT(*)::int AS count FROM sale_items WHERE sale_id = ANY($1::int[])', [saleIds])
          : Promise.resolve({ rows: [{ count: 0 }] } as any),
        saleIds.length > 0
          ? postgresPool.query('SELECT COUNT(*)::int AS count FROM vendor_payables WHERE sale_id = ANY($1::int[])', [saleIds])
          : Promise.resolve({ rows: [{ count: 0 }] } as any),
        saleIds.length > 0
          ? postgresPool.query('SELECT COUNT(*)::int AS count FROM sales_returns WHERE sale_id = ANY($1::int[])', [saleIds])
          : Promise.resolve({ rows: [{ count: 0 }] } as any),
        saleIds.length > 0
          ? postgresPool.query('SELECT COUNT(*)::int AS count FROM transaction_flags WHERE sale_id = ANY($1::int[])', [saleIds])
          : Promise.resolve({ rows: [{ count: 0 }] } as any),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM expenses WHERE store_id = $1 AND ${predicates.expenses.sql}`, [storeId, ...predicates.expenses.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM stock_adjustments WHERE store_id = $1 AND ${predicates.stockAdjustments.sql}`, [storeId, ...predicates.stockAdjustments.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM internal_messages WHERE store_id = $1 AND ${predicates.messages.sql}`, [storeId, ...predicates.messages.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM handover_notes WHERE store_id = $1 AND ${predicates.handover.sql}`, [storeId, ...predicates.handover.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM staff_attendance WHERE store_id = $1 AND ${predicates.attendance.sql}`, [storeId, ...predicates.attendance.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM repair_tickets WHERE store_id = $1 AND ${predicates.repairs.sql}`, [storeId, ...predicates.repairs.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM market_collections WHERE store_id = $1 AND ${predicates.collections.sql}`, [storeId, ...predicates.collections.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM system_logs WHERE store_id = $1 AND ${predicates.logs.sql}`, [storeId, ...predicates.logs.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM system_activity_logs WHERE store_id = $1 AND ${predicates.activityLogs.sql}`, [storeId, ...predicates.activityLogs.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM pro_formas WHERE store_id = $1 AND ${predicates.proformas.sql}`, [storeId, ...predicates.proformas.params]),
        postgresPool.query(`SELECT COUNT(*)::int AS count FROM active_holds WHERE store_id = $1 AND ${predicates.holds.sql}`, [storeId, ...predicates.holds.params]),
      ]);

      const counts = {
        sales: saleIds.length,
        sale_items: Number(saleItemsCount.rows[0]?.count || 0) || 0,
        vendor_payables: Number(vendorPayablesCount.rows[0]?.count || 0) || 0,
        sales_returns: Number(returnsCount.rows[0]?.count || 0) || 0,
        transaction_flags: Number(flagsCount.rows[0]?.count || 0) || 0,
        expenses: Number(expensesCount.rows[0]?.count || 0) || 0,
        stock_adjustments: Number(stockAdjustmentsCount.rows[0]?.count || 0) || 0,
        internal_messages: Number(messagesCount.rows[0]?.count || 0) || 0,
        handover_notes: Number(handoverCount.rows[0]?.count || 0) || 0,
        staff_attendance: Number(attendanceCount.rows[0]?.count || 0) || 0,
        repair_tickets: Number(repairsCount.rows[0]?.count || 0) || 0,
        market_collections: Number(collectionsCount.rows[0]?.count || 0) || 0,
        system_logs: Number(systemLogsCount.rows[0]?.count || 0) || 0,
        system_activity_logs: Number(activityLogsCount.rows[0]?.count || 0) || 0,
        pro_formas: Number(proformasCount.rows[0]?.count || 0) || 0,
        active_holds: Number(holdsCount.rows[0]?.count || 0) || 0,
      };

      const totalRows = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
      res.json({
        range: {
          mode: windowRange.mode,
          label: windowRange.label,
          from: windowRange.fromIso,
          to: windowRange.toIso,
        },
        counts,
        totalRows,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to preview retention cleanup' });
    }
  });

  app.post('/api/admin/store/retention/activity-summary', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    try {
      const { storeId, windowRange } = resolveRetentionRequestContext(req);
      const salesPredicate = retentionPredicate('s.timestamp', windowRange.fromIso, windowRange.toIso);
      const expensePredicate = retentionPredicate('spent_at', windowRange.fromIso, windowRange.toIso);

      const [storeRowResult, salesSummaryResult, expenseSummaryResult, topProductsResult, topStaffResult] = await Promise.all([
        postgresPool.query('SELECT id, name, address, phone FROM stores WHERE id = $1 LIMIT 1', [storeId]),
        postgresPool.query(`
          SELECT
            COUNT(*)::int AS sales_count,
            COALESCE(SUM(s.total), 0)::numeric AS sales_total,
            COALESCE(SUM(s.discount_amount), 0)::numeric AS discount_total,
            COALESCE(SUM(s.tax_amount), 0)::numeric AS tax_total
          FROM sales s
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND ${salesPredicate.sql}
        `, [storeId, ...salesPredicate.params]),
        postgresPool.query(`
          SELECT
            COUNT(*)::int AS expense_count,
            COALESCE(SUM(amount), 0)::numeric AS expense_total
          FROM expenses
          WHERE store_id = $1
            AND ${expensePredicate.sql}
        `, [storeId, ...expensePredicate.params]),
        postgresPool.query(`
          SELECT p.name, SUM(si.quantity)::int AS quantity, COALESCE(SUM(si.subtotal), 0)::numeric AS revenue
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          JOIN products p ON p.id = si.product_id
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND ${salesPredicate.sql}
          GROUP BY p.name
          ORDER BY quantity DESC, revenue DESC
          LIMIT 10
        `, [storeId, ...salesPredicate.params]),
        postgresPool.query(`
          SELECT COALESCE(u.username, 'Unknown') AS username, COUNT(*)::int AS sales_count, COALESCE(SUM(s.total), 0)::numeric AS sales_total
          FROM sales s
          LEFT JOIN users u ON u.id = s.user_id
          WHERE s.store_id = $1
            AND s.status != 'VOIDED'
            AND ${salesPredicate.sql}
          GROUP BY COALESCE(u.username, 'Unknown')
          ORDER BY sales_count DESC, sales_total DESC
          LIMIT 10
        `, [storeId, ...salesPredicate.params]),
      ]);

      const normalizedTopProducts = (topProductsResult.rows || []).map((row: any) => {
        const rawName = String(row?.name || '').trim();
        const normalizedName = rawName === '__SOURCED_PLACEHOLDER__'
          ? 'Sourced Item'
          : rawName === '__CONSIGNMENT_PLACEHOLDER__'
            ? 'Consignment Item'
            : rawName;

        return {
          ...row,
          name: normalizedName || 'Product',
        };
      });

      res.json({
        generatedAt: new Date().toISOString(),
        range: {
          mode: windowRange.mode,
          label: windowRange.label,
          from: windowRange.fromIso,
          to: windowRange.toIso,
        },
        store: storeRowResult.rows[0] || null,
        totals: {
          sales_count: Number(salesSummaryResult.rows[0]?.sales_count || 0) || 0,
          sales_total: Number(salesSummaryResult.rows[0]?.sales_total || 0) || 0,
          discount_total: Number(salesSummaryResult.rows[0]?.discount_total || 0) || 0,
          tax_total: Number(salesSummaryResult.rows[0]?.tax_total || 0) || 0,
          expense_count: Number(expenseSummaryResult.rows[0]?.expense_count || 0) || 0,
          expense_total: Number(expenseSummaryResult.rows[0]?.expense_total || 0) || 0,
        },
        topProducts: normalizedTopProducts,
        topStaff: topStaffResult.rows,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to build retention activity summary' });
    }
  });

  app.post('/api/admin/store/retention/delete', authenticate, authorize(['SYSTEM_ADMIN', 'STORE_ADMIN']), async (req: any, res: any) => {
    const backupDownloaded = req.body?.backupDownloaded === true;
    const reportDownloaded = req.body?.reportDownloaded === true;
    const confirmationText = String(req.body?.confirmationText || '').trim().toUpperCase();
    if (!backupDownloaded || !reportDownloaded) {
      return res.status(400).json({ error: 'Download JSON backup and activity PDF before deletion.' });
    }
    if (confirmationText !== 'DELETE STORE DATA') {
      return res.status(400).json({ error: 'Confirmation text mismatch. Type DELETE STORE DATA to continue.' });
    }

    try {
      const { storeId, windowRange } = resolveRetentionRequestContext(req);
      const predicates = {
        sales: retentionPredicate('timestamp', windowRange.fromIso, windowRange.toIso),
        expenses: retentionPredicate('spent_at', windowRange.fromIso, windowRange.toIso),
        stockAdjustments: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        messages: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        handover: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        attendance: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        repairs: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        collections: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        logs: retentionPredicate('timestamp', windowRange.fromIso, windowRange.toIso),
        activityLogs: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        proformas: retentionPredicate('created_at', windowRange.fromIso, windowRange.toIso),
        holds: retentionPredicate('timestamp', windowRange.fromIso, windowRange.toIso),
      };

      const deletedCounts: Record<string, number> = {};

      await postgresPool.query('BEGIN');
      try {
        const salesRows = await postgresPool.query(`SELECT id FROM sales WHERE store_id = $1 AND ${predicates.sales.sql}`, [storeId, ...predicates.sales.params]);
        const saleIds = salesRows.rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isInteger(id) && id > 0);

        if (saleIds.length > 0) {
          const deleteFlags = await postgresPool.query('DELETE FROM transaction_flags WHERE sale_id = ANY($1::int[])', [saleIds]);
          const deleteReturns = await postgresPool.query('DELETE FROM sales_returns WHERE sale_id = ANY($1::int[])', [saleIds]);
          const deletePayables = await postgresPool.query('DELETE FROM vendor_payables WHERE sale_id = ANY($1::int[])', [saleIds]);
          const deleteItems = await postgresPool.query('DELETE FROM sale_items WHERE sale_id = ANY($1::int[])', [saleIds]);
          const deleteSales = await postgresPool.query('DELETE FROM sales WHERE id = ANY($1::int[])', [saleIds]);
          deletedCounts.transaction_flags = deleteFlags.rowCount || 0;
          deletedCounts.sales_returns = deleteReturns.rowCount || 0;
          deletedCounts.vendor_payables = deletePayables.rowCount || 0;
          deletedCounts.sale_items = deleteItems.rowCount || 0;
          deletedCounts.sales = deleteSales.rowCount || 0;
        } else {
          deletedCounts.transaction_flags = 0;
          deletedCounts.sales_returns = 0;
          deletedCounts.vendor_payables = 0;
          deletedCounts.sale_items = 0;
          deletedCounts.sales = 0;
        }

        const deleteExpenses = await postgresPool.query(`DELETE FROM expenses WHERE store_id = $1 AND ${predicates.expenses.sql}`, [storeId, ...predicates.expenses.params]);
        const deleteStockAdjustments = await postgresPool.query(`DELETE FROM stock_adjustments WHERE store_id = $1 AND ${predicates.stockAdjustments.sql}`, [storeId, ...predicates.stockAdjustments.params]);
        const deleteMessages = await postgresPool.query(`DELETE FROM internal_messages WHERE store_id = $1 AND ${predicates.messages.sql}`, [storeId, ...predicates.messages.params]);
        const deleteHandover = await postgresPool.query(`DELETE FROM handover_notes WHERE store_id = $1 AND ${predicates.handover.sql}`, [storeId, ...predicates.handover.params]);
        const deleteAttendance = await postgresPool.query(`DELETE FROM staff_attendance WHERE store_id = $1 AND ${predicates.attendance.sql}`, [storeId, ...predicates.attendance.params]);
        const deleteRepairs = await postgresPool.query(`DELETE FROM repair_tickets WHERE store_id = $1 AND ${predicates.repairs.sql}`, [storeId, ...predicates.repairs.params]);
        const deleteCollections = await postgresPool.query(`DELETE FROM market_collections WHERE store_id = $1 AND ${predicates.collections.sql}`, [storeId, ...predicates.collections.params]);
        const deleteSystemLogs = await postgresPool.query(`DELETE FROM system_logs WHERE store_id = $1 AND ${predicates.logs.sql}`, [storeId, ...predicates.logs.params]);
        const deleteActivityLogs = await postgresPool.query(`DELETE FROM system_activity_logs WHERE store_id = $1 AND ${predicates.activityLogs.sql}`, [storeId, ...predicates.activityLogs.params]);
        const deleteProformas = await postgresPool.query(`DELETE FROM pro_formas WHERE store_id = $1 AND ${predicates.proformas.sql}`, [storeId, ...predicates.proformas.params]);
        const deleteHolds = await postgresPool.query(`DELETE FROM active_holds WHERE store_id = $1 AND ${predicates.holds.sql}`, [storeId, ...predicates.holds.params]);

        deletedCounts.expenses = deleteExpenses.rowCount || 0;
        deletedCounts.stock_adjustments = deleteStockAdjustments.rowCount || 0;
        deletedCounts.internal_messages = deleteMessages.rowCount || 0;
        deletedCounts.handover_notes = deleteHandover.rowCount || 0;
        deletedCounts.staff_attendance = deleteAttendance.rowCount || 0;
        deletedCounts.repair_tickets = deleteRepairs.rowCount || 0;
        deletedCounts.market_collections = deleteCollections.rowCount || 0;
        deletedCounts.system_logs = deleteSystemLogs.rowCount || 0;
        deletedCounts.system_activity_logs = deleteActivityLogs.rowCount || 0;
        deletedCounts.pro_formas = deleteProformas.rowCount || 0;
        deletedCounts.active_holds = deleteHolds.rowCount || 0;

        await postgresPool.query('COMMIT');
      } catch (deleteErr) {
        await postgresPool.query('ROLLBACK');
        throw deleteErr;
      }

      const totalDeleted = Object.values(deletedCounts).reduce((sum, value) => sum + Number(value || 0), 0);

      await logAuditEvent({
        storeId,
        userId: Number(req.user.id),
        userName: req.user.username,
        actionType: 'DELETE',
        description: `${getAuditActorLabel(req.user.role)} ${req.user.username} deleted store activity data (${windowRange.label}).`,
        newValue: {
          mode: windowRange.mode,
          from: windowRange.fromIso,
          to: windowRange.toIso,
          deletedCounts,
          totalDeleted,
        },
      });

      res.json({
        success: true,
        range: {
          mode: windowRange.mode,
          label: windowRange.label,
          from: windowRange.fromIso,
          to: windowRange.toIso,
        },
        deletedCounts,
        totalDeleted,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to delete retention data' });
    }
  });

  app.get('/api/customers', authenticate, async (req: any, res: any) => {
    try {
      const customers = await coreReadRepository.listCustomers(Number(req.user.store_id), 'name');
      res.json(customers);
    } catch (err: any) {
      console.error('Customers read error:', err);
      res.status(500).json({ error: err.message || 'Failed to load customers' });
    }
  });

  app.get('/api/customers/search', authenticate, async (req: any, res: any) => {
    const normalizedPhone = normalizePhone(req.query.phone);
    if (!normalizedPhone) return res.status(400).json({ error: 'Phone number required' });

    try {
      const customers = await coreReadRepository.listCustomers(Number(req.user.store_id), 'created_desc') as any[];
      const customer = customers.find((entry: any) => normalizePhone(entry.phone) === normalizedPhone);
      res.json(customer || null);
    } catch (err: any) {
      console.error('Customer search error:', err);
      res.status(500).json({ error: err.message || 'Failed to search customers' });
    }
  });

  app.get('/api/customers/phone-suggestions', authenticate, async (req: any, res: any) => {
    const normalizedPrefix = normalizePhone(req.query.prefix);
    if (!normalizedPrefix || normalizedPrefix.length < 5) return res.json([]);

    try {
      const suggestions = ((await coreReadRepository.listCustomers(Number(req.user.store_id), 'created_desc')) as any[])
        .map((customer: any) => ({ id: customer.id, name: customer.name, phone: customer.phone }))
        .filter((customer: any) => normalizePhone(customer.phone).startsWith(normalizedPrefix))
        .slice(0, 10);

      res.json(suggestions);
    } catch (err: any) {
      console.error('Customer phone suggestions error:', err);
      res.status(500).json({ error: err.message || 'Failed to load phone suggestions' });
    }
  });

  app.post('/api/customers', authenticate, checkStoreLock, async (req: any, res: any) => {
    const { name, phone, address } = req.body;
    const rawPhone = String(phone ?? '').trim();
    const normalizedPhone = normalizePhone(rawPhone);
    const storedPhone = normalizeStoredPhone(rawPhone);

    if (!name || name.length < 1 || name.length > 255) {
      return res.status(400).json({ error: 'Customer name required (max 255 chars)' });
    }
    if (!normalizedPhone || normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      return res.status(400).json({ error: 'Phone number required (7-15 digits)' });
    }
    if (address && address.length > 500) {
      return res.status(400).json({ error: 'Address too long (max 500 chars)' });
    }

    try {
      const existingCustomers = await coreReadRepository.listCustomers(Number(req.user.store_id), 'created_desc') as any[];
      const existingCustomer = existingCustomers.find((customer: any) => normalizePhone(customer.phone) === normalizedPhone);
      if (existingCustomer) {
        return res.status(400).json({ error: 'A customer with this phone number already exists' });
      }

      let customerCode = '';
      let isUnique = false;
      let attempts = 0;
      while (!isUnique && attempts < 10) {
        customerCode = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = (await postgresPool.query('SELECT id FROM customers WHERE customer_code = $1', [customerCode])).rows[0];
        if (!existing) isUnique = true;
        attempts += 1;
      }
      if (!isUnique) {
        return res.status(500).json({ error: 'Failed to generate unique customer code' });
      }

      const customer = await coreWriteRepository.createCustomer({
        storeId: Number(req.user.store_id),
        name: String(name).trim(),
        phone: storedPhone,
        address: address || null,
        customerCode,
      });

      res.json({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        customer_code: customer.customer_code,
      });
    } catch (err: any) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'A customer with this phone number already exists' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/customers/:id', authenticate, authorize(['STORE_ADMIN', 'MANAGER']), checkStoreLock, async (req: any, res: any) => {
    const customerId = Number(req.params.id);
    const storeId = Number(req.user.store_id);
    const { name, phone, address } = req.body ?? {};
    const rawPhone = String(phone ?? '').trim();
    const normalizedPhone = normalizePhone(rawPhone);
    const storedPhone = normalizeStoredPhone(rawPhone);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Invalid customer id' });
    }
    if (!String(name || '').trim() || String(name || '').trim().length > 255) {
      return res.status(400).json({ error: 'Customer name required (max 255 chars)' });
    }
    if (!normalizedPhone || normalizedPhone.length < 7 || normalizedPhone.length > 15) {
      return res.status(400).json({ error: 'Phone number required (7-15 digits)' });
    }
    if (address && String(address).length > 500) {
      return res.status(400).json({ error: 'Address too long (max 500 chars)' });
    }

    try {
      const updatedCustomer = await coreWriteRepository.updateCustomer({
        storeId,
        customerId,
        name: String(name).trim(),
        phone: storedPhone,
        address: String(address ?? '').trim() || null,
      });

      res.json({
        id: updatedCustomer?.id,
        name: updatedCustomer?.name,
        phone: updatedCustomer?.phone,
        address: updatedCustomer?.address,
        customer_code: updatedCustomer?.customer_code,
      });
    } catch (err: any) {
      const message = String(err?.message || 'Failed to update customer');
      if (message.includes('Customer not found')) {
        return res.status(404).json({ error: message });
      }
      if (message.includes('already exists') || message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'A customer with this phone number already exists' });
      }
      console.error('Customer update error:', err);
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/customers/:id', authenticate, authorize(['STORE_ADMIN']), checkStoreLock, async (req: any, res: any) => {
    const customerId = Number(req.params.id);
    const storeId = Number(req.user.store_id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: 'Invalid customer id' });
    }

    try {
      const result = await coreWriteRepository.deleteCustomer({ storeId, customerId });
      res.json(result);
    } catch (err: any) {
      const message = String(err?.message || 'Failed to delete customer');
      if (message.includes('Customer not found')) {
        return res.status(404).json({ error: message });
      }
      if (message.includes('invoice history')) {
        return res.status(400).json({ error: message });
      }
      console.error('Customer delete error:', err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/customers/stats', authenticate, async (req: any, res: any) => {
    try {
      const stats = await coreReadRepository.getCustomerStats(Number(req.user.store_id));
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load customer stats' });
    }
  });

  app.get('/api/customers/:id/invoices', authenticate, async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const customerId = Number(req.params.id);
      const { customer, sales } = await coreReadRepository.getCustomerInvoices(storeId, customerId);

      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      const invoices = await Promise.all(sales.map(async (sale: any) => ({
          ...(await formatSaleResponse(sale)),
        items: await coreReadRepository.getSaleItemsForInvoice(Number(sale.id)),
      })));

      res.json({
        customer,
        invoices,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load customer invoices' });
    }
  });

  app.get('/api/reports/z-report', authenticate, async (req: any, res: any) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const sales = await coreReadRepository.listZReportSales(Number(req.user.store_id), today);

      const summary = sales.reduce((acc: any, sale: any) => {
        const pm = safeJsonParse(sale.payment_methods, {});
        acc.cash += Number(pm?.cash || 0) || 0;
        acc.transfer += Number(pm?.transfer || 0) || 0;
        acc.pos += Number(pm?.pos || 0) || 0;
        acc.total += Number(sale.total || 0) || 0;
        return acc;
      }, { cash: 0, transfer: 0, pos: 0, total: 0 });

      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load z-report' });
    }
  });

  app.get('/api/reports/my-sales-chart', authenticate, async (req: any, res: any) => {
    try {
      const userId = Number(req.user.id);
      const storeId = Number(req.user.store_id);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const toDateKey = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const selectedDate = toDateKey(today);
      const startDateObj = new Date(today);
      startDateObj.setDate(startDateObj.getDate() - 6);
      const startDate = toDateKey(startDateObj);

      const { salesRows } = await coreReadRepository.getMySalesChartData(storeId, userId, startDate, selectedDate);
      const todaySales = salesRows.filter((sale: any) => String(sale.sale_date) === selectedDate);

      const summary = todaySales.reduce((acc: any, sale: any) => {
        const pm = safeJsonParse(sale.payment_methods, {});
        acc.cash += Number(pm?.cash) || 0;
        acc.transfer += Number(pm?.transfer) || 0;
        acc.pos += Number(pm?.pos) || 0;
        acc.total += Number(sale.total) || 0;
        acc.count += 1;
        return acc;
      }, { cash: 0, transfer: 0, pos: 0, total: 0, count: 0 });

      const trendMap = new Map<string, { sales_count: number; total: number }>();
      for (const row of salesRows) {
        const key = String(row.sale_date || '');
        const current = trendMap.get(key) || { sales_count: 0, total: 0 };
        current.sales_count += 1;
        current.total += Number(row.total) || 0;
        trendMap.set(key, current);
      }

      const trend = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(startDateObj);
        date.setDate(startDateObj.getDate() + index);
        const key = toDateKey(date);
        const existing = trendMap.get(key);

        return {
          date: key,
          label: date.toLocaleDateString('en-US', { weekday: 'short' }),
          total: Number(existing?.total) || 0,
          count: Number(existing?.sales_count) || 0,
        };
      });

      res.json({
        ...summary,
        trend,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load staff sales chart' });
    }
  });

  app.get('/api/reports/financial-ledger', authenticate, authorize(['STORE_ADMIN', 'SYSTEM_ADMIN', 'ACCOUNTANT']), async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.role === 'SYSTEM_ADMIN' ? (req.query.storeId || req.user.store_id) : req.user.store_id);
      const period = String(req.query.period || 'daily').trim().toLowerCase() === 'monthly' ? 'monthly' : 'daily';
      const requestedFrom = String(req.query.from || '').trim();
      const requestedTo = String(req.query.to || '').trim();
      const today = new Date();
      const defaultFromDate = new Date();
      defaultFromDate.setDate(today.getDate() - 29);

      const toDateKey = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const from = /^\d{4}-\d{2}-\d{2}$/.test(requestedFrom) ? requestedFrom : toDateKey(defaultFromDate);
      const to = /^\d{4}-\d{2}-\d{2}$/.test(requestedTo) ? requestedTo : toDateKey(today);

      const { storeSettings, rows, totalExpenses } = await coreReadRepository.getFinancialLedgerData(storeId, from, to);
      const costFallbackEnabled = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;

      const buckets = new Map<string, any>();
      const getBucket = (timestamp: string) => {
        const date = new Date(String(timestamp || new Date().toISOString()));
        const key = period === 'monthly'
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
          : toDateKey(date);

        if (!buckets.has(key)) {
          buckets.set(key, {
            key,
            label: period === 'monthly'
              ? date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
              : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            totalSales: 0,
            totalCost: 0,
            totalDiscounts: 0,
            taxCollected: 0,
            cashTotal: 0,
            transferTotal: 0,
            moniepointTotal: 0,
            seenSales: new Set<number>(),
          });
        }

        return buckets.get(key);
      };

      rows.forEach((row: any) => {
        const bucket = getBucket(String(row.timestamp || new Date().toISOString()));
        const saleId = Number(row.sale_id) || 0;

        if (saleId > 0 && !bucket.seenSales.has(saleId)) {
          bucket.seenSales.add(saleId);
          bucket.totalSales += Number(row.total || 0) || 0;
          bucket.totalDiscounts += Number(row.discount_amount || 0) || 0;
          bucket.taxCollected += Number(row.tax_amount || 0) || 0;

          const methods = safeJsonParse(row.payment_methods, {});
          bucket.cashTotal += Number(methods?.cash || 0) || 0;
          bucket.transferTotal += Number(methods?.transfer || 0) || 0;
          bucket.moniepointTotal += Number(methods?.pos || 0) || 0;
        }

        const quantity = Math.max(0, Number(row.quantity) || 0);
        if (!quantity) {
          return;
        }

        const sellingPrice = Math.max(0, Number(row.price_at_sale || 0));
        const explicitCostAtSale = toFiniteNumberOrNull(row.cost_at_sale);
        let resolvedCost: number | null = null;

        if (explicitCostAtSale != null && (explicitCostAtSale > 0 || sellingPrice <= 0)) {
          resolvedCost = explicitCostAtSale;
        } else {
          const resolved = resolveTrackedCost({
            product: {
              cost: row.product_cost,
              price: row.product_price,
              condition_matrix: row.condition_matrix,
            },
            condition: row.condition,
            sellingPrice,
            fallbackToSelling: costFallbackEnabled,
          });
          resolvedCost = resolved.cost;
        }

        bucket.totalCost += (Number(resolvedCost || 0) || 0) * quantity;
      });

      const ledger = Array.from(buckets.values())
        .sort((a, b) => String(a.key).localeCompare(String(b.key)))
        .map((bucket) => {
          const businessRevenue = Number((bucket.totalSales - bucket.taxCollected).toFixed(2)) || 0;
          return {
            date: bucket.key,
            label: bucket.label,
            totalSales: Number(bucket.totalSales.toFixed(2)) || 0,
            totalCost: Number(bucket.totalCost.toFixed(2)) || 0,
            totalDiscounts: Number(bucket.totalDiscounts.toFixed(2)) || 0,
            netProfit: Number((businessRevenue - bucket.totalCost).toFixed(2)) || 0,
            moniepointTotal: Number(bucket.moniepointTotal.toFixed(2)) || 0,
            cashTotal: Number(bucket.cashTotal.toFixed(2)) || 0,
            transferTotal: Number(bucket.transferTotal.toFixed(2)) || 0,
            taxCollected: Number(bucket.taxCollected.toFixed(2)) || 0,
            businessRevenue,
            transactionCount: bucket.seenSales.size,
          };
        });

      const summary = ledger.reduce((acc: any, row: any) => {
        acc.totalSales += Number(row.totalSales || 0);
        acc.totalCost += Number(row.totalCost || 0);
        acc.totalDiscounts += Number(row.totalDiscounts || 0);
        acc.netProfit += Number(row.netProfit || 0);
        acc.cashTotal += Number(row.cashTotal || 0);
        acc.moniepointTotal += Number(row.moniepointTotal || 0);
        acc.transferTotal += Number(row.transferTotal || 0);
        acc.taxCollected += Number(row.taxCollected || 0);
        acc.businessRevenue += Number(row.businessRevenue || 0);
        acc.transactionCount += Number(row.transactionCount || 0);
        return acc;
      }, {
        totalSales: 0,
        totalCost: 0,
        totalDiscounts: 0,
        netProfit: 0,
        cashTotal: 0,
        moniepointTotal: 0,
        transferTotal: 0,
        taxCollected: 0,
        businessRevenue: 0,
        transactionCount: 0,
      });

      summary.totalExpenses = Number(totalExpenses.toFixed(2)) || 0;
      summary.trueNetProfit = Number((summary.netProfit - summary.totalExpenses).toFixed(2)) || 0;

      res.json({
        period,
        from,
        to,
        vatEnabled: Number(storeSettings?.tax_enabled || 0) === 1,
        vatPercentage: Number(storeSettings?.tax_percentage || 0) || 0,
        ledger,
        summary,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load financial ledger' });
    }
  });

  app.get('/api/reports/staff-sales-chart', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const requestedDate = String(req.query.date || '');
      const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
      const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? requestedDate
        : new Date().toISOString().split('T')[0];

      const selectedDateObj = new Date(`${selectedDate}T00:00:00`);
      if (Number.isNaN(selectedDateObj.getTime())) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      const startDateObj = new Date(selectedDateObj);
      startDateObj.setDate(startDateObj.getDate() - (days - 1));
      const toDateKey = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const startDate = toDateKey(startDateObj);

      const { staffUsers, salesRows } = await coreReadRepository.getStaffSalesChartData(storeId, startDate, selectedDate);

      const selectedMap = new Map<number, { sales_count: number; total: number; cash: number; transfer: number; pos: number }>();
      const trendMap = new Map<string, { sales_count: number; total: number }>();

      for (const row of salesRows) {
        const rowUserId = Number(row.user_id) || 0;
        const rowDate = String(row.sale_date || '');
        const rowTotal = Number(row.total) || 0;
        const methods = safeJsonParse(row.payment_methods, {});
        const trendKey = `${rowUserId}:${rowDate}`;
        const existingTrend = trendMap.get(trendKey) || { sales_count: 0, total: 0 };
        existingTrend.sales_count += 1;
        existingTrend.total += rowTotal;
        trendMap.set(trendKey, existingTrend);

        if (rowDate === selectedDate) {
          const existingSelected = selectedMap.get(rowUserId) || { sales_count: 0, total: 0, cash: 0, transfer: 0, pos: 0 };
          existingSelected.sales_count += 1;
          existingSelected.total += rowTotal;
          existingSelected.cash += Number(methods?.cash) || 0;
          existingSelected.transfer += Number(methods?.transfer) || 0;
          existingSelected.pos += Number(methods?.pos) || 0;
          selectedMap.set(rowUserId, existingSelected);
        }
      }

      const staff = staffUsers.map((member: any) => {
        const daily = selectedMap.get(Number(member.id));
        const trend = Array.from({ length: days }, (_, index) => {
          const date = new Date(startDateObj);
          date.setDate(startDateObj.getDate() + index);
          const key = toDateKey(date);
          const point = trendMap.get(`${member.id}:${key}`);

          return {
            date: key,
            label: date.toLocaleDateString('en-US', { weekday: 'short' }),
            total: Number(point?.total) || 0,
            count: Number(point?.sales_count) || 0,
          };
        });

        return {
          id: member.id,
          username: member.username,
          role: member.role,
          selectedDateTotal: Number(daily?.total) || 0,
          selectedDateCount: Number(daily?.sales_count) || 0,
          cash: Number(daily?.cash) || 0,
          transfer: Number(daily?.transfer) || 0,
          pos: Number(daily?.pos) || 0,
          trend,
        };
      }).sort((a: any, b: any) => b.selectedDateTotal - a.selectedDateTotal || a.username.localeCompare(b.username));

      const summary = staff.reduce((acc: any, member: any) => {
        acc.total += member.selectedDateTotal;
        acc.count += member.selectedDateCount;
        if (member.selectedDateCount > 0) {
          acc.activeStaff += 1;
        }
        return acc;
      }, { total: 0, count: 0, activeStaff: 0 });

      res.json({ selectedDate, days, summary, staff });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load staff sales chart' });
    }
  });

  app.get('/api/reports/staff-sales-history/:userId', authenticate, authorize(['STORE_ADMIN', 'MANAGER', 'ACCOUNTANT']), async (req: any, res: any) => {
    try {
      const storeId = Number(req.user.store_id);
      const userId = Number(req.params.userId);
      const requestedDate = String(req.query.date || '');
      const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? requestedDate
        : new Date().toISOString().split('T')[0];

      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'Invalid team member user id' });
      }

      const selectedDateObj = new Date(`${selectedDate}T00:00:00`);
      if (Number.isNaN(selectedDateObj.getTime())) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }

      const startDateObj = new Date(selectedDateObj);
      startDateObj.setDate(startDateObj.getDate() - (days - 1));
      const toDateKey = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const startDate = toDateKey(startDateObj);

      const { member, salesRows, recentSales } = await coreReadRepository.getStaffSalesHistoryData(storeId, userId, selectedDate, startDate, limit);

      if (!member) {
        return res.status(404).json({ error: 'Team member not found' });
      }
      const selectedSales = salesRows.filter((sale: any) => String(sale.sale_date) === selectedDate);
      const summary = selectedSales.reduce((acc: any, sale: any) => {
        const pm = safeJsonParse(sale.payment_methods, {});
        acc.cash += Number(pm?.cash) || 0;
        acc.transfer += Number(pm?.transfer) || 0;
        acc.pos += Number(pm?.pos) || 0;
        acc.total += Number(sale.total) || 0;
        acc.count += 1;
        return acc;
      }, { cash: 0, transfer: 0, pos: 0, total: 0, count: 0 });

      const trendMap = new Map<string, { sales_count: number; total: number }>();
      for (const row of salesRows) {
        const rowDate = String(row.sale_date || '');
        const current = trendMap.get(rowDate) || { sales_count: 0, total: 0 };
        current.sales_count += 1;
        current.total += Number(row.total) || 0;
        trendMap.set(rowDate, current);
      }

      const trend = Array.from({ length: days }, (_, index) => {
        const date = new Date(startDateObj);
        date.setDate(startDateObj.getDate() + index);
        const key = toDateKey(date);
        const point = trendMap.get(key);

        return {
          date: key,
          label: date.toLocaleDateString('en-US', { weekday: 'short' }),
          total: Number(point?.total) || 0,
          count: Number(point?.sales_count) || 0,
        };
      });

      res.json({
        staff: member,
        selectedDate,
        days,
        summary,
        trend,
        sales: await Promise.all(recentSales.map((sale: any) => formatSaleResponse(sale))),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load staff sales history' });
    }
  });

  app.get('/api/analytics', authenticate, async (req: any, res: any) => {
    const store_id = req.user.store_id;

    try {
      const storeSettings = (await postgresPool.query(`
        SELECT COALESCE(default_missing_cost_to_price, 0) as default_missing_cost_to_price
        FROM stores
        WHERE id = $1
      `, [store_id])).rows[0] as any;
      const costFallbackEnabled = Number(storeSettings?.default_missing_cost_to_price || 0) === 1;

      const missingCostRegistry = new Map<string, {
        id: number;
        name: string;
        condition: string;
        stockUnits: number;
        soldUnits: number;
        price: number;
        basePrice: number;
        conditionMatrix: unknown;
      }>();

      const registerMissingCost = ({
        productId,
        name,
        condition,
        stockUnits = 0,
        soldUnits = 0,
        price = 0,
        basePrice = 0,
        conditionMatrix = null,
      }: {
        productId: number;
        name: string;
        condition?: string | null;
        stockUnits?: number;
        soldUnits?: number;
        price?: number;
        basePrice?: number;
        conditionMatrix?: unknown;
      }) => {
        const normalizedCondition = String(condition || 'STANDARD').replace(/_/g, ' ').toUpperCase();
        const key = `${productId}:${normalizedCondition}`;
        const current = missingCostRegistry.get(key) || {
          id: productId,
          name,
          condition: normalizedCondition,
          stockUnits: 0,
          soldUnits: 0,
          price: 0,
          basePrice: 0,
          conditionMatrix: null,
        };

        current.stockUnits += Math.max(0, Number(stockUnits) || 0);
        current.soldUnits += Math.max(0, Number(soldUnits) || 0);
        current.price = Math.max(Number(current.price || 0) || 0, Math.max(0, Number(price) || 0));
        current.basePrice = Math.max(Number(current.basePrice || 0) || 0, Math.max(0, Number(basePrice) || 0));
        current.conditionMatrix = current.conditionMatrix || conditionMatrix;
        missingCostRegistry.set(key, current);
      };

      const products = (await postgresPool.query(`
        SELECT p.id, p.name, p.stock, CAST(p.cost AS REAL) as cost, CAST(p.price AS REAL) as price, p.condition_matrix, COALESCE(s.mode, 'SUPERMARKET') as mode
        FROM products p
        JOIN stores s ON p.store_id = s.id
        WHERE p.store_id = $1 AND p.deleted_at IS NULL
      `, [store_id])).rows as any[];

      let totalItems = 0;
      let totalCost = 0;
      let potentialRevenue = 0;

      for (const product of products) {
        const isGadgetMode = String(product.mode || 'SUPERMARKET').toUpperCase() === 'GADGET' && Boolean(product.condition_matrix);

        if (isGadgetMode) {
          const matrix = safeJsonParse(product.condition_matrix, {});
          for (const conditionKey of ['new', 'open_box', 'used']) {
            const slot = matrix?.[conditionKey] || {};
            const units = Math.max(0, Number(slot.stock || 0));
            const sellingPrice = Math.max(0, Number(slot.price ?? product.price ?? 0) || 0);

            if (units <= 0) continue;

            totalItems += units;
            potentialRevenue += sellingPrice * units;

            const resolvedCost = resolveTrackedCost({
              product,
              condition: conditionKey,
              sellingPrice,
              fallbackToSelling: costFallbackEnabled,
            });

            if (resolvedCost.cost != null) {
              totalCost += Number(resolvedCost.cost || 0) * units;
            } else if (!costFallbackEnabled) {
              registerMissingCost({
                productId: Number(product.id),
                name: String(product.name || `Product #${product.id}`),
                condition: conditionKey,
                stockUnits: units,
                price: sellingPrice,
                basePrice: Number(product.price || 0) || 0,
                conditionMatrix: product.condition_matrix,
              });
            }
          }
        } else {
          const units = Math.max(0, Number(product.stock || 0));
          const sellingPrice = Math.max(0, Number(product.price || 0));

          if (units <= 0) continue;

          totalItems += units;
          potentialRevenue += sellingPrice * units;

          const resolvedCost = resolveTrackedCost({
            product,
            sellingPrice,
            fallbackToSelling: costFallbackEnabled,
          });

          if (resolvedCost.cost != null) {
            totalCost += Number(resolvedCost.cost || 0) * units;
          } else if (!costFallbackEnabled) {
            registerMissingCost({
              productId: Number(product.id),
              name: String(product.name || `Product #${product.id}`),
              stockUnits: units,
              price: sellingPrice,
              basePrice: Number(product.price || 0) || 0,
              conditionMatrix: product.condition_matrix,
            });
          }
        }
      }

      const openCollectionRows = (await postgresPool.query(`
        SELECT *
        FROM market_collections
        WHERE store_id = $1 AND status = 'OPEN'
        ORDER BY expected_return_date ASC, created_at DESC
      `, [store_id])).rows as any[];

      const collectionInsights = openCollectionRows.reduce((summary: any, row: any) => {
        const collection = formatMarketCollection(row);
        summary.totalQuantity += Number(collection.total_quantity || 0);
        summary.totalValue += Number(collection.total_value || 0);
        summary.totalCost += Number(collection.total_cost || 0);
        if (collection.is_overdue) {
          summary.overdueCollections.push({
            id: Number(collection.id),
            collector_name: collection.collector_name,
            tracking_code: collection.tracking_code,
            expected_return_date: collection.expected_return_date,
            total_quantity: Number(collection.total_quantity || 0),
            total_value: Number(collection.total_value || 0),
          });
        }
        return summary;
      }, {
        totalQuantity: 0,
        totalValue: 0,
        totalCost: 0,
        overdueCollections: [],
      });

      const inventoryMetrics = {
        totalItems: Math.max(totalItems, 0),
        totalCost: Math.max(totalCost + collectionInsights.totalCost, 0),
        potentialRevenue: Math.max(potentialRevenue + collectionInsights.totalValue, 0),
      };

      const saleItems = (await postgresPool.query(`
        SELECT
          si.id,
          si.product_id,
          si.quantity,
          si.price_at_sale,
          si.cost_at_sale,
          si.condition,
          p.name as product_name,
          p.cost as product_cost,
          p.price as product_price,
          p.condition_matrix
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        LEFT JOIN products p ON si.product_id = p.id
        WHERE s.store_id = $1
          AND s.status != 'VOIDED'
          AND s.deleted_at IS NULL
      `, [store_id])).rows as any[];

      const returnRows = (await postgresPool.query('SELECT items FROM sales_returns WHERE store_id = $1', [store_id])).rows as any[];
      const returnedQuantityBySaleItem = new Map<number, number>();

      for (const row of returnRows) {
        const items = safeJsonParse(row?.items, []);
        if (!Array.isArray(items)) continue;
        for (const item of items) {
          const saleItemId = Number(item?.sale_item_id || item?.id) || 0;
          const quantity = Math.max(0, Number(item?.quantity) || 0);
          if (!saleItemId || !quantity) continue;
          returnedQuantityBySaleItem.set(saleItemId, (returnedQuantityBySaleItem.get(saleItemId) || 0) + quantity);
        }
      }

      let grossProfit = 0;
      let netProfit = 0;
      let expensesTotal = 0;
      let netProfitAfterExpenses = 0;
      let pendingReceivables = 0;
      let pendingReceivableCount = 0;
      let topCustomers: Array<{ name: string; total_spend: number }> = [];
      let imeiAgingPercentage = 0;
      let trackedProfitItems = 0;
      let excludedProfitItemsCount = 0;
      let defaultedCostItemCount = 0;

      for (const row of saleItems) {
        const soldQuantity = Math.max(0, Number(row.quantity) || 0);
        const returnedQuantity = Math.min(soldQuantity, Math.max(0, Number(returnedQuantityBySaleItem.get(Number(row.id)) || 0)));
        const netSoldQuantity = soldQuantity - returnedQuantity;
        if (netSoldQuantity <= 0) continue;

        const rowConditionMatrix = safeJsonParse(row.condition_matrix, {});
        const rowConditionKey = String(row.condition || '').toLowerCase().replace(/\s+/g, '_');
        const conditionSellingPrice = Math.max(0, Number(rowConditionMatrix?.[rowConditionKey]?.price || 0) || 0);
        const sellingPrice = Math.max(0, Number(row.price_at_sale || conditionSellingPrice || row.product_price || 0) || 0);
        const explicitCostAtSale = toFiniteNumberOrNull(row.cost_at_sale);
        let resolvedCost: number | null = null;
        let usedSellingDefault = false;

        if (explicitCostAtSale != null && (explicitCostAtSale > 0 || sellingPrice <= 0)) {
          resolvedCost = explicitCostAtSale;
        } else {
          const resolved = resolveTrackedCost({
            product: {
              cost: row.product_cost,
              price: row.product_price,
              condition_matrix: row.condition_matrix,
            },
            condition: row.condition,
            sellingPrice,
            fallbackToSelling: costFallbackEnabled,
          });
          resolvedCost = resolved.cost;
          usedSellingDefault = resolved.usedSellingDefault;

          if (resolved.missing && !costFallbackEnabled) {
            registerMissingCost({
              productId: Number(row.product_id) || 0,
              name: String(row.product_name || `Product #${row.product_id}`),
              condition: row.condition || null,
              soldUnits: netSoldQuantity,
              price: sellingPrice,
              basePrice: Number(row.product_price || 0) || 0,
              conditionMatrix: row.condition_matrix,
            });
          }
        }

        if (resolvedCost == null) {
          excludedProfitItemsCount += 1;
          continue;
        }

        if (usedSellingDefault) {
          defaultedCostItemCount += 1;
        }

        grossProfit += (sellingPrice - resolvedCost) * netSoldQuantity;
        trackedProfitItems += 1;
      }

      grossProfit = Number(grossProfit.toFixed(2)) || 0;
      netProfit = grossProfit;

      const expenseData = (await postgresPool.query(`
        SELECT COALESCE(SUM(amount), 0) as totalExpenses
        FROM expenses
        WHERE store_id = $1
      `, [store_id])).rows[0] as any;
      expensesTotal = Number(expenseData?.totalExpenses) || 0;
      netProfitAfterExpenses = Number((grossProfit - expensesTotal).toFixed(2)) || 0;

      const pendingReceivableRows = (await postgresPool.query(`
        SELECT total, payment_methods
        FROM sales
        WHERE store_id = $1 AND status = 'PENDING' AND deleted_at IS NULL
      `, [store_id])).rows as any[];

      pendingReceivableCount = pendingReceivableRows.length;
      pendingReceivables = pendingReceivableRows.reduce((sum: number, sale: any) => {
        const amountDue = Math.max(0, Number(sale?.total || 0) - getTotalPaidFromPaymentMethods(sale?.payment_methods));
        return sum + amountDue;
      }, 0);

      if (req.user.role === 'STORE_ADMIN' || req.user.role === 'ACCOUNTANT') {
        topCustomers = (await postgresPool.query(`
          SELECT c.name, SUM(s.total) as total_spend
          FROM sales s
          JOIN customers c ON s.customer_id = c.id
          WHERE s.store_id = $1 AND s.status != 'VOIDED'
          GROUP BY c.id, c.name
          ORDER BY total_spend DESC
          LIMIT 5
        `, [store_id])).rows as Array<{ name: string; total_spend: number }>;

        imeiAgingPercentage = 15;
      }

      const today = new Date().toISOString().split('T')[0];
      const todaySalesData = (await postgresPool.query(`
        SELECT SUM(total) as todaySales
        FROM sales
        WHERE store_id = $1 AND DATE(timestamp) = $2 AND status != 'VOIDED'
      `, [store_id, today])).rows[0] as any;
      const todaySales = Number(todaySalesData?.todaySales) || 0;

      const allProductsForStock = (await postgresPool.query(`
        SELECT p.id, p.name, p.stock, p.price, p.category, p.condition_matrix, COALESCE(c.name, p.category, 'General') as category_name, COALESCE(s.mode, 'SUPERMARKET') as mode
        FROM products p
        JOIN stores s ON p.store_id = s.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.store_id = $1 AND p.deleted_at IS NULL
      `, [store_id])).rows as any[];

      const recentProductSales = (await postgresPool.query(`
        SELECT si.product_id, COALESCE(SUM(si.quantity), 0) as sold_quantity, COALESCE(SUM(si.subtotal), SUM(si.price_at_sale * si.quantity), 0) as revenue
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.store_id = $1
          AND s.status != 'VOIDED'
          AND s.deleted_at IS NULL
          AND DATE(s.timestamp) >= CURRENT_DATE - INTERVAL '13 days'
        GROUP BY si.product_id
      `, [store_id])).rows as Array<{ product_id: number; sold_quantity: number; revenue: number }>;

      const recentSalesMap = new Map(recentProductSales.map((row) => [
        Number(row.product_id),
        {
          sold_quantity: Number(row.sold_quantity) || 0,
          revenue: Number(row.revenue) || 0,
        },
      ]));

      const productSignals = allProductsForStock.map((product) => {
        const currentStock = getProductTotalStock(product);
        const salesInfo = recentSalesMap.get(Number(product.id)) || { sold_quantity: 0, revenue: 0 };
        const averageDailySales = Number(salesInfo.sold_quantity || 0) / 14;
        const daysLeft = averageDailySales > 0 ? currentStock / averageDailySales : null;
        const suggestedReorder = averageDailySales > 0 ? Math.max(0, Math.ceil((averageDailySales * 14) - currentStock)) : 0;

        return {
          id: Number(product.id),
          name: product.name,
          category: product.category_name || 'General',
          stock: currentStock,
          sold_quantity: Number(salesInfo.sold_quantity) || 0,
          revenue: Number(salesInfo.revenue) || 0,
          averageDailySales,
          daysLeft,
          suggestedReorder,
        };
      });

      const lowStockItems = productSignals
        .filter((product) => product.stock < 3)
        .map((product) => ({ name: product.name, stock: product.stock }))
        .slice(0, 5);

      const topSellingProducts = productSignals
        .filter((product) => product.sold_quantity > 0)
        .sort((a, b) => b.sold_quantity - a.sold_quantity || b.revenue - a.revenue)
        .slice(0, 5)
        .map((product) => ({
          id: product.id,
          name: product.name,
          category: product.category,
          quantity: product.sold_quantity,
          revenue: product.revenue,
          stock: product.stock,
        }));

      const restockSuggestions = productSignals
        .filter((product) => product.sold_quantity > 0 && (product.stock <= 5 || (product.daysLeft !== null && product.daysLeft <= 7) || product.suggestedReorder > 0))
        .sort((a, b) => (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) || b.sold_quantity - a.sold_quantity)
        .slice(0, 5)
        .map((product) => ({
          id: product.id,
          name: product.name,
          category: product.category,
          stock: product.stock,
          quantity: product.sold_quantity,
          avgDailySales: Number(product.averageDailySales.toFixed(2)),
          daysLeft: product.daysLeft === null ? null : Number(product.daysLeft.toFixed(1)),
          suggestedReorder: Math.max(1, product.suggestedReorder || Math.ceil(product.averageDailySales * 7)),
        }));

      const salesToday = (await postgresPool.query(`
        SELECT payment_methods FROM sales
        WHERE store_id = $1 AND DATE(timestamp) = $2 AND status != 'VOIDED'
      `, [store_id, today])).rows;

      let cash = 0; let transfer = 0; let pos = 0;
      for (const s of salesToday as any[]) {
        const pm = JSON.parse(s.payment_methods);
        cash += pm.cash || 0;
        transfer += pm.transfer || 0;
        pos += pm.pos || 0;
      }
      const paymentSplit = [
        { name: 'Cash', value: cash },
        { name: 'Transfer', value: transfer },
        { name: 'POS', value: pos },
      ];

      const salesTrendRows = (await postgresPool.query(`
        SELECT DATE(timestamp) AS day, SUM(total) AS total
        FROM sales
        WHERE store_id = $1
          AND status != 'VOIDED'
          AND timestamp >= CURRENT_DATE - INTERVAL '6 days'
          AND timestamp < CURRENT_DATE + INTERVAL '1 day'
        GROUP BY DATE(timestamp)
        ORDER BY DATE(timestamp)
      `, [store_id])).rows as Array<{ day: string; total: number }>;

      // Fill in missing days with 0 so the chart always shows 7 data points
      const trendMap = new Map(salesTrendRows.map((r) => [String(r.day).slice(0, 10), Number(r.total || 0)]));
      const filledTrendRows: Array<{ day: string; total: number }> = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        filledTrendRows.push({ day: key, total: trendMap.get(key) ?? 0 });
      }
      const salesTrendRowsFilled = filledTrendRows;

      const salesTrend = salesTrendRowsFilled.map((row) => ({
        date: new Date(row.day).toLocaleDateString('en-US', { weekday: 'short' }),
        total: Number(row.total || 0) || 0,
      }));

      const categoryTrend = (await postgresPool.query(`
        SELECT COALESCE(c.name, p.category, 'Uncategorized') as category, SUM(si.quantity) as quantity
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        JOIN products p ON si.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE s.store_id = $1 AND s.status != 'VOIDED'
        GROUP BY COALESCE(c.name, p.category, 'Uncategorized')
        ORDER BY quantity DESC
        LIMIT 5
      `, [store_id])).rows;

      const missingCostItems = Array.from(missingCostRegistry.values())
        .map((item) => {
          const priceLabels = getMissingCostPriceLabels({
            price: item.price,
            condition: item.condition,
            productPrice: item.basePrice,
            conditionMatrix: item.conditionMatrix,
          });

          return {
            id: item.id,
            name: item.name,
            condition: item.condition,
            stockUnits: item.stockUnits,
            soldUnits: item.soldUnits,
            price: item.price,
            priceLabel: priceLabels.primaryLabel,
            conditionPricesLabel: priceLabels.allConditionsLabel,
          };
        })
        .sort((a, b) => b.soldUnits - a.soldUnits || b.stockUnits - a.stockUnits || a.name.localeCompare(b.name));

      res.json({
        totalItems: inventoryMetrics.totalItems || 0,
        totalCost: inventoryMetrics.totalCost || 0,
        potentialRevenue: inventoryMetrics.potentialRevenue || 0,
        grossProfit,
        netProfit,
        expensesTotal,
        netProfitAfterExpenses,
        pendingReceivables,
        pendingReceivableCount,
        outOnCollectionCount: collectionInsights.totalQuantity,
        outOnCollectionValue: collectionInsights.totalValue,
        overdueCollections: collectionInsights.overdueCollections,
        topCustomers,
        imeiAgingPercentage,
        todaySales,
        dailyTarget: 100000,
        lowStockItems,
        topSellingProducts,
        restockSuggestions,
        paymentSplit,
        salesTrend,
        categoryTrend,
        costFallbackEnabled,
        missingCostItems,
        missingCostItemCount: missingCostItems.length,
        excludedProfitItemsCount,
        defaultedCostItemCount,
        trackedProfitItems,
      });
    } catch (err: any) {
      console.error('Analytics Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sales/:id/pdf', authenticate, async (req: any, res: any) => {
    const saleId = Number(req.params.id);
    const { pdf_data, filename } = req.body;

    if (!Number.isInteger(saleId) || saleId <= 0) {
      return res.status(400).json({ error: 'Invalid sale id' });
    }

    if (!pdf_data || !filename) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const sale = (await postgresPool.query('SELECT id, pdf_path FROM sales WHERE id = $1 AND store_id = $2', [saleId, req.user.store_id])).rows[0] as { id: number; pdf_path?: string | null } | undefined;
    if (!sale) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const baseFilename = path.basename(String(filename))
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.pdf$/i, '');
    const safeFilename = `${baseFilename}-${Date.now()}.pdf`;

    const rawPdfData = String(pdf_data || '').trim();
    let pdfBase64 = '';

    if (/^data:application\/pdf/i.test(rawPdfData)) {
      const base64MarkerIndex = rawPdfData.indexOf('base64,');
      if (base64MarkerIndex === -1) {
        return res.status(400).json({ error: 'Invalid PDF data format' });
      }
      pdfBase64 = rawPdfData.slice(base64MarkerIndex + 'base64,'.length).trim();
    } else if (/^[A-Za-z0-9+/=\s]+$/.test(rawPdfData)) {
      pdfBase64 = rawPdfData.replace(/\s+/g, '');
    } else {
      return res.status(400).json({ error: 'Invalid PDF data format' });
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(pdfBase64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid PDF payload' });
    }

    if (!pdfBuffer.length) {
      return res.status(400).json({ error: 'Empty PDF payload' });
    }

    if (pdfBuffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'PDF payload too large. Please keep invoices under 10MB.' });
    }

    const filePath = path.join(uploadsDir, safeFilename);
    fs.writeFileSync(filePath, pdfBuffer);

    const previousPdfPath = String(sale.pdf_path || '').trim();
    if (previousPdfPath.startsWith('/uploads/invoices/')) {
      const previousFilename = path.basename(previousPdfPath);
      const previousFilePath = path.join(uploadsDir, previousFilename);
      if (previousFilename && previousFilename !== safeFilename && fs.existsSync(previousFilePath)) {
        try {
          fs.unlinkSync(previousFilePath);
        } catch (cleanupError) {
          console.warn('Previous invoice PDF cleanup skipped:', cleanupError);
        }
      }
    }

    await postgresPool.query('UPDATE sales SET pdf_path = $1 WHERE id = $2 AND store_id = $3', [`/uploads/invoices/${safeFilename}`, saleId, req.user.store_id]);

    res.json({ success: true, path: `/uploads/invoices/${safeFilename}` });
  });
};

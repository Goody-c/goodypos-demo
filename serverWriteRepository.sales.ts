import type { Pool, PoolClient } from 'pg';
import { computePayableAfterReturn, logVendorPayableMutation } from './serverVendorPayableRules';

type RecordSaleInput = {
  storeId: number;
  saleActorId: number;
  subtotal: number;
  discountAmount: number;
  discountType?: string | null;
  discountValue: number;
  discountNote?: string | null;
  showDiscountOnInvoice?: boolean;
  taxAmount: number;
  taxPercentage: number;
  total: number;
  paymentMethods: Record<string, number>;
  items: any[];
  status: string;
  pdfPath?: string | null;
  customerId?: number | null;
  dueDate?: string | null;
  note?: string | null;
  allowCostFallback?: boolean;
};

type CreateLayawaySaleInput = {
  storeId: number;
  requestedCustomerId?: number | null;
  customerName: string;
  customerPhone: string;
  customerAddress?: string | null;
  subtotal: number;
  paymentMethods: Record<string, number>;
  nextStatus: string;
  saleChannel: string;
  paymentPlan: unknown;
  nextLockedUntilPaid: number;
  dueDate: string;
  note?: string | null;
  userId: number;
  items: any[];
};

type ProcessSaleReturnInput = {
  storeId: number;
  saleId: number;
  processedBy: number;
  requestedItems: any[];
  reason: string;
  note?: string | null;
  refundAmount?: number;
  returnType: 'REFUND' | 'EXCHANGE' | 'RETURN_ONLY';
  refundMethod: 'cash' | 'transfer' | 'pos' | 'store_credit' | 'other';
  restockItems: boolean;
};

type VoidSaleInput = {
  storeId: number;
  saleId: number;
  voidedBy: number;
  reason: string;
};

type CreateTransactionFlagInput = {
  storeId: number;
  saleId: number;
  flaggedBy: number;
  issueType: string;
  note: string;
};

type SqlQueryClient = Pick<PoolClient, 'query'>;

const isUniqueViolation = (error: unknown) =>
  error instanceof Error && 'code' in error && (error as any).code === '23505';

const withPostgresTransaction = async <T = void>(pool: Pool, operation: (client: PoolClient) => Promise<T>, maxRetries = 3): Promise<T> => {
  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      attempt += 1;
      if (isUniqueViolation(error) && attempt < maxRetries) {
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
};

const safeJsonParse = <T>(value: unknown, fallback: T): T => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

const normalizeCollectionCondition = (value: unknown) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.toUpperCase().replace(/\s+/g, '_');
};

const toFiniteNumberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getConditionMatrixSlot = (product: any, condition?: unknown) => {
  const normalizedCondition = normalizeCollectionCondition(condition);
  if (!product?.condition_matrix || !normalizedCondition) {
    return null;
  }

  const matrix = safeJsonParse(product.condition_matrix, {} as any);
  return matrix?.[normalizedCondition.toLowerCase()] || null;
};

const resolveTrackedCost = ({
  product,
  condition,
  sellingPrice,
  fallbackToSelling = false,
}: {
  product: any;
  condition?: unknown;
  sellingPrice?: unknown;
  fallbackToSelling?: boolean;
}) => {
  const slot = getConditionMatrixSlot(product, condition);
  const normalizedCondition = String(condition || 'STANDARD').trim().toLowerCase().replace(/\s+/g, '_');
  const resolvedSellingPrice = toFiniteNumberOrNull(sellingPrice)
    ?? toFiniteNumberOrNull(slot?.price)
    ?? toFiniteNumberOrNull(product?.price)
    ?? 0;
  const slotCost = toFiniteNumberOrNull(slot?.cost ?? slot?.cost_price ?? slot?.costPrice);
  const usesConditionMatrixCost = Boolean(product?.condition_matrix) && normalizedCondition !== 'standard';

  if (usesConditionMatrixCost) {
    if (slotCost != null && (slotCost > 0 || resolvedSellingPrice <= 0)) {
      return { cost: slotCost, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
    if (fallbackToSelling) {
      return {
        cost: resolvedSellingPrice,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: resolvedSellingPrice > 0,
        sellingPrice: resolvedSellingPrice,
      };
    }
    return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
  }

  const candidateCosts = [slotCost, toFiniteNumberOrNull(product?.cost)];
  for (const candidate of candidateCosts) {
    if (candidate != null && (candidate > 0 || resolvedSellingPrice <= 0)) {
      return { cost: candidate, missing: false, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
    }
  }

  if (fallbackToSelling) {
    return {
      cost: resolvedSellingPrice,
      missing: resolvedSellingPrice > 0,
      usedSellingDefault: resolvedSellingPrice > 0,
      sellingPrice: resolvedSellingPrice,
    };
  }

  return { cost: null, missing: resolvedSellingPrice > 0, usedSellingDefault: false, sellingPrice: resolvedSellingPrice };
};

const getTotalPaidFromPaymentMethods = (paymentMethods: any) => {
  const methods = safeJsonParse(paymentMethods, {} as any);
  return ['cash', 'transfer', 'pos'].reduce((sum, key) => sum + Math.max(0, Number(methods?.[key]) || 0), 0);
};

const getSingleQueryRow = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return (result.rows[0] ?? null) as T | null;
};

const getQueryRows = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return result.rows as T[];
};

const syncInventoryBatchQuantityForQueryClient = async ({
  client,
  productId,
  storeId,
  condition,
  quantityDelta,
}: {
  client: SqlQueryClient;
  productId: number;
  storeId: number;
  condition?: string | null;
  quantityDelta: number;
}) => {
  const delta = Math.trunc(Number(quantityDelta) || 0);
  if (!delta) return;

  const normalizedCondition = normalizeCollectionCondition(condition);
  const rows = await getQueryRows<any>(client, `
    SELECT id, quantity_received, quantity_remaining
    FROM inventory_batches
    WHERE store_id = $1
      AND product_id = $2
      AND (($3::text IS NULL AND condition IS NULL) OR condition = $4)
    ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC
  `, [storeId, productId, normalizedCondition, normalizedCondition]);

  if (delta < 0) {
    let remainingToConsume = Math.abs(delta);
    for (const row of rows) {
      if (remainingToConsume <= 0) break;
      const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
      const consume = Math.min(currentRemaining, remainingToConsume);
      if (consume > 0) {
        await client.query('UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2', [currentRemaining - consume, Number(row.id)]);
        remainingToConsume -= consume;
      }
    }
    return;
  }

  let remainingToAdd = delta;
  const rowsDescending = [...rows].reverse();
  for (const row of rowsDescending) {
    if (remainingToAdd <= 0) break;
    const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
    const currentRemaining = Math.max(0, Number(row?.quantity_remaining || 0) || 0);
    const availableRoom = Math.max(0, currentReceived - currentRemaining);
    const addBack = Math.min(availableRoom, remainingToAdd);
    if (addBack > 0) {
      await client.query('UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2', [currentRemaining + addBack, Number(row.id)]);
      remainingToAdd -= addBack;
    }
  }

  if (remainingToAdd > 0) {
    const newestRow = rowsDescending[0];
    if (newestRow?.id) {
      const currentReceived = Math.max(0, Number(newestRow?.quantity_received || 0) || 0);
      const currentRemaining = Math.max(0, Number(newestRow?.quantity_remaining || 0) || 0);
      await client.query(
        'UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3',
        [currentReceived + remainingToAdd, currentRemaining + remainingToAdd, Number(newestRow.id)],
      );
    }
  }
};

const getProductStockSnapshotForQueryClient = async ({
  client,
  productId,
  storeId,
  condition,
}: {
  client: SqlQueryClient;
  productId: number;
  storeId: number;
  condition?: string | null;
}) => {
  const product = await getSingleQueryRow<any>(client, 'SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1', [productId, storeId]);
  if (!product) {
    throw new Error(`Product #${productId} not found`);
  }

  const normalizedCondition = normalizeCollectionCondition(condition);

  // Only apply condition_matrix logic for GADGET mode stores.
  // SUPERMARKET mode products use products.stock as the canonical stock value.
  const store = await getSingleQueryRow<any>(client, 'SELECT mode FROM stores WHERE id = $1 LIMIT 1', [storeId]);
  const storeMode = String(store?.mode || '').toUpperCase();
  const isGadgetStore = storeMode === 'GADGET';

  if (isGadgetStore && product.condition_matrix && normalizedCondition) {
    const matrix = safeJsonParse(product.condition_matrix, {} as any);
    const conditionKey = normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${normalizedCondition.replace(/_/g, ' ')} is not available for ${product.name}`);
    }

    return {
      product,
      normalizedCondition,
      usesConditionMatrix: true,
      currentStock: Math.max(0, Number(slot.stock || 0)),
    };
  }

  if (isGadgetStore && product.condition_matrix && !normalizedCondition) {
    throw new Error(`Select a product condition for ${product.name} before adjusting stock.`);
  }

  return {
    product,
    normalizedCondition: null,
    usesConditionMatrix: false,
    currentStock: Math.max(0, Number(product.stock || 0)),
  };
};

const updateProductAvailableStockForQueryClient = async ({
  client,
  productId,
  storeId,
  quantity,
  condition,
  operation,
}: {
  client: SqlQueryClient;
  productId: number;
  storeId: number;
  quantity: number;
  condition?: string | null;
  operation: 'increase' | 'decrease';
}) => {
  const snapshot = await getProductStockSnapshotForQueryClient({ client, productId, storeId, condition });
  const normalizedQuantity = Math.max(0, Number(quantity) || 0);
  if (!normalizedQuantity) {
    throw new Error('Invalid collection quantity supplied');
  }

  if (snapshot.usesConditionMatrix && snapshot.normalizedCondition) {
    const matrix = safeJsonParse(snapshot.product.condition_matrix, {} as any);
    const conditionKey = snapshot.normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];

    if (!slot) {
      throw new Error(`Condition ${snapshot.normalizedCondition.replace(/_/g, ' ')} is not available for ${snapshot.product.name}`);
    }

    const currentStock = Number(slot.stock || 0);
    const nextStock = operation === 'decrease' ? currentStock - normalizedQuantity : currentStock + normalizedQuantity;
    if (nextStock < 0) {
      throw new Error(`Not enough available stock for ${snapshot.product.name}`);
    }

    slot.stock = nextStock;
    await client.query('UPDATE products SET condition_matrix = $1 WHERE id = $2 AND store_id = $3', [JSON.stringify(matrix), productId, storeId]);
    await syncInventoryBatchQuantityForQueryClient({
      client,
      productId,
      storeId,
      condition: snapshot.normalizedCondition,
      quantityDelta: operation === 'decrease' ? -normalizedQuantity : normalizedQuantity,
    });
    return snapshot.product;
  }

  const currentStock = Number(snapshot.product.stock || 0);
  const nextStock = operation === 'decrease' ? currentStock - normalizedQuantity : currentStock + normalizedQuantity;
  if (nextStock < 0) {
    throw new Error(`Not enough available stock for ${snapshot.product.name}`);
  }

  await client.query('UPDATE products SET stock = $1 WHERE id = $2 AND store_id = $3', [nextStock, productId, storeId]);
  await syncInventoryBatchQuantityForQueryClient({
    client,
    productId,
    storeId,
    condition: snapshot.normalizedCondition,
    quantityDelta: operation === 'decrease' ? -normalizedQuantity : normalizedQuantity,
  });
  return snapshot.product;
};

const getSaleItemsForInvoiceForQueryClient = async (client: SqlQueryClient, saleId: number) => {
  const normalizeSaleItemSpecs = (value: any) => {
    const specs = safeJsonParse(value, {} as any);
    const sourced = Boolean(specs?.sourced_item);
    const consignment = Boolean(specs?.consignment_item);
    const consignmentItemId = Math.max(0, Number(specs?.consignment_item_id || 0) || 0);
    const consignmentItemName = consignment
      ? String(specs?.consignment_item_name || specs?.item_name || '').trim()
      : '';
    return {
      specs,
      isSourced: sourced,
      isConsignment: consignment,
      sourcedItemName: sourced ? String(specs?.sourced_item_name || '').trim() : '',
      sourcedVendorName: sourced ? String(specs?.sourced_vendor_name || '').trim() : '',
      sourcedVendorReference: sourced ? String(specs?.sourced_vendor_reference || '').trim() : '',
      sourcedCostPrice: sourced ? Math.max(0, Number(specs?.sourced_cost_price || 0) || 0) : null,
      consignmentItemId,
      consignmentItemName,
    };
  };

  const items = await getQueryRows<any>(client, `
    SELECT si.*, p.name as product_name, p.quick_code as product_quick_code, p.specs as product_specs, COALESCE(c.name, p.category, 'General') as category_name
    FROM sale_items si
    LEFT JOIN products p ON si.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE si.sale_id = $1
    ORDER BY si.id ASC
  `, [saleId]);

  const returnRows = await getQueryRows<any>(client, 'SELECT items FROM sales_returns WHERE sale_id = $1 ORDER BY id ASC', [saleId]);
  const parsedSpecsBySaleItemId = new Map<number, ReturnType<typeof normalizeSaleItemSpecs>>();
  const consignmentItemIds = new Set<number>();

  for (const item of items) {
    const parsed = normalizeSaleItemSpecs(item.specs_at_sale);
    const saleItemId = Number(item?.id || 0);
    if (saleItemId > 0) {
      parsedSpecsBySaleItemId.set(saleItemId, parsed);
    }
    if (parsed.isConsignment && parsed.consignmentItemId > 0) {
      consignmentItemIds.add(parsed.consignmentItemId);
    }
  }

  const consignmentNameById = new Map<number, string>();
  if (consignmentItemIds.size > 0) {
    const ids = Array.from(consignmentItemIds.values());
    const consignmentRows = await getQueryRows<any>(client, 'SELECT id, item_name FROM consignment_items WHERE id = ANY($1::int[])', [ids]);
    consignmentRows.forEach((row) => {
      consignmentNameById.set(Number(row?.id || 0), String(row?.item_name || '').trim());
    });
  }
  const returnedQuantityBySaleItem = new Map<number, number>();

  for (const row of returnRows) {
    const parsedItems = safeJsonParse(row?.items, [] as any[]);
    for (const returnedItem of parsedItems) {
      const saleItemId = Number(returnedItem?.sale_item_id || returnedItem?.id);
      const quantity = Math.max(0, Number(returnedItem?.quantity) || 0);
      if (!saleItemId || !quantity) continue;
      returnedQuantityBySaleItem.set(saleItemId, (returnedQuantityBySaleItem.get(saleItemId) || 0) + quantity);
    }
  }

  return items.map((item) => {
    const soldQuantity = Math.max(0, Number(item.quantity) || 0);
    const returnedQuantity = Math.min(soldQuantity, Math.max(0, Number(returnedQuantityBySaleItem.get(Number(item.id)) || 0)));
    const parsed = parsedSpecsBySaleItemId.get(Number(item.id)) || normalizeSaleItemSpecs(item.specs_at_sale);
    const productName = String(item.product_name || '').trim();
    const isPlaceholderProduct = productName === '__CONSIGNMENT_PLACEHOLDER__' || productName === '__SOURCED_PLACEHOLDER__';
    const resolvedName = parsed.isSourced
      ? (parsed.sourcedItemName || productName || `Product #${item.product_id}`)
      : parsed.isConsignment
        ? (parsed.consignmentItemName || consignmentNameById.get(parsed.consignmentItemId) || (!isPlaceholderProduct ? productName : '') || `Consignment Item #${parsed.consignmentItemId || item.product_id}`)
        : (productName || `Product #${item.product_id}`);

    return {
      ...item,
      product_name: resolvedName,
      item_source: parsed.isSourced ? 'SOURCED' : (parsed.isConsignment ? 'CONSIGNMENT' : 'INVENTORY'),
      sourced_vendor_name: parsed.sourcedVendorName || null,
      sourced_vendor_reference: parsed.sourcedVendorReference || null,
      quantity: soldQuantity,
      returned_quantity: returnedQuantity,
      returnable_quantity: Math.max(0, soldQuantity - returnedQuantity),
      subtotal: Number(item.subtotal || 0) || (Number(item.price_at_sale || 0) * soldQuantity),
      cost_at_sale: parsed.isSourced
        ? parsed.sourcedCostPrice
        : (item.cost_at_sale == null ? null : Number(item.cost_at_sale || 0)),
      specs_at_sale: parsed.specs,
    };
  });
};


const getOrCreateSourcedPlaceholderProductForQueryClient = async (client: SqlQueryClient, storeId: number) => {
  const markerName = '__SOURCED_PLACEHOLDER__';
  const existing = await getSingleQueryRow<{ id: number }>(client, 'SELECT id FROM products WHERE store_id = $1 AND name = $2 LIMIT 1', [storeId, markerName]);
  if (existing?.id) {
    return Number(existing.id);
  }

  const inserted = await client.query(`
    INSERT INTO products (store_id, name, barcode, category, quick_code, specs, condition_matrix, price, stock, cost, deleted_at)
    VALUES ($1, $2, NULL, 'Sourced', NULL, '{}', NULL, 0, 0, 0, CURRENT_TIMESTAMP)
    RETURNING id
  `, [storeId, markerName]);

  return Number(inserted.rows[0]?.id || 0);
};


const getOrCreateConsignmentPlaceholderProductForQueryClient = async (client: SqlQueryClient, storeId: number) => {
  const markerName = '__CONSIGNMENT_PLACEHOLDER__';
  const existing = await getSingleQueryRow<{ id: number }>(client, 'SELECT id FROM products WHERE store_id = $1 AND name = $2 LIMIT 1', [storeId, markerName]);
  if (existing?.id) {
    return Number(existing.id);
  }

  const inserted = await client.query(`
    INSERT INTO products (store_id, name, barcode, category, quick_code, specs, condition_matrix, price, stock, cost, deleted_at)
    VALUES ($1, $2, NULL, 'Consignment', NULL, '{}', NULL, 0, 0, 0, CURRENT_TIMESTAMP)
    RETURNING id
  `, [storeId, markerName]);

  return Number(inserted.rows[0]?.id || 0);
};

export const createSalesWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async createSale(input: RecordSaleInput) {

    let saleId = 0;

    await withPostgresTransaction(postgresPool, async (client) => {
      let saleResult;
      try {
        saleResult = await client.query(`
          INSERT INTO sales (store_id, subtotal, discount_amount, discount_type, discount_value, discount_note, show_discount_on_invoice, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, customer_id, due_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING id
        `, [
          input.storeId,
          input.subtotal,
          input.discountAmount,
          input.discountType || null,
          input.discountValue,
          input.discountNote || null,
          input.showDiscountOnInvoice === false ? 0 : 1,
          input.taxAmount,
          input.taxPercentage,
          input.total,
          input.saleActorId,
          JSON.stringify(input.paymentMethods),
          input.status || 'COMPLETED',
          input.pdfPath || null,
          input.customerId || null,
          input.dueDate || null,
          input.note || null,
        ]);
      } catch (error: any) {
        const missingShowDiscountColumn = String(error?.code || '') === '42703'
          || /show_discount_on_invoice/i.test(String(error?.message || ''));
        if (!missingShowDiscountColumn) {
          throw error;
        }

        saleResult = await client.query(`
          INSERT INTO sales (store_id, subtotal, discount_amount, discount_type, discount_value, discount_note, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, customer_id, due_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
          RETURNING id
        `, [
          input.storeId,
          input.subtotal,
          input.discountAmount,
          input.discountType || null,
          input.discountValue,
          input.discountNote || null,
          input.taxAmount,
          input.taxPercentage,
          input.total,
          input.saleActorId,
          JSON.stringify(input.paymentMethods),
          input.status || 'COMPLETED',
          input.pdfPath || null,
          input.customerId || null,
          input.dueDate || null,
          input.note || null,
        ]);
      }

      const insertedSaleId = saleResult.rows[0]?.id;
      if (!insertedSaleId) throw new Error('Failed to create sale: no ID returned from database');
      saleId = Number(insertedSaleId);
      let sourcedPlaceholderProductId: number | null = null;
      let consignmentPlaceholderProductId: number | null = null;
      let totalMarkupAmount = 0;
      const markupItemSummaries: Array<{ name: string; base_price: number; sale_price: number; markup: number; quantity: number }> = [];

      for (const item of input.items) {
        const quantity = Math.max(1, Number(item.quantity || 0) || 1);
        const unitPrice = Math.max(0, Number(item.price_at_sale || 0) || 0);
        const subtotal = Number((unitPrice * quantity).toFixed(2));
        const isSourced = Boolean(item?.is_sourced || item?.sourced_item || item?.item_source === 'SOURCED');
        const isConsignment = Boolean(item?.is_consignment || item?.consignment_item || item?.item_source === 'CONSIGNMENT');
        const sourcedVendorName = String(item?.sourced_vendor_name || '').trim();
        const sourcedVendorReference = String(item?.sourced_vendor_reference || '').trim();
        const sourcedItemName = String(item?.name || item?.product_name || '').trim();
        const consignmentItemName = String(item?.name || item?.product_name || '').trim();
        const sourcedCostPrice = Math.max(0, Number(item?.sourced_cost_price ?? item?.cost_at_sale ?? 0) || 0);
        const consignmentItemId = Math.max(0, Number(item?.consignment_item_id || 0) || 0);
        const consignmentVendorName = String(item?.vendor_name || item?.consignment_vendor_name || '').trim();
        const consignmentImei = String(item?.imei_serial || '').trim();
        const consignmentPayout = Math.max(0, Number(item?.agreed_payout ?? item?.cost_at_sale ?? 0) || 0);
        const consignmentPublicSpecs = item?.public_specs && typeof item.public_specs === 'object'
          ? item.public_specs
          : (item?.specs_at_sale && typeof item.specs_at_sale === 'object' ? item.specs_at_sale : {});

        if (isSourced && !sourcedPlaceholderProductId) {
          sourcedPlaceholderProductId = await getOrCreateSourcedPlaceholderProductForQueryClient(client, input.storeId);
        }

        if (isConsignment && !consignmentPlaceholderProductId) {
          consignmentPlaceholderProductId = await getOrCreateConsignmentPlaceholderProductForQueryClient(client, input.storeId);
        }

        const resolvedProductId = isSourced
          ? Number(sourcedPlaceholderProductId || 0)
          : (isConsignment ? Number(consignmentPlaceholderProductId || 0) : Number(item.product_id));
        const product = (!isSourced && !isConsignment)
          ? await getSingleQueryRow<any>(client, 'SELECT * FROM products WHERE id = $1', [resolvedProductId])
          : null;

        const resolvedCostAtSale = resolveTrackedCost({
          product,
          condition: item.condition || null,
          sellingPrice: unitPrice,
          fallbackToSelling: Boolean(input.allowCostFallback),
        });
        const specsAtSale = {
          ...(item.specs_at_sale || {}),
          ...(isSourced
            ? {
                sourced_item: true,
                sourced_item_name: sourcedItemName || 'Sourced Item',
                sourced_vendor_name: sourcedVendorName,
                sourced_vendor_reference: sourcedVendorReference || null,
                sourced_cost_price: sourcedCostPrice,
              }
            : {}),
          ...(isConsignment
            ? {
                consignment_item: true,
                consignment_item_id: consignmentItemId || null,
                consignment_item_name: consignmentItemName || null,
                vendor_name: consignmentVendorName,
                imei_serial: consignmentImei || null,
                public_specs: consignmentPublicSpecs || {},
              }
            : {}),
        };
        const effectiveCostAtSale = isSourced
          ? sourcedCostPrice
          : (isConsignment ? consignmentPayout : resolvedCostAtSale.cost);

        const basePriceAtSale = Math.max(0, Number(item.base_price_at_sale ?? unitPrice) || 0);
        const priceMarkup = Math.max(0, Number((unitPrice - basePriceAtSale).toFixed(2)));

        if (priceMarkup > 0) {
          totalMarkupAmount = Number((totalMarkupAmount + priceMarkup * quantity).toFixed(2));
          markupItemSummaries.push({
            name: String(item.name || `Product #${item.product_id}`).trim(),
            base_price: basePriceAtSale,
            sale_price: unitPrice,
            markup: priceMarkup,
            quantity,
          });
        }

        const saleItemInsert = await client.query(`
          INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, base_price_at_sale, price_markup, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `, [
          saleId,
          resolvedProductId,
          quantity,
          unitPrice,
          basePriceAtSale,
          priceMarkup,
          subtotal,
          effectiveCostAtSale,
          item.imei_serial || null,
          item.condition || null,
          JSON.stringify(specsAtSale),
        ]);
        const saleItemId = Number(saleItemInsert.rows[0]?.id || 0);

        if (isSourced && saleItemId > 0 && sourcedVendorName) {
          const amountDue = Number((sourcedCostPrice * quantity).toFixed(2));
          await client.query(`
            INSERT INTO vendor_payables (store_id, sale_id, sale_item_id, source_type, vendor_name, vendor_reference, item_name, amount_due, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UNPAID')
          `, [
            input.storeId,
            saleId,
            saleItemId,
            'SOURCED',
            sourcedVendorName,
            sourcedVendorReference || null,
            sourcedItemName || 'Sourced Item',
            amountDue,
          ]);
          logVendorPayableMutation({
            action: 'created',
            storeId: input.storeId,
            saleId,
            saleItemId,
            sourceType: 'SOURCED',
            amountDue,
          });
        }

        if (isConsignment && saleItemId > 0 && consignmentVendorName) {
          const amountDue = Number((consignmentPayout * quantity).toFixed(2));
          await client.query(`
            INSERT INTO vendor_payables (store_id, sale_id, sale_item_id, source_type, vendor_name, vendor_reference, item_name, amount_due, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UNPAID')
          `, [
            input.storeId,
            saleId,
            saleItemId,
            'CONSIGNMENT',
            consignmentVendorName,
            consignmentImei || consignmentItemName || null,
            consignmentItemName || 'Consignment Item',
            amountDue,
          ]);
          logVendorPayableMutation({
            action: 'created',
            storeId: input.storeId,
            saleId,
            saleItemId,
            sourceType: 'CONSIGNMENT',
            amountDue,
          });
        }

        if (isConsignment && consignmentItemId > 0) {
          const consignmentRow = await getSingleQueryRow<{ quantity: number; status: string; public_specs: any }>(
            client,
            'SELECT quantity, status, public_specs FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1',
            [consignmentItemId, input.storeId],
          );
          if (!consignmentRow) {
            throw new Error('Consignment item not found while posting sale.');
          }

          const currentQuantity = Math.max(0, Math.trunc(Number(consignmentRow.quantity || 0) || 0));
          const publicSpecs = safeJsonParse(consignmentRow.public_specs, {} as any);
          const rawMatrix = publicSpecs && typeof publicSpecs === 'object' ? publicSpecs.__condition_matrix : null;
          const matrixKeys = ['new', 'open_box', 'used'];
          const normalizedMatrix = rawMatrix && typeof rawMatrix === 'object'
            ? matrixKeys.reduce((acc: any, key) => {
                const source = rawMatrix[key] && typeof rawMatrix[key] === 'object' ? rawMatrix[key] : {};
                acc[key] = {
                  price: Math.max(0, Number(source.price || 0) || 0),
                  cost: Math.max(0, Number(source.cost || 0) || 0),
                  stock: Math.max(0, Math.trunc(Number(source.stock || 0) || 0)),
                };
                return acc;
              }, {})
            : null;

          const matrixTotalStock = normalizedMatrix
            ? matrixKeys.reduce((sum, key) => sum + Math.max(0, Math.trunc(Number(normalizedMatrix[key]?.stock || 0) || 0)), 0)
            : 0;
          const availableQuantity = Math.max(currentQuantity, matrixTotalStock);

          if (availableQuantity < quantity) {
            throw new Error('Consignment quantity is insufficient for this sale.');
          }

          const nextQuantity = Math.max(0, availableQuantity - quantity);
          const previousSoldQuantity = Math.max(0, Math.trunc(Number((publicSpecs as any)?.__sold_quantity_total || 0) || 0));
          const previousSoldAmount = Math.max(0, Number((publicSpecs as any)?.__sold_amount_total || 0) || 0);
          const nextSoldQuantity = previousSoldQuantity + Math.max(0, Math.trunc(Number(quantity) || 0));
          const soldIncrementAmount = Math.max(0, Number(subtotal || 0) || 0);
          const nextSoldAmount = Number((previousSoldAmount + soldIncrementAmount).toFixed(2));
          const nextPublicSpecsBase = {
            ...(publicSpecs && typeof publicSpecs === 'object' ? publicSpecs : {}),
            __sold_quantity_total: nextSoldQuantity,
            __sold_amount_total: nextSoldAmount,
            __last_sold_at: new Date().toISOString(),
          };

          if (normalizedMatrix) {
            let remainingToDeduct = Math.max(0, Math.trunc(quantity) || 0);
            for (const key of matrixKeys) {
              if (remainingToDeduct <= 0) break;
              const stock = Math.max(0, Math.trunc(Number(normalizedMatrix[key]?.stock || 0) || 0));
              if (stock <= 0) continue;
              const deduction = Math.min(stock, remainingToDeduct);
              normalizedMatrix[key].stock = stock - deduction;
              remainingToDeduct -= deduction;
            }

            const nextPublicSpecs = {
              ...nextPublicSpecsBase,
              __condition_matrix: normalizedMatrix,
            };

            await client.query(
              "UPDATE consignment_items SET quantity = $1, status = $2, public_specs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND store_id = $5",
              [nextQuantity, nextQuantity <= 0 ? 'sold' : 'approved', JSON.stringify(nextPublicSpecs), consignmentItemId, input.storeId],
            );
          } else {
            await client.query(
              "UPDATE consignment_items SET quantity = $1, status = $2, public_specs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND store_id = $5",
              [nextQuantity, nextQuantity <= 0 ? 'sold' : 'approved', JSON.stringify(nextPublicSpecsBase), consignmentItemId, input.storeId],
            );
          }
        }

        if (product && !isSourced && !isConsignment) {
          await updateProductAvailableStockForQueryClient({
            client,
            productId: Number(resolvedProductId),
            storeId: input.storeId,
            quantity,
            condition: item.condition || null,
            operation: 'decrease',
          });
        }
      }

      if (totalMarkupAmount > 0 && saleId > 0) {
        const markupNote = markupItemSummaries
          .map((m) => `${m.name}: +${m.markup} markup (${m.base_price} → ${m.sale_price}) × ${m.quantity}`)
          .join('; ');
        await client.query(
          `INSERT INTO transaction_flags (store_id, sale_id, flagged_by, issue_type, note, status)
           VALUES ($1, $2, $3, 'PRICE_MARKUP', $4, 'OPEN')`,
          [
            input.storeId,
            saleId,
            input.saleActorId,
            `Price markup of ${totalMarkupAmount} applied on Sale #${saleId}. ${markupNote}`.slice(0, 1000),
          ],
        );
      }
    });

    return { saleId };

  },

  async createLayawaySale(input: CreateLayawaySaleInput) {

    let createdSale: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      let customerId = input.requestedCustomerId && Number.isInteger(input.requestedCustomerId) && input.requestedCustomerId > 0
        ? input.requestedCustomerId
        : null;

      if (customerId) {
        const existingCustomer = await getSingleQueryRow<any>(client, 'SELECT id FROM customers WHERE id = $1 AND store_id = $2 LIMIT 1', [customerId, input.storeId]);
        if (!existingCustomer) {
          throw new Error('Selected customer no longer exists for this store.');
        }
      } else {
        const existingByPhone = input.customerPhone
          ? await getSingleQueryRow<any>(client, 'SELECT id FROM customers WHERE store_id = $1 AND phone = $2 LIMIT 1', [input.storeId, input.customerPhone])
          : null;

        if (existingByPhone?.id) {
          customerId = Number(existingByPhone.id);
        } else {
          const result = await client.query(
            'INSERT INTO customers (store_id, name, phone, address) VALUES ($1, $2, $3, $4) RETURNING id',
            [input.storeId, input.customerName, input.customerPhone, input.customerAddress || null],
          );
          customerId = Number(result.rows[0]?.id || 0);
        }
      }

      const saleResult = await client.query(`
        INSERT INTO sales (
          store_id, subtotal, discount_amount, discount_type, discount_value, discount_note,
          tax_amount, tax_percentage, total, user_id, payment_methods, status,
          sale_channel, payment_plan, locked_until_paid, pdf_path, customer_id, due_date, note
        ) VALUES ($1, $2, 0, NULL, 0, NULL, 0, 0, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12)
        RETURNING id
      `, [
        input.storeId,
        input.subtotal,
        input.subtotal,
        input.userId,
        JSON.stringify(input.paymentMethods),
        input.nextStatus,
        input.saleChannel,
        JSON.stringify(input.paymentPlan),
        input.nextLockedUntilPaid,
        customerId,
        input.dueDate,
        input.note || null,
      ]);

      const saleId = Number(saleResult.rows[0]?.id || 0);

      for (const item of input.items) {
        await client.query(`
          INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          saleId,
          Number(item.product_id),
          Number(item.quantity) || 0,
          Number(item.price_at_sale) || 0,
          Number(item.subtotal) || 0,
          Number(item.cost_at_sale) || 0,
          item.imei_serial || null,
          item.condition || null,
          JSON.stringify(item.specs_at_sale || {}),
        ]);

        await updateProductAvailableStockForQueryClient({
          client,
          productId: Number(item.product_id),
          storeId: input.storeId,
          quantity: Number(item.quantity) || 0,
          condition: item.condition || null,
          operation: 'decrease',
        });
      }

      createdSale = await getSingleQueryRow<any>(client, `
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.id = $1 AND s.store_id = $2
      `, [saleId, input.storeId]);
    });

    return createdSale;

  },

  async processSaleReturn(input: ProcessSaleReturnInput) {

    let result: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const sale = await getSingleQueryRow<any>(client, `
        SELECT s.*
        FROM sales s
        WHERE s.id = $1 AND s.store_id = $2 AND s.deleted_at IS NULL
      `, [input.saleId, input.storeId]);

      if (!sale) {
        throw new Error('Sale not found');
      }

      if (String(sale.status || '').toUpperCase() === 'VOIDED') {
        throw new Error('Voided sales cannot be returned again');
      }

      const saleItems = await getSaleItemsForInvoiceForQueryClient(client, input.saleId);
      if (!saleItems.length) {
        throw new Error('No sale items found for this invoice');
      }

      const saleItemMap = new Map<number, any>(saleItems.map((item: any) => [Number(item.id), item]));
      const processedItems = input.requestedItems
        .map((rawItem: any) => {
          const saleItemId = Number(rawItem?.sale_item_id || rawItem?.id);
          const requestedQuantity = Math.max(0, Number(rawItem?.quantity) || 0);
          const saleItem = saleItemMap.get(saleItemId);

          if (!saleItem || !requestedQuantity) {
            return null;
          }

          const availableQuantity = Math.max(0, Number(saleItem.returnable_quantity ?? saleItem.quantity) || 0);
          if (requestedQuantity > availableQuantity) {
            throw new Error(`${saleItem.product_name || 'Item'} only has ${availableQuantity} returnable unit(s) left.`);
          }

          return {
            consignment_item_id: Math.max(0, Number(saleItem?.specs_at_sale?.consignment_item_id || 0) || 0),
            sale_item_id: saleItemId,
            product_id: Number(saleItem.product_id) || 0,
            name: saleItem.product_name || `Product #${saleItem.product_id}`,
            quantity: requestedQuantity,
            price_at_sale: Number(saleItem.price_at_sale || 0) || 0,
            subtotal: Number((Number(saleItem.price_at_sale || 0) * requestedQuantity).toFixed(2)) || 0,
            condition: saleItem.condition || null,
            imei_serial: saleItem.imei_serial || null,
            item_source: String(saleItem.item_source || '').toUpperCase() === 'SOURCED'
              ? 'SOURCED'
              : (String(saleItem.item_source || '').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'INVENTORY'),
            sourced_vendor_name: saleItem.sourced_vendor_name || null,
            sourced_vendor_reference: saleItem.sourced_vendor_reference || null,
            sourced_cost_price: Math.max(0, Number(saleItem.cost_at_sale || 0) || 0),
            return_to_vendor_required: ['SOURCED', 'CONSIGNMENT'].includes(String(saleItem.item_source || '').toUpperCase()),
            specs_at_sale: safeJsonParse(saleItem.specs_at_sale, {} as any),
          };
        })
        .filter(Boolean) as any[];

      if (!processedItems.length) {
        throw new Error('Choose at least one return quantity greater than zero.');
      }

      const returnedValue = Number(processedItems.reduce((sum: number, item: any) => sum + (Number(item.subtotal) || 0), 0).toFixed(2)) || 0;
      const requestedRefundAmount = Math.max(0, Number((input as any)?.refundAmount || 0) || 0);
      const refundAmount = requestedRefundAmount > 0 ? requestedRefundAmount : input.returnType === 'REFUND' ? returnedValue : 0;

      if (refundAmount > returnedValue + 0.009) {
        throw new Error('Refund amount cannot be greater than the selected return value.');
      }

      if (input.restockItems) {
        for (const item of processedItems) {
          const itemSource = String(item.item_source || '').toUpperCase();
          if (itemSource === 'SOURCED') {
            continue;
          }
          if (itemSource === 'CONSIGNMENT') {
            const consignmentItemId = Math.max(0, Number(item?.consignment_item_id || item?.specs_at_sale?.consignment_item_id || 0) || 0);
            if (consignmentItemId <= 0) {
              continue;
            }

            const consignmentRow = await getSingleQueryRow<any>(client, `
              SELECT id, quantity, status, public_specs
              FROM consignment_items
              WHERE id = $1 AND store_id = $2
              LIMIT 1
            `, [consignmentItemId, input.storeId]);

            if (!consignmentRow?.id) {
              continue;
            }

            const returnedQty = Math.max(0, Math.trunc(Number(item.quantity || 0) || 0));
            const currentQuantity = Math.max(0, Math.trunc(Number(consignmentRow.quantity || 0) || 0));
            const publicSpecs = safeJsonParse(consignmentRow.public_specs, {} as any);
            const nextReturnedQuantity = Math.max(0, Math.trunc(Number((publicSpecs as any)?.__returned_quantity_total || 0) || 0)) + returnedQty;
            const nextReturnedAmount = Number((Math.max(0, Number((publicSpecs as any)?.__returned_amount_total || 0) || 0) + Math.max(0, Number(item.subtotal || 0) || 0)).toFixed(2));
            const nextSoldQuantity = Math.max(0, Math.trunc(Number((publicSpecs as any)?.__sold_quantity_total || 0) || 0) - returnedQty);
            const nextSoldAmount = Number((Math.max(0, Number((publicSpecs as any)?.__sold_amount_total || 0) || 0) - Math.max(0, Number(item.subtotal || 0) || 0)).toFixed(2));
            const nextQuantity = Math.max(0, currentQuantity + returnedQty);

            const rawMatrix = publicSpecs && typeof publicSpecs === 'object' ? (publicSpecs as any).__condition_matrix : null;
            const matrixKeys = ['new', 'open_box', 'used'];
            let nextPublicSpecs: any = {
              ...(publicSpecs && typeof publicSpecs === 'object' ? publicSpecs : {}),
              __returned_quantity_total: nextReturnedQuantity,
              __returned_amount_total: nextReturnedAmount,
              __sold_quantity_total: nextSoldQuantity,
              __sold_amount_total: nextSoldAmount,
              __last_returned_at: new Date().toISOString(),
            };

            if (rawMatrix && typeof rawMatrix === 'object') {
              const normalizedMatrix = matrixKeys.reduce((acc: any, key) => {
                const source = rawMatrix[key] && typeof rawMatrix[key] === 'object' ? rawMatrix[key] : {};
                acc[key] = {
                  price: Math.max(0, Number(source.price || 0) || 0),
                  cost: Math.max(0, Number(source.cost || 0) || 0),
                  stock: Math.max(0, Math.trunc(Number(source.stock || 0) || 0)),
                };
                return acc;
              }, {} as any);

              let matrixKey = String(item.condition || '').toLowerCase();
              if (!matrixKeys.includes(matrixKey)) {
                matrixKey = 'used';
              }
              normalizedMatrix[matrixKey].stock = Math.max(0, Math.trunc(Number(normalizedMatrix[matrixKey].stock || 0) || 0) + returnedQty);
              nextPublicSpecs = {
                ...nextPublicSpecs,
                __condition_matrix: normalizedMatrix,
              };
            }

            await client.query(
              "UPDATE consignment_items SET quantity = $1, status = $2, public_specs = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND store_id = $5",
              [nextQuantity, nextQuantity > 0 ? 'approved' : String(consignmentRow.status || 'pending').toLowerCase(), JSON.stringify(nextPublicSpecs), consignmentItemId, input.storeId],
            );

            continue;
          }

          await updateProductAvailableStockForQueryClient({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity),
            condition: item.condition || null,
            operation: 'increase',
          });
        }
      }

      for (const item of processedItems) {
        const itemSource = String(item.item_source || '').toUpperCase();
        if (!['SOURCED', 'CONSIGNMENT'].includes(itemSource)) {
          continue;
        }

        const unitVendorCost = Math.max(0, Number(item.sourced_cost_price || 0) || 0);
        const returnCostValue = Number((unitVendorCost * Math.max(0, Number(item.quantity) || 0)).toFixed(2));
        const payable = await getSingleQueryRow<any>(client, `
          SELECT id, amount_due, status
          FROM vendor_payables
          WHERE sale_item_id = $1 AND sale_id = $2 AND store_id = $3
          ORDER BY id DESC
          LIMIT 1
        `, [item.sale_item_id, input.saleId, input.storeId]);

        if (!payable?.id) {
          continue;
        }

        const { nextAmountDue, nextStatus } = computePayableAfterReturn({
          currentAmountDue: Number(payable.amount_due || 0) || 0,
          returnCostValue,
          currentStatus: String(payable.status || 'UNPAID'),
        });

        item.vendor_payable_adjustment = returnCostValue;
        item.vendor_payable_source = itemSource;

        await client.query(
          'UPDATE vendor_payables SET amount_due = $1, status = $2, settled_at = CASE WHEN $2 = \'SETTLED\' THEN COALESCE(settled_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE id = $3',
          [nextAmountDue, nextStatus, Number(payable.id)],
        );

        logVendorPayableMutation({
          action: 'return_adjusted',
          storeId: input.storeId,
          saleId: input.saleId,
          saleItemId: Number(item.sale_item_id || 0) || undefined,
          payableId: Number(payable.id || 0) || undefined,
          sourceType: itemSource === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'SOURCED',
          previousAmountDue: Math.max(0, Number(payable.amount_due || 0) || 0),
          nextAmountDue,
          previousStatus: String(payable.status || 'UNPAID').toUpperCase(),
          nextStatus,
        });
      }

      const returnInsert = await client.query(`
        INSERT INTO sales_returns (
          sale_id, store_id, processed_by, returned_value, refund_amount, refund_method,
          return_type, restock_items, reason, items, note
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `, [
        input.saleId,
        input.storeId,
        input.processedBy,
        returnedValue,
        refundAmount,
        input.refundMethod,
        input.returnType,
        input.restockItems ? 1 : 0,
        input.reason,
        JSON.stringify(processedItems),
        input.note || null,
      ]);

      const returnMeta = await getSingleQueryRow<any>(client, `
        SELECT
          COUNT(*) as returns_count,
          COALESCE(SUM(returned_value), 0) as returned_amount,
          COALESCE(SUM(refund_amount), 0) as refunded_amount
        FROM sales_returns
        WHERE sale_id = $1
      `, [input.saleId]);
      const paymentReceived = getTotalPaidFromPaymentMethods(sale.payment_methods);
      const nextReturnedAmount = Math.max(0, Number(returnMeta?.returned_amount || 0));
      const nextNetTotal = Math.max(0, Number((Number(sale.total || 0) - nextReturnedAmount).toFixed(2)) || 0);
      const nextStatus = paymentReceived >= nextNetTotal - 0.009 ? 'COMPLETED' : 'PENDING';

      await client.query('UPDATE sales SET status = $1 WHERE id = $2 AND store_id = $3', [nextStatus, input.saleId, input.storeId]);

      const returnId = Number(returnInsert.rows[0]?.id || 0);
      const createdReturn = await getSingleQueryRow<any>(client, `
        SELECT sr.*, u.username as processed_by_username, c.name as customer_name, c.phone as customer_phone
        FROM sales_returns sr
        LEFT JOIN sales s ON sr.sale_id = s.id
        LEFT JOIN customers c ON s.customer_id = c.id
        LEFT JOIN users u ON sr.processed_by = u.id
        WHERE sr.id = $1 AND sr.store_id = $2
      `, [returnId, input.storeId]);

      const updatedSale = await getSingleQueryRow<any>(client, `
        SELECT s.*, u.username as user_username, c.name as customer_name, c.phone as customer_phone, c.address as customer_address,
          COALESCE((SELECT SUM(sr.returned_value) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returned_amount,
          COALESCE((SELECT SUM(sr.refund_amount) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as refunded_amount,
          COALESCE((SELECT COUNT(*) FROM sales_returns sr WHERE sr.sale_id = s.id), 0) as returns_count
        FROM sales s
        LEFT JOIN users u ON s.user_id = u.id
        LEFT JOIN customers c ON s.customer_id = c.id
        WHERE s.id = $1 AND s.store_id = $2
      `, [input.saleId, input.storeId]);

      result = {
        returnId,
        productIds: processedItems.map((item: any) => Number(item.product_id)).filter((productId: number) => Number.isInteger(productId) && productId > 0),
        createdReturn,
        updatedSale,
      };
    });

    return result;

  },

  async voidSale(input: VoidSaleInput) {

    let voidedSale: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const sale = await getSingleQueryRow<any>(client, 'SELECT * FROM sales WHERE id = $1 AND store_id = $2', [input.saleId, input.storeId]);
      if (!sale) {
        throw new Error('Sale not found');
      }
      if (sale.status === 'VOIDED') {
        throw new Error('Sale is already voided');
      }

      const returnMeta = await getSingleQueryRow<any>(client, `
        SELECT COUNT(*) as returns_count
        FROM sales_returns
        WHERE sale_id = $1
      `, [input.saleId]);
      if (Number(returnMeta?.returns_count || 0) > 0) {
        throw new Error('This sale already has a processed return. Use the returns workflow instead of voiding it.');
      }

      await client.query("UPDATE sales SET status = 'VOIDED', void_reason = $1, voided_by = $2 WHERE id = $3 AND store_id = $4", [input.reason, input.voidedBy, input.saleId, input.storeId]);

      const items = await getQueryRows<any>(client, 'SELECT * FROM sale_items WHERE sale_id = $1', [input.saleId]);
      for (const item of items) {
        const specs = safeJsonParse(item?.specs_at_sale, {} as any);
        if (Boolean(specs?.sourced_item)) {
          continue;
        }
        const product = await getSingleQueryRow<any>(client, 'SELECT * FROM products WHERE id = $1', [item.product_id]);
        if (product) {
          await updateProductAvailableStockForQueryClient({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity) || 0,
            condition: item.condition || null,
            operation: 'increase',
          });
        }
      }

      voidedSale = {
        saleId: input.saleId,
        total: Number(sale.total || 0) || 0,
        previousStatus: String(sale.status || 'COMPLETED'),
        productIds: items.map((item: any) => Number(item.product_id)).filter((productId: number) => Number.isInteger(productId) && productId > 0),
      };
    });

    return voidedSale;

  },

  async createTransactionFlag(input: CreateTransactionFlagInput) {
    const result = await postgresPool.query(`
      INSERT INTO transaction_flags (store_id, sale_id, flagged_by, issue_type, note, status)
      VALUES ($1, $2, $3, $4, $5, 'OPEN')
      RETURNING *
    `, [input.storeId, input.saleId, input.flaggedBy, input.issueType, input.note]);
    return result.rows[0] || null;
  },
});

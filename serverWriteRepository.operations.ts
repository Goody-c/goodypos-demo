import type { Pool, PoolClient } from 'pg';

type CreateMarketCollectionInput = {
  storeId: number;
  collectorName: string;
  phone: string;
  expectedReturnDate: string;
  note?: string | null;
  createdBy: number;
  items: any[];
};

type FinalizeMarketCollectionSaleInput = {
  storeId: number;
  collectionId: number;
  soldBy: number;
  collection: any;
};

type ReturnMarketCollectionInput = {
  storeId: number;
  collectionId: number;
  collection: any;
};

type ReceivePurchaseOrderInput = {
  storeId: number;
  orderId: number;
  receivedBy: number;
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

const normalizeBatchCode = (value: unknown) => {
  const raw = String(value || '').trim().slice(0, 80);
  return raw ? raw.toUpperCase() : null;
};

const normalizeBatchExpiryDate = (value: unknown) => {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
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

const getSingleQueryRow = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return (result.rows[0] ?? null) as T | null;
};

const generateUniqueMarketCollectionCodeForQueryClient = async (client: SqlQueryClient, maxAttempts = 40) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = String(10000 + Math.floor(Math.random() * 90000));
    const exists = await getSingleQueryRow(client, 'SELECT id FROM market_collections WHERE tracking_code = $1 LIMIT 1', [code]);
    if (!exists) {
      return code;
    }
  }
  return null;
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

const getQueryRows = async <T = any>(client: SqlQueryClient, text: string, values: unknown[] = []) => {
  const result = await client.query(text, values as any[]);
  return result.rows as T[];
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

export const createOperationsWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async createMarketCollection(input: CreateMarketCollectionInput) {

    let createdCollection: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const trackingCode = await generateUniqueMarketCollectionCodeForQueryClient(client);
      if (!trackingCode) {
        throw new Error('Failed to generate a unique collection tracking code');
      }

      for (const item of input.items) {
        if (Number(item.consignment_item_id) > 0) {
          const condKey = String(item.condition || '').toLowerCase();
          const ciRow = (await client.query('SELECT public_specs, quantity FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1', [Number(item.consignment_item_id), input.storeId])).rows[0];
          const ciSpecs = ciRow?.public_specs && typeof ciRow.public_specs === 'object' ? ciRow.public_specs : ((() => { try { return JSON.parse(ciRow?.public_specs || '{}'); } catch { return {}; } })());
          const ciMatrix = ciSpecs?.__condition_matrix;
          if (ciMatrix && condKey && ciMatrix[condKey]) {
            ciMatrix[condKey].stock = Math.max(0, Number(ciMatrix[condKey].stock || 0) - Number(item.quantity));
            ciSpecs.__condition_matrix = ciMatrix;
            const newTotal = Object.values(ciMatrix).reduce((s: number, v: any) => s + Math.max(0, Number(v?.stock || 0)), 0);
            await client.query(
              `UPDATE consignment_items SET public_specs = $1, quantity = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND store_id = $4`,
              [JSON.stringify(ciSpecs), newTotal, Number(item.consignment_item_id), input.storeId],
            );
          } else {
            await client.query(
              `UPDATE consignment_items SET quantity = GREATEST(0, quantity - $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND store_id = $3`,
              [Number(item.quantity), Number(item.consignment_item_id), input.storeId],
            );
          }
        } else {
          await updateProductAvailableStockForQueryClient({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity),
            condition: item.condition,
            operation: 'decrease',
          });
        }
      }

      const result = await client.query(`
        INSERT INTO market_collections (
          store_id, collector_name, phone, items, expected_return_date, tracking_code, status, note, created_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'OPEN', $7, $8, CURRENT_TIMESTAMP)
        RETURNING id
      `, [
        input.storeId,
        input.collectorName,
        input.phone,
        JSON.stringify(input.items),
        input.expectedReturnDate,
        trackingCode,
        input.note || null,
        input.createdBy,
      ]);

      createdCollection = await getSingleQueryRow<any>(client, `
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE mc.id = $1 AND mc.store_id = $2
      `, [Number(result.rows[0]?.id || 0), input.storeId]);
    });

    return createdCollection;

  },

  async markMarketCollectionSold(input: FinalizeMarketCollectionSaleInput) {

    let soldResult: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const paymentMethods = { cash: Number(input.collection?.total_value || 0) || 0, transfer: 0, pos: 0 };
      const saleNoteParts = [
        `Market collection sold to ${input.collection?.collector_name || 'collector'} (Ref: ${input.collection?.tracking_code || input.collectionId})`,
        String(input.collection?.note || '').trim(),
      ].filter(Boolean);

      const saleResult = await client.query(`
        INSERT INTO sales (store_id, subtotal, tax_amount, tax_percentage, total, user_id, payment_methods, status, pdf_path, customer_id, due_date, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9, $10, $11)
        RETURNING id
      `, [
        input.storeId,
        Number(input.collection?.total_value || 0) || 0,
        0,
        0,
        Number(input.collection?.total_value || 0) || 0,
        input.soldBy,
        JSON.stringify(paymentMethods),
        null,
        null,
        input.collection?.expected_return_date || null,
        saleNoteParts.join(' • ') || null,
      ]);

      const saleId = Number(saleResult.rows[0]?.id || 0);
      for (const item of (Array.isArray(input.collection?.items) ? input.collection.items : [])) {
        if (Number(item.consignment_item_id) > 0) {
          // Mark consignment item as sold (quantity already deducted on collection create)
          await client.query(
            `UPDATE consignment_items SET status = CASE WHEN quantity <= 0 THEN 'sold' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND store_id = $2`,
            [Number(item.consignment_item_id), input.storeId],
          );
        } else {
          await client.query(`
            INSERT INTO sale_items (sale_id, product_id, quantity, price_at_sale, subtotal, cost_at_sale, imei_serial, condition, specs_at_sale)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            saleId,
            Number(item.product_id),
            Number(item.quantity) || 0,
            Number(item.price_at_collection) || 0,
            Number(item.subtotal) || 0,
            Number(item.cost_at_collection) || 0,
            null,
            item.condition || null,
            JSON.stringify(item.specs_at_collection || {}),
          ]);
        }
      }

      await client.query(`
        UPDATE market_collections
        SET status = 'SOLD', converted_sale_id = $1, sold_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND store_id = $3
      `, [saleId, input.collectionId, input.storeId]);

      const updatedCollection = await getSingleQueryRow<any>(client, `
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE mc.id = $1 AND mc.store_id = $2
      `, [input.collectionId, input.storeId]);

      soldResult = { saleId, updatedCollection };
    });

    return soldResult;

  },

  async returnMarketCollection(input: ReturnMarketCollectionInput) {

    let updatedCollection: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      for (const item of (Array.isArray(input.collection?.items) ? input.collection.items : [])) {
        if (Number(item.consignment_item_id) > 0) {
          const retCondKey = String(item.condition || '').toLowerCase();
          const retCiRow = (await client.query('SELECT public_specs, quantity FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1', [Number(item.consignment_item_id), input.storeId])).rows[0];
          const retSpecs = retCiRow?.public_specs && typeof retCiRow.public_specs === 'object' ? retCiRow.public_specs : ((() => { try { return JSON.parse(retCiRow?.public_specs || '{}'); } catch { return {}; } })());
          const retMatrix = retSpecs?.__condition_matrix;
          if (retMatrix && retCondKey && retMatrix[retCondKey]) {
            retMatrix[retCondKey].stock = Number(retMatrix[retCondKey].stock || 0) + Number(item.quantity || 0);
            retSpecs.__condition_matrix = retMatrix;
            const retTotal = Object.values(retMatrix).reduce((s: number, v: any) => s + Math.max(0, Number(v?.stock || 0)), 0);
            await client.query(
              `UPDATE consignment_items SET public_specs = $1, quantity = $2, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND store_id = $4`,
              [JSON.stringify(retSpecs), retTotal, Number(item.consignment_item_id), input.storeId],
            );
          } else {
            await client.query(
              `UPDATE consignment_items SET quantity = quantity + $1, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND store_id = $3`,
              [Number(item.quantity) || 0, Number(item.consignment_item_id), input.storeId],
            );
          }
        } else {
          await updateProductAvailableStockForQueryClient({
            client,
            productId: Number(item.product_id),
            storeId: input.storeId,
            quantity: Number(item.quantity) || 0,
            condition: item.condition,
            operation: 'increase',
          });
        }
      }

      await client.query(`
        UPDATE market_collections
        SET status = 'RETURNED', returned_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND store_id = $2
      `, [input.collectionId, input.storeId]);

      updatedCollection = await getSingleQueryRow<any>(client, `
        SELECT mc.*, u.username as created_by_username
        FROM market_collections mc
        LEFT JOIN users u ON mc.created_by = u.id
        WHERE mc.id = $1 AND mc.store_id = $2
      `, [input.collectionId, input.storeId]);
    });

    return updatedCollection;

  },

  async receivePurchaseOrder(input: ReceivePurchaseOrderInput) {

    let receivedResult: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const touchedProductIds: number[] = [];
      const createdAdjustmentIds: number[] = [];
      const createdBatchIds: number[] = [];
      const order = await getSingleQueryRow<any>(client, 'SELECT * FROM purchase_orders WHERE id = $1 AND store_id = $2 LIMIT 1', [input.orderId, input.storeId]);
      if (!order) {
        throw new Error('Purchase order not found');
      }
      if (String(order.status || '').toUpperCase() !== 'ORDERED') {
        throw new Error('Only open purchase orders can be received');
      }

      const items = safeJsonParse(order.items, [] as any[]);
      if (!Array.isArray(items) || !items.length) {
        throw new Error('This purchase order has no items to receive');
      }

      for (const [index, item] of items.entries()) {
        const productId = Number(item?.product_id);
        const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
        const unitCost = Math.max(0, Number(item?.unit_cost || 0) || 0);
        const normalizedCondition = item?.condition ? normalizeCollectionCondition(item.condition) : null;
        const batchCode = normalizeBatchCode(item?.batch_code);
        const expiryDate = normalizeBatchExpiryDate(item?.expiry_date);

        if (!Number.isInteger(productId) || productId <= 0 || quantity <= 0) {
          throw new Error(`Invalid product line found in this order at row ${index + 1}`);
        }

        touchedProductIds.push(productId);

        const snapshot = await getProductStockSnapshotForQueryClient({ client, productId, storeId: input.storeId, condition: normalizedCondition });
        const quantityBefore = Math.max(0, Number(snapshot.currentStock || 0));
        await updateProductAvailableStockForQueryClient({
          client,
          productId,
          storeId: input.storeId,
          quantity,
          condition: normalizedCondition,
          operation: 'increase',
        });
        const quantityAfter = quantityBefore + quantity;

        if (unitCost > 0) {
          const latestProduct = await getSingleQueryRow<any>(client, 'SELECT * FROM products WHERE id = $1 AND store_id = $2 AND deleted_at IS NULL LIMIT 1', [productId, input.storeId]);
          if (latestProduct?.condition_matrix && normalizedCondition) {
            const matrix = safeJsonParse(latestProduct.condition_matrix, {} as any);
            const key = normalizedCondition.toLowerCase();
            if (matrix?.[key]) {
              matrix[key] = { ...matrix[key], cost: unitCost };
              await client.query(
                'UPDATE products SET condition_matrix = $1, cost = CASE WHEN COALESCE(cost, 0) <= 0 THEN $2 ELSE cost END WHERE id = $3 AND store_id = $4',
                [JSON.stringify(matrix), unitCost, productId, input.storeId],
              );
            }
          } else {
            await client.query('UPDATE products SET cost = $1 WHERE id = $2 AND store_id = $3', [unitCost, productId, input.storeId]);
          }
        }

        const adjustmentResult = await client.query(`
          INSERT INTO stock_adjustments (
            store_id, product_id, adjusted_by, adjustment_type, adjustment_mode,
            quantity_before, quantity_change, quantity_after, cost_impact, condition, note
          ) VALUES ($1, $2, $3, 'RESTOCK', 'INCREASE', $4, $5, $6, $7, $8, $9)
          RETURNING id
        `, [
          input.storeId,
          productId,
          input.receivedBy,
          quantityBefore,
          quantity,
          quantityAfter,
          Number((unitCost * quantity).toFixed(2)),
          normalizedCondition || null,
          `Received via ${order.order_number}${order.supplier_name ? ` from ${order.supplier_name}` : ''}`,
        ]);
        createdAdjustmentIds.push(Number(adjustmentResult.rows[0]?.id || 0));

        const batchResult = await client.query(`
          INSERT INTO inventory_batches (
            store_id, product_id, supplier_id, purchase_order_id, received_by, condition,
            batch_code, expiry_date, quantity_received, quantity_remaining, unit_cost, note
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          input.storeId,
          productId,
          order.supplier_id || null,
          input.orderId,
          input.receivedBy,
          normalizedCondition || null,
          batchCode,
          expiryDate,
          quantity,
          quantity,
          unitCost,
          `Received from ${order.supplier_name || 'supplier'} via ${order.order_number}`,
        ]);
        createdBatchIds.push(Number(batchResult.rows[0]?.id || 0));
      }

      await client.query(`
        UPDATE purchase_orders
        SET status = 'RECEIVED', received_by = $1, received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND store_id = $3
      `, [input.receivedBy, input.orderId, input.storeId]);

      const orderRow = await getSingleQueryRow<any>(client, `
        SELECT po.*, COALESCE(po.supplier_name, s.name, 'Unknown Supplier') as supplier_name,
          creator.username as created_by_username,
          receiver.username as received_by_username
        FROM purchase_orders po
        LEFT JOIN suppliers s ON po.supplier_id = s.id
        LEFT JOIN users creator ON po.created_by = creator.id
        LEFT JOIN users receiver ON po.received_by = receiver.id
        WHERE po.id = $1 AND po.store_id = $2
        LIMIT 1
      `, [input.orderId, input.storeId]);

      receivedResult = { orderRow, touchedProductIds, createdAdjustmentIds, createdBatchIds };
    });

    return receivedResult;

  },
});

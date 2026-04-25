import type { Pool, PoolClient } from 'pg';

type CreateStockAdjustmentInput = {
  storeId: number;
  productId: number;
  rawQuantity: number;
  condition?: string | null;
  note?: string | null;
  adjustmentMode: 'INCREASE' | 'DECREASE' | 'SET';
  adjustmentType: 'DAMAGED' | 'LOST' | 'FOUND' | 'MANUAL' | 'INTERNAL_USE' | 'RESTOCK' | 'COUNT';
  userId: number;
  userRole: string;
};

type ReviewStockAdjustmentInput = {
  storeId: number;
  adjustmentId: number;
  approvalNote?: string | null;
  approvedBy: number;
  action: 'APPROVE' | 'REJECT';
};

type CreateConsignmentItemInput = {
  storeId: number;
  quickCode?: string | null;
  vendorName: string;
  vendorPhone?: string | null;
  vendorAddress?: string | null;
  itemName: string;
  imeiSerial?: string | null;
  quantity: number;
  agreedPayout: number;
  sellingPrice: number;
  publicSpecs: Record<string, any>;
  internalCondition?: string | null;
  addedBy: number;
};

type UpdateConsignmentItemInput = {
  storeId: number;
  consignmentItemId: number;
  quickCode?: string | null;
  vendorName: string;
  vendorPhone?: string | null;
  vendorAddress?: string | null;
  itemName: string;
  imeiSerial?: string | null;
  quantity: number;
  agreedPayout: number;
  sellingPrice: number;
  publicSpecs: Record<string, any>;
  internalCondition?: string | null;
};

type ReviewConsignmentItemInput = {
  storeId: number;
  consignmentItemId: number;
  reviewerId: number;
  action: 'APPROVE' | 'REJECT' | 'RETURN';
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

const reconcileInventoryBatchQuantityForQueryClient = async ({
  client,
  productId,
  storeId,
  condition,
  targetStock,
}: {
  client: SqlQueryClient;
  productId: number;
  storeId: number;
  condition?: string | null;
  targetStock: number;
}) => {
  const normalizedCondition = normalizeCollectionCondition(condition);
  const rows = await getQueryRows<any>(client, `
    SELECT id, quantity_received, quantity_remaining
    FROM inventory_batches
    WHERE store_id = $1
      AND product_id = $2
      AND (($3::text IS NULL AND condition IS NULL) OR condition = $4)
    ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC
  `, [storeId, productId, normalizedCondition, normalizedCondition]);

  if (!rows.length) return;

  let remainingTarget = Math.max(0, Math.floor(Number(targetStock) || 0));
  for (const row of rows) {
    const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
    const nextRemaining = Math.min(currentReceived, remainingTarget);
    await client.query('UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2', [nextRemaining, Number(row.id)]);
    remainingTarget = Math.max(0, remainingTarget - nextRemaining);
  }

  if (remainingTarget > 0) {
    const lastRow = rows[rows.length - 1];
    const currentReceived = Math.max(0, Number(lastRow?.quantity_received || 0) || 0);
    const currentRemaining = Math.max(0, Number(lastRow?.quantity_remaining || 0) || 0);
    await client.query(
      'UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3',
      [currentReceived + remainingTarget, currentRemaining + remainingTarget, Number(lastRow.id)],
    );
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

const setProductAvailableStockForQueryClient = async ({
  client,
  productId,
  storeId,
  condition,
  nextStock,
}: {
  client: SqlQueryClient;
  productId: number;
  storeId: number;
  condition?: string | null;
  nextStock: number;
}) => {
  const snapshot = await getProductStockSnapshotForQueryClient({ client, productId, storeId, condition });
  const normalizedNextStock = Math.max(0, Math.floor(Number(nextStock) || 0));

  if (snapshot.usesConditionMatrix && snapshot.normalizedCondition) {
    const matrix = safeJsonParse(snapshot.product.condition_matrix, {} as any);
    const conditionKey = snapshot.normalizedCondition.toLowerCase();
    const slot = matrix?.[conditionKey];
    if (!slot) {
      throw new Error(`Condition ${snapshot.normalizedCondition.replace(/_/g, ' ')} is not available for ${snapshot.product.name}`);
    }

    slot.stock = normalizedNextStock;
    await client.query('UPDATE products SET condition_matrix = $1 WHERE id = $2 AND store_id = $3', [JSON.stringify(matrix), productId, storeId]);
  } else {
    await client.query('UPDATE products SET stock = $1 WHERE id = $2 AND store_id = $3', [normalizedNextStock, productId, storeId]);
  }

  await reconcileInventoryBatchQuantityForQueryClient({
    client,
    productId,
    storeId,
    condition: snapshot.normalizedCondition,
    targetStock: normalizedNextStock,
  });

  return {
    ...snapshot,
    nextStock: normalizedNextStock,
  };
};

const generateUniqueConsignmentQuickCodeForQueryClient = async (
  client: SqlQueryClient,
  maxAttempts = 50,
  excludeConsignmentItemId?: number | null,
  preferredCandidate?: string | null,
) => {
  const quickCodePattern = /^([1-9])\1\1\d{2}$/;
  const buildQuickCodeCandidate = (leadingDigit: number, trailingValue: number) => {
    const repeatedDigit = String(Math.min(9, Math.max(1, Math.trunc(leadingDigit) || 1)));
    const suffix = String(Math.max(0, Math.trunc(trailingValue) || 0) % 100).padStart(2, '0');
    return `${repeatedDigit.repeat(3)}${suffix}`;
  };

  const canUseCandidate = async (candidate: string) => {
    const normalized = String(candidate || '').trim();
    if (!normalized || !quickCodePattern.test(normalized)) return false;

    const exists = await getSingleQueryRow<{ id: number }>(
      client,
      'SELECT id FROM consignment_items WHERE quick_code = $1 LIMIT 1',
      [normalized],
    );
    return !exists || (excludeConsignmentItemId != null && Number(exists.id) === Number(excludeConsignmentItemId));
  };

  const normalizedPreferred = String(preferredCandidate || '').trim();
  if (normalizedPreferred && await canUseCandidate(normalizedPreferred)) {
    return normalizedPreferred;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = buildQuickCodeCandidate(
      1 + Math.floor(Math.random() * 9),
      Math.floor(Math.random() * 100),
    );
    if (await canUseCandidate(candidate)) {
      return candidate;
    }
  }

  const fallbackSeed = Number(Date.now()) % 900;
  for (let offset = 0; offset < 900; offset += 1) {
    const candidateIndex = (fallbackSeed + offset) % 900;
    const candidate = buildQuickCodeCandidate(
      Math.floor(candidateIndex / 100) + 1,
      candidateIndex % 100,
    );
    if (await canUseCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
};

export const createInventoryWriteRepository = ({ postgresPool }: { postgresPool: Pool }) => ({
  async createStockAdjustment(input: CreateStockAdjustmentInput) {

    let createdAdjustment: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const snapshot = await getProductStockSnapshotForQueryClient({ client, productId: input.productId, storeId: input.storeId, condition: input.condition });
      const quantityBefore = Math.max(0, Number(snapshot.currentStock || 0));
      let quantityAfter = quantityBefore;
      let quantityChange = 0;
      const isCountValidation = input.adjustmentType === 'COUNT' && input.adjustmentMode === 'SET';

      if (input.adjustmentMode === 'SET') {
        quantityAfter = Math.max(0, Math.floor(input.rawQuantity));
        quantityChange = quantityAfter - quantityBefore;

        if (quantityChange === 0 && !isCountValidation) {
          throw new Error('No stock change detected. Adjust the quantity before saving.');
        }
      } else if (input.adjustmentMode === 'INCREASE') {
        const quantity = Math.max(1, Math.floor(input.rawQuantity));
        await updateProductAvailableStockForQueryClient({
          client,
          productId: input.productId,
          storeId: input.storeId,
          quantity,
          condition: input.condition,
          operation: 'increase',
        });
        quantityChange = quantity;
        quantityAfter = quantityBefore + quantity;
      } else {
        const quantity = Math.max(1, Math.floor(input.rawQuantity));
        if (quantity > quantityBefore) {
          throw new Error(`Only ${quantityBefore} unit(s) are available to remove right now.`);
        }
        await updateProductAvailableStockForQueryClient({
          client,
          productId: input.productId,
          storeId: input.storeId,
          quantity,
          condition: input.condition,
          operation: 'decrease',
        });
        quantityChange = -quantity;
        quantityAfter = quantityBefore - quantity;
      }

      const requiresApproval = isCountValidation
        && quantityChange !== 0
        && !['STORE_ADMIN', 'MANAGER'].includes(String(input.userRole || ''));

      if (input.adjustmentMode === 'SET' && !requiresApproval) {
        await setProductAvailableStockForQueryClient({
          client,
          productId: input.productId,
          storeId: input.storeId,
          condition: input.condition,
          nextStock: quantityAfter,
        });
      }

      const resolvedCost = resolveTrackedCost({
        product: snapshot.product,
        condition: snapshot.normalizedCondition,
        sellingPrice: 0,
      });
      const costImpact = Number(((Number(resolvedCost.cost || 0) || 0) * quantityChange).toFixed(2)) || 0;
      const recountStatus = isCountValidation
        ? (requiresApproval ? 'PENDING' : 'APPROVED')
        : 'NOT_REQUIRED';
      const result = await client.query(`
        INSERT INTO stock_adjustments (
          store_id, product_id, adjusted_by, adjustment_type, adjustment_mode,
          quantity_before, quantity_change, quantity_after, cost_impact, condition, note,
          counted_quantity, variance_quantity, recount_status, approved_by, approved_at, approval_note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        RETURNING id
      `, [
        input.storeId,
        input.productId,
        input.userId,
        input.adjustmentType,
        input.adjustmentMode,
        quantityBefore,
        quantityChange,
        quantityAfter,
        costImpact,
        snapshot.normalizedCondition || null,
        input.note || null,
        isCountValidation ? quantityAfter : null,
        isCountValidation ? quantityChange : 0,
        recountStatus,
        recountStatus === 'APPROVED' ? input.userId : null,
        recountStatus === 'APPROVED' ? new Date().toISOString() : null,
        null,
      ]);

      createdAdjustment = await getSingleQueryRow<any>(client, `
        SELECT sa.*, p.name as product_name, COALESCE(c.name, p.category, 'General') as category_name,
               u.username as adjusted_by_username, approver.username as approved_by_username
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON sa.adjusted_by = u.id
        LEFT JOIN users approver ON sa.approved_by = approver.id
        WHERE sa.id = $1 AND sa.store_id = $2
      `, [Number(result.rows[0]?.id || 0), input.storeId]);
    });

    return createdAdjustment;

  },

  async reviewStockAdjustment(input: ReviewStockAdjustmentInput) {

    let reviewedAdjustment: any = null;

    await withPostgresTransaction(postgresPool, async (client) => {
      const adjustment = await getSingleQueryRow<any>(client, `
        SELECT sa.*, p.name as product_name
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        WHERE sa.id = $1 AND sa.store_id = $2
      `, [input.adjustmentId, input.storeId]);

      if (!adjustment) {
        throw new Error('Stock recount record not found.');
      }
      if (String(adjustment.adjustment_type || '').toUpperCase() !== 'COUNT') {
        throw new Error(`Only stock count validations can be ${String(input.action || '').toLowerCase()}d here.`);
      }
      if (String(adjustment.recount_status || '').toUpperCase() !== 'PENDING') {
        throw new Error('This stock recount has already been reviewed.');
      }

      if (input.action === 'APPROVE') {
        const nextStock = Math.max(0, Number(adjustment.counted_quantity ?? adjustment.quantity_after ?? adjustment.quantity_before) || 0);
        await setProductAvailableStockForQueryClient({
          client,
          productId: Number(adjustment.product_id),
          storeId: input.storeId,
          condition: adjustment.condition,
          nextStock,
        });
      }

      await client.query(`
        UPDATE stock_adjustments
        SET recount_status = $1, approved_by = $2, approved_at = CURRENT_TIMESTAMP, approval_note = $3
        WHERE id = $4 AND store_id = $5
      `, [input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED', input.approvedBy, input.approvalNote || null, input.adjustmentId, input.storeId]);

      reviewedAdjustment = await getSingleQueryRow<any>(client, `
        SELECT sa.*, p.name as product_name, COALESCE(c.name, p.category, 'General') as category_name,
               u.username as adjusted_by_username, approver.username as approved_by_username
        FROM stock_adjustments sa
        LEFT JOIN products p ON sa.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN users u ON sa.adjusted_by = u.id
        LEFT JOIN users approver ON sa.approved_by = approver.id
        WHERE sa.id = $1 AND sa.store_id = $2
      `, [input.adjustmentId, input.storeId]);
    });

    return reviewedAdjustment;

  },

  async createConsignmentItem(input: CreateConsignmentItemInput) {
    const normalizeQuickCode = (value: unknown) => {
      const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
      return code || null;
    };

    const normalizedQuickCode = normalizeQuickCode(input.quickCode);
    const normalizedVendorPhone = String(input.vendorPhone || '').trim() || null;
    const normalizedVendorAddress = String(input.vendorAddress || '').trim() || null;
    const normalizedImei = String(input.imeiSerial || '').trim() || null;
    const normalizedQuantity = Math.max(1, Math.trunc(Number(input.quantity || 0) || 1));


    return withPostgresTransaction(postgresPool, async (client) => {
      const resolvedQuickCode = await generateUniqueConsignmentQuickCodeForQueryClient(
        client,
        120,
        null,
        normalizedQuickCode,
      );
      if (!resolvedQuickCode) {
        throw new Error('Unable to generate a unique consignment quick code.');
      }

      const result = await client.query(`
        INSERT INTO consignment_items (
          store_id, quick_code, vendor_name, vendor_phone, vendor_address, item_name, imei_serial,
          quantity, agreed_payout, selling_price, status, public_specs, internal_condition, added_by, approved_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11::jsonb, $12, $13, NULL, CURRENT_TIMESTAMP)
        RETURNING *
      `, [
        input.storeId,
        resolvedQuickCode,
        input.vendorName,
        normalizedVendorPhone,
        normalizedVendorAddress,
        input.itemName,
        normalizedImei,
        normalizedQuantity,
        input.agreedPayout,
        input.sellingPrice,
        JSON.stringify(input.publicSpecs || {}),
        input.internalCondition || null,
        input.addedBy,
      ]);

      return result.rows[0] || null;
    });

  },

  async updateConsignmentItem(input: UpdateConsignmentItemInput) {
    const normalizeQuickCode = (value: unknown) => {
      const code = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
      return code || null;
    };

    const normalizedQuickCode = normalizeQuickCode(input.quickCode);
    const normalizedVendorPhone = String(input.vendorPhone || '').trim() || null;
    const normalizedVendorAddress = String(input.vendorAddress || '').trim() || null;
    const normalizedImei = String(input.imeiSerial || '').trim() || null;
    const normalizedQuantity = Math.max(1, Math.trunc(Number(input.quantity || 0) || 1));


    return withPostgresTransaction(postgresPool, async (client) => {
      const existing = await getSingleQueryRow<{ quick_code: string | null }>(
        client,
        'SELECT quick_code FROM consignment_items WHERE id = $1 AND store_id = $2 LIMIT 1',
        [input.consignmentItemId, input.storeId],
      );
      if (!existing) {
        return null;
      }

      const resolvedQuickCode = await generateUniqueConsignmentQuickCodeForQueryClient(
        client,
        120,
        input.consignmentItemId,
        normalizedQuickCode || String(existing.quick_code || '').trim() || null,
      );
      if (!resolvedQuickCode) {
        throw new Error('Unable to generate a unique consignment quick code.');
      }

      const result = await client.query(`
        UPDATE consignment_items
        SET quick_code = $1,
            vendor_name = $2,
            vendor_phone = $3,
            vendor_address = $4,
            item_name = $5,
            imei_serial = $6,
            quantity = $7,
            agreed_payout = $8,
            selling_price = $9,
            public_specs = $10::jsonb,
            internal_condition = $11,
            status = 'pending',
            approved_by = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $12 AND store_id = $13
        RETURNING *
      `, [
        resolvedQuickCode,
        input.vendorName,
        normalizedVendorPhone,
        normalizedVendorAddress,
        input.itemName,
        normalizedImei,
        normalizedQuantity,
        input.agreedPayout,
        input.sellingPrice,
        JSON.stringify(input.publicSpecs || {}),
        input.internalCondition || null,
        input.consignmentItemId,
        input.storeId,
      ]);
      return result.rows[0] || null;
    });

  },

  async reviewConsignmentItem(input: ReviewConsignmentItemInput) {
    const nextStatus = input.action === 'APPROVE'
      ? 'approved'
      : input.action === 'RETURN'
        ? 'returned'
        : 'rejected';
    const nextApprover = input.action === 'APPROVE' || input.action === 'RETURN' ? input.reviewerId : null;


    const result = await postgresPool.query(`
      UPDATE consignment_items
      SET status = $1,
          approved_by = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND store_id = $4
      RETURNING *
    `, [nextStatus, nextApprover, input.consignmentItemId, input.storeId]);
    return result.rows[0] || null;

  },

  async markConsignmentItemSold(storeId: number, consignmentItemId: number) {

    await postgresPool.query(
      "UPDATE consignment_items SET status = 'sold', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND store_id = $2",
      [consignmentItemId, storeId],
    );
    return;

  },
});

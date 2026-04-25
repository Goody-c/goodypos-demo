import type { Pool } from 'pg';
import { normalizeCollectionCondition } from './serverSharedHelpers';

const calculateEan13CheckDigit = (base12: string) => {
  const digits = base12.replace(/\D/g, '');
  if (digits.length !== 12) {
    throw new Error('Barcode base must contain exactly 12 digits');
  }

  const weightedSum = digits
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);

  return String((10 - (weightedSum % 10)) % 10);
};

export const createInventoryHelpers = ({
  postgresPool,
}: {
  postgresPool: Pool;
}) => {
  const generateUniqueQuickCode = async (
    maxAttempts = 50,
    excludeProductId?: number | null,
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

      const result = await postgresPool.query('SELECT id FROM products WHERE quick_code = $1 LIMIT 1', [normalized]);
      const exists = result.rows[0] as { id: number } | undefined;
      return !exists || (excludeProductId != null && Number(exists.id) === Number(excludeProductId));
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

  const generateUniqueBarcode = async (storeId: number, maxAttempts = 20) => {
    const storePart = String(Math.max(0, Number(storeId) || 0)).padStart(4, '0').slice(-4);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timePart = String(Date.now() + attempt).slice(-5).padStart(5, '0');
      const randomDigit = String(Math.floor(Math.random() * 10));
      const base12 = `20${storePart}${timePart}${randomDigit}`;
      const candidate = `${base12}${calculateEan13CheckDigit(base12)}`;
      const result = await postgresPool.query('SELECT id FROM products WHERE barcode = $1 LIMIT 1', [candidate]);
      if (!result.rows[0]) {
        return candidate;
      }
    }

    return null;
  };

  const reconcileInventoryBatchQuantity = async ({
    productId,
    storeId,
    condition,
    targetStock,
  }: {
    productId: number;
    storeId: number;
    condition?: string | null;
    targetStock: number;
  }) => {
    const normalizedCondition = normalizeCollectionCondition(condition);
    const batchResult = await postgresPool.query(
      `SELECT id, quantity_received, quantity_remaining
       FROM inventory_batches
       WHERE store_id = $1
         AND product_id = $2
         AND COALESCE(condition, '') = COALESCE($3, '')
       ORDER BY CASE WHEN expiry_date IS NULL OR TRIM(expiry_date) = '' THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC, id ASC`,
      [storeId, productId, normalizedCondition],
    );
    const rows = batchResult.rows as any[];

    if (!rows.length) return;

    let remainingTarget = Math.max(0, Math.floor(Number(targetStock) || 0));
    for (const row of rows) {
      const currentReceived = Math.max(0, Number(row?.quantity_received || 0) || 0);
      const nextRemaining = Math.min(currentReceived, remainingTarget);
      await postgresPool.query('UPDATE inventory_batches SET quantity_remaining = $1 WHERE id = $2', [nextRemaining, row.id]);
      remainingTarget = Math.max(0, remainingTarget - nextRemaining);
    }

    if (remainingTarget > 0) {
      const lastRow = rows[rows.length - 1];
      const currentReceived = Math.max(0, Number(lastRow?.quantity_received || 0) || 0);
      const currentRemaining = Math.max(0, Number(lastRow?.quantity_remaining || 0) || 0);
      await postgresPool.query(
        'UPDATE inventory_batches SET quantity_received = $1, quantity_remaining = $2 WHERE id = $3',
        [currentReceived + remainingTarget, currentRemaining + remainingTarget, lastRow.id],
      );
    }
  };

  const generateUniquePurchaseOrderNumber = async (storeId: number, maxAttempts = 40) => {
    const storePart = String(storeId || 0).slice(-2).padStart(2, '0');
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timePart = Date.now().toString().slice(-6);
      const randomPart = String(Math.floor(100 + Math.random() * 900));
      const candidate = `PO-${storePart}${timePart}${randomPart}`;
      const result = await postgresPool.query('SELECT id FROM purchase_orders WHERE order_number = $1 LIMIT 1', [candidate]);
      if (!result.rows[0]) {
        return candidate;
      }
    }

    return null;
  };

  const generateUniqueRepairTicketNumber = async (storeId: number, maxAttempts = 40) => {
    const storePart = String(storeId || 0).slice(-2).padStart(2, '0');
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const timePart = Date.now().toString().slice(-5);
      const randomPart = String(Math.floor(10 + Math.random() * 90));
      const candidate = `RPR-${storePart}${timePart}${randomPart}`;
      const result = await postgresPool.query('SELECT id FROM repair_tickets WHERE ticket_number = $1 LIMIT 1', [candidate]);
      if (!result.rows[0]) {
        return candidate;
      }
    }

    return null;
  };

  return {
    generateUniqueQuickCode,
    generateUniqueBarcode,
    reconcileInventoryBatchQuantity,
    generateUniquePurchaseOrderNumber,
    generateUniqueRepairTicketNumber,
  };
};

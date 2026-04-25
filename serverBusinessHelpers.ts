import type { Pool } from 'pg';
import {
  formatAttendanceEntry,
  getAttendanceDurationMinutes,
  getShiftDateKey,
  normalizeBatchCode,
  normalizeBatchExpiryDate,
  normalizeCollectionCondition,
  normalizePaymentFrequency,
  normalizeRecountStatus,
  normalizeSaleChannel,
  safeJsonParse,
  toFiniteNumberOrNull,
} from './serverSharedHelpers';

export const HIGH_RISK_AUDIT_ACTIONS = ['PRICE_CHANGE', 'DELETE', 'STOCK_ADJUST'];

const serializeAuditValue = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getConditionMatrixSlot = (product: any, condition?: unknown) => {
  const normalizedCondition = normalizeCollectionCondition(condition);
  if (!product?.condition_matrix || !normalizedCondition) {
    return null;
  }

  const matrix = safeJsonParse(product.condition_matrix, {});
  return matrix?.[normalizedCondition.toLowerCase()] || null;
};

const shiftDateByFrequency = (dateText: string, frequency: string, step: number) => {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return dateText;
  }

  const normalizedFrequency = normalizePaymentFrequency(frequency);
  if (normalizedFrequency === 'WEEKLY') {
    date.setDate(date.getDate() + (7 * step));
  } else if (normalizedFrequency === 'BIWEEKLY') {
    date.setDate(date.getDate() + (14 * step));
  } else {
    date.setMonth(date.getMonth() + step);
  }

  return date.toISOString().slice(0, 10);
};

const isCollectionOverdue = (status: unknown, expectedReturnDate: unknown) => {
  const normalizedDate = String(expectedReturnDate || '').trim();
  if (String(status || '').toUpperCase() !== 'OPEN' || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    return false;
  }

  return new Date(`${normalizedDate}T23:59:59`).getTime() < Date.now();
};

export const createBusinessHelpers = ({
  postgresPool,
}: {
  postgresPool: Pool;
}) => {
  const logSystemActivity = async ({
    storeId,
    userId,
    action,
    details,
  }: {
    storeId: number;
    userId?: number | null;
    action: string;
    details?: Record<string, unknown> | null;
  }) => {
    try {
      await postgresPool.query(
        `INSERT INTO system_activity_logs (store_id, user_id, action, details)
         VALUES ($1, $2, $3, $4)`,
        [storeId, userId ?? null, action, details ? JSON.stringify(details) : null],
      );
    } catch (error) {
      console.warn('Failed to write system activity log:', error);
    }
  };

  const formatAuditCurrency = (value: unknown) => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '₦0';
    const hasDecimals = Math.abs(amount % 1) > 0.000001;
    return `₦${amount.toLocaleString('en-NG', {
      minimumFractionDigits: hasDecimals ? 2 : 0,
      maximumFractionDigits: 2,
    })}`;
  };

  const getMissingCostPriceLabels = ({
    price,
    condition,
    productPrice,
    conditionMatrix,
  }: {
    price?: unknown;
    condition?: unknown;
    productPrice?: unknown;
    conditionMatrix?: unknown;
  }) => {
    const directPrice = Math.max(0, Number(price || 0) || 0);
    const normalizedCondition = String(condition || 'STANDARD').trim().toLowerCase().replace(/\s+/g, '_');
    const matrix = safeJsonParse(conditionMatrix, {});
    const orderedKeys = Array.from(new Set(['new', 'used', 'open_box', ...Object.keys(matrix || {})]));

    const availableConditionPrices = orderedKeys
      .map((key) => {
        const slot = (matrix as any)?.[key] || {};
        const slotPrice = Math.max(0, Number(slot?.price || 0) || 0);
        if (slotPrice <= 0) return null;
        return `${key.replace(/_/g, ' ').toUpperCase()} ${formatAuditCurrency(slotPrice)}`;
      })
      .filter(Boolean) as string[];

    const exactConditionPrice = Math.max(0, Number((matrix as any)?.[normalizedCondition]?.price || 0) || 0);
    const fallbackBasePrice = Math.max(0, Number(productPrice || 0) || 0);

    const primaryLabel = directPrice > 0
      ? formatAuditCurrency(directPrice)
      : exactConditionPrice > 0
        ? formatAuditCurrency(exactConditionPrice)
        : availableConditionPrices.length > 0
          ? availableConditionPrices.join(' • ')
          : fallbackBasePrice > 0
            ? formatAuditCurrency(fallbackBasePrice)
            : 'Not set yet';

    return {
      primaryLabel,
      allConditionsLabel: availableConditionPrices.length > 0 ? availableConditionPrices.join(' • ') : null,
    };
  };

  const getAuditActorLabel = (role: unknown) => {
    const normalizedRole = String(role || '').toUpperCase();
    if (normalizedRole === 'STORE_ADMIN') return 'Owner';
    if (normalizedRole === 'SYSTEM_ADMIN') return 'System Admin';
    if (normalizedRole === 'MANAGER') return 'Manager';
    if (normalizedRole === 'ACCOUNTANT') return 'Accountant';
    if (normalizedRole === 'PROCUREMENT_OFFICER') return 'Procurement Officer';
    return 'Staff';
  };

  const logAuditEvent = async ({
    storeId,
    userId,
    userName,
    actionType,
    description,
    oldValue,
    newValue,
  }: {
    storeId: number;
    userId?: number | null;
    userName?: string | null;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
  }) => {
    try {
      await postgresPool.query(
        `INSERT INTO system_logs (store_id, user_id, user_name, action_type, description, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          storeId,
          userId ?? null,
          String(userName || '').trim() || null,
          String(actionType || '').trim().toUpperCase(),
          String(description || '').trim(),
          serializeAuditValue(oldValue),
          serializeAuditValue(newValue),
        ],
      );
    } catch (error) {
      console.warn('Failed to write immutable audit log:', error);
    }
  };

  const getProductTotalStock = (product: any) => {
    if (product?.condition_matrix && product?.mode === 'GADGET') {
      try {
        const matrix = typeof product.condition_matrix === 'string'
          ? JSON.parse(product.condition_matrix)
          : product.condition_matrix;
        return Number(matrix?.new?.stock || 0)
          + Number(matrix?.open_box?.stock || 0)
          + Number(matrix?.used?.stock || 0);
      } catch {
        return Number(product?.stock || 0);
      }
    }

    return Number(product?.stock || 0);
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
        return {
          cost: slotCost,
          missing: false,
          usedSellingDefault: false,
          sellingPrice: resolvedSellingPrice,
        };
      }

      if (fallbackToSelling) {
        return {
          cost: resolvedSellingPrice,
          missing: resolvedSellingPrice > 0,
          usedSellingDefault: resolvedSellingPrice > 0,
          sellingPrice: resolvedSellingPrice,
        };
      }

      return {
        cost: null,
        missing: resolvedSellingPrice > 0,
        usedSellingDefault: false,
        sellingPrice: resolvedSellingPrice,
      };
    }

    const candidateCosts = [
      slotCost,
      toFiniteNumberOrNull(product?.cost),
    ];

    for (const candidate of candidateCosts) {
      if (candidate != null && (candidate > 0 || resolvedSellingPrice <= 0)) {
        return {
          cost: candidate,
          missing: false,
          usedSellingDefault: false,
          sellingPrice: resolvedSellingPrice,
        };
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

    return {
      cost: null,
      missing: resolvedSellingPrice > 0,
      usedSellingDefault: false,
      sellingPrice: resolvedSellingPrice,
    };
  };

  const getTotalPaidFromPaymentMethods = (paymentMethods: any) => {
    const methods = safeJsonParse(paymentMethods, {});
    return ['cash', 'transfer', 'pos'].reduce((sum, key) => sum + Math.max(0, Number(methods?.[key]) || 0), 0);
  };

  const buildLayawayPaymentPlan = ({
    saleChannel,
    total,
    amountPaid,
    firstDueDate,
    installmentCount,
    paymentFrequency,
    note,
  }: {
    saleChannel: unknown;
    total: unknown;
    amountPaid: unknown;
    firstDueDate: unknown;
    installmentCount: unknown;
    paymentFrequency: unknown;
    note?: unknown;
  }) => {
    const normalizedChannel = normalizeSaleChannel(saleChannel);
    const normalizedCount = Math.max(1, Math.min(24, Number(installmentCount) || 1));
    const normalizedFrequency = normalizePaymentFrequency(paymentFrequency);
    const normalizedTotal = Math.max(0, Number(total || 0) || 0);
    const normalizedAmountPaid = Math.max(0, Number(amountPaid || 0) || 0);
    const balanceDue = Math.max(0, Number((normalizedTotal - normalizedAmountPaid).toFixed(2)) || 0);
    const normalizedDueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(firstDueDate || '').trim())
      ? String(firstDueDate).trim()
      : null;
    const schedule: Array<{ installment_number: number; due_date: string; amount: number }> = [];

    if (normalizedDueDate && balanceDue > 0) {
      const baseAmount = Number((balanceDue / normalizedCount).toFixed(2));
      let runningTotal = 0;

      for (let index = 0; index < normalizedCount; index += 1) {
        const amount = index === normalizedCount - 1
          ? Number((balanceDue - runningTotal).toFixed(2))
          : baseAmount;
        runningTotal = Number((runningTotal + amount).toFixed(2));
        schedule.push({
          installment_number: index + 1,
          due_date: shiftDateByFrequency(normalizedDueDate, normalizedFrequency, index),
          amount,
        });
      }
    }

    return {
      type: normalizedChannel,
      installment_count: normalizedCount,
      payment_frequency: normalizedFrequency,
      deposit_paid: normalizedAmountPaid,
      balance_due: balanceDue,
      first_due_date: normalizedDueDate,
      note: String(note || '').trim() || null,
      schedule,
    };
  };

  const formatInventoryBatch = (entry: any) => {
    const expiryDate = normalizeBatchExpiryDate(entry?.expiry_date);
    const quantityReceived = Math.max(0, Number(entry?.quantity_received || 0) || 0);
    const quantityRemaining = Math.max(0, Number(entry?.quantity_remaining || 0) || 0);
    let status = 'NO_EXPIRY';
    let daysUntilExpiry: number | null = null;

    if (quantityRemaining <= 0) {
      status = 'DEPLETED';
    } else if (expiryDate) {
      const expiryTime = new Date(`${expiryDate}T23:59:59`).getTime();
      if (Number.isFinite(expiryTime)) {
        daysUntilExpiry = Math.ceil((expiryTime - Date.now()) / 86400000);
        if (daysUntilExpiry < 0) {
          status = 'EXPIRED';
        } else if (daysUntilExpiry <= 30) {
          status = 'EXPIRING_SOON';
        } else {
          status = 'ACTIVE';
        }
      }
    }

    return {
      ...entry,
      batch_code: normalizeBatchCode(entry?.batch_code),
      expiry_date: expiryDate,
      quantity_received: quantityReceived,
      quantity_remaining: quantityRemaining,
      unit_cost: Math.max(0, Number(entry?.unit_cost || 0) || 0),
      condition: entry?.condition ? normalizeCollectionCondition(entry.condition) : null,
      product_name: String(entry?.product_name || `Product #${entry?.product_id || '—'}`),
      supplier_name: entry?.supplier_name ? String(entry.supplier_name) : null,
      received_by_username: entry?.received_by_username ? String(entry.received_by_username) : null,
      status,
      days_until_expiry: daysUntilExpiry,
    };
  };

  const formatStockAdjustmentEntry = (entry: any) => ({
    ...entry,
    quantity_before: Number(entry?.quantity_before || 0) || 0,
    quantity_change: Number(entry?.quantity_change || 0) || 0,
    quantity_after: Number(entry?.quantity_after || 0) || 0,
    counted_quantity: entry?.counted_quantity == null ? null : (Number(entry?.counted_quantity || 0) || 0),
    variance_quantity: Number(entry?.variance_quantity || 0) || 0,
    cost_impact: Number(entry?.cost_impact || 0) || 0,
    adjustment_type: String(entry?.adjustment_type || 'MANUAL').toUpperCase(),
    adjustment_mode: String(entry?.adjustment_mode || 'DECREASE').toUpperCase(),
    recount_status: normalizeRecountStatus(entry?.recount_status),
    awaiting_approval: normalizeRecountStatus(entry?.recount_status) === 'PENDING',
    condition: entry?.condition ? normalizeCollectionCondition(entry.condition) : null,
    product_name: entry?.product_name || `Product #${entry?.product_id || '—'}`,
    category_name: entry?.category_name || entry?.category || 'General',
    adjusted_by_username: entry?.adjusted_by_username || 'Staff',
    approved_by_username: entry?.approved_by_username || null,
    approved_at: entry?.approved_at ? String(entry.approved_at) : null,
    approval_note: entry?.approval_note ? String(entry.approval_note) : null,
  });

  const formatPurchaseOrder = (entry: any) => {
    const items = safeJsonParse(entry?.items, []).map((item: any, index: number) => {
      const quantity = Math.max(0, Math.floor(Number(item?.quantity) || 0));
      const unitCost = Math.max(0, Number(item?.unit_cost ?? item?.cost ?? 0) || 0);
      const lineTotal = Number(item?.line_total ?? (unitCost * quantity)) || 0;

      return {
        ...item,
        id: item?.id || `${entry?.id || 'po'}-${index}`,
        product_id: Number(item?.product_id) || 0,
        product_name: String(item?.product_name || item?.name || `Item ${index + 1}`),
        quantity,
        unit_cost: unitCost,
        line_total: lineTotal,
        condition: item?.condition ? normalizeCollectionCondition(item.condition) : null,
        batch_code: normalizeBatchCode(item?.batch_code),
        expiry_date: normalizeBatchExpiryDate(item?.expiry_date),
      };
    });

    return {
      ...entry,
      supplier_name: String(entry?.supplier_name || 'Unknown Supplier'),
      status: String(entry?.status || 'ORDERED').toUpperCase(),
      subtotal: Number(entry?.subtotal || items.reduce((sum: number, item: any) => sum + (Number(item.line_total) || 0), 0)) || 0,
      total_quantity: items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0),
      items,
      created_by_username: entry?.created_by_username || 'Staff',
      received_by_username: entry?.received_by_username || null,
    };
  };

  const formatMarketCollection = (entry: any) => {
    const items = safeJsonParse(entry?.items, []).map((item: any, index: number) => {
      const quantity = Math.max(0, Number(item?.quantity) || 0);
      const priceAtCollection = Number(item?.price_at_collection ?? item?.price_at_sale ?? 0) || 0;
      const costAtCollection = Number(item?.cost_at_collection ?? item?.cost ?? 0) || 0;

      return {
        ...item,
        id: item?.id || `${entry?.id || 'collection'}-${index}`,
        product_id: Number(item?.product_id) || 0,
        name: String(item?.name || item?.product_name || `Item ${index + 1}`),
        quantity,
        condition: normalizeCollectionCondition(item?.condition),
        price_at_collection: priceAtCollection,
        cost_at_collection: costAtCollection,
        subtotal: Number(item?.subtotal ?? (priceAtCollection * quantity)) || 0,
        specs_at_collection: safeJsonParse(item?.specs_at_collection, {}),
      };
    });

    const totalQuantity = items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0);
    const totalValue = items.reduce((sum: number, item: any) => sum + (Number(item.subtotal) || 0), 0);
    const totalCost = items.reduce((sum: number, item: any) => sum + ((Number(item.cost_at_collection) || 0) * (Number(item.quantity) || 0)), 0);
    const overdue = isCollectionOverdue(entry?.status, entry?.expected_return_date);

    return {
      ...entry,
      phone: String(entry?.phone || ''),
      items,
      total_quantity: totalQuantity,
      total_value: totalValue,
      total_cost: totalCost,
      is_overdue: overdue,
      status_label: overdue ? 'OVERDUE' : String(entry?.status || 'OPEN').toUpperCase(),
    };
  };

  const formatRepairTicket = (entry: any) => {
    const estimatedCost = Math.max(0, Number(entry?.estimated_cost || 0) || 0);
    const finalCost = Math.max(0, Number(entry?.final_cost || estimatedCost || 0) || 0);
    const amountPaid = Math.max(0, Number(entry?.amount_paid || 0) || 0);
    const amountDue = Math.max(0, finalCost - amountPaid);
    const normalizedStatus = String(entry?.status || 'RECEIVED').toUpperCase();
    const promisedDate = String(entry?.promised_date || '').trim();
    const isOverdue = Boolean(promisedDate)
      && !['DELIVERED', 'CANCELLED'].includes(normalizedStatus)
      && promisedDate < new Date().toISOString().slice(0, 10);

    return {
      ...entry,
      ticket_number: String(entry?.ticket_number || `RPR-${entry?.id || '—'}`),
      customer_name: String(entry?.customer_name || 'Walk-in Customer'),
      customer_phone: String(entry?.customer_phone || ''),
      device_name: String(entry?.device_name || 'Device'),
      brand: String(entry?.brand || ''),
      model: String(entry?.model || ''),
      imei_serial: String(entry?.imei_serial || ''),
      issue_summary: String(entry?.issue_summary || ''),
      accessories: String(entry?.accessories || ''),
      purchase_reference: String(entry?.purchase_reference || ''),
      technician_name: String(entry?.technician_name || ''),
      intake_notes: String(entry?.intake_notes || ''),
      internal_notes: String(entry?.internal_notes || ''),
      warranty_status: String(entry?.warranty_status || 'NO_WARRANTY').toUpperCase(),
      estimated_cost: estimatedCost,
      final_cost: finalCost,
      amount_paid: amountPaid,
      amount_due: amountDue,
      status: normalizedStatus,
      is_overdue: isOverdue,
      status_label: isOverdue && !['READY', 'DELIVERED', 'CANCELLED'].includes(normalizedStatus) ? 'OVERDUE' : normalizedStatus,
      created_by_username: entry?.created_by_username || 'Staff',
      updated_by_username: entry?.updated_by_username || null,
    };
  };

  const formatSaleReturnEntry = (entry: any) => {
    const items = safeJsonParse(entry?.items, []).map((item: any, index: number) => {
      const quantity = Math.max(0, Number(item?.quantity) || 0);
      const unitPrice = Number(item?.price_at_sale ?? item?.unit_price ?? 0) || 0;

      return {
        ...item,
        id: item?.id || `${entry?.id || 'return'}-${index}`,
        sale_item_id: Number(item?.sale_item_id) || 0,
        product_id: Number(item?.product_id) || 0,
        name: String(item?.name || item?.product_name || `Item ${index + 1}`),
        quantity,
        price_at_sale: unitPrice,
        subtotal: Number(item?.subtotal ?? (unitPrice * quantity)) || 0,
        item_source: String(item?.item_source || '').toUpperCase() === 'SOURCED'
          ? 'SOURCED'
          : (String(item?.item_source || '').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : 'INVENTORY'),
        sourced_vendor_name: item?.sourced_vendor_name ? String(item.sourced_vendor_name) : null,
        sourced_vendor_reference: item?.sourced_vendor_reference ? String(item.sourced_vendor_reference) : null,
        return_to_vendor_required: Boolean(item?.return_to_vendor_required),
        vendor_payable_adjustment: Math.max(0, Number(item?.vendor_payable_adjustment || 0) || 0),
        vendor_payable_source: String(item?.vendor_payable_source || '').toUpperCase() === 'CONSIGNMENT' ? 'CONSIGNMENT' : (String(item?.vendor_payable_source || '').toUpperCase() === 'SOURCED' ? 'SOURCED' : null),
        condition: item?.condition ? normalizeCollectionCondition(item.condition) : null,
        imei_serial: item?.imei_serial || null,
        specs_at_sale: safeJsonParse(item?.specs_at_sale, {}),
      };
    });

    return {
      ...entry,
      items,
      item_count: items.reduce((sum: number, item: any) => sum + (Number(item.quantity) || 0), 0),
      returned_value: Number(entry?.returned_value || 0) || 0,
      refund_amount: Number(entry?.refund_amount || 0) || 0,
      return_type: String(entry?.return_type || 'REFUND').toUpperCase(),
      refund_method: String(entry?.refund_method || 'cash').toLowerCase(),
      restock_items: Number(entry?.restock_items || 0) === 1,
      return_to_vendor_count: items.filter((item: any) => Boolean(item?.return_to_vendor_required)).length,
    };
  };

  const getSaleReturnsMeta = async (saleId: number) => {
    const result = await postgresPool.query(
      `SELECT
        COUNT(*) as returns_count,
        COALESCE(SUM(returned_value), 0) as returned_amount,
        COALESCE(SUM(refund_amount), 0) as refunded_amount
       FROM sales_returns
       WHERE sale_id = $1`,
      [saleId],
    );
    return result.rows[0] || null;
  };

  const formatSaleResponse = async (sale: any) => {
    const total = Number(sale.total) || 0;
    const paymentMethods = safeJsonParse(sale.payment_methods, {});
    const amountPaid = getTotalPaidFromPaymentMethods(paymentMethods);

    let returnedAmount = Number(sale?.returned_amount);
    let refundedAmount = Number(sale?.refunded_amount);
    let returnsCount = Number(sale?.returns_count);

    if ((!Number.isFinite(returnedAmount) || !Number.isFinite(refundedAmount) || !Number.isFinite(returnsCount)) && sale?.id) {
      const meta = await getSaleReturnsMeta(Number(sale.id));
      returnedAmount = Number(meta?.returned_amount || 0);
      refundedAmount = Number(meta?.refunded_amount || 0);
      returnsCount = Number(meta?.returns_count || 0);
    }

    const normalizedReturnedAmount = Math.max(0, Number(returnedAmount) || 0);
    const normalizedRefundedAmount = Math.max(0, Number(refundedAmount) || 0);
    const normalizedReturnsCount = Math.max(0, Number(returnsCount) || 0);
    const discountAmount = Math.max(0, Number(sale?.discount_amount || 0) || 0);
    const subtotalAmount = Number(sale.subtotal ?? sale.total) || 0;
    const netSubtotal = Math.max(0, Number((subtotalAmount - discountAmount).toFixed(2)) || 0);
    const netTotal = Math.max(0, Number((total - normalizedReturnedAmount).toFixed(2)) || 0);
    const amountDue = Math.max(0, Number((netTotal - amountPaid).toFixed(2)) || 0);
    const creditBalance = Math.max(0, Number((amountPaid - netTotal).toFixed(2)) || 0);
    const returnStatus = normalizedReturnsCount === 0 ? 'NONE' : normalizedReturnedAmount >= total - 0.01 ? 'FULL' : 'PARTIAL';
    const saleChannel = normalizeSaleChannel(sale?.sale_channel);
    const rawPaymentPlan = safeJsonParse(sale?.payment_plan, null);
    const normalizedPlanSchedule = Array.isArray(rawPaymentPlan?.schedule)
      ? rawPaymentPlan.schedule.map((entry: any, index: number) => ({
          installment_number: Math.max(1, Number(entry?.installment_number || index + 1) || (index + 1)),
          due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(entry?.due_date || '').trim()) ? String(entry.due_date).trim() : null,
          amount: Math.max(0, Number(entry?.amount || 0) || 0),
        }))
      : [];
    const paymentPlan = rawPaymentPlan
      ? {
          ...rawPaymentPlan,
          type: normalizeSaleChannel(rawPaymentPlan?.type || saleChannel),
          payment_frequency: normalizePaymentFrequency(rawPaymentPlan?.payment_frequency),
          installment_count: Math.max(1, Number(rawPaymentPlan?.installment_count || normalizedPlanSchedule.length || 1) || 1),
          deposit_paid: Math.max(0, Number(rawPaymentPlan?.deposit_paid || 0) || 0),
          balance_due: amountDue,
          schedule: normalizedPlanSchedule,
        }
      : null;

    const depositPaid = Math.max(0, Number(paymentPlan?.deposit_paid || 0) || 0);
    const paidTowardsInstallments = Math.max(0, Number((amountPaid - depositPaid).toFixed(2)) || 0);
    let runningScheduledAmount = 0;
    let nextInstallment: any = null;

    for (const entry of normalizedPlanSchedule) {
      const scheduledAmount = Math.max(0, Number(entry.amount || 0) || 0);
      runningScheduledAmount = Number((runningScheduledAmount + scheduledAmount).toFixed(2));
      if (paidTowardsInstallments + 0.009 < runningScheduledAmount) {
        nextInstallment = {
          ...entry,
          amount_remaining: Math.max(0, Number((runningScheduledAmount - paidTowardsInstallments).toFixed(2)) || 0),
        };
        break;
      }
    }

    const nextInstallmentDueDate = String(nextInstallment?.due_date || sale?.due_date || '').trim() || null;
    const isDueOverdue = Boolean(nextInstallmentDueDate)
      && amountDue > 0
      && String(sale?.status || '').toUpperCase() !== 'VOIDED'
      && new Date(`${nextInstallmentDueDate}T23:59:59`).getTime() < Date.now();
    const lockedUntilPaid = saleChannel !== 'STANDARD'
      ? amountDue > 0 && String(sale?.status || '').toUpperCase() !== 'VOIDED'
      : Number(sale?.locked_until_paid || 0) === 1;

    return {
      ...sale,
      subtotal: subtotalAmount,
      discount_amount: discountAmount,
      discount_type: sale?.discount_type || null,
      discount_value: Math.max(0, Number(sale?.discount_value || 0) || 0),
      discount_note: sale?.discount_note || null,
      show_discount_on_invoice: sale?.show_discount_on_invoice !== 0,
      tax_amount: Number(sale.tax_amount) || 0,
      tax_percentage: Number(sale.tax_percentage) || 0,
      total,
      net_subtotal: netSubtotal,
      net_total: netTotal,
      payment_methods: paymentMethods,
      amount_paid: amountPaid,
      amount_due: amountDue,
      credit_balance: creditBalance,
      returned_amount: normalizedReturnedAmount,
      refunded_amount: normalizedRefundedAmount,
      returns_count: normalizedReturnsCount,
      return_status: returnStatus,
      due_date: sale.due_date || null,
      note: sale.note || null,
      customer_name: sale.customer_name || 'Walk-in Customer',
      customer_phone: sale.customer_phone || null,
      customer_address: sale.customer_address || null,
      sale_channel: saleChannel,
      payment_plan: paymentPlan,
      locked_until_paid: lockedUntilPaid,
      is_layaway: saleChannel === 'LAYAWAY',
      is_installment: saleChannel === 'INSTALLMENT',
      reference_code: saleChannel === 'STANDARD' ? `SALE-${sale.id}` : `PLAN-${sale.id}`,
      next_installment_due_date: nextInstallmentDueDate,
      next_installment_amount: Math.max(0, Number(nextInstallment?.amount_remaining ?? nextInstallment?.amount ?? 0) || 0),
      is_due_overdue: isDueOverdue,
    };
  };

  return {
    logSystemActivity,
    formatAuditCurrency,
    getMissingCostPriceLabels,
    getAuditActorLabel,
    logAuditEvent,
    getProductTotalStock,
    toFiniteNumberOrNull,
    resolveTrackedCost,
    getTotalPaidFromPaymentMethods,
    buildLayawayPaymentPlan,
    formatInventoryBatch,
    formatStockAdjustmentEntry,
    formatPurchaseOrder,
    formatMarketCollection,
    formatRepairTicket,
    formatSaleReturnEntry,
    getSaleReturnsMeta,
    formatSaleResponse,
    getShiftDateKey,
    getAttendanceDurationMinutes,
    formatAttendanceEntry,
  };
};

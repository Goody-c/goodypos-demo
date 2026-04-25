type PayableAdjustmentInput = {
  currentAmountDue: number;
  returnCostValue: number;
  currentStatus: string;
};

type PayableAdjustmentResult = {
  nextAmountDue: number;
  nextStatus: 'UNPAID' | 'SETTLED';
};

export const computePayableAfterReturn = (input: PayableAdjustmentInput): PayableAdjustmentResult => {
  const currentAmountDue = Math.max(0, Number(input.currentAmountDue || 0) || 0);
  const returnCostValue = Math.max(0, Number(input.returnCostValue || 0) || 0);
  const nextAmountDue = Math.max(0, Number((currentAmountDue - returnCostValue).toFixed(2)) || 0);
  const nextStatus: 'UNPAID' | 'SETTLED' = nextAmountDue <= 0.009 ? 'SETTLED' : 'UNPAID';
  return { nextAmountDue, nextStatus };
};

export const logVendorPayableMutation = (payload: {
  action: 'created' | 'status_changed' | 'return_adjusted';
  storeId: number;
  saleId?: number;
  saleItemId?: number;
  payableId?: number;
  sourceType?: 'SOURCED' | 'CONSIGNMENT';
  amountDue?: number;
  previousAmountDue?: number;
  nextAmountDue?: number;
  previousStatus?: string;
  nextStatus?: string;
  actorUserId?: number;
}) => {
  const event = {
    type: 'vendor_payable_mutation',
    timestamp: new Date().toISOString(),
    ...payload,
  };
  console.info(`[vendor_payable_mutation] ${JSON.stringify(event)}`);
};

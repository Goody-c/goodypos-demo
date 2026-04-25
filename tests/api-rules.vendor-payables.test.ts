import assert from 'node:assert/strict';
import { computePayableAfterReturn } from '../serverVendorPayableRules';

const run = () => {
  const sourcedRule = computePayableAfterReturn({
    currentAmountDue: 700,
    returnCostValue: 250,
    currentStatus: 'UNPAID',
  });
  assert.equal(sourcedRule.nextAmountDue, 450);
  assert.equal(sourcedRule.nextStatus, 'UNPAID');

  const consignmentRule = computePayableAfterReturn({
    currentAmountDue: 500,
    returnCostValue: 500,
    currentStatus: 'UNPAID',
  });
  assert.equal(consignmentRule.nextAmountDue, 0);
  assert.equal(consignmentRule.nextStatus, 'SETTLED');

  const negativeProtection = computePayableAfterReturn({
    currentAmountDue: 120,
    returnCostValue: 400,
    currentStatus: 'UNPAID',
  });
  assert.equal(negativeProtection.nextAmountDue, 0);
  assert.equal(negativeProtection.nextStatus, 'SETTLED');

  console.log('api-rules.vendor-payables: all assertions passed');
};

run();

/**
 * Confirmed Hong Kong Harp Centre CRM Bonus Point Engine (V47 CRMRule RID=1..3, ACTTYPE=1, ENABLED=1):
 * - RID=1 (C1 IN (0, 1, 2)): Every HK$10 spent = +1 point (FORMAT='RD0', floor), excluding bonus-ignored SKUs
 * - RID=2 (C1 = 3, Harps):     Every HK$100 spent = +1 point (FORMAT='RD0', floor), excluding bonus-ignored SKUs
 * - RID=3 (BC = 'HCOS001'):  Redeem 100 points per voucher quantity (e.g. $50 voucher), requires points >= qty * 100
 */

export interface CrmBillLineInput {
  sku: string;
  categoryC1: number;
  quantity: number;
  lineNetAmountHkd: number;
  excludeFromCrmBonus?: boolean;
  cancelled?: boolean;
}

export interface CrmPointCalculation {
  earnedPoints: number;
  redeemedPoints: number;
  netPointDelta: number;
  tier10SpendHkd: number;
  tier100SpendHkd: number;
  redemptionAllowed: boolean;
  redemptionError?: string;
}

export const CRM_VOUCHER_SKU = "HCOS001";
export const CRM_POINTS_PER_VOUCHER = 100;

export function calculateCrmPoints(
  lines: readonly CrmBillLineInput[],
  customerCurrentPoints: number,
): CrmPointCalculation {
  let tier10SpendHkd = 0;
  let tier100SpendHkd = 0;
  let voucherRedeemQty = 0;

  for (const line of lines) {
    if (line.cancelled) continue;
    if (line.sku.trim().toUpperCase() === CRM_VOUCHER_SKU) {
      voucherRedeemQty += line.quantity;
      continue;
    }
    if (line.excludeFromCrmBonus) continue;
    if (line.lineNetAmountHkd <= 0) continue;

    if (line.categoryC1 === 0 || line.categoryC1 === 1 || line.categoryC1 === 2) {
      tier10SpendHkd += line.lineNetAmountHkd;
    } else if (line.categoryC1 === 3) {
      tier100SpendHkd += line.lineNetAmountHkd;
    }
  }

  const rid1Earned = Math.floor((tier10SpendHkd + 1e-9) / 10);
  const rid2Earned = Math.floor((tier100SpendHkd + 1e-9) / 100);
  const earnedPoints = rid1Earned + rid2Earned;

  const redeemedPoints = Math.round(voucherRedeemQty * CRM_POINTS_PER_VOUCHER);
  const redemptionAllowed = customerCurrentPoints + earnedPoints >= redeemedPoints;

  return {
    earnedPoints,
    redeemedPoints,
    netPointDelta: earnedPoints - (redemptionAllowed ? redeemedPoints : 0),
    tier10SpendHkd: Number(tier10SpendHkd.toFixed(2)),
    tier100SpendHkd: Number(tier100SpendHkd.toFixed(2)),
    redemptionAllowed,
    redemptionError: redemptionAllowed
      ? undefined
      : `Insufficient points for ${CRM_VOUCHER_SKU}: need ${redeemedPoints}, have ${customerCurrentPoints}`,
  };
}

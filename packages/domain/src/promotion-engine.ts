import { calculateBillTotals } from "./bill-math";
import { roundToCents } from "./money";

export interface PromotionLine {
  sku: string;
  categoryC1: number;
  quantity: number;
  unitPriceHkd: number;
  discountRate?: number;
}

export interface PromotionRule {
  id: number;
  code: string;
  name: string;
  priority: number;
  stackable: boolean;
  validFromIso?: string;
  validToIso?: string;
  targetSkus?: readonly string[];
  targetCategoryC1?: readonly number[];
  minimumQuantity?: number;
  minimumSubtotalHkd?: number;
  action:
    | { type: "PERCENT_OFF"; percent: number }
    | { type: "FIXED_PRICE"; unitPriceHkd: number }
    | { type: "AMOUNT_OFF"; amountHkd: number }
    | { type: "MIX_MATCH"; requiredQuantity: number; bundlePriceHkd: number };
}

function matches(line: PromotionLine, rule: PromotionRule): boolean {
  if (rule.targetSkus && !rule.targetSkus.includes(line.sku)) return false;
  if (rule.targetCategoryC1 && !rule.targetCategoryC1.includes(line.categoryC1)) return false;
  return true;
}

export function applyPromotionRules(
  inputLines: readonly PromotionLine[],
  rules: readonly PromotionRule[],
  at = new Date(),
) {
  const lines = inputLines.map((line) => ({
    ...line,
    quantity: Math.max(0, line.quantity),
    unitPriceHkd: Math.max(0, line.unitPriceHkd),
    discountRate: line.discountRate ?? 0,
  }));
  const activeRules = rules
    .filter((rule) => {
      if (rule.validFromIso && at < new Date(rule.validFromIso)) return false;
      if (rule.validToIso && at > new Date(rule.validToIso)) return false;
      return true;
    })
    .sort((a, b) => a.priority - b.priority || a.id - b.id);
  const applied: Array<{ ruleId: number; code: string; name: string; discountHkd: number }> = [];
  let billDiscountHkd = 0;
  let lockedByExclusiveRule = false;

  for (const rule of activeRules) {
    if (lockedByExclusiveRule) continue;
    const before = calculateBillTotals(lines).netAmountHkd - billDiscountHkd;
    const matchedIndexes = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => matches(line, rule) && line.quantity > 0)
      .map(({ index }) => index);
    const matchedQuantity = matchedIndexes.reduce((sum, index) => sum + (lines[index]?.quantity ?? 0), 0);
    const matchedSubtotal = matchedIndexes.reduce((sum, index) => {
      const line = lines[index]!;
      return sum + line.quantity * line.unitPriceHkd * (1 - line.discountRate);
    }, 0);
    if (matchedQuantity < (rule.minimumQuantity ?? 0) || matchedSubtotal < (rule.minimumSubtotalHkd ?? 0)) {
      continue;
    }

    if (rule.action.type === "PERCENT_OFF") {
      const rate = Math.min(1, Math.max(0, rule.action.percent / 100));
      for (const index of matchedIndexes) {
        const line = lines[index]!;
        line.discountRate = 1 - (1 - line.discountRate) * (1 - rate);
      }
    } else if (rule.action.type === "FIXED_PRICE") {
      for (const index of matchedIndexes) {
        const line = lines[index]!;
        if (rule.action.unitPriceHkd < line.unitPriceHkd) {
          line.discountRate = 1 - rule.action.unitPriceHkd / line.unitPriceHkd;
        }
      }
    } else if (rule.action.type === "AMOUNT_OFF") {
      billDiscountHkd = Math.min(
        calculateBillTotals(lines).netAmountHkd,
        billDiscountHkd + Math.max(0, rule.action.amountHkd),
      );
    } else {
      const bundleCount = Math.floor(matchedQuantity / rule.action.requiredQuantity);
      if (bundleCount === 0) continue;
      const regularValue = matchedIndexes.reduce((sum, index) => {
        const line = lines[index]!;
        return sum + line.quantity * line.unitPriceHkd * (1 - line.discountRate);
      }, 0);
      const unitsInBundles = bundleCount * rule.action.requiredQuantity;
      const targetValue = bundleCount * rule.action.bundlePriceHkd;
      const bundleRate = regularValue > 0
        ? Math.min(1, Math.max(0, unitsInBundles / matchedQuantity - targetValue / regularValue))
        : 0;
      for (const index of matchedIndexes) {
        const line = lines[index]!;
        line.discountRate = 1 - (1 - line.discountRate) * (1 - bundleRate);
      }
    }

    const after = calculateBillTotals(lines).netAmountHkd - billDiscountHkd;
    const discountHkd = roundToCents(Math.max(0, before - after));
    if (discountHkd <= 0) continue;
    applied.push({ ruleId: rule.id, code: rule.code, name: rule.name, discountHkd });
    if (!rule.stackable) lockedByExclusiveRule = true;
  }

  const totals = calculateBillTotals(lines);
  return {
    lines,
    applied,
    billDiscountHkd: roundToCents(billDiscountHkd),
    totalDiscountHkd: roundToCents(totals.discountAmountHkd + billDiscountHkd),
    netAmountHkd: roundToCents(Math.max(0, totals.netAmountHkd - billDiscountHkd)),
  };
}

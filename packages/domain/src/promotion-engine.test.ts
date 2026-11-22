import { describe, expect, it } from "vitest";
import { applyPromotionRules, type PromotionRule } from "./promotion-engine";

const lines = [
  { sku: "STR-A", categoryC1: 1, quantity: 2, unitPriceHkd: 100 },
  { sku: "BOOK-B", categoryC1: 2, quantity: 1, unitPriceHkd: 50 },
];

function rule(action: PromotionRule["action"], overrides: Partial<PromotionRule> = {}): PromotionRule {
  return {
    id: 1,
    code: "PROMO",
    name: "Test promotion",
    priority: 1,
    stackable: true,
    action,
    ...overrides,
  };
}

describe("PEngRule TypeScript promotion engine", () => {
  it("applies targeted percentage and fixed-price rules without changing unrelated lines", () => {
    const result = applyPromotionRules(lines, [
      rule({ type: "PERCENT_OFF", percent: 10 }, { targetCategoryC1: [1] }),
      rule({ type: "FIXED_PRICE", unitPriceHkd: 40 }, { id: 2, priority: 2, targetSkus: ["BOOK-B"] }),
    ]);
    expect(result.lines[0]?.discountRate).toBeCloseTo(0.1);
    expect(result.lines[1]?.discountRate).toBeCloseTo(0.2);
    expect(result.netAmountHkd).toBe(220);
    expect(result.applied.map((item) => item.ruleId)).toEqual([1, 2]);
  });

  it("calculates mix-and-match bundles while leaving non-bundle units at regular price", () => {
    const result = applyPromotionRules(
      [{ sku: "STR-A", categoryC1: 1, quantity: 5, unitPriceHkd: 100 }],
      [rule({ type: "MIX_MATCH", requiredQuantity: 3, bundlePriceHkd: 250 }, { targetSkus: ["STR-A"] })],
    );
    expect(result.netAmountHkd).toBe(450);
    expect(result.totalDiscountHkd).toBe(50);
  });

  it("caps amount-off discounts and stops lower-priority rules after an exclusive rule", () => {
    const result = applyPromotionRules(lines, [
      rule({ type: "AMOUNT_OFF", amountHkd: 1000 }, { minimumSubtotalHkd: 200, stackable: false }),
      rule({ type: "PERCENT_OFF", percent: 50 }, { id: 2, priority: 2 }),
    ]);
    expect(result.netAmountHkd).toBe(0);
    expect(result.billDiscountHkd).toBe(250);
    expect(result.applied).toHaveLength(1);
  });

  it("honours validity dates and minimum quantity", () => {
    const result = applyPromotionRules(lines, [
      rule({ type: "PERCENT_OFF", percent: 10 }, {
        minimumQuantity: 4,
        validFromIso: "2026-01-01T00:00:00+08:00",
        validToIso: "2026-12-31T23:59:59+08:00",
      }),
    ], new Date("2026-06-01T12:00:00+08:00"));
    expect(result.netAmountHkd).toBe(250);
    expect(result.applied).toHaveLength(0);
  });
});

import { describe, it, expect } from "vitest";
import { parsePosRoundSpec, posRound } from "./rounding";
import { calculateBillTotals, createIssuedInvoice, settleInvoicePayment } from "./bill-math";
import { calculateCrmPoints } from "./crm-rules";
import { validateOctopusAmountHkd, handleOctopusResult, OCTOPUS_INCOMPLETE_TXN_CODE } from "./octopus-rules";

describe("eRunCommon.POSRound parity", () => {
  it("parses V47 CustomerData BillItemRound='1U' as 0.1 Up and matches Up/Down/AwayFromZero modes", () => {
    expect(parsePosRoundSpec("1U")).toEqual({ unit: 0.1, mode: "U" });
    expect(posRound(12.31, 0.1, "U")).toBe(12.4);
    expect(posRound(12.39, 0.1, "D")).toBe(12.3);
    expect(posRound(12.25, 0.1, "R")).toBe(12.3);
    expect(posRound(10.01, 0.5, "U")).toBe(10.5);
  });
});

describe("Bill math & Issue-Invoice -> Bank Transfer AR workflow", () => {
  it("excludes cancelled lines, modifier lines, and DK=-1000 CRM bonus lines", () => {
    const totals = calculateBillTotals([
      { sku: "HARP-01", quantity: 1, unitPriceHkd: 828, dk: 1 },
      { sku: "CANCELLED", quantity: 1, unitPriceHkd: 500, dk: 2, cancelled: true },
      { sku: "MOD-01", quantity: 1, unitPriceHkd: 50, dk: 3, isModifier: true },
      { sku: "999010", quantity: 1, unitPriceHkd: 82, dk: -1000 }, // CRM point marker
    ]);
    expect(totals.activeLineCount).toBe(1);
    expect(totals.grossAmountHkd).toBe(828);
    expect(totals.netAmountHkd).toBe(828);
  });

  it("issues an unpaid invoice first (no $0 dlybal) and settles via partial then final Bank Transfer", () => {
    const issued = createIssuedInvoice({
      invoiceNo: "INV-2026-0001",
      docType: "SALES_INVOICE",
      netAmountHkd: 48000,
      issuedAtIso: "2026-11-21T10:00:00+08:00",
    });

    expect(issued.paymentStatus).toBe("unpaid");
    expect(issued.balanceDueHkd).toBe(48000);
    expect(issued.payments).toHaveLength(0);

    // Partial deposit via standalone MasterCard (PM=3)
    const afterDeposit = settleInvoicePayment(issued, {
      tenderCode: "MASTERCARD",
      amountHkd: 10000,
      paidAtIso: "2026-11-21T10:05:00+08:00",
      referenceNo: "AUTH-88412",
    });
    expect(afterDeposit.paymentStatus).toBe("partial");
    expect(afterDeposit.balanceDueHkd).toBe(38000);

    // Cannot overpay via Bank Transfer
    expect(() =>
      settleInvoicePayment(afterDeposit, {
        tenderCode: "BANK_XFER",
        amountHkd: 39000,
        paidAtIso: "2026-11-23T14:20:00+08:00",
        referenceNo: "FPS-REF-1",
      }),
    ).toThrow();

    // Final Bank Transfer settlement 2 days later
    const settled = settleInvoicePayment(afterDeposit, {
      tenderCode: "BANK_XFER",
      amountHkd: 38000,
      paidAtIso: "2026-11-23T14:25:00+08:00",
      referenceNo: "HSBC-TT-20261123-09",
    });
    expect(settled.paymentStatus).toBe("paid");
    expect(settled.balanceDueHkd).toBe(0);
    expect(settled.issuedAtIso).toBe("2026-11-21T10:00:00+08:00");
    expect(settled.paidAtIso).toBe("2026-11-23T14:25:00+08:00");
  });
});

describe("Hong Kong Harp Centre CRMRule (RID=1,2,3)", () => {
  it("computes RID=1 ($10/pt), RID=2 ($100/pt for Harps), and RID=3 (HCOS001 redemption)", () => {
    const res = calculateCrmPoints(
      [
        { sku: "STR-01", categoryC1: 1, quantity: 1, lineNetAmountHkd: 828 }, // 82 pts
        { sku: "HARP-01", categoryC1: 3, quantity: 1, lineNetAmountHkd: 25900 }, // 259 pts
        { sku: "HCOS001", categoryC1: 0, quantity: 2, lineNetAmountHkd: 0 }, // redeem 200 pts
      ],
      10,
    );
    expect(res.earnedPoints).toBe(341);
    expect(res.redeemedPoints).toBe(200);
    expect(res.redemptionAllowed).toBe(true);
    expect(res.netPointDelta).toBe(141);
  });
});

describe("Octopus RWL validation & 100022 lock", () => {
  it("rejects non-10-cent amounts and enforces same CardID retry on 100022", () => {
    expect(validateOctopusAmountHkd(12.35).ok).toBe(false);
    expect(validateOctopusAmountHkd(12.3)).toEqual({ ok: true, amountCents: 1230 });

    const lock = handleOctopusResult({ status: "READY" }, "R99-1", 1230, {
      code: OCTOPUS_INCOMPLETE_TXN_CODE,
      cardId: "12345678",
    });
    expect(lock.canCancelBill).toBe(false);
    expect(lock.nextState.status).toBe("INCOMPLETE_LOCKED_100022");

    const wrongCard = handleOctopusResult(lock.nextState, "R99-1", 1230, {
      code: 0,
      cardId: "99999999",
      remainingCents: 5000,
    });
    expect(wrongCard.nextState.status).toBe("INCOMPLETE_LOCKED_100022");

    const sameCard = handleOctopusResult(lock.nextState, "R99-1", 1230, {
      code: 0,
      cardId: "12345678",
      remainingCents: 4520,
    });
    expect(sameCard.nextState.status).toBe("APPROVED");
  });
});

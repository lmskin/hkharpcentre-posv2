import type { PaymentMode, TenderCode } from "@hkharp/contracts";

export interface LegacyPayMethodMapping {
  legacyPm: number;
  legacyCcy: string;
  tenderCode: TenderCode | null; // null => retired legacy marker (e.g. PM=8 $0 dlybal)
  mode: PaymentMode | "retired_dlybal";
  nameZh: string;
  nameEn: string;
  notes: string;
}

/**
 * Authoritative V47 HistPayment.PM -> Target MySQL pay_methods mapping.
 * Locked in by operator:
 *  - PM=3 is MasterCard (CustomerData D1L='支付寶' / D2L='AliPay' was a legacy mislabel)
 *  - PM=8 ($0 dlybal placeholder) is retired in favor of first-class unpaid/partial invoice tracking
 */
export const LEGACY_PAY_METHOD_MAP: Readonly<Record<number, LegacyPayMethodMapping>> = {
  0: {
    legacyPm: 0,
    legacyCcy: "cash",
    tenderCode: "CASH",
    mode: "cash",
    nameZh: "現金",
    nameEn: "Cash",
    notes: "Physical cash drawer",
  },
  1: {
    legacyPm: 1,
    legacyCcy: "Octopus",
    tenderCode: "OCTOPUS",
    mode: "octopus",
    nameZh: "八達通",
    nameEn: "Octopus",
    notes: "Integrated PC RWL reader via pos-hardware-bridge (rwl.dll)",
  },
  2: {
    legacyPm: 2,
    legacyCcy: "visa",
    tenderCode: "VISA",
    mode: "credit_card_standalone",
    nameZh: "Visa",
    nameEn: "Visa",
    notes: "Standalone bank card terminal",
  },
  3: {
    legacyPm: 3,
    legacyCcy: "master",
    tenderCode: "MASTERCARD",
    mode: "credit_card_standalone",
    nameZh: "MasterCard",
    nameEn: "MasterCard",
    notes: "Confirmed MasterCard; overrides legacy CustomerData D1L='支付寶'/AliPay mislabel",
  },
  4: {
    legacyPm: 4,
    legacyCcy: "unionpay",
    tenderCode: "UNIONPAY",
    mode: "credit_card_standalone",
    nameZh: "銀聯",
    nameEn: "UnionPay",
    notes: "Standalone bank card terminal",
  },
  5: {
    legacyPm: 5,
    legacyCcy: "Computer 085",
    tenderCode: "BANK_XFER",
    mode: "bank_transfer",
    nameZh: "銀行轉帳",
    nameEn: "Bank Transfer",
    notes: "#1 tender by value; primary invoice AR settlement tender",
  },
  6: {
    legacyPm: 6,
    legacyCcy: "ae",
    tenderCode: "AMEX",
    mode: "credit_card_standalone",
    nameZh: "美國運通",
    nameEn: "American Express",
    notes: "Standalone bank card terminal",
  },
  7: {
    legacyPm: 7,
    legacyCcy: "cheque",
    tenderCode: "CHEQUE",
    mode: "cheque",
    nameZh: "支票",
    nameEn: "Cheque",
    notes: "Cheque settlement",
  },
  8: {
    legacyPm: 8,
    legacyCcy: "dlybal",
    tenderCode: null,
    mode: "retired_dlybal",
    nameZh: "送貨尾數(已停用佔位符)",
    nameEn: "Retired $0 DlyBal Placeholder",
    notes: "Retired; migrated bills with $0 PM=8 convert to bills.payment_status = 'unpaid' | 'partial'",
  },
};

export function mapLegacyPayMethod(pm: number): LegacyPayMethodMapping {
  const mapped = LEGACY_PAY_METHOD_MAP[pm];
  if (!mapped) {
    throw new RangeError(`Unsupported legacy V47 PM code: ${pm}`);
  }
  return mapped;
}

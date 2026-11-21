import type { InvoiceState } from "@hkharp/domain";

export interface CatalogItem {
  sku: string;
  nameZh: string;
  nameEn: string;
  categoryLabel: string;
  categoryC1: number; // 0,1,2 => $10/pt (RID=1); 3 => $100/pt Harps (RID=2)
  unitPriceHkd: number;
}

/**
 * Representative starter catalog matching V47 Hong Kong Harp Centre categories
 * (CRMRule RID=1 C1 IN 0,1,2; RID=2 C1=3 Harps; RID=3 HCOS001 voucher).
 * Live 1,983-SKU ProductOnSale import happens in Phase 2 ETL execution.
 */
export const STARTER_CATALOG: readonly CatalogItem[] = [
  {
    sku: "HARP-SALVI-01",
    nameZh: "Salvi Titan 38弦豎琴",
    nameEn: "Salvi Titan 38-String Lever Harp",
    categoryLabel: "HARP (C1=3 · $100/pt)",
    categoryC1: 3,
    unitPriceHkd: 48000,
  },
  {
    sku: "HARP-LH-23",
    nameZh: "Lyon & Healy Ogden 豎琴",
    nameEn: "Lyon & Healy Ogden Lever Harp",
    categoryLabel: "HARP (C1=3 · $100/pt)",
    categoryC1: 3,
    unitPriceHkd: 36800,
  },
  {
    sku: "STR-BOW-SET",
    nameZh: "Bow Brand 羊腸琴弦套裝",
    nameEn: "Bow Brand Pedal Gut String",
    categoryLabel: "STRINGS (C1=1 · $10/pt)",
    categoryC1: 1,
    unitPriceHkd: 320,
  },
  {
    sku: "BOOK-HARP-01",
    nameZh: "豎琴演奏教材 第一冊",
    nameEn: "Harp Repertoire Method Vol. 1",
    categoryLabel: "BOOK (C1=2 · $10/pt)",
    categoryC1: 2,
    unitPriceHkd: 185.5,
  },
  {
    sku: "TUNE-KEY-01",
    nameZh: "標準調音匙",
    nameEn: "Ergonomic Harp Tuning Key",
    categoryLabel: "ACCESSORY (C1=0 · $10/pt)",
    categoryC1: 0,
    unitPriceHkd: 240,
  },
  {
    sku: "HCOS001",
    nameZh: "會員積分換領 $50 現金券",
    nameEn: "CRM $50 Voucher (100 pts)",
    categoryLabel: "CRM REDEEM (RID=3)",
    categoryC1: 0,
    unitPriceHkd: 0,
  },
];

export const INITIAL_OPEN_INVOICES: readonly InvoiceState[] = [
  {
    invoiceNo: "INV-0101-0001042",
    docType: "SALES_INVOICE",
    status: "completed",
    paymentStatus: "unpaid",
    netAmountHkd: 48000,
    paidAmountHkd: 0,
    balanceDueHkd: 48000,
    issuedAtIso: "2026-11-19T14:30:00+08:00",
    payments: [],
  },
  {
    invoiceNo: "INV-0101-0001045",
    docType: "SALES_INVOICE",
    status: "completed",
    paymentStatus: "partial",
    netAmountHkd: 36800,
    paidAmountHkd: 10000,
    balanceDueHkd: 26800,
    issuedAtIso: "2026-11-20T11:15:00+08:00",
    payments: [
      {
        tenderCode: "MASTERCARD",
        amountHkd: 10000,
        paidAtIso: "2026-11-20T11:16:00+08:00",
        referenceNo: "STANDALONE-MC-4812",
      },
    ],
  },
];

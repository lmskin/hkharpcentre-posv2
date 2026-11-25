import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { appSettings, requireSharedDb, upsertAppSetting } from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const PrinterSchema = z.object({
  key: z.enum(["Printer101", "Printer102", "Printer103", "Printer104"]),
  name: z.string().max(120),
  qty: z.number().int().min(1).max(9),
  language: z.enum(["TC", "SC", "ENG"]),
  enabled: z.boolean().optional(),
});
const PrinterDetailsSchema = z
  .object({
    printIndv: z.boolean().optional(),
    printAll: z.boolean().optional(),
    custBill: z.boolean().optional(),
    dlyBill: z.boolean().optional(),
    ckCbBarcode: z.boolean().optional(),
    prtDlySignature: z.boolean().optional(),
    printBonusDetail: z.boolean().optional(),
  })
  .optional();

const LegacyGridRowSchema = z.object({
  key: z.enum(["indv", "all", "cust", "a4", "dayend"]),
  p1Name: z.string().max(120),
  p1On: z.boolean(),
  p2Name: z.string().max(120),
  p2On: z.boolean(),
});

const LegacySectionDetailSchema = z.object({
  enabled: z.boolean(),
  p1Qty: z.number().int().min(0).max(9),
  p2Qty: z.number().int().min(0).max(9),
  p3Qty: z.number().int().min(0).max(9),
  lang: z.enum(["TC", "ENG", "BOTH"]),
  format: z.enum(["STANDARD", "CUSTOM"]).optional(),
});

const DetailSettingsSchema = z
  .object({
    indv: LegacySectionDetailSchema,
    all: LegacySectionDetailSchema,
    cust: LegacySectionDetailSchema,
    deliveryEnabled: z.boolean(),
    deliveryQty: z.number().int().min(0).max(9),
    deliveryPrintItems: z.boolean(),
    deliveryPrintSignature: z.boolean(),
    printSku: z.boolean(),
    productNameMode: z.enum(["FULL", "SHORT"]),
    onlyNewItems: z.boolean(),
    replaceAfterFirst: z.boolean(),
    printPrice: z.boolean(),
    printOnPickup: z.boolean(),
    printOnComplete: z.boolean(),
    firstTimeOnly: z.boolean(),
    includeNonSales: z.boolean(),
    printTempReceipt: z.boolean(),
    printStocktakeResult: z.boolean(),
    deliveryProductNameMode: z.enum(["FULL", "SHORT"]),
  })
  .optional();

const AdvancedSettingsSchema = z
  .object({
    hourlyLang: z.enum(["TC", "ENG"]),
    dayEndOptions: z.object({
      normalHourly: z.boolean(),
      simpleHourly: z.boolean(),
      separatePaySlip: z.boolean(),
    }),
    itemReportLang: z.enum(["TC", "ENG"]),
    itemProductNameMode: z.enum(["FULL", "SHORT"]),
    displayDateMode: z.enum(["SALE_DATE", "DELIVERY_DATE"]),
    rewriteCardLang: z.enum(["TC", "ENG"]),
    setDetailMode: z.enum(["YES", "NO", "NEVER"]),
    printCashier: z.boolean(),
    printPointsDetail: z.boolean(),
    printBarcode: z.boolean(),
    barcodePosition: z.enum(["TOP", "BOTTOM"]),
    setPricePosition: z.enum(["SET_ITEM", "DETAIL_ITEM"]),
    dayEndPrinterRoute: z.enum(["FOLLOW_CUST", "FOLLOW_A4", "FOLLOW_DAYEND"]),
  })
  .optional();

const PrinterConfigSchema = z.object({
  onOff: z.boolean(),
  printers: z.array(PrinterSchema).length(4),
  details: PrinterDetailsSchema,
  splitMode: z.enum(["indv", "all"]).optional(),
  legacyGrid: z.array(LegacyGridRowSchema).optional(),
  detailSettings: DetailSettingsSchema,
  advancedSettings: AdvancedSettingsSchema,
});

const DEFAULT_CONFIG = {
  onOff: true,
  printers: [
    { key: "Printer101", name: "(default)", qty: 1, language: "TC", enabled: false },
    { key: "Printer102", name: "PDFCreator2", qty: 1, language: "TC", enabled: true },
    { key: "Printer103", name: "PDFCreator2", qty: 1, language: "TC", enabled: true },
    { key: "Printer104", name: "PDFCreator", qty: 1, language: "TC", enabled: true },
  ],
  details: {
    printIndv: true,
    printAll: true,
    custBill: true,
    dlyBill: true,
    ckCbBarcode: true,
    prtDlySignature: true,
    printBonusDetail: false,
  },
  splitMode: "all" as const,
  legacyGrid: [
    { key: "indv", p1Name: "(default)", p1On: false, p2Name: "(default)", p2On: false },
    { key: "all", p1Name: "(default)", p1On: false, p2Name: "(default)", p2On: false },
    { key: "cust", p1Name: "PDFCreator2", p1On: true, p2Name: "(default)", p2On: false },
    { key: "a4", p1Name: "PDFCreator2", p1On: true, p2Name: "(default)", p2On: false },
    { key: "dayend", p1Name: "PDFCreator", p1On: true, p2Name: "(default)", p2On: false },
  ],
  detailSettings: {
    indv: { enabled: true, p1Qty: 1, p2Qty: 0, p3Qty: 0, lang: "TC" as const },
    all: { enabled: true, p1Qty: 1, p2Qty: 0, p3Qty: 0, lang: "TC" as const },
    cust: { enabled: true, p1Qty: 1, p2Qty: 0, p3Qty: 0, lang: "TC" as const, format: "STANDARD" as const },
    deliveryEnabled: true,
    deliveryQty: 1,
    deliveryPrintItems: true,
    deliveryPrintSignature: true,
    printSku: false,
    productNameMode: "SHORT" as const,
    onlyNewItems: true,
    replaceAfterFirst: false,
    printPrice: false,
    printOnPickup: false,
    printOnComplete: false,
    firstTimeOnly: false,
    includeNonSales: false,
    printTempReceipt: true,
    printStocktakeResult: false,
    deliveryProductNameMode: "FULL" as const,
  },
  advancedSettings: {
    hourlyLang: "TC" as const,
    dayEndOptions: { normalHourly: true, simpleHourly: true, separatePaySlip: false },
    itemReportLang: "TC" as const,
    itemProductNameMode: "FULL" as const,
    displayDateMode: "DELIVERY_DATE" as const,
    rewriteCardLang: "TC" as const,
    setDetailMode: "YES" as const,
    printCashier: false,
    printPointsDetail: false,
    printBarcode: true,
    barcodePosition: "BOTTOM" as const,
    setPricePosition: "SET_ITEM" as const,
    dayEndPrinterRoute: "FOLLOW_DAYEND" as const,
  },
};

export async function GET() {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { db } = requireSharedDb();
  const [row] = await db.select().from(appSettings).where(and(eq(appSettings.shopId, auth.session.shopId), eq(appSettings.settingKey, "printers"))).limit(1);
  const parsed = PrinterConfigSchema.safeParse(row?.settingValue);
  return NextResponse.json({
    config: parsed.success ? { ...DEFAULT_CONFIG, ...parsed.data } : DEFAULT_CONFIG,
  });
}

export async function POST(request: Request) {
  const auth = await requireAuthenticatedSession(1);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = PrinterConfigSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "印表機設定格式錯誤" }, { status: 400 });
  await upsertAppSetting("printers", parsed.data, auth.session.shopId);
  return NextResponse.json({ ok: true, config: parsed.data });
}

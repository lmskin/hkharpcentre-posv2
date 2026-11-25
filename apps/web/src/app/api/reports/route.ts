import { NextResponse } from "next/server";
import {
  formatHktBusinessDate,
  getAllPurposeStatReport,
  getBosCostReport,
  getCheckBillLedgerReport,
  getHistoricalSalesReport,
  getHourlySalesReport,
  getItemSalesReport,
  getLegacyStatsReport,
  getManagerStatsReport,
  getOperationalReports,
  getOtherTransactionsReport,
  getShiftDayEndReport,
  getStockInventoryReport,
  getStockMovementMatrixReport,
  getStoreReportMeta,
  type AllStatDateBucket,
  type AllStatGroupBy,
  type AllStatScope,
  type HistoryGranularity,
} from "@hkharp/db";
import { requireAuthenticatedSession } from "@/lib/session";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function optYmd(raw: string | null, fallback: string): string | null {
  if (!raw) return fallback;
  return YMD_RE.test(raw) ? raw : null;
}

function optInt(raw: string | null): number | undefined {
  if (!raw || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

function asBool(raw: string | null, defaultValue: boolean): boolean {
  if (raw === null) return defaultValue;
  return raw === "1" || raw === "true";
}

export async function GET(request: Request) {
  const auth = await requireAuthenticatedSession(4);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const url = new URL(request.url);
  const sp = url.searchParams;
  const today = formatHktBusinessDate();
  const shopId = auth.session.shopId;
  const view = sp.get("view");

  if (view === "meta") {
    return NextResponse.json(await getStoreReportMeta(shopId));
  }

  const date = optYmd(sp.get("date"), today);
  const fromDate = optYmd(sp.get("from"), `${today.slice(0, 4)}-01-01`);
  const toDate = optYmd(sp.get("to"), today);
  if (!date || !fromDate || !toDate) {
    return NextResponse.json({ error: "日期格式錯誤" }, { status: 400 });
  }

  if (view === "hourly") {
    return NextResponse.json(await getHourlySalesReport(date, shopId));
  }

  if (view === "items") {
    const itemFrom = optYmd(sp.get("from"), date) ?? date;
    const itemTo = optYmd(sp.get("to"), itemFrom) ?? itemFrom;
    return NextResponse.json(
      await getItemSalesReport(itemFrom, shopId, {
        toDate: itemTo,
        categoryC1: optInt(sp.get("categoryC1")),
        q: sp.get("q") ?? undefined,
      }),
    );
  }

  if (view === "history") {
    const granRaw = sp.get("granularity") ?? "day";
    const allowedGran: HistoryGranularity[] = ["day", "week", "month", "quarter", "year", "weekday"];
    const granularity = allowedGran.includes(granRaw as HistoryGranularity) ? (granRaw as HistoryGranularity) : "day";
    return NextResponse.json(await getHistoricalSalesReport(fromDate, toDate, shopId, granularity));
  }

  if (view === "shift") {
    const shiftFrom = optYmd(sp.get("from"), `${today.slice(0, 8)}01`) ?? fromDate;
    const focusDate = optYmd(sp.get("focusDate"), date) ?? date;
    const focusBatchId = optInt(sp.get("focusBatchId"));
    return NextResponse.json(
      await getShiftDayEndReport({ fromDate: shiftFrom, toDate, shopId, focusDate, focusBatchId }),
    );
  }

  if (view === "allstat") {
    const allowedGroup: AllStatGroupBy[] = ["category", "product", "customer", "staff", "supplier", "tender", "doctype"];
    const allowedBucket: AllStatDateBucket[] = ["none", "day", "month", "year"];
    const allowedScope: AllStatScope[] = ["all", "retail", "invoice"];
    const groupBy = allowedGroup.includes(sp.get("groupBy") as AllStatGroupBy)
      ? (sp.get("groupBy") as AllStatGroupBy)
      : "category";
    const dateBucket = allowedBucket.includes(sp.get("dateBucket") as AllStatDateBucket)
      ? (sp.get("dateBucket") as AllStatDateBucket)
      : "none";
    const scope = allowedScope.includes(sp.get("scope") as AllStatScope) ? (sp.get("scope") as AllStatScope) : "all";
    return NextResponse.json(
      await getAllPurposeStatReport({ fromDate, toDate, shopId, groupBy, dateBucket, scope }),
    );
  }

  if (view === "cost") {
    const dmyRaw = sp.get("dmy");
    const dmy = dmyRaw === "day" || dmyRaw === "year" ? dmyRaw : "month";
    return NextResponse.json(
      await getBosCostReport({
        fromDate,
        toDate,
        shopId,
        dmy,
        showShop: asBool(sp.get("showShop"), true),
        showCategory: asBool(sp.get("showCategory"), true),
        showUbc: asBool(sp.get("showUbc"), false),
      }),
    );
  }

  if (view === "stock_val") {
    const subRaw = sp.get("subView");
    const subView = subRaw === "last_sale" || subRaw === "reorder" ? subRaw : "valuation";
    return NextResponse.json(
      await getStockInventoryReport({
        shopId,
        subView,
        categoryC1: optInt(sp.get("categoryC1")),
        q: sp.get("q") ?? undefined,
        positiveOnly: asBool(sp.get("positiveOnly"), false),
        minDaysNotSold: optInt(sp.get("minDays")),
        reorderThreshold: optInt(sp.get("threshold")),
        limit: optInt(sp.get("limit")),
      }),
    );
  }

  if (view === "movement") {
    return NextResponse.json(
      await getStockMovementMatrixReport({
        fromDate,
        toDate,
        shopId,
        categoryC1: optInt(sp.get("categoryC1")),
        q: sp.get("q") ?? undefined,
        activeOnly: asBool(sp.get("activeOnly"), true),
      }),
    );
  }

  if (view === "check_ledger") {
    const subRaw = sp.get("subView");
    const subView = subRaw === "lines" || subRaw === "payments" ? subRaw : "headers";
    return NextResponse.json(
      await getCheckBillLedgerReport({
        fromDate,
        toDate,
        shopId,
        subView,
        docType: sp.get("docType") || undefined,
        status: sp.get("status") || undefined,
        tenderCode: sp.get("tenderCode") || undefined,
        q: sp.get("q") || undefined,
        limit: optInt(sp.get("limit")),
      }),
    );
  }

  if (view === "office_tx") {
    const subRaw = sp.get("subView");
    const subView = subRaw === "lines" || subRaw === "stocktake" ? subRaw : "headers";
    return NextResponse.json(
      await getOtherTransactionsReport({
        fromDate,
        toDate,
        shopId,
        subView,
        docType: sp.get("docType") || undefined,
        q: sp.get("q") || undefined,
      }),
    );
  }

  if (view === "stats") {
    return NextResponse.json(await getManagerStatsReport({ fromDate, toDate, shopId }));
  }

  if (view === "legacy_stats") {
    const rawKind = sp.get("kind");
    const kind = rawKind === "member" || rawKind === "staff" ? rawKind : "sales";
    const rawMatch = sp.get("matchMode");
    const matchMode = rawMatch === "prefix" || rawMatch === "suffix" ? rawMatch : "contains";
    const rawSort = sp.get("sortBy");
    const sortBy =
      rawSort === "qty_desc" || rawSort === "sales_desc" || rawSort === "sales_asc" ? rawSort : "default";
    return NextResponse.json(
      await getLegacyStatsReport({
        kind,
        fromDate,
        toDate,
        shopId,
        q: sp.get("q") ?? undefined,
        matchMode,
        categoryC1: optInt(sp.get("categoryC1")),
        sortBy,
      }),
    );
  }

  const report = await getOperationalReports({ fromDate, toDate, shopId });
  return NextResponse.json(report);
}

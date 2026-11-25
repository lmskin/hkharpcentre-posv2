"use client";

import { useEffect, useRef, useState } from "react";
import { HarpCentreLogo, LegacyIcon } from "@/components/LegacyIcons";
import { currentBusinessDate } from "@/components/reports/ReportShell";

interface HourlyApiData {
  businessDate: string;
  totalBills: number;
  totalSalesHkd: number;
  openingFloatHkd?: number;
  cashNetHkd?: number;
  hours: Array<{ hourOfDay: number; billCount: number; netSalesHkd: number }>;
  periods: Array<{ key: string; billCount: number; netSalesHkd: number }>;
}

interface ItemApiData {
  businessDate: string;
  toDate: string;
  totalQty: number;
  totalGrossHkd: number;
  totalDiscountHkd: number;
  totalSalesHkd: number;
  items: Array<{
    sku: string;
    nameZh: string;
    nameEn: string;
    categoryC1: number;
    categoryName: string;
    quantity: number;
    netSalesHkd: number;
    salesShare: number;
  }>;
}

interface HistoryApiData {
  fromDate: string;
  toDate: string;
  days: Array<{
    businessDate: string;
    billCount: number;
    netSalesHkd: number;
  }>;
  totals: {
    billCount: number;
    netSalesHkd: number;
  };
}

function fmtReceiptAmt(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
}

function weekdayZhShort(ymd: string): string {
  const days = ["日", "一", "二", "三", "四", "五", "六"];
  const dt = new Date(`${ymd}T00:00:00+08:00`);
  return days[dt.getDay()] ?? "";
}

function monthBounds(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number);
  const lastDay = new Date(y!, m!, 0).getDate();
  return {
    start: `${ym}-01`,
    end: `${ym}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shiftYm(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + deltaMonths, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function LegacyReceiptReportView({
  kind,
  shopLabel,
  staffName,
  staffCode,
  onExit,
  onOpenTabularReport,
}: {
  kind: "hourly" | "item" | "monthlyBusiness" | "monthlyItem";
  shopLabel: string;
  staffName: string;
  staffCode: string;
  onExit: () => void;
  onOpenTabularReport: () => void;
}) {
  const today = currentBusinessDate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(() => today.slice(0, 7));
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [lang, setLang] = useState<"TC" | "EN">("TC");
  const [hourlyData, setHourlyData] = useState<HourlyApiData | null>(null);
  const [itemData, setItemData] = useState<ItemApiData | null>(null);
  const [historyData, setHistoryData] = useState<HistoryApiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const load = async () => {
      try {
        if (kind === "hourly") {
          const res = await fetch(`/api/reports/hourly?date=${encodeURIComponent(selectedDate)}`);
          const body = (await res.json()) as HourlyApiData & { error?: string };
          if (!res.ok) throw new Error(body.error ?? "未能讀取時飛報表");
          if (active) setHourlyData(body);
        } else if (kind === "item") {
          const res = await fetch(`/api/reports/items?from=${encodeURIComponent(selectedDate)}&to=${encodeURIComponent(selectedDate)}`);
          const body = (await res.json()) as ItemApiData & { error?: string };
          if (!res.ok) throw new Error(body.error ?? "未能讀取項飛報表");
          if (active) setItemData(body);
        } else if (kind === "monthlyBusiness") {
          const { start, end } = monthBounds(selectedMonth);
          const res = await fetch(
            `/api/reports/history?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}&granularity=day`,
          );
          const body = (await res.json()) as HistoryApiData & { error?: string };
          if (!res.ok) throw new Error(body.error ?? "未能讀取每月營業額");
          if (active) setHistoryData(body);
        } else {
          const { start, end } = monthBounds(selectedMonth);
          const res = await fetch(`/api/reports/items?from=${encodeURIComponent(start)}&to=${encodeURIComponent(end)}`);
          const body = (await res.json()) as ItemApiData & { error?: string };
          if (!res.ok) throw new Error(body.error ?? "未能讀取每月銷售量");
          if (active) setItemData(body);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "讀取報表失敗");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [kind, selectedDate, selectedMonth]);

  const now = new Date();
  const stamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const isMonthly = kind === "monthlyBusiness" || kind === "monthlyItem";
  const isNarrow = kind === "hourly" || kind === "item";

  const hourlyBands = [
    { hours: [6, 7, 8, 9, 10] },
    { hours: [11, 12, 13, 14] },
    { hours: [15, 16, 17] },
    { hours: [18, 19, 20, 21, 22, 23] },
  ];

  const groupedMonthlyItems = (() => {
    if (!itemData) return [];
    const map = new Map<string, typeof itemData.items>();
    for (const row of itemData.items) {
      const key = (row.categoryName || `C1=${row.categoryC1}`).toUpperCase();
      const arr = map.get(key) ?? [];
      arr.push(row);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  })();

  return (
    <div className="flex min-h-0 min-w-0 flex-1 bg-[#f0f0f0]">
      {/* Receipt canvas */}
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-[#ececec] p-4"
        onKeyDown={(e) => {
          if (e.key === "Escape") e.preventDefault();
        }}
      >
        {showDatePicker ? (
          <div className="mb-3 flex items-center justify-center gap-2 border border-[#7f9db9] bg-white p-2 text-[12px] text-black shadow-sm">
            {isMonthly ? (
              <label>
                月份
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="ml-2 border border-[#7f9db9] px-2 py-0.5"
                />
              </label>
            ) : (
              <label>
                營業日期
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="ml-2 border border-[#7f9db9] px-2 py-0.5"
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => setShowDatePicker(false)}
              className="border border-[#7f9db9] bg-[#e1dfff] px-3 py-0.5"
            >
              確定
            </button>
          </div>
        ) : null}

        {error ? (
          <div className="mx-auto mb-3 max-w-md border border-[#c00000] bg-[#ffffe1] p-2 text-[12px] text-[#c00000]">
            營運通訊息 - 053：{error}
          </div>
        ) : null}

        {loading ? (
          <div className="p-8 text-center text-[12px] text-black">讀取報表中…</div>
        ) : (
          <div
            className="mx-auto w-[310px] border border-[#bdbdbd] bg-white px-5 py-4 text-[12px] text-black shadow-sm"
            style={{ fontFamily: "'Microsoft JhengHei', Tahoma, sans-serif" }}
          >
            <HarpCentreLogo compact />
            <div className="mt-1 text-center text-[16px] font-medium">{shopLabel}</div>

            {kind === "hourly" && hourlyData ? (
              <>
                <div className="mt-2 text-center text-[14px] font-bold">
                  {lang === "TC" ? "時計" : "Hourly Sales"}
                </div>
                <div className="mt-2 flex justify-between text-[12px]">
                  <span>{hourlyData.businessDate.replace(/-/g, "/")}</span>
                  <span>(M1S)</span>
                  <span>{staffName}</span>
                </div>
                <div className="my-1.5 border-t border-black" />
                <div className="grid grid-cols-[1fr_64px_86px] text-[12px] underline">
                  <span>{lang === "TC" ? "時間" : "Hour"}</span>
                  <span className="text-right">{lang === "TC" ? "單數*" : "Bills*"}</span>
                  <span className="text-right">{lang === "TC" ? "金額" : "Amount"}</span>
                </div>
                <div className="mt-1 space-y-2 font-mono text-[12px]">
                  {hourlyBands.map((band, bIdx) => {
                    const rows = band.hours.map(
                      (hr) => hourlyData.hours.find((h) => h.hourOfDay === hr) ?? { hourOfDay: hr, billCount: 0, netSalesHkd: 0 },
                    );
                    const subBills = rows.reduce((s, r) => s + r.billCount, 0);
                    const subAmt = rows.reduce((s, r) => s + r.netSalesHkd, 0);
                    return (
                      <div key={bIdx}>
                        {rows.map((r) => (
                          <div key={r.hourOfDay} className="grid grid-cols-[1fr_64px_86px]">
                            <span>{String(r.hourOfDay).padStart(2, "0")}:00</span>
                            <span className="text-right">{r.billCount}</span>
                            <span className="text-right">{fmtReceiptAmt(r.netSalesHkd)}</span>
                          </div>
                        ))}
                        <div className="grid grid-cols-[1fr_64px_86px] text-[#333]">
                          <span />
                          <span className="border-t border-dashed border-black text-right">{subBills}</span>
                          <span className="border-t border-dashed border-black text-right">{fmtReceiptAmt(subAmt)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-[1fr_64px_86px] items-baseline text-[13px] font-bold">
                  <span>{lang === "TC" ? "總銷售收入" : "Total Income"}</span>
                  <span className="border-b-2 border-double border-black text-right font-mono">{hourlyData.totalBills}</span>
                  <span className="border-b-2 border-double border-black text-right font-mono">
                    ${fmtReceiptAmt(hourlyData.totalSalesHkd)}
                  </span>
                </div>
                <div className="mt-2 text-[10px] text-[#333]">* 含稅款/退售</div>
                <div className="mt-4 border-t border-dashed border-[#aaa] pt-2 text-[12px]">
                  <div className="font-bold">銀櫃賬(Cash值)</div>
                  <div className="mt-1 flex justify-between font-mono">
                    <span>銀頭</span>
                    <span>{fmtReceiptAmt(hourlyData.openingFloatHkd ?? 0)}</span>
                  </div>
                  <div className="flex justify-between font-mono">
                    <span>現金淨額</span>
                    <span>{fmtReceiptAmt(hourlyData.cashNetHkd ?? 0)}</span>
                  </div>
                  <div className="flex justify-between border-t border-dashed border-black pt-0.5 font-mono font-bold">
                    <span>錢櫃結餘</span>
                    <span>{fmtReceiptAmt((hourlyData.openingFloatHkd ?? 0) + (hourlyData.cashNetHkd ?? 0))}</span>
                  </div>
                </div>
              </>
            ) : null}

            {kind === "item" && itemData ? (
              <>
                <div className="mt-2 text-center text-[14px] font-bold">
                  {lang === "TC" ? "銷售數量" : "Item Sales Quantity"}
                </div>
                <div className="text-center text-[12px]">(以提貨日計)</div>
                <div className="mt-2 flex justify-between text-[12px]">
                  <span>{itemData.businessDate.replace(/-/g, "/")}</span>
                  <span>(M1S)</span>
                  <span>{staffName}</span>
                </div>
                <div className="my-1.5 border-t border-black" />
                <div className="grid grid-cols-[1fr_54px_64px_54px] text-[12px] underline">
                  <span />
                  <span className="text-right">數量</span>
                  <span className="text-right">金額</span>
                  <span className="text-right">百分比</span>
                </div>
                <div className="mt-2 space-y-1.5 font-mono text-[11px]">
                  {itemData.items.map((it) => (
                    <div key={it.sku}>
                      <div className="grid grid-cols-[1fr_44px_62px_50px]">
                        <span className="truncate font-bold">{it.sku}</span>
                        <span className="text-right">{it.quantity}</span>
                        <span className="text-right">{fmtReceiptAmt(it.netSalesHkd)}</span>
                        <span className="text-right">{(it.salesShare * 100).toFixed(2)}%</span>
                      </div>
                      <div className="truncate text-[10px] text-[#333]">{it.nameZh || it.nameEn}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-[1fr_44px_62px_50px] border-t border-dashed border-black pt-1 font-mono text-[12px]">
                  <span />
                  <span className="text-right">{itemData.totalQty}</span>
                  <span className="text-right">{fmtReceiptAmt(itemData.totalSalesHkd)}</span>
                  <span className="text-right">{itemData.items.length > 0 ? "100%" : "--"}</span>
                </div>
                <div className="mt-2 space-y-0.5 border-t border-dashed border-black pt-1.5 text-[12px]">
                  <div className="grid grid-cols-[1fr_44px_62px_50px] font-mono">
                    <span className="font-sans">銷售額</span>
                    <span className="text-right">{itemData.totalQty}</span>
                    <span className="text-right">{fmtReceiptAmt(itemData.totalGrossHkd)}</span>
                    <span className="text-right">--</span>
                  </div>
                  <div className="grid grid-cols-[1fr_44px_62px_50px] font-mono">
                    <span className="font-sans">單折</span>
                    <span className="text-right">0</span>
                    <span className="text-right">{fmtReceiptAmt(itemData.totalDiscountHkd)}</span>
                    <span />
                  </div>
                  <div className="grid grid-cols-[1fr_44px_62px_50px] font-mono">
                    <span className="font-sans">會員折扣/調整</span>
                    <span className="text-right">0</span>
                    <span className="text-right">0.0</span>
                    <span />
                  </div>
                  <div className="grid grid-cols-[1fr_44px_62px_50px] border-t border-dashed border-black pt-1 font-mono font-bold">
                    <span className="font-sans">總銷售收入</span>
                    <span />
                    <span className="text-right">{fmtReceiptAmt(itemData.totalSalesHkd)}</span>
                    <span className="text-right">--</span>
                  </div>
                  <div className="grid grid-cols-[1fr_44px_62px_50px] border-t border-dashed border-black pt-1 font-mono font-bold">
                    <span className="font-sans">= 營業額</span>
                    <span />
                    <span className="text-right">{fmtReceiptAmt(itemData.totalSalesHkd)}</span>
                    <span />
                  </div>
                </div>
              </>
            ) : null}

            {kind === "monthlyBusiness" && historyData ? (
              <>
                <div className="mt-2 text-center text-[14px] font-bold">
                  {lang === "TC" ? "每月營業額" : "Monthly Business"}
                </div>
                <div className="mt-2 flex justify-between text-[13px]">
                  <span>
                    {selectedMonth.slice(5, 7)} / {selectedMonth.slice(0, 4)}
                  </span>
                  <span>{staffName}</span>
                </div>
                <div className="my-1.5 border-t border-black" />
                <div className="grid grid-cols-[1fr_56px_88px] text-[12px] underline">
                  <span>{lang === "TC" ? "日期" : "Date"}</span>
                  <span className="text-right">{lang === "TC" ? "單數" : "Bills"}</span>
                  <span className="text-right">{lang === "TC" ? "營業額" : "Sales"}</span>
                </div>
                <div className="mt-2 space-y-0.5 font-mono text-[12px]">
                  {[...historyData.days]
                    .sort((a, b) => a.businessDate.localeCompare(b.businessDate))
                    .map((d) => (
                      <div key={d.businessDate} className="grid grid-cols-[1fr_56px_88px]">
                        <span>
                          {d.businessDate.slice(5, 7)}/{d.businessDate.slice(8, 10)}({weekdayZhShort(d.businessDate)})
                        </span>
                        <span className="text-right">{d.billCount}</span>
                        <span className="text-right">{fmtReceiptAmt(d.netSalesHkd)}</span>
                      </div>
                    ))}
                  {historyData.days.length === 0 ? (
                    <div className="py-4 text-center font-sans text-[#666]">此月份暫無營業紀錄</div>
                  ) : null}
                </div>
                <div className="mt-2 grid grid-cols-[1fr_56px_88px] border-t border-dashed border-black pt-1 font-mono text-[12px] font-bold">
                  <span />
                  <span className="text-right">{historyData.totals.billCount}</span>
                  <span className="text-right">{fmtReceiptAmt(historyData.totals.netSalesHkd)}</span>
                </div>
              </>
            ) : null}

            {kind === "monthlyItem" && itemData ? (
              <>
                <div className="mt-2 text-center text-[14px] font-bold">
                  {lang === "TC" ? "每月銷售量" : "Monthly Item Sales"}
                </div>
                <div className="mt-2 flex justify-between text-[13px]">
                  <span>
                    {selectedMonth.slice(5, 7)} / {selectedMonth.slice(0, 4)}
                  </span>
                  <span>{staffName}</span>
                </div>
                <div className="my-1.5 border-t border-black" />
                <div className="grid grid-cols-[1fr_40px_62px_50px] text-[11px] underline">
                  <span />
                  <span className="text-right">數量</span>
                  <span className="text-right">金額</span>
                  <span className="text-right">百分比</span>
                </div>
                <div className="mt-2 space-y-3 text-[11px]">
                  {groupedMonthlyItems.map(([catTitle, rows]) => (
                    <div key={catTitle}>
                      <div className="mb-1 text-[13px] font-normal tracking-wide">{catTitle}</div>
                      <div className="space-y-1 font-mono">
                        {rows.map((it) => (
                          <div key={it.sku}>
                            <div className="grid grid-cols-[1fr_36px_58px_46px]">
                              <span className="truncate">{it.sku}</span>
                              <span className="text-right">{it.quantity}</span>
                              <span className="text-right">{fmtReceiptAmt(it.netSalesHkd)}</span>
                              <span className="text-right">{(it.salesShare * 100).toFixed(2)}%</span>
                            </div>
                            <div className="truncate font-sans text-[11px]">{it.nameZh || it.nameEn}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                  {groupedMonthlyItems.length === 0 ? (
                    <div className="py-4 text-center text-[#666]">此月份暫無項目銷售紀錄</div>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-[1fr_36px_58px_46px] border-t border-dashed border-black pt-1 font-mono text-[12px] font-bold">
                  <span className="font-sans">總計</span>
                  <span className="text-right">{itemData.totalQty}</span>
                  <span className="text-right">{fmtReceiptAmt(itemData.totalSalesHkd)}</span>
                  <span className="text-right">{itemData.items.length > 0 ? "100%" : "--"}</span>
                </div>
              </>
            ) : null}

            <div className="mt-6 text-center font-mono text-[10px] text-[#333]">
              1-1-{stamp}-{staffCode || "5001"}
            </div>
          </div>
        )}
      </div>

      {/* Vertical toolbar along right edge of receipt canvas (Screens 028, 029, 035, 036) */}
      <div className="flex w-9 flex-col items-center border-l border-[#aca899] bg-[#f0f0f0] py-1">
        {isNarrow ? (
          <>
            <button
              type="button"
              title="主頁 (返回零售)"
              onClick={onExit}
              className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] text-[14px] hover:bg-[#e5e1d5]"
            >
              🏠
            </button>
            <button
              type="button"
              title="展開明細報表 / 匯出 CSV"
              aria-label="報表圖示"
              onClick={onOpenTabularReport}
              className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
            >
              <LegacyIcon name="retail" className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="上捲"
              onClick={() => scrollRef.current?.scrollBy({ top: -160, behavior: "smooth" })}
              className="flex h-6 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] text-[10px]"
            >
              ▲
            </button>
            <div className="my-1 w-6 flex-1 border border-[#d4d0c8] bg-[#e6e6e6]" aria-hidden="true" />
            <button
              type="button"
              title="下捲"
              onClick={() => scrollRef.current?.scrollBy({ top: 160, behavior: "smooth" })}
              className="mb-2 flex h-6 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] text-[10px]"
            >
              ▼
            </button>
            <button
              type="button"
              title="切換查詢日期"
              onClick={() => setShowDatePicker((v) => !v)}
              className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
            >
              <LegacyIcon name="calendar" className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              title="上一個月"
              onClick={() => setSelectedMonth((m) => shiftYm(m, -1))}
              className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
            >
              <LegacyIcon name="upArrow" className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="下一個月"
              onClick={() => setSelectedMonth((m) => shiftYm(m, 1))}
              className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
            >
              <LegacyIcon name="downArrow" className="h-4 w-4" />
            </button>
            <div className="my-1 w-6 flex-1 border border-[#d4d0c8] bg-[#e6e6e6]" aria-hidden="true" />
            <button
              type="button"
              title="展開明細報表 / 匯出 CSV"
              aria-label="報表圖示"
              onClick={onOpenTabularReport}
              className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
            >
              <LegacyIcon name="info" className="h-4 w-4" />
            </button>
          </>
        )}

        <button
          type="button"
          title="切換中/英文"
          onClick={() => setLang((prev) => (prev === "TC" ? "EN" : "TC"))}
          className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#d93829] text-[10px] font-bold text-[#ffeb3b]"
        >
          {lang === "TC" ? "中" : "EN"}
        </button>
        <button
          type="button"
          title="列印報表"
          onClick={() => window.print()}
          className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
        >
          <LegacyIcon name="print" className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="離開"
          onClick={onExit}
          className="flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
        >
          <LegacyIcon name="exit" className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

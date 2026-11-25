"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { AutoSuggestInput } from "@/components/AutoSuggestInput";
import { LegacyIcon } from "@/components/LegacyIcons";
import { currentBusinessDate, downloadCsvFile } from "@/components/reports/ReportShell";

interface SalesStatRow {
  productName: string;
  ubc: string;
  sku: string;
  barcodeName: string;
  color: string;
  size: string;
  supplier: string;
  unit: string;
  billCount: number;
  quantity: number;
  salesValueHkd: number;
  estGrossProfitHkd: number;
}

interface MemberStatRow {
  customerCode: string;
  customerName: string;
  businessDate: string;
  billCount: number;
  quantity: number;
  salesValueHkd: number;
  estGrossProfitHkd: number;
}

interface StaffStatRow {
  staffCode: string;
  staffName: string;
  businessDate: string;
  sku: string;
  barcodeName: string;
  billCount: number;
  quantity: number;
  salesValueHkd: number;
  estGrossProfitHkd: number;
}

function shiftDays(ymd: string, delta: number): string {
  const dt = new Date(`${ymd}T00:00:00+08:00`);
  dt.setTime(dt.getTime() + delta * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(dt);
}

export function LegacyStatsWorkspace({
  kind,
  categories,
  onOpenFullStatsModal,
}: {
  kind: "sales" | "member" | "staff";
  categories: Array<{ legacyC1: number; nameZh: string; nameEn: string }>;
  onOpenFullStatsModal?: () => void;
}) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(() => shiftDays(today, -7));
  const [toDate, setToDate] = useState(today);
  const [matchMode, setMatchMode] = useState<"prefix" | "contains" | "suffix">("prefix");
  const [q, setQ] = useState("");
  const [categoryC1, setCategoryC1] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "qty_desc" | "sales_desc" | "sales_asc">("default");
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(kind !== "sales");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [salesRows, setSalesRows] = useState<SalesStatRow[]>([]);
  const [memberRows, setMemberRows] = useState<MemberStatRow[]>([]);
  const [staffRows, setStaffRows] = useState<StaffStatRow[]>([]);

  const badgeTitle =
    kind === "sales" ? "銷售統計 - 本店" : kind === "member" ? "會員統計 - 本店" : "職員統計 - 本店";
  const buttonLabel = kind === "sales" ? "銷售統計" : kind === "member" ? "會員統計" : "職員統計";
  const colCount = kind === "sales" ? 12 : kind === "member" ? 7 : 8;
  const activeRowCount =
    kind === "sales" ? salesRows.length : kind === "member" ? memberRows.length : staffRows.length;

  async function runQuery(overrides?: {
    from?: string;
    to?: string;
    sort?: "default" | "qty_desc" | "sales_desc" | "sales_asc";
    query?: string;
    cat?: string;
  }) {
    const f = overrides?.from ?? fromDate;
    const t = overrides?.to ?? toDate;
    const s = overrides?.sort ?? sortBy;
    const curQ = overrides?.query ?? q;
    const curCat = overrides?.cat ?? categoryC1;
    if (f > t) {
      setError("開始日期不能晚於結束日期");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const sp = new URLSearchParams({
        view: "legacy_stats",
        kind,
        from: f,
        to: t,
        matchMode,
        sortBy: s,
      });
      if (curQ.trim()) sp.set("q", curQ.trim());
      if (curCat !== "" && kind === "sales") sp.set("categoryC1", curCat);
      const res = await fetch(`/api/reports?${sp.toString()}`);
      const body = (await res.json()) as {
        elapsedSec?: number;
        rows?: unknown[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? "未能讀取統計資料");
      setElapsedSec(body.elapsedSec ?? 0);
      setHasLoaded(true);
      if (kind === "sales") setSalesRows((body.rows ?? []) as SalesStatRow[]);
      else if (kind === "member") setMemberRows((body.rows ?? []) as MemberStatRow[]);
      else setStaffRows((body.rows ?? []) as StaffStatRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未能讀取統計資料");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setError("");
    if (kind === "sales") {
      // Screenshot 031: sales_statistics starts in filter mode until GO! is clicked.
      setHasLoaded(false);
      setSalesRows([]);
      setElapsedSec(0);
    } else {
      void runQuery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  function exportCsv() {
    if (kind === "sales") {
      downloadCsvFile(`stats-sales-${fromDate}-${toDate}.csv`, [
        ["貨品", "貨碼", "條碼", "條碼名稱", "顏色", "尺碼", "供應商", "單位", "銷售筆數", "銷售量", "銷售值", "估計毛利"],
        ...salesRows.map((r) => [
          r.productName,
          r.ubc,
          r.sku,
          r.barcodeName,
          r.color,
          r.size,
          r.supplier,
          r.unit,
          r.billCount,
          r.quantity,
          r.salesValueHkd.toFixed(2),
          r.estGrossProfitHkd.toFixed(2),
        ]),
      ]);
    } else if (kind === "member") {
      downloadCsvFile(`stats-member-${fromDate}-${toDate}.csv`, [
        ["客戶編號", "姓名", "按日", "銷售筆數", "銷售量", "銷售值", "估計毛利"],
        ...memberRows.map((r) => [
          r.customerCode,
          r.customerName,
          r.businessDate,
          r.billCount,
          r.quantity,
          r.salesValueHkd.toFixed(2),
          r.estGrossProfitHkd.toFixed(2),
        ]),
      ]);
    } else {
      downloadCsvFile(`stats-staff-${fromDate}-${toDate}.csv`, [
        ["職員編號", "職員", "按日", "條碼名稱", "銷售筆數", "銷售量", "銷售值", "估計毛利"],
        ...staffRows.map((r) => [
          r.staffCode,
          r.staffName,
          r.businessDate,
          r.barcodeName,
          r.billCount,
          r.quantity,
          r.salesValueHkd.toFixed(2),
          r.estGrossProfitHkd.toFixed(2),
        ]),
      ]);
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#f0f0f0] text-black">
      {/* Header block matching Screens 031-034 */}
      <div className="flex items-stretch gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-1.5 text-[12px]">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Row 1: Green badge + match mode + search input + category/filter buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-[140px] border border-[#6ca36c] bg-[#a3f09b] px-3 py-1 text-center text-[13px] font-medium text-black">
              {badgeTitle}
            </div>
            <LegacyIcon name="barcode" className="h-5 w-7" />
            <select
              aria-label="搜尋比對模式"
              value={matchMode}
              onChange={(e) => setMatchMode(e.target.value as "prefix" | "contains" | "suffix")}
              className="border border-[#aca899] bg-[#f0f0f0] px-1 py-0.5 text-[12px]"
            >
              <option value="prefix">ab..</option>
              <option value="contains">..ab..</option>
              <option value="suffix">..ab</option>
            </select>
            <div className="min-w-[200px] flex-1">
              <AutoSuggestInput
                theme="legacy"
                name="statsSearch"
                autoComplete="on"
                suggestKind={kind === "member" ? "customer" : kind === "staff" ? "staff_login" : "product"}
                historyKey={`stats_${kind}_q`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runQuery();
                }}
                placeholder=""
                className="w-full border border-[#7f9db9] bg-white px-2 py-0.5 text-[12px]"
              />
            </div>
            <button
              type="button"
              onClick={() => void runQuery()}
              title="依輸入條件查詢"
              className="border border-[#aca899] bg-[#f0f0f0] px-2 py-0.5 text-[11px] hover:bg-[#e5e1d5]"
            >
              ../..
            </button>
            <button
              type="button"
              onClick={() => {
                setQ("");
                setCategoryC1("");
                void runQuery({ query: "", cat: "" });
              }}
              title="清除條件"
              className="border border-[#aca899] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] hover:bg-[#e5e1d5]"
            >
              🚫
            </button>
            {kind === "sales" ? (
              <select
                aria-label="貨品分類"
                value={categoryC1}
                onChange={(e) => setCategoryC1(e.target.value)}
                className="w-36 border border-[#7f9db9] bg-white px-1 py-0.5 text-[11px]"
              >
                <option value="">全部分類</option>
                {categories.map((c) => (
                  <option key={c.legacyC1} value={String(c.legacyC1)}>
                    {c.legacyC1} - {c.nameZh || c.nameEn}
                  </option>
                ))}
              </select>
            ) : null}
            {onOpenFullStatsModal ? (
              <button
                type="button"
                onClick={onOpenFullStatsModal}
                title="開啟完整營業統計視窗"
                className="border border-[#aca899] bg-[#f0f0f0] px-2 py-0.5 text-[11px] hover:bg-[#e5e1d5]"
              >
                明細表
              </button>
            ) : null}
          </div>

          {/* Row 2: 3 VB6 Fieldsets (顯示 / 排序及搜尋, 選項 - 本店, 結果) */}
          <div className="flex flex-wrap items-stretch gap-2 text-[11px]">
            <fieldset className="border border-[#ccc] px-2 py-1">
              <legend className="px-1 text-[#444]">顯示 / 排序及搜尋</legend>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="預設排序"
                  onClick={() => {
                    setSortBy("default");
                    if (hasLoaded) void runQuery({ sort: "default" });
                  }}
                  className={`border px-1.5 py-0.5 ${sortBy === "default" ? "border-[#316ac5] bg-[#d8e6f8]" : "border-[#aca899] bg-white"}`}
                >
                  100
                </button>
                <button
                  type="button"
                  title="按銷售值由高至低"
                  onClick={() => {
                    setSortBy("sales_desc");
                    if (hasLoaded) void runQuery({ sort: "sales_desc" });
                  }}
                  className={`border px-1.5 py-0.5 ${sortBy === "sales_desc" ? "border-[#316ac5] bg-[#d8e6f8]" : "border-[#aca899] bg-white"}`}
                >
                  9→1
                </button>
                <button
                  type="button"
                  title="按銷售值由低至高"
                  onClick={() => {
                    setSortBy("sales_asc");
                    if (hasLoaded) void runQuery({ sort: "sales_asc" });
                  }}
                  className={`border px-1.5 py-0.5 ${sortBy === "sales_asc" ? "border-[#316ac5] bg-[#d8e6f8]" : "border-[#aca899] bg-white"}`}
                >
                  1→9
                </button>
                <button
                  type="button"
                  title="按數量由高至低"
                  onClick={() => {
                    setSortBy("qty_desc");
                    if (hasLoaded) void runQuery({ sort: "qty_desc" });
                  }}
                  className={`border px-1.5 py-0.5 ${sortBy === "qty_desc" ? "border-[#316ac5] bg-[#d8e6f8]" : "border-[#aca899] bg-white"}`}
                >
                  量↓
                </button>
              </div>
            </fieldset>

            <fieldset className="border border-[#ccc] px-2 py-1">
              <legend className="px-1 text-[#444]">選項 - 本店</legend>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  title="近7天"
                  onClick={() => {
                    const f = shiftDays(today, -7);
                    setFromDate(f);
                    setToDate(today);
                    if (hasLoaded) void runQuery({ from: f, to: today });
                  }}
                  className="border border-[#aca899] bg-white px-1.5 py-0.5 hover:bg-[#e5e1d5]"
                >
                  🏠
                </button>
                <button
                  type="button"
                  title="本月至今"
                  onClick={() => {
                    const f = `${today.slice(0, 8)}01`;
                    setFromDate(f);
                    setToDate(today);
                    if (hasLoaded) void runQuery({ from: f, to: today });
                  }}
                  className="border border-[#aca899] bg-white px-1.5 py-0.5 hover:bg-[#e5e1d5]"
                >
                  📅
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  disabled={!hasLoaded}
                  title="匯出 CSV"
                  aria-label="匯出 CSV"
                  className="flex items-center gap-1 border border-[#aca899] bg-white px-2 py-0.5 hover:bg-[#e5e1d5] disabled:opacity-40"
                >
                  <LegacyIcon name="excel" className="h-3.5 w-3.5" />
                  <span>匯出 CSV</span>
                </button>
                <input
                  type="date"
                  aria-label="開始日期"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="border border-[#7f9db9] bg-white px-1 py-0.5 font-mono text-[11px]"
                />
                <span>至</span>
                <input
                  type="date"
                  aria-label="結束日期"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="border border-[#7f9db9] bg-white px-1 py-0.5 font-mono text-[11px]"
                />
              </div>
            </fieldset>

            <fieldset className="min-w-[150px] border border-[#ccc] px-2 py-1">
              <legend className="px-1 text-[#444]">結果</legend>
              <div className="grid grid-cols-[64px_1fr] gap-y-0.5 font-mono text-[11px]">
                <span className="font-sans">需時(s):</span>
                <span>{elapsedSec}</span>
                <span className="font-sans">數據量:</span>
                <span>{hasLoaded ? `${activeRowCount}/${colCount}` : "0"}</span>
              </div>
            </fieldset>
          </div>
        </div>

        {/* Right GO! box matching Screenshots 031-034 */}
        <button
          type="button"
          onClick={() => void runQuery()}
          disabled={loading}
          aria-label="GO"
          className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 border border-[#aca899] bg-[#f4f4f4] p-1 hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
        >
          <LegacyIcon name={kind === "sales" ? "bdata" : kind === "member" ? "members" : "staff"} className="h-6 w-6" />
          <span className="text-[11px]">{buttonLabel}</span>
          <span className="rounded bg-[#5cb85c] px-2.5 py-0.5 text-[11px] font-bold text-white shadow-xs">
            {loading ? "…" : "GO!"}
          </span>
        </button>
      </div>

      {error ? (
        <div className="border-b border-[#aca899] bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">
          營運通訊息 - 053：{error}
        </div>
      ) : null}

      {/* Data Grid */}
      <div className="min-h-0 flex-1 overflow-auto bg-[#e6e6e6]">
        {!hasLoaded ? (
          <div className="p-2">
            <table className="border-collapse border border-[#aca899] bg-white text-[12px]">
              <tbody>
                <tr>
                  <td className="h-5 w-20 border border-[#aca899]" />
                  <td className="h-5 w-20 border border-[#aca899]" />
                </tr>
                <tr>
                  <td className="h-5 w-20 border border-[#aca899]" />
                  <td className="h-5 w-20 border border-[#aca899]" />
                </tr>
              </tbody>
            </table>
          </div>
        ) : kind === "sales" ? (
          <table className="w-full border-collapse bg-white text-[12px] text-black">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f0f0f0] text-left">
                {[
                  ["貨品", false],
                  ["貨碼", false],
                  ["條碼", false],
                  ["條碼名稱", false],
                  ["顏色", false],
                  ["尺碼", false],
                  ["供應商", false],
                  ["單位", false],
                  ["銷售筆數", true],
                  ["銷售量", true],
                  ["銷售值", true],
                  ["估計毛利", true],
                ].map(([h, num]) => (
                  <th key={String(h)} className={`border border-[#808080] px-2 py-1 font-bold ${num ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {salesRows.map((r, i) => (
                <tr key={`${r.sku}-${i}`} className="hover:bg-[#eef5ff]">
                  <td className="max-w-[200px] truncate border border-[#999] px-1.5 py-0.5">{r.productName}</td>
                  <td className="border border-[#999] px-1.5 py-0.5 font-mono">{r.ubc}</td>
                  <td className="border border-[#999] px-1.5 py-0.5 font-mono">{r.sku}</td>
                  <td className="max-w-[200px] truncate border border-[#999] px-1.5 py-0.5">{r.barcodeName}</td>
                  <td className="border border-[#999] px-1.5 py-0.5">{r.color}</td>
                  <td className="border border-[#999] px-1.5 py-0.5">{r.size}</td>
                  <td className="border border-[#999] px-1.5 py-0.5">{r.supplier}</td>
                  <td className="border border-[#999] px-1.5 py-0.5">{r.unit}</td>
                  <td className="border border-[#999] px-1.5 py-0.5 text-right font-mono">{r.billCount}</td>
                  <td className="border border-[#999] px-1.5 py-0.5 text-right font-mono">{r.quantity}</td>
                  <td className="border border-[#999] px-1.5 py-0.5 text-right font-mono">{formatHkd(r.salesValueHkd).replace("HK", "")}</td>
                  <td className="border border-[#999] px-1.5 py-0.5 text-right font-mono">{formatHkd(r.estGrossProfitHkd).replace("HK", "")}</td>
                </tr>
              ))}
              {salesRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="border border-[#999] bg-white p-8 text-center text-[#666]">
                    此期間及條件下暫無銷售統計紀錄
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : kind === "member" ? (
          <table className="border-collapse bg-white text-[12px] text-black">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f0f0f0] text-left">
                {[
                  ["客戶編號", false],
                  ["姓名", false],
                  ["按日", false],
                  ["銷售筆數", true],
                  ["銷售量", true],
                  ["銷售值", true],
                  ["估計毛利", true],
                ].map(([h, num]) => (
                  <th key={String(h)} className={`border border-[#808080] px-2 py-1 font-bold ${num ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {memberRows.map((r, i) => {
                const prev = i > 0 ? memberRows[i - 1] : null;
                const sameCustomer = prev?.customerCode === r.customerCode;
                return (
                  <tr key={`${r.customerCode}-${r.businessDate}-${i}`} className="hover:bg-[#eef5ff]">
                    <td className="border border-[#999] px-2 py-0.5 font-mono">{sameCustomer ? "" : r.customerCode}</td>
                    <td className="min-w-[160px] border border-[#999] px-2 py-0.5">{sameCustomer ? "" : r.customerName}</td>
                    <td className="border border-[#999] px-2 py-0.5 font-mono">{r.businessDate.replace(/-/g, "/")}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{r.billCount}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{r.quantity}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{formatHkd(r.salesValueHkd).replace("HK", "")}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{formatHkd(r.estGrossProfitHkd).replace("HK", "")}</td>
                  </tr>
                );
              })}
              {memberRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="border border-[#999] bg-white p-8 text-center text-[#666]">
                    此期間及條件下暫無會員統計紀錄
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <table className="border-collapse bg-white text-[12px] text-black">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f0f0f0] text-left">
                {[
                  ["職員編號", false],
                  ["職員", false],
                  ["按日", false],
                  ["條碼名稱", false],
                  ["銷售筆數", true],
                  ["銷售量", true],
                  ["銷售值", true],
                  ["估計毛利", true],
                ].map(([h, num]) => (
                  <th key={String(h)} className={`border border-[#808080] px-2 py-1 font-bold ${num ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {staffRows.map((r, i) => {
                const prev = i > 0 ? staffRows[i - 1] : null;
                const sameStaff = prev?.staffCode === r.staffCode;
                const sameDate = sameStaff && prev?.businessDate === r.businessDate;
                return (
                  <tr key={`${r.staffCode}-${r.businessDate}-${r.sku}-${i}`} className="hover:bg-[#eef5ff]">
                    <td className="border border-[#999] px-2 py-0.5 font-mono">{sameStaff ? "" : r.staffCode}</td>
                    <td className="border border-[#999] px-2 py-0.5">{sameStaff ? "" : r.staffName}</td>
                    <td className="border border-[#999] px-2 py-0.5 font-mono">{sameDate ? "" : r.businessDate.replace(/-/g, "/")}</td>
                    <td className="min-w-[220px] border border-[#999] px-2 py-0.5">{r.barcodeName}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{r.billCount}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{r.quantity}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{formatHkd(r.salesValueHkd).replace("HK", "")}</td>
                    <td className="border border-[#999] px-2 py-0.5 text-right font-mono">{formatHkd(r.estGrossProfitHkd).replace("HK", "")}</td>
                  </tr>
                );
              })}
              {staffRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="border border-[#999] bg-white p-8 text-center text-[#666]">
                    此期間及條件下暫無職員統計紀錄
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

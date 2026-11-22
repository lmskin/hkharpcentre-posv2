"use client";

import { useEffect, useState } from "react";
import {
  currentBusinessDate,
  downloadCsvFile,
  fmtAmt,
  fmtQty,
  reportBtn,
  reportCell,
  reportHeader,
  reportInput,
  ReportPaper,
  reportTable,
  reportTotalRow,
} from "./ReportShell";

interface CategoryOpt {
  legacyC1: number;
  nameZh: string;
  nameEn: string;
}

interface StockInvRow {
  productId: number;
  sku: string;
  ubc: string;
  nameZh: string;
  nameEn: string;
  categoryC1: number;
  categoryName: string;
  unitName: string;
  onHandQty: number;
  avgCostHkd: number;
  stockValAvgHkd: number;
  lastCostHkd: number;
  stockValLastHkd: number;
  sellPriceHkd: number;
  retailValHkd: number;
  lastSaleDate: string | null;
  daysNotSold: number | null;
  totalSoldQty: number;
  sold90dQty: number;
  reorderLevel: number;
  suggestedReorderQty: number;
  estReorderCostHkd: number;
  updatedAtIso: string | null;
}

interface StockInvData {
  subView: "valuation" | "last_sale" | "reorder";
  asOfDate: string;
  rows: StockInvRow[];
  totals: {
    skuCount: number;
    onHandQty: number;
    stockValAvgHkd: number;
    stockValLastHkd: number;
    retailValHkd: number;
    suggestedReorderQty: number;
    estReorderCostHkd: number;
  };
}

export function StockValueView({
  shopLabel = "Central(1)",
  categories = [],
}: {
  shopLabel?: string;
  categories?: CategoryOpt[];
}) {
  const [subView, setSubView] = useState<"valuation" | "last_sale" | "reorder">("valuation");
  const [categoryC1, setCategoryC1] = useState("");
  const [q, setQ] = useState("");
  const [positiveOnly, setPositiveOnly] = useState(true);
  const [minDays, setMinDays] = useState("90");
  const [threshold, setThreshold] = useState("2");
  const [data, setData] = useState<StockInvData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(null);
    const sp = new URLSearchParams({
      view: "stock_val",
      subView,
      positiveOnly: positiveOnly ? "1" : "0",
      minDays,
      threshold,
    });
    if (categoryC1 !== "") sp.set("categoryC1", categoryC1);
    if (q.trim()) sp.set("q", q.trim());
    fetch(`/api/reports?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as StockInvData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取存貨價值及呆貨報表");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取存貨價值及呆貨報表"));
  }, [subView, categoryC1, q, positiveOnly, minDays, threshold, tick]);

  function exportCsv() {
    if (!data) return;
    downloadCsvFile(`bos-stock-${subView}-${data.asOfDate}.csv`, [
      [
        "條碼(BC)",
        "貨碼(UBC)",
        "貨品名稱",
        "主分類(C1)",
        "單位",
        "現存量",
        "平均成本(AvgCost)",
        "存貨價值(AvgCost)",
        "最後入貨價(CostUP)",
        "存貨價值(CostUP)",
        "零售價(SEP)",
        "零售總值",
        "最後售賣日",
        "未售日數",
        "90日銷量",
        "建議補貨量",
        "預算採購額",
      ],
      ...data.rows.map((r) => [
        r.sku,
        r.ubc,
        r.nameZh || r.nameEn,
        r.categoryName,
        r.unitName,
        r.onHandQty,
        r.avgCostHkd.toFixed(2),
        r.stockValAvgHkd.toFixed(2),
        r.lastCostHkd.toFixed(2),
        r.stockValLastHkd.toFixed(2),
        r.sellPriceHkd.toFixed(2),
        r.retailValHkd.toFixed(2),
        r.lastSaleDate ?? "從未售出",
        r.daysNotSold ?? "",
        r.sold90dQty,
        r.suggestedReorderQty,
        r.estReorderCostHkd.toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="print-hide flex flex-wrap items-center gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-2 text-[12px]">
        <div className="flex gap-1">
          {(
            [
              ["valuation", "10405 存貨價值 (StockValue)"],
              ["last_sale", "貨品最後售賣 / 呆貨日數"],
              ["reorder", "存貨量及補貨建議 (productqty)"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubView(id)}
              className={`border border-[#7f9db9] px-2.5 py-1 ${
                subView === id ? "bg-[#316ac5] font-bold text-white" : "bg-white text-black hover:bg-[#e5e1d5]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <select value={categoryC1} onChange={(e) => setCategoryC1(e.target.value)} className={reportInput}>
          <option value="">全部分類</option>
          {categories.map((c) => (
            <option key={c.legacyC1} value={String(c.legacyC1)}>
              {c.legacyC1} - {c.nameZh || c.nameEn}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋條碼 / 貨碼 / 貨品"
          className={`${reportInput} w-40`}
        />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={positiveOnly} onChange={(e) => setPositiveOnly(e.target.checked)} />
          僅顯示有存貨(&gt;0)
        </label>
        {subView === "last_sale" ? (
          <label>
            呆貨最少日數
            <input
              type="number"
              min="0"
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
              className={`${reportInput} ml-1 w-16 text-right`}
            />
          </label>
        ) : null}
        {subView === "reorder" ? (
          <label>
            最低安全存量
            <input
              type="number"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className={`${reportInput} ml-1 w-16 text-right`}
            />
          </label>
        ) : null}
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setTick((n) => n + 1)} className={reportBtn}>
            執行查詢
          </button>
          <button type="button" disabled={!data} onClick={exportCsv} className={reportBtn}>
            匯出 CSV
          </button>
          <button type="button" onClick={() => window.print()} className={reportBtn}>
            列印預覽
          </button>
        </div>
      </div>
      {error ? <div className="print-hide bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 053：{error}</div> : null}
      <div className="legacy-report-scroll min-h-0 flex-1 overflow-auto bg-white">
        <ReportPaper
          reportTitle={
            subView === "valuation"
              ? "10405 存貨價值報表 (Stock Value Report)"
              : subView === "last_sale"
                ? "貨品最後售賣及呆貨分析報表 (productlastsale)"
                : "存貨量及補貨建議報表 (productqty)"
          }
          legacyCode="clsStockValRpt / productlastsale / productqty"
          subtitle={`結算基準日: ${data?.asOfDate ?? ""}`}
          shopLabel={shopLabel}
          recordCount={data?.rows.length}
        >
          {data ? (
            <table className={reportTable}>
              <thead className="sticky top-0 z-10">
                <tr className={reportHeader}>
                  <th className="px-2 py-1 font-bold">條碼 (BC)</th>
                  <th className="px-2 py-1 font-bold">貨碼 (UBC)</th>
                  <th className="px-2 py-1 font-bold">貨品名稱</th>
                  <th className="px-2 py-1 font-bold">主分類</th>
                  <th className="px-2 py-1 text-right font-bold">現存量 QOH</th>
                  <th className="px-2 py-1 text-right font-bold">平均成本</th>
                  <th className="px-2 py-1 text-right font-bold">存貨價值(均)</th>
                  <th className="px-2 py-1 text-right font-bold">最後入貨價</th>
                  <th className="px-2 py-1 text-right font-bold">存貨價值(入)</th>
                  <th className="px-2 py-1 text-right font-bold">零售價 SEP</th>
                  <th className="px-2 py-1 text-right font-bold">零售總值</th>
                  <th className="px-2 py-1 font-bold">最後售賣日</th>
                  <th className="px-2 py-1 text-right font-bold">未售日數</th>
                  {subView === "reorder" ? <th className="px-2 py-1 text-right font-bold">90日銷量</th> : null}
                  {subView === "reorder" ? <th className="px-2 py-1 text-right font-bold">建議補貨</th> : null}
                  {subView === "reorder" ? <th className="px-2 py-1 text-right font-bold">採購估值</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.productId} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                    <td className={`${reportCell} font-mono`}>{r.sku}</td>
                    <td className={`${reportCell} font-mono text-[#555]`}>{r.ubc || "-"}</td>
                    <td className={reportCell}>{r.nameZh || r.nameEn}</td>
                    <td className={reportCell}>{r.categoryName}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.onHandQty)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.avgCostHkd)}</td>
                    <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.stockValAvgHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.lastCostHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.stockValLastHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.sellPriceHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.retailValHkd)}</td>
                    <td className={`${reportCell} font-mono`}>{r.lastSaleDate ?? "從未售出"}</td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {r.daysNotSold !== null ? `${r.daysNotSold} 日` : "-"}
                    </td>
                    {subView === "reorder" ? (
                      <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.sold90dQty)}</td>
                    ) : null}
                    {subView === "reorder" ? (
                      <td className={`${reportCell} text-right font-mono font-bold text-[#c00000]`}>
                        {fmtQty(r.suggestedReorderQty)}
                      </td>
                    ) : null}
                    {subView === "reorder" ? (
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.estReorderCostHkd)}</td>
                    ) : null}
                  </tr>
                ))}
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={16} className="p-8 text-center text-[#666]">
                      無符合條件的存貨項目
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className={reportTotalRow}>
                  <td className={reportCell} colSpan={4}>
                    總計 · {data.totals.skuCount} 項 SKU
                  </td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.onHandQty)}</td>
                  <td className={reportCell} />
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.stockValAvgHkd)}</td>
                  <td className={reportCell} />
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.stockValLastHkd)}</td>
                  <td className={reportCell} />
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.retailValHkd)}</td>
                  <td className={reportCell} colSpan={2} />
                  {subView === "reorder" ? <td className={reportCell} /> : null}
                  {subView === "reorder" ? (
                    <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.suggestedReorderQty)}</td>
                  ) : null}
                  {subView === "reorder" ? (
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.estReorderCostHkd)}</td>
                  ) : null}
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="p-6 text-center text-[12px]">讀取中…</div>
          )}
        </ReportPaper>
      </div>
    </div>
  );
}

interface MovementMatrixData {
  range: { fromDate: string; toDate: string };
  rows: Array<{
    productId: number;
    sku: string;
    ubc: string;
    nameZh: string;
    nameEn: string;
    categoryC1: number;
    categoryName: string;
    openingQty: number;
    inGrcQty: number;
    inRtnQty: number;
    inTriQty: number;
    outSaleQty: number;
    outPrcQty: number;
    outTroQty: number;
    outWofQty: number;
    adjQty: number;
    stkQty: number;
    netDeltaQty: number;
    closingQty: number;
    avgCostHkd: number;
    closingValHkd: number;
  }>;
  totals: {
    skuCount: number;
    openingQty: number;
    inGrcQty: number;
    inRtnQty: number;
    inTriQty: number;
    outSaleQty: number;
    outPrcQty: number;
    outTroQty: number;
    outWofQty: number;
    adjQty: number;
    stkQty: number;
    netDeltaQty: number;
    closingQty: number;
    closingValHkd: number;
  };
}

export function StockMovementMatrixView({
  shopLabel = "Central(1)",
  categories = [],
}: {
  shopLabel?: string;
  categories?: CategoryOpt[];
}) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [categoryC1, setCategoryC1] = useState("");
  const [q, setQ] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [data, setData] = useState<MovementMatrixData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (fromDate > toDate) return;
    setData(null);
    const sp = new URLSearchParams({
      view: "movement",
      from: fromDate,
      to: toDate,
      activeOnly: activeOnly ? "1" : "0",
    });
    if (categoryC1 !== "") sp.set("categoryC1", categoryC1);
    if (q.trim()) sp.set("q", q.trim());
    fetch(`/api/reports?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as MovementMatrixData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取存貨變動報表");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取存貨變動報表"));
  }, [fromDate, toDate, categoryC1, q, activeOnly, tick]);

  function exportCsv() {
    if (!data) return;
    downloadCsvFile(`bos-movement-10407-${fromDate}-${toDate}.csv`, [
      [
        "條碼(BC)",
        "貨品名稱",
        "主分類",
        "期初存貨",
        "+到貨",
        "+客退",
        "+轉入",
        "-銷售",
        "-退商",
        "-轉出",
        "-報銷",
        "調整(含回沖)",
        "盤點差異",
        "淨變動",
        "期末存貨",
        "平均成本",
        "期末價值",
      ],
      ...data.rows.map((r) => [
        r.sku,
        r.nameZh || r.nameEn,
        r.categoryName,
        r.openingQty,
        r.inGrcQty,
        r.inRtnQty,
        r.inTriQty,
        r.outSaleQty,
        r.outPrcQty,
        r.outTroQty,
        r.outWofQty,
        r.adjQty,
        r.stkQty,
        r.netDeltaQty,
        r.closingQty,
        r.avgCostHkd.toFixed(2),
        r.closingValHkd.toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="print-hide flex flex-wrap items-center gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-2 text-[12px]">
        <label>
          由
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        <label>
          至
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        <select value={categoryC1} onChange={(e) => setCategoryC1(e.target.value)} className={reportInput}>
          <option value="">全部分類</option>
          {categories.map((c) => (
            <option key={c.legacyC1} value={String(c.legacyC1)}>
              {c.legacyC1} - {c.nameZh || c.nameEn}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋條碼 / 貨品"
          className={`${reportInput} w-40`}
        />
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          僅顯示有存貨或異動
        </label>
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setTick((n) => n + 1)} className={reportBtn}>
            執行查詢
          </button>
          <button type="button" disabled={!data} onClick={exportCsv} className={reportBtn}>
            匯出 CSV
          </button>
          <button type="button" onClick={() => window.print()} className={reportBtn}>
            列印預覽
          </button>
        </div>
      </div>
      {error ? <div className="print-hide bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 053：{error}</div> : null}
      <div className="legacy-report-scroll min-h-0 flex-1 overflow-auto bg-white">
        <ReportPaper
          reportTitle="10407 存貨變動報表 (BOS Stock Movement Report)"
          legacyCode="Report4 / 10407"
          subtitle={`期間: ${fromDate} 至 ${toDate} · 期初 + 淨變動 = 期末`}
          shopLabel={shopLabel}
          recordCount={data?.rows.length}
        >
          {data ? (
            <table className={reportTable}>
              <thead className="sticky top-0 z-10">
                <tr className={reportHeader}>
                  <th className="px-2 py-1 font-bold">條碼 (BC)</th>
                  <th className="px-2 py-1 font-bold">貨品名稱</th>
                  <th className="px-2 py-1 text-right font-bold">期初存貨</th>
                  <th className="px-2 py-1 text-right font-bold">+到貨</th>
                  <th className="px-2 py-1 text-right font-bold">+客退</th>
                  <th className="px-2 py-1 text-right font-bold">+轉入</th>
                  <th className="px-2 py-1 text-right font-bold">-銷售</th>
                  <th className="px-2 py-1 text-right font-bold">-退商</th>
                  <th className="px-2 py-1 text-right font-bold">-轉出</th>
                  <th className="px-2 py-1 text-right font-bold">-報銷</th>
                  <th className="px-2 py-1 text-right font-bold">±調整</th>
                  <th className="px-2 py-1 text-right font-bold">±盤點</th>
                  <th className="px-2 py-1 text-right font-bold">淨變動</th>
                  <th className="px-2 py-1 text-right font-bold">期末存貨</th>
                  <th className="px-2 py-1 text-right font-bold">期末價值</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.productId} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                    <td className={`${reportCell} font-mono`}>{r.sku}</td>
                    <td className={reportCell}>{r.nameZh || r.nameEn}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.openingQty)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.inGrcQty ? fmtQty(r.inGrcQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.inRtnQty ? fmtQty(r.inRtnQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.inTriQty ? fmtQty(r.inTriQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.outSaleQty ? fmtQty(r.outSaleQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.outPrcQty ? fmtQty(r.outPrcQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.outTroQty ? fmtQty(r.outTroQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.outWofQty ? fmtQty(r.outWofQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.adjQty ? fmtQty(r.adjQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono`}>{r.stkQty ? fmtQty(r.stkQty) : "-"}</td>
                    <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtQty(r.netDeltaQty)}</td>
                    <td className={`${reportCell} text-right font-mono font-bold`}>{fmtQty(r.closingQty)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.closingValHkd)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={15} className="p-8 text-center text-[#666]">
                      此期間無存貨變動紀錄
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className={reportTotalRow}>
                  <td className={reportCell} colSpan={2}>
                    總計 · {data.totals.skuCount} 項 SKU
                  </td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.openingQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.inGrcQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.inRtnQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.inTriQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.outSaleQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.outPrcQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.outTroQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.outWofQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.adjQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.stkQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.netDeltaQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.closingQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.closingValHkd)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div className="p-6 text-center text-[12px]">讀取中…</div>
          )}
        </ReportPaper>
      </div>
    </div>
  );
}

export function CheckLedgerView({ shopLabel = "Central(1)" }: { shopLabel?: string }) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [subView, setSubView] = useState<"headers" | "lines" | "payments">("headers");
  const [docType, setDocType] = useState("");
  const [tenderCode, setTenderCode] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (fromDate > toDate) return;
    setData(null);
    const sp = new URLSearchParams({ view: "check_ledger", from: fromDate, to: toDate, subView });
    if (docType) sp.set("docType", docType);
    if (tenderCode && subView === "payments") sp.set("tenderCode", tenderCode);
    if (q.trim()) sp.set("q", q.trim());
    fetch(`/api/reports?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as Record<string, unknown> & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取查單及收款明細報表");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取查單及收款明細報表"));
  }, [fromDate, toDate, subView, docType, tenderCode, q, tick]);

  function exportCsv() {
    if (!data) return;
    if (subView === "headers") {
      const rows = (data.rows ?? []) as Array<{
        legacySn: number;
        legacyMn: number;
        invoiceNo: string;
        docType: string;
        businessDate: string;
        issuedTime: string;
        counterparty: string;
        staffName: string;
        grossHkd: number;
        discountHkd: number;
        netHkd: number;
        paidHkd: number;
        balanceDueHkd: number;
        status: string;
        notes: string;
      }>;
      downloadCsvFile(`check-headers-${fromDate}-${toDate}.csv`, [
        ["店舖", "機號", "單號", "類型", "營業日期", "時間", "客戶/對方", "職員", "單折前額", "折扣額", "實收金額", "已付", "尚欠餘額", "狀況", "備註"],
        ...rows.map((r) => [
          r.legacySn,
          r.legacyMn,
          r.invoiceNo,
          r.docType,
          r.businessDate,
          r.issuedTime,
          r.counterparty,
          r.staffName,
          r.grossHkd.toFixed(2),
          r.discountHkd.toFixed(2),
          r.netHkd.toFixed(2),
          r.paidHkd.toFixed(2),
          r.balanceDueHkd.toFixed(2),
          r.status,
          r.notes,
        ]),
      ]);
      return;
    }
    if (subView === "lines") {
      const rows = (data.rows ?? []) as Array<{
        businessDate: string;
        issuedTime: string;
        invoiceNo: string;
        docType: string;
        lineNo: number;
        sku: string;
        nameZh: string;
        categoryC1: number;
        quantity: number;
        unitPriceHkd: number;
        discountHkd: number;
        lineTotalHkd: number;
        staffName: string;
        cancelled: boolean;
      }>;
      downloadCsvFile(`check-lines-${fromDate}-${toDate}.csv`, [
        ["營業日期", "時間", "單號", "類型", "項", "條碼", "貨名", "主分類", "數量", "單價", "折扣額", "實收共銀", "職員", "取消"],
        ...rows.map((r) => [
          r.businessDate,
          r.issuedTime,
          r.invoiceNo,
          r.docType,
          r.lineNo,
          r.sku,
          r.nameZh,
          r.categoryC1,
          r.quantity,
          r.unitPriceHkd.toFixed(2),
          r.discountHkd.toFixed(2),
          r.lineTotalHkd.toFixed(2),
          r.staffName,
          r.cancelled ? "Y" : "",
        ]),
      ]);
      return;
    }
    const rows = (data.rows ?? []) as Array<{
      businessDate: string;
      paidTime: string;
      invoiceNo: string;
      customerName: string;
      tenderCode: string;
      tenderNameZh: string;
      amountHkd: number;
      approvalCode: string;
      cardLast4: string;
      referenceNo: string;
      staffName: string;
      remarks: string;
    }>;
    downloadCsvFile(`check-payments-${fromDate}-${toDate}.csv`, [
      ["營業日期", "時間", "單號", "客戶", "付款方式", "名稱", "實收金額", "批核碼", "尾四位", "參考編號", "職員", "備註"],
      ...rows.map((r) => [
        r.businessDate,
        r.paidTime,
        r.invoiceNo,
        r.customerName,
        r.tenderCode,
        r.tenderNameZh,
        r.amountHkd.toFixed(2),
        r.approvalCode,
        r.cardLast4,
        r.referenceNo,
        r.staffName,
        r.remarks,
      ]),
    ]);
  }

  const rows = ((data?.rows ?? []) as unknown[]) || [];

  return (
    <div className="flex h-full flex-col">
      <div className="print-hide flex flex-wrap items-center gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-2 text-[12px]">
        <div className="flex gap-1">
          {(
            [
              ["headers", "單頭表列 (histheader)"],
              ["lines", "單項明細 (histdetail)"],
              ["payments", "收款明細及AR帳齡 (wfpayment)"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubView(id)}
              className={`border border-[#7f9db9] px-2.5 py-1 ${
                subView === id ? "bg-[#316ac5] font-bold text-white" : "bg-white text-black hover:bg-[#e5e1d5]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          由
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        <label>
          至
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        {subView !== "payments" ? (
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={reportInput}>
            <option value="">全部單據類型</option>
            <option value="RETAIL_SALE">RETAIL_SALE (零售)</option>
            <option value="SALES_INVOICE">SALES_INVOICE (發票)</option>
            <option value="SALES_RETURN">SALES_RETURN (退售)</option>
            <option value="PETTY_PAYOUT">PETTY_PAYOUT (支出)</option>
          </select>
        ) : (
          <select value={tenderCode} onChange={(e) => setTenderCode(e.target.value)} className={reportInput}>
            <option value="">全部付款方法</option>
            <option value="CASH">CASH 現金</option>
            <option value="OCTOPUS">OCTOPUS 八達通</option>
            <option value="VISA">VISA</option>
            <option value="MASTERCARD">MASTERCARD</option>
            <option value="UNIONPAY">UNIONPAY 銀聯</option>
            <option value="BANK_XFER">BANK_XFER 轉帳</option>
            <option value="AMEX">AMEX AE</option>
            <option value="CHEQUE">CHEQUE 支票</option>
          </select>
        )}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋單號 / 客戶 / 條碼 / 參考號"
          className={`${reportInput} w-44`}
        />
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setTick((n) => n + 1)} className={reportBtn}>
            執行查詢
          </button>
          <button type="button" disabled={!data} onClick={exportCsv} className={reportBtn}>
            匯出 CSV
          </button>
          <button type="button" onClick={() => window.print()} className={reportBtn}>
            列印預覽
          </button>
        </div>
      </div>
      {error ? <div className="print-hide bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 053：{error}</div> : null}
      <div className="legacy-report-scroll min-h-0 flex-1 overflow-auto bg-white">
        <ReportPaper
          reportTitle="查單・單項明細・收款及應收帳齡報表"
          legacyCode="histheader / histdetail / wfpayment"
          subtitle={`期間: ${fromDate} 至 ${toDate}`}
          shopLabel={shopLabel}
          recordCount={rows.length}
        >
          {!data ? (
            <div className="p-6 text-center text-[12px]">讀取中…</div>
          ) : subView === "headers" ? (
            (() => {
              const typedRows = rows as Array<{
                legacySn: number;
                legacyMn: number;
                invoiceNo: string;
                docType: string;
                businessDate: string;
                issuedTime: string;
                counterparty: string;
                staffName: string;
                grossHkd: number;
                discountHkd: number;
                netHkd: number;
                paidHkd: number;
                balanceDueHkd: number;
                status: string;
                paymentStatus: string;
                notes: string;
              }>;
              const tot = data.totals as {
                count: number;
                grossHkd: number;
                discountHkd: number;
                netHkd: number;
                paidHkd: number;
                balanceDueHkd: number;
              };
              return (
                <table className={reportTable}>
                  <thead className="sticky top-0 z-10">
                    <tr className={reportHeader}>
                      <th className="px-2 py-1 font-bold">店/機</th>
                      <th className="px-2 py-1 font-bold">單號</th>
                      <th className="px-2 py-1 font-bold">單日期</th>
                      <th className="px-2 py-1 font-bold">時間</th>
                      <th className="px-2 py-1 font-bold">類型</th>
                      <th className="px-2 py-1 font-bold">客戶 / 交易對方</th>
                      <th className="px-2 py-1 font-bold">職員</th>
                      <th className="px-2 py-1 text-right font-bold">單折前額</th>
                      <th className="px-2 py-1 text-right font-bold">折扣額</th>
                      <th className="px-2 py-1 text-right font-bold">實收金額</th>
                      <th className="px-2 py-1 text-right font-bold">客付/已付</th>
                      <th className="px-2 py-1 text-right font-bold">未收餘額</th>
                      <th className="px-2 py-1 font-bold">流程狀況</th>
                      <th className="px-2 py-1 font-bold">備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typedRows.map((r, i) => (
                      <tr key={r.invoiceNo} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                        <td className={`${reportCell} font-mono`}>
                          {r.legacySn}/{r.legacyMn}
                        </td>
                        <td className={`${reportCell} font-mono font-semibold`}>{r.invoiceNo}</td>
                        <td className={`${reportCell} font-mono`}>{r.businessDate}</td>
                        <td className={`${reportCell} font-mono`}>{r.issuedTime}</td>
                        <td className={`${reportCell} font-mono`}>{r.docType}</td>
                        <td className={reportCell}>{r.counterparty}</td>
                        <td className={reportCell}>{r.staffName}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.grossHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.discountHkd)}</td>
                        <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.netHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.paidHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.balanceDueHkd)}</td>
                        <td className={reportCell}>
                          {r.status === "cancelled" ? "已取消" : `${r.status} / ${r.paymentStatus}`}
                        </td>
                        <td className={`${reportCell} max-w-44 truncate`}>{r.notes}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={reportTotalRow}>
                      <td className={reportCell} colSpan={7}>
                        總計 · 有效單 {tot.count} 筆
                      </td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.grossHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.discountHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.netHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.paidHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.balanceDueHkd)}</td>
                      <td className={reportCell} colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              );
            })()
          ) : subView === "lines" ? (
            (() => {
              const typedRows = rows as Array<{
                businessDate: string;
                issuedTime: string;
                invoiceNo: string;
                docType: string;
                lineNo: number;
                sku: string;
                nameZh: string;
                categoryC1: number;
                quantity: number;
                unitPriceHkd: number;
                discountHkd: number;
                lineTotalHkd: number;
                cancelled: boolean;
                staffName: string;
              }>;
              const tot = data.totals as {
                count: number;
                quantity: number;
                discountHkd: number;
                lineTotalHkd: number;
              };
              return (
                <table className={reportTable}>
                  <thead className="sticky top-0 z-10">
                    <tr className={reportHeader}>
                      <th className="px-2 py-1 font-bold">單日期</th>
                      <th className="px-2 py-1 font-bold">單號</th>
                      <th className="px-2 py-1 text-right font-bold">項 DK</th>
                      <th className="px-2 py-1 font-bold">編碼 (BC)</th>
                      <th className="px-2 py-1 font-bold">貨名</th>
                      <th className="px-2 py-1 text-right font-bold">C1</th>
                      <th className="px-2 py-1 text-right font-bold">數量</th>
                      <th className="px-2 py-1 text-right font-bold">單價</th>
                      <th className="px-2 py-1 text-right font-bold">項折</th>
                      <th className="px-2 py-1 text-right font-bold">折實金額</th>
                      <th className="px-2 py-1 font-bold">職員</th>
                      <th className="px-2 py-1 font-bold">取消</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typedRows.map((r, i) => (
                      <tr key={`${r.invoiceNo}-${r.lineNo}-${i}`} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                        <td className={`${reportCell} font-mono`}>{r.businessDate}</td>
                        <td className={`${reportCell} font-mono`}>{r.invoiceNo}</td>
                        <td className={`${reportCell} text-right font-mono`}>{r.lineNo}</td>
                        <td className={`${reportCell} font-mono`}>{r.sku}</td>
                        <td className={reportCell}>{r.nameZh}</td>
                        <td className={`${reportCell} text-right font-mono`}>{r.categoryC1}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.quantity)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.unitPriceHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.discountHkd)}</td>
                        <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.lineTotalHkd)}</td>
                        <td className={reportCell}>{r.staffName}</td>
                        <td className={reportCell}>{r.cancelled ? "已取消" : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={reportTotalRow}>
                      <td className={reportCell} colSpan={6}>
                        總計 · 有效明細 {tot.count} 項
                      </td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtQty(tot.quantity)}</td>
                      <td className={reportCell} />
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.discountHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.lineTotalHkd)}</td>
                      <td className={reportCell} colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              );
            })()
          ) : (
            (() => {
              const typedRows = rows as Array<{
                businessDate: string;
                paidTime: string;
                invoiceNo: string;
                docType: string;
                customerName: string;
                tenderCode: string;
                tenderNameZh: string;
                amountHkd: number;
                approvalCode: string;
                cardLast4: string;
                referenceNo: string;
                staffName: string;
                remarks: string;
              }>;
              const subs = (data.tenderSubTotals ?? []) as Array<{
                tenderCode: string;
                tenderNameZh: string;
                legacyPm: number;
                txCount: number;
                amountHkd: number;
              }>;
              const buckets = (data.arAgingBuckets ?? []) as Array<{
                bucket: string;
                label: string;
                invoiceCount: number;
                balanceDueHkd: number;
              }>;
              const openInvs = (data.openInvoices ?? []) as Array<{
                invoiceNo: string;
                businessDate: string;
                customerName: string;
                netHkd: number;
                paidHkd: number;
                balanceDueHkd: number;
                ageDays: number;
              }>;
              const tot = data.totals as { count: number; amountHkd: number; totalArDueHkd: number; totalArInvoices: number };

              return (
                <div className="space-y-4 p-2">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="border border-[#7f9db9]">
                      <div className="border-b border-[#7f9db9] bg-[#e8eef5] px-2 py-1 text-[12px] font-bold">
                        付款方法分組小計 (wfpayment)
                      </div>
                      <table className={reportTable}>
                        <thead>
                          <tr className="bg-[#f4f7fa]">
                            <th className="px-2 py-1 font-bold">PM</th>
                            <th className="px-2 py-1 font-bold">方法</th>
                            <th className="px-2 py-1 text-right font-bold">筆數</th>
                            <th className="px-2 py-1 text-right font-bold">實收金額</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subs.map((s) => (
                            <tr key={s.tenderCode}>
                              <td className={`${reportCell} font-mono`}>{s.legacyPm}</td>
                              <td className={reportCell}>
                                {s.tenderNameZh} ({s.tenderCode})
                              </td>
                              <td className={`${reportCell} text-right font-mono`}>{s.txCount}</td>
                              <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(s.amountHkd)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className={reportTotalRow}>
                            <td className={reportCell} colSpan={2}>
                              總計
                            </td>
                            <td className={`${reportCell} text-right font-mono`}>{tot.count}</td>
                            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.amountHkd)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div className="border border-[#7f9db9]">
                      <div className="border-b border-[#7f9db9] bg-[#e8eef5] px-2 py-1 text-[12px] font-bold">
                        未收發票 AR 帳齡分析 (現時未結發票)
                      </div>
                      <table className={reportTable}>
                        <thead>
                          <tr className="bg-[#f4f7fa]">
                            <th className="px-2 py-1 font-bold">帳齡區間</th>
                            <th className="px-2 py-1 text-right font-bold">發票數</th>
                            <th className="px-2 py-1 text-right font-bold">未收餘額 HKD</th>
                          </tr>
                        </thead>
                        <tbody>
                          {buckets.map((b) => (
                            <tr key={b.bucket}>
                              <td className={reportCell}>{b.label}</td>
                              <td className={`${reportCell} text-right font-mono`}>{b.invoiceCount}</td>
                              <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(b.balanceDueHkd)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className={reportTotalRow}>
                            <td className={reportCell}>AR 未收總計</td>
                            <td className={`${reportCell} text-right font-mono`}>{tot.totalArInvoices}</td>
                            <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.totalArDueHkd)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  <table className={reportTable}>
                    <thead className="sticky top-0 z-10">
                      <tr className={reportHeader}>
                        <th className="px-2 py-1 font-bold">收款營業日</th>
                        <th className="px-2 py-1 font-bold">時間</th>
                        <th className="px-2 py-1 font-bold">單號</th>
                        <th className="px-2 py-1 font-bold">客戶</th>
                        <th className="px-2 py-1 font-bold">付款方法</th>
                        <th className="px-2 py-1 text-right font-bold">實收金額</th>
                        <th className="px-2 py-1 font-bold">批核碼 / 卡尾</th>
                        <th className="px-2 py-1 font-bold">參考編號</th>
                        <th className="px-2 py-1 font-bold">職員</th>
                        <th className="px-2 py-1 font-bold">備註</th>
                      </tr>
                    </thead>
                    <tbody>
                      {typedRows.map((r, i) => (
                        <tr key={`${r.invoiceNo}-${r.paidTime}-${i}`} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                          <td className={`${reportCell} font-mono`}>{r.businessDate}</td>
                          <td className={`${reportCell} font-mono`}>{r.paidTime}</td>
                          <td className={`${reportCell} font-mono font-semibold`}>{r.invoiceNo}</td>
                          <td className={reportCell}>{r.customerName}</td>
                          <td className={reportCell}>
                            {r.tenderNameZh} ({r.tenderCode})
                          </td>
                          <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.amountHkd)}</td>
                          <td className={`${reportCell} font-mono`}>
                            {[r.approvalCode, r.cardLast4 ? `****${r.cardLast4}` : ""].filter(Boolean).join(" / ") || "-"}
                          </td>
                          <td className={`${reportCell} font-mono`}>{r.referenceNo || "-"}</td>
                          <td className={reportCell}>{r.staffName}</td>
                          <td className={reportCell}>{r.remarks}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={reportTotalRow}>
                        <td className={reportCell} colSpan={5}>
                          收款明細總計 ({tot.count} 筆)
                        </td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.amountHkd)}</td>
                        <td className={reportCell} colSpan={4} />
                      </tr>
                    </tfoot>
                  </table>

                  {openInvs.length > 0 ? (
                    <div className="border border-[#7f9db9]">
                      <div className="border-b border-[#7f9db9] bg-[#e8eef5] px-2 py-1 text-[12px] font-bold">
                        尚欠餘額發票清單 (前 {openInvs.length} 張)
                      </div>
                      <table className={reportTable}>
                        <thead>
                          <tr className="bg-[#f4f7fa]">
                            <th className="px-2 py-1 font-bold">發票號碼</th>
                            <th className="px-2 py-1 font-bold">開票日期</th>
                            <th className="px-2 py-1 font-bold">客戶</th>
                            <th className="px-2 py-1 text-right font-bold">帳齡(日)</th>
                            <th className="px-2 py-1 text-right font-bold">發票額</th>
                            <th className="px-2 py-1 text-right font-bold">已付</th>
                            <th className="px-2 py-1 text-right font-bold">未收餘額</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openInvs.map((inv, idx) => (
                            <tr key={inv.invoiceNo} className={idx % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                              <td className={`${reportCell} font-mono font-semibold`}>{inv.invoiceNo}</td>
                              <td className={`${reportCell} font-mono`}>{inv.businessDate}</td>
                              <td className={reportCell}>{inv.customerName}</td>
                              <td className={`${reportCell} text-right font-mono`}>{inv.ageDays}</td>
                              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(inv.netHkd)}</td>
                              <td className={`${reportCell} text-right font-mono`}>{fmtAmt(inv.paidHkd)}</td>
                              <td className={`${reportCell} text-right font-mono font-bold text-[#c00000]`}>
                                {fmtAmt(inv.balanceDueHkd)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              );
            })()
          )}
        </ReportPaper>
      </div>
    </div>
  );
}

export function OtherTxnReportView({ shopLabel = "Central(1)" }: { shopLabel?: string }) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [subView, setSubView] = useState<"headers" | "lines" | "stocktake">("headers");
  const [docType, setDocType] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (fromDate > toDate) return;
    setData(null);
    const sp = new URLSearchParams({ view: "office_tx", from: fromDate, to: toDate, subView });
    if (docType && subView !== "stocktake") sp.set("docType", docType);
    if (q.trim()) sp.set("q", q.trim());
    fetch(`/api/reports?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as Record<string, unknown> & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取其他交易及盤點報表");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取其他交易及盤點報表"));
  }, [fromDate, toDate, subView, docType, q, tick]);

  function exportCsv() {
    if (!data) return;
    if (subView === "headers") {
      const rows = (data.rows ?? []) as Array<{
        invoiceNo: string;
        docType: string;
        docTypeLabel: string;
        legacyXc: number;
        businessDate: string;
        issuedTime: string;
        supplierCode: string;
        counterparty: string;
        staffName: string;
        totalAmountHkd: number;
        status: string;
        notes: string;
      }>;
      downloadCsvFile(`office-headers-${fromDate}-${toDate}.csv`, [
        ["單號", "XC", "交易類型", "營業日期", "時間", "交易對方/供應商", "職員", "共銀", "狀況", "備註"],
        ...rows.map((r) => [
          r.invoiceNo,
          r.legacyXc,
          `${r.docTypeLabel} (${r.docType})`,
          r.businessDate,
          r.issuedTime,
          r.counterparty,
          r.staffName,
          r.totalAmountHkd.toFixed(2),
          r.status,
          r.notes,
        ]),
      ]);
      return;
    }
    if (subView === "lines") {
      const rows = (data.rows ?? []) as Array<{
        businessDate: string;
        invoiceNo: string;
        docType: string;
        legacyXc: number;
        lineNo: number;
        sku: string;
        nameZh: string;
        quantity: number;
        unitPriceHkd: number;
        lineTotalHkd: number;
        counterparty: string;
        staffName: string;
        notes: string;
      }>;
      downloadCsvFile(`office-lines-${fromDate}-${toDate}.csv`, [
        ["日期", "單號", "XC", "項", "貨碼", "貨名", "數量", "單價", "共銀", "交易對方", "職員", "備註"],
        ...rows.map((r) => [
          r.businessDate,
          r.invoiceNo,
          r.legacyXc,
          r.lineNo,
          r.sku,
          r.nameZh,
          r.quantity,
          r.unitPriceHkd.toFixed(2),
          r.lineTotalHkd.toFixed(2),
          r.counterparty,
          r.staffName,
          r.notes,
        ]),
      ]);
      return;
    }
    const rows = (data.rows ?? []) as Array<{
      stockTakeId: number;
      snapshotDateIso: string;
      staffName: string;
      sku: string;
      ubc: string;
      productName: string;
      expectedQty: number;
      countedQty: number;
      diffQty: number;
      varianceValHkd: number;
    }>;
    downloadCsvFile(`stocktake-list-${fromDate}-${toDate}.csv`, [
      ["盤點單ID", "時間", "職員", "編碼(BC)", "貨碼(UBC)", "貨品名稱", "存貨量", "點實量", "相差數", "差異金額"],
      ...rows.map((r) => [
        r.stockTakeId,
        r.snapshotDateIso,
        r.staffName,
        r.sku,
        r.ubc,
        r.productName,
        r.expectedQty,
        r.countedQty,
        r.diffQty,
        r.varianceValHkd.toFixed(2),
      ]),
    ]);
  }

  const rows = ((data?.rows ?? []) as unknown[]) || [];

  return (
    <div className="flex h-full flex-col">
      <div className="print-hide flex flex-wrap items-center gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-2 text-[12px]">
        <div className="flex gap-1">
          {(
            [
              ["headers", "其他交易單頭 (OfficeXHeader)"],
              ["lines", "其他交易明細 (OfficeXDetail)"],
              ["stocktake", "盤點結果表 (fmstocktakelist)"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubView(id)}
              className={`border border-[#7f9db9] px-2.5 py-1 ${
                subView === id ? "bg-[#316ac5] font-bold text-white" : "bg-white text-black hover:bg-[#e5e1d5]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          由
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        <label>
          至
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        {subView !== "stocktake" ? (
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className={reportInput}>
            <option value="">全部非零售交易</option>
            <option value="GOODS_RECEIPT">XC=1 到貨 (GRC)</option>
            <option value="PURCHASE_RETURN">XC=4 退貨確認 (PRC)</option>
            <option value="WRITE_OFF">XC=10 報銷 (WOF)</option>
            <option value="PETTY_PAYOUT">XC=12 Payout (PAY)</option>
            <option value="STOCK_TRANSFER_OUT">XC=13 轉出 (TRF)</option>
            <option value="STOCK_TRANSFER_IN">XC=14 轉入 (TRI)</option>
            <option value="STOCK_ADJUSTMENT">XC=15 調整 (ADJ)</option>
            <option value="STOCKTAKE">XC=93 盤點單 (STK)</option>
          </select>
        ) : null}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜尋單號 / 條碼 / 供應商"
          className={`${reportInput} w-44`}
        />
        <div className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setTick((n) => n + 1)} className={reportBtn}>
            執行查詢
          </button>
          <button type="button" disabled={!data} onClick={exportCsv} className={reportBtn}>
            匯出 CSV
          </button>
          <button type="button" onClick={() => window.print()} className={reportBtn}>
            列印預覽
          </button>
        </div>
      </div>
      {error ? <div className="print-hide bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 053：{error}</div> : null}
      <div className="legacy-report-scroll min-h-0 flex-1 overflow-auto bg-white">
        <ReportPaper
          reportTitle="每日其他交易(非零售)及盤點結果報表"
          legacyCode="OfficeXHeader / OfficeXDetail / fmstocktakelist"
          subtitle={`期間: ${fromDate} 至 ${toDate}`}
          shopLabel={shopLabel}
          recordCount={rows.length}
        >
          {!data ? (
            <div className="p-6 text-center text-[12px]">讀取中…</div>
          ) : subView === "headers" ? (
            (() => {
              const typedRows = rows as Array<{
                invoiceNo: string;
                docType: string;
                docTypeLabel: string;
                legacyXc: number;
                businessDate: string;
                issuedTime: string;
                counterparty: string;
                staffName: string;
                totalAmountHkd: number;
                status: string;
                notes: string;
              }>;
              const tot = data.totals as { count: number; totalAmountHkd: number };
              return (
                <table className={reportTable}>
                  <thead className="sticky top-0 z-10">
                    <tr className={reportHeader}>
                      <th className="px-2 py-1 font-bold">交易 XC</th>
                      <th className="px-2 py-1 font-bold">單號 (BN)</th>
                      <th className="px-2 py-1 font-bold">營業日期</th>
                      <th className="px-2 py-1 font-bold">時間</th>
                      <th className="px-2 py-1 font-bold">交易對方 / 供應商</th>
                      <th className="px-2 py-1 font-bold">職員</th>
                      <th className="px-2 py-1 text-right font-bold">共銀</th>
                      <th className="px-2 py-1 font-bold">狀況</th>
                      <th className="px-2 py-1 font-bold">備註</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typedRows.map((r, i) => (
                      <tr key={r.invoiceNo} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                        <td className={reportCell}>
                          XC={r.legacyXc} · {r.docTypeLabel}
                        </td>
                        <td className={`${reportCell} font-mono font-semibold`}>{r.invoiceNo}</td>
                        <td className={`${reportCell} font-mono`}>{r.businessDate}</td>
                        <td className={`${reportCell} font-mono`}>{r.issuedTime}</td>
                        <td className={reportCell}>{r.counterparty}</td>
                        <td className={reportCell}>{r.staffName}</td>
                        <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.totalAmountHkd)}</td>
                        <td className={reportCell}>{r.status === "cancelled" ? "已取消" : r.status}</td>
                        <td className={`${reportCell} max-w-md truncate`}>{r.notes}</td>
                      </tr>
                    ))}
                    {typedRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-[#666]">
                          此期間暫無其他交易紀錄
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr className={reportTotalRow}>
                      <td className={reportCell} colSpan={6}>
                        總計 · 有效單 {tot.count} 筆
                      </td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.totalAmountHkd)}</td>
                      <td className={reportCell} colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              );
            })()
          ) : subView === "lines" ? (
            (() => {
              const typedRows = rows as Array<{
                businessDate: string;
                invoiceNo: string;
                docType: string;
                legacyXc: number;
                lineNo: number;
                sku: string;
                nameZh: string;
                quantity: number;
                unitPriceHkd: number;
                lineTotalHkd: number;
                counterparty: string;
                staffName: string;
                status: string;
                notes: string;
              }>;
              const tot = data.totals as { count: number; quantity: number; lineTotalHkd: number };
              return (
                <table className={reportTable}>
                  <thead className="sticky top-0 z-10">
                    <tr className={reportHeader}>
                      <th className="px-2 py-1 font-bold">日期</th>
                      <th className="px-2 py-1 font-bold">XC</th>
                      <th className="px-2 py-1 font-bold">單號 BN</th>
                      <th className="px-2 py-1 text-right font-bold">項 DK</th>
                      <th className="px-2 py-1 font-bold">編碼 BC</th>
                      <th className="px-2 py-1 font-bold">貨名</th>
                      <th className="px-2 py-1 text-right font-bold">貨量 QU</th>
                      <th className="px-2 py-1 text-right font-bold">單價 UP</th>
                      <th className="px-2 py-1 text-right font-bold">共銀 TASD</th>
                      <th className="px-2 py-1 font-bold">交易對方</th>
                      <th className="px-2 py-1 font-bold">職員</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typedRows.map((r, i) => (
                      <tr key={`${r.invoiceNo}-${r.lineNo}-${i}`} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                        <td className={`${reportCell} font-mono`}>{r.businessDate}</td>
                        <td className={`${reportCell} font-mono`}>XC={r.legacyXc}</td>
                        <td className={`${reportCell} font-mono`}>{r.invoiceNo}</td>
                        <td className={`${reportCell} text-right font-mono`}>{r.lineNo}</td>
                        <td className={`${reportCell} font-mono`}>{r.sku}</td>
                        <td className={reportCell}>{r.nameZh}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.quantity)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.unitPriceHkd)}</td>
                        <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.lineTotalHkd)}</td>
                        <td className={reportCell}>{r.counterparty}</td>
                        <td className={reportCell}>{r.staffName}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={reportTotalRow}>
                      <td className={reportCell} colSpan={6}>
                        總計 · {tot.count} 項
                      </td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtQty(tot.quantity)}</td>
                      <td className={reportCell} />
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.lineTotalHkd)}</td>
                      <td className={reportCell} colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              );
            })()
          ) : (
            (() => {
              const typedRows = rows as Array<{
                stockTakeId: number;
                snapshotDateIso: string;
                staffName: string;
                sku: string;
                ubc: string;
                productName: string;
                expectedQty: number;
                countedQty: number;
                diffQty: number;
                varianceValHkd: number;
              }>;
              const tot = data.totals as {
                count: number;
                expectedQty: number;
                countedQty: number;
                diffQty: number;
                varianceValHkd: number;
              };
              return (
                <table className={reportTable}>
                  <thead className="sticky top-0 z-10">
                    <tr className={reportHeader}>
                      <th className="px-2 py-1 font-bold">盤點單#</th>
                      <th className="px-2 py-1 font-bold">快照時間 (HKT)</th>
                      <th className="px-2 py-1 font-bold">職員</th>
                      <th className="px-2 py-1 font-bold">編碼 (Bcode)</th>
                      <th className="px-2 py-1 font-bold">貨碼 (UBC)</th>
                      <th className="px-2 py-1 font-bold">貨品名稱</th>
                      <th className="px-2 py-1 text-right font-bold">存貨量</th>
                      <th className="px-2 py-1 text-right font-bold">盤點量</th>
                      <th className="px-2 py-1 text-right font-bold">相差數</th>
                      <th className="px-2 py-1 text-right font-bold">差異金額(成本)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typedRows.map((r, i) => (
                      <tr key={`${r.stockTakeId}-${r.sku}-${i}`} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                        <td className={`${reportCell} font-mono`}>#{r.stockTakeId}</td>
                        <td className={`${reportCell} font-mono`}>
                          {new Intl.DateTimeFormat("sv-SE", {
                            timeZone: "Asia/Hong_Kong",
                            dateStyle: "short",
                            timeStyle: "medium",
                            hour12: false,
                          }).format(new Date(r.snapshotDateIso))}
                        </td>
                        <td className={reportCell}>{r.staffName}</td>
                        <td className={`${reportCell} font-mono`}>{r.sku}</td>
                        <td className={`${reportCell} font-mono`}>{r.ubc || "-"}</td>
                        <td className={reportCell}>{r.productName}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.expectedQty)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.countedQty)}</td>
                        <td
                          className={`${reportCell} text-right font-mono font-bold ${
                            r.diffQty !== 0 ? "text-[#c00000]" : ""
                          }`}
                        >
                          {fmtQty(r.diffQty)}
                        </td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.varianceValHkd)}</td>
                      </tr>
                    ))}
                    {typedRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="p-8 text-center text-[#666]">
                          此期間暫無盤點紀錄
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                  <tfoot>
                    <tr className={reportTotalRow}>
                      <td className={reportCell} colSpan={6}>
                        總計 · {tot.count} 項盤點紀錄
                      </td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtQty(tot.expectedQty)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtQty(tot.countedQty)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtQty(tot.diffQty)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(tot.varianceValHkd)}</td>
                    </tr>
                  </tfoot>
                </table>
              );
            })()
          )}
        </ReportPaper>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  currentBusinessDate,
  downloadCsvFile,
  fmtAmt,
  fmtPct,
  fmtQty,
  reportBtn,
  reportCell,
  reportHeader,
  reportInput,
  ReportPaper,
  ReportShell,
  reportSubTotalRow,
  reportTable,
  reportTotalRow,
} from "./ReportShell";

interface ItemRow {
  sku: string;
  ubc: string;
  nameZh: string;
  nameEn: string;
  categoryC1: number;
  categoryName: string;
  unitName: string;
  quantity: number;
  avgUnitPriceHkd: number;
  grossSalesHkd: number;
  discountHkd: number;
  netSalesHkd: number;
  avgCostUnitHkd: number;
  costAvHkd: number;
  marginAvHkd: number;
  marginAvPct: number;
  onHandQty: number;
  salesShare: number;
}

interface ItemData {
  businessDate: string;
  toDate: string;
  totalQty: number;
  totalGrossHkd: number;
  totalDiscountHkd: number;
  totalSalesHkd: number;
  totalCostAvHkd: number;
  totalMarginAvHkd: number;
  totalMarginAvPct: number;
  items: ItemRow[];
}

export function ItemReportPanel({
  embedded = false,
  shopLabel = "Central(1)",
  categories = [],
  onClose,
}: {
  embedded?: boolean;
  shopLabel?: string;
  categories?: Array<{ legacyC1: number; nameZh: string; nameEn: string }>;
  onClose?: () => void;
}) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [categoryC1, setCategoryC1] = useState("");
  const [q, setQ] = useState("");
  const [groupByCat, setGroupByCat] = useState(true);
  const [data, setData] = useState<ItemData | null>(null);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (fromDate > toDate) return;
    setData(null);
    const sp = new URLSearchParams({ from: fromDate, to: toDate });
    if (categoryC1 !== "") sp.set("categoryC1", categoryC1);
    if (q.trim()) sp.set("q", q.trim());
    fetch(`/api/reports/items?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as ItemData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能產生項報");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能產生項報"));
  }, [fromDate, toDate, categoryC1, q, reloadTick]);

  const groupedSections = useMemo(() => {
    if (!data) return [];
    if (!groupByCat) {
      return [{ key: "ALL", title: "", items: data.items }];
    }
    const map = new Map<number, { key: string; title: string; items: ItemRow[] }>();
    for (const item of data.items) {
      const existing = map.get(item.categoryC1) ?? {
        key: String(item.categoryC1),
        title: `${item.categoryC1} · ${item.categoryName}`,
        items: [],
      };
      existing.items.push(item);
      map.set(item.categoryC1, existing);
    }
    return Array.from(map.values()).sort((a, b) => Number(a.key) - Number(b.key));
  }, [data, groupByCat]);

  function handleExportCsv() {
    if (!data) return;
    downloadCsvFile(`items-${data.businessDate}-${data.toDate}.csv`, [
      [
        "編碼(BC)",
        "貨碼(UBC)",
        "貨品名稱",
        "主分類(C1)",
        "分類名稱",
        "單位",
        "數量",
        "平均單價",
        "折前總額",
        "折扣額",
        "銷售金額",
        "平均成本額",
        "毛利(均)$",
        "毛利(均)%",
        "現存量",
        "佔比%",
      ],
      ...data.items.map((r) => [
        r.sku,
        r.ubc,
        r.nameZh || r.nameEn,
        r.categoryC1,
        r.categoryName,
        r.unitName,
        r.quantity,
        r.avgUnitPriceHkd.toFixed(2),
        r.grossSalesHkd.toFixed(2),
        r.discountHkd.toFixed(2),
        r.netSalesHkd.toFixed(2),
        r.costAvHkd.toFixed(2),
        r.marginAvHkd.toFixed(2),
        r.marginAvPct.toFixed(2),
        r.onHandQty,
        (r.salesShare * 100).toFixed(2),
      ]),
    ]);
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label>
        由
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className={`${reportInput} ml-1`}
        />
      </label>
      <label>
        至
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className={`${reportInput} ml-1`}
        />
      </label>
      <label>
        主分類
        <select
          value={categoryC1}
          onChange={(e) => setCategoryC1(e.target.value)}
          className={`${reportInput} ml-1`}
        >
          <option value="">全部分類</option>
          {categories.map((c) => (
            <option key={c.legacyC1} value={String(c.legacyC1)}>
              {c.legacyC1} - {c.nameZh || c.nameEn}
            </option>
          ))}
        </select>
      </label>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋條碼 / 貨碼 / 貨品"
        className={`${reportInput} w-44`}
      />
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={groupByCat}
          onChange={(e) => setGroupByCat(e.target.checked)}
        />
        按主分類小計
      </label>
    </div>
  );

  const body = data ? (
    <table className={reportTable}>
      <thead className="sticky top-0 z-10">
        <tr className={reportHeader}>
          <th className="px-2 py-1 font-bold">編碼 (BC)</th>
          <th className="px-2 py-1 font-bold">貨碼 (UBC)</th>
          <th className="px-2 py-1 font-bold">貨品名稱</th>
          <th className="px-2 py-1 font-bold">主分類</th>
          <th className="px-2 py-1 font-bold">單位</th>
          <th className="px-2 py-1 text-right font-bold">數量</th>
          <th className="px-2 py-1 text-right font-bold">平均單價</th>
          <th className="px-2 py-1 text-right font-bold">折前總額</th>
          <th className="px-2 py-1 text-right font-bold">項折總額</th>
          <th className="px-2 py-1 text-right font-bold">銷售金額</th>
          <th className="px-2 py-1 text-right font-bold">成本(均)$</th>
          <th className="px-2 py-1 text-right font-bold">毛利(均)$</th>
          <th className="px-2 py-1 text-right font-bold">毛利(均)%</th>
          <th className="px-2 py-1 text-right font-bold">現存量</th>
          <th className="px-2 py-1 text-right font-bold">佔比%</th>
        </tr>
      </thead>
      <tbody>
        {groupedSections.map((sec) => {
          const subQty = sec.items.reduce((s, r) => s + r.quantity, 0);
          const subGross = sec.items.reduce((s, r) => s + r.grossSalesHkd, 0);
          const subDisc = sec.items.reduce((s, r) => s + r.discountHkd, 0);
          const subNet = sec.items.reduce((s, r) => s + r.netSalesHkd, 0);
          const subCost = sec.items.reduce((s, r) => s + r.costAvHkd, 0);
          const subMargin = subNet - subCost;
          const subMarginPct = subNet !== 0 ? (subMargin / subNet) * 100 : 0;
          const subShare = data.totalSalesHkd !== 0 ? (subNet / data.totalSalesHkd) * 100 : 0;

          return [
            ...sec.items.map((row, index) => (
              <tr key={`${sec.key}-${row.sku}`} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                <td className={`${reportCell} font-mono`}>{row.sku}</td>
                <td className={`${reportCell} font-mono text-[#555]`}>{row.ubc || "-"}</td>
                <td className={reportCell}>{row.nameZh || row.nameEn}</td>
                <td className={reportCell}>{row.categoryName}</td>
                <td className={reportCell}>{row.unitName}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtQty(row.quantity)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.avgUnitPriceHkd)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.grossSalesHkd)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.discountHkd)}</td>
                <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(row.netSalesHkd)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.costAvHkd)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(row.marginAvHkd)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtPct(row.marginAvPct)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtQty(row.onHandQty)}</td>
                <td className={`${reportCell} text-right font-mono`}>{(row.salesShare * 100).toFixed(2)}%</td>
              </tr>
            )),
            groupByCat ? (
              <tr key={`sub-${sec.key}`} className={reportSubTotalRow}>
                <td className={reportCell} colSpan={5}>
                  小計 · {sec.title} ({sec.items.length} 項)
                </td>
                <td className={`${reportCell} text-right font-mono`}>{fmtQty(subQty)}</td>
                <td className={reportCell} />
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(subGross)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(subDisc)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(subNet)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(subCost)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtAmt(subMargin)}</td>
                <td className={`${reportCell} text-right font-mono`}>{fmtPct(subMarginPct)}</td>
                <td className={reportCell} />
                <td className={`${reportCell} text-right font-mono`}>{fmtPct(subShare)}</td>
              </tr>
            ) : null,
          ];
        })}
        {data.items.length === 0 ? (
          <tr>
            <td colSpan={15} className="p-8 text-center text-[#666]">
              此日期及條件下暫無項目銷售紀錄
            </td>
          </tr>
        ) : null}
      </tbody>
      <tfoot>
        <tr className={reportTotalRow}>
          <td className={reportCell} colSpan={5}>
            總計 · {data.items.length} 項
          </td>
          <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totalQty)}</td>
          <td className={reportCell} />
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalGrossHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalDiscountHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalSalesHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalCostAvHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totalMarginAvHkd)}</td>
          <td className={`${reportCell} text-right font-mono`}>{fmtPct(data.totalMarginAvPct)}</td>
          <td className={reportCell} />
          <td className={`${reportCell} text-right font-mono`}>{data.items.length > 0 ? "100.00%" : "0.00%"}</td>
        </tr>
      </tfoot>
    </table>
  ) : (
    <div className="p-6 text-center text-[12px]">讀取中…</div>
  );

  if (embedded) {
    return (
      <div className="flex h-full flex-col">
        <div className="print-hide flex flex-wrap items-center gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-2 text-[12px]">
          {controls}
          <div className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => setReloadTick((n) => n + 1)} className={reportBtn}>
              執行查詢
            </button>
            <button type="button" disabled={!data} onClick={handleExportCsv} className={reportBtn}>
              匯出 CSV
            </button>
            <button type="button" onClick={() => window.print()} className={reportBtn}>
              列印預覽
            </button>
          </div>
        </div>
        {error ? (
          <div className="print-hide bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 053：{error}</div>
        ) : null}
        <div className="legacy-report-scroll min-h-0 flex-1 overflow-auto bg-white">
          <ReportPaper
            reportTitle="每月 / 每日項目銷售統計報表 (項報)"
            legacyCode="listXDetail / fmAllStatCHsales"
            subtitle={`期間: ${fromDate} 至 ${toDate}`}
            shopLabel={shopLabel}
            recordCount={data?.items.length}
          >
            {body}
          </ReportPaper>
        </div>
      </div>
    );
  }

  return (
    <ReportShell
      title="項報"
      legacyCode="listXDetail / fmAllStatCHsales"
      subtitle={`期間: ${fromDate} 至 ${toDate}`}
      shopLabel={shopLabel}
      recordCount={data?.items.length}
      error={error}
      onClose={onClose}
      onRefresh={() => setReloadTick((n) => n + 1)}
      onExportCsv={data ? handleExportCsv : undefined}
      controls={controls}
    >
      {body}
    </ReportShell>
  );
}

export function ItemReport({ onClose }: { onClose: () => void }) {
  return <ItemReportPanel onClose={onClose} />;
}

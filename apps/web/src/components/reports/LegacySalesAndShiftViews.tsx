"use client";

import { useEffect, useState } from "react";
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
  reportSubTotalRow,
  reportTable,
  reportTotalRow,
} from "./ReportShell";

interface ShiftBatch {
  id: number;
  legacyBk: string | null;
  shopCode: string;
  legacySn: number;
  terminalMn: number;
  businessDate: string;
  batchNo: number;
  status: string;
  closed: boolean;
  closedAtIso: string | null;
  openingFloatHkd: number;
  billCount: number;
  issuedSalesHkd: number;
  collectedTotalHkd: number;
  payoutTotalHkd: number;
  unpaidArHkd: number;
  expectedCashHkd: number;
  nonCashExpectedHkd: number;
  countedTotalHkd: number;
  varianceTotalHkd: number;
  toBankHkd: number;
}

interface ShiftData {
  range: { fromDate: string; toDate: string };
  batches: ShiftBatch[];
  selectedBatch: ShiftBatch | null;
  detailTenders: Array<{
    tenderCode: string;
    tenderNameZh: string;
    legacyPm: number;
    txCount: number;
    expectedAmountHkd: number;
    countedAmountHkd: number;
    varianceAmountHkd: number;
  }>;
}

export function ShiftDayEndView({ shopLabel = "Central(1)" }: { shopLabel?: string }) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [focusBatchId, setFocusBatchId] = useState<number | undefined>(undefined);
  const [focusDate, setFocusDate] = useState<string | undefined>(undefined);
  const [data, setData] = useState<ShiftData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (fromDate > toDate) return;
    setData(null);
    const sp = new URLSearchParams({ view: "shift", from: fromDate, to: toDate });
    if (focusDate) sp.set("focusDate", focusDate);
    if (focusBatchId !== undefined) sp.set("focusBatchId", String(focusBatchId));
    fetch(`/api/reports?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as ShiftData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取交更及埋數報表");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取交更及埋數報表"));
  }, [fromDate, toDate, focusDate, focusBatchId, tick]);

  function exportCsv() {
    if (!data) return;
    downloadCsvFile(`shift-dayend-${fromDate}-${toDate}.csv`, [
      [
        "店舖",
        "機號",
        "營業日",
        "更碼",
        "狀態",
        "開機銀頭",
        "銷售單數",
        "開單營業額",
        "現金應收",
        "非現金應收",
        "支出Payout",
        "未收AR",
        "合計已收",
        "實點金額",
        "差額",
        "往銀行",
      ],
      ...data.batches.map((b) => [
        `${b.shopCode}(${b.legacySn})`,
        b.terminalMn,
        b.businessDate,
        b.batchNo,
        b.closed ? "已埋數" : "未埋數(OPEN)",
        b.openingFloatHkd.toFixed(2),
        b.billCount,
        b.issuedSalesHkd.toFixed(2),
        b.expectedCashHkd.toFixed(2),
        b.nonCashExpectedHkd.toFixed(2),
        b.payoutTotalHkd.toFixed(2),
        b.unpaidArHkd.toFixed(2),
        b.collectedTotalHkd.toFixed(2),
        b.countedTotalHkd.toFixed(2),
        b.varianceTotalHkd.toFixed(2),
        b.toBankHkd.toFixed(2),
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
        <span className="text-[11px] text-[#555]">（點選下方批次行可切換列印指定更份之數實明細表）</span>
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
          reportTitle="每日交更及埋數報表 (Daily Shift & Day-End Report)"
          legacyCode="fmshiftreport / batchheader / batchdetail"
          subtitle={`營業日期: ${fromDate} 至 ${toDate}`}
          shopLabel={shopLabel}
          recordCount={data?.batches.length}
        >
          {data ? (
            <div className="space-y-4 p-2">
              <table className={reportTable}>
                <thead className="sticky top-0 z-10">
                  <tr className={reportHeader}>
                    <th className="px-2 py-1 font-bold">店舖/機號</th>
                    <th className="px-2 py-1 font-bold">營業日</th>
                    <th className="px-2 py-1 text-right font-bold">更碼</th>
                    <th className="px-2 py-1 font-bold">狀態</th>
                    <th className="px-2 py-1 text-right font-bold">本更銀頭</th>
                    <th className="px-2 py-1 text-right font-bold">單數</th>
                    <th className="px-2 py-1 text-right font-bold">營業額</th>
                    <th className="px-2 py-1 text-right font-bold">現金數</th>
                    <th className="px-2 py-1 text-right font-bold">非現金數</th>
                    <th className="px-2 py-1 text-right font-bold">支出</th>
                    <th className="px-2 py-1 text-right font-bold">未收AR</th>
                    <th className="px-2 py-1 text-right font-bold">合計機數</th>
                    <th className="px-2 py-1 text-right font-bold">數實</th>
                    <th className="px-2 py-1 text-right font-bold">差額</th>
                    <th className="px-2 py-1 text-right font-bold">往銀行</th>
                  </tr>
                </thead>
                <tbody>
                  {data.batches.map((b, index) => {
                    const selected =
                      data.selectedBatch?.id === b.id && data.selectedBatch?.businessDate === b.businessDate;
                    return (
                      <tr
                        key={`${b.id}-${b.businessDate}-${b.batchNo}`}
                        onClick={() => {
                          setFocusBatchId(b.id);
                          setFocusDate(b.businessDate);
                        }}
                        className={`cursor-pointer ${
                          selected ? "bg-[#316ac5] text-white" : index % 2 ? "bg-[#f4f7fa]" : "bg-white"
                        }`}
                      >
                        <td className={`${reportCell} font-mono`}>
                          {b.shopCode}({b.legacySn})/M{b.terminalMn}
                        </td>
                        <td className={`${reportCell} font-mono`}>{b.businessDate}</td>
                        <td className={`${reportCell} text-right font-mono`}>#{b.batchNo}</td>
                        <td className={reportCell}>{b.closed ? "已埋數" : "未埋數(OPEN)"}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.openingFloatHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{b.billCount}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.issuedSalesHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.expectedCashHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.nonCashExpectedHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.payoutTotalHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.unpaidArHkd)}</td>
                        <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(b.collectedTotalHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.countedTotalHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.varianceTotalHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(b.toBankHkd)}</td>
                      </tr>
                    );
                  })}
                  {data.batches.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="p-6 text-center text-[#666]">
                        此期間暫無交更 / 日結批次紀錄
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className={reportTotalRow}>
                    <td className={reportCell} colSpan={5}>
                      總計 ({data.batches.length} 更/批次)
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {data.batches.reduce((s, r) => s + r.billCount, 0)}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.issuedSalesHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.expectedCashHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.nonCashExpectedHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.payoutTotalHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.unpaidArHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.collectedTotalHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.countedTotalHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.varianceTotalHkd, 0))}
                    </td>
                    <td className={`${reportCell} text-right font-mono`}>
                      {fmtAmt(data.batches.reduce((s, r) => s + r.toBankHkd, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {data.selectedBatch ? (
                <div className="border border-[#7f9db9] bg-[#fcfdff] p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between border-b border-[#aca899] pb-1 text-[12px] font-bold">
                    <span>
                      交更數實對帳單 · 營業日 {data.selectedBatch.businessDate} · 更碼 #{data.selectedBatch.batchNo} (
                      {data.selectedBatch.closed ? "已埋數封存" : "現行開放更份"})
                    </span>
                    <span className="font-mono font-normal">
                      開機銀頭: HK${fmtAmt(data.selectedBatch.openingFloatHkd)} · 埋數時間:{" "}
                      {data.selectedBatch.closedAtIso
                        ? new Intl.DateTimeFormat("sv-SE", {
                            timeZone: "Asia/Hong_Kong",
                            dateStyle: "short",
                            timeStyle: "medium",
                            hour12: false,
                          }).format(new Date(data.selectedBatch.closedAtIso))
                        : "未埋數"}
                    </span>
                  </div>
                  <table className={reportTable}>
                    <thead>
                      <tr className={reportHeader}>
                        <th className="px-2 py-1 font-bold">PM</th>
                        <th className="px-2 py-1 font-bold">付款方法代碼</th>
                        <th className="px-2 py-1 font-bold">付款方式名稱</th>
                        <th className="px-2 py-1 text-right font-bold">交易筆數</th>
                        <th className="px-2 py-1 text-right font-bold">系統機數</th>
                        <th className="px-2 py-1 text-right font-bold">實點數實</th>
                        <th className="px-2 py-1 text-right font-bold">差額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.detailTenders.map((t, i) => (
                        <tr key={t.tenderCode} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                          <td className={`${reportCell} font-mono`}>{t.legacyPm}</td>
                          <td className={`${reportCell} font-mono font-semibold`}>{t.tenderCode}</td>
                          <td className={reportCell}>{t.tenderNameZh}</td>
                          <td className={`${reportCell} text-right font-mono`}>{t.txCount}</td>
                          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(t.expectedAmountHkd)}</td>
                          <td className={`${reportCell} text-right font-mono`}>{fmtAmt(t.countedAmountHkd)}</td>
                          <td
                            className={`${reportCell} text-right font-mono ${
                              t.varianceAmountHkd !== 0 ? "font-bold text-[#c00000]" : ""
                            }`}
                          >
                            {fmtAmt(t.varianceAmountHkd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className={reportTotalRow}>
                        <td className={reportCell} colSpan={3}>
                          總計 (含現鈔應留櫃銀頭 + 本更現金應收 ={" "}
                          {fmtAmt(data.selectedBatch.openingFloatHkd + data.selectedBatch.expectedCashHkd)})
                        </td>
                        <td className={`${reportCell} text-right font-mono`}>
                          {data.detailTenders.reduce((s, r) => s + r.txCount, 0)}
                        </td>
                        <td className={`${reportCell} text-right font-mono`}>
                          {fmtAmt(data.detailTenders.reduce((s, r) => s + r.expectedAmountHkd, 0))}
                        </td>
                        <td className={`${reportCell} text-right font-mono`}>
                          {fmtAmt(data.detailTenders.reduce((s, r) => s + r.countedAmountHkd, 0))}
                        </td>
                        <td className={`${reportCell} text-right font-mono`}>
                          {fmtAmt(data.detailTenders.reduce((s, r) => s + r.varianceAmountHkd, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="mt-6 grid grid-cols-2 gap-12 px-4 pt-2 text-[12px]">
                    <div className="border-t border-black pt-1">收銀員簽署 (Cashier Signature)</div>
                    <div className="border-t border-black pt-1">店主管核實 (Supervisor Verification)</div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="p-6 text-center text-[12px]">讀取中…</div>
          )}
        </ReportPaper>
      </div>
    </div>
  );
}

interface AllStatRow {
  groupCode: string;
  groupName: string;
  periodLabel: string;
  billCount: number;
  quantity: number;
  grossHkd: number;
  discountHkd: number;
  netSalesHkd: number;
  costAvHkd: number;
  marginAvHkd: number;
  marginAvPct: number;
  sharePct: number;
}

interface AllStatData {
  range: { fromDate: string; toDate: string };
  groupBy: string;
  dateBucket: string;
  scope: string;
  rows: AllStatRow[];
  subTotals: AllStatRow[];
  totals: {
    billCount: number;
    quantity: number;
    grossHkd: number;
    discountHkd: number;
    netSalesHkd: number;
    costAvHkd: number;
    marginAvHkd: number;
    marginAvPct: number;
    sharePct: number;
  };
}

export function AllPurposeStatView({ shopLabel = "Central(1)" }: { shopLabel?: string }) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [groupBy, setGroupBy] = useState("category");
  const [dateBucket, setDateBucket] = useState("none");
  const [scope, setScope] = useState("all");
  const [data, setData] = useState<AllStatData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (fromDate > toDate) return;
    setData(null);
    const sp = new URLSearchParams({
      view: "allstat",
      from: fromDate,
      to: toDate,
      groupBy,
      dateBucket,
      scope,
    });
    fetch(`/api/reports?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as AllStatData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取萬用銷售統計");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取萬用銷售統計"));
  }, [fromDate, toDate, groupBy, dateBucket, scope, tick]);

  const subByGroup = new Map((data?.subTotals ?? []).map((s) => [s.groupCode, s]));

  function exportCsv() {
    if (!data) return;
    downloadCsvFile(`allstat-${groupBy}-${fromDate}-${toDate}.csv`, [
      ["組別編號", "組別名稱", "期間", "單數", "數量", "單折前額", "折扣額", "銷售值$", "成本(均)$", "毛利(均)$", "毛利(均)%", "佔比%"],
      ...data.rows.map((r) => [
        r.groupCode,
        r.groupName,
        r.periodLabel,
        r.billCount,
        r.quantity,
        r.grossHkd.toFixed(2),
        r.discountHkd.toFixed(2),
        r.netSalesHkd.toFixed(2),
        r.costAvHkd.toFixed(2),
        r.marginAvHkd.toFixed(2),
        r.marginAvPct.toFixed(2),
        r.sharePct.toFixed(2),
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
        <label>
          統計維度
          <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={`${reportInput} ml-1`}>
            <option value="category">主分類 (Cat1)</option>
            <option value="product">貨品 (Product)</option>
            <option value="customer">客戶 / 會員 (Customer)</option>
            <option value="staff">職員 (Staff)</option>
            <option value="supplier">供應商入退貨 (Supplier)</option>
            <option value="tender">付款方法 (PayMethod)</option>
            <option value="doctype">交易類型 (DocType/XC)</option>
          </select>
        </label>
        <label>
          時間分組
          <select value={dateBucket} onChange={(e) => setDateBucket(e.target.value)} className={`${reportInput} ml-1`}>
            <option value="none">不分期 (合計)</option>
            <option value="day">按日 (ByDay)</option>
            <option value="month">按月 (ByMonth)</option>
            <option value="year">按年 (ByYear)</option>
          </select>
        </label>
        <label>
          統計範圍
          <select value={scope} onChange={(e) => setScope(e.target.value)} className={`${reportInput} ml-1`}>
            <option value="all">全部銷售及發票</option>
            <option value="retail">僅門市零售 (POS)</option>
            <option value="invoice">僅正式發票 (Invoice)</option>
          </select>
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
          reportTitle="萬用統計報表 / 銷售分析 (All Purpose Statistics)"
          legacyCode="fmAllStat / BOS 10406"
          subtitle={`期間: ${fromDate} 至 ${toDate}`}
          shopLabel={shopLabel}
          recordCount={data?.rows.length}
        >
          {data ? (
            <table className={reportTable}>
              <thead className="sticky top-0 z-10">
                <tr className={reportHeader}>
                  <th className="px-2 py-1 font-bold">組別編號</th>
                  <th className="px-2 py-1 font-bold">組別名稱</th>
                  <th className="px-2 py-1 font-bold">期間</th>
                  <th className="px-2 py-1 text-right font-bold">單數</th>
                  <th className="px-2 py-1 text-right font-bold">數量</th>
                  <th className="px-2 py-1 text-right font-bold">單折前額</th>
                  <th className="px-2 py-1 text-right font-bold">折扣額</th>
                  <th className="px-2 py-1 text-right font-bold">銷售值$</th>
                  <th className="px-2 py-1 text-right font-bold">成本(均)$</th>
                  <th className="px-2 py-1 text-right font-bold">毛利(均)$</th>
                  <th className="px-2 py-1 text-right font-bold">毛利(均)%</th>
                  <th className="px-2 py-1 text-right font-bold">佔比%</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, index) => {
                  const nextRow = data.rows[index + 1];
                  const isEndOfGroup =
                    dateBucket !== "none" && (!nextRow || nextRow.groupCode !== r.groupCode);
                  const sub = isEndOfGroup ? subByGroup.get(r.groupCode) : undefined;
                  return [
                    <tr key={`${r.groupCode}-${r.periodLabel}-${index}`} className={index % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                      <td className={`${reportCell} font-mono`}>{r.groupCode}</td>
                      <td className={reportCell}>{r.groupName}</td>
                      <td className={`${reportCell} font-mono`}>{r.periodLabel}</td>
                      <td className={`${reportCell} text-right font-mono`}>{r.billCount}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.quantity)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.grossHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.discountHkd)}</td>
                      <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.netSalesHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.costAvHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.marginAvHkd)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtPct(r.marginAvPct)}</td>
                      <td className={`${reportCell} text-right font-mono`}>{fmtPct(r.sharePct)}</td>
                    </tr>,
                    sub ? (
                      <tr key={`sub-${r.groupCode}`} className={reportSubTotalRow}>
                        <td className={reportCell} colSpan={3}>
                          小計 · {sub.groupCode} {sub.groupName}
                        </td>
                        <td className={`${reportCell} text-right font-mono`}>{sub.billCount}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtQty(sub.quantity)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(sub.grossHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(sub.discountHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(sub.netSalesHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(sub.costAvHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtAmt(sub.marginAvHkd)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtPct(sub.marginAvPct)}</td>
                        <td className={`${reportCell} text-right font-mono`}>{fmtPct(sub.sharePct)}</td>
                      </tr>
                    ) : null,
                  ];
                })}
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-[#666]">
                      此期間及篩選條件下暫無統計數據
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className={reportTotalRow}>
                  <td className={reportCell} colSpan={3}>
                    總計 · {data.rows.length} 列
                  </td>
                  <td className={`${reportCell} text-right font-mono`}>{data.totals.billCount}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.quantity)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.grossHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.discountHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.netSalesHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.costAvHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.marginAvHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtPct(data.totals.marginAvPct)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtPct(data.totals.sharePct)}</td>
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

interface BosCostData {
  range: { fromDate: string; toDate: string };
  dmy: "day" | "month" | "year";
  options: { showShop: boolean; showCategory: boolean; showUbc: boolean };
  rows: Array<{
    periodLabel: string;
    shopLabel: string;
    categoryC1: number | null;
    categoryName: string;
    sku: string;
    ubc: string;
    productName: string;
    salesQty: number;
    salesRspHkd: number;
    discountHkd: number;
    salesNetHkd: number;
    costAvHkd: number;
    costAvRspPct: number;
    profitAvNetHkd: number;
    profitAvNetPct: number;
    profitAvRspPct: number;
  }>;
  totals: {
    salesQty: number;
    salesRspHkd: number;
    discountHkd: number;
    salesNetHkd: number;
    costAvHkd: number;
    costAvRspPct: number;
    profitAvNetHkd: number;
    profitAvNetPct: number;
    profitAvRspPct: number;
  };
}

export function BosCostView({ shopLabel = "Central(1)" }: { shopLabel?: string }) {
  const today = currentBusinessDate();
  const [fromDate, setFromDate] = useState(`${today.slice(0, 8)}01`);
  const [toDate, setToDate] = useState(today);
  const [dmy, setDmy] = useState<"day" | "month" | "year">("month");
  const [showShop, setShowShop] = useState(true);
  const [showCategory, setShowCategory] = useState(true);
  const [showUbc, setShowUbc] = useState(false);
  const [data, setData] = useState<BosCostData | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (fromDate > toDate) return;
    setData(null);
    const sp = new URLSearchParams({
      view: "cost",
      from: fromDate,
      to: toDate,
      dmy,
      showShop: showShop ? "1" : "0",
      showCategory: showCategory ? "1" : "0",
      showUbc: showUbc ? "1" : "0",
    });
    fetch(`/api/reports?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as BosCostData & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "未能讀取成本報表");
        setData(body);
        setError("");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "未能讀取成本報表"));
  }, [fromDate, toDate, dmy, showShop, showCategory, showUbc, tick]);

  function exportCsv() {
    if (!data) return;
    downloadCsvFile(`bos-cost-10403-${fromDate}-${toDate}.csv`, [
      [
        "日期區間",
        "分店(SN)",
        "主分類(C1)",
        "條碼(BC)",
        "貨碼(UBC)",
        "貨品名稱",
        "銷售數量",
        "原價銷售額(SalesRSP)",
        "折扣額",
        "實收銷售額(SalesNet)",
        "平均成本(CostAV)",
        "成本率(CostAV%)",
        "平均毛利(ProfitAV)",
        "實收毛利率%",
        "原價毛利率(ProfitAV%)",
      ],
      ...data.rows.map((r) => [
        r.periodLabel,
        r.shopLabel,
        r.categoryC1 ?? "",
        r.sku,
        r.ubc,
        r.productName,
        r.salesQty,
        r.salesRspHkd.toFixed(2),
        r.discountHkd.toFixed(2),
        r.salesNetHkd.toFixed(2),
        r.costAvHkd.toFixed(2),
        r.costAvRspPct.toFixed(2),
        r.profitAvNetHkd.toFixed(2),
        r.profitAvNetPct.toFixed(2),
        r.profitAvRspPct.toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="print-hide flex flex-wrap items-center gap-3 border-b border-[#aca899] bg-[#f0f0f0] p-2 text-[12px]">
        <label>
          由
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        <label>
          至
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className={`${reportInput} ml-1`} />
        </label>
        <label>
          DMY 週期
          <select value={dmy} onChange={(e) => setDmy(e.target.value as "day" | "month" | "year")} className={`${reportInput} ml-1`}>
            <option value="day">按日 (Day)</option>
            <option value="month">按月 (Month)</option>
            <option value="year">按年 (Year)</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showShop} onChange={(e) => setShowShop(e.target.checked)} />
          顯示分店 (SN)
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showCategory} onChange={(e) => setShowCategory(e.target.checked)} />
          顯示主分類 (C1)
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={showUbc} onChange={(e) => setShowUbc(e.target.checked)} />
          顯示貨碼 (UBC)
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
          reportTitle="10403 成本及毛利報表 (BOS Cost & Profit Report)"
          legacyCode="clsCostSumRpt / uctCostReportList"
          subtitle={`期間: ${fromDate} 至 ${toDate}`}
          shopLabel={shopLabel}
          recordCount={data?.rows.length}
        >
          {data ? (
            <table className={reportTable}>
              <thead className="sticky top-0 z-10">
                <tr className={reportHeader}>
                  <th className="px-2 py-1 font-bold">日期區間</th>
                  {data.options.showShop ? <th className="px-2 py-1 font-bold">分店 (SN)</th> : null}
                  {data.options.showCategory ? <th className="px-2 py-1 font-bold">主分類 (C1)</th> : null}
                  {data.options.showUbc ? <th className="px-2 py-1 font-bold">條碼 / 貨碼 (UBC)</th> : null}
                  {data.options.showUbc ? <th className="px-2 py-1 font-bold">貨品名稱</th> : null}
                  <th className="px-2 py-1 text-right font-bold">銷售數量</th>
                  <th className="px-2 py-1 text-right font-bold">原價銷售額 SalesRSP</th>
                  <th className="px-2 py-1 text-right font-bold">折扣額</th>
                  <th className="px-2 py-1 text-right font-bold">實收銷售額 SalesNet</th>
                  <th className="px-2 py-1 text-right font-bold">平均成本 CostAV</th>
                  <th className="px-2 py-1 text-right font-bold">CostAV% (RSP)</th>
                  <th className="px-2 py-1 text-right font-bold">平均毛利 ProfitAV</th>
                  <th className="px-2 py-1 text-right font-bold">毛利率(實收)%</th>
                  <th className="px-2 py-1 text-right font-bold">ProfitAV% (RSP)</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.periodLabel}-${r.categoryC1}-${r.sku}-${i}`} className={i % 2 ? "bg-[#f4f7fa]" : "bg-white"}>
                    <td className={`${reportCell} font-mono font-semibold`}>{r.periodLabel}</td>
                    {data.options.showShop ? <td className={reportCell}>{r.shopLabel}</td> : null}
                    {data.options.showCategory ? (
                      <td className={reportCell}>
                        {r.categoryC1} · {r.categoryName}
                      </td>
                    ) : null}
                    {data.options.showUbc ? (
                      <td className={`${reportCell} font-mono`}>
                        {r.sku}
                        {r.ubc ? ` / ${r.ubc}` : ""}
                      </td>
                    ) : null}
                    {data.options.showUbc ? <td className={reportCell}>{r.productName}</td> : null}
                    <td className={`${reportCell} text-right font-mono`}>{fmtQty(r.salesQty)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.salesRspHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.discountHkd)}</td>
                    <td className={`${reportCell} text-right font-mono font-semibold`}>{fmtAmt(r.salesNetHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.costAvHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtPct(r.costAvRspPct)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtAmt(r.profitAvNetHkd)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtPct(r.profitAvNetPct)}</td>
                    <td className={`${reportCell} text-right font-mono`}>{fmtPct(r.profitAvRspPct)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="p-8 text-center text-[#666]">
                      此期間暫無成本及毛利數據
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className={reportTotalRow}>
                  <td
                    className={reportCell}
                    colSpan={
                      1 +
                      (data.options.showShop ? 1 : 0) +
                      (data.options.showCategory ? 1 : 0) +
                      (data.options.showUbc ? 2 : 0)
                    }
                  >
                    總計
                  </td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtQty(data.totals.salesQty)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.salesRspHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.discountHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.salesNetHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.costAvHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtPct(data.totals.costAvRspPct)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtAmt(data.totals.profitAvNetHkd)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtPct(data.totals.profitAvNetPct)}</td>
                  <td className={`${reportCell} text-right font-mono`}>{fmtPct(data.totals.profitAvRspPct)}</td>
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

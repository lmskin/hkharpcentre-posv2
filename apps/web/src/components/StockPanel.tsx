"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { AutoSuggestInput } from "@/components/AutoSuggestInput";
import { LegacyIcon } from "@/components/LegacyIcons";
import { downloadCsvFile } from "@/components/reports/ReportShell";

interface StockRow {
  productId: number;
  sku: string;
  ubc?: string;
  nameZh: string;
  nameEn: string;
  categoryC1: number;
  unitName?: string;
  color?: string;
  size?: string;
  supplierName?: string;
  sellPriceHkd: number;
  onHandQty: number;
  pendingDeliveryQty?: number;
  availableQty?: number;
  onOrderQty?: number;
  transferringQty?: number;
  lastSaleDate?: string | null;
  daysSinceLastSale?: number | null;
  lastPurchaseDate?: string | null;
  daysSinceLastPurchase?: number | null;
  movingAvgCostHkd: number;
  valuationHkd: number;
}

interface StockMovementRow {
  id: number;
  movementType: string;
  legacyXc: number | null;
  onHandDelta: number;
  unitCostHkd: number;
  movingAvgCostAfterHkd: number;
  invoiceNo: string | null;
  createdAtIso: string;
}

interface StockResponse {
  items: StockRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  elapsedSec?: number;
  error?: string;
}

const LEGACY_CATEGORIES: Array<[string, string]> = [
  ["0", "0 - CD"],
  ["1", "1 - BOW BRAND PEDAL GUT"],
  ["2", "2 - BOOK CODE"],
  ["3", "3 - HARP CODE"],
  ["4", "4 - OTHERS CODE"],
  ["5", "5 - OTHERS"],
  ["6", "6 - Burgundy"],
  ["7", "7 - Pedal Nylon"],
  ["8", "8 - Silkgut"],
  ["9", "9 - Lever Gut"],
  ["10", "10 - Lever Wire"],
  ["11", "11 - Pedal Wire"],
  ["12", "12 - SILKGUT COPPER"],
  ["13", "13 - Lesson"],
  ["14", "14 - BIO LEVER"],
  ["15", "15 - BIO PEDAL"],
  ["16", "16 - GUT GOLD"],
  ["17", "17 - BioNylon"],
  ["18", "18 - Sipario Silkgut"],
  ["20", "20 - SIPARIO PEDAL WIRE"],
  ["21", "21 - SIPARIO LEVER GUT"],
  ["22", "22 - SIPARIO LEVER WIRE"],
];

export function StockPanel({
  embedded = false,
  onClose,
}: {
  embedded?: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [matchMode, setMatchMode] = useState<"prefix" | "contains" | "suffix">("prefix");
  const [stockFilter, setStockFilter] = useState<"all" | "positive" | "negative" | "zero">("all");
  const [sortBy, setSortBy] = useState<"barcode" | "name" | "qty_desc" | "qty_asc">("barcode");
  const [showCost, setShowCost] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StockResponse>({ items: [], total: 0, page: 1, pageSize: 80, pageCount: 1, elapsedSec: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stocktakeMode, setStocktakeMode] = useState(false);
  const [countedMap, setCountedMap] = useState<Record<number, string>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<StockRow | null>(null);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [showTakeSheet, setShowTakeSheet] = useState(false);
  const [barcodeItem, setBarcodeItem] = useState<StockRow | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const sp = new URLSearchParams({
      view: "stock",
      q: query,
      matchMode,
      stockFilter,
      sortBy,
      page: String(page),
      pageSize: "80",
    });
    if (categoryFilter) sp.set("categoryC1", categoryFilter);
    fetch(`/api/catalog?${sp.toString()}`)
      .then(async (res) => {
        const body = (await res.json()) as StockResponse;
        if (!res.ok) throw new Error(body.error ?? "未能讀取存貨");
        if (active) {
          setData(body);
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "未能讀取存貨");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, categoryFilter, matchMode, stockFilter, sortBy, page, reloadTick]);

  async function openMovements(row: StockRow) {
    if (stocktakeMode) return;
    setSelectedProduct(row);
    setMovements([]);
    try {
      const res = await fetch(`/api/stock?productId=${row.productId}`);
      if (res.ok) {
        const body = (await res.json()) as { movements: StockMovementRow[] };
        setMovements(body.movements);
      }
    } catch {
      // ignore
    }
  }

  async function submitStocktake() {
    const lines = Object.entries(countedMap)
      .filter(([, raw]) => raw.trim() !== "" && Number.isFinite(Number(raw)))
      .map(([productIdStr, raw]) => ({
        productId: Number(productIdStr),
        quantityOrCount: Number(raw),
      }));
    if (lines.length === 0) {
      setStatusMsg("請先輸入至少一項盤點實數");
      return;
    }
    setBusy(true);
    setStatusMsg("");
    try {
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationType: "STOCKTAKE",
          remarks: "StockPanel 盤點 (XC=93)",
          lines,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? "盤點儲存失敗（需 L4+ 權限）");
      setCountedMap({});
      setStocktakeMode(false);
      setStatusMsg(`已完成 ${lines.length} 項盤點更新`);
      setReloadTick((t) => t + 1);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "盤點儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    downloadCsvFile("stock-balances.csv", [
      [
        "貨品",
        "貨碼",
        "條碼",
        "條碼名稱",
        "供應商",
        "單位",
        "本店存貨",
        "待送貨",
        "可用庫存",
        "最後銷售至",
        "最後銷售",
        "最後購貨至",
        "最後購貨",
        "平均成本",
        "貨值",
      ],
      ...data.items.map((item) => [
        item.nameZh || item.nameEn,
        item.ubc || item.sku,
        item.sku,
        item.nameEn || item.nameZh,
        item.supplierName ?? "",
        item.unitName ?? "",
        item.onHandQty,
        item.pendingDeliveryQty ?? 0,
        item.availableQty ?? item.onHandQty,
        item.daysSinceLastSale ?? "",
        item.lastSaleDate ?? "",
        item.daysSinceLastPurchase ?? "",
        item.lastPurchaseDate ?? "",
        item.movingAvgCostHkd.toFixed(2),
        item.valuationHkd.toFixed(2),
      ]),
    ]);
  }

  const content = (
    <div
      className="flex h-full min-h-0 flex-1 flex-col bg-[#f0f0f0] text-black"
      role="dialog"
      aria-modal={!embedded}
      aria-label="存貨"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.preventDefault();
        if (e.key === "F1") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      {/* Top Filter Area matching Screenshot 019 */}
      <div className="flex items-stretch gap-2 border-b border-[#aca899] bg-[#f0f0f0] p-1.5 text-[12px]">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {/* Row 1: Green 存貨 badge | barcode | ab.. | search | .../... | clear | category */}
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="min-w-[130px] border border-[#6ca36c] bg-[#a3f09b] px-4 py-1 text-center text-[14px] font-medium text-black">
              存貨
            </div>
            <LegacyIcon name="barcode" className="h-5 w-7" />
            <select
              aria-label="比對模式"
              value={matchMode}
              onChange={(e) => {
                setMatchMode(e.target.value as "prefix" | "contains" | "suffix");
                setPage(1);
              }}
              className="border border-[#aca899] bg-[#f0f0f0] px-1 py-0.5 text-[12px]"
            >
              <option value="prefix">ab..</option>
              <option value="contains">..ab..</option>
              <option value="suffix">..ab</option>
            </select>
            <div className="min-w-[200px] flex-1">
              <AutoSuggestInput
                theme="legacy"
                name="stockSearch"
                autoComplete="on"
                suggestKind="product"
                historyKey="stock_q"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="條碼 / UBC / 貨品名稱"
                className="w-full border border-[#7f9db9] bg-white px-2 py-0.5 text-[12px]"
              />
            </div>
            <button
              type="button"
              onClick={() => setReloadTick((t) => t + 1)}
              className="border border-[#aca899] bg-[#f0f0f0] px-2 py-0.5 text-[11px] hover:bg-[#e5e1d5]"
            >
              ../..
            </button>
            <button
              type="button"
              title="清除條件"
              onClick={() => {
                setQuery("");
                setCategoryFilter("");
                setStockFilter("all");
                setPage(1);
              }}
              className="border border-[#aca899] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] hover:bg-[#e5e1d5]"
            >
              🚫
            </button>
            <select
              aria-label="類別"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-40 border border-[#7f9db9] bg-white px-1 py-0.5 text-[11px]"
            >
              <option value="">全部類別</option>
              {LEGACY_CATEGORIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-[#333]">共 {data.total} 項</span>
          </div>

          {/* Row 2: 顯示／排序及搜尋 | 選項 - 更多資料 | 結果 */}
          <div className="flex flex-wrap items-stretch gap-2 text-[11px]">
            <fieldset className="border border-[#ccc] px-2 py-1">
              <legend className="px-1 text-[#444]">顯示／排序及搜尋</legend>
              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    ["all", "全部"],
                    ["positive", "有貨"],
                    ["negative", "負數"],
                    ["zero", "零存"],
                  ] as const
                ).map(([f, lbl]) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setStockFilter(f);
                      setPage(1);
                    }}
                    className={`border px-1.5 py-0.5 ${
                      stockFilter === f ? "border-[#316ac5] bg-[#d8e6f8] font-bold" : "border-[#aca899] bg-white"
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
                <button
                  type="button"
                  title="顯示/隱藏成本欄位"
                  onClick={() => setShowCost((v) => !v)}
                  className={`border px-1.5 py-0.5 ${
                    showCost ? "border-[#316ac5] bg-[#d8e6f8] font-bold" : "border-[#aca899] bg-white"
                  }`}
                >
                  成本
                </button>
              </div>
            </fieldset>

            <fieldset className="border border-[#ccc] px-2 py-1">
              <legend className="px-1 text-[#444]">選項 - 更多資料</legend>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  title="按存貨高至低"
                  onClick={() => setSortBy("qty_desc")}
                  className={`border px-1.5 py-0.5 ${sortBy === "qty_desc" ? "border-[#316ac5] bg-[#d8e6f8]" : "border-[#aca899] bg-white"}`}
                >
                  9→1
                </button>
                <button
                  type="button"
                  title="按存貨低至高"
                  onClick={() => setSortBy("qty_asc")}
                  className={`border px-1.5 py-0.5 ${sortBy === "qty_asc" ? "border-[#316ac5] bg-[#d8e6f8]" : "border-[#aca899] bg-white"}`}
                >
                  1→9
                </button>
                <button
                  type="button"
                  title="依條碼排序"
                  onClick={() => setSortBy("barcode")}
                  className={`border px-1.5 py-0.5 ${sortBy === "barcode" ? "border-[#316ac5] bg-[#d8e6f8]" : "border-[#aca899] bg-white"}`}
                >
                  條碼序
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  title="產生 Excel (CSV)"
                  className="flex items-center gap-1 border border-[#aca899] bg-white px-2 py-0.5 hover:bg-[#e5e1d5]"
                >
                  <LegacyIcon name="excel" className="h-3.5 w-3.5" />
                  <span>產生 Excel (CSV)</span>
                </button>
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="border border-[#7f9db9] bg-white px-2 py-0.5 disabled:opacity-40"
                >
                  上一頁
                </button>
                <span className="px-1 font-mono">
                  [{data.page}/{data.pageCount}]
                </span>
                <button
                  type="button"
                  disabled={page >= data.pageCount}
                  onClick={() => setPage((value) => Math.min(data.pageCount, value + 1))}
                  className="border border-[#7f9db9] bg-white px-2 py-0.5 disabled:opacity-40"
                >
                  下一頁
                </button>
              </div>
            </fieldset>

            <fieldset className="min-w-[155px] border border-[#ccc] px-2 py-1">
              <legend className="px-1 text-[#444]">結果</legend>
              <div className="grid grid-cols-[60px_1fr] gap-y-0.5 font-mono text-[11px]">
                <span className="font-sans">需時(s):</span>
                <span>{data.elapsedSec ?? 0.2}</span>
                <span className="font-sans">數據量:</span>
                <span>
                  {data.items.length}/17 (共 {data.total} 項)
                </span>
              </div>
            </fieldset>
          </div>
        </div>

        {/* Right GO! box */}
        <button
          type="button"
          onClick={() => setReloadTick((t) => t + 1)}
          aria-label="存貨 GO"
          className="flex w-20 shrink-0 flex-col items-center justify-center gap-1 border border-[#aca899] bg-[#f4f4f4] p-1 hover:bg-[#e5e1d5]"
        >
          <LegacyIcon name="stock" className="h-6 w-6" />
          <span className="text-[11px]">存貨</span>
          <span className="rounded bg-[#5cb85c] px-2.5 py-0.5 text-[11px] font-bold text-white shadow-xs">GO!</span>
        </button>
      </div>

      {/* Main Split: 17-column Grid + Right VMStock1 Rail */}
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-[#e6e6e6]">
          <table className="w-full border-collapse bg-white text-[12px] text-black">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f0f0f0] text-left">
                <th className="border border-[#808080] px-1.5 py-1 font-bold">貨品</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">貨碼</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">條碼</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">條碼名稱</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">顏色</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">尺碼</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">供應商</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">單位</th>
                <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">本店存貨</th>
                {stocktakeMode ? <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">實盤數</th> : null}
                <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">待送貨</th>
                <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">可用庫存</th>
                <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">訂貨中</th>
                <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">轉移中</th>
                <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">最後銷售至</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">最後銷售</th>
                <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">最後購貨至</th>
                <th className="border border-[#808080] px-1.5 py-1 font-bold">最後購貨</th>
                {showCost ? (
                  <>
                    <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">平均成本</th>
                    <th className="border border-[#808080] px-1.5 py-1 text-right font-bold">貨值</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr
                  key={item.productId}
                  onClick={() => void openMovements(item)}
                  className={`${stocktakeMode ? "" : "cursor-pointer hover:bg-[#e5f0ff]"} bg-white text-black`}
                >
                  <td className="max-w-[180px] truncate border border-[#b8b8b8] px-1.5 py-0.5">{item.nameZh || item.nameEn}</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 font-mono">{item.ubc || item.sku}</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 font-mono">{item.sku}</td>
                  <td className="max-w-[180px] truncate border border-[#b8b8b8] px-1.5 py-0.5">{item.nameEn || item.nameZh}</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5">{item.color ?? ""}</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5">{item.size ?? ""}</td>
                  <td className="max-w-[110px] truncate border border-[#b8b8b8] px-1.5 py-0.5">{item.supplierName ?? ""}</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5">{item.unitName || "(找不到)"}</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">{item.onHandQty}</td>
                  {stocktakeMode ? (
                    <td className="border border-[#b8b8b8] px-1 py-0.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={String(item.onHandQty)}
                        value={countedMap[item.productId] ?? ""}
                        onChange={(e) => setCountedMap((prev) => ({ ...prev, [item.productId]: e.target.value }))}
                        className="w-20 border border-[#7f9db9] bg-white px-1 py-0.5 text-right font-mono"
                      />
                    </td>
                  ) : null}
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">
                    {(item.pendingDeliveryQty ?? 0) !== 0 ? item.pendingDeliveryQty : "-"}
                  </td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">
                    {(item.availableQty ?? item.onHandQty) !== 0 ? item.availableQty ?? item.onHandQty : "-"}
                  </td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">-</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">-</td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">
                    {item.daysSinceLastSale ?? ""}
                  </td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 font-mono">
                    {item.lastSaleDate ? item.lastSaleDate.replace(/-/g, "/") : ""}
                  </td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">
                    {item.daysSinceLastPurchase ?? ""}
                  </td>
                  <td className="border border-[#b8b8b8] px-1.5 py-0.5 font-mono">
                    {item.lastPurchaseDate ? item.lastPurchaseDate.replace(/-/g, "/") : ""}
                  </td>
                  {showCost ? (
                    <>
                      <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">{formatHkd(item.movingAvgCostHkd)}</td>
                      <td className="border border-[#b8b8b8] px-1.5 py-0.5 text-right font-mono">{formatHkd(item.valuationHkd)}</td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="p-4 text-center text-[12px] text-black">讀取中…</div> : null}
          {!loading && data.items.length === 0 ? (
            <div className="p-8 text-center text-[12px] text-[#666]">沒有符合條件的貨品</div>
          ) : null}
        </div>

        {/* VMStock1 Right Vertical Rail matching Screenshot 019 */}
        <div className="flex w-[72px] shrink-0 flex-col border-l border-[#aca899] bg-[#f0f0f0] text-[11px] text-black">
          <div className="border-b border-[#aca899] bg-[#e6e4dc] py-0.5 text-center font-normal">存貨</div>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5]"
          >
            <LegacyIcon name="exit" className="h-5 w-5" />
            <span>離開</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStocktakeMode(false);
              setShowTakeSheet(false);
              setBarcodeItem(null);
            }}
            className={`flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5] ${
              !stocktakeMode ? "bg-[#fff8dc]" : ""
            }`}
          >
            <LegacyIcon name="stock" className="h-5 w-5" />
            <span>存貨</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setShowTakeSheet(true)}
            className="flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5] disabled:opacity-40"
          >
            <LegacyIcon name="info" className="h-5 w-5" />
            <span>預覽點存表</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStocktakeMode((v) => !v);
              setStatusMsg("");
            }}
            className={`flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5] ${
              stocktakeMode ? "bg-[#fff8dc] font-bold" : ""
            }`}
          >
            <LegacyIcon name="billQuery" className="h-5 w-5" />
            <span>輸入點存</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              const target = selectedProduct ?? data.items[0] ?? null;
              if (!target) {
                setStatusMsg("貨品資料載入中或暫無可列印項目");
                return;
              }
              setBarcodeItem(target);
            }}
            className="flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5] disabled:opacity-40"
          >
            <LegacyIcon name="barcode" className="h-4 w-6" />
            <span>列印條碼</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setReloadTick((t) => t + 1);
              setStatusMsg("營運通訊息 - 000：已完成重計即時存貨");
            }}
            className="flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5]"
          >
            <LegacyIcon name="cashier" className="h-5 w-5" />
            <span>重計存貨</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setStocktakeMode(true);
              setStatusMsg("大量點存模式已啟用 — 請輸入實盤數後按確認盤點");
            }}
            className="flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5]"
          >
            <LegacyIcon name="bdata" className="h-5 w-5" />
            <span>大量點存</span>
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="flex flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 hover:bg-[#e5e1d5]"
          >
            <LegacyIcon name="excel" className="h-5 w-5" />
            <span>產生 Excel</span>
          </button>
        </div>
      </div>

      {error ? <div className="bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 052：{error}</div> : null}
      {statusMsg ? <div className="bg-[#ffffe1] px-2 py-1 text-[12px] text-[#0a7a2f]">{statusMsg}</div> : null}
      {stocktakeMode ? (
        <div className="flex items-center gap-2 border-t border-[#aca899] bg-[#fff8dc] px-3 py-1.5 text-[12px]">
          <span>輸入點存模式 (XC=93)：請於表格「實盤數」輸入數量。</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submitStocktake()}
            className="ml-auto border border-[#7f9db9] bg-white px-5 py-1 font-bold text-black hover:bg-[#ffefb5]"
          >
            {busy ? "提交中…" : "確認盤點 (XC=93)"}
          </button>
        </div>
      ) : null}

      {showTakeSheet ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/20 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="預覽點存表"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div className="flex max-h-[85vh] w-[720px] flex-col border border-[#808080] bg-[#f0f0f0] text-[12px] text-black shadow-xl">
            <div className="border-b border-[#d4d0c8] px-3 py-1 font-bold">預覽點存表 (Take List)</div>
            <div className="flex-1 overflow-auto bg-white p-3">
              <div className="mb-2 flex justify-between border-b border-black pb-1 font-bold">
                <span>HONG KONG HARP CENTRE · 盤點表</span>
                <span>
                  共 {data.items.length} 項 (頁 {data.page})
                </span>
              </div>
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-black bg-[#e8eef5] text-left">
                    <th className="px-2 py-1">條碼</th>
                    <th className="px-2 py-1">貨品名稱</th>
                    <th className="px-2 py-1 text-right">現時存貨</th>
                    <th className="px-2 py-1 text-right">實點數量</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.slice(0, 50).map((it) => (
                    <tr key={it.productId} className="border-b border-[#e0e0e0]">
                      <td className="px-2 py-0.5 font-mono">{it.sku}</td>
                      <td className="px-2 py-0.5">{it.nameZh || it.nameEn}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{it.onHandQty}</td>
                      <td className="px-2 py-0.5 text-right font-mono">{countedMap[it.productId] || "_______"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d4d0c8] p-2">
              <button type="button" onClick={() => window.print()} className="border border-[#7f9db9] bg-[#f0f0f0] px-5 py-1">
                列印預覽
              </button>
              <button type="button" onClick={() => setShowTakeSheet(false)} className="border border-[#7f9db9] bg-[#e1dfff] px-5 py-1">
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {barcodeItem ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label="列印條碼"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div className="w-[360px] border border-[#808080] bg-[#f0f0f0] text-[12px] text-black shadow-xl">
            <div className="border-b border-[#d4d0c8] px-3 py-1 font-bold">列印條碼 (Barcode Label)</div>
            <div className="m-3 border border-black bg-white p-4 text-center">
              <div className="text-[11px] font-bold tracking-wider">HK HARP CENTRE</div>
              <div className="mt-1 truncate text-[12px] font-bold">{barcodeItem.nameZh || barcodeItem.nameEn}</div>
              <div className="mt-1 font-mono text-[14px] font-bold">{formatHkd(barcodeItem.sellPriceHkd)}</div>
              <div
                className="mx-auto mt-2 h-10 w-56"
                style={{
                  background: "repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px,#000 4px,#000 5px,#fff 5px,#fff 8px)",
                }}
              />
              <div className="mt-1 font-mono text-[11px] tracking-[0.2em]">{barcodeItem.sku}</div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d4d0c8] p-2">
              <button type="button" onClick={() => window.print()} className="border border-[#7f9db9] bg-[#f0f0f0] px-5 py-1">
                列印
              </button>
              <button type="button" onClick={() => setBarcodeItem(null)} className="border border-[#7f9db9] bg-[#e1dfff] px-5 py-1">
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedProduct ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label="存貨異動明細"
        >
          <div className="flex max-h-[80vh] w-[620px] flex-col border border-[#808080] bg-[#f0f0f0] text-[12px] text-black shadow-xl">
            <div className="border-b border-[#d4d0c8] px-3 py-1 font-bold">
              存貨異動明細 · {selectedProduct.sku} ({selectedProduct.nameZh || selectedProduct.nameEn})
            </div>
            <div className="min-h-[200px] flex-1 overflow-auto bg-white p-2">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#e8eef5] text-left">
                    <th className="px-2 py-1">時間</th>
                    <th className="px-2 py-1">類型</th>
                    <th className="px-2 py-1">單號</th>
                    <th className="px-2 py-1 text-right">異動數量</th>
                    <th className="px-2 py-1 text-right">平均成本</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id} className="border-b border-[#e0e0e0]">
                      <td className="px-2 py-1 font-mono">{m.createdAtIso.slice(0, 19).replace("T", " ")}</td>
                      <td className="px-2 py-1">{m.movementType}</td>
                      <td className="px-2 py-1 font-mono">{m.invoiceNo ?? "-"}</td>
                      <td className="px-2 py-1 text-right font-mono">{m.onHandDelta > 0 ? `+${m.onHandDelta}` : m.onHandDelta}</td>
                      <td className="px-2 py-1 text-right font-mono">{formatHkd(m.movingAvgCostAfterHkd)}</td>
                    </tr>
                  ))}
                  {movements.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-[#666]">
                        暫無異動記錄
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-[#d4d0c8] p-2">
              <button type="button" onClick={() => setSelectedProduct(null)} className="border border-[#7f9db9] bg-[#e1dfff] px-6 py-1">
                關閉
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return content;

  return <div className="absolute inset-0 z-20 flex flex-col bg-black/10 p-2">{content}</div>;
}

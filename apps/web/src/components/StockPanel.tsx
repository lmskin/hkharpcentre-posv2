"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { downloadCsvFile } from "@/components/reports/ReportShell";

interface StockRow {
  productId: number;
  sku: string;
  nameZh: string;
  nameEn: string;
  categoryC1: number;
  sellPriceHkd: number;
  onHandQty: number;
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
  error?: string;
}

export function StockPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<StockResponse>({ items: [], total: 0, page: 1, pageSize: 80, pageCount: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stocktakeMode, setStocktakeMode] = useState(false);
  const [countedMap, setCountedMap] = useState<Record<number, string>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<StockRow | null>(null);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const c1Param = categoryFilter ? `&categoryC1=${encodeURIComponent(categoryFilter)}` : "";
    fetch(`/api/catalog?view=stock&q=${encodeURIComponent(query)}${c1Param}&page=${page}&pageSize=80`)
      .then(async (res) => {
        const body = (await res.json()) as StockResponse;
        if (!res.ok) throw new Error(body.error ?? "未能讀取存貨");
        if (active) {
          setData(body);
          setError("");
        }
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "未能讀取存貨"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query, categoryFilter, page, reloadTick]);

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
      ["SKU", "NameZH", "NameEN", "CategoryC1", "SellPriceHKD", "OnHandQty", "AvgCostHKD", "ValuationHKD"],
      ...data.items.map((item) => [
        item.sku,
        item.nameZh,
        item.nameEn,
        item.categoryC1,
        item.sellPriceHkd.toFixed(2),
        item.onHandQty,
        item.movingAvgCostHkd.toFixed(2),
        item.valuationHkd.toFixed(2),
      ]),
    ]);
  }

  return (
    <div className="absolute inset-0 z-20 bg-black/10 p-3" role="dialog" aria-modal="true" aria-label="存貨">
      <div className="flex h-full flex-col border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
        <div className="flex items-center border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">
          <span>存貨</span>
          <span className="ml-auto font-normal">中央店即時存貨 · ProductOnSale / StockDetailBD</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#aca899] p-2 text-[12px] text-black">
          <label>
            貨品搜尋
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPage(1); }}
              className="ml-2 w-60 border border-[#7f9db9] bg-white px-2 py-1"
              placeholder="條碼 / UBC / 貨品名稱"
            />
          </label>
          <label>
            類別
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="ml-1 border border-[#7f9db9] bg-white px-2 py-1"
            >
              <option value="">全部</option>
              <option value="0">C1=0</option>
              <option value="1">C1=1 (樂譜/配件)</option>
              <option value="2">C1=2</option>
              <option value="3">C1=3 (豎琴)</option>
              <option value="4">C1=4</option>
              <option value="5">C1=5</option>
            </select>
          </label>
          <span>共 {data.total} 項</span>
          <button
            type="button"
            onClick={() => { setStocktakeMode((v) => !v); setStatusMsg(""); }}
            className={`border border-[#7f9db9] px-3 py-1 ${stocktakeMode ? "bg-[#316ac5] text-white" : "bg-[#f0f0f0] text-black"}`}
          >
            {stocktakeMode ? "退出盤點模式" : "盤點輸入 (XC=93)"}
          </button>
          <button type="button" onClick={exportCsv} className="border border-[#7f9db9] bg-[#f0f0f0] px-3 py-1">
            產生 Excel (CSV)
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="border border-[#7f9db9] bg-[#f0f0f0] px-3 py-1 disabled:opacity-40">上一頁</button>
            <span className="min-w-20 text-center font-mono">[{data.page}/{data.pageCount}]</span>
            <button type="button" disabled={page >= data.pageCount} onClick={() => setPage((value) => Math.min(data.pageCount, value + 1))} className="border border-[#7f9db9] bg-[#f0f0f0] px-3 py-1 disabled:opacity-40">下一頁</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#dfe7f0]">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0">
              <tr className="bg-[#e8eef5] text-left text-black">
                <th className="px-2 py-1 font-normal">條碼</th>
                <th className="px-2 py-1 font-normal">貨品</th>
                <th className="px-2 py-1 font-normal">類別</th>
                <th className="px-2 py-1 text-right font-normal">售價</th>
                <th className="px-2 py-1 text-right font-normal">存貨</th>
                {stocktakeMode ? <th className="px-2 py-1 text-right font-normal">實盤數</th> : null}
                <th className="px-2 py-1 text-right font-normal">平均成本</th>
                <th className="px-2 py-1 text-right font-normal">貨值</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, index) => (
                <tr
                  key={item.productId}
                  onClick={() => void openMovements(item)}
                  className={`${stocktakeMode ? "" : "cursor-pointer hover:bg-[#d0dff0]"} ${index % 2 ? "bg-[#e9eff6] text-black" : "bg-[#dfe7f0] text-black"}`}
                >
                  <td className="px-2 py-1 font-mono">{item.sku}</td>
                  <td className="px-2 py-1">{item.nameZh || item.nameEn}</td>
                  <td className="px-2 py-1">C1={item.categoryC1}</td>
                  <td className="px-2 py-1 text-right font-mono">{formatHkd(item.sellPriceHkd)}</td>
                  <td className="px-2 py-1 text-right font-mono">{item.onHandQty}</td>
                  {stocktakeMode ? (
                    <td className="px-2 py-0.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        step="0.01"
                        placeholder={String(item.onHandQty)}
                        value={countedMap[item.productId] ?? ""}
                        onChange={(e) => setCountedMap((prev) => ({ ...prev, [item.productId]: e.target.value }))}
                        className="w-24 border border-[#7f9db9] bg-white px-1 py-0.5 text-right font-mono"
                      />
                    </td>
                  ) : null}
                  <td className="px-2 py-1 text-right font-mono">{formatHkd(item.movingAvgCostHkd)}</td>
                  <td className="px-2 py-1 text-right font-mono">{formatHkd(item.valuationHkd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? <div className="p-4 text-center text-[12px] text-black">讀取中…</div> : null}
          {!loading && data.items.length === 0 ? <div className="p-8 text-center text-[12px] text-[#666]">沒有符合條件的貨品</div> : null}
        </div>
        {error ? <div className="bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 052：{error}</div> : null}
        {statusMsg ? <div className="bg-[#ffffe1] px-2 py-1 text-[12px] text-[#0a7a2f]">{statusMsg}</div> : null}
        <div className="flex items-center gap-2 border-t border-[#aca899] p-2 text-[11px] text-[#666]">
          <span>點擊貨品行可查閱倉存異動記錄；切換盤點模式可提交實盤更新。</span>
          {stocktakeMode ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitStocktake()}
              className="ml-auto border border-[#7f9db9] bg-[#fff8dc] px-5 py-1 text-[12px] text-black hover:bg-[#ffefb5]"
            >
              {busy ? "提交中…" : "確認盤點 (XC=93)"}
            </button>
          ) : null}
          <button type="button" autoFocus onClick={onClose} className={`${stocktakeMode ? "" : "ml-auto "}border border-[#7f9db9] bg-[#e1dfff] px-7 py-1 text-[12px] text-black`}>離開</button>
        </div>
      </div>

      {selectedProduct ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/20" role="dialog" aria-modal="true" aria-label="存貨異動明細">
          <div className="w-[620px] max-h-[80vh] flex flex-col border border-[#808080] bg-[#f0f0f0] shadow-xl text-[12px] text-black">
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
                    <tr><td colSpan={5} className="p-6 text-center text-[#666]">暫無異動記錄</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-[#d4d0c8] p-2">
              <button type="button" onClick={() => setSelectedProduct(null)} className="border border-[#7f9db9] bg-[#e1dfff] px-6 py-1">關閉</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

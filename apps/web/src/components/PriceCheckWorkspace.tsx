"use client";

import { useState } from "react";
import { formatHkd } from "@hkharp/domain/money";
import { AutoSuggestInput } from "@/components/AutoSuggestInput";
import type { PosProduct } from "@/components/PosRegisterClient";
import { LegacyIcon } from "@/components/LegacyIcons";

interface StockSnapshot {
  onHandQty: number;
  pendingDeliveryQty: number;
  availableQty: number;
}

export function PriceCheckWorkspace({
  entryBuffer,
  onEntryBufferChange,
  productQuery,
  onProductQueryChange,
  onSwitchToRetail,
  onOpenQuickPick,
  onAddItemToCart,
}: {
  entryBuffer: string;
  onEntryBufferChange: (v: string) => void;
  productQuery: string;
  onProductQueryChange: (v: string) => void;
  onSwitchToRetail: () => void;
  onOpenQuickPick: () => void;
  onAddItemToCart: (product: PosProduct) => void;
}) {
  const [checkedItem, setCheckedItem] = useState<PosProduct | null>(null);
  const [stockInfo, setStockInfo] = useState<StockSnapshot | null>(null);
  const [notFoundCode, setNotFoundCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [lang, setLang] = useState<"TC" | "EN">("TC");
  const [viewTab, setViewTab] = useState<"detail" | "receipt" | "history">("detail");

  async function lookupPrice(rawCode?: string) {
    const code = (rawCode ?? (entryBuffer.trim() || productQuery.trim())).trim();
    if (!code) return;
    setLoading(true);
    setNotFoundCode("");
    try {
      let found: PosProduct | null = null;
      const exactRes = await fetch(`/api/products?exactCode=${encodeURIComponent(code)}`);
      if (exactRes.ok) {
        const exactJson = (await exactRes.json()) as { item: PosProduct | null };
        found = exactJson.item;
      }
      if (!found) {
        const listRes = await fetch(`/api/products?q=${encodeURIComponent(code)}&page=1&pageSize=10`);
        if (listRes.ok) {
          const listJson = (await listRes.json()) as { items: PosProduct[] };
          found = listJson.items[0] ?? null;
        }
      }
      if (!found) {
        setCheckedItem(null);
        setStockInfo(null);
        setNotFoundCode(code);
        return;
      }
      setCheckedItem(found);
      const stRes = await fetch(`/api/catalog?view=stock&q=${encodeURIComponent(found.sku)}&page=1&pageSize=10`);
      if (stRes.ok) {
        const stJson = (await stRes.json()) as {
          items: Array<{ sku: string; onHandQty: number; pendingDeliveryQty?: number; availableQty?: number }>;
        };
        const match = stJson.items.find((i) => i.sku === found!.sku);
        if (match) {
          setStockInfo({
            onHandQty: match.onHandQty,
            pendingDeliveryQty: match.pendingDeliveryQty ?? 0,
            availableQty: match.availableQty ?? match.onHandQty,
          });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* Top search strip matching Screenshot 051 */}
      <div className="flex items-center gap-1 border-b border-[#d4d0c8] p-1">
        <AutoSuggestInput
          theme="legacy"
          name="priceCheckBarcode"
          autoComplete="on"
          suggestKind="product"
          minChars={2}
          historyKey="pos_barcode"
          value={entryBuffer}
          onChange={(e) => onEntryBufferChange(e.target.value)}
          onValueSelect={(val) => {
            onEntryBufferChange(val);
            void lookupPrice(val);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void lookupPrice(entryBuffer);
          }}
          placeholder="條碼"
          className="w-40 border border-[#aca899] bg-white px-1 py-1 text-[13px]"
        />
        <AutoSuggestInput
          theme="legacy"
          name="priceCheckQuery"
          autoComplete="on"
          suggestKind="product"
          historyKey="pos_prod_query"
          value={productQuery}
          onChange={(e) => onProductQueryChange(e.target.value)}
          onValueSelect={(val) => {
            onProductQueryChange(val);
            void lookupPrice(val);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void lookupPrice(productQuery);
          }}
          placeholder="貨品編號 / 名稱"
          className="min-w-0 flex-1 border border-[#aca899] bg-white px-1 py-1 text-[13px]"
        />
        <button
          type="button"
          onClick={onSwitchToRetail}
          title="切換零售 (Item1 / Item2)"
          className="flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] text-[8px] font-bold leading-none text-[#1e4873] hover:bg-[#e5e1d5]"
        >
          Item1<br />Item2
        </button>
        <button
          type="button"
          onClick={onOpenQuickPick}
          title="鍵盤 / 按鈕"
          className="flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] text-[13px] hover:bg-[#e5e1d5]"
        >
          ⌨️
        </button>
        <button
          type="button"
          onClick={() => void lookupPrice()}
          title="查價"
          aria-label="執行查價"
          className="flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
        >
          <LegacyIcon name="products" className="h-4 w-4" />
        </button>
      </div>

      {/* Mini status strip */}
      <div className="flex items-center border-b border-[#aca899] bg-[#f0f0f0] text-[11px] text-[#333]">
        <div className="flex w-40 items-center gap-1 border-r border-[#d4d0c8] px-1.5 py-0.5 font-mono">
          <LegacyIcon name="barcode" className="h-3.5 w-5" />
          <span className="truncate">{checkedItem?.sku ?? ""}</span>
        </div>
        <div className="flex w-28 items-center justify-between border-r border-[#d4d0c8] px-2 py-0.5 font-mono">
          <span>📦</span>
          <span>{checkedItem ? 1 : 0}</span>
        </div>
        <div className="flex-1 px-2 py-0.5 text-[#666]">
          {loading ? "查詢中…" : checkedItem ? `查價：${checkedItem.sku}` : ""}
        </div>
      </div>

      {/* White watermarked workspace + vertical side toolbar */}
      <div className="flex min-h-0 flex-1 bg-white">
        <div className="relative min-h-0 flex-1 overflow-auto bg-white">
          {/* Repeating diagonal eRun watermark matching Screenshot 051 */}
          <div
            data-testid="price-check-watermark"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.09]"
            style={{
              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
                `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='160'><g transform='rotate(-26 110 80)'><text x='40' y='85' font-family='Tahoma,sans-serif' font-size='38' font-weight='bold' fill='none' stroke='%23888' stroke-width='1.5'>eRun</text></g></svg>`,
              )}")`,
              backgroundRepeat: "repeat",
            }}
          />

          <div className="relative z-10 p-6">
            {notFoundCode ? (
              <div className="mx-auto max-w-md border border-[#c00000] bg-[#ffffe1] p-4 text-[13px] text-[#c00000]">
                營運通訊息 - 017：找不到條碼或貨碼「{notFoundCode}」
              </div>
            ) : checkedItem ? (
              <div className="mx-auto max-w-xl border border-[#7f9db9] bg-white/95 p-5 shadow-sm text-[13px] text-black">
                <div className="flex items-start justify-between border-b border-[#d4d0c8] pb-3">
                  <div>
                    <div className="text-[11px] font-bold text-[#2e7ec2]">查價結果 (Price Check · {viewTab})</div>
                    <div className="mt-1 text-[18px] font-bold">
                      {lang === "TC" ? checkedItem.nameZh || checkedItem.nameEn : checkedItem.nameEn || checkedItem.nameZh}
                    </div>
                    <div className="text-[12px] text-[#555]">
                      {lang === "TC" ? checkedItem.nameEn : checkedItem.nameZh}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-[#555]">標準售價</div>
                    <div className="font-mono text-[26px] font-bold text-[#1d3f72]">
                      {formatHkd(checkedItem.unitPriceHkd)}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
                  <div className="border border-[#e0e0e0] bg-[#f8fafc] px-3 py-1.5">
                    <span className="text-[#666]">條碼 (BC)：</span>
                    <span className="font-mono font-bold">{checkedItem.sku}</span>
                  </div>
                  <div className="border border-[#e0e0e0] bg-[#f8fafc] px-3 py-1.5">
                    <span className="text-[#666]">貨碼 (UBC)：</span>
                    <span className="font-mono font-bold">{checkedItem.ubc || "-"}</span>
                  </div>
                  <div className="border border-[#e0e0e0] bg-[#f8fafc] px-3 py-1.5">
                    <span className="text-[#666]">價格性質：</span>
                    <span className="font-bold">
                      {checkedItem.isFixedPrice ? "固定價 (不可折)" : checkedItem.allowItemDiscount === false ? "不設項折" : "可折扣"}
                    </span>
                  </div>
                  <div className="border border-[#e0e0e0] bg-[#f8fafc] px-3 py-1.5">
                    <span className="text-[#666]">分類 C1：</span>
                    <span className="font-mono">{checkedItem.categoryC1}</span>
                  </div>
                </div>

                {stockInfo ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 border border-[#aca899] bg-[#eef3fb] p-2.5 text-center text-[12px]">
                    <div>
                      <div className="text-[#555]">本店存貨</div>
                      <div className="font-mono text-[16px] font-bold">{stockInfo.onHandQty}</div>
                    </div>
                    <div>
                      <div className="text-[#555]">待送貨</div>
                      <div className="font-mono text-[16px] font-bold">{stockInfo.pendingDeliveryQty}</div>
                    </div>
                    <div>
                      <div className="text-[#555]">可用庫存</div>
                      <div className="font-mono text-[16px] font-bold text-[#0a7a2f]">{stockInfo.availableQty}</div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onAddItemToCart(checkedItem);
                      onSwitchToRetail();
                    }}
                    className="border border-[#316ac5] bg-[#316ac5] px-4 py-1 text-[12px] font-bold text-white hover:bg-[#2557a8]"
                  >
                    加入收銀單並返回零售
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCheckedItem(null);
                      setStockInfo(null);
                      setNotFoundCode("");
                      onEntryBufferChange("");
                      onProductQueryChange("");
                    }}
                    className="border border-[#aca899] bg-[#f0f0f0] px-4 py-1 text-[12px] text-black hover:bg-[#e5e1d5]"
                  >
                    清除
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Vertical narrow control strip matching Screen 051 */}
        <div className="flex w-9 flex-col items-center border-l border-[#aca899] bg-[#f0f0f0] py-1">
          <button
            type="button"
            title="貨品資料檢視"
            onClick={() => setViewTab("detail")}
            className={`mb-1 flex h-7 w-7 items-center justify-center border ${
              viewTab === "detail" ? "border-[#c00000] bg-white" : "border-[#aca899] bg-[#f0f0f0]"
            }`}
          >
            <LegacyIcon name="info" className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="售價明細"
            onClick={() => setViewTab("receipt")}
            className={`mb-1 flex h-7 w-7 items-center justify-center border ${
              viewTab === "receipt" ? "border-[#c00000] bg-white" : "border-[#aca899] bg-[#f0f0f0]"
            }`}
          >
            <LegacyIcon name="billQuery" className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="變動記錄"
            onClick={() => setViewTab("history")}
            className={`mb-1 flex h-7 w-7 items-center justify-center border ${
              viewTab === "history" ? "border-[#c00000] bg-white" : "border-[#aca899] bg-[#f0f0f0]"
            }`}
          >
            <LegacyIcon name="bdata" className="h-4 w-4" />
          </button>

          <button
            type="button"
            title="上移一行"
            onClick={() => void lookupPrice()}
            className="flex h-6 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] text-[10px] hover:bg-[#e5e1d5]"
          >
            ▲
          </button>
          <div className="my-1 flex-1 w-6 border border-[#d4d0c8] bg-[#e6e6e6]" aria-hidden="true" />
          <button
            type="button"
            title="下移一行"
            onClick={() => void lookupPrice()}
            className="mb-2 flex h-6 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] text-[10px] hover:bg-[#e5e1d5]"
          >
            ▼
          </button>

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
            title="列印查價"
            onClick={() => window.print()}
            className="mb-1 flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
          >
            <LegacyIcon name="print" className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="離開查價"
            onClick={onSwitchToRetail}
            className="flex h-7 w-7 items-center justify-center border border-[#aca899] bg-[#f0f0f0] hover:bg-[#e5e1d5]"
          >
            <LegacyIcon name="exit" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

type PrinterKey = "Printer101" | "Printer102" | "Printer103" | "Printer104";
type LegacyRowKey = "indv" | "all" | "cust" | "a4" | "dayend";

interface Printer {
  key: PrinterKey;
  name: string;
  qty: number;
  language: "TC" | "SC" | "ENG";
  enabled?: boolean;
}

interface LegacyGridRow {
  key: LegacyRowKey;
  p1Name: string;
  p1On: boolean;
  p2Name: string;
  p2On: boolean;
}

interface LegacySectionDetail {
  enabled: boolean;
  p1Qty: number;
  p2Qty: number;
  p3Qty: number;
  lang: "TC" | "ENG" | "BOTH";
  format?: "STANDARD" | "CUSTOM";
}

interface DetailSettings {
  indv: LegacySectionDetail;
  all: LegacySectionDetail;
  cust: LegacySectionDetail;
  deliveryEnabled: boolean;
  deliveryQty: number;
  deliveryPrintItems: boolean;
  deliveryPrintSignature: boolean;
  printSku: boolean;
  productNameMode: "FULL" | "SHORT";
  onlyNewItems: boolean;
  replaceAfterFirst: boolean;
  printPrice: boolean;
  printOnPickup: boolean;
  printOnComplete: boolean;
  firstTimeOnly: boolean;
  includeNonSales: boolean;
  printTempReceipt: boolean;
  printStocktakeResult: boolean;
  deliveryProductNameMode: "FULL" | "SHORT";
}

interface AdvancedSettings {
  hourlyLang: "TC" | "ENG";
  dayEndOptions: { normalHourly: boolean; simpleHourly: boolean; separatePaySlip: boolean };
  itemReportLang: "TC" | "ENG";
  itemProductNameMode: "FULL" | "SHORT";
  displayDateMode: "SALE_DATE" | "DELIVERY_DATE";
  rewriteCardLang: "TC" | "ENG";
  setDetailMode: "YES" | "NO" | "NEVER";
  printCashier: boolean;
  printPointsDetail: boolean;
  printBarcode: boolean;
  barcodePosition: "TOP" | "BOTTOM";
  setPricePosition: "SET_ITEM" | "DETAIL_ITEM";
  dayEndPrinterRoute: "FOLLOW_CUST" | "FOLLOW_A4" | "FOLLOW_DAYEND";
}

interface Config {
  onOff: boolean;
  printers: Printer[];
  splitMode: "indv" | "all";
  legacyGrid: LegacyGridRow[];
  detailSettings: DetailSettings;
  advancedSettings: AdvancedSettings;
}

const PRINTER_OPTIONS = [
  "(default)",
  "PDFCreator2",
  "PDFCreator",
  "EPSON TM-T88V Receipt",
  "Star TSP100 Cutter",
  "Zebra ZD220 Label",
  "Microsoft Print to PDF",
];

const ROW_LABELS: Record<LegacyRowKey, string> = {
  indv: "單項單印",
  all: "單項齊印",
  cust: "客人單",
  a4: "A4",
  dayend: "日結單",
};

const DEFAULT_CONFIG: Config = {
  onOff: true,
  splitMode: "all",
  printers: [
    { key: "Printer101", name: "(default)", qty: 1, language: "TC", enabled: false },
    { key: "Printer102", name: "PDFCreator2", qty: 1, language: "TC", enabled: true },
    { key: "Printer103", name: "PDFCreator2", qty: 1, language: "TC", enabled: true },
    { key: "Printer104", name: "PDFCreator", qty: 1, language: "TC", enabled: true },
  ],
  legacyGrid: [
    { key: "indv", p1Name: "(default)", p1On: false, p2Name: "(default)", p2On: false },
    { key: "all", p1Name: "(default)", p1On: false, p2Name: "(default)", p2On: false },
    { key: "cust", p1Name: "PDFCreator2", p1On: true, p2Name: "(default)", p2On: false },
    { key: "a4", p1Name: "PDFCreator2", p1On: true, p2Name: "(default)", p2On: false },
    { key: "dayend", p1Name: "PDFCreator", p1On: true, p2Name: "(default)", p2On: false },
  ],
  detailSettings: {
    indv: { enabled: true, p1Qty: 1, p2Qty: 0, p3Qty: 0, lang: "TC" },
    all: { enabled: true, p1Qty: 1, p2Qty: 0, p3Qty: 0, lang: "TC" },
    cust: { enabled: true, p1Qty: 1, p2Qty: 0, p3Qty: 0, lang: "TC", format: "STANDARD" },
    deliveryEnabled: true,
    deliveryQty: 1,
    deliveryPrintItems: true,
    deliveryPrintSignature: true,
    printSku: false,
    productNameMode: "SHORT",
    onlyNewItems: true,
    replaceAfterFirst: false,
    printPrice: false,
    printOnPickup: false,
    printOnComplete: false,
    firstTimeOnly: false,
    includeNonSales: false,
    printTempReceipt: true,
    printStocktakeResult: false,
    deliveryProductNameMode: "FULL",
  },
  advancedSettings: {
    hourlyLang: "TC",
    dayEndOptions: { normalHourly: true, simpleHourly: true, separatePaySlip: false },
    itemReportLang: "TC",
    itemProductNameMode: "FULL",
    displayDateMode: "DELIVERY_DATE",
    rewriteCardLang: "TC",
    setDetailMode: "YES",
    printCashier: false,
    printPointsDetail: false,
    printBarcode: true,
    barcodePosition: "BOTTOM",
    setPricePosition: "SET_ITEM",
    dayEndPrinterRoute: "FOLLOW_DAYEND",
  },
};

export function PrinterSetupDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"printers" | "details" | "advanced">("printers");
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings/printers")
      .then(async (res) => {
        const data = (await res.json()) as { config?: Partial<Config>; error?: string };
        if (!res.ok) throw new Error(data.error ?? "讀取印表機設定失敗");
        if (data.config) {
          setConfig({
            ...DEFAULT_CONFIG,
            ...data.config,
            printers: data.config.printers ?? DEFAULT_CONFIG.printers,
            legacyGrid: data.config.legacyGrid ?? DEFAULT_CONFIG.legacyGrid,
            detailSettings: { ...DEFAULT_CONFIG.detailSettings, ...(data.config.detailSettings ?? {}) },
            advancedSettings: { ...DEFAULT_CONFIG.advancedSettings, ...(data.config.advancedSettings ?? {}) },
          });
        }
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "讀取印表機設定失敗"))
      .finally(() => setLoading(false));
  }, []);

  function updateGridRow(rowKey: LegacyRowKey, patch: Partial<LegacyGridRow>) {
    setConfig((cur) => {
      const nextGrid = cur.legacyGrid.map((r) => (r.key === rowKey ? { ...r, ...patch } : r));
      const rowToPrinter: Record<LegacyRowKey, number> = { indv: 0, all: 0, cust: 2, a4: 1, dayend: 3 };
      const idx = rowToPrinter[rowKey];
      const nextPrinters = cur.printers.map((p, i) =>
        i === idx
          ? {
              ...p,
              name: patch.p1Name ?? p.name,
              enabled: patch.p1On !== undefined ? patch.p1On : p.enabled,
            }
          : p,
      );
      return {
        ...cur,
        onOff: nextGrid.some((g) => g.p1On || g.p2On),
        legacyGrid: nextGrid,
        printers: nextPrinters,
      };
    });
  }

  function updateSection(sec: "indv" | "all" | "cust", patch: Partial<LegacySectionDetail>) {
    setConfig((cur) => ({
      ...cur,
      detailSettings: {
        ...cur.detailSettings,
        [sec]: { ...cur.detailSettings[sec], ...patch },
      },
    }));
  }

  function updateDetails(patch: Partial<DetailSettings>) {
    setConfig((cur) => ({
      ...cur,
      detailSettings: { ...cur.detailSettings, ...patch },
    }));
  }

  function updateAdvanced(patch: Partial<AdvancedSettings>) {
    setConfig((cur) => ({
      ...cur,
      advancedSettings: { ...cur.advancedSettings, ...patch },
    }));
  }

  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        ...config,
        details: {
          printIndv: config.detailSettings.indv.enabled,
          printAll: config.detailSettings.all.enabled,
          custBill: config.detailSettings.cust.enabled,
          dlyBill: config.detailSettings.deliveryEnabled,
          ckCbBarcode: config.advancedSettings.printBarcode,
          prtDlySignature: config.detailSettings.deliveryPrintSignature,
          printBonusDetail: config.advancedSettings.printPointsDetail,
        },
      };
      const res = await fetch("/api/settings/printers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "儲存失敗");
      setMessage("印表機設定已儲存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  const d = config.detailSettings;
  const adv = config.advancedSettings;

  function renderGridRow(row: LegacyGridRow, testBtnLabel = "測試", rowPrefix = "") {
    const printerMap: Record<LegacyRowKey, string> = {
      indv: "Printer101",
      all: "Printer101",
      cust: "Printer103",
      a4: "Printer102",
      dayend: "Printer104",
    };
    const isTop = row.key === "indv";
    return (
      <div
        key={row.key}
        className={`grid grid-cols-[72px_1fr_1fr_76px] items-start gap-2 ${isTop ? "mb-1" : "py-0.5"}`}
      >
        <div className="pt-0.5 text-[12px]">
          <div>{ROW_LABELS[row.key]}</div>
          {rowPrefix ? <div className="text-center text-[11px] text-[#333]">{rowPrefix}</div> : null}
        </div>
        {/* P1 */}
        <div className="flex items-center gap-1">
          <select
            aria-label={`${ROW_LABELS[row.key]} P1`}
            value={row.p1Name}
            onChange={(e) => updateGridRow(row.key, { p1Name: e.target.value })}
            className="min-w-0 flex-1 border border-[#7f9db9] bg-white px-1 py-0.5 text-[11px]"
          >
            {!PRINTER_OPTIONS.includes(row.p1Name) ? <option value={row.p1Name}>{row.p1Name}</option> : null}
            {PRINTER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <span className="text-[14px]" aria-hidden="true">
            {row.p1On ? "🖨️" : "🚫"}
          </span>
          <button
            type="button"
            onClick={() => updateGridRow(row.key, { p1On: !row.p1On })}
            className="w-9 border border-[#7f9db9] bg-[#f0f0f0] py-0.5 text-[11px] hover:bg-[#e5e1d5]"
          >
            {row.p1On ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={() => setMessage(`已傳送測試頁至 ${printerMap[row.key]}`)}
            className="border border-[#7f9db9] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] hover:bg-[#e5e1d5]"
          >
            {testBtnLabel}
          </button>
        </div>
        {/* P2 */}
        <div className="flex items-center gap-1">
          <select
            aria-label={`${ROW_LABELS[row.key]} P2`}
            value={row.p2Name}
            onChange={(e) => updateGridRow(row.key, { p2Name: e.target.value })}
            className="min-w-0 flex-1 border border-[#7f9db9] bg-white px-1 py-0.5 text-[11px]"
          >
            {!PRINTER_OPTIONS.includes(row.p2Name) ? <option value={row.p2Name}>{row.p2Name}</option> : null}
            {PRINTER_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          <span className="text-[14px]" aria-hidden="true">
            {row.p2On ? "🖨️" : "🚫"}
          </span>
          <button
            type="button"
            onClick={() => updateGridRow(row.key, { p2On: !row.p2On })}
            className="w-9 border border-[#7f9db9] bg-[#f0f0f0] py-0.5 text-[11px] hover:bg-[#e5e1d5]"
          >
            {row.p2On ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            onClick={() => setMessage(`已傳送測試頁至 ${printerMap[row.key]} (P2)`)}
            className="border border-[#7f9db9] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] hover:bg-[#e5e1d5]"
          >
            {testBtnLabel}
          </button>
        </div>
        {/* Right side controls for first / A4 row */}
        <div className="text-[11px]">
          {row.key === "indv" ? (
            <div className="text-center">
              <div className="whitespace-nowrap">分機齊印設定</div>
              <div className="flex justify-center gap-1 text-[10px]">
                <label className="flex flex-col items-center">
                  單印
                  <input
                    type="radio"
                    name="splitMode"
                    checked={config.splitMode === "indv"}
                    onChange={() => setConfig((c) => ({ ...c, splitMode: "indv" }))}
                  />
                </label>
                <label className="flex flex-col items-center">
                  齊印
                  <input
                    type="radio"
                    name="splitMode"
                    checked={config.splitMode === "all"}
                    onChange={() => setConfig((c) => ({ ...c, splitMode: "all" }))}
                  />
                </label>
              </div>
            </div>
          ) : row.key === "a4" ? (
            <button
              type="button"
              onClick={() => setMessage("重寫咭設定已檢查")}
              className="w-full py-0.5 text-center text-[11px] hover:underline"
            >
              重寫咭
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
      role="dialog"
      aria-modal="true"
      aria-label="印表機設定"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.preventDefault();
      }}
    >
      <div className="w-[740px] border border-[#808080] bg-[#f0f0f0] text-black shadow-[4px_4px_10px_rgba(0,0,0,0.45)]">
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-[#d4d0c8] bg-white px-2.5 py-1 text-[12px]">
          <span>🖨️ 印表機設定</span>
          <button type="button" onClick={onClose} aria-label="關閉" className="px-1 text-[#666] hover:text-black">
            ✕
          </button>
        </div>

        <div className="px-3 pt-2 pb-1 text-[14px]">此畫面用於設定印表機及編印細節</div>

        {/* 3 Exact VB6 Tabs */}
        <div className="grid grid-cols-3 border-b border-[#aca899] px-2 pt-1 text-[12px]">
          <button
            type="button"
            onClick={() => setTab("printers")}
            className={`border border-b-0 border-[#aca899] py-1 ${
              tab === "printers" ? "bg-white font-bold" : "bg-[#e4e1d8]"
            }`}
          >
            印表機設定
          </button>
          <button
            type="button"
            onClick={() => setTab("details")}
            className={`border border-b-0 border-[#aca899] py-1 ${
              tab === "details" ? "bg-white font-bold" : "bg-[#e4e1d8]"
            }`}
          >
            編印細節設定
          </button>
          <button
            type="button"
            onClick={() => setTab("advanced")}
            className={`border border-b-0 border-[#aca899] py-1 ${
              tab === "advanced" ? "bg-white font-bold" : "bg-[#e4e1d8]"
            }`}
          >
            進階
          </button>
        </div>

        {/* Tab Body */}
        <div className="mx-2 mb-2 border border-t-0 border-[#aca899] bg-[#f7f7f5] p-3 text-[12px]">
          {loading ? (
            <div className="py-12 text-center text-[12px] text-[#555]">讀取印表機設定中…</div>
          ) : (
            <>
          {tab === "printers" ? (
            <div>
              <div className="mb-1 grid grid-cols-[72px_1fr_1fr_76px] gap-2 text-center text-[15px]">
                <span />
                <span>P1</span>
                <span>P2</span>
                <span />
              </div>
              {renderGridRow(config.legacyGrid[0]!, "測試", "印表機編號 1")}
              <div className="my-2 h-28 border border-[#d4d0c8] bg-[#f0f0f0]" aria-hidden="true" />
              {renderGridRow(config.legacyGrid[1]!, "測試")}
              {renderGridRow(config.legacyGrid[2]!, "測試")}
              {renderGridRow(config.legacyGrid[3]!, "測試")}
              {renderGridRow(config.legacyGrid[4]!, "Test")}
            </div>
          ) : null}

          {tab === "details" ? (
            <div className="grid grid-cols-[1fr_180px] gap-3">
              {/* Left 4 boxed rows */}
              <div className="space-y-2">
                <div className="grid grid-cols-[90px_1fr_1fr_1fr] items-center gap-2 text-center text-[14px]">
                  <span />
                  <span>P1</span>
                  <span>P2</span>
                  <span>P3(預設 )</span>
                </div>

                {(
                  [
                    ["indv", "單項單印", true],
                    ["all", "單項齊印", true],
                    ["cust", "客人單", false],
                  ] as const
                ).map(([key, label, hasBoth]) => {
                  const sec = d[key];
                  return (
                    <div key={key} className="border border-[#ccc] p-2">
                      <div className="grid grid-cols-[90px_1fr_1fr_1fr] items-start gap-2">
                        <label className="flex items-center gap-1 pt-0.5">
                          <input
                            type="checkbox"
                            checked={sec.enabled}
                            onChange={(e) => updateSection(key, { enabled: e.target.checked })}
                          />
                          {label}
                        </label>
                        {(["p1Qty", "p2Qty", "p3Qty"] as const).map((qKey) => (
                          <div key={qKey} className="flex flex-col items-start gap-1 text-[11px]">
                            <input
                              type="number"
                              min={0}
                              max={9}
                              aria-label={`${label} ${qKey}`}
                              value={sec[qKey]}
                              onChange={(e) => updateSection(key, { [qKey]: Math.max(0, Number(e.target.value) || 0) })}
                              className="w-14 border border-[#7f9db9] bg-white px-1 py-0.5 text-center font-mono"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center gap-4 pl-[96px] text-[11px]">
                        <span>語文：</span>
                        {(["TC", "ENG", ...(hasBoth ? (["BOTH"] as const) : [])] as const).map((lng) => (
                          <label key={lng} className="flex items-center gap-1">
                            <input
                              type="radio"
                              name={`lang_${key}`}
                              checked={sec.lang === lng}
                              onChange={() => updateSection(key, { lang: lng })}
                            />
                            {lng === "TC" ? "中文" : lng === "ENG" ? "英文" : "中英文"}
                          </label>
                        ))}
                        {key === "cust" ? (
                          <>
                            <span className="ml-2">格式：</span>
                            <label className="flex items-center gap-1">
                              <input
                                type="radio"
                                name="cust_format"
                                checked={sec.format !== "CUSTOM"}
                                onChange={() => updateSection("cust", { format: "STANDARD" })}
                              />
                              標準
                            </label>
                            <label className="flex items-center gap-1">
                              <input
                                type="radio"
                                name="cust_format"
                                checked={sec.format === "CUSTOM"}
                                onChange={() => updateSection("cust", { format: "CUSTOM" })}
                              />
                              自訂
                            </label>
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                <div className="border border-[#ccc] p-2">
                  <div className="flex flex-wrap items-center gap-4">
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={d.deliveryEnabled}
                        onChange={(e) => updateDetails({ deliveryEnabled: e.target.checked })}
                      />
                      送貨單
                    </label>
                    <label className="flex items-center gap-2 text-[11px]">
                      數量
                      <input
                        type="number"
                        min={0}
                        max={9}
                        value={d.deliveryQty}
                        onChange={(e) => updateDetails({ deliveryQty: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-14 border border-[#7f9db9] bg-white px-1 py-0.5 text-center font-mono"
                      />
                    </label>
                    <label className="flex items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={d.deliveryPrintItems}
                        onChange={(e) => updateDetails({ deliveryPrintItems: e.target.checked })}
                      />
                      列印貨項
                    </label>
                    <label className="flex items-center gap-1 text-[11px]">
                      <input
                        type="checkbox"
                        checked={d.deliveryPrintSignature}
                        onChange={(e) => updateDetails({ deliveryPrintSignature: e.target.checked })}
                      />
                      列印簽署
                    </label>
                  </div>
                </div>
              </div>

              {/* Right options column */}
              <div className="space-y-2 border-l border-[#d4d0c8] pl-3 text-[11px]">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={d.printSku} onChange={(e) => updateDetails({ printSku: e.target.checked })} />
                  列印貨碼
                </label>
                <div>
                  <div className="text-[#555]">產品名稱</div>
                  <div className="ml-2 space-y-0.5">
                    <label className="flex items-center gap-1">
                      <input type="radio" name="prodNameMode" checked={d.productNameMode === "FULL"} onChange={() => updateDetails({ productNameMode: "FULL" })} />
                      全名
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="prodNameMode" checked={d.productNameMode === "SHORT"} onChange={() => updateDetails({ productNameMode: "SHORT" })} />
                      短名
                    </label>
                  </div>
                </div>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={d.onlyNewItems} onChange={(e) => updateDetails({ onlyNewItems: e.target.checked })} />
                  只印新項
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={d.replaceAfterFirst} onChange={(e) => updateDetails({ replaceAfterFirst: e.target.checked })} />
                  首印後單印取代
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={d.printPrice} onChange={(e) => updateDetails({ printPrice: e.target.checked })} />
                  列印價錢
                </label>
                <div className="border-t border-[#d4d0c8] pt-2 space-y-1">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={d.printOnPickup} onChange={(e) => updateDetails({ printOnPickup: e.target.checked })} />
                    提貨時列印收據
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={d.printOnComplete} onChange={(e) => updateDetails({ printOnComplete: e.target.checked })} />
                    按完成時列印收據
                  </label>
                  <label className="ml-4 flex items-center gap-1.5">
                    <input type="checkbox" checked={d.firstTimeOnly} onChange={(e) => updateDetails({ firstTimeOnly: e.target.checked })} />
                    只於第一次
                  </label>
                  <label className="ml-4 flex items-center gap-1.5">
                    <input type="checkbox" checked={d.includeNonSales} onChange={(e) => updateDetails({ includeNonSales: e.target.checked })} />
                    連非銷售交易
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={d.printTempReceipt} onChange={(e) => updateDetails({ printTempReceipt: e.target.checked })} />
                    列印臨時收據
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={d.printStocktakeResult} onChange={(e) => updateDetails({ printStocktakeResult: e.target.checked })} />
                    列印點存結果
                  </label>
                </div>
                <div className="pt-1">
                  <div className="text-[#555]">產品名稱 (送貨)</div>
                  <div className="ml-2 space-y-0.5">
                    <label className="flex items-center gap-1">
                      <input type="radio" name="dlyProdName" checked={d.deliveryProductNameMode === "FULL"} onChange={() => updateDetails({ deliveryProductNameMode: "FULL" })} />
                      全名
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="dlyProdName" checked={d.deliveryProductNameMode === "SHORT"} onChange={() => updateDetails({ deliveryProductNameMode: "SHORT" })} />
                      短名
                    </label>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "advanced" ? (
            <div className="space-y-3 text-[11px]">
              {/* 時飛 */}
              <div>
                <div className="mb-1 font-bold text-[12px]">時飛</div>
                <div className="grid grid-cols-[150px_1fr] gap-3">
                  <fieldset className="border border-[#ccc] p-2">
                    <legend className="px-1">語文</legend>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="hrLang" checked={adv.hourlyLang === "TC"} onChange={() => updateAdvanced({ hourlyLang: "TC" })} />
                      中文
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="hrLang" checked={adv.hourlyLang === "ENG"} onChange={() => updateAdvanced({ hourlyLang: "ENG" })} />
                      英文
                    </label>
                  </fieldset>
                  <fieldset className="border border-[#ccc] p-2">
                    <legend className="px-1">日結選項</legend>
                    <div className="grid grid-cols-2 gap-1">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={adv.dayEndOptions.normalHourly}
                          onChange={(e) =>
                            updateAdvanced({ dayEndOptions: { ...adv.dayEndOptions, normalHourly: e.target.checked } })
                          }
                        />
                        一般時飛
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={adv.dayEndOptions.separatePaySlip}
                          onChange={(e) =>
                            updateAdvanced({ dayEndOptions: { ...adv.dayEndOptions, separatePaySlip: e.target.checked } })
                          }
                        />
                        個別付款單張
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={adv.dayEndOptions.simpleHourly}
                          onChange={(e) =>
                            updateAdvanced({ dayEndOptions: { ...adv.dayEndOptions, simpleHourly: e.target.checked } })
                          }
                        />
                        簡化時飛
                      </label>
                    </div>
                  </fieldset>
                </div>
              </div>

              {/* 項飛 / 其他交易飛 & 重寫卡 */}
              <div className="grid grid-cols-[1fr_170px] gap-3">
                <div>
                  <div className="mb-1 font-bold text-[12px]">項飛 / 其他交易飛</div>
                  <div className="grid grid-cols-3 gap-2">
                    <fieldset className="border border-[#ccc] p-2">
                      <legend className="px-1">語文</legend>
                      <label className="flex items-center gap-1">
                        <input type="radio" name="itemRptLang" checked={adv.itemReportLang === "TC"} onChange={() => updateAdvanced({ itemReportLang: "TC" })} />
                        中文
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" name="itemRptLang" checked={adv.itemReportLang === "ENG"} onChange={() => updateAdvanced({ itemReportLang: "ENG" })} />
                        英文
                      </label>
                    </fieldset>
                    <fieldset className="border border-[#ccc] p-2">
                      <legend className="px-1">貨品</legend>
                      <label className="flex items-center gap-1">
                        <input type="radio" name="itemProdName" checked={adv.itemProductNameMode === "FULL"} onChange={() => updateAdvanced({ itemProductNameMode: "FULL" })} />
                        全名
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" name="itemProdName" checked={adv.itemProductNameMode === "SHORT"} onChange={() => updateAdvanced({ itemProductNameMode: "SHORT" })} />
                        短名
                      </label>
                    </fieldset>
                    <fieldset className="border border-[#ccc] p-2">
                      <legend className="px-1">顯示日期</legend>
                      <label className="flex items-center gap-1">
                        <input type="radio" name="dispDateMode" checked={adv.displayDateMode === "SALE_DATE"} onChange={() => updateAdvanced({ displayDateMode: "SALE_DATE" })} />
                        銷售日
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="radio" name="dispDateMode" checked={adv.displayDateMode === "DELIVERY_DATE"} onChange={() => updateAdvanced({ displayDateMode: "DELIVERY_DATE" })} />
                        提貨日
                      </label>
                    </fieldset>
                  </div>
                </div>
                <div>
                  <div className="mb-1 font-bold text-[12px]">重寫卡</div>
                  <fieldset className="border border-[#ccc] p-2">
                    <legend className="px-1">語文</legend>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="rwLang" checked={adv.rewriteCardLang === "TC"} onChange={() => updateAdvanced({ rewriteCardLang: "TC" })} />
                      中文
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="rwLang" checked={adv.rewriteCardLang === "ENG"} onChange={() => updateAdvanced({ rewriteCardLang: "ENG" })} />
                      英文
                    </label>
                  </fieldset>
                </div>
              </div>

              {/* 客人單 & 其他印表機 */}
              <div className="grid grid-cols-[150px_1fr_180px] gap-3">
                <div className="space-y-2">
                  <div className="font-bold text-[12px]">客人單</div>
                  <fieldset className="border border-[#ccc] p-2">
                    <legend className="px-1">列印套裝細節</legend>
                    {(
                      [
                        ["YES", "是"],
                        ["NO", "否"],
                        ["NEVER", "絕對否"],
                      ] as const
                    ).map(([v, lbl]) => (
                      <label key={v} className="flex items-center gap-1">
                        <input type="radio" name="setDetail" checked={adv.setDetailMode === v} onChange={() => updateAdvanced({ setDetailMode: v })} />
                        {lbl}
                      </label>
                    ))}
                  </fieldset>
                  <fieldset className="border border-[#ccc] p-2">
                    <legend className="px-1">列印套裝價格</legend>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="setPricePos" checked={adv.setPricePosition === "SET_ITEM"} onChange={() => updateAdvanced({ setPricePosition: "SET_ITEM" })} />
                      於套裝項
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="setPricePos" checked={adv.setPricePosition === "DETAIL_ITEM"} onChange={() => updateAdvanced({ setPricePosition: "DETAIL_ITEM" })} />
                      於細節項
                    </label>
                  </fieldset>
                </div>

                <div className="space-y-1.5 pt-6">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={adv.printCashier} onChange={(e) => updateAdvanced({ printCashier: e.target.checked })} />
                    列印收銀員
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={adv.printPointsDetail} onChange={(e) => updateAdvanced({ printPointsDetail: e.target.checked })} />
                    列印積分細節
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={adv.printBarcode} onChange={(e) => updateAdvanced({ printBarcode: e.target.checked })} />
                    列印條碼
                  </label>
                  <div className="ml-5 space-y-0.5">
                    <label className="flex items-center gap-1">
                      <input type="radio" name="bcPos" checked={adv.barcodePosition === "TOP"} onChange={() => updateAdvanced({ barcodePosition: "TOP" })} />
                      於單首
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="bcPos" checked={adv.barcodePosition === "BOTTOM"} onChange={() => updateAdvanced({ barcodePosition: "BOTTOM" })} />
                      於單尾
                    </label>
                  </div>
                </div>

                <div>
                  <div className="mb-1 font-bold text-[12px]">其他印表機</div>
                  <fieldset className="border border-[#ccc] p-2">
                    <legend className="px-1">日結印表機</legend>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="dePrt" checked={adv.dayEndPrinterRoute === "FOLLOW_CUST"} onChange={() => updateAdvanced({ dayEndPrinterRoute: "FOLLOW_CUST" })} />
                      跟客人單
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="dePrt" checked={adv.dayEndPrinterRoute === "FOLLOW_A4"} onChange={() => updateAdvanced({ dayEndPrinterRoute: "FOLLOW_A4" })} />
                      跟 A4
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="radio" name="dePrt" checked={adv.dayEndPrinterRoute === "FOLLOW_DAYEND"} onChange={() => updateAdvanced({ dayEndPrinterRoute: "FOLLOW_DAYEND" })} />
                      跟日結單
                    </label>
                  </fieldset>
                </div>
              </div>
            </div>
          ) : null}
            </>
          )}

          {message ? <div className="mt-2 border border-[#aca899] bg-[#ffffe1] p-1.5 text-[12px]">營運通訊息 - 000：{message}</div> : null}
        </div>

        {/* Bottom action buttons matching Screens 023-025 */}
        <div className="flex justify-end gap-2 px-3 pb-3 text-[12px]">
          <button
            type="button"
            onClick={() => setMessage("系統印表機配置：Windows Default Print Spooler")}
            className="border border-[#7f9db9] bg-[#f0f0f0] px-3 py-1 leading-tight hover:bg-[#e5e1d5]"
          >
            設定系統印表機
          </button>
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="border border-[#7f9db9] bg-[#e1dfff] px-7 py-1 hover:bg-[#d0ccff]"
          >
            離開
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void save()}
            className="border border-[#7f9db9] bg-[#f0f0f0] px-7 py-1 hover:bg-[#e5e1d5] disabled:opacity-40"
          >
            套用
          </button>
        </div>
      </div>
    </div>
  );
}

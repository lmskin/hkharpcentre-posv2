"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";

interface StockRow {
  productId: number;
  sku: string;
  nameZh: string;
  nameEn: string;
  onHandQty: number;
  movingAvgCostHkd: number;
  valuationHkd: number;
}

export default function StockBackOfficePage() {
  const [items, setItems] = useState<StockRow[]>([]);
  const [q, setQ] = useState("");
  const [selectedProdId, setSelectedProdId] = useState<number>(0);
  const [opType, setOpType] = useState<"PURCHASE_IN" | "ADJUST" | "WRITE_OFF" | "STOCKTAKE">("PURCHASE_IN");
  const [qty, setQty] = useState("1");
  const [unitCost, setUnitCost] = useState("0");
  const [remarks, setRemarks] = useState("");
  const [msg, setMsg] = useState("");

  async function loadStock(query: string) {
    const res = await fetch(`/api/stock?q=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = (await res.json()) as { items: StockRow[] };
      setItems(data.items);
      if (data.items.length > 0 && selectedProdId === 0) {
        setSelectedProdId(data.items[0]!.productId);
        setUnitCost(String(data.items[0]!.movingAvgCostHkd));
      }
    }
  }

  useEffect(() => {
    void loadStock("");
  }, []);

  async function postMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProdId) return;
    setMsg("");
    const res = await fetch("/api/stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationType: opType,
        remarks: remarks || undefined,
        lines: [
          {
            productId: selectedProdId,
            quantityOrCount: Number(qty),
            unitCostHkd: opType === "PURCHASE_IN" ? Number(unitCost) : undefined,
          },
        ],
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Stock update failed (requires L4+ login)");
      return;
    }
    setMsg(`Posted ${opType} movement cleanly.`);
    await loadStock(q);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">Inventory Balances &amp; Moving-Average Cost</h1>
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              void loadStock(e.target.value);
            }}
            placeholder="Search SKU..."
            className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div className="mt-4 max-h-[540px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">SKU</th>
                <th className="py-2">Product</th>
                <th className="py-2 text-right">On Hand</th>
                <th className="py-2 text-right">Avg Cost</th>
                <th className="py-2 text-right">Valuation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((r) => (
                <tr
                  key={r.productId}
                  onClick={() => {
                    setSelectedProdId(r.productId);
                    setUnitCost(String(r.movingAvgCostHkd));
                  }}
                  className={`cursor-pointer ${
                    selectedProdId === r.productId ? "bg-indigo-50" : "hover:bg-slate-50"
                  }`}
                >
                  <td className="py-2 font-mono font-semibold">{r.sku}</td>
                  <td className="py-2">{r.nameEn || r.nameZh}</td>
                  <td className="py-2 text-right font-mono">{r.onHandQty}</td>
                  <td className="py-2 text-right font-mono">{formatHkd(r.movingAvgCostHkd)}</td>
                  <td className="py-2 text-right font-mono font-semibold">{formatHkd(r.valuationHkd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
        <h2 className="text-sm font-bold text-slate-900">Post Stock Movement (L4+)</h2>
        <form onSubmit={(e) => void postMovement(e)} className="mt-4 space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-600">Operation</label>
            <select
              value={opType}
              onChange={(e) => setOpType(e.target.value as typeof opType)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            >
              <option value="PURCHASE_IN">Purchase Receiving (XC=1)</option>
              <option value="ADJUST">Adjustment Delta (XC=15)</option>
              <option value="WRITE_OFF">Write-Off (XC=10)</option>
              <option value="STOCKTAKE">Stocktake Count (XC=93)</option>
            </select>
          </div>
          <div>
            <label className="block font-medium text-slate-600">Quantity / Count</label>
            <input
              type="number"
              step="0.01"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
            />
          </div>
          {opType === "PURCHASE_IN" ? (
            <div>
              <label className="block font-medium text-slate-600">Unit Cost (HKD)</label>
              <input
                type="number"
                step="0.01"
                value={unitCost}
                onChange={(e) => setUnitCost(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
          ) : null}
          <div>
            <label className="block font-medium text-slate-600">Remarks</label>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
          >
            Submit Stock Movement
          </button>
          {msg ? <div className="rounded bg-slate-50 p-2 text-slate-800">{msg}</div> : null}
        </form>
      </section>
    </div>
  );
}

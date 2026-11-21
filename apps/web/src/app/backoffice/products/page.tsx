"use client";

import { useEffect, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";

interface ProductRow {
  id: number;
  sku: string;
  nameZh: string;
  nameEn: string;
  categoryLabel: string;
  categoryC1: number;
  unitPriceHkd: number;
  avgCostHkd: number;
  excludeFromCrmBonus: boolean;
}

export default function ProductsBackOfficePage() {
  const [items, setItems] = useState<ProductRow[]>([]);
  const [q, setQ] = useState("");
  const [barcode, setBarcode] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [c1, setC1] = useState("1");
  const [price, setPrice] = useState("0");
  const [msg, setMsg] = useState("");

  async function loadProducts(query: string) {
    const res = await fetch(`/api/products?q=${encodeURIComponent(query)}&limit=80`);
    if (res.ok) {
      const data = (await res.json()) as { items: ProductRow[] };
      setItems(data.items);
    }
  }

  useEffect(() => {
    void loadProducts("");
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode,
        nameZh,
        nameEn,
        legacyC1: Number(c1),
        sellPriceHkd: Number(price),
      }),
    });
    const data = (await res.json()) as { ok?: boolean; created?: boolean; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Save failed (requires L4+ login)");
      return;
    }
    setMsg(data.created ? `Created product ${barcode}` : `Updated product ${barcode}`);
    await loadProducts(q);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-900">Catalog Masters (`ProductOnSale`)</h1>
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              void loadProducts(e.target.value);
            }}
            placeholder="Search SKU / name..."
            className="w-60 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div className="mt-4 max-h-[540px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">SKU</th>
                <th className="py-2">Name</th>
                <th className="py-2">C1</th>
                <th className="py-2 text-right">Sell Price</th>
                <th className="py-2 text-right">Avg Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((p) => (
                <tr
                  key={p.sku}
                  onClick={() => {
                    setBarcode(p.sku);
                    setNameZh(p.nameZh);
                    setNameEn(p.nameEn);
                    setC1(String(p.categoryC1));
                    setPrice(String(p.unitPriceHkd));
                  }}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="py-2 font-mono font-semibold">{p.sku}</td>
                  <td className="py-2">{p.nameEn || p.nameZh}</td>
                  <td className="py-2 font-mono">{p.categoryC1}</td>
                  <td className="py-2 text-right font-mono">{formatHkd(p.unitPriceHkd)}</td>
                  <td className="py-2 text-right font-mono text-slate-500">{formatHkd(p.avgCostHkd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
        <h2 className="text-sm font-bold text-slate-900">Create / Update Product (L4+)</h2>
        <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-600">SKU / Barcode</label>
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              required
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">Chinese Name</label>
            <input
              value={nameZh}
              onChange={(e) => setNameZh(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
              required
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">English Name</label>
            <input
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block font-medium text-slate-600">Category C1 (3=Harp)</label>
              <input
                type="number"
                value={c1}
                onChange={(e) => setC1(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-600">Sell Price (HKD)</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
          >
            Save Product
          </button>
          {msg ? <div className="rounded bg-slate-50 p-2 text-slate-800">{msg}</div> : null}
        </form>
      </section>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { formatHkd } from "@hkharp/domain/money";

interface ProductRow {
  id: number;
  sku: string;
  ubc: string;
  nameZh: string;
  nameEn: string;
  categoryLabel: string;
  categoryC1: number;
  unitPriceHkd: number;
  fixedPriceHkd: number | null;
  avgCostHkd: number;
  allowItemDiscount: boolean;
  isFixedPrice: boolean;
  excludeFromCrmBonus: boolean;
}

interface CategoryItem {
  id: number;
  legacyC1: number;
  nameZh: string;
  nameEn: string;
}

const PAGE_SIZE = 50;

export default function ProductsBackOfficePage() {
  const [items, setItems] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [q, setQ] = useState("");
  const [filterC1, setFilterC1] = useState("");
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const reqSeqRef = useRef(0);

  const [barcode, setBarcode] = useState("");
  const [ubc, setUbc] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [c1, setC1] = useState("1");
  const [price, setPrice] = useState("0");
  const [fixedPrice, setFixedPrice] = useState("");
  const [allowItemDiscount, setAllowItemDiscount] = useState(true);
  const [excludeFromCrmBonus, setExcludeFromCrmBonus] = useState(false);
  const [msg, setMsg] = useState("");

  const [showLabelPreview, setShowLabelPreview] = useState(false);
  const [labelQty, setLabelQty] = useState(2);

  async function loadProducts(query: string, categoryC1Val: string, targetPage: number) {
    const seq = ++reqSeqRef.current;
    const params = new URLSearchParams({
      q: query,
      page: String(targetPage),
      pageSize: String(PAGE_SIZE),
    });
    if (categoryC1Val !== "") params.set("categoryC1", categoryC1Val);
    const res = await fetch(`/api/products?${params.toString()}`);
    if (res.ok) {
      const data = (await res.json()) as {
        items: ProductRow[];
        total: number;
        page: number;
        pageCount: number;
        categories?: CategoryItem[];
      };
      if (seq !== reqSeqRef.current) return;
      setItems(data.items);
      setTotal(data.total);
      setLoadedPage(data.page);
      setPageCount(data.pageCount);
      if (data.categories) setCategories(data.categories);
    }
  }

  useEffect(() => {
    void loadProducts(q, filterC1, page);
  }, [q, filterC1, page]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const parsedFixed = fixedPrice.trim() === "" ? null : Number(fixedPrice);
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode,
        ubc: ubc.trim(),
        nameZh,
        nameEn,
        legacyC1: Number(c1),
        sellPriceHkd: Number(price),
        fixedPriceHkd: parsedFixed,
        allowItemDiscount,
        excludeFromCrmBonus,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; created?: boolean; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Save failed (requires L4+ login)");
      return;
    }
    setMsg(data.created ? `Created product ${barcode}` : `Updated product ${barcode}`);
    await loadProducts(q, filterC1, page);
  }

  const labelPrice = fixedPrice.trim() !== "" ? Number(fixedPrice) : Number(price || 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12 print:hidden">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Catalog Masters (`ProductOnSale`)</h1>
              <div className="text-xs text-slate-500">
                Total {total.toLocaleString()} SKUs · Page {loadedPage}/{pageCount}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter Category"
                value={filterC1}
                onChange={(e) => {
                  setFilterC1(e.target.value);
                  setPage(1);
                }}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
              >
                <option value="">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.legacyC1} value={cat.legacyC1}>
                    C1={cat.legacyC1} · {cat.nameZh || cat.nameEn}
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
                placeholder="Search SKU / UBC / name..."
                className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
              />
            </div>
          </div>

          <div className="mt-4 max-h-[540px] overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2">SKU</th>
                  <th className="py-2">UBC</th>
                  <th className="py-2">Name</th>
                  <th className="py-2">C1</th>
                  <th className="py-2 text-right">Sell Price</th>
                  <th className="py-2 text-right">Fixed</th>
                  <th className="py-2 text-right">Avg Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((p) => (
                  <tr
                    key={p.sku}
                    onClick={() => {
                      setBarcode(p.sku);
                      setUbc(p.ubc ?? "");
                      setNameZh(p.nameZh);
                      setNameEn(p.nameEn);
                      setC1(String(p.categoryC1));
                      setPrice(String(p.unitPriceHkd));
                      setFixedPrice(p.fixedPriceHkd !== null ? String(p.fixedPriceHkd) : "");
                      setAllowItemDiscount(p.allowItemDiscount);
                      setExcludeFromCrmBonus(p.excludeFromCrmBonus);
                    }}
                    className={`cursor-pointer ${barcode === p.sku ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="py-2 font-mono font-semibold">{p.sku}</td>
                    <td className="py-2 font-mono text-slate-500">{p.ubc || "-"}</td>
                    <td className="py-2">{p.nameEn || p.nameZh}</td>
                    <td className="py-2 font-mono">{p.categoryC1}</td>
                    <td className="py-2 text-right font-mono">{formatHkd(p.unitPriceHkd)}</td>
                    <td className="py-2 text-right font-mono text-amber-700">
                      {p.fixedPriceHkd !== null ? formatHkd(p.fixedPriceHkd) : "-"}
                    </td>
                    <td className="py-2 text-right font-mono text-slate-500">{formatHkd(p.avgCostHkd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
            <span className="text-slate-500">
              Showing page {loadedPage} of {pageCount} ({total} products)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40 hover:bg-slate-50"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
          <h2 className="text-sm font-bold text-slate-900">Create / Update Product (L4+)</h2>
          <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
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
                <label className="block font-medium text-slate-600">UBC (廠方碼)</label>
                <input
                  value={ubc}
                  onChange={(e) => setUbc(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
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
            <div>
              <label className="block font-medium text-slate-600">Category</label>
              <select
                value={c1}
                onChange={(e) => setC1(e.target.value)}
                className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
              >
                {!categories.some((cat) => String(cat.legacyC1) === c1) ? (
                  <option value={c1}>C1={c1}</option>
                ) : null}
                {categories.map((cat) => (
                  <option key={cat.legacyC1} value={cat.legacyC1}>
                    C1={cat.legacyC1} · {cat.nameZh || cat.nameEn}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
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
              <div>
                <label className="block font-medium text-slate-600">Fixed Price (HKD, optional)</label>
                <input
                  type="number"
                  step="0.01"
                  value={fixedPrice}
                  onChange={(e) => setFixedPrice(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
                />
              </div>
            </div>
            <div className="space-y-1.5 pt-1">
              <label className="flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={allowItemDiscount}
                  onChange={(e) => setAllowItemDiscount(e.target.checked)}
                />
                Allow Item Discount
              </label>
              <label className="flex items-center gap-2 text-slate-700">
                <input
                  type="checkbox"
                  checked={excludeFromCrmBonus}
                  onChange={(e) => setExcludeFromCrmBonus(e.target.checked)}
                />
                Exclude from CRM Bonus
              </label>
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
            >
              Save Product
            </button>
            <button
              type="button"
              disabled={!barcode.trim()}
              onClick={() => setShowLabelPreview((v) => !v)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            >
              列印條碼標籤 (Barcode Label)
            </button>
            {msg ? <div className="rounded bg-slate-50 p-2 text-slate-800">{msg}</div> : null}
          </form>
        </section>
      </div>

      {showLabelPreview && barcode.trim() ? (
        <section
          role="dialog"
          aria-label="條碼標籤預覽"
          className="rounded-xl border border-slate-300 bg-white p-5 shadow-md print:border-0 print:p-0 print:shadow-none"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
            <h2 className="text-sm font-bold text-slate-900">
              條碼標籤預覽 · {barcode} ({nameZh || nameEn})
            </h2>
            <div className="flex items-center gap-2 text-xs">
              <label>
                列印張數
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={labelQty}
                  onChange={(e) => setLabelQty(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
                  className="ml-2 w-16 rounded border border-slate-300 px-2 py-1 font-mono"
                />
              </label>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-lg bg-slate-900 px-4 py-1.5 font-semibold text-white hover:bg-slate-800"
              >
                Print Label
              </button>
              <button
                type="button"
                onClick={() => setShowLabelPreview(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {Array.from({ length: labelQty }).map((_, idx) => (
              <div key={idx} className="w-56 border border-dashed border-slate-400 bg-white p-3 text-center text-black">
                <div className="text-[10px] font-bold tracking-wider">HK HARP CENTRE</div>
                <div className="mt-0.5 truncate text-xs font-semibold">{nameZh || nameEn || barcode}</div>
                <div
                  className="mx-auto mt-2 h-10 w-44"
                  style={{
                    background:
                      "repeating-linear-gradient(90deg,#000 0,#000 2px,#fff 2px,#fff 4px,#000 4px,#000 5px,#fff 5px,#fff 7px)",
                  }}
                />
                <div className="mt-1 font-mono text-[11px] font-bold">
                  {barcode}
                  {ubc ? ` · ${ubc}` : ""}
                </div>
                <div className="mt-0.5 font-mono text-sm font-bold">{formatHkd(labelPrice)}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

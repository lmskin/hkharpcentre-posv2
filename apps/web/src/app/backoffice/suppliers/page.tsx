"use client";

import { useEffect, useRef, useState } from "react";

interface SupplierRow {
  id: number;
  legacyId: string;
  nameZh: string;
  nameEn: string;
  phone: string;
  active: boolean;
}

export default function SuppliersBackOfficePage() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const reqSeqRef = useRef(0);
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [legacyId, setLegacyId] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");

  async function loadSuppliers(query: string) {
    const seq = ++reqSeqRef.current;
    const res = await fetch(`/api/suppliers?q=${encodeURIComponent(query)}&limit=150`);
    if (res.ok) {
      const data = (await res.json()) as { suppliers: SupplierRow[]; total: number };
      if (seq !== reqSeqRef.current) return;
      setSuppliers(data.suppliers);
      setTotal(data.total);
    }
  }

  useEffect(() => {
    void loadSuppliers(q);
  }, [q]);

  function resetForm() {
    setEditingId(undefined);
    setLegacyId("");
    setNameZh("");
    setNameEn("");
    setPhone("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingId,
        legacyId: legacyId.trim() || undefined,
        nameZh,
        nameEn,
        phone,
      }),
    });
    const data = (await res.json()) as { legacyId?: string; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Save failed (requires L4+ login)");
      return;
    }
    setMsg(editingId ? `Updated supplier ${data.legacyId}` : `Saved supplier ${data.legacyId}`);
    resetForm();
    await loadSuppliers(q);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Suppliers Master (StaffCounterparty TP=&apos;1&apos;)</h1>
            <div className="text-xs text-slate-500">Total {total} suppliers</div>
          </div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code, name, or phone..."
            className="w-60 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div className="mt-4 max-h-[540px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Code</th>
                <th className="py-2">Chinese Name</th>
                <th className="py-2">English Name</th>
                <th className="py-2">Phone</th>
                <th className="py-2">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {suppliers.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => {
                    setEditingId(s.id);
                    setLegacyId(s.legacyId);
                    setNameZh(s.nameZh);
                    setNameEn(s.nameEn);
                    setPhone(s.phone);
                  }}
                  className={`cursor-pointer ${editingId === s.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                >
                  <td className="py-2 font-mono font-semibold">{s.legacyId}</td>
                  <td className="py-2">{s.nameZh}</td>
                  <td className="py-2 text-slate-600">{s.nameEn || "-"}</td>
                  <td className="py-2 font-mono text-slate-500">{s.phone || "-"}</td>
                  <td className="py-2">{s.active ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">
            {editingId ? `Edit Supplier ${legacyId}` : "Create / Update Supplier (L4+)"}
          </h2>
          {editingId ? (
            <button type="button" onClick={resetForm} className="text-xs text-indigo-600 hover:underline">
              New Supplier
            </button>
          ) : null}
        </div>
        <form onSubmit={(e) => void handleSave(e)} className="mt-4 space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-600">Supplier Code (optional)</label>
            <input
              value={legacyId}
              onChange={(e) => setLegacyId(e.target.value)}
              placeholder="Auto SUP... if blank"
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
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
          <div>
            <label className="block font-medium text-slate-600">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
          >
            {editingId ? "Update Supplier" : "Save Supplier"}
          </button>
          {msg ? <div className="rounded bg-slate-50 p-2 text-slate-800">{msg}</div> : null}
        </form>
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

interface CustomerRow {
  id: number;
  legacyId: string;
  nameZh: string;
  nameEn: string;
  phone: string;
  email: string;
  pointsBalance: number;
}

export default function CustomersBackOfficePage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");

  async function loadCustomers(query: string) {
    const res = await fetch(`/api/customers?q=${encodeURIComponent(query)}&limit=60`);
    if (res.ok) {
      const data = (await res.json()) as { customers: CustomerRow[] };
      setCustomers(data.customers);
    }
  }

  useEffect(() => {
    void loadCustomers("");
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nameZh, nameEn, phone }),
    });
    const data = (await res.json()) as { legacyId?: string; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Save failed (requires staff login)");
      return;
    }
    setMsg(`Saved customer ${data.legacyId}`);
    setNameZh("");
    setNameEn("");
    setPhone("");
    await loadCustomers(q);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">CRM Customers &amp; Bonus Points</h1>
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              void loadCustomers(e.target.value);
            }}
            placeholder="Search ID, name, or phone..."
            className="w-60 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div className="mt-4 max-h-[540px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Member ID</th>
                <th className="py-2">Name</th>
                <th className="py-2 text-right">BPT1 Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 font-mono">{c.legacyId}</td>
                  <td className="py-2">{c.nameEn || c.nameZh}</td>
                  <td className="py-2 text-right font-mono font-semibold text-indigo-700">{c.pointsBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
        <h2 className="text-sm font-bold text-slate-900">Register Member</h2>
        <form onSubmit={(e) => void handleCreate(e)} className="mt-4 space-y-3 text-xs">
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
            Save Customer
          </button>
          {msg ? <div className="rounded bg-slate-50 p-2 text-slate-800">{msg}</div> : null}
        </form>
      </section>
    </div>
  );
}

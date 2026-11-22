"use client";

import { useEffect, useState } from "react";

interface CustomerRow {
  id: number;
  legacyId: string;
  gradeId: number | null;
  gradeName: string;
  cardNo: string;
  nameZh: string;
  nameEn: string;
  phone: string;
  email: string;
  pointsBalance: number;
}

interface CustomerGrade {
  id: number;
  legacyCode: number;
  nameZh: string;
  nameEn: string;
}

interface PointLedgerRow {
  id: number;
  deltaPoints: number;
  reason: string;
  createdAt: string;
}

export default function CustomersBackOfficePage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [grades, setGrades] = useState<CustomerGrade[]>([]);
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [legacyId, setLegacyId] = useState("");
  const [gradeId, setGradeId] = useState<string>("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ledger, setLedger] = useState<PointLedgerRow[]>([]);
  const [msg, setMsg] = useState("");

  async function loadCustomers(query: string) {
    const res = await fetch(`/api/customers?q=${encodeURIComponent(query)}&limit=60`);
    if (res.ok) {
      const data = (await res.json()) as { customers: CustomerRow[]; grades?: CustomerGrade[] };
      setCustomers(data.customers);
      if (data.grades) setGrades(data.grades);
    }
  }

  useEffect(() => {
    void loadCustomers("");
  }, []);

  async function selectCustomer(c: CustomerRow) {
    setEditingId(c.id);
    setLegacyId(c.legacyId);
    setGradeId(c.gradeId ? String(c.gradeId) : "");
    setNameZh(c.nameZh);
    setNameEn(c.nameEn);
    setPhone(c.phone);
    setEmail(c.email);
    const res = await fetch(`/api/customers?customerId=${c.id}`);
    if (res.ok) {
      const data = (await res.json()) as { ledger: PointLedgerRow[] };
      setLedger(data.ledger ?? []);
    }
  }

  function resetForm() {
    setEditingId(undefined);
    setLegacyId("");
    setGradeId("");
    setNameZh("");
    setNameEn("");
    setPhone("");
    setEmail("");
    setLedger([]);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingId,
        legacyId: legacyId.trim() || undefined,
        gradeId: gradeId ? Number(gradeId) : null,
        nameZh,
        nameEn,
        phone,
        email,
      }),
    });
    const data = (await res.json()) as { legacyId?: string; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Save failed (requires staff login)");
      return;
    }
    setMsg(editingId ? `Updated customer ${data.legacyId}` : `Saved customer ${data.legacyId}`);
    resetForm();
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
            placeholder="Search ID, card #, name, or phone..."
            className="w-64 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />
        </div>
        <div className="mt-4 max-h-[540px] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2">Member ID</th>
                <th className="py-2">Card No.</th>
                <th className="py-2">Grade</th>
                <th className="py-2">Name</th>
                <th className="py-2 text-right">BPT1 Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => void selectCustomer(c)}
                  className={`cursor-pointer ${editingId === c.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}
                >
                  <td className="py-2 font-mono">{c.legacyId}</td>
                  <td className="py-2 font-mono text-slate-500">{c.cardNo || "-"}</td>
                  <td className="py-2 text-slate-600">{c.gradeName || "-"}</td>
                  <td className="py-2">{c.nameEn || c.nameZh}</td>
                  <td className="py-2 text-right font-mono font-semibold text-indigo-700">{c.pointsBalance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">{editingId ? `Edit Member ${legacyId}` : "Register Member"}</h2>
          {editingId ? (
            <button type="button" onClick={resetForm} className="text-xs text-indigo-600 hover:underline">
              New Member
            </button>
          ) : null}
        </div>
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-600">Grade</label>
            <select
              value={gradeId}
              onChange={(e) => setGradeId(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            >
              <option value="">Default / Unassigned</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameZh || g.nameEn}
                </option>
              ))}
            </select>
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
          <div>
            <label className="block font-medium text-slate-600">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800"
          >
            {editingId ? "Update Customer" : "Save Customer"}
          </button>
          {msg ? <div className="rounded bg-slate-50 p-2 text-slate-800">{msg}</div> : null}
        </form>

        {editingId ? (
          <div className="border-t border-slate-200 pt-3">
            <div className="text-xs font-bold text-slate-700">Recent Point Ledger</div>
            <div className="mt-2 max-h-40 space-y-1 overflow-auto text-[11px]">
              {ledger.length === 0 ? (
                <div className="text-slate-400">No point movements recorded.</div>
              ) : (
                ledger.map((row) => (
                  <div key={row.id} className="flex justify-between gap-2 border-b border-slate-100 pb-1">
                    <span className="truncate text-slate-600">{row.reason}</span>
                    <span className={`font-mono font-semibold ${row.deltaPoints >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                      {row.deltaPoints >= 0 ? `+${row.deltaPoints}` : row.deltaPoints}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

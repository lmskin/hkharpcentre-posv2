"use client";

import { useEffect, useRef, useState } from "react";
import { AutoSuggestInput } from "@/components/AutoSuggestInput";

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
  address?: string;
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

const PAGE_SIZE = 50;

export default function CustomersBackOfficePage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [grades, setGrades] = useState<CustomerGrade[]>([]);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [loadedPage, setLoadedPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const reqSeqRef = useRef(0);

  const [editingId, setEditingId] = useState<number | undefined>(undefined);
  const [legacyId, setLegacyId] = useState("");
  const [gradeId, setGradeId] = useState<string>("");
  const [cardNo, setCardNo] = useState("");
  const [nameZh, setNameZh] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [ledger, setLedger] = useState<PointLedgerRow[]>([]);
  const [msg, setMsg] = useState("");

  async function loadCustomers(query: string, targetPage: number) {
    const seq = ++reqSeqRef.current;
    const res = await fetch(
      `/api/customers?q=${encodeURIComponent(query)}&page=${targetPage}&pageSize=${PAGE_SIZE}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        customers: CustomerRow[];
        grades?: CustomerGrade[];
        total: number;
        page: number;
        pageCount: number;
      };
      if (seq !== reqSeqRef.current) return;
      setCustomers(data.customers);
      setTotal(data.total);
      setLoadedPage(data.page);
      setPageCount(data.pageCount);
      if (data.grades) setGrades(data.grades);
    }
  }

  useEffect(() => {
    void loadCustomers(q, page);
  }, [q, page]);

  async function selectCustomer(c: CustomerRow) {
    setEditingId(c.id);
    setLegacyId(c.legacyId);
    setGradeId(c.gradeId ? String(c.gradeId) : "");
    setCardNo(c.cardNo ?? "");
    setNameZh(c.nameZh);
    setNameEn(c.nameEn);
    setPhone(c.phone);
    setEmail(c.email);
    setAddress(c.address ?? "");
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
    setCardNo("");
    setNameZh("");
    setNameEn("");
    setPhone("");
    setEmail("");
    setAddress("");
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
        cardNo: cardNo.trim(),
        nameZh,
        nameEn,
        phone,
        email,
        address,
      }),
    });
    const data = (await res.json()) as { legacyId?: string; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Save failed (requires staff login)");
      return;
    }
    setMsg(editingId ? `Updated customer ${data.legacyId}` : `Saved customer ${data.legacyId}`);
    resetForm();
    await loadCustomers(q, page);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">CRM Customers &amp; Bonus Points</h1>
            <div className="text-xs text-slate-500">
              Total {total.toLocaleString()} members · Page {loadedPage}/{pageCount}
            </div>
          </div>
          <AutoSuggestInput
            theme="modern"
            type="search"
            name="customerSearch"
            autoComplete="on"
            suggestKind="customer"
            historyKey="bo_cust_search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
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

        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
          <span className="text-slate-500">
            Page {loadedPage} of {pageCount} ({total} members)
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
          <div className="grid grid-cols-2 gap-2">
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
              <label className="block font-medium text-slate-600">Member Card No.</label>
              <AutoSuggestInput
                theme="modern"
                name="customerCardNo"
                autoComplete="on"
                suggestKind="customer"
                valueField="cardNo"
                suggestions={["RWC-", "VIP-", "HC-"]}
                historyKey="bo_cust_card"
                value={cardNo}
                onChange={(e) => setCardNo(e.target.value)}
                placeholder="e.g. RWC-0001"
                className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block font-medium text-slate-600">Chinese Name</label>
            <AutoSuggestInput
              theme="modern"
              name="customerNameZh"
              autoComplete="name"
              suggestKind="customer"
              valueField="nameZh"
              historyKey="bo_cust_namezh"
              value={nameZh}
              onChange={(e) => setNameZh(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
              required
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">English Name</label>
            <AutoSuggestInput
              theme="modern"
              name="customerNameEn"
              autoComplete="name"
              suggestKind="customer"
              valueField="nameEn"
              historyKey="bo_cust_nameen"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">Phone</label>
            <AutoSuggestInput
              theme="modern"
              type="tel"
              name="customerPhone"
              autoComplete="tel"
              suggestKind="customer"
              valueField="phone"
              historyKey="bo_cust_phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">Email</label>
            <AutoSuggestInput
              theme="modern"
              type="email"
              name="customerEmail"
              autoComplete="email"
              emailDomainSuggest
              suggestKind="customer"
              valueField="email"
              historyKey="bo_cust_email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-2.5 py-1.5"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">Address (送貨地址)</label>
            <textarea
              name="customerAddress"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Delivery / sign-off address..."
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

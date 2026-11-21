"use client";

import { useEffect, useState } from "react";

export default function SettingsBackOfficePage() {
  const [payeeName, setPayeeName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [fpsId, setFpsId] = useState("");
  const [paymentTermsNote, setPaymentTermsNote] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings?: Record<string, Record<string, string>> }) => {
        const inst = data.settings?.invoice_payment_instructions ?? {};
        setPayeeName(inst.payeeName ?? "");
        setBankName(inst.bankName ?? "");
        setAccountNumber(inst.accountNumber ?? "");
        setFpsId(inst.fpsId ?? "");
        setPaymentTermsNote(inst.paymentTermsNote ?? "");
      })
      .catch(() => {});
  }, []);

  async function saveBankInstructions(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "invoice_payment_instructions",
        shopId: 0,
        value: { payeeName, bankName, accountNumber, fpsId, paymentTermsNote },
      }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      setMsg(data.error ?? "Save failed (requires Admin L5 login)");
      return;
    }
    setMsg("Saved printed invoice bank transfer instructions to MySQL 8.");
  }

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <h1 className="text-lg font-bold text-slate-900">Invoice &amp; Terminal Settings (L5 Admin)</h1>
      <p className="mt-1 text-xs text-slate-500">
        Updates Bank Transfer instructions printed on `/invoices/[invoiceNo]/print`.
      </p>

      <form onSubmit={(e) => void saveBankInstructions(e)} className="mt-4 space-y-3 text-xs">
        <div>
          <label className="block font-medium text-slate-600">Payee Name</label>
          <input
            value={payeeName}
            onChange={(e) => setPayeeName(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-600">Bank Name</label>
          <input
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-600">Account Number</label>
            <input
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">FPS ID</label>
            <input
              value={fpsId}
              onChange={(e) => setFpsId(e.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono"
            />
          </div>
        </div>
        <div>
          <label className="block font-medium text-slate-600">Invoice Footer Note</label>
          <textarea
            rows={2}
            value={paymentTermsNote}
            onChange={(e) => setPaymentTermsNote(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Save Invoice Bank Settings
        </button>
        {msg ? <div className="rounded bg-slate-50 p-2 text-slate-800">{msg}</div> : null}
      </form>
    </div>
  );
}

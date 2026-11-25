"use client";

import { useEffect, useRef, useState } from "react";
import { AutoSuggestInput, AutoSuggestTextarea } from "@/components/AutoSuggestInput";

export default function SettingsBackOfficePage() {
  const [payeeName, setPayeeName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [fpsId, setFpsId] = useState("");
  const [paymentTermsNote, setPaymentTermsNote] = useState("");
  const [loaded, setLoaded] = useState(false);
  const dirtyRef = useRef(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings?: Record<string, Record<string, string>> }) => {
        if (cancelled) return;
        const inst = data.settings?.invoice_payment_instructions ?? {};
        if (!dirtyRef.current) {
          setPayeeName(inst.payeeName ?? "");
          setBankName(inst.bankName ?? "");
          setAccountNumber(inst.accountNumber ?? "");
          setFpsId(inst.fpsId ?? "");
          setPaymentTermsNote(inst.paymentTermsNote ?? "");
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
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

      <form
        data-loaded={loaded ? "true" : "false"}
        onSubmit={(e) => void saveBankInstructions(e)}
        className="mt-4 space-y-3 text-xs"
      >
        <div>
          <label className="block font-medium text-slate-600">Payee Name</label>
          <AutoSuggestInput
            theme="modern"
            name="payeeName"
            autoComplete="organization"
            suggestions={["Hong Kong Harp Centre", "HK Harp Centre Limited", "香港豎琴中心有限公司"]}
            historyKey="bo_set_payee"
            value={payeeName}
            onChange={(e) => {
              dirtyRef.current = true;
              setPayeeName(e.target.value);
            }}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="block font-medium text-slate-600">Bank Name</label>
          <AutoSuggestInput
            theme="modern"
            name="bankName"
            autoComplete="on"
            suggestions={[
              "HSBC Hong Kong",
              "Bank of China (Hong Kong)",
              "Hang Seng Bank",
              "Standard Chartered Bank (HK)",
              "Bank of East Asia (BEA)",
              "DBS Bank (Hong Kong)",
            ]}
            historyKey="bo_set_bank"
            value={bankName}
            onChange={(e) => {
              dirtyRef.current = true;
              setBankName(e.target.value);
            }}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-medium text-slate-600">Account Number</label>
            <AutoSuggestInput
              theme="modern"
              name="accountNumber"
              autoComplete="on"
              historyKey="bo_set_acct"
              value={accountNumber}
              onChange={(e) => {
                dirtyRef.current = true;
                setAccountNumber(e.target.value);
              }}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-600">FPS ID</label>
            <AutoSuggestInput
              theme="modern"
              name="fpsId"
              autoComplete="on"
              historyKey="bo_set_fps"
              value={fpsId}
              onChange={(e) => {
                dirtyRef.current = true;
                setFpsId(e.target.value);
              }}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono"
            />
          </div>
        </div>
        <div>
          <label className="block font-medium text-slate-600">Invoice Footer Note</label>
          <AutoSuggestTextarea
            theme="modern"
            name="paymentTermsNote"
            autoComplete="on"
            suggestions={[
              "Please quote Invoice No. on bank transfer and send receipt via WhatsApp / email.",
              "請於銀行入數紙註明發票編號並透過 WhatsApp 或電郵發送付款證明。",
              "Cheque payable to Hong Kong Harp Centre Ltd.",
            ]}
            historyKey="bo_set_terms"
            rows={2}
            value={paymentTermsNote}
            onChange={(e) => {
              dirtyRef.current = true;
              setPaymentTermsNote(e.target.value);
            }}
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "pin">("password");
  const [pin, setPin] = useState("");
  const [staffCode, setStaffCode] = useState("5002");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ code: string; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = mode === "pin" ? { pin } : { staffCode, password };
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; code?: string };
      if (!res.ok) {
        setError({ code: data.code ?? "003", text: data.error ?? "員工編號或密碼錯誤" });
        return;
      }
      router.push("/pos");
      router.refresh();
    } catch {
      setError({ code: "999", text: "伺服器離線，請稍後再試" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#316ac5] p-4 font-[Tahoma,'Microsoft_JhengHei',sans-serif]">
      <div className="w-[410px] border border-[#0a246a] bg-[#f0f0f0] shadow-[8px_8px_20px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between bg-gradient-to-r from-[#0a246a] to-[#a6caf0] px-3 py-2 text-white">
          <span className="text-[13px] font-bold">營運通 - 零售系統</span>
          <span className="text-[11px]">frmLogin1</span>
        </div>
        <div className="p-6">
          <div className="mb-5 text-center">
            <div className="text-[28px] font-bold italic text-[#2e7ec2]">eRun</div>
            <div className="text-[13px] font-bold text-black">POSGV3.3 678</div>
            <div className="mt-1 text-[12px] text-[#444]">香港豎琴中心 · 收銀員登入</div>
          </div>
          <div className="mb-4 flex border border-[#7f9db9] text-[12px]">
            <button type="button" onClick={() => { setMode("password"); setError(null); }} className={`flex-1 px-3 py-1 ${mode === "password" ? "bg-[#316ac5] text-white" : "bg-[#f0f0f0] text-black"}`}>員工編號 / 密碼</button>
            <button type="button" onClick={() => { setMode("pin"); setError(null); }} className={`flex-1 border-l border-[#7f9db9] px-3 py-1 ${mode === "pin" ? "bg-[#316ac5] text-white" : "bg-[#f0f0f0] text-black"}`}>六位收銀密碼</button>
          </div>
          <form onSubmit={(event) => void submitLogin(event)} className="space-y-3 text-[12px] text-black">
            {mode === "password" ? (
              <>
                <label className="grid grid-cols-[90px_1fr] items-center">員工編號<input autoFocus value={staffCode} onChange={(event) => setStaffCode(event.target.value)} className="border border-[#7f9db9] bg-white px-2 py-1.5 font-mono text-[14px]" required /></label>
                <label className="grid grid-cols-[90px_1fr] items-center">密碼<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="border border-[#7f9db9] bg-white px-2 py-1.5 font-mono text-[14px]" required /></label>
              </>
            ) : (
              <label className="grid grid-cols-[90px_1fr] items-center">收銀密碼<input autoFocus type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} className="border border-[#7f9db9] bg-white px-2 py-1.5 text-center font-mono text-[18px] tracking-[0.5em]" required /></label>
            )}
            {error ? <div role="alert" className="border border-[#c00000] bg-[#ffffe1] p-2"><div className="font-bold text-[#2e7ec2]">營運通訊息 - {error.code}</div><div className="mt-1 font-bold text-[#c00000]">{error.text}</div></div> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button type="submit" disabled={submitting} className="border border-[#7f9db9] bg-[#e1dfff] px-7 py-1.5 text-[12px] text-black hover:bg-[#d0ccff] disabled:opacity-40">{submitting ? "登入中…" : "確定"}</button>
              <button type="button" onClick={() => router.push("/")} className="border border-[#7f9db9] bg-[#f0f0f0] px-7 py-1.5 text-[12px] text-black hover:bg-[#e5e1d5]">離開</button>
            </div>
          </form>
          {process.env.NODE_ENV !== "production" ? <div className="mt-5 border-t border-[#d4d0c8] pt-3 text-center text-[10px] text-[#666]">開發帳號：5002 / PIN 000000 · 收銀員：101 / PIN 111111</div> : null}
        </div>
      </div>
    </div>
  );
}

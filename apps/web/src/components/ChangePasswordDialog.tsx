"use client";

import { useState } from "react";

export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [message, setMessage] = useState<{ code: string; text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!newPassword && !newPin) {
      setMessage({ code: "045", text: "請輸入新密碼或 6 位收銀密碼", error: true });
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setMessage({ code: "046", text: "兩次新密碼輸入不一致", error: true });
      return;
    }
    if (newPin && !/^\d{6}$/.test(newPin)) {
      setMessage({ code: "045", text: "收銀密碼必須為 6 位數字", error: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldPassword,
          newPassword: newPassword || undefined,
          newPin: newPin || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? "更改密碼失敗");
      setMessage({ code: data.code ?? "000", text: data.message ?? "密碼已更改", error: false });
      setOldPassword(""); setNewPassword(""); setConfirmPassword(""); setNewPin("");
    } catch (error) {
      setMessage({ code: "003", text: error instanceof Error ? error.message : "更改密碼失敗", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20" role="dialog" aria-modal="true" aria-label="更改密碼">
      <form onSubmit={(event) => void submit(event)} className="w-[420px] border border-[#808080] bg-[#f0f0f0] shadow-xl">
        <div className="border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">更改密碼 / 收銀密碼</div>
        <div className="space-y-3 p-5 text-[12px] text-black">
          <label className="grid grid-cols-[120px_1fr] items-center">舊密碼<input autoFocus type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} className="border border-[#7f9db9] bg-white px-2 py-1" required /></label>
          <label className="grid grid-cols-[120px_1fr] items-center">新密碼 (選填)<input type="password" minLength={6} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="border border-[#7f9db9] bg-white px-2 py-1" /></label>
          <label className="grid grid-cols-[120px_1fr] items-center">再輸入新密碼<input type="password" minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="border border-[#7f9db9] bg-white px-2 py-1" /></label>
          <label className="grid grid-cols-[120px_1fr] items-center">新 6 位 PIN (選填)<input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ""))} className="border border-[#7f9db9] bg-white px-2 py-1 font-mono" /></label>
          {message ? <div className={`border bg-[#ffffe1] p-2 ${message.error ? "border-[#c00000] text-[#c00000]" : "border-[#0a7a2f] text-[#0a7a2f]"}`}>營運通訊息 - {message.code}：{message.text}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#d4d0c8] p-2">
          <button type="submit" disabled={busy} className="border border-[#7f9db9] bg-[#f0f0f0] px-6 py-1 text-[12px] text-black disabled:opacity-40">確定</button>
          <button type="button" onClick={onClose} className="border border-[#7f9db9] bg-[#e1dfff] px-6 py-1 text-[12px] text-black">離開</button>
        </div>
      </form>
    </div>
  );
}

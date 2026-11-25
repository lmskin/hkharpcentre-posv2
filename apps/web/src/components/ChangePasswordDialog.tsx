"use client";

import { useState } from "react";
import { LegacyIcon } from "@/components/LegacyIcons";

export function ChangePasswordDialog({
  staffLabel = "收銀員 (目前登入)",
  onClose,
}: {
  staffLabel?: string;
  onClose: () => void;
}) {
  const [showLockFields, setShowLockFields] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [activeField, setActiveField] = useState<"pwd" | "confirm" | "old" | "pin">("pwd");
  const [message, setMessage] = useState<{ code: string; text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  function appendDigit(digit: string) {
    if (activeField === "pwd") setNewPassword((v) => v + digit);
    else if (activeField === "confirm") setConfirmPassword((v) => v + digit);
    else if (activeField === "old") setOldPassword((v) => v + digit);
    else if (activeField === "pin") setNewPin((v) => (v + digit).slice(0, 6));
  }

  async function submit(event?: React.FormEvent) {
    if (event) event.preventDefault();
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
          oldPassword: oldPassword || undefined,
          newPassword: newPassword || undefined,
          newPin: newPin || undefined,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string; code?: string };
      if (!res.ok) throw new Error(data.error ?? "更改密碼失敗");
      setMessage({ code: data.code ?? "000", text: data.message ?? "密碼已更改", error: false });
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNewPin("");
    } catch (error) {
      setMessage({ code: "003", text: error instanceof Error ? error.message : "更改密碼失敗", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
      role="dialog"
      aria-modal="true"
      aria-label="更改密碼"
      onKeyDown={(e) => {
        if (e.key === "Escape") e.preventDefault();
      }}
    >
      <form
        onSubmit={(event) => void submit(event)}
        className="w-[370px] border border-[#808080] bg-[#f0f0f0] text-black shadow-[4px_4px_10px_rgba(0,0,0,0.45)]"
      >
        {/* Title bar matching Screenshot 026 */}
        <div className="flex items-center justify-between border-b border-[#d4d0c8] bg-white px-2.5 py-1 text-[12px]">
          <span>密碼</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉視窗"
            className="px-1 text-[#666] hover:text-black"
          >
            ✕
          </button>
        </div>

        {/* Subheader: key icon + 更改密碼 */}
        <div className="flex items-center gap-2 px-3 py-2 text-[14px]">
          <span className="text-[20px]">🔑</span>
          <span>更改密碼</span>
        </div>

        <div className="space-y-2.5 px-5 pb-3 text-[12px]">
          {/* 用戶 + 鎖訊 */}
          <div className="grid grid-cols-[44px_64px_1fr_auto] items-center gap-2">
            <LegacyIcon name="manager" className="h-7 w-7 justify-self-center" />
            <span>用戶</span>
            <div className="border border-[#aca899] bg-[#dfdfdf] px-2 py-1 text-center text-[18px] font-normal text-[#444]">
              {staffLabel}
            </div>
            <button
              type="button"
              onClick={() => setShowLockFields((v) => !v)}
              className="border border-[#7f9db9] bg-[#f0f0f0] px-2.5 py-1 text-[12px] hover:bg-[#e5e1d5]"
            >
              鎖訊
            </button>
          </div>

          {showLockFields ? (
            <>
              <label className="grid grid-cols-[44px_64px_1fr] items-center gap-2">
                <span className="justify-self-center text-[16px]">🔒</span>
                <span>舊密碼</span>
                <input
                  name="oldPassword"
                  autoComplete="current-password"
                  type="password"
                  value={oldPassword}
                  onFocus={() => setActiveField("old")}
                  onChange={(event) => setOldPassword(event.target.value)}
                  placeholder="選填（驗證用）"
                  className="border border-[#7f9db9] bg-white px-2 py-1"
                />
              </label>
              <label className="grid grid-cols-[44px_64px_1fr] items-center gap-2">
                <span className="justify-self-center text-[14px]">#</span>
                <span>6位 PIN</span>
                <input
                  name="newPin"
                  autoComplete="one-time-code"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPin}
                  onFocus={() => setActiveField("pin")}
                  onChange={(event) => setNewPin(event.target.value.replace(/\D/g, ""))}
                  placeholder="6位收銀數字密碼"
                  className="border border-[#7f9db9] bg-white px-2 py-1 font-mono"
                />
              </label>
            </>
          ) : null}

          <label className="grid grid-cols-[44px_64px_1fr] items-center gap-2">
            <span className="justify-self-center text-[18px] text-[#2e7ec2]">🔑</span>
            <span>密碼</span>
            <input
              name="newPassword"
              autoComplete="new-password"
              autoFocus
              type="password"
              value={newPassword}
              onFocus={() => setActiveField("pwd")}
              onChange={(event) => setNewPassword(event.target.value)}
              className="border border-[#7f9db9] bg-white px-2 py-1"
            />
          </label>

          <label className="grid grid-cols-[44px_64px_1fr] items-center gap-2">
            <span className="justify-self-center text-[18px] text-[#888]">🔑</span>
            <span>確認密碼</span>
            <input
              name="confirmPassword"
              autoComplete="new-password"
              type="password"
              value={confirmPassword}
              onFocus={() => setActiveField("confirm")}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="border border-[#7f9db9] bg-white px-2 py-1"
            />
          </label>

          {message ? (
            <div
              className={`border bg-[#ffffe1] p-2 ${
                message.error ? "border-[#c00000] text-[#c00000]" : "border-[#0a7a2f] text-[#0a7a2f]"
              }`}
            >
              營運通訊息 - {message.code}：{message.text}
            </div>
          ) : null}

          {/* 4x3 Numeric Touch Keypad matching Screenshot 026 */}
          <div className="mt-2 border border-[#999] bg-[#dcdcdc] p-0.5">
            <div className="grid grid-cols-3 gap-0.5">
              {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => appendDigit(digit)}
                  className="h-14 border border-[#bbb] bg-[#f4f4f4] text-[22px] text-[#222] hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => appendDigit("0")}
                className="h-14 border border-[#bbb] bg-[#f4f4f4] text-[22px] text-[#222] hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
              >
                0
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-14 flex-col items-center justify-center border border-[#bbb] bg-[#f4f4f4] text-[12px] text-black hover:bg-[#e5e1d5]"
              >
                <LegacyIcon name="exit" className="h-5 w-5" />
                <span>取消</span>
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex h-14 flex-col items-center justify-center border border-[#333] bg-[#f4f4f4] text-[12px] text-black hover:bg-[#e5e1d5] disabled:opacity-40"
              >
                <LegacyIcon name="check" className="h-5 w-5" />
                <span>輸入</span>
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

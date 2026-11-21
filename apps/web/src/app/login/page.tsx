"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"pin" | "password">("pin");
  const [pin, setPin] = useState("");
  const [staffCode, setStaffCode] = useState("5002");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const payload = mode === "pin" ? { pin } : { staffCode, password };
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      router.push("/pos");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <h1 className="text-lg font-bold text-slate-900">Staff Authentication</h1>
      <p className="mt-1 text-xs text-slate-500">
        Sign in with your 6-digit POS terminal PIN or Back Office password.
      </p>

      <div className="mt-4 flex gap-2 text-xs font-medium">
        <button
          type="button"
          onClick={() => setMode("pin")}
          className={`flex-1 rounded-lg border py-2 ${
            mode === "pin" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"
          }`}
        >
          6-Digit POS PIN
        </button>
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`flex-1 rounded-lg border py-2 ${
            mode === "password" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700"
          }`}
        >
          Staff ID &amp; Password
        </button>
      </div>

      <form onSubmit={submitLogin} className="mt-4 space-y-4">
        {mode === "pin" ? (
          <div>
            <label className="block text-xs font-medium text-slate-600">POS PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="Enter 6-digit PIN"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono text-lg tracking-widest"
              required
            />
            <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-sm">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "Del"].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (key === "Clear") setPin("");
                    else if (key === "Del") setPin((p) => p.slice(0, -1));
                    else setPin((p) => (p.length < 6 ? p + key : p));
                  }}
                  className="rounded border border-slate-200 py-2 hover:bg-slate-100"
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-600">Staff ID</label>
              <input
                value={staffCode}
                onChange={(e) => setStaffCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                required
              />
            </div>
          </>
        )}

        {error ? (
          <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800">{error}</div>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          {submitting ? "Signing in..." : "Sign In"}
        </button>
      </form>

      {process.env.NODE_ENV !== "production" ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
          <div className="font-semibold">Onboarding Dev Credentials:</div>
          <div>Admin (L5 · ID 5002): PIN <span className="font-mono">000000</span></div>
          <div>Cashier (L1 · ID 101): PIN <span className="font-mono">111111</span></div>
        </div>
      ) : null}
    </div>
  );
}

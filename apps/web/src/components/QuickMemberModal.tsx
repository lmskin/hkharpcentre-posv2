"use client";

import { useEffect, useState } from "react";
import type { PosCustomer } from "@/components/PosRegisterClient";

interface LedgerEntry {
  id: number;
  deltaPoints: number;
  reason: string;
  createdAt: string;
}

export function QuickMemberModal({
  mode,
  customer,
  onClose,
  onSaved,
}: {
  mode: "add" | "edit" | "detail";
  customer?: PosCustomer | null;
  onClose: () => void;
  onSaved: (saved: {
    id: number;
    legacyId: string;
    nameZh: string;
    nameEn: string;
    phone: string;
    address: string;
    cardNo: string;
  }) => void;
}) {
  const [legacyId, setLegacyId] = useState(mode === "edit" ? customer?.legacyId ?? "" : "");
  const [cardNo, setCardNo] = useState(mode === "edit" ? customer?.cardNo ?? "" : "");
  const [nameZh, setNameZh] = useState(mode === "edit" ? customer?.nameZh ?? "" : "");
  const [nameEn, setNameEn] = useState(mode === "edit" ? customer?.nameEn ?? "" : "");
  const [phone, setPhone] = useState(mode === "edit" ? customer?.phone ?? "" : "");
  const [email, setEmail] = useState(mode === "edit" ? customer?.email ?? "" : "");
  const [address, setAddress] = useState(mode === "edit" ? customer?.address ?? "" : "");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode !== "add") return;
    fetch("/api/customers?nextId=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { nextLegacyId?: string } | null) => {
        if (body?.nextLegacyId) {
          setLegacyId((prev) => (prev.trim() === "" ? body.nextLegacyId! : prev));
        }
      })
      .catch(() => {});
  }, [mode]);

  useEffect(() => {
    if (mode !== "detail" || !customer?.id) return;
    fetch(`/api/customers?customerId=${customer.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { ledger?: LedgerEntry[] } | null) => {
        if (Array.isArray(body?.ledger)) setLedger(body.ledger);
      })
      .catch(() => {});
  }, [mode, customer?.id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!nameZh.trim()) {
      setError("請輸入會員姓名");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: mode === "edit" ? customer?.id : undefined,
          legacyId: legacyId.trim() || undefined,
          cardNo: cardNo.trim() || undefined,
          nameZh: nameZh.trim(),
          nameEn: nameEn.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          address: address.trim(),
        }),
      });
      const body = (await res.json()) as { id?: number; legacyId?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? "儲存會員失敗");
      onSaved({
        id: body.id,
        legacyId: body.legacyId ?? legacyId.trim(),
        nameZh: nameZh.trim(),
        nameEn: nameEn.trim(),
        phone: phone.trim(),
        address: address.trim(),
        cardNo: cardNo.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存會員失敗");
    } finally {
      setBusy(false);
    }
  }

  const title = mode === "add" ? "新增會員" : mode === "edit" ? "編輯會員" : "會員卡及積分明細";

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.preventDefault();
      }}
    >
      <div className="w-[440px] border border-[#808080] bg-[#f0f0f0] text-[12px] text-black shadow-xl">
        <div className="border-b border-[#d4d0c8] px-3 py-1 font-bold">{title}</div>
        {mode === "detail" ? (
          <div className="space-y-3 p-4">
            {customer ? (
              <>
                <div className="grid grid-cols-2 gap-2 border border-[#aca899] bg-white p-2">
                  <div>號碼：<strong className="font-mono">{customer.legacyId}</strong></div>
                  <div>卡號：<strong className="font-mono">{customer.cardNo || "-"}</strong></div>
                  <div>姓名：<strong>{customer.nameZh || customer.nameEn}</strong></div>
                  <div>電話：<strong className="font-mono">{customer.phone || "-"}</strong></div>
                  <div>等級：<strong>{customer.gradeName || "一般"}</strong></div>
                  <div>積分結餘：<strong className="font-mono text-[#2e7ec2]">{customer.pointsBalance}</strong></div>
                  <div className="col-span-2">地址：<strong>{customer.address || "-"}</strong></div>
                </div>
                <div className="max-h-48 overflow-auto border border-[#aca899] bg-white">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#e8eef5] text-left">
                        <th className="px-2 py-1">原因</th>
                        <th className="px-2 py-1 text-right">積分變動</th>
                        <th className="px-2 py-1 text-right">時間</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((l) => (
                        <tr key={l.id} className="border-b border-[#eee]">
                          <td className="px-2 py-1">{l.reason}</td>
                          <td className="px-2 py-1 text-right font-mono">{l.deltaPoints > 0 ? `+${l.deltaPoints}` : l.deltaPoints}</td>
                          <td className="px-2 py-1 text-right font-mono">{String(l.createdAt).slice(0, 10)}</td>
                        </tr>
                      ))}
                      {ledger.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-4 text-center text-[#808080]">暫無積分異動記錄</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="p-4 text-center text-[#666]">請先於會員清單選擇一位會員</div>
            )}
            <div className="flex justify-end border-t border-[#d4d0c8] pt-2">
              <button type="button" autoFocus onClick={onClose} className="border border-[#7f9db9] bg-[#e1dfff] px-6 py-1">
                離開
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSave(e)}>
            <div className="space-y-2.5 p-4">
              <label className="grid grid-cols-[100px_1fr] items-center">
                會員編號
                <input
                  name="memberLegacyId"
                  value={legacyId}
                  onChange={(e) => setLegacyId(e.target.value)}
                  disabled={mode === "edit"}
                  placeholder="留空自動編號"
                  className="border border-[#7f9db9] bg-white px-2 py-1 font-mono disabled:bg-[#e8e8e8]"
                />
              </label>
              <label className="grid grid-cols-[100px_1fr] items-center">
                會員卡號
                <input
                  name="memberCardNo"
                  value={cardNo}
                  onChange={(e) => setCardNo(e.target.value)}
                  placeholder="例如 RWC-0001"
                  className="border border-[#7f9db9] bg-white px-2 py-1 font-mono"
                />
              </label>
              <label className="grid grid-cols-[100px_1fr] items-center">
                姓名 (中文)*
                <input
                  name="memberNameZh"
                  required
                  autoFocus
                  value={nameZh}
                  onChange={(e) => setNameZh(e.target.value)}
                  className="border border-[#7f9db9] bg-white px-2 py-1"
                />
              </label>
              <label className="grid grid-cols-[100px_1fr] items-center">
                英文姓名
                <input
                  name="memberNameEn"
                  value={nameEn}
                  onChange={(e) => setNameEn(e.target.value)}
                  className="border border-[#7f9db9] bg-white px-2 py-1"
                />
              </label>
              <label className="grid grid-cols-[100px_1fr] items-center">
                電話
                <input
                  name="memberPhone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="border border-[#7f9db9] bg-white px-2 py-1 font-mono"
                />
              </label>
              <label className="grid grid-cols-[100px_1fr] items-center">
                電郵
                <input
                  name="memberEmail"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border border-[#7f9db9] bg-white px-2 py-1"
                />
              </label>
              <label className="grid grid-cols-[100px_1fr] items-start">
                <span className="pt-1">地址</span>
                <textarea
                  name="memberAddress"
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="送貨 / 簽收地址"
                  className="border border-[#7f9db9] bg-white px-2 py-1"
                />
              </label>
              {error ? <div className="border border-[#c00000] bg-[#ffffe1] p-1.5 text-[#c00000]">{error}</div> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d4d0c8] p-2">
              <button type="submit" disabled={busy} className="border border-[#7f9db9] bg-[#f0f0f0] px-5 py-1 disabled:opacity-40">
                儲存
              </button>
              <button type="button" onClick={onClose} className="border border-[#7f9db9] bg-[#e1dfff] px-5 py-1">
                離開
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

type PrinterKey = "Printer101" | "Printer102" | "Printer103" | "Printer104";
interface Printer { key: PrinterKey; name: string; qty: number; language: "TC" | "SC" | "ENG" }
interface Config { onOff: boolean; printers: Printer[] }
const DEFAULT_CONFIG: Config = { onOff: true, printers: (["Printer101", "Printer102", "Printer103", "Printer104"] as PrinterKey[]).map((key) => ({ key, name: "", qty: 1, language: "TC" })) };

export function PrinterSetupDialog({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/printers").then(async (res) => {
      const data = (await res.json()) as { config?: Config; error?: string };
      if (!res.ok) throw new Error(data.error ?? "讀取印表機設定失敗");
      if (data.config) setConfig(data.config);
    }).catch((error) => setMessage(error instanceof Error ? error.message : "讀取印表機設定失敗"));
  }, []);

  function update(index: number, patch: Partial<Printer>) {
    setConfig((current) => ({ ...current, printers: current.printers.map((printer, i) => i === index ? { ...printer, ...patch } : printer) }));
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const res = await fetch("/api/settings/printers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "儲存失敗");
      setMessage("印表機設定已儲存");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "儲存失敗");
    } finally { setBusy(false); }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20" role="dialog" aria-modal="true" aria-label="印表機設定">
      <div className="w-[650px] border border-[#808080] bg-[#f0f0f0] shadow-xl">
        <div className="border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">印表機設定</div>
        <div className="p-4 text-[12px] text-black">
          <label className="mb-3 flex items-center gap-2"><input type="checkbox" checked={config.onOff} onChange={(event) => setConfig((current) => ({ ...current, onOff: event.target.checked }))} />ONOFF · 啟用收據列印</label>
          <table className="w-full border-collapse bg-white">
            <thead><tr className="bg-[#e8eef5] text-left"><th className="border border-[#aca899] px-2 py-1 font-normal">設定</th><th className="border border-[#aca899] px-2 py-1 font-normal">印表機名稱</th><th className="border border-[#aca899] px-2 py-1 font-normal">Qty</th><th className="border border-[#aca899] px-2 py-1 font-normal">Lang</th></tr></thead>
            <tbody>{config.printers.map((printer, index) => <tr key={printer.key}><td className="border border-[#aca899] px-2 py-1 font-mono">{printer.key}</td><td className="border border-[#aca899] p-1"><input value={printer.name} onChange={(event) => update(index, { name: event.target.value })} className="w-full border border-[#7f9db9] px-2 py-1" placeholder="Windows 印表機名稱" /></td><td className="border border-[#aca899] p-1"><input type="number" min={1} max={9} value={printer.qty} onChange={(event) => update(index, { qty: Number(event.target.value) })} className="w-16 border border-[#7f9db9] px-2 py-1 text-right" /></td><td className="border border-[#aca899] p-1"><select value={printer.language} onChange={(event) => update(index, { language: event.target.value as Printer["language"] })} className="border border-[#7f9db9] bg-white px-2 py-1"><option value="TC">TC</option><option value="SC">SC</option><option value="ENG">ENG</option></select></td></tr>)}</tbody>
          </table>
          {message ? <div className="mt-3 border border-[#aca899] bg-[#ffffe1] p-2">營運通訊息 - 000：{message}</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#d4d0c8] p-2"><button type="button" disabled={busy} onClick={() => void save()} className="border border-[#7f9db9] bg-[#f0f0f0] px-6 py-1 text-[12px] text-black disabled:opacity-40">儲存</button><button type="button" autoFocus onClick={onClose} className="border border-[#7f9db9] bg-[#e1dfff] px-6 py-1 text-[12px] text-black">離開</button></div>
      </div>
    </div>
  );
}

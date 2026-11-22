import type { ReactNode } from "react";

export function currentBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());
}

export function downloadCsvFile(filename: string, rows: Array<Array<string | number>>) {
  const escaped = rows
    .map((row) =>
      row
        .map((cell) => {
          const text = String(cell ?? "");
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([`\uFEFF${escaped}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportShell({
  title,
  controls,
  children,
  error,
  onExportCsv,
  onClose,
}: {
  title: string;
  controls?: ReactNode;
  children: ReactNode;
  error?: string;
  onExportCsv?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 bg-black/10 p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex h-full flex-col border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
        <div className="border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">經理 - {title}</div>
        <div className="flex items-center gap-2 border-b border-[#aca899] p-2 text-[12px] text-black">
          {controls}
          <div className="ml-auto flex items-center gap-2">
            {onExportCsv ? (
              <button type="button" onClick={onExportCsv} className="border border-[#7f9db9] bg-[#f0f0f0] px-4 py-1 hover:bg-[#e5e1d5]">
                匯出 CSV
              </button>
            ) : null}
            <button type="button" onClick={() => window.print()} className="border border-[#7f9db9] bg-[#f0f0f0] px-4 py-1 hover:bg-[#e5e1d5]">
              列印預覽
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-white">{children}</div>
        {error ? <div className="bg-[#ffffe1] px-2 py-1 text-[12px] text-[#c00000]">營運通訊息 - 053：{error}</div> : null}
        <div className="flex justify-end border-t border-[#aca899] p-2"><button type="button" autoFocus onClick={onClose} className="border border-[#7f9db9] bg-[#e1dfff] px-7 py-1 text-[12px] text-black">離開</button></div>
      </div>
    </div>
  );
}

export const reportTable = "w-full border-collapse text-[12px]";
export const reportHeader = "bg-[#e8eef5] text-left text-black";
export const reportCell = "border-b border-[#d4d0c8] px-2 py-1";

"use client";

export type SupportKind = "support" | "internet" | "ip" | "helper" | "manual";

const CONTENT: Record<SupportKind, { title: string; lines: string[] }> = {
  support: { title: "營運通支援", lines: ["eRun Support Hotline：51 888 902", "服務時間：星期一至五 09:00 - 18:00", "版本：eRun POSGV3.3 678"] },
  internet: { title: "互聯網", lines: ["此 POS 採用本機部署。", "互聯網連線及總部同步由系統管理員監察。", "硬件橋接：http://127.0.0.1:17880"] },
  ip: { title: "IP", lines: ["本機 IP：127.0.0.1", "網絡設定請聯絡系統行政。"] },
  helper: { title: "小幫手", lines: ["F1：離開　F4：改價　F5/F6：方法", "F8：重選　F12：完成　Ctrl+W：選價", "對話框請按「離開」或「關閉」。"] },
  manual: { title: "用戶手冊", lines: ["零售：輸入條碼、選擇方法、按完成。", "查單：選擇分類及單據，可預覽、修改、加訂或提貨。", "經理：時報、項報、歷史數據及日結。"] },
};

export function SupportDialog({ kind, shopId, terminalId, onClose }: { kind: SupportKind; shopId: number; terminalId: number; onClose: () => void }) {
  const content = CONTENT[kind];
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/20" role="dialog" aria-modal="true" aria-label={content.title}>
      <div className="w-[480px] border border-[#808080] bg-[#f0f0f0] shadow-xl">
        <div className="border-b border-[#d4d0c8] px-2 py-1 text-[12px] font-bold text-black">{content.title}</div>
        <div className="p-5 text-[13px] text-black">
          <div className="mb-3 text-[20px] font-bold italic text-[#2e7ec2]">eRun</div>
          {content.lines.map((line) => <div key={line} className="py-1">{line}</div>)}
          <div className="mt-4 border-t border-[#d4d0c8] pt-3 font-mono text-[12px]">機號 SN={shopId} / MN={terminalId} · eRun POSGV3.3 678</div>
        </div>
        <div className="flex justify-end border-t border-[#d4d0c8] p-2"><button type="button" autoFocus onClick={onClose} className="border border-[#7f9db9] bg-[#e1dfff] px-7 py-1 text-[12px] text-black">離開</button></div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { formatHkd } from "@hkharp/domain/money";
import { LegacyIcon } from "@/components/LegacyIcons";
import { ReceiptPreview, type ReceiptDetail } from "@/components/ReceiptPreview";
import { DepositPaymentDialog } from "@/components/DepositPaymentDialog";
import { DeliverySetupDialog, getTodayHkt } from "@/components/DeliverySetupDialog";

type QueryTab = "today" | "held" | "office" | "unprocessed";
type InfoMode = "order" | "items" | "payments";
type MatchMode = "prefix" | "contains" | "suffix";
type SubFilter =
  | "last30"
  | "completed"
  | "cancelled"
  | "deposit"
  | "all"
  | "not_received"
  | "received"
  | "rejected"
  | "problem";

type SearchField =
  | "all"
  | "customer_id"
  | "customer_name"
  | "invoice_no"
  | "ubc"
  | "sku"
  | "name"
  | "search_code"
  | "tender"
  | "notes";

interface InvoiceRow {
  invoiceNo: string;
  docType: string;
  status: string;
  paymentStatus: string;
  businessDate: string;
  customerLegacyId: string | null;
  customerName: string | null;
  discountAmountHkd: number;
  netAmountHkd: number;
  paidAmountHkd: number;
  balanceDueHkd: number;
  issuedAtIso: string;
  deliveryStatus: string | null;
  legacyOrl: string | null;
  deliveryRemarks: string | null;
  legacySc: string | null;
  payment1Label: string | null;
  payment2Label: string | null;
}

interface BillItemRow {
  invoiceNo: string;
  issuedAtIso: string;
  businessDate: string;
  sku: string;
  ubc: string | null;
  nameZh: string;
  nameEn: string;
  serialNo: string | null;
  notes: string | null;
  cancelled: boolean;
  quantity: number;
  lineTotalHkd: number;
}

interface BillPaymentRow {
  invoiceNo: string;
  paidAtIso: string;
  businessDate: string;
  tenderCode: string;
  tenderLabel: string;
  amountHkd: number;
  remarks: string | null;
  terminalMn: string | null;
}

const TAB_LABELS: Record<QueryTab, string> = {
  today: "今日銷售",
  held: "暫停單",
  office: "其他交易",
  unprocessed: "未處理單",
};

const SUBFILTER_LABELS: Record<SubFilter, string> = {
  last30: "最後30單",
  completed: "完成單",
  cancelled: "取消單",
  deposit: "落訂單",
  all: "所有單",
  not_received: "未收單",
  received: "已收單",
  rejected: "拒收單",
  problem: "問題單",
};

const CANCEL_REASONS = ["客人取消", "落錯單", "沽清", "試機", "其他"] as const;

const ZH_MONTHS = [
  "一月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "十一月",
  "十二月",
];

function getHkToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());
}

function formatSlashDate(isoDate: string): string {
  return isoDate.replaceAll("-", "/");
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return d.toLocaleTimeString("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function deliveryStatusLabel(row: InvoiceRow): string {
  if (row.legacyOrl?.trim()) return row.legacyOrl.trim();
  const s = (row.deliveryStatus ?? "").toUpperCase();
  if (s === "DELIVERED") return "已收";
  if (s === "REJECTED") return "拒收";
  if (s === "PROBLEM") return "問題";
  if (s === "PENDING") return "未收";
  return s || "待處理";
}

export function BillQueryDialog({
  onClose,
  onLoad,
}: {
  onClose: () => void;
  onLoad: (detail: ReceiptDetail, action: "modify" | "reorder" | "copy_new") => void;
}) {
  const router = useRouter();
  const hkToday = useMemo(() => getHkToday(), []);

  const [tab, setTab] = useState<QueryTab>("today");
  const [subFilter, setSubFilter] = useState<SubFilter>("last30");
  const [dateFilter, setDateFilter] = useState<string>(hkToday);
  const [explicitDate, setExplicitDate] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [infoMode, setInfoMode] = useState<InfoMode>("order");
  const [searchField, setSearchField] = useState<SearchField>("all");
  const [matchMode, setMatchMode] = useState<MatchMode>("contains");
  const [searchInput, setSearchInput] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");

  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [itemRows, setItemRows] = useState<BillItemRow[]>([]);
  const [paymentRows, setPaymentRows] = useState<BillPaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [selectedNo, setSelectedNo] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [previewLang, setPreviewLang] = useState<"TC" | "EN">("TC");
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const fetchSeqRef = useRef(0);
  const detailSeqRef = useRef(0);
  const latestQueryRef = useRef({
    tab,
    subFilter,
    dateFilter,
    explicitDate,
    searchMode,
    infoMode,
    searchField,
    matchMode,
    appliedQuery,
    selectedNo,
  });
  latestQueryRef.current = {
    tab,
    subFilter,
    dateFilter,
    explicitDate,
    searchMode,
    infoMode,
    searchField,
    matchMode,
    appliedQuery,
    selectedNo,
  };

  const [showCalendar, setShowCalendar] = useState(false);
  const [calYear, setCalYear] = useState(() => Number(hkToday.slice(0, 4)));
  const [calMonth, setCalMonth] = useState(() => Number(hkToday.slice(5, 7)) - 1);
  const [showSettings, setShowSettings] = useState(false);

  // Action menus & modals
  const [showReorderMenu, setShowReorderMenu] = useState(false);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState<string>(CANCEL_REASONS[0]);
  const [managerPin, setManagerPin] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);

  const [deliveryModal, setDeliveryModal] = useState<{
    action: "reject" | "problem";
    remarks: string;
  } | null>(null);
  const [receiveAllConfirmOpen, setReceiveAllConfirmOpen] = useState(false);
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [showDeliverySetupDialog, setShowDeliverySetupDialog] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const loadDetail = useCallback(async (invoiceNo: string) => {
    const dSeq = ++detailSeqRef.current;
    setSelectedNo(invoiceNo);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(invoiceNo)}`);
      if (dSeq !== detailSeqRef.current) return;
      if (!res.ok) {
        setDetail(null);
        return;
      }
      const data = (await res.json()) as ReceiptDetail;
      if (dSeq !== detailSeqRef.current) return;
      setDetail(data);
    } finally {
      if (dSeq === detailSeqRef.current) setDetailLoading(false);
    }
  }, []);

  const fetchList = useCallback(
    async (opts?: { preserveDetailNo?: string | null }) => {
      const fSeq = ++fetchSeqRef.current;
      const {
        tab: curTab,
        subFilter: curSub,
        dateFilter: curDate,
        explicitDate: curExplicit,
        searchMode: curSearch,
        infoMode: curInfo,
        searchField: curField,
        matchMode: curMatch,
        appliedQuery: curQuery,
        selectedNo: curSelected,
      } = latestQueryRef.current;
      setLoading(true);
      setErrorMsg(null);
      try {
        const params = new URLSearchParams();
        params.set("view", curTab);
        params.set("subFilter", curSub);
        const effectiveDate =
          !curExplicit &&
          (curSub === "last30" ||
            curTab === "unprocessed" ||
            curTab === "held" ||
            curTab === "office")
            ? "ALL"
            : curDate;
        params.set("date", effectiveDate);
        if (curSearch) {
          params.set("infoMode", curInfo);
          params.set("searchField", curField);
          params.set("matchMode", curMatch);
          if (curQuery.trim()) {
            params.set("q", curQuery.trim());
          }
        } else if (curQuery.trim()) {
          params.set("q", curQuery.trim());
        }

        const res = await fetch(`/api/invoices?${params.toString()}`);
        if (fSeq !== fetchSeqRef.current) return;
        const data = await res.json();
        if (fSeq !== fetchSeqRef.current) return;
        if (!res.ok) {
          setErrorMsg(data.error ?? "查詢失敗");
          return;
        }

        if (curSearch && curInfo === "items") {
          const items = (data.items ?? []) as BillItemRow[];
          setItemRows(items);
          setRows([]);
          setPaymentRows([]);
          const targetNo = opts?.preserveDetailNo ?? items[0]?.invoiceNo ?? null;
          if (targetNo) {
            await loadDetail(targetNo);
          } else {
            setSelectedNo(null);
            setDetail(null);
          }
        } else if (curSearch && curInfo === "payments") {
          const pays = (data.payments ?? []) as BillPaymentRow[];
          setPaymentRows(pays);
          setRows([]);
          setItemRows([]);
          const targetNo = opts?.preserveDetailNo ?? pays[0]?.invoiceNo ?? null;
          if (targetNo) {
            await loadDetail(targetNo);
          } else {
            setSelectedNo(null);
            setDetail(null);
          }
        } else {
          const invs = (data.invoices ?? []) as InvoiceRow[];
          setRows(invs);
          setItemRows([]);
          setPaymentRows([]);
          const targetNo =
            opts?.preserveDetailNo ??
            (curSelected && invs.some((r) => r.invoiceNo === curSelected)
              ? curSelected
              : invs[0]?.invoiceNo ?? null);
          if (targetNo) {
            await loadDetail(targetNo);
          } else if (!opts?.preserveDetailNo) {
            setSelectedNo(null);
            setDetail(null);
          }
        }
      } catch {
        if (fSeq === fetchSeqRef.current) setErrorMsg("網絡錯誤，無法載入單據");
      } finally {
        if (fSeq === fetchSeqRef.current) setLoading(false);
      }
    },
    [loadDetail],
  );

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subFilter, dateFilter, searchMode, infoMode, appliedQuery]);

  function handleTabChange(nextTab: QueryTab) {
    setTab(nextTab);
    setShowReorderMenu(false);
    setStatusFeedback(null);
    if (nextTab === "today") {
      setSubFilter("last30");
    } else if (nextTab === "unprocessed") {
      setSubFilter("not_received");
    } else {
      setSubFilter("all");
    }
    setInfoMode("order");
  }

  function handleExecuteSearch() {
    setAppliedQuery(searchInput);
    if (dateFilter !== "ALL") {
      setDateFilter("ALL");
    }
  }

  const visibleInvoiceNos = useMemo(() => {
    if (searchMode && infoMode === "items") return itemRows.map((r) => r.invoiceNo);
    if (searchMode && infoMode === "payments") return paymentRows.map((r) => r.invoiceNo);
    return rows.map((r) => r.invoiceNo);
  }, [searchMode, infoMode, itemRows, paymentRows, rows]);

  function stepSelection(delta: -1 | 1) {
    if (visibleInvoiceNos.length === 0) return;
    const idx = selectedNo ? visibleInvoiceNos.indexOf(selectedNo) : -1;
    const nextIdx =
      idx < 0
        ? 0
        : Math.max(0, Math.min(visibleInvoiceNos.length - 1, idx + delta));
    const nextNo = visibleInvoiceNos[nextIdx];
    if (nextNo) {
      void loadDetail(nextNo);
    }
  }

  async function handleVoidSubmit() {
    if (!detail) return;
    setVoidBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(detail.bill.invoiceNo)}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: voidReason,
          managerPin: managerPin.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "取消單據失敗");
        return;
      }
      setVoidModalOpen(false);
      setManagerPin("");
      setStatusFeedback(`單據 ${detail.bill.invoiceNo} 已取消`);
      await fetchList({ preserveDetailNo: detail.bill.invoiceNo });
    } finally {
      setVoidBusy(false);
    }
  }

  async function handleDeliveryAction(
    action: "receive" | "reject" | "problem",
    remarks?: string,
  ) {
    if (!detail) return;
    const targetNo = detail.bill.invoiceNo;
    setActionBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/bills/${encodeURIComponent(targetNo)}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "更新提貨狀態失敗");
        return;
      }
      setDeliveryModal(null);
      setShowReorderMenu(false);
      const actionZh =
        action === "receive" ? "已提貨" : action === "reject" ? "已標記拒收" : "已標記問題單";
      setStatusFeedback(`單據 ${targetNo} ${actionZh}`);
      // Keep the acted-upon bill displayed cleanly in ReceiptPreview while refreshing the grid.
      await fetchList({ preserveDetailNo: targetNo });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleReceiveAll() {
    const invoiceNos = rows.map((r) => r.invoiceNo);
    if (invoiceNos.length === 0) {
      setReceiveAllConfirmOpen(false);
      return;
    }
    setActionBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/bills/receive-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceNos }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? "接收所有失敗");
        return;
      }
      setReceiveAllConfirmOpen(false);
      setStatusFeedback(`已接收 ${data.updatedCount ?? invoiceNos.length} 張單據`);
      await fetchList();
    } finally {
      setActionBusy(false);
    }
  }

  // Calendar grid generation (Sunday = 0)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(Date.UTC(calYear, calMonth, 1));
    const startWeekday = firstDay.getUTCDay();
    const daysInMonth = new Date(Date.UTC(calYear, calMonth + 1, 0)).getUTCDate();
    const cells: Array<{ day: number | null; iso: string | null }> = [];
    for (let i = 0; i < startWeekday; i += 1) {
      cells.push({ day: null, iso: null });
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      const mm = String(calMonth + 1).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      cells.push({ day: d, iso: `${calYear}-${mm}-${dd}` });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, iso: null });
    }
    return cells;
  }, [calYear, calMonth]);

  const activeCount =
    searchMode && infoMode === "items"
      ? itemRows.length
      : searchMode && infoMode === "payments"
        ? paymentRows.length
        : rows.length;

  const headerDateLabel =
    dateFilter === "ALL" ? "全部日期" : formatSlashDate(dateFilter);

  return (
    <div
      data-testid="bill-query-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="查單"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-1 select-none"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="relative flex h-[96vh] w-[98vw] max-w-[1380px] flex-col border-2 border-[#08246b] bg-[#d4d0c8] text-xs shadow-2xl">
        {/* Top VB6 Toolbar */}
        <div className="relative flex items-center gap-1 border-b border-[#808080] bg-[#d4d0c8] px-1.5 py-1">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 min-w-[64px] items-center justify-center gap-1 border border-[#808080] bg-[#ece9d8] px-2 font-bold text-[#8b0000] shadow-[inset_1px_1px_0_#fff] hover:bg-[#fff3e0] active:translate-y-[1px]"
          >
            <LegacyIcon name="exit" className="h-5 w-5" />
            <span>離開</span>
          </button>

          {(["today", "held", "office", "unprocessed"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => handleTabChange(t)}
                className={`h-11 min-w-[76px] border px-2 font-bold shadow-[inset_1px_1px_0_#fff] ${
                  active
                    ? "border-[#0a246a] bg-[#ffe6a0] text-[#0a246a]"
                    : "border-[#808080] bg-[#d4d0c8] text-[#111] hover:bg-[#e5e2da]"
                }`}
              >
                {TAB_LABELS[t]}
              </button>
            );
          })}

          {/* Center Periwinkle Header OR Search Mode Controls */}
          {searchMode ? (
            <div className="flex flex-1 flex-wrap items-center gap-1.5 border border-[#7f9db9] bg-[#c8d4f0] px-2 py-1">
              <label className="flex items-center gap-1 font-bold text-[#0a246a]">
                <span>搜尋準則</span>
                <select
                  aria-label="搜尋準則"
                  value={searchField}
                  onChange={(e) => setSearchField(e.target.value as SearchField)}
                  className="h-7 border border-[#7f9db9] bg-white px-1.5 text-xs font-normal text-black"
                >
                  <option value="all">綜合 / 全部</option>
                  <option value="invoice_no">單號</option>
                  <option value="customer_id">會員編號</option>
                  <option value="customer_name">會員姓名</option>
                  <option value="ubc">條碼 (UBC)</option>
                  <option value="sku">貨品編號 (SKU)</option>
                  <option value="name">貨品名稱</option>
                  <option value="search_code">貨品簡稱</option>
                  <option value="tender">付款方式</option>
                  <option value="notes">備註</option>
                </select>
              </label>

              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleExecuteSearch();
                  }
                }}
                placeholder="搜尋單號 / 會員 / 電話"
                className="h-7 min-w-[180px] flex-1 border border-[#7f9db9] bg-white px-2 text-xs text-black"
              />

              <div className="flex items-center gap-0.5">
                {(
                  [
                    ["prefix", "ab..."],
                    ["contains", "..ab.."],
                    ["suffix", "...ab"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMatchMode(m)}
                    className={`h-7 border px-1.5 font-mono text-[11px] font-bold ${
                      matchMode === m
                        ? "border-[#0a246a] bg-[#0a246a] text-white"
                        : "border-[#808080] bg-[#ece9d8] text-[#222]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                title="執行搜尋"
                onClick={handleExecuteSearch}
                className="flex h-7 items-center gap-1 border border-[#4c1d95] bg-[#6d28d9] px-2.5 font-bold text-white hover:bg-[#5b21b6]"
              >
                <span>🔍</span>
                <span>執行搜尋</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowSettings(false);
                setShowCalendar((v) => !v);
              }}
              className="flex h-11 flex-1 items-center justify-center border border-[#7f9db9] bg-[#b8c4ea] px-3 text-sm font-bold text-[#000080] shadow-inner hover:bg-[#c5cff0]"
            >
              {headerDateLabel} ({TAB_LABELS[tab]} - {SUBFILTER_LABELS[subFilter]} - {activeCount})
            </button>
          )}

          {/* Right Header Icons: Calendar, Search Toggle, Settings */}
          <button
            type="button"
            title="日期"
            onClick={() => {
              setShowSettings(false);
              setShowCalendar((v) => !v);
            }}
            className={`flex h-11 w-12 flex-col items-center justify-center border shadow-[inset_1px_1px_0_#fff] ${
              showCalendar
                ? "border-[#0a246a] bg-[#ffe6a0]"
                : "border-[#808080] bg-[#d4d0c8] hover:bg-[#e5e2da]"
            }`}
          >
            <LegacyIcon name="calendar" className="h-5 w-5" />
            <span className="text-[10px] leading-none">日期</span>
          </button>

          <button
            type="button"
            title="搜尋"
            onClick={() => {
              setShowCalendar(false);
              setShowSettings(false);
              setSearchMode((prev) => {
                const next = !prev;
                if (!next) {
                  setInfoMode("order");
                  setAppliedQuery("");
                  setSearchInput("");
                }
                return next;
              });
            }}
            className={`flex h-11 w-12 flex-col items-center justify-center border shadow-[inset_1px_1px_0_#fff] ${
              searchMode
                ? "border-[#4c1d95] bg-[#ddd6fe] text-[#4c1d95]"
                : "border-[#808080] bg-[#d4d0c8] hover:bg-[#e5e2da]"
            }`}
          >
            <span className="text-sm leading-none" aria-hidden="true">🔍</span>
            <span className="mt-0.5 text-[10px] font-bold leading-none">搜尋</span>
          </button>

          <div className="relative">
            <button
              type="button"
              title="設定"
              onClick={() => {
                setShowCalendar(false);
                setShowSettings((v) => !v);
              }}
              className="flex h-11 w-11 flex-col items-center justify-center border border-[#808080] bg-[#d4d0c8] shadow-[inset_1px_1px_0_#fff] hover:bg-[#e5e2da]"
            >
              <span className="text-sm leading-none" aria-hidden="true">⚙️</span>
              <span className="mt-0.5 text-[10px] leading-none">設定</span>
            </button>

            {showSettings && (
              <div className="absolute right-0 top-12 z-30 w-52 border-2 border-[#0a246a] bg-[#ece9d8] p-2.5 shadow-xl">
                <div className="mb-2 border-b border-[#aca899] pb-1 font-bold text-[#0a246a]">
                  查詢顯示設定
                </div>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={dateFilter === "ALL"}
                    onChange={(e) => {
                      setExplicitDate(true);
                      setDateFilter(e.target.checked ? "ALL" : hkToday);
                      setShowSettings(false);
                    }}
                  />
                  <span>全部日期</span>
                </label>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="border border-[#808080] bg-[#d4d0c8] px-2 py-0.5 text-[11px]"
                  >
                    關閉
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Screen 015 Calendar Popup */}
          {showCalendar && (
            <div
              data-testid="bill-query-calendar"
              className="absolute right-14 top-12 z-30 w-72 border-2 border-[#0a246a] bg-[#f4f2ec] p-2 shadow-2xl"
            >
              <div className="mb-1.5 flex items-center justify-between bg-[#0a246a] px-2 py-1 text-white">
                <button
                  type="button"
                  aria-label="上個月"
                  onClick={() => {
                    if (calMonth === 0) {
                      setCalYear((y) => y - 1);
                      setCalMonth(11);
                    } else {
                      setCalMonth((m) => m - 1);
                    }
                  }}
                  className="px-1.5 font-bold hover:bg-white/20"
                >
                  ◀
                </button>
                <span className="font-bold">
                  公元 {calYear} 年 {ZH_MONTHS[calMonth]}
                </span>
                <button
                  type="button"
                  aria-label="下個月"
                  onClick={() => {
                    if (calMonth === 11) {
                      setCalYear((y) => y + 1);
                      setCalMonth(0);
                    } else {
                      setCalMonth((m) => m + 1);
                    }
                  }}
                  className="px-1.5 font-bold hover:bg-white/20"
                >
                  ▶
                </button>
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] font-bold text-[#003399]">
                {["週日", "週一", "週二", "週三", "週四", "週五", "週六"].map((w) => (
                  <div key={w} className="py-1">
                    {w}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-0.5 text-center">
                {calendarDays.map((cell, i) => {
                  if (!cell.day || !cell.iso) {
                    return <div key={`empty-${i}`} className="h-7" />;
                  }
                  const selected = cell.iso === dateFilter;
                  const isToday = cell.iso === hkToday;
                  return (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => {
                        setExplicitDate(true);
                        setDateFilter(cell.iso!);
                        if (subFilter === "last30") {
                          setSubFilter("all");
                        }
                        setShowCalendar(false);
                      }}
                      className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs ${
                        selected
                          ? "border-2 border-red-600 bg-red-50 font-bold text-red-700"
                          : isToday
                            ? "border border-[#0a246a] font-bold text-[#0a246a] hover:bg-[#dce6ff]"
                            : "text-[#111] hover:bg-[#dce6ff]"
                      }`}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 flex items-center justify-between border-t border-[#aca899] pt-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setExplicitDate(true);
                    setDateFilter(hkToday);
                    setCalYear(Number(hkToday.slice(0, 4)));
                    setCalMonth(Number(hkToday.slice(5, 7)) - 1);
                    if (subFilter === "last30") {
                      setSubFilter("all");
                    }
                    setShowCalendar(false);
                  }}
                  className="font-bold text-[#cc0000] hover:underline"
                >
                  今天: {formatSlashDate(hkToday)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExplicitDate(true);
                    setDateFilter("ALL");
                    if (subFilter === "last30") {
                      setSubFilter("all");
                    }
                    setShowCalendar(false);
                  }}
                  className="border border-[#808080] bg-[#ece9d8] px-2 py-0.5 font-bold text-[#003399] hover:bg-white"
                >
                  全部日期
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Main 3-Column Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Preview + Vertical Strip */}
          <div className="flex w-[320px] shrink-0 border-r border-[#808080] bg-[#ece9d8]">
            {/* Far-left Vertical Preview Icon Strip */}
            <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[#aca899] bg-[#d4d0c8] py-1.5">
              <button
                type="button"
                title="整單預覽"
                onClick={() => setInfoMode("order")}
                className="flex w-10 flex-col items-center border border-[#808080] bg-[#ece9d8] py-1 text-[10px] leading-tight hover:bg-white"
              >
                <span aria-hidden="true">📄</span>
                <span>整單</span>
              </button>
              <button
                type="button"
                title="項目明細"
                onClick={() => {
                  if (searchMode) setInfoMode("items");
                }}
                className="flex w-10 flex-col items-center border border-[#808080] bg-[#ece9d8] py-1 text-[10px] leading-tight hover:bg-white"
              >
                <span aria-hidden="true">📋</span>
                <span>明細</span>
              </button>
              <button
                type="button"
                title="正式發票"
                disabled={!detail}
                onClick={() => {
                  if (!detail) return;
                  router.push(`/invoices/${encodeURIComponent(detail.bill.invoiceNo)}/print`);
                }}
                className="flex w-10 flex-col items-center border border-[#808080] bg-[#ffe6a0] py-1 text-[10px] font-bold leading-tight text-[#0a246a] hover:bg-[#fff1c2] disabled:opacity-40"
              >
                <span aria-hidden="true">🧾</span>
                <span>正式發票</span>
              </button>
              <button
                type="button"
                title="向上捲動"
                onClick={() => previewScrollRef.current?.scrollBy({ top: -140, behavior: "smooth" })}
                className="flex h-7 w-10 items-center justify-center border border-[#808080] bg-[#ece9d8] text-xs font-bold hover:bg-white"
              >
                ▲
              </button>
              <button
                type="button"
                title="向下捲動"
                onClick={() => previewScrollRef.current?.scrollBy({ top: 140, behavior: "smooth" })}
                className="flex h-7 w-10 items-center justify-center border border-[#808080] bg-[#ece9d8] text-xs font-bold hover:bg-white"
              >
                ▼
              </button>
              <button
                type="button"
                title="語文切換"
                onClick={() => setPreviewLang((l) => (l === "TC" ? "EN" : "TC"))}
                className="flex w-10 flex-col items-center border border-[#808080] bg-[#ece9d8] py-1 text-[10px] font-bold leading-tight text-[#003399] hover:bg-white"
              >
                <span>語文</span>
                <span>{previewLang}</span>
              </button>
              <button
                type="button"
                title="列印預覽"
                onClick={() => window.print()}
                className="flex w-10 flex-col items-center border border-[#808080] bg-[#ece9d8] py-1 text-[10px] leading-tight hover:bg-white"
              >
                <LegacyIcon name="print" className="h-4 w-4" />
                <span>列印</span>
              </button>
            </div>

            {/* Receipt Paper Preview */}
            <div
              ref={previewScrollRef}
              className="flex-1 overflow-y-auto bg-white p-2 text-black shadow-inner"
            >
              {detailLoading ? (
                <div className="py-12 text-center text-[#666]">載入單據明細中...</div>
              ) : detail ? (
                <ReceiptPreview
                  detail={detail}
                  deliveryNoteMode={tab === "unprocessed"}
                  lang={previewLang}
                />
              ) : (
                <div className="py-12 text-center text-[#666]">請選擇單據以檢視明細</div>
              )}
            </div>
          </div>

          {/* Center Cream Data Grid (#ffffe8) */}
          <div className="flex min-w-0 flex-1 flex-col bg-[#ffffe8]">
            {errorMsg && (
              <div className="border-b border-red-400 bg-red-100 px-3 py-1 font-bold text-red-700">
                {errorMsg}
              </div>
            )}
            {statusFeedback && (
              <div className="border-b border-emerald-400 bg-emerald-50 px-3 py-1 font-bold text-emerald-800">
                {statusFeedback}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-auto">
              {loading ? (
                <div className="py-16 text-center text-[#003399]">查詢中...</div>
              ) : searchMode && infoMode === "items" ? (
                /* Screen 017 Items Grid */
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#ece9d8] text-[#111] shadow-[0_1px_0_#808080]">
                    <tr>
                      <th className="border-r border-[#aca899] px-1.5 py-1">日期</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">單號</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">貨號</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">條碼</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">貨品名稱</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">序號</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">備註</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-center">取消</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">數量</th>
                      <th className="px-1.5 py-1 text-right">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-12 text-center text-[#666]">
                          沒有符合條件的項目紀錄
                        </td>
                      </tr>
                    ) : (
                      itemRows.map((item, idx) => {
                        const isSel = selectedNo === item.invoiceNo;
                        return (
                          <tr
                            key={`${item.invoiceNo}-${item.sku}-${idx}`}
                            onClick={() => void loadDetail(item.invoiceNo)}
                            className={`cursor-pointer border-b border-[#e8e4c8] ${
                              isSel ? "bg-[#cce4ff]" : "hover:bg-[#f6f1c5]"
                            } ${item.cancelled ? "text-[#cc0000]" : "text-[#003399]"}`}
                          >
                            <td className="px-1.5 py-1 whitespace-nowrap">
                              {item.businessDate}
                            </td>
                            <td className="px-1.5 py-1 font-mono font-bold whitespace-nowrap">
                              {item.invoiceNo}
                            </td>
                            <td className="px-1.5 py-1 font-mono whitespace-nowrap">{item.sku}</td>
                            <td className="px-1.5 py-1 font-mono whitespace-nowrap">
                              {item.ubc ?? "-"}
                            </td>
                            <td className="px-1.5 py-1">{item.nameZh || item.nameEn}</td>
                            <td className="px-1.5 py-1 font-mono">{item.serialNo ?? ""}</td>
                            <td className="px-1.5 py-1">{item.notes ?? ""}</td>
                            <td className="px-1.5 py-1 text-center font-bold">
                              {item.cancelled ? "C" : ""}
                            </td>
                            <td className="px-1.5 py-1 text-right font-mono">{item.quantity}</td>
                            <td className="px-1.5 py-1 text-right font-mono">
                              {formatHkd(item.lineTotalHkd)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              ) : searchMode && infoMode === "payments" ? (
                /* Screen 018 Payments Grid */
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#ece9d8] text-[#111] shadow-[0_1px_0_#808080]">
                    <tr>
                      <th className="border-r border-[#aca899] px-1.5 py-1">時間</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">單號</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">付款</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">金額</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">備註</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">機號</th>
                      <th className="px-1.5 py-1">日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-[#666]">
                          沒有符合條件的付款紀錄
                        </td>
                      </tr>
                    ) : (
                      paymentRows.map((p, idx) => {
                        const isSel = selectedNo === p.invoiceNo;
                        return (
                          <tr
                            key={`${p.invoiceNo}-${p.tenderCode}-${idx}`}
                            onClick={() => void loadDetail(p.invoiceNo)}
                            className={`cursor-pointer border-b border-[#e8e4c8] text-[#003399] ${
                              isSel ? "bg-[#cce4ff]" : "hover:bg-[#f6f1c5]"
                            }`}
                          >
                            <td className="px-1.5 py-1 font-mono whitespace-nowrap">
                              {formatShortTime(p.paidAtIso)}
                            </td>
                            <td className="px-1.5 py-1 font-mono font-bold whitespace-nowrap">
                              {p.invoiceNo}
                            </td>
                            <td className="px-1.5 py-1">{p.tenderLabel || p.tenderCode}</td>
                            <td className="px-1.5 py-1 text-right font-mono">
                              {formatHkd(p.amountHkd)}
                            </td>
                            <td className="px-1.5 py-1">{p.remarks ?? ""}</td>
                            <td className="px-1.5 py-1 font-mono">{p.terminalMn ?? ""}</td>
                            <td className="px-1.5 py-1 whitespace-nowrap">{p.businessDate}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              ) : tab === "unprocessed" ? (
                /* Screen 005 / 011-014 Unprocessed / Delivery 10-Column Grid */
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#ece9d8] text-[#111] shadow-[0_1px_0_#808080]">
                    <tr>
                      <th className="border-r border-[#aca899] px-1.5 py-1">日期</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">單號</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">會員</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">客戶名稱</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">狀態</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">貨期/備註</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">金額</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">已付</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">尚欠</th>
                      <th className="px-1.5 py-1">職員</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="py-12 text-center text-[#666]">
                          目前分類沒有單據
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => {
                        const isSel = selectedNo === r.invoiceNo;
                        const statusUpper = (r.status ?? "").toUpperCase();
                        const isCancelled = statusUpper === "CANCELLED" || statusUpper === "VOIDED";
                        return (
                          <tr
                            key={r.invoiceNo}
                            onClick={() => void loadDetail(r.invoiceNo)}
                            className={`cursor-pointer border-b border-[#e8e4c8] ${
                              isSel ? "bg-[#cce4ff]" : "hover:bg-[#f6f1c5]"
                            } ${isCancelled ? "text-[#cc0000]" : "text-[#003399]"}`}
                          >
                            <td className="px-1.5 py-1 whitespace-nowrap">{r.businessDate}</td>
                            <td className="px-1.5 py-1 font-mono font-bold whitespace-nowrap">
                              {isSel ? "▸ " : ""}
                              {r.invoiceNo}
                            </td>
                            <td className="px-1.5 py-1 font-mono whitespace-nowrap">
                              {r.customerLegacyId ?? "-"}
                            </td>
                            <td className="px-1.5 py-1">{r.customerName ?? "散客"}</td>
                            <td className="px-1.5 py-1 font-bold">{deliveryStatusLabel(r)}</td>
                            <td className="px-1.5 py-1">{r.deliveryRemarks ?? ""}</td>
                            <td className="px-1.5 py-1 text-right font-mono">
                              {formatHkd(r.netAmountHkd)}
                            </td>
                            <td className="px-1.5 py-1 text-right font-mono">
                              {formatHkd(r.paidAmountHkd)}
                            </td>
                            <td className="px-1.5 py-1 text-right font-mono">
                              {formatHkd(r.balanceDueHkd)}
                            </td>
                            <td className="px-1.5 py-1">{r.legacySc ?? "-"}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              ) : (
                /* Screen 002-004 / 007-010 Standard Sales / Held / Office Order Grid */
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[#ece9d8] text-[#111] shadow-[0_1px_0_#808080]">
                    <tr>
                      <th className="w-5 border-r border-[#aca899] px-1 py-1 text-center">▸</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">日期/時間</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">單號</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">會員編號</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">會員姓名</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">折讓</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">實收金額</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1 text-right">已付</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">付款1</th>
                      <th className="border-r border-[#aca899] px-1.5 py-1">付款2</th>
                      <th className="px-1.5 py-1">狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-12 text-center text-[#666]">
                          沒有符合條件的單據
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => {
                        const isSel = selectedNo === r.invoiceNo;
                        const statusUpper = (r.status ?? "").toUpperCase();
                        const isCancelled = statusUpper === "CANCELLED" || statusUpper === "VOIDED";
                        const payStatusUpper = (r.paymentStatus ?? "").toUpperCase();
                        const statusFlags = [
                          isCancelled ? "C" : null,
                          r.discountAmountHkd > 0 ? "D" : null,
                          (r.deliveryStatus ?? "").toUpperCase() === "DELIVERED" ? "P" : null,
                        ]
                          .filter(Boolean)
                          .join(",");
                        return (
                          <tr
                            key={r.invoiceNo}
                            onClick={() => void loadDetail(r.invoiceNo)}
                            className={`cursor-pointer border-b border-[#e8e4c8] ${
                              isSel ? "bg-[#cce4ff]" : "hover:bg-[#f6f1c5]"
                            } ${isCancelled ? "text-[#cc0000]" : "text-[#003399]"}`}
                          >
                            <td className="px-1 py-1 text-center font-bold">
                              {isSel ? "▸" : ""}
                            </td>
                            <td className="px-1.5 py-1 font-mono whitespace-nowrap">
                              {r.businessDate} {formatShortTime(r.issuedAtIso)}
                            </td>
                            <td className="px-1.5 py-1 font-mono font-bold whitespace-nowrap">
                              {r.invoiceNo}
                            </td>
                            <td className="px-1.5 py-1 font-mono whitespace-nowrap">
                              {r.customerLegacyId ?? "-"}
                            </td>
                            <td className="px-1.5 py-1">{r.customerName ?? "散客"}</td>
                            <td className="px-1.5 py-1 text-right font-mono">
                              {formatHkd(r.discountAmountHkd)}
                            </td>
                            <td className="px-1.5 py-1 text-right font-mono font-bold">
                              {formatHkd(r.netAmountHkd)}
                            </td>
                            <td className="px-1.5 py-1 text-right font-mono">
                              {formatHkd(r.paidAmountHkd)}
                            </td>
                            <td className="px-1.5 py-1 whitespace-nowrap">
                              {r.payment1Label ?? "-"}
                            </td>
                            <td className="px-1.5 py-1 whitespace-nowrap">
                              {r.payment2Label ?? "-"}
                            </td>
                            <td className="px-1.5 py-1 font-mono font-bold">
                              {isCancelled
                                ? "已取消"
                                : payStatusUpper === "DEPOSIT" || r.balanceDueHkd > 0
                                  ? `落訂 ${statusFlags}`.trim()
                                  : statusFlags || "完成"}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right Vertical Sub-Filter Rail */}
          <div className="flex w-[98px] shrink-0 flex-col gap-1 border-l border-[#808080] bg-[#d4d0c8] p-1">
            {searchMode ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSearchMode(false);
                    setInfoMode("order");
                    setAppliedQuery("");
                    setSearchInput("");
                  }}
                  className="h-12 border border-[#808080] bg-[#ece9d8] font-bold text-[#8b0000] shadow-[inset_1px_1px_0_#fff] hover:bg-white"
                >
                  返回
                </button>
                {(
                  [
                    ["order", "整單資訊"],
                    ["items", "項資訊"],
                    ["payments", "付款資訊"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setInfoMode(m)}
                    className={`h-12 border font-bold shadow-[inset_1px_1px_0_#fff] ${
                      infoMode === m
                        ? "border-[#0a246a] bg-[#ffe6a0] text-[#0a246a]"
                        : "border-[#808080] bg-[#ece9d8] text-[#111] hover:bg-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </>
            ) : tab === "unprocessed" ? (
              <>
                <button
                  type="button"
                  onClick={() => handleTabChange("today")}
                  className="h-11 border border-[#808080] bg-[#ece9d8] font-bold text-[#8b0000] shadow-[inset_1px_1px_0_#fff] hover:bg-white"
                >
                  返回
                </button>
                {(
                  [
                    ["not_received", "未收單"],
                    ["received", "已收單"],
                    ["rejected", "拒收單"],
                    ["problem", "問題單"],
                    ["all", "所有單"],
                  ] as const
                ).map(([sf, label]) => (
                  <button
                    key={sf}
                    type="button"
                    onClick={() => setSubFilter(sf)}
                    className={`h-11 border font-bold shadow-[inset_1px_1px_0_#fff] ${
                      subFilter === sf
                        ? "border-[#0a246a] bg-[#ffe6a0] text-[#0a246a]"
                        : "border-[#808080] bg-[#ece9d8] text-[#111] hover:bg-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSubFilter("not_received")}
                  className="h-11 border border-[#808080] bg-[#ece9d8] font-bold text-[#003399] shadow-[inset_1px_1px_0_#fff] hover:bg-white"
                >
                  外送單
                </button>
              </>
            ) : tab === "held" || tab === "office" ? (
              <>
                <button
                  type="button"
                  onClick={() => setSubFilter("all")}
                  className={`h-12 border font-bold shadow-[inset_1px_1px_0_#fff] ${
                    subFilter === "all"
                      ? "border-[#0a246a] bg-[#ffe6a0] text-[#0a246a]"
                      : "border-[#808080] bg-[#ece9d8] text-[#111]"
                  }`}
                >
                  所有單
                </button>
                <button
                  type="button"
                  onClick={() => setSubFilter("last30")}
                  className={`h-12 border font-bold shadow-[inset_1px_1px_0_#fff] ${
                    subFilter === "last30"
                      ? "border-[#0a246a] bg-[#ffe6a0] text-[#0a246a]"
                      : "border-[#808080] bg-[#ece9d8] text-[#111]"
                  }`}
                >
                  最後30單
                </button>
              </>
            ) : (
              (
                [
                  ["last30", "最後30單"],
                  ["completed", "完成單"],
                  ["cancelled", "取消單"],
                  ["deposit", "落訂單"],
                  ["all", "所有單"],
                ] as const
              ).map(([sf, label]) => (
                <button
                  key={sf}
                  type="button"
                  onClick={() => setSubFilter(sf)}
                  className={`h-12 border font-bold shadow-[inset_1px_1px_0_#fff] ${
                    subFilter === sf
                      ? "border-[#0a246a] bg-[#ffe6a0] text-[#0a246a]"
                      : "border-[#808080] bg-[#ece9d8] text-[#111] hover:bg-white"
                  }`}
                >
                  {label}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="relative flex items-center justify-between border-t border-[#808080] bg-[#d4d0c8] px-2 py-1.5">
          {tab === "unprocessed" ? (
            <div className="flex w-full items-center gap-2">
              <button
                type="button"
                disabled={!detail || actionBusy}
                onClick={() =>
                  setDeliveryModal({
                    action: "reject",
                    remarks: detail?.bill.notes ?? "",
                  })
                }
                className="h-10 min-w-[84px] border border-[#808080] bg-[#ece9d8] px-3 font-bold text-[#991b1b] shadow-[inset_1px_1px_0_#fff] hover:bg-white disabled:opacity-40"
              >
                拒收
              </button>
              <button
                type="button"
                disabled={!detail || actionBusy}
                onClick={() =>
                  setDeliveryModal({
                    action: "problem",
                    remarks: detail?.bill.notes ?? "",
                  })
                }
                className="h-10 min-w-[84px] border border-[#808080] bg-[#ece9d8] px-3 font-bold text-[#92400e] shadow-[inset_1px_1px_0_#fff] hover:bg-white disabled:opacity-40"
              >
                問題
              </button>
              <button
                type="button"
                aria-label="上一張"
                onClick={() => stepSelection(-1)}
                className="flex h-10 w-10 items-center justify-center border border-[#808080] bg-[#ece9d8] font-bold shadow-[inset_1px_1px_0_#fff] hover:bg-white"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="下一張"
                onClick={() => stepSelection(1)}
                className="flex h-10 w-10 items-center justify-center border border-[#808080] bg-[#ece9d8] font-bold shadow-[inset_1px_1px_0_#fff] hover:bg-white"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={!detail}
                onClick={() => {
                  if (detail) onLoad(detail, "modify");
                }}
                className="h-10 min-w-[84px] border border-[#808080] bg-[#ece9d8] px-3 font-bold text-[#003399] shadow-[inset_1px_1px_0_#fff] hover:bg-white disabled:opacity-40"
              >
                修改
              </button>
              <button
                type="button"
                disabled={!detail}
                onClick={() => setShowDeliverySetupDialog(true)}
                className="h-10 border border-[#808080] bg-[#fff8dc] px-3 font-bold text-[#7c2d12] shadow-[inset_1px_1px_0_#fff] hover:bg-white disabled:opacity-40"
              >
                送貨設定
              </button>
              <div className="flex-1" />
              <button
                type="button"
                disabled={!detail || actionBusy}
                onClick={() => void handleDeliveryAction("receive")}
                className="h-10 min-w-[96px] border border-[#065f46] bg-[#d1fae5] px-3 font-bold text-[#065f46] shadow-[inset_1px_1px_0_#fff] hover:bg-[#a7f3d0] disabled:opacity-40"
              >
                選單接收
              </button>
              <button
                type="button"
                disabled={rows.length === 0 || actionBusy}
                onClick={() => setReceiveAllConfirmOpen(true)}
                className="h-10 min-w-[96px] border border-[#0a246a] bg-[#dbeafe] px-3 font-bold text-[#0a246a] shadow-[inset_1px_1px_0_#fff] hover:bg-[#bfdbfe] disabled:opacity-40"
              >
                接收所有
              </button>
            </div>
          ) : (
            <div className="flex w-full items-center gap-2">
              <button
                type="button"
                disabled={
                  !detail ||
                  ["CANCELLED", "VOIDED"].includes((detail.bill.status ?? "").toUpperCase())
                }
                onClick={() => {
                  setVoidReason(CANCEL_REASONS[0]);
                  setManagerPin("");
                  setVoidModalOpen(true);
                }}
                className="h-10 min-w-[84px] border border-[#808080] bg-[#ece9d8] px-3 font-bold text-[#cc0000] shadow-[inset_1px_1px_0_#fff] hover:bg-white disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                aria-label="上一張"
                onClick={() => stepSelection(-1)}
                className="flex h-10 w-10 items-center justify-center border border-[#808080] bg-[#ece9d8] font-bold shadow-[inset_1px_1px_0_#fff] hover:bg-white"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="下一張"
                onClick={() => stepSelection(1)}
                className="flex h-10 w-10 items-center justify-center border border-[#808080] bg-[#ece9d8] font-bold shadow-[inset_1px_1px_0_#fff] hover:bg-white"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={!detail}
                onClick={() => {
                  if (detail) onLoad(detail, "modify");
                }}
                className="h-10 min-w-[84px] border border-[#808080] bg-[#ece9d8] px-3 font-bold text-[#003399] shadow-[inset_1px_1px_0_#fff] hover:bg-white disabled:opacity-40"
              >
                修改
              </button>

              <div className="relative">
                <button
                  type="button"
                  disabled={!detail}
                  onClick={() => setShowReorderMenu((v) => !v)}
                  className="h-10 min-w-[100px] border border-[#0a246a] bg-[#ece9d8] px-3 font-bold text-[#0a246a] shadow-[inset_1px_1px_0_#fff] hover:bg-[#ffe6a0] disabled:opacity-40"
                >
                  加訂/提貨
                </button>
                {showReorderMenu && detail && (
                  <div className="absolute bottom-11 left-0 z-30 flex w-48 flex-col border-2 border-[#0a246a] bg-[#ece9d8] p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReorderMenu(false);
                        onLoad(detail, "reorder");
                      }}
                      className="px-2 py-1.5 text-left font-bold text-[#003399] hover:bg-[#316ac5] hover:text-white"
                    >
                      {detail.bill.balanceDueHkd > 0.005 &&
                      !["CANCELLED", "VOIDED"].includes((detail.bill.status ?? "").toUpperCase())
                        ? "加訂 / 續付尾數"
                        : "加訂 (載入購物車)"}
                    </button>
                    <button
                      type="button"
                      disabled={["CANCELLED", "VOIDED"].includes((detail.bill.status ?? "").toUpperCase())}
                      onClick={() => {
                        setShowReorderMenu(false);
                        setShowDepositDialog(true);
                      }}
                      className="px-2 py-1.5 text-left font-bold text-[#8b0000] hover:bg-[#316ac5] hover:text-white disabled:opacity-40"
                    >
                      落訂 / 改訂 / 取消訂
                    </button>
                    <button
                      type="button"
                      disabled={["CANCELLED", "VOIDED"].includes((detail.bill.status ?? "").toUpperCase())}
                      onClick={() => {
                        setShowReorderMenu(false);
                        setShowDeliverySetupDialog(true);
                      }}
                      className="px-2 py-1.5 text-left font-bold text-[#7c2d12] hover:bg-[#316ac5] hover:text-white disabled:opacity-40"
                    >
                      送貨設定 (改期/改地址)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReorderMenu(false);
                        onLoad(detail, "copy_new");
                      }}
                      className="px-2 py-1.5 text-left font-bold text-[#333] hover:bg-[#316ac5] hover:text-white"
                    >
                      另開新單 / 分拆發票
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeliveryAction("receive")}
                      className="px-2 py-1.5 text-left font-bold text-[#065f46] hover:bg-[#316ac5] hover:text-white"
                    >
                      提貨 (標記已提貨)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowReorderMenu(false);
                        router.push(`/invoices/${encodeURIComponent(detail.bill.invoiceNo)}/print`);
                      }}
                      className="px-2 py-1.5 text-left font-bold text-[#111] hover:bg-[#316ac5] hover:text-white"
                    >
                      正式發票
                    </button>
                  </div>
                )}
              </div>

              <div className="ml-auto flex items-center gap-2 border border-[#aca899] bg-[#ece9d8] px-2.5 py-1.5 text-[11px] text-[#333]">
                <span className="font-bold text-[#003399]">附註:</span>
                <span>C - 項取消, D - 項折, E - 已交更, P - 已提貨</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Void Confirmation Dialog — 營運通訊息 - 051 */}
      {voidModalOpen && detail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="w-[380px] border-2 border-[#0a246a] bg-[#ece9d8] shadow-2xl">
            <div className="flex items-center justify-between bg-[#0a246a] px-2.5 py-1 font-bold text-white">
              <span>營運通訊息 - 051</span>
              <button
                type="button"
                onClick={() => setVoidModalOpen(false)}
                className="px-1 hover:bg-white/20"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 p-4 text-xs">
              <div className="font-bold text-[#003399]">
                確定取消單據 {detail.bill.invoiceNo}？
              </div>
              <div>
                <span className="mb-1 block font-bold">取消原因</span>
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {CANCEL_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setVoidReason(r)}
                      className={`border px-2 py-0.5 text-xs font-bold ${
                        voidReason === r
                          ? "border-[#0a246a] bg-[#ffe6a0] text-[#0a246a]"
                          : "border-[#808080] bg-white text-[#111] hover:bg-[#f0f0f0]"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  aria-label="取消原因"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="h-7 w-full border border-[#7f9db9] bg-white px-2 text-xs"
                />
              </div>
              <label className="block">
                <span className="mb-1 block font-bold">經理授權密碼 (L4+ 職員可留空)</span>
                <input
                  type="password"
                  value={managerPin}
                  onChange={(e) => setManagerPin(e.target.value)}
                  placeholder="輸入經理密碼 / PIN"
                  className="h-8 w-full border border-[#7f9db9] bg-white px-2 text-xs"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setVoidModalOpen(false)}
                  className="border border-[#808080] bg-[#d4d0c8] px-3 py-1 font-bold"
                >
                  返回
                </button>
                <button
                  type="button"
                  disabled={voidBusy}
                  onClick={() => void handleVoidSubmit()}
                  className="border border-[#991b1b] bg-[#dc2626] px-3 py-1 font-bold text-white hover:bg-[#b91c1c] disabled:opacity-50"
                >
                  確定取消單
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Reject / Problem Remarks Modal */}
      {deliveryModal && detail && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="w-[360px] border-2 border-[#0a246a] bg-[#ece9d8] shadow-2xl">
            <div className="flex items-center justify-between bg-[#0a246a] px-2.5 py-1 font-bold text-white">
              <span>
                {deliveryModal.action === "reject" ? "拒收單登記" : "問題單登記"} —{" "}
                {detail.bill.invoiceNo}
              </span>
              <button
                type="button"
                onClick={() => setDeliveryModal(null)}
                className="px-1 hover:bg-white/20"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 p-4 text-xs">
              <label className="block">
                <span className="mb-1 block font-bold">備註 / 原因說明</span>
                <textarea
                  rows={3}
                  value={deliveryModal.remarks}
                  onChange={(e) =>
                    setDeliveryModal((prev) =>
                      prev ? { ...prev, remarks: e.target.value } : null,
                    )
                  }
                  placeholder="輸入拒收或問題詳情..."
                  className="w-full border border-[#7f9db9] bg-white p-2 text-xs"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeliveryModal(null)}
                  className="border border-[#808080] bg-[#d4d0c8] px-3 py-1 font-bold"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() =>
                    void handleDeliveryAction(deliveryModal.action, deliveryModal.remarks)
                  }
                  className="border border-[#0a246a] bg-[#0a246a] px-3 py-1 font-bold text-white disabled:opacity-50"
                >
                  確定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Receive All Confirmation Modal */}
      {receiveAllConfirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="w-[340px] border-2 border-[#0a246a] bg-[#ece9d8] shadow-2xl">
            <div className="bg-[#0a246a] px-2.5 py-1 font-bold text-white">
              營運通訊息 — 接收所有
            </div>
            <div className="space-y-3 p-4 text-xs">
              <p className="font-bold text-[#003399]">
                確定將目前顯示的 {rows.length} 張未收單全部標記為已接收？
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReceiveAllConfirmOpen(false)}
                  className="border border-[#808080] bg-[#d4d0c8] px-3 py-1 font-bold"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => void handleReceiveAll()}
                  className="border border-[#065f46] bg-[#059669] px-3 py-1 font-bold text-white disabled:opacity-50"
                >
                  確定接收所有
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDepositDialog && detail ? (
        <DepositPaymentDialog
          invoiceNo={detail.bill.invoiceNo}
          initialDetail={detail}
          onClose={() => setShowDepositDialog(false)}
          onUpdated={(next) => {
            setDetail(next);
            void fetchList({ preserveDetailNo: next.bill.invoiceNo });
          }}
        />
      ) : null}

      {showDeliverySetupDialog && detail ? (
        <DeliverySetupDialog
          invoiceNo={detail.bill.invoiceNo}
          initialInfo={{
            enabled: true,
            scheduledDate: detail.bill.delivery?.scheduledDate || getTodayHkt(),
            recipientPhone: detail.bill.delivery?.recipientPhone || detail.bill.customer?.phone || "",
            deliveryAddress: detail.bill.delivery?.deliveryAddress || detail.bill.customer?.address || "",
            remarks: detail.bill.delivery?.remarks || "",
          }}
          customerPhone={detail.bill.customer?.phone}
          customerAddress={detail.bill.customer?.address}
          onClose={() => setShowDeliverySetupDialog(false)}
          onSaved={() => {
            setShowDeliverySetupDialog(false);
            setStatusFeedback(`單據 ${detail.bill.invoiceNo} 送貨日期／地址已更新`);
            void fetchList({ preserveDetailNo: detail.bill.invoiceNo });
          }}
        />
      ) : null}

      {typeof document !== "undefined" && detail
        ? createPortal(
            <div id="bill-query-print-sheet" className="hidden print:block">
              <ReceiptPreview
                detail={detail}
                deliveryNoteMode={tab === "unprocessed"}
                lang={previewLang}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

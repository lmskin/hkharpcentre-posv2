"use client";

/**
 * PosClassicClient — faithful recreation of the legacy eRun POSGV3.3 (POS330G.exe)
 * VB6 till UI ("營運通 - 零售系統") on top of the POS v2 data layer.
 *
 * Replicated from live captures of the VB6 application (2026-11-20):
 *  - Top icon toolbar: 登出 查單 存貨 零售 其他交易 收銀員 經理 營業數據 支援 按鈕 資訊
 *  - Status strip: branch | cashier | date | time | 零售
 *  - Item grid: 條碼 | 貨品 | 顏色 | 尺碼 | 數量 | 單價 | % | 價錢
 *  - Right panels: quick-picks, 貨品 [1/n], 會員 [1/n], 職員, 優惠, 影像, 資訊
 *  - Keypad: 7-9/4-6/1-3/0-00-. + black LCD + 數量 + C + 項折/送貨/單折
 *  - Function row: 退售 選價 改價 方法 重選 完成 (取消項目 when a line is selected)
 *  - 方法 toggles tender panel: 現金 八達通 Visa Master 銀聯 Bank Transfer AE Cheque 付款一
 *  - 完成 disabled on empty bill; invalid barcode -> 營運通訊息 - 017 modal, closed by 離開
 * Business logic (bill math, CRM, Octopus RWL bridge, posting) is unchanged from PosRegisterClient.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BillDocType, TenderCode } from "@hkharp/contracts";
import type { SessionPayload } from "@hkharp/db";
import { calculateBillTotals } from "@hkharp/domain/bill-math";
import { calculateCrmPoints } from "@hkharp/domain/crm-rules";
import { formatHkd } from "@hkharp/domain/money";
import { validateOctopusAmountHkd } from "@hkharp/domain/octopus-rules";
import type { PosCustomer, PosMenuGroup, PosProduct } from "@/components/PosRegisterClient";

interface CartLine {
  item: PosProduct;
  quantity: number;
  discountRate: number;
}

interface SavedDocSummary {
  invoiceNo: string;
  docType: string;
  paymentStatus: string;
  netAmountHkd: number;
  balanceDueHkd: number;
}

type PanelId =
  | "quickpick"
  | "products"
  | "members"
  | "staff"
  | "promo"
  | "image"
  | "info"
  | "otherTxn"
  | "cashier"
  | "manager"
  | "support";

type TenderChoice = "OCTOPUS" | "CASH" | "UNPAID_INVOICE" | TenderCode;

const OFFLINE_QUEUE_KEY = "hkharp_offline_bills_v2";

/** Tender row captured from the VB6 方法 panel (支付寶 legacy label = MasterCard PM=3). */
const TENDERS: ReadonlyArray<{ key: TenderChoice; zh: string; sub?: string }> = [
  { key: "CASH", zh: "現金", sub: "PM=0" },
  { key: "OCTOPUS", zh: "八達通", sub: "PM=1" },
  { key: "VISA", zh: "Visa", sub: "PM=2" },
  { key: "MASTERCARD", zh: "Master", sub: "PM=3" },
  { key: "UNIONPAY", zh: "銀聯", sub: "PM=4" },
  { key: "BANK_XFER", zh: "Bank Transfer", sub: "PM=5" },
  { key: "AMEX", zh: "AE", sub: "PM=6" },
  { key: "CHEQUE", zh: "Cheque", sub: "PM=7" },
  { key: "UNPAID_INVOICE", zh: "付款一", sub: "掛單" },
];

const LINE_DISCOUNTS = [0, 0.05, 0.1, 0.15, 0.2];

const VB_FONT = "Tahoma, 'Microsoft JhengHei', 'PMingLiU', sans-serif";

export function PosClassicClient({
  session,
  menus,
  initialProducts,
  initialCustomers,
  bridgeUrl,
  bridgeToken,
}: {
  session: SessionPayload | null;
  menus: PosMenuGroup[];
  initialProducts: PosProduct[];
  initialCustomers: PosCustomer[];
  bridgeUrl: string;
  bridgeToken: string;
}) {
  const router = useRouter();

  // ---- catalog / cart state -------------------------------------------------
  const [products, setProducts] = useState<PosProduct[]>(initialProducts);
  const [productQuery, setProductQuery] = useState("");
  const [activeMenuId, setActiveMenuId] = useState<number | null>(menus[0]?.id ?? null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [customers, setCustomers] = useState<PosCustomer[]>(initialCustomers);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);

  // ---- legacy UI state ------------------------------------------------------
  // Legacy starts on the 影像 panel (Harp Centre logo + support hotline).
  const [activePanel, setActivePanel] = useState<PanelId>("image");
  const [entryBuffer, setEntryBuffer] = useState("");
  const [pendingQty, setPendingQty] = useState(1);
  const [tenderMode, setTenderMode] = useState(false);
  const [msg, setMsg] = useState<{ code: string; text: string } | null>(null);
  const [showBillQuery, setShowBillQuery] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [clock, setClock] = useState(() => new Date());

  // ---- transaction state (same semantics as PosRegisterClient) --------------
  const [docType, setDocType] = useState<BillDocType>("RETAIL_SALE");
  const [selectedTender, setSelectedTender] = useState<TenderChoice>("CASH");
  const [depositMode, setDepositMode] = useState<"NONE" | TenderCode>("NONE");
  const [depositAmount, setDepositAmount] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [approvalCode, setApprovalCode] = useState("");
  const [notes, setNotes] = useState("");
  const [octopusCardIdInput, setOctopusCardIdInput] = useState("88419204");
  const [octopusLockCardId, setOctopusLockCardId] = useState<string | null>(null);
  const [octopusApprovedInfo, setOctopusApprovedInfo] = useState<{
    cardId: string;
    deviceId: string;
    remainingHkd: number;
  } | null>(null);
  const [draftBillRef] = useState(() => `POS-${Date.now()}`);
  const [recentDocs, setRecentDocs] = useState<SavedDocSummary[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ---- derived values -------------------------------------------------------
  const totals = calculateBillTotals(
    cart.map((c, idx) => ({
      sku: c.item.sku,
      quantity: c.quantity,
      unitPriceHkd: c.item.unitPriceHkd,
      discountRate: c.discountRate,
      dk: idx + 1,
    })),
  );

  const crm = calculateCrmPoints(
    cart.map((c, idx) => ({
      sku: c.item.sku,
      categoryC1: c.item.categoryC1,
      quantity: c.quantity,
      lineNetAmountHkd: totals.lines[idx]?.netHkd ?? 0,
      excludeFromCrmBonus: c.item.excludeFromCrmBonus,
    })),
    selectedCustomer?.pointsBalance ?? 0,
  );

  const octopusValidation = validateOctopusAmountHkd(totals.netAmountHkd);
  const selectedLine = cart.find((c) => c.item.sku === selectedSku) ?? null;
  const grossAmount = totals.grossAmountHkd;
  const lineDiscountTotal = totals.discountAmountHkd;

  const cashTendered = Number(entryBuffer);
  const changeDue =
    tenderMode && selectedTender === "CASH" && cashTendered > totals.netAmountHkd
      ? cashTendered - totals.netAmountHkd
      : 0;

  const quickButtons = useMemo(() => {
    if (activeMenuId !== null) {
      const m = menus.find((x) => x.id === activeMenuId);
      if (m && m.buttons.length > 0) return m.buttons;
    }
    return products.slice(0, 24);
  }, [menus, products, activeMenuId]);

  // ---- data helpers ---------------------------------------------------------
  async function runProductSearch(q: string) {
    setProductQuery(q);
    const res = await fetch(`/api/products?q=${encodeURIComponent(q)}&limit=60`);
    if (res.ok) {
      const data = (await res.json()) as { items: PosProduct[] };
      setProducts(data.items);
    }
  }

  async function runCustomerSearch(q: string) {
    setCustomerQuery(q);
    const res = await fetch(`/api/customers?q=${encodeURIComponent(q)}&limit=30`);
    if (res.ok) {
      const data = (await res.json()) as { customers: PosCustomer[] };
      setCustomers(data.customers);
    }
  }

  function showMsg(code: string, text: string) {
    setMsg({ code, text });
  }

  // ---- cart operations ------------------------------------------------------
  function addItem(item: PosProduct, qty?: number) {
    const addQty = qty ?? pendingQty;
    setOctopusApprovedInfo(null);
    setCart((prev) => {
      const existingIdx = prev.findIndex((x) => x.item.sku === item.sku);
      if (existingIdx >= 0) {
        return prev.map((entry, idx) =>
          idx === existingIdx ? { ...entry, quantity: entry.quantity + addQty } : entry,
        );
      }
      return [...prev, { item, quantity: addQty, discountRate: 0 }];
    });
    setSelectedSku(item.sku);
    setPendingQty(1);
    setEntryBuffer("");
  }

  function removeLine(sku: string) {
    setOctopusApprovedInfo(null);
    setCart((prev) => prev.filter((c) => c.item.sku !== sku));
    setSelectedSku(null);
  }

  /** 數量 key: buffer applies to the selected line, else becomes the next-item quantity. */
  function applyQuantity() {
    const n = Math.max(1, parseInt(entryBuffer || "1", 10) || 1);
    if (selectedLine) {
      setOctopusApprovedInfo(null);
      setCart((prev) =>
        prev.map((c) => (c.item.sku === selectedLine.item.sku ? { ...c, quantity: n } : c)),
      );
    } else {
      setPendingQty(n);
      setStatusMessage(`數量設定為 ${n}（下一貨品）`);
    }
    setEntryBuffer("");
  }

  /** Barcode entry ( keypad Enter / 條碼 field ): VB6 msg 017 on unknown code. */
  function commitBarcode(raw?: string) {
    const code = (raw ?? entryBuffer).trim();
    if (!code) return;
    const hit = products.find((p) => p.sku.toLowerCase() === code.toLowerCase());
    if (!hit) {
      showMsg("017", `${code} - 條碼編號不存在，請輸入另一編號！`);
      return;
    }
    addItem(hit);
  }

  /** Next rate in the legacy discount cycle (safe under noUncheckedIndexedAccess). */
  function nextDiscount(current: number): number {
    const idx = LINE_DISCOUNTS.indexOf(current);
    return LINE_DISCOUNTS[(idx + 1) % LINE_DISCOUNTS.length] ?? 0;
  }

  /** 項折: cycle the selected line's discount rate. */
  function cycleLineDiscount() {
    if (!selectedLine) {
      showMsg("021", "請先選擇貨品項目！");
      return;
    }
    const next = nextDiscount(selectedLine.discountRate);
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) => (c.item.sku === selectedLine.item.sku ? { ...c, discountRate: next } : c)),
    );
    setStatusMessage(`${selectedLine.item.sku} 項折 ${(next * 100).toFixed(0)}%`);
  }

  /** 單折: apply one discount rate to every line. */
  function applyBillDiscount() {
    if (cart.length === 0) {
      showMsg("022", "帳單沒有貨品項目！");
      return;
    }
    const rate = nextDiscount(cart[0]?.discountRate ?? 0);
    setOctopusApprovedInfo(null);
    setCart((prev) => prev.map((c) => ({ ...c, discountRate: rate })));
    setStatusMessage(`單折 ${(rate * 100).toFixed(0)}% 已套用全單`);
  }

  /** 送貨: flag the bill for delivery (goes into remarks, same as legacy note). */
  function flagDelivery() {
    setNotes((prev) => (prev.includes("送貨") ? prev : `送貨 ${prev}`.trim()));
    setStatusMessage("此單已標記送貨（寫入備註）");
  }

  /** 改價: override the selected line price with the keypad buffer (as discount rate). */
  function overridePrice() {
    if (!selectedLine) {
      showMsg("021", "請先選擇貨品項目！");
      return;
    }
    const target = Number(entryBuffer);
    if (!target || target <= 0 || target > selectedLine.item.unitPriceHkd) {
      showMsg("023", "請先用數字鍵輸入新單價！");
      return;
    }
    const rate = Math.round((1 - target / selectedLine.item.unitPriceHkd) * 10000) / 10000;
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) => (c.item.sku === selectedLine.item.sku ? { ...c, discountRate: rate } : c)),
    );
    setEntryBuffer("");
    setStatusMessage(`${selectedLine.item.sku} 改價為 ${formatHkd(target)}`);
  }

  /** 選價: price enquiry for the buffered code or the selected line. */
  function priceEnquiry() {
    const code = entryBuffer.trim();
    const hit = code ? products.find((p) => p.sku.toLowerCase() === code.toLowerCase()) : null;
    const item = hit ?? selectedLine?.item ?? null;
    if (!item) {
      showMsg("024", "請先輸入條碼或選擇貨品項目！");
      return;
    }
    showMsg("025", `${item.sku}\n${item.nameZh || item.nameEn}\n單價：${formatHkd(item.unitPriceHkd)}`);
  }

  /** 重選: clear keypad buffer, pending quantity and line selection. */
  function reselect() {
    setEntryBuffer("");
    setPendingQty(1);
    setSelectedSku(null);
    setStatusMessage("");
  }

  /** 退售: toggle return mode (XC=9). */
  function toggleReturnMode() {
    setDocType((prev) => (prev === "SALES_RETURN" ? "RETAIL_SALE" : "SALES_RETURN"));
  }

  // ---- Octopus bridge (unchanged logic) --------------------------------------
  async function callOctopusBridge(outcome: "APPROVE" | "INCOMPLETE_100022") {
    if (!octopusValidation.ok) {
      setStatusMessage(octopusValidation.reason);
      return;
    }
    try {
      const res = await fetch(`${bridgeUrl}/octopus/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": bridgeToken },
        body: JSON.stringify({
          requestId: `req-${Date.now()}`,
          billRef: draftBillRef,
          amountCents: octopusValidation.amountCents,
          cardId: octopusCardIdInput.trim() || "88419204",
          simulateOutcome: outcome,
        }),
      });
      const data = (await res.json()) as {
        type: string;
        cardId?: string;
        deviceId?: string;
        remainingValueCents?: number;
        lockedCardId?: string;
        promptEn?: string;
        message?: string;
      };
      if (res.status === 409 && data.type === "OCTOPUS_INCOMPLETE_100022") {
        setOctopusLockCardId(data.lockedCardId ?? octopusCardIdInput);
        setOctopusApprovedInfo(null);
        setStatusMessage(data.promptEn ?? "Octopus 100022 incomplete tap — retry same card.");
        return;
      }
      if (!res.ok) {
        setStatusMessage(data.message ?? "Octopus bridge declined");
        return;
      }
      setOctopusLockCardId(null);
      setOctopusApprovedInfo({
        cardId: data.cardId ?? octopusCardIdInput,
        deviceId: data.deviceId ?? "RWL-01",
        remainingHkd: Number(((data.remainingValueCents ?? 0) / 100).toFixed(2)),
      });
      setStatusMessage(
        `八達通已收費 (卡 ${data.cardId}，餘額 ${formatHkd((data.remainingValueCents ?? 0) / 100)})`,
      );
    } catch {
      setStatusMessage("無法連接本機硬件橋接 127.0.0.1:17880");
    }
  }

  // ---- submit (unchanged logic) ----------------------------------------------
  async function submitBill() {
    if (cart.length === 0) return; // VB6: 完成 greyed on empty bill
    if (!session) {
      showMsg("401", "請先登入收銀員帳號！");
      return;
    }
    if (selectedCustomer && !crm.redemptionAllowed) {
      showMsg("044", crm.redemptionError ?? "會員積分不足！");
      return;
    }
    if (octopusLockCardId) {
      showMsg("100", `此單被八達通 100022 鎖定（卡 ${octopusLockCardId}），請先重拍同一張卡！`);
      return;
    }

    const effectiveDocType: BillDocType =
      selectedTender === "UNPAID_INVOICE" ? "SALES_INVOICE" : docType;

    const initialPayments = [];
    if (selectedTender === "UNPAID_INVOICE") {
      if (depositMode !== "NONE" && Number(depositAmount) > 0) {
        initialPayments.push({
          clientIdempotencyKey: `pmt-${Date.now()}`,
          tenderCode: depositMode,
          amountHkd: Number(depositAmount),
          approvalCode: approvalCode.trim() || undefined,
          cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
          remarks: "Initial invoice deposit",
        });
      }
    } else if (selectedTender === "OCTOPUS") {
      if (!octopusApprovedInfo) {
        showMsg("101", "請先在八達通讀卡器拍卡！");
        return;
      }
      initialPayments.push({
        clientIdempotencyKey: `pmt-${Date.now()}`,
        tenderCode: "OCTOPUS" as const,
        amountHkd: totals.netAmountHkd,
        octopusCardId: octopusApprovedInfo.cardId,
        octopusDeviceId: octopusApprovedInfo.deviceId,
        octopusRemainingHkd: octopusApprovedInfo.remainingHkd,
      });
    } else {
      initialPayments.push({
        clientIdempotencyKey: `pmt-${Date.now()}`,
        tenderCode: selectedTender as TenderCode,
        amountHkd: totals.netAmountHkd,
        approvalCode: approvalCode.trim() || undefined,
        cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
        remarks:
          selectedTender === "CASH" && cashTendered > totals.netAmountHkd
            ? `Cash tendered ${cashTendered}`
            : undefined,
      });
    }

    const payload = {
      clientIdempotencyKey: `bill-${crypto.randomUUID()}`,
      shopId: session.shopId || 1,
      terminalId: 2,
      docType: effectiveDocType,
      customerId: selectedCustomer?.id,
      customerCurrentPoints: selectedCustomer?.pointsBalance ?? 0,
      lines: cart.map((c) => ({
        sku: c.item.sku,
        nameZh: c.item.nameZh,
        nameEn: c.item.nameEn,
        categoryC1: c.item.categoryC1,
        quantity: c.quantity,
        unitPriceHkd: c.item.unitPriceHkd,
        discountRate: c.discountRate,
        lineDiscountAmountHkd: 0,
        isFixedPrice: false,
        excludeFromCrmBonus: Boolean(c.item.excludeFromCrmBonus),
      })),
      initialPayments,
      notes: notes.trim() || undefined,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as SavedDocSummary & { error?: string };
      if (!res.ok) {
        showMsg("500", data.error ?? "儲存帳單失敗！");
        return;
      }

      if (selectedTender === "CASH" && bridgeToken) {
        fetch(`${bridgeUrl}/drawer/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bridge-Token": bridgeToken },
          body: JSON.stringify({ requestId: payload.clientIdempotencyKey, reason: "CASH_SALE" }),
        }).catch(() => {});
      }

      setRecentDocs((prev) => [data, ...prev]);
      setCart([]);
      setSelectedSku(null);
      setTenderMode(false);
      setOctopusApprovedInfo(null);
      setApprovalCode("");
      setCardLast4("");
      setDepositAmount("");
      setNotes("");
      setEntryBuffer("");
      showMsg("000", `帳單 ${data.invoiceNo} 已完成。\n狀態：${data.paymentStatus.toUpperCase()} · 餘額 ${formatHkd(data.balanceDueHkd)}`);
    } catch {
      const existingRaw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const queued = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : [];
      queued.push(payload);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queued));
      showMsg("999", "伺服器離線 — 交易已存入本機離線佇列，稍後重試。");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // ===========================================================================
  //  RENDER — legacy VB6 chrome
  // ===========================================================================

  const dateStr = `${clock.getMonth() + 1}/${clock.getDate()}`;
  const timeStr = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
  const modeLabel = docType === "SALES_RETURN" ? "退售" : docType === "PETTY_PAYOUT" ? "Payout" : "零售";

  const toolbarBtn =
    "flex w-[62px] flex-col items-center gap-0.5 border-r border-[#d4d0c8] px-1 py-1.5 text-[11px] leading-tight text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]";
  const sideBtn =
    "flex w-full flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 text-[11px] text-black hover:bg-[#e5e1d5]";
  const fnBtn =
    "flex flex-1 flex-col items-center justify-center gap-0.5 border-r border-[#aca899] py-1 text-[13px] text-black";
  const panelBtn =
    "w-full border border-[#aca899] bg-[#f0f0f0] px-2 py-1.5 text-left text-[12px] text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col select-none"
      style={{ background: "#f0f0f0", fontFamily: VB_FONT }}
    >
      {/* ── 1. top toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-stretch border-b border-[#aca899] bg-[#f0f0f0]">
        <button type="button" className={toolbarBtn} onClick={() => void logout()} title="登出">
          <span className="text-[18px]">⏻</span>登出
        </button>
        <button type="button" className={toolbarBtn} onClick={() => setShowBillQuery(true)} title="查單">
          <span className="text-[18px]">🧾</span>查單
        </button>
        <button type="button" className={toolbarBtn} onClick={() => router.push("/backoffice/stock")} title="存貨">
          <span className="text-[18px]">📦</span>存貨
        </button>
        <button
          type="button"
          className={toolbarBtn}
          style={{ background: "#fff8dc" }}
          onClick={() => {
            setDocType("RETAIL_SALE");
            setActivePanel("image");
            setTenderMode(false);
          }}
          title="零售"
        >
          <span className="text-[18px]">🧮</span>零售
        </button>
        <button type="button" className={toolbarBtn} onClick={() => setActivePanel("otherTxn")} title="其他交易">
          <span className="text-[18px]">🚚</span>其他交易
        </button>
        <button type="button" className={toolbarBtn} onClick={() => setActivePanel("cashier")} title="收銀員">
          <span className="text-[18px]">🪙</span>收銀員
        </button>
        <button type="button" className={toolbarBtn} onClick={() => setActivePanel("manager")} title="經理">
          <span className="text-[18px]">👤</span>經理
        </button>
        <button type="button" className={toolbarBtn} onClick={() => router.push("/backoffice/day-end")} title="營業數據">
          <span className="text-[18px]">📈</span>營業數據
        </button>
        <button type="button" className={toolbarBtn} onClick={() => setActivePanel("support")} title="支援">
          <span className="text-[18px]">❓</span>支援
        </button>
        <button type="button" className={toolbarBtn} onClick={() => setActivePanel("quickpick")} title="按鈕">
          <span className="text-[18px]">🔲</span>按鈕
        </button>
        <button type="button" className={toolbarBtn} onClick={() => setActivePanel("info")} title="資訊">
          <span className="text-[18px]">📋</span>資訊
        </button>
        <div className="ml-auto flex items-center pr-3 text-right">
          <div>
            <div className="text-[15px] font-bold italic text-[#2e7ec2]">eRun</div>
            <div className="text-[9px] tracking-wide text-[#2e7ec2]">POS-Cloud V3.3</div>
          </div>
        </div>
      </div>

      {/* ── 2. status strip ────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-[#d4d0c8] bg-[#f0f0f0] text-[12px] text-black">
        <span className="border-r border-[#d4d0c8] px-2 py-0.5">Central({session?.shopId ?? 1})</span>
        <span className="border-r border-[#d4d0c8] px-2 py-0.5">{session?.displayName ?? "未登入"}</span>
        <span className="border-r border-[#d4d0c8] px-2 py-0.5">{dateStr}</span>
        <span className="border-r border-[#d4d0c8] px-2 py-0.5">{timeStr}</span>
        {selectedCustomer ? (
          <span className="border-r border-[#d4d0c8] px-2 py-0.5">
            會員：{selectedCustomer.nameZh || selectedCustomer.nameEn}（{selectedCustomer.pointsBalance} 分）
          </span>
        ) : null}
        <span className="ml-auto px-2 py-0.5 font-bold">{modeLabel}</span>
      </div>

      {/* ── 3. main area ───────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* left: barcode row + item grid */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 border-b border-[#d4d0c8] p-1">
            <input
              value={entryBuffer}
              onChange={(e) => setEntryBuffer(e.target.value.replace(/[^\d.]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitBarcode();
              }}
              placeholder="條碼"
              className="w-40 border border-[#aca899] bg-white px-1 py-1 text-[13px]"
            />
            <input
              value={productQuery}
              onChange={(e) => void runProductSearch(e.target.value)}
              placeholder="貨品編號 / 名稱"
              className="min-w-0 flex-1 border border-[#aca899] bg-white px-1 py-1 text-[13px]"
            />
            <button type="button" className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1" title="查單" onClick={() => setShowBillQuery(true)}>
              🧾
            </button>
            <button type="button" className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1" title="鍵盤" onClick={() => setActivePanel("quickpick")}>
              ⌨️
            </button>
            <button type="button" className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1" title="輸入" onClick={() => commitBarcode()}>
              ➡️
            </button>
          </div>

          {/* item grid — 條碼 | 貨品 | 顏色 | 尺碼 | 數量 | 單價 | % | 價錢 */}
          <div className="min-h-0 flex-1 overflow-auto bg-[#dfe7f0]">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0">
                <tr className="bg-[#e8eef5] text-left text-black">
                  <th className="border-b border-[#aca899] px-2 py-1 font-normal">條碼</th>
                  <th className="border-b border-[#aca899] px-2 py-1 font-normal">貨品</th>
                  <th className="border-b border-[#aca899] px-2 py-1 font-normal">顏色</th>
                  <th className="border-b border-[#aca899] px-2 py-1 font-normal">尺碼</th>
                  <th className="border-b border-[#aca899] px-2 py-1 text-right font-normal">數量</th>
                  <th className="border-b border-[#aca899] px-2 py-1 text-right font-normal">單價</th>
                  <th className="border-b border-[#aca899] px-2 py-1 text-right font-normal">%</th>
                  <th className="border-b border-[#aca899] px-2 py-1 text-right font-normal">價錢</th>
                </tr>
              </thead>
              <tbody>
                {cart.map((line, idx) => {
                  const net = totals.lines[idx]?.netHkd ?? 0;
                  const active = selectedSku === line.item.sku;
                  return (
                    <tr
                      key={line.item.sku}
                      onClick={() => setSelectedSku(active ? null : line.item.sku)}
                      className={`cursor-pointer ${active ? "bg-[#316ac5] text-white" : idx % 2 ? "bg-[#e9eff6]" : "bg-[#dfe7f0]"}`}
                    >
                      <td className="px-2 py-1 font-mono">{line.item.sku}</td>
                      <td className="px-2 py-1">{line.item.nameZh || line.item.nameEn}</td>
                      <td className="px-2 py-1">-</td>
                      <td className="px-2 py-1">-</td>
                      <td className="px-2 py-1 text-right font-mono">{line.quantity}</td>
                      <td className="px-2 py-1 text-right font-mono">{formatHkd(line.item.unitPriceHkd)}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {line.discountRate > 0 ? `${(line.discountRate * 100).toFixed(0)}` : ""}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">{formatHkd(net)}</td>
                    </tr>
                  );
                })}
                {cart.length === 0
                  ? Array.from({ length: 12 }).map((_, i) => (
                      <tr key={i} className={i % 2 ? "bg-[#e9eff6]" : "bg-[#dfe7f0]"}>
                        <td className="px-2 py-1" colSpan={8}>
                          &nbsp;
                        </td>
                      </tr>
                    ))
                  : null}
              </tbody>
            </table>
          </div>

          {/* 客付/應找 (tender mode) + totals strip */}
          <div className="flex items-stretch border-t border-[#d4d0c8]">
            {tenderMode ? (
              <div className="w-56 border-r border-[#d4d0c8] p-1 text-[12px] text-black">
                <div className="flex justify-between">
                  <span>客付</span>
                  <span>{TENDERS.find((t) => t.key === selectedTender)?.zh ?? ""}</span>
                  <span className="font-mono">{selectedTender === "CASH" ? (entryBuffer || "0.0") : formatHkd(totals.netAmountHkd)}</span>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <span className="font-bold text-[#2e7ec2]">應找</span>
                  <span className="font-mono text-[20px] font-bold text-[#2e7ec2]">{formatHkd(changeDue)}</span>
                </div>
              </div>
            ) : null}
            <div className="ml-auto flex items-end gap-6 px-3 py-1 text-[12px] text-black">
              <div className="text-right">
                <div className="text-[#2e7ec2]">金額</div>
                <div className="font-mono">{formatHkd(grossAmount)}</div>
              </div>
              <div className="text-right">
                <div className="text-[#2e7ec2]">單折</div>
                <div className="font-mono">{formatHkd(lineDiscountTotal)}</div>
              </div>
              <div className="text-right">
                <div className="text-[#2e7ec2]">會員折扣/調整</div>
                <div className="font-mono">{crm.redeemedPoints > 0 ? `-${crm.redeemedPoints}分` : "0"}</div>
              </div>
              <div className="text-right">
                <div className="text-[14px] font-bold">總計</div>
                <div className="font-mono text-[26px] font-bold leading-none">{formatHkd(totals.netAmountHkd)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* right: panel area + keypad */}
        <div className="flex w-[42%] min-w-[430px] flex-col border-l border-[#aca899]">
          {/* panel area */}
          <div className="min-h-0 flex-1 overflow-auto bg-white">
            {activePanel === "quickpick" ? (
              <div className="p-1">
                {menus.length > 0 ? (
                  <div className="mb-1 flex flex-wrap gap-0.5">
                    {menus.slice(0, 10).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setActiveMenuId(m.id)}
                        className={`border px-2 py-0.5 text-[11px] ${activeMenuId === m.id ? "border-[#316ac5] bg-[#316ac5] text-white" : "border-[#aca899] bg-[#f0f0f0]"}`}
                      >
                        {m.titleZh || m.titleEn}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setActiveMenuId(null)}
                      className={`border px-2 py-0.5 text-[11px] ${activeMenuId === null ? "border-[#316ac5] bg-[#316ac5] text-white" : "border-[#aca899] bg-[#f0f0f0]"}`}
                    >
                      全部
                    </button>
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-1">
                  {quickButtons.map((item) => (
                    <button
                      key={item.sku}
                      type="button"
                      onClick={() => addItem(item)}
                      className="h-14 overflow-hidden border border-[#aca899] bg-[#fffbe8] px-1 text-left text-[11px] leading-tight text-black hover:bg-[#fff3c4]"
                      title={`${item.sku} · ${formatHkd(item.unitPriceHkd)}`}
                    >
                      {item.nameZh || item.nameEn}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {activePanel === "products" ? (
              <div>
                <div className="sticky top-0 border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  貨品 [1/{products.length}]
                </div>
                <div className="p-1">
                  <input
                    value={productQuery}
                    onChange={(e) => void runProductSearch(e.target.value)}
                    placeholder="搜尋貨品…"
                    className="mb-1 w-full border border-[#aca899] px-1 py-1 text-[12px]"
                  />
                </div>
                {products.map((p) => (
                  <button
                    key={p.sku}
                    type="button"
                    onClick={() => addItem(p)}
                    className="flex w-full justify-between border-b border-[#e0e0e0] px-2 py-1 text-left text-[12px] text-black hover:bg-[#316ac5] hover:text-white"
                  >
                    <span className="font-mono">{p.sku}</span>
                    <span className="mx-2 flex-1 truncate">{p.nameZh || p.nameEn}</span>
                    <span className="font-mono">{formatHkd(p.unitPriceHkd)}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {activePanel === "members" ? (
              <div>
                <div className="sticky top-0 border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  會員 [1/{customers.length}]
                </div>
                <div className="p-1">
                  <input
                    value={customerQuery}
                    onChange={(e) => void runCustomerSearch(e.target.value)}
                    placeholder="搜尋會員…"
                    className="mb-1 w-full border border-[#aca899] px-1 py-1 text-[12px]"
                  />
                </div>
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#e8eef5] text-left text-black">
                      <th className="px-2 py-0.5 font-normal">號碼</th>
                      <th className="px-2 py-0.5 font-normal">姓名</th>
                      <th className="px-2 py-0.5 font-normal">電話</th>
                      <th className="px-2 py-0.5 text-right font-normal">積分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customers.map((c) => (
                      <tr
                        key={c.id}
                        onClick={() => {
                          setSelectedCustomer(selectedCustomer?.id === c.id ? null : c);
                          setStatusMessage(
                            selectedCustomer?.id === c.id ? "已取消會員" : `會員：${c.nameZh || c.nameEn}`,
                          );
                        }}
                        className={`cursor-pointer ${selectedCustomer?.id === c.id ? "bg-[#316ac5] text-white" : "hover:bg-[#eaf3fb]"}`}
                      >
                        <td className="px-2 py-1 font-mono">{c.legacyId}</td>
                        <td className="px-2 py-1">{c.nameZh || c.nameEn}</td>
                        <td className="px-2 py-1 font-mono">{c.phone || "-"}</td>
                        <td className="px-2 py-1 text-right font-mono">{c.pointsBalance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {activePanel === "staff" ? (
              <div>
                <div className="sticky top-0 border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  職員 [1/1]
                </div>
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[#e8eef5] text-left text-black">
                      <th className="px-2 py-0.5 font-normal">號碼</th>
                      <th className="px-2 py-0.5 font-normal">姓名</th>
                      <th className="px-2 py-0.5 font-normal">級別</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-[#fff8dc]">
                      <td className="px-2 py-1 font-mono">{session?.shopId ?? 1}001</td>
                      <td className="px-2 py-1">{session?.displayName ?? "未登入"}</td>
                      <td className="px-2 py-1">L{session?.roleLevel ?? "-"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}

            {activePanel === "promo" ? (
              <div className="p-2 text-[12px] text-black">
                <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center font-bold">優惠</div>
                <div className="mt-2 space-y-1">
                  <div>本單賺取積分：+{crm.earnedPoints} 分</div>
                  <div>本單兌換積分：-{crm.redeemedPoints} 分</div>
                  <div>
                    會員：
                    {selectedCustomer
                      ? `${selectedCustomer.nameZh || selectedCustomer.nameEn}（結餘 ${selectedCustomer.pointsBalance} 分）`
                      : "未選擇"}
                  </div>
                  {cart.length === 0 ? <div className="text-[#808080]">（空單暫無優惠）</div> : null}
                </div>
              </div>
            ) : null}

            {activePanel === "image" ? (
              <div className="flex h-full flex-col bg-white">
                <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  影像
                </div>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
                  {/* Legacy shows the Hong Kong Harp Centre logo here */}
                  <div className="text-[64px] leading-none text-black">𝄢</div>
                  <div className="text-center">
                    <div className="text-[13px] tracking-[0.3em] text-black">HONG KONG</div>
                    <div className="font-serif text-[26px] tracking-[0.12em] text-black">HARP CENTRE</div>
                  </div>
                  <div className="mt-4 text-center text-[13px] text-black">
                    <div className="tracking-wider">eRun Support Hotline :</div>
                    <div className="mt-1 text-[20px] font-bold tracking-widest">51 888 902</div>
                  </div>
                </div>
              </div>
            ) : null}

            {activePanel === "info" ? (
              <div className="p-2 text-[12px] text-black">
                <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center font-bold">資訊</div>
                <div className="mt-2 space-y-1">
                  <div>分店：Central({session?.shopId ?? 1})</div>
                  <div>終端機：2</div>
                  <div>收銀員：{session?.displayName ?? "未登入"}</div>
                  <div>版本：POS v2（重製 POSGV3.3 build 678）</div>
                  <div>資料庫：MySQL 8（本機）</div>
                </div>
              </div>
            ) : null}

            {activePanel === "otherTxn" ? (
              <div className="space-y-1 p-2">
                <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  其他交易
                </div>
                {(["到貨", "轉出", "報銷", "調整"] as const).map((label) => (
                  <button key={label} type="button" className={panelBtn} onClick={() => showMsg("030", `${label} — 請到後台存貨頁處理。`)}>
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className={panelBtn}
                  onClick={() => {
                    setDocType("SALES_RETURN");
                    setActivePanel("quickpick");
                    setStatusMessage("已切換到退售模式");
                  }}
                >
                  退貨
                </button>
                <button
                  type="button"
                  className={panelBtn}
                  onClick={() => {
                    setDocType("PETTY_PAYOUT");
                    setActivePanel("quickpick");
                    setStatusMessage("已切換到 Payout 模式");
                  }}
                >
                  Payout
                </button>
              </div>
            ) : null}

            {activePanel === "cashier" ? (
              <div className="space-y-1 p-2">
                <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  收銀員
                </div>
                <button type="button" className={panelBtn} onClick={() => router.push("/invoices")}>
                  印表機設定
                </button>
                <button type="button" className={panelBtn} onClick={() => router.push("/backoffice/settings")}>
                  更改密碼
                </button>
                <button type="button" className={panelBtn} onClick={() => showMsg("031", "維修模式 — 請聯絡系統行政。")}>
                  維修
                </button>
              </div>
            ) : null}

            {activePanel === "manager" ? (
              <div className="space-y-1 p-2">
                <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  經理
                </div>
                <button type="button" className={panelBtn} onClick={() => router.push("/backoffice/reports")}>
                  時報
                </button>
                <button type="button" className={panelBtn} onClick={() => router.push("/backoffice/reports")}>
                  項報
                </button>
                <button type="button" className={panelBtn} onClick={() => router.push("/backoffice/reports")}>
                  歷史數據
                </button>
              </div>
            ) : null}

            {activePanel === "support" ? (
              <div className="space-y-1 p-2">
                <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                  支援
                </div>
                <button type="button" className={panelBtn} onClick={() => showMsg("032", "eRun Support Hotline：51 888 902")}>
                  營運通支援
                </button>
                <button type="button" className={panelBtn} onClick={() => showMsg("033", "互聯網連線正常。")}>
                  互聯網
                </button>
                <button type="button" className={panelBtn} onClick={() => showMsg("034", "IP：127.0.0.1（本機部署）")}>
                  IP
                </button>
                <button type="button" className={panelBtn} onClick={() => setShowAbout(true)}>
                  關於軟件
                </button>
              </div>
            ) : null}
          </div>

          {/* octopus / card / deposit sub-panels sit above keypad when active */}
          {tenderMode && selectedTender === "OCTOPUS" ? (
            <div className="border-t border-[#aca899] bg-[#fff4e5] p-2 text-[12px] text-black">
              <div className="font-bold">八達通讀卡器（{bridgeUrl}）</div>
              <div className="mt-1">
                十仙規則：{" "}
                {octopusValidation.ok ? (
                  <span className="text-[#0a7a2f]">有效（{octopusValidation.amountCents}¢）</span>
                ) : (
                  <span className="text-[#c00000]">{octopusValidation.reason}</span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-1">
                <input
                  value={octopusCardIdInput}
                  onChange={(e) => setOctopusCardIdInput(e.target.value)}
                  className="w-28 border border-[#aca899] bg-white px-1 py-0.5 font-mono"
                />
                <button
                  type="button"
                  onClick={() => void callOctopusBridge("APPROVE")}
                  className="border border-[#aca899] bg-[#f0f0f0] px-2 py-0.5 hover:bg-[#e5e1d5]"
                >
                  拍卡收費
                </button>
                <button
                  type="button"
                  onClick={() => void callOctopusBridge("INCOMPLETE_100022")}
                  className="border border-[#aca899] bg-[#f0f0f0] px-2 py-0.5 hover:bg-[#e5e1d5]"
                >
                  測試 100022
                </button>
              </div>
              {octopusLockCardId ? (
                <div className="mt-1 bg-[#ffd7d7] p-1 font-bold text-[#c00000]">
                  +++請勿取消交易+++ 已鎖定卡 {octopusLockCardId}，請重拍同一張卡。
                </div>
              ) : null}
              {octopusApprovedInfo ? (
                <div className="mt-1 bg-[#d7ffd7] p-1 text-[#0a7a2f]">
                  已批准：卡 {octopusApprovedInfo.cardId}，餘額 {formatHkd(octopusApprovedInfo.remainingHkd)}
                </div>
              ) : null}
            </div>
          ) : null}

          {tenderMode && (["VISA", "MASTERCARD", "UNIONPAY", "AMEX"] as TenderChoice[]).includes(selectedTender) ? (
            <div className="border-t border-[#aca899] bg-[#eef4ff] p-2 text-[12px] text-black">
              <div className="font-bold">信用卡（獨立終端機）</div>
              <div className="mt-1 flex items-center gap-2">
                <label>
                  批核碼
                  <input
                    value={approvalCode}
                    onChange={(e) => setApprovalCode(e.target.value)}
                    className="ml-1 w-24 border border-[#aca899] bg-white px-1 py-0.5 font-mono"
                  />
                </label>
                <label>
                  卡號尾四位
                  <input
                    value={cardLast4}
                    maxLength={4}
                    onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ""))}
                    className="ml-1 w-16 border border-[#aca899] bg-white px-1 py-0.5 font-mono"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {tenderMode && selectedTender === "UNPAID_INVOICE" ? (
            <div className="border-t border-[#aca899] bg-[#fdf6e3] p-2 text-[12px] text-black">
              <div className="font-bold">付款一（開立發票，稍後銀行轉帳）</div>
              <div className="mt-1 flex items-center gap-2">
                <label>
                  訂金方式
                  <select
                    value={depositMode}
                    onChange={(e) => setDepositMode(e.target.value as "NONE" | TenderCode)}
                    className="ml-1 border border-[#aca899] bg-white px-1 py-0.5"
                  >
                    <option value="NONE">無訂金</option>
                    <option value="CASH">現金</option>
                    <option value="VISA">Visa</option>
                    <option value="MASTERCARD">MasterCard</option>
                    <option value="BANK_XFER">Bank Transfer</option>
                  </select>
                </label>
                <label>
                  訂金
                  <input
                    type="number"
                    disabled={depositMode === "NONE"}
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    className="ml-1 w-24 border border-[#aca899] bg-white px-1 py-0.5 font-mono disabled:bg-[#e8e8e8]"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {/* keypad */}
          <div className="border-t border-[#aca899] bg-[#f0f0f0] p-1">
            <div className="flex gap-1">
              <div className="grid flex-1 grid-cols-3 gap-1">
                {["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00", "."].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEntryBuffer((prev) => (prev + k).slice(0, 12))}
                    className="border border-[#aca899] bg-white py-2 text-center font-mono text-[22px] text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div className="flex w-28 flex-col gap-1">
                <div className="flex h-9 items-center justify-end bg-black px-2 font-mono text-[18px] text-[#7fff7f]">
                  {entryBuffer || pendingQty > 1 ? entryBuffer || `x${pendingQty}` : ""}
                </div>
                <button
                  type="button"
                  onClick={applyQuantity}
                  className="border border-[#aca899] bg-white py-1.5 text-[12px] text-black hover:bg-[#e5e1d5]"
                >
                  <div className="font-mono text-[15px]">{entryBuffer || "1"}</div>數量
                </button>
                <button
                  type="button"
                  onClick={() => commitBarcode()}
                  className="border border-[#aca899] bg-white py-2 text-[18px] hover:bg-[#e5e1d5]"
                  title="輸入條碼"
                >
                  ▌▍▌▍
                </button>
                <button
                  type="button"
                  onClick={() => setEntryBuffer("")}
                  className="border border-[#aca899] bg-white py-2 font-mono text-[22px] text-black hover:bg-[#e5e1d5]"
                >
                  C
                </button>
              </div>
              <div className="flex w-24 flex-col gap-1">
                <button
                  type="button"
                  onClick={cycleLineDiscount}
                  className="flex-1 border border-[#aca899] bg-white text-[12px] text-black hover:bg-[#e5e1d5]"
                >
                  📦%<br />項折
                </button>
                <button
                  type="button"
                  onClick={flagDelivery}
                  className="flex-1 border border-[#aca899] bg-white text-[12px] text-black hover:bg-[#e5e1d5]"
                >
                  🛒<br />送貨
                </button>
                <button
                  type="button"
                  onClick={applyBillDiscount}
                  className="flex-1 border border-[#aca899] bg-white text-[12px] text-black hover:bg-[#e5e1d5]"
                >
                  🧾%<br />單折
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* far-right icon strip */}
        <div className="flex w-12 flex-col border-l border-[#aca899] bg-[#f0f0f0]">
          <button type="button" className={sideBtn} onClick={() => setActivePanel("info")} title="資訊">
            ℹ️
          </button>
          <button type="button" className={sideBtn} onClick={() => router.push("/")} title="離開">
            🚪離開
          </button>
          <button type="button" className={sideBtn} onClick={() => setActivePanel("image")} title="影像">
            🖼️影像
          </button>
          <button type="button" className={sideBtn} onClick={() => setActivePanel("promo")} title="優惠">
            🏷️優惠
          </button>
          <button type="button" className={sideBtn} onClick={() => setActivePanel("products")} title="貨品">
            📦貨品
          </button>
          <button type="button" className={sideBtn} onClick={() => setActivePanel("members")} title="會員">
            👥會員
          </button>
          <button type="button" className={sideBtn} onClick={() => setActivePanel("staff")} title="職員">
            👤職員
          </button>
        </div>
      </div>

      {/* ── 4. tender panel (方法) ─────────────────────────────────────── */}
      {tenderMode ? (
        <div className="flex items-stretch gap-1 border-t border-[#aca899] bg-[#f0f0f0] p-1">
          {TENDERS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setSelectedTender(t.key)}
              className={`flex w-28 flex-col items-center border px-1 py-1.5 text-[12px] ${
                selectedTender === t.key
                  ? "border-[#316ac5] bg-[#316ac5] text-white"
                  : "border-[#aca899] bg-white text-black hover:bg-[#e5e1d5]"
              }`}
            >
              <span className="font-bold">{t.zh}</span>
              {t.sub ? <span className="text-[10px] opacity-70">{t.sub}</span> : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── 5. function key row ────────────────────────────────────────── */}
      <div className="flex border-t border-[#aca899] bg-[#f0f0f0]">
        {selectedLine ? (
          <button type="button" className={fnBtn} onClick={() => removeLine(selectedLine.item.sku)} title="取消項目">
            <span className="text-[20px]">🗑️</span>取消項目
          </button>
        ) : (
          <button
            type="button"
            className={fnBtn}
            style={docType === "SALES_RETURN" ? { background: "#ffd7d7" } : undefined}
            onClick={toggleReturnMode}
            title="退售"
          >
            <span className="text-[20px]">↩️</span>退售
          </button>
        )}
        <button type="button" className={fnBtn} onClick={priceEnquiry} title="選價">
          <span className="text-[20px]">💲</span>選價
        </button>
        <button type="button" className={fnBtn} onClick={overridePrice} title="改價">
          <span className="text-[20px]">✏️</span>改價
        </button>
        <button
          type="button"
          className={fnBtn}
          style={tenderMode ? { background: "#d7e7ff" } : undefined}
          onClick={() => setTenderMode((v) => !v)}
          title="方法"
        >
          <span className="text-[20px]">💳</span>方法
        </button>
        <button type="button" className={fnBtn} onClick={reselect} title="重選">
          <span className="text-[20px]">🚫</span>重選
        </button>
        <button
          type="button"
          className={`${fnBtn} border-r-0`}
          disabled={cart.length === 0 || submitting}
          style={cart.length === 0 || submitting ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
          onClick={() => void submitBill()}
          title="完成"
        >
          <span className="text-[20px]">✅</span>
          {submitting ? "儲存中…" : selectedTender === "UNPAID_INVOICE" ? "完成(開票)" : "完成"}
        </button>
      </div>

      {/* status line */}
      {statusMessage ? (
        <div className="border-t border-[#d4d0c8] bg-[#ffffe1] px-2 py-0.5 text-[12px] text-black">
          {statusMessage}
        </div>
      ) : null}

      {/* ── 6. VB6 message dialog ──────────────────────────────────────── */}
      {msg ? (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/10 pt-24">
          <div className="w-[480px] border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
            <div className="border-b border-[#d4d0c8] px-2 py-0.5 text-[12px] font-bold text-black">營運通訊息</div>
            <div className="flex items-start gap-3 p-3">
              <span className="text-[28px]">💬</span>
              <div className="min-h-16 flex-1 border border-[#aca899] bg-white p-2">
                <div className="text-[13px] font-bold text-[#2e7ec2]">營運通訊息 - {msg.code}</div>
                <div className="mt-1 whitespace-pre-line text-[13px] font-bold text-[#c00000]">{msg.text}</div>
              </div>
            </div>
            <div className="flex justify-end p-2">
              <button
                type="button"
                autoFocus
                onClick={() => setMsg(null)}
                className="border border-[#aca899] bg-[#e1dfff] px-6 py-1.5 text-[13px] text-black hover:bg-[#d0ccff]"
              >
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── 7. 查單 dialog ─────────────────────────────────────────────── */}
      {showBillQuery ? (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/10 pt-10">
          <div className="flex h-[70%] w-[80%] flex-col border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
            <div className="border-b border-[#d4d0c8] px-2 py-0.5 text-[12px] font-bold text-black">查單</div>
            <div className="flex border-b border-[#aca899] text-[12px]">
              {["今日銷售", "暫停單", "其他交易", "未處理單"].map((tab, i) => (
                <span
                  key={tab}
                  className={`border-r border-[#aca899] px-3 py-1 ${i === 0 ? "bg-white font-bold" : "bg-[#f0f0f0]"} text-black`}
                >
                  {tab}
                </span>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-white">
              <table className="w-full border-collapse text-[12px]">
                <thead className="sticky top-0">
                  <tr className="bg-[#e8eef5] text-left text-black">
                    <th className="px-2 py-1 font-normal">單號</th>
                    <th className="px-2 py-1 font-normal">類型</th>
                    <th className="px-2 py-1 font-normal">狀態</th>
                    <th className="px-2 py-1 text-right font-normal">金額</th>
                    <th className="px-2 py-1 text-right font-normal">餘額</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {recentDocs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-6 text-center text-[#808080]">
                        （本機暫無已完成單據 — 完整列表請到「發票與 AR」頁）
                      </td>
                    </tr>
                  ) : (
                    recentDocs.map((doc) => (
                      <tr key={doc.invoiceNo} className="border-b border-[#e0e0e0] text-black">
                        <td className="px-2 py-1 font-mono">{doc.invoiceNo}</td>
                        <td className="px-2 py-1">{doc.docType}</td>
                        <td className="px-2 py-1">{doc.paymentStatus.toUpperCase()}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatHkd(doc.netAmountHkd)}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatHkd(doc.balanceDueHkd)}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            className="border border-[#aca899] bg-[#f0f0f0] px-2 py-0.5 hover:bg-[#e5e1d5]"
                            onClick={() => router.push(`/invoices/${encodeURIComponent(doc.invoiceNo)}/print`)}
                          >
                            列印
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#aca899] p-2">
              <button
                type="button"
                className="border border-[#aca899] bg-[#f0f0f0] px-4 py-1 text-[12px] text-black hover:bg-[#e5e1d5]"
                onClick={() => router.push("/invoices")}
              >
                發票與 AR 頁
              </button>
              <button
                type="button"
                autoFocus
                className="border border-[#aca899] bg-[#e1dfff] px-6 py-1 text-[12px] text-black hover:bg-[#d0ccff]"
                onClick={() => setShowBillQuery(false)}
              >
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── 8. 關於軟件 dialog ─────────────────────────────────────────── */}
      {showAbout ? (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/10 pt-32">
          <div className="w-[420px] border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
            <div className="border-b border-[#d4d0c8] px-2 py-0.5 text-[12px] font-bold text-black">關於軟件</div>
            <div className="p-4 text-center text-[13px] text-black">
              <div className="text-[20px] font-bold italic text-[#2e7ec2]">eRun</div>
              <div className="mt-1 font-bold">eRun POSGV3.3 678</div>
              <div className="mt-1">Copyright 2001-2026</div>
              <div className="mt-1">授權給： eRun</div>
              <div className="mt-2 text-[11px] text-[#808080]">POS v2 Web 重製介面（React 19 / Next.js 15）</div>
            </div>
            <div className="flex justify-end p-2">
              <button
                type="button"
                autoFocus
                className="border border-[#aca899] bg-[#e1dfff] px-6 py-1 text-[12px] text-black hover:bg-[#d0ccff]"
                onClick={() => setShowAbout(false)}
              >
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

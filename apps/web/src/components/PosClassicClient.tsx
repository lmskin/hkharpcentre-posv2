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

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BillDocType, TenderCode } from "@hkharp/contracts";
import type { ActiveStoreContext, SessionPayload } from "@hkharp/db";
import { calculateBillTotals } from "@hkharp/domain/bill-math";
import { calculateCrmPoints } from "@hkharp/domain/crm-rules";
import { formatHkd } from "@hkharp/domain/money";
import { validateOctopusAmountHkd } from "@hkharp/domain/octopus-rules";
import { applyPromotionRules, type PromotionRule } from "@hkharp/domain/promotion-engine";
import type { PosCustomer, PosMenuGroup, PosProduct } from "@/components/PosRegisterClient";
import { BillQueryDialog } from "@/components/BillQueryDialog";
import { AutoSuggestInput } from "@/components/AutoSuggestInput";
import { LegacyPicker } from "@/components/LegacyPicker";
import { ERunAboutBadge, ERunWordmark, HarpCentreLogo, LegacyIcon } from "@/components/LegacyIcons";
import { PriceCheckWorkspace } from "@/components/PriceCheckWorkspace";
import { LegacyReceiptReportView } from "@/components/LegacyReceiptReportView";
import { LegacyStatsWorkspace } from "@/components/LegacyStatsWorkspace";
import { QuickMemberModal } from "@/components/QuickMemberModal";
import type { ReceiptDetail } from "@/components/ReceiptPreview";
import { StockPanel } from "@/components/StockPanel";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { PrinterSetupDialog } from "@/components/PrinterSetupDialog";
import { HourlyReport } from "@/components/reports/HourlyReport";
import { ItemReport } from "@/components/reports/ItemReport";
import { HistoryReport } from "@/components/reports/HistoryReport";
import { ManagerStatsReport } from "@/components/reports/ManagerStatsReport";
import { LegacyReportCenter, type ReportCenterTab } from "@/components/reports/LegacyReportCenter";
import { SupportDialog, type SupportKind } from "@/components/SupportDialog";
import { OfficeTxnPanel, type OfficeDocType } from "@/components/OfficeTxnPanel";
import { formatLegacyMessage, type LegacyLanguage } from "@/lib/legacy-messages";

interface CartLine {
  item: PosProduct;
  quantity: number;
  discountRate: number;
  overrideUnitPriceHkd?: number;
  notes?: string;
  serialNo?: string;
}

function getLineUnitPrice(line: CartLine): number {
  return line.overrideUnitPriceHkd ?? line.item.unitPriceHkd;
}

interface SavedDocSummary {
  invoiceNo: string;
  docType: string;
  paymentStatus: string;
  netAmountHkd: number;
  balanceDueHkd: number;
}

interface PosStaff {
  id: number;
  legacyId: string | null;
  displayName: string;
  roleLevel: number;
  active: boolean;
  phone?: string;
  cardNo?: string;
}

type WorkspaceMode =
  | "retail"
  | "priceCheck"
  | "receiptHourly"
  | "receiptItem"
  | "monthlyBusiness"
  | "monthlyItem"
  | "inventory"
  | "salesStats"
  | "memberStats"
  | "staffStats";

type RightPanelId = "image" | "quickpick" | "products" | "members" | "staff" | "promo" | "info";

type SideMenuId =
  | "info"
  | "otherTxn"
  | "cashier"
  | "manager"
  | "salesData"
  | "historicalData"
  | "support"
  | "buttons";

type TenderChoice = "OCTOPUS" | "CASH" | "UNPAID_INVOICE" | TenderCode;

const OFFLINE_QUEUE_KEY = "hkharp_offline_bills_v2";

/** Legacy CashierFolder1 octave/sub-folder tab captions (decrypted CustomerData BBGroup*). */
const LEGACY_BBG_TABS: Record<string, Record<number, string>> = {
  BBG_1: { 0: "Top", 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" },
  BBG_5: { 0: "Others" },
  BBG_6: { 0: "Top", 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" },
  BBG_7: { 0: "Top", 1: "1st", 2: "2nd" },
  BBG_8: { 0: "1st", 1: "2nd", 2: "3rd", 3: "4th", 4: "5th" },
  BBG_9: { 0: "3rd", 1: "4th", 2: "5th", 3: "1st", 4: "2nd" },
  BBG_10: { 0: "5th", 1: "6th", 2: "7th" },
  BBG_11: { 0: "5th", 1: "6th", 2: "7th" },
  BBG_12: { 0: "4th", 1: "5th" },
  BBG_14: { 0: "1st", 1: "2nd", 2: "3rd", 3: "4th", 4: "5th" },
  BBG_15: { 0: "2nd", 1: "3rd", 2: "4th", 3: "5th" },
  BBG_16: { 0: "Top", 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" },
  BBG_17: { 0: "Top", 1: "1st", 2: "2nd" },
  BBG_18: { 0: "Sipario Silkgut", 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th" },
  BBG_20: { 0: "5th", 1: "6th", 2: "7th" },
  BBG_21: { 0: "1st", 1: "2nd", 2: "3rd", 3: "4th", 4: "5th" },
  BBG_22: { 0: "5th", 1: "6th" },
};

function getMinFtForMenu(menu: PosMenuGroup | undefined): number {
  if (!menu || menu.buttons.length === 0) return 0;
  return Math.min(...menu.buttons.map((b) => b.ft ?? 0));
}

/** Tender row captured from the VB6 方法 panel (支付寶 legacy label = MasterCard PM=3). */
const TENDERS: ReadonlyArray<{ key: TenderChoice; zh: string }> = [
  { key: "CASH", zh: "現金" },
  { key: "OCTOPUS", zh: "八達通" },
  { key: "VISA", zh: "Visa" },
  { key: "MASTERCARD", zh: "支付寶" },
  { key: "UNIONPAY", zh: "銀聯" },
  { key: "BANK_XFER", zh: "Bank Transfer" },
  { key: "AMEX", zh: "AE" },
  { key: "CHEQUE", zh: "Cheque" },
  { key: "UNPAID_INVOICE", zh: "付款一" },
];

interface SplitPaymentEntry {
  id: string;
  tenderCode: TenderCode;
  amountHkd: number;
  approvalCode?: string;
  cardLast4?: string;
  octopusCardId?: string;
  octopusDeviceId?: string;
  octopusRemainingHkd?: number;
  remarks?: string;
}

const LINE_DISCOUNTS = [0, 0.05, 0.1, 0.15, 0.2];

const VB_FONT = "Tahoma, 'Microsoft JhengHei', 'PMingLiU', sans-serif";

export function PosClassicClient({
  session,
  authRequired = false,
  storeContext,
  menus,
  initialProducts,
  initialCustomers,
  bridgeUrl,
  bridgeToken,
}: {
  session: SessionPayload | null;
  authRequired?: boolean;
  storeContext?: ActiveStoreContext | null;
  menus: PosMenuGroup[];
  initialProducts: PosProduct[];
  initialCustomers: PosCustomer[];
  bridgeUrl: string;
  bridgeToken: string;
}) {
  const router = useRouter();

  // ---- catalog / cart state -------------------------------------------------
  const retailMenus = useMemo(() => menus.filter((m) => m.code !== "BBG_92"), [menus]);
  const [products, setProducts] = useState<PosProduct[]>(initialProducts);
  const [productQuery, setProductQuery] = useState("");
  const [activeMenuId, setActiveMenuId] = useState<number | null>(retailMenus[0]?.id ?? null);
  const [activeFt, setActiveFt] = useState<number>(() => getMinFtForMenu(retailMenus[0]));
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [customers, setCustomers] = useState<PosCustomer[]>(initialCustomers);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [productPage, setProductPage] = useState(1);
  const [productTotal, setProductTotal] = useState(initialProducts.length);
  const [customerPage, setCustomerPage] = useState(1);
  const [customerTotal, setCustomerTotal] = useState(initialCustomers.length);
  const [staffItems, setStaffItems] = useState<PosStaff[]>([]);
  const [staffQuery, setStaffQuery] = useState("");
  const [staffPage, setStaffPage] = useState(1);
  const [staffTotal, setStaffTotal] = useState(0);
  const [selectedSalesperson, setSelectedSalesperson] = useState<PosStaff | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  // ---- legacy UI state ------------------------------------------------------
  // Legacy starts on the 影像 panel (Harp Centre logo + support hotline).
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("retail");
  const [rightPanel, setRightPanel] = useState<RightPanelId>("image");
  const [sideMenu, setSideMenu] = useState<SideMenuId>("info");
  const [buttonCatPage, setButtonCatPage] = useState(0);
  const [quickMemberModal, setQuickMemberModal] = useState<{
    mode: "add" | "edit" | "detail";
    customer?: PosCustomer | null;
  } | null>(null);
  const [memberSearchScope, setMemberSearchScope] = useState<"all" | "id" | "name" | "phone">("all");
  const [storeCategories, setStoreCategories] = useState<
    Array<{ legacyC1: number; nameZh: string; nameEn: string }>
  >([]);
  const [entryBuffer, setEntryBuffer] = useState("");
  const [pendingQty, setPendingQty] = useState(1);
  const [tenderMode, setTenderMode] = useState(false);
  const [msg, setMsg] = useState<{ code: string; text: string } | null>(null);
  const [showBillQuery, setShowBillQuery] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPrinter, setShowPrinter] = useState(false);
  const [activeReport, setActiveReport] = useState<"hourly" | "items" | "history" | "stats" | "center" | null>(null);
  const [centerTab, setCenterTab] = useState<ReportCenterTab>("allstat");
  const [supportKind, setSupportKind] = useState<SupportKind | null>(null);
  const [officeTxnType, setOfficeTxnType] = useState<OfficeDocType | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const language: LegacyLanguage = "TC";
  const [completedInvoiceNo, setCompletedInvoiceNo] = useState<string | null>(null);

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
  const [, setRecentDocs] = useState<SavedDocSummary[]>([]);
  const [editingInvoiceNo, setEditingInvoiceNo] = useState<string | null>(null);
  const [depositTargetInvoice, setDepositTargetInvoice] = useState<{
    invoiceNo: string;
    netAmountHkd: number;
    alreadyPaidHkd: number;
    balanceDueHkd: number;
  } | null>(null);
  const [memberSortBy, setMemberSortBy] = useState<"newest_id" | "points">("newest_id");
  const [isDelivery, setIsDelivery] = useState(false);
  const [appliedSplits, setAppliedSplits] = useState<SplitPaymentEntry[]>([]);
  const [promoRules, setPromoRules] = useState<PromotionRule[]>([]);
  const [printerOnOff, setPrinterOnOff] = useState(false);
  const [outboxCount, setOutboxCount] = useState(0);
  const [showFloatModal, setShowFloatModal] = useState(false);
  const [floatInput, setFloatInput] = useState("2000");
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [showPayMethod2, setShowPayMethod2] = useState(false);
  const [pay2Amount, setPay2Amount] = useState("");
  const [editingLineState, setEditingLineState] = useState<{
    sku: string;
    qty: string;
    price: string;
    discPct: string;
    notes: string;
    serialNo: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      setOutboxCount(arr.length);
    } catch {
      setOutboxCount(0);
    }
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data: { settings?: Record<string, { rules?: PromotionRule[] }> }) => {
        const rules = data.settings?.promotion_rules?.rules;
        if (Array.isArray(rules)) setPromoRules(rules);
      })
      .catch(() => {});
    if (session) {
      fetch("/api/settings/printers")
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { config?: { onOff?: boolean } } | null) => {
          if (data?.config?.onOff !== undefined) setPrinterOnOff(Boolean(data.config.onOff));
        })
        .catch(() => {});
      if (session.roleLevel >= 4) {
        fetch("/api/reports?view=meta")
          .then((r) => (r.ok ? r.json() : null))
          .then((body: { categories?: Array<{ legacyC1: number; nameZh: string; nameEn: string }> } | null) => {
            if (Array.isArray(body?.categories)) {
              setStoreCategories(body.categories);
            }
          })
          .catch(() => {});
      }
    }
  }, [session]);

  useEffect(() => {
    const handleOnline = () => {
      try {
        const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
        const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
        if (Array.isArray(arr) && arr.length > 0) {
          void flushOfflineOutbox();
        }
      } catch {
        // ignore storage parse error
      }
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  // ---- derived values -------------------------------------------------------
  const promoResult = useMemo(
    () =>
      applyPromotionRules(
        cart.map((c) => ({
          sku: c.item.sku,
          categoryC1: c.item.categoryC1,
          quantity: c.quantity,
          unitPriceHkd: getLineUnitPrice(c),
          discountRate: c.discountRate,
        })),
        promoRules,
      ),
    [cart, promoRules],
  );

  const totals = calculateBillTotals(
    cart.map((c, idx) => ({
      sku: c.item.sku,
      quantity: c.quantity,
      unitPriceHkd: getLineUnitPrice(c),
      discountRate: promoRules.length > 0 ? (promoResult.lines[idx]?.discountRate ?? c.discountRate) : c.discountRate,
      dk: idx + 1,
    })),
  );

  const netPayableHkd = Math.max(0, Number((totals.netAmountHkd - promoResult.billDiscountHkd).toFixed(2)));
  const splitPaidTotal = Number(appliedSplits.reduce((s, p) => s + p.amountHkd, 0).toFixed(2));
  const effectiveDueBaseHkd = depositTargetInvoice ? depositTargetInvoice.balanceDueHkd : netPayableHkd;
  const remainingDue = Math.max(0, Number((effectiveDueBaseHkd - splitPaidTotal).toFixed(2)));

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

  const octopusTargetAmount = remainingDue > 0 ? remainingDue : netPayableHkd;
  const octopusValidation = validateOctopusAmountHkd(octopusTargetAmount);
  const selectedLine = cart.find((c) => c.item.sku === selectedSku) ?? null;
  const grossAmount = totals.grossAmountHkd;
  const lineDiscountTotal = Number((totals.discountAmountHkd + promoResult.billDiscountHkd).toFixed(2));

  const cashTendered = Number(entryBuffer);
  const changeDue =
    tenderMode && selectedTender === "CASH" && cashTendered > remainingDue
      ? cashTendered - remainingDue
      : 0;

  const activeQuickMenu = useMemo(
    () => retailMenus.find((x) => x.id === activeMenuId) ?? retailMenus[0] ?? null,
    [retailMenus, activeMenuId],
  );

  const quickPickTabEntries = useMemo(() => {
    if (!activeQuickMenu) return [] as Array<{ ft: number; label: string }>;
    const tabDef = LEGACY_BBG_TABS[activeQuickMenu.code] ?? {};
    const presentFts = Array.from(new Set(activeQuickMenu.buttons.map((b) => b.ft ?? 0))).sort((a, b) => a - b);
    return presentFts.map((ft) => ({ ft, label: tabDef[ft] ?? `頁 ${ft + 1}` }));
  }, [activeQuickMenu]);

  const quickPickSlots = useMemo(() => {
    const tabButtons = activeQuickMenu
      ? activeQuickMenu.buttons.filter((b) => (b.ft ?? 0) === activeFt)
      : products.slice(0, 25);
    const hasBli = tabButtons.some((b) => typeof b.bli === "number" && b.bli > 0);
    return Array.from({ length: 25 }, (_, idx) => {
      const slot = idx + 1;
      const item = hasBli ? (tabButtons.find((b) => b.bli === slot) ?? null) : (tabButtons[idx] ?? null);
      return { slot, item };
    });
  }, [activeQuickMenu, activeFt, products]);

  function selectQuickPickMenu(menu: PosMenuGroup) {
    setActiveMenuId(menu.id);
    setActiveFt(getMinFtForMenu(menu));
  }

  // ---- data helpers ---------------------------------------------------------
  const productSearchSeqRef = useRef(0);
  const customerSearchSeqRef = useRef(0);
  const staffSearchSeqRef = useRef(0);

  async function runProductSearch(q: string, page = 1) {
    const seq = ++productSearchSeqRef.current;
    setProductQuery(q);
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/products?q=${encodeURIComponent(q)}&page=${page}&pageSize=12`);
      if (seq !== productSearchSeqRef.current) return;
      if (res.ok) {
        const data = (await res.json()) as { items: PosProduct[]; total: number; page: number };
        if (seq !== productSearchSeqRef.current) return;
        setProducts(data.items);
        setProductTotal(data.total);
        setProductPage(data.page);
      }
    } finally {
      if (seq === productSearchSeqRef.current) setPickerLoading(false);
    }
  }

  async function runCustomerSearch(
    q: string,
    page = 1,
    scopeOverride?: "all" | "id" | "name" | "phone",
    sortOverride?: "newest_id" | "points",
  ) {
    const seq = ++customerSearchSeqRef.current;
    const activeScope = scopeOverride ?? memberSearchScope;
    const activeSort = sortOverride ?? memberSortBy;
    setCustomerQuery(q);
    setPickerLoading(true);
    try {
      const params = new URLSearchParams({
        q,
        page: String(page),
        pageSize: "12",
        searchField: activeScope,
        sortBy: activeSort,
      });
      const res = await fetch(`/api/customers?${params.toString()}`);
      if (seq !== customerSearchSeqRef.current) return;
      if (res.ok) {
        const data = (await res.json()) as { customers: PosCustomer[]; total: number; page: number };
        if (seq !== customerSearchSeqRef.current) return;
        setCustomers(data.customers);
        setCustomerTotal(data.total);
        setCustomerPage(data.page);
      }
    } finally {
      if (seq === customerSearchSeqRef.current) setPickerLoading(false);
    }
  }

  async function runStaffSearch(q: string, page = 1) {
    const seq = ++staffSearchSeqRef.current;
    setStaffQuery(q);
    setPickerLoading(true);
    try {
      const res = await fetch(`/api/staff?q=${encodeURIComponent(q)}&page=${page}&pageSize=12`);
      if (seq !== staffSearchSeqRef.current) return;
      if (res.ok) {
        const data = (await res.json()) as { items: PosStaff[]; total: number; page: number };
        if (seq !== staffSearchSeqRef.current) return;
        setStaffItems(data.items);
        setStaffTotal(data.total);
        setStaffPage(data.page);
      }
    } finally {
      if (seq === staffSearchSeqRef.current) setPickerLoading(false);
    }
  }

  useEffect(() => {
    if (rightPanel === "products") void runProductSearch(productQuery, productPage);
    if (rightPanel === "members") void runCustomerSearch(customerQuery, customerPage);
    if (rightPanel === "staff") void runStaffSearch(staffQuery, staffPage);
  }, [rightPanel]);

  function showMsg(code: string, text: string) {
    setCompletedInvoiceNo(null);
    setMsg({ code, text });
  }

  function showLegacyMsg(code: string, values: Record<string, string | number> = {}) {
    showMsg(code, formatLegacyMessage(code, language, values));
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

  async function resolveProductByCode(code: string): Promise<PosProduct | null> {
    const lower = code.toLowerCase();
    let hit = products.find(
      (p) => p.sku.toLowerCase() === lower || Boolean(p.ubc && p.ubc.toLowerCase() === lower),
    );
    if (!hit) {
      const exactRes = await fetch(`/api/products?exactCode=${encodeURIComponent(code)}`);
      if (exactRes.ok) {
        const exactData = (await exactRes.json()) as { item: PosProduct | null };
        if (exactData.item) hit = exactData.item;
      }
    }
    if (!hit) {
      const res = await fetch(`/api/products?q=${encodeURIComponent(code)}&page=1&pageSize=200`);
      if (res.ok) {
        const data = (await res.json()) as { items: PosProduct[] };
        hit = data.items.find(
          (p) => p.sku.toLowerCase() === lower || Boolean(p.ubc && p.ubc.toLowerCase() === lower),
        );
      }
    }
    return hit ?? null;
  }

  /** Barcode / UBC entry & retailsf prefix operators (* / [ > = x). */
  async function commitBarcode(raw?: string) {
    const code = (raw ?? entryBuffer).trim();
    if (!code) return;

    const multiQtyMatch = code.match(/^\*(\d+)\*(.+)$/);
    if (multiQtyMatch) {
      const qty = Math.max(1, parseInt(multiQtyMatch[1]!, 10) || 1);
      const targetCode = multiQtyMatch[2]!.trim();
      setEntryBuffer("");
      if (!targetCode) return;
      const hit = await resolveProductByCode(targetCode);
      if (!hit) {
        showLegacyMsg("017", { barcode: targetCode });
        return;
      }
      addItem(hit, qty);
      return;
    }

    const qtyPrefixMatch = code.match(/^\*(\d+)$/);
    if (qtyPrefixMatch) {
      const n = Math.max(1, parseInt(qtyPrefixMatch[1]!, 10) || 1);
      setPendingQty(n);
      setEntryBuffer("");
      setStatusMessage(`起始數量設定為 ${n}（下一貨品）`);
      return;
    }

    const changeMatch = code.match(/^\/(\d+(?:\.\d+)?)$/);
    if (changeMatch) {
      const amt = Number(changeMatch[1]!);
      setTenderMode(true);
      setSelectedTender("CASH");
      setEntryBuffer(changeMatch[1]!);
      setStatusMessage(`找續計算：客付 ${formatHkd(amt)}`);
      return;
    }

    const itemDiscMatch = code.match(/^\[(\d+(?:\.\d+)?)$/);
    if (itemDiscMatch) {
      if (!selectedLine) {
        showLegacyMsg("021");
        return;
      }
      if (selectedLine.item.isFixedPrice || selectedLine.item.allowItemDiscount === false) {
        showLegacyMsg("026");
        return;
      }
      const pct = Number(itemDiscMatch[1]!);
      if (pct > 100) {
        showLegacyMsg("020");
        return;
      }
      setOctopusApprovedInfo(null);
      setCart((prev) =>
        prev.map((c) => (c.item.sku === selectedLine.item.sku ? { ...c, discountRate: Number((pct / 100).toFixed(4)) } : c)),
      );
      setEntryBuffer("");
      setStatusMessage(`${selectedLine.item.sku} 項折 ${pct}%`);
      return;
    }

    const allDiscMatch = code.match(/^>(\d+(?:\.\d+)?)$/);
    if (allDiscMatch) {
      if (cart.length === 0) {
        showLegacyMsg("022");
        return;
      }
      const eligible = cart.filter((c) => !c.item.isFixedPrice && c.item.allowItemDiscount !== false);
      if (eligible.length === 0) {
        showLegacyMsg("026");
        return;
      }
      const pct = Number(allDiscMatch[1]!);
      if (pct > 100) {
        showLegacyMsg("020");
        return;
      }
      const rate = Number((pct / 100).toFixed(4));
      setOctopusApprovedInfo(null);
      setCart((prev) =>
        prev.map((c) =>
          c.item.isFixedPrice || c.item.allowItemDiscount === false ? c : { ...c, discountRate: rate },
        ),
      );
      setEntryBuffer("");
      setStatusMessage(`多項折 ${pct}% 已套用可折貨品`);
      return;
    }

    const chgQtyMatch = code.match(/^=(\d+)$/);
    if (chgQtyMatch) {
      const n = Math.max(1, parseInt(chgQtyMatch[1]!, 10) || 1);
      if (selectedLine) {
        setOctopusApprovedInfo(null);
        setCart((prev) =>
          prev.map((c) => (c.item.sku === selectedLine.item.sku ? { ...c, quantity: n } : c)),
        );
        setStatusMessage(`${selectedLine.item.sku} 數量改為 ${n}`);
      } else {
        setPendingQty(n);
        setStatusMessage(`數量設定為 ${n}（下一貨品）`);
      }
      setEntryBuffer("");
      return;
    }

    if (/^[xX]$/.test(code)) {
      if (!selectedLine) {
        showLegacyMsg("021");
        return;
      }
      removeLine(selectedLine.item.sku);
      setEntryBuffer("");
      return;
    }

    const hit = await resolveProductByCode(code);
    if (!hit) {
      showLegacyMsg("017", { barcode: code });
      return;
    }
    addItem(hit);
  }

  /** Next rate in the legacy discount cycle (safe under noUncheckedIndexedAccess). */
  function nextDiscount(current: number): number {
    const idx = LINE_DISCOUNTS.indexOf(current);
    return LINE_DISCOUNTS[(idx + 1) % LINE_DISCOUNTS.length] ?? 0;
  }

  /** 項折: apply numeric entryBuffer % if entered, else cycle the selected line's discount rate. */
  function cycleLineDiscount() {
    if (!selectedLine) {
      showLegacyMsg("021");
      return;
    }
    if (selectedLine.item.isFixedPrice || selectedLine.item.allowItemDiscount === false) {
      showLegacyMsg("026");
      return;
    }
    const raw = entryBuffer.trim();
    if (raw !== "" && /^\d+(?:\.\d+)?$/.test(raw)) {
      const pct = Number(raw);
      if (pct > 100) {
        showLegacyMsg("020");
        return;
      }
      const next = Number((pct / 100).toFixed(4));
      setOctopusApprovedInfo(null);
      setCart((prev) =>
        prev.map((c) => (c.item.sku === selectedLine.item.sku ? { ...c, discountRate: next } : c)),
      );
      setEntryBuffer("");
      setStatusMessage(`${selectedLine.item.sku} 項折 ${pct}%`);
      return;
    }
    const next = nextDiscount(selectedLine.discountRate);
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) => (c.item.sku === selectedLine.item.sku ? { ...c, discountRate: next } : c)),
    );
    setStatusMessage(`${selectedLine.item.sku} 項折 ${(next * 100).toFixed(0)}%`);
  }

  /** 單折: apply numeric entryBuffer % if entered, else cycle one discount rate across discountable lines. */
  function applyBillDiscount() {
    if (cart.length === 0) {
      showLegacyMsg("022");
      return;
    }
    const eligible = cart.filter((c) => !c.item.isFixedPrice && c.item.allowItemDiscount !== false);
    if (eligible.length === 0) {
      showLegacyMsg("026");
      return;
    }
    const raw = entryBuffer.trim();
    if (raw !== "" && /^\d+(?:\.\d+)?$/.test(raw)) {
      const pct = Number(raw);
      if (pct > 100) {
        showLegacyMsg("020");
        return;
      }
      const rate = Number((pct / 100).toFixed(4));
      setOctopusApprovedInfo(null);
      setCart((prev) =>
        prev.map((c) =>
          c.item.isFixedPrice || c.item.allowItemDiscount === false ? c : { ...c, discountRate: rate },
        ),
      );
      setEntryBuffer("");
      setStatusMessage(`單折 ${pct}% 已套用可折貨品`);
      return;
    }
    const rate = nextDiscount(eligible[0]?.discountRate ?? 0);
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) =>
        c.item.isFixedPrice || c.item.allowItemDiscount === false ? c : { ...c, discountRate: rate },
      ),
    );
    setStatusMessage(`單折 ${(rate * 100).toFixed(0)}% 已套用可折貨品`);
  }

  /** Ctl-Z 改總價: solve uniform discount rate on discountable lines to hit target bill total. */
  function overrideBillTotal() {
    if (cart.length === 0) {
      showLegacyMsg("022");
      return;
    }
    const raw = entryBuffer.trim();
    const target = Number(raw);
    if (!raw || !Number.isFinite(target) || target < 0 || target > grossAmount) {
      showLegacyMsg("027");
      return;
    }
    let fixedSum = 0;
    let discGross = 0;
    for (const c of cart) {
      const lineGross = c.quantity * getLineUnitPrice(c);
      if (c.item.isFixedPrice || c.item.allowItemDiscount === false) fixedSum += lineGross;
      else discGross += lineGross;
    }
    if (discGross <= 0 || target < fixedSum) {
      showLegacyMsg("026");
      return;
    }
    const rate = Math.max(0, Math.min(1, Number((1 - (target - fixedSum) / discGross).toFixed(6))));
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) =>
        c.item.isFixedPrice || c.item.allowItemDiscount === false ? c : { ...c, discountRate: rate },
      ),
    );
    setEntryBuffer("");
    setStatusMessage(`改總價目標 ${formatHkd(target)}`);
  }

  function moveSelection(delta: -1 | 1) {
    if (cart.length === 0) return;
    const curIdx = cart.findIndex((c) => c.item.sku === selectedSku);
    const nextIdx =
      curIdx < 0
        ? delta > 0
          ? 0
          : cart.length - 1
        : Math.max(0, Math.min(cart.length - 1, curIdx + delta));
    setSelectedSku(cart[nextIdx]!.item.sku);
  }

  function saveLineModalEdit() {
    if (!editingLineState) return;
    const targetLine = cart.find((c) => c.item.sku === editingLineState.sku);
    if (!targetLine) {
      setEditingLineState(null);
      return;
    }
    const qty = Math.max(1, parseInt(editingLineState.qty || "1", 10) || 1);
    const parsedPrice = Number(editingLineState.price);
    const pct = Number(editingLineState.discPct || "0");
    if (!targetLine.item.isFixedPrice && targetLine.item.allowItemDiscount !== false && pct > 100) {
      showLegacyMsg("020");
      return;
    }
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) => {
        if (c.item.sku !== targetLine.item.sku) return c;
        const nextPrice =
          !c.item.isFixedPrice && Number.isFinite(parsedPrice) && parsedPrice >= 0
            ? Number(parsedPrice.toFixed(2))
            : c.overrideUnitPriceHkd;
        const nextRate =
          !c.item.isFixedPrice && c.item.allowItemDiscount !== false && Number.isFinite(pct) && pct >= 0
            ? Number((pct / 100).toFixed(4))
            : c.discountRate;
        return {
          ...c,
          quantity: qty,
          overrideUnitPriceHkd: nextPrice !== c.item.unitPriceHkd ? nextPrice : undefined,
          discountRate: nextRate,
          notes: editingLineState.notes.trim(),
          serialNo: editingLineState.serialNo.trim(),
        };
      }),
    );
    setEditingLineState(null);
    setStatusMessage(`已更新項目 ${targetLine.item.sku}`);
  }

  /** 送貨: toggle delivery order mode & sync note tag. */
  function flagDelivery() {
    setIsDelivery((prev) => {
      const next = !prev;
      setNotes((cur) => {
        const cleaned = cur.replace(/^送貨\s*/, "").trim();
        return next ? `送貨 ${cleaned}`.trim() : cleaned;
      });
      setStatusMessage(next ? "此單已標記送貨（將會建立提貨單）" : "已取消送貨標記");
      return next;
    });
  }

  /** 改價: if keypad has a number, override unit price directly; if empty, open 浮動價格輸入 (price + remarks + S/N) dialog. */
  function overridePrice() {
    if (!selectedLine) {
      showLegacyMsg("021");
      return;
    }
    const raw = entryBuffer.trim();
    if (!raw) {
      setEditingLineState({
        sku: selectedLine.item.sku,
        qty: String(selectedLine.quantity),
        price: String(getLineUnitPrice(selectedLine)),
        discPct: String(Number((selectedLine.discountRate * 100).toFixed(2))),
        notes: selectedLine.notes ?? "",
        serialNo: selectedLine.serialNo ?? "",
      });
      return;
    }
    if (selectedLine.item.isFixedPrice) {
      showLegacyMsg("026");
      return;
    }
    const target = Number(raw);
    if (!Number.isFinite(target) || target < 0) {
      showLegacyMsg("023");
      return;
    }
    const rounded = Number(target.toFixed(2));
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) =>
        c.item.sku === selectedLine.item.sku
          ? { ...c, overrideUnitPriceHkd: rounded, discountRate: 0 }
          : c,
      ),
    );
    setEntryBuffer("");
    setStatusMessage(`${selectedLine.item.sku} 改價為 ${formatHkd(rounded)}`);
  }

  /** Legacy DiscountReason quick preset in 優惠 panel. */
  function applyPresetDiscount(label: string, rate: number) {
    if (cart.length === 0) {
      showLegacyMsg("022");
      return;
    }
    const eligible = cart.filter((c) => !c.item.isFixedPrice && c.item.allowItemDiscount !== false);
    if (rate > 0 && eligible.length === 0) {
      showLegacyMsg("026");
      return;
    }
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev.map((c) =>
        c.item.isFixedPrice || c.item.allowItemDiscount === false ? c : { ...c, discountRate: rate },
      ),
    );
    setNotes((cur) => {
      const stripped = cur.replace(/\[優惠:[^\]]+\]/g, "").trim();
      if (rate <= 0) return stripped;
      return [stripped, `[優惠:${label}]`].filter(Boolean).join(" ").slice(0, 500);
    });
    setStatusMessage(rate <= 0 ? "已清除單項優惠折扣" : `已套用 ${label}（${(rate * 100).toFixed(0)}%）`);
  }

  /** 選價: price enquiry for the buffered code or the selected line. */
  function priceEnquiry() {
    const code = entryBuffer.trim();
    const hit = code ? products.find((p) => p.sku.toLowerCase() === code.toLowerCase()) : null;
    const item = hit ?? selectedLine?.item ?? null;
    if (!item) {
      showLegacyMsg("024");
      return;
    }
    showLegacyMsg("025", {
      barcode: item.sku,
      name: item.nameZh || item.nameEn,
      price: formatHkd(item.unitPriceHkd),
    });
  }

  /** Clear keypad buffer, pending quantity and line selection without holding bill. */
  function clearTillSelection() {
    setEntryBuffer("");
    setPendingQty(1);
    setSelectedSku(null);
    setDocType("RETAIL_SALE");
    setStatusMessage("");
  }

  /** Cancel current draft bill completely without holding it. */
  function cancelCurrentBill() {
    setCart([]);
    setAppliedSplits([]);
    setSelectedCustomer(null);
    setSelectedSalesperson(null);
    setEditingInvoiceNo(null);
    setDepositTargetInvoice(null);
    setIsDelivery(false);
    setTenderMode(false);
    setOctopusApprovedInfo(null);
    setOctopusLockCardId(null);
    setApprovalCode("");
    setCardLast4("");
    setDepositMode("NONE");
    setDepositAmount("");
    setNotes("");
    clearTillSelection();
    setStatusMessage("已取消本單");
  }

  /** 重選 (Command4(6)): open fmholdbill dialog when cart is active, else reset selection. */
  function reselect() {
    if (cart.length > 0 && !submitting) {
      setShowHoldDialog(true);
      return;
    }
    clearTillSelection();
  }

  /** 退售: toggle return mode (XC=9). */
  function toggleReturnMode() {
    setDocType((prev) => (prev === "SALES_RETURN" ? "RETAIL_SALE" : "SALES_RETURN"));
  }

  function loadQueriedBill(detail: ReceiptDetail, action: "modify" | "reorder") {
    const isDepositTopUp =
      action === "reorder" &&
      detail.bill.balanceDueHkd > 0.005 &&
      !["CANCELLED", "VOIDED"].includes((detail.bill.status ?? "").toUpperCase());

    setCart(
      detail.lines.filter((line) => !line.cancelled && line.dk > 0).map((line) => ({
        item: {
          sku: line.sku,
          ubc: line.ubc ?? "",
          nameZh: line.nameZh,
          nameEn: line.nameEn,
          colorName: line.colorName ?? "",
          sizeName: line.sizeName ?? "",
          categoryC1: line.categoryC1,
          unitPriceHkd: line.unitPriceHkd,
          excludeFromCrmBonus: false,
        },
        quantity: line.quantity,
        discountRate: line.discountRate,
        notes: line.notes ?? "",
        serialNo: line.serialNo ?? "",
      })),
    );
    setDocType(detail.bill.docType as BillDocType);
    setSelectedSku(null);
    if (detail.bill.customer?.id) {
      setSelectedCustomer({
        id: detail.bill.customer.id,
        legacyId: detail.bill.customer.legacyId,
        nameZh: detail.bill.customer.nameZh,
        nameEn: detail.bill.customer.nameEn,
        phone: detail.bill.customer.phone,
        address: detail.bill.customer.address ?? "",
        pointsBalance: detail.bill.customer.pointsBalance ?? 0,
      });
    } else {
      setSelectedCustomer(null);
    }
    setIsDelivery(detail.bill.deliveryStatus === "pending");
    setAppliedSplits([]);
    setEntryBuffer("");
    setDepositAmount("");
    setDepositMode("NONE");
    if (isDepositTopUp) {
      setDepositTargetInvoice({
        invoiceNo: detail.bill.invoiceNo,
        netAmountHkd: detail.bill.netAmountHkd,
        alreadyPaidHkd: detail.bill.paidAmountHkd,
        balanceDueHkd: detail.bill.balanceDueHkd,
      });
      setEditingInvoiceNo(null);
      setTenderMode(true);
      setSelectedTender("CASH");
      setNotes(`加訂原單 ${detail.bill.invoiceNo}`);
      setWorkspaceMode("retail");
      setSideMenu("buttons");
      setRightPanel("quickpick");
      setShowBillQuery(false);
      setStatusMessage(
        `加訂原單 ${detail.bill.invoiceNo}：已付 ${formatHkd(detail.bill.paidAmountHkd)}，尚欠餘額 ${formatHkd(detail.bill.balanceDueHkd)}`,
      );
      return;
    }

    setDepositTargetInvoice(null);
    setTenderMode(false);
    setEditingInvoiceNo(action === "modify" ? detail.bill.invoiceNo : null);
    setNotes(action === "modify" ? `修改原單 ${detail.bill.invoiceNo}` : `加訂原單 ${detail.bill.invoiceNo}`);
    setWorkspaceMode("retail");
    setSideMenu("buttons");
    setRightPanel("quickpick");
    setShowBillQuery(false);
    setStatusMessage(`${action === "modify" ? "修改" : "加訂"}單據 ${detail.bill.invoiceNo} 已載入收銀台`);
  }

  function addSplitPayment() {
    if (remainingDue <= 0) return;
    if (selectedTender === "UNPAID_INVOICE") {
      setStatusMessage("掛單不可加入部分收款清單，請選其他付款方式或直接完成開票");
      return;
    }
    const rawAmt = entryBuffer.trim() ? Number(entryBuffer) : remainingDue;
    if (!Number.isFinite(rawAmt) || rawAmt <= 0) {
      setStatusMessage("請輸入有效的部分付款金額");
      return;
    }
    if (selectedTender !== "CASH" && rawAmt > remainingDue + 0.001) {
      setStatusMessage(`非現金付款不可超過尚欠餘額 ${formatHkd(remainingDue)}`);
      return;
    }
    if (selectedTender === "OCTOPUS" && !octopusApprovedInfo) {
      showLegacyMsg("101");
      return;
    }
    const appliedAmt = Math.min(rawAmt, remainingDue);
    setAppliedSplits((prev) => [
      ...prev,
      {
        id: `sp-${Date.now()}-${prev.length}`,
        tenderCode: selectedTender as TenderCode,
        amountHkd: Number(appliedAmt.toFixed(2)),
        approvalCode: approvalCode.trim() || undefined,
        cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
        octopusCardId: selectedTender === "OCTOPUS" ? octopusApprovedInfo?.cardId : undefined,
        octopusDeviceId: selectedTender === "OCTOPUS" ? octopusApprovedInfo?.deviceId : undefined,
        octopusRemainingHkd: selectedTender === "OCTOPUS" ? octopusApprovedInfo?.remainingHkd : undefined,
        remarks: selectedTender === "CASH" && rawAmt > appliedAmt ? `Cash tendered ${rawAmt}` : undefined,
      },
    ]);
    setEntryBuffer("");
    setApprovalCode("");
    setCardLast4("");
    setOctopusApprovedInfo(null);
    setStatusMessage(`已加入 ${selectedTender} ${formatHkd(appliedAmt)}`);
  }

  async function openCashDrawerNoSale() {
    if (!bridgeToken) {
      setStatusMessage("請先登入再開啟錢柜");
      return;
    }
    try {
      const res = await fetch(`${bridgeUrl}/drawer/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": bridgeToken },
        body: JSON.stringify({ requestId: `nosale-${Date.now()}`, reason: "NO_SALE_AUTH" }),
      });
      setStatusMessage(res.ok ? "錢柜已開啟（No Sale）" : `錢柜開啟失敗 (${res.status})`);
    } catch {
      setStatusMessage("無法連接本機硬件橋接 127.0.0.1:17880");
    }
  }

  async function saveOpeningFloat() {
    const amountHkd = Number(floatInput);
    if (!Number.isFinite(amountHkd) || amountHkd < 0) return;
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());
    const res = await fetch("/api/day-end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "SET_FLOAT", businessDate: today, amountHkd }),
    });
    if (res.ok) {
      setShowFloatModal(false);
      setStatusMessage(`今日銀頭已設定為 ${formatHkd(amountHkd)}`);
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setStatusMessage(d.error ?? "設定銀頭失敗");
    }
  }

  async function flushOfflineOutbox() {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const queued = raw ? (JSON.parse(raw) as unknown[]) : [];
    if (queued.length === 0) {
      setStatusMessage("離線佇列沒有待重送單據");
      return;
    }
    const remaining: unknown[] = [];
    let synced = 0;
    for (const item of queued) {
      try {
        const res = await fetch("/api/bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item),
        });
        if (res.ok) synced++;
        else remaining.push(item);
      } catch {
        remaining.push(item);
      }
    }
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
    setOutboxCount(remaining.length);
    setStatusMessage(`已重送 ${synced} 筆離線單據，剩餘 ${remaining.length} 筆`);
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

  // ---- submit (supports completed, held, supersede/amend, split tender, delivery)
  async function submitBill(mode: "completed" | "held" = "completed") {
    if (cart.length === 0 || submitting) return;
    if (!session) {
      showLegacyMsg("401");
      return;
    }
    if (mode === "completed" && selectedCustomer && !crm.redemptionAllowed) {
      showLegacyMsg("044");
      return;
    }
    if (mode === "completed" && octopusLockCardId) {
      showLegacyMsg("100", { cardId: octopusLockCardId });
      return;
    }
    if (mode === "completed" && depositTargetInvoice) {
      const paymentsToPost: Array<{
        clientIdempotencyKey: string;
        tenderCode: TenderCode;
        amountHkd: number;
        approvalCode?: string;
        cardLast4?: string;
        octopusCardId?: string;
        octopusDeviceId?: string;
        octopusRemainingHkd?: number;
        remarks?: string;
      }> = [];

      for (const sp of appliedSplits) {
        paymentsToPost.push({
          clientIdempotencyKey: `pmt-${Date.now()}-${sp.id}`,
          tenderCode: sp.tenderCode,
          amountHkd: sp.amountHkd,
          approvalCode: sp.approvalCode,
          cardLast4: sp.cardLast4,
          octopusCardId: sp.octopusCardId,
          octopusDeviceId: sp.octopusDeviceId,
          octopusRemainingHkd: sp.octopusRemainingHkd,
          remarks: sp.remarks ?? "Additional deposit",
        });
      }

      if (remainingDue > 0.005) {
        if (selectedTender === "UNPAID_INVOICE") {
          const depAmt = Number(depositAmount);
          if (depositMode !== "NONE" && Number.isFinite(depAmt) && depAmt > 0) {
            paymentsToPost.push({
              clientIdempotencyKey: `pmt-${Date.now()}-dep`,
              tenderCode: depositMode,
              amountHkd: Math.min(Number(depAmt.toFixed(2)), remainingDue),
              approvalCode: approvalCode.trim() || undefined,
              cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
              remarks: "Additional deposit",
            });
          }
        } else if (selectedTender === "OCTOPUS") {
          if (!octopusApprovedInfo) {
            showLegacyMsg("101");
            return;
          }
          const entered = entryBuffer.trim() ? Number(entryBuffer) : remainingDue;
          const payAmt =
            Number.isFinite(entered) && entered > 0 ? Math.min(Number(entered.toFixed(2)), remainingDue) : remainingDue;
          paymentsToPost.push({
            clientIdempotencyKey: `pmt-${Date.now()}-oct`,
            tenderCode: "OCTOPUS",
            amountHkd: payAmt,
            octopusCardId: octopusApprovedInfo.cardId,
            octopusDeviceId: octopusApprovedInfo.deviceId,
            octopusRemainingHkd: octopusApprovedInfo.remainingHkd,
            remarks: "Additional deposit",
          });
        } else {
          const entered = entryBuffer.trim() ? Number(entryBuffer) : remainingDue;
          if (!Number.isFinite(entered) || entered <= 0) {
            showMsg("102", "請輸入有效的加訂／續付金額");
            return;
          }
          const payAmt = Math.min(Number(entered.toFixed(2)), remainingDue);
          paymentsToPost.push({
            clientIdempotencyKey: `pmt-${Date.now()}-settle`,
            tenderCode: selectedTender as TenderCode,
            amountHkd: payAmt,
            approvalCode: approvalCode.trim() || undefined,
            cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
            remarks:
              selectedTender === "CASH" && entered > payAmt
                ? `Additional deposit (Cash tendered ${entered})`
                : "Additional deposit",
          });
        }
      }

      if (paymentsToPost.length === 0) {
        showMsg("102", "請輸入本次加訂金額或選擇付款方式");
        return;
      }

      setSubmitting(true);
      try {
        let latestStatus = "partial";
        let latestBalance = depositTargetInvoice.balanceDueHkd;
        let latestNet = depositTargetInvoice.netAmountHkd;
        for (const payment of paymentsToPost) {
          const res = await fetch(
            `/api/invoices/${encodeURIComponent(depositTargetInvoice.invoiceNo)}/payments`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payment),
            },
          );
          const data = (await res.json()) as {
            paymentStatus?: string;
            balanceDueHkd?: number;
            error?: string;
          };
          if (!res.ok) {
            showMsg("500", data.error ?? "記錄加訂收款失敗！");
            return;
          }
          latestStatus = data.paymentStatus ?? latestStatus;
          if (typeof data.balanceDueHkd === "number") latestBalance = data.balanceDueHkd;
        }

        const settledNo = depositTargetInvoice.invoiceNo;
        setRecentDocs((prev) => [
          {
            invoiceNo: settledNo,
            docType,
            paymentStatus: latestStatus,
            netAmountHkd: latestNet,
            balanceDueHkd: latestBalance,
          },
          ...prev,
        ]);
        setCart([]);
        setSelectedSku(null);
        setTenderMode(false);
        setAppliedSplits([]);
        setDepositTargetInvoice(null);
        setIsDelivery(false);
        setOctopusApprovedInfo(null);
        setApprovalCode("");
        setCardLast4("");
        setDepositMode("NONE");
        setDepositAmount("");
        setNotes("");
        setEditingInvoiceNo(null);
        setSelectedSalesperson(null);
        setEntryBuffer("");
        showLegacyMsg("000", {
          invoiceNo: settledNo,
          status: latestStatus.toUpperCase(),
          balance: formatHkd(latestBalance),
        });
        setCompletedInvoiceNo(settledNo);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (
      mode === "completed" &&
      remainingDue > 0.005 &&
      selectedTender === "CASH" &&
      entryBuffer.trim() !== "" &&
      (!Number.isFinite(cashTendered) || cashTendered < remainingDue)
    ) {
      showLegacyMsg("102");
      return;
    }

    const effectiveDocType: BillDocType =
      mode === "held"
        ? docType
        : selectedTender === "UNPAID_INVOICE"
          ? "SALES_INVOICE"
          : docType;

    const initialPayments = [];
    if (mode === "completed") {
      for (const sp of appliedSplits) {
        initialPayments.push({
          clientIdempotencyKey: `pmt-${Date.now()}-${sp.id}`,
          tenderCode: sp.tenderCode,
          amountHkd: sp.amountHkd,
          approvalCode: sp.approvalCode,
          cardLast4: sp.cardLast4,
          octopusCardId: sp.octopusCardId,
          octopusDeviceId: sp.octopusDeviceId,
          octopusRemainingHkd: sp.octopusRemainingHkd,
          remarks: sp.remarks,
        });
      }
      if (remainingDue > 0.005) {
        if (selectedTender === "UNPAID_INVOICE") {
          if (appliedSplits.length === 0 && depositMode !== "NONE" && Number(depositAmount) > 0) {
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
            showLegacyMsg("101");
            return;
          }
          initialPayments.push({
            clientIdempotencyKey: `pmt-${Date.now()}`,
            tenderCode: "OCTOPUS" as const,
            amountHkd: remainingDue,
            octopusCardId: octopusApprovedInfo.cardId,
            octopusDeviceId: octopusApprovedInfo.deviceId,
            octopusRemainingHkd: octopusApprovedInfo.remainingHkd,
          });
        } else {
          initialPayments.push({
            clientIdempotencyKey: `pmt-${Date.now()}`,
            tenderCode: selectedTender as TenderCode,
            amountHkd: remainingDue,
            approvalCode: approvalCode.trim() || undefined,
            cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
            remarks:
              selectedTender === "CASH" && cashTendered > remainingDue
                ? `Cash tendered ${cashTendered}`
                : undefined,
          });
        }
      }
    }

    const payload = {
      clientIdempotencyKey: `bill-${crypto.randomUUID()}`,
      shopId: storeContext?.shopId ?? session.shopId ?? 1,
      terminalId: storeContext?.terminalId,
      salespersonId: selectedSalesperson?.id,
      docType: effectiveDocType,
      status: mode,
      supersedeInvoiceNo: editingInvoiceNo ?? undefined,
      createDeliveryOrder: mode === "completed" && isDelivery,
      customerId: selectedCustomer?.id,
      customerCurrentPoints: selectedCustomer?.pointsBalance ?? 0,
      lines: cart.map((c, idx) => ({
        sku: c.item.sku,
        nameZh: c.item.nameZh,
        nameEn: c.item.nameEn,
        categoryC1: c.item.categoryC1,
        quantity: c.quantity,
        unitPriceHkd: getLineUnitPrice(c),
        discountRate: promoRules.length > 0 ? (promoResult.lines[idx]?.discountRate ?? c.discountRate) : c.discountRate,
        lineDiscountAmountHkd: 0,
        isFixedPrice: Boolean(c.item.isFixedPrice),
        excludeFromCrmBonus: Boolean(c.item.excludeFromCrmBonus),
        notes: c.notes?.trim() || undefined,
        serialNo: c.serialNo?.trim() || undefined,
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

      const hasCash = initialPayments.some((p) => p.tenderCode === "CASH");
      if (mode === "completed" && hasCash && bridgeToken) {
        fetch(`${bridgeUrl}/drawer/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bridge-Token": bridgeToken },
          body: JSON.stringify({ requestId: payload.clientIdempotencyKey, reason: "CASH_SALE" }),
        }).catch(() => {});
      }
      if (mode === "completed" && printerOnOff && bridgeToken) {
        const receiptLines = [
          "HONG KONG HARP CENTRE",
          `${data.docType} ${data.invoiceNo}`,
          ...payload.lines.map((l) => `${l.nameZh || l.nameEn} x${l.quantity} ${formatHkd(l.unitPriceHkd)}`),
          `TOTAL ${formatHkd(data.netAmountHkd)}`,
        ];
        fetch(`${bridgeUrl}/print/receipt`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bridge-Token": bridgeToken },
          body: JSON.stringify({
            requestId: payload.clientIdempotencyKey,
            invoiceNo: data.invoiceNo,
            lines: receiptLines,
            openCashDrawer: hasCash,
          }),
        }).catch(() => {});
      }

      setRecentDocs((prev) => [data, ...prev]);
      setCart([]);
      setSelectedSku(null);
      setTenderMode(false);
      setAppliedSplits([]);
      setIsDelivery(false);
      setOctopusApprovedInfo(null);
      setApprovalCode("");
      setCardLast4("");
      setDepositAmount("");
      setNotes("");
      setEditingInvoiceNo(null);
      setSelectedSalesperson(null);
      setEntryBuffer("");
      if (mode === "held") {
        setStatusMessage(`暫停單 ${data.invoiceNo} 已儲存（於查單 [暫停單] 恢復）`);
      } else {
        showLegacyMsg("000", {
          invoiceNo: data.invoiceNo,
          status: data.paymentStatus.toUpperCase(),
          balance: formatHkd(data.balanceDueHkd),
        });
        setCompletedInvoiceNo(data.invoiceNo);
      }
    } catch {
      const existingRaw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const queued = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : [];
      queued.push(payload);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queued));
      setOutboxCount(queued.length);
      showLegacyMsg("999");
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    if (authRequired) {
      router.push("/login");
      router.refresh();
      return;
    }
    clearTillSelection();
    setSelectedSalesperson(null);
    setStatusMessage("開發模式已停用登入 — 已重設收銀台");
    router.push("/");
    router.refresh();
  }

  useEffect(() => {
    function handleLegacyKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      const modalOpen = Boolean(
        msg ||
          supportKind ||
          officeTxnType ||
          activeReport ||
          showPassword ||
          showPrinter ||
          workspaceMode === "inventory" ||
          showBillQuery ||
          showAbout ||
          showFloatModal ||
          showHoldDialog ||
          showPayMethod2 ||
          quickMemberModal ||
          editingLineState,
      );
      if (modalOpen) return;
      if (event.ctrlKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        priceEnquiry();
      } else if (event.ctrlKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        setWorkspaceMode("retail");
        setSideMenu("otherTxn");
      } else if (event.ctrlKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        overrideBillTotal();
      } else if (event.key === "F1") {
        event.preventDefault();
        setWorkspaceMode("retail");
        setRightPanel("image");
        setSideMenu("info");
        setTenderMode(false);
      } else if (event.key === "F2") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "F3") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "F4") {
        event.preventDefault();
        overridePrice();
      } else if (event.key === "F5") {
        event.preventDefault();
        setTenderMode((value) => !value);
      } else if (event.key === "F6") {
        event.preventDefault();
        setTenderMode(true);
        setPay2Amount(String(remainingDue));
        setShowPayMethod2(true);
      } else if (event.key === "F8") {
        event.preventDefault();
        reselect();
      } else if (event.key === "F9") {
        event.preventDefault();
        clearTillSelection();
        setTenderMode(false);
        setWorkspaceMode("retail");
        setRightPanel("image");
        setSideMenu("info");
      } else if (event.key === "F12") {
        event.preventDefault();
        void submitBill();
      }
    }
    window.addEventListener("keydown", handleLegacyKeys);
    return () => window.removeEventListener("keydown", handleLegacyKeys);
  });

  // ===========================================================================
  //  RENDER — legacy VB6 chrome
  // ===========================================================================

  const dateStr = `${clock.getMonth() + 1}/${clock.getDate()}`;
  const timeStr = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
  const modeLabel =
    workspaceMode === "priceCheck"
      ? "查價"
      : docType === "SALES_RETURN"
        ? "退售"
        : docType === "PETTY_PAYOUT"
          ? "Payout"
          : "零售";

  const toolbarBtn =
    "flex w-[62px] flex-col items-center gap-0.5 border-r border-[#d4d0c8] px-1 py-1.5 text-[11px] leading-tight text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]";
  const sideBtn =
    "flex w-full flex-col items-center gap-0.5 border-b border-[#d4d0c8] py-2 text-[11px] text-black hover:bg-[#e5e1d5]";
  const fnBtn =
    "flex flex-1 flex-col items-center justify-center gap-0.5 border-r border-[#aca899] py-1 text-[13px] text-black";
  const panelBtn =
    "w-full border border-[#aca899] bg-[#f0f0f0] px-2 py-1.5 text-left text-[12px] text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]";

  const pagedMenus = retailMenus.slice(buttonCatPage * 9, (buttonCatPage + 1) * 9);

  function renderSideMenu() {
    if (sideMenu === "info") {
      return (
        <div className="flex w-14 shrink-0 flex-col border-l border-[#aca899] bg-[#f0f0f0]">
          <button
            type="button"
            className={sideBtn}
            style={rightPanel === "info" ? { background: "#fff8dc" } : undefined}
            onClick={() => {
              setWorkspaceMode("retail");
              setRightPanel("info");
            }}
            title="資訊"
          >
            <LegacyIcon name="info" className="h-5 w-5" />
            <span>資訊</span>
          </button>
          <button
            type="button"
            className={sideBtn}
            onClick={() => {
              setWorkspaceMode("retail");
              setRightPanel("image");
            }}
            title="離開"
          >
            <LegacyIcon name="exit" className="h-5 w-5" />
            <span>離開</span>
          </button>
          <button
            type="button"
            className={sideBtn}
            style={rightPanel === "image" ? { background: "#fff8dc" } : undefined}
            onClick={() => {
              setWorkspaceMode("retail");
              setRightPanel("image");
            }}
            title="影像"
          >
            <LegacyIcon name="image" className="h-5 w-5" />
            <span>影像</span>
          </button>
          <button
            type="button"
            className={sideBtn}
            style={rightPanel === "promo" ? { background: "#fff8dc" } : undefined}
            onClick={() => {
              setWorkspaceMode("retail");
              setRightPanel("promo");
            }}
            title="優惠"
          >
            <LegacyIcon name="promo" className="h-5 w-5" />
            <span>優惠</span>
          </button>
          <button
            type="button"
            className={sideBtn}
            style={rightPanel === "products" ? { background: "#fff8dc" } : undefined}
            onClick={() => {
              setWorkspaceMode("retail");
              setRightPanel("products");
            }}
            title="貨品"
          >
            <LegacyIcon name="products" className="h-5 w-5" />
            <span>貨品</span>
          </button>
          <button
            type="button"
            className={sideBtn}
            style={rightPanel === "members" ? { background: "#fff8dc" } : undefined}
            onClick={() => {
              setWorkspaceMode("retail");
              setRightPanel("members");
            }}
            title="會員"
          >
            <LegacyIcon name="members" className="h-5 w-5" />
            <span>會員</span>
          </button>
          <button
            type="button"
            className={sideBtn}
            style={rightPanel === "staff" ? { background: "#fff8dc" } : undefined}
            onClick={() => {
              setWorkspaceMode("retail");
              setRightPanel("staff");
            }}
            title="職員"
          >
            <LegacyIcon name="staff" className="h-5 w-5" />
            <span>職員</span>
          </button>
        </div>
      );
    }

    if (sideMenu === "otherTxn") {
      return (
        <div className="flex w-[96px] shrink-0 flex-col gap-1 border-l border-[#aca899] bg-[#f0f0f0] p-1">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-1 py-1 text-center text-[12px] font-bold text-black">
            交易選項
          </div>
          <button type="button" className={panelBtn} onClick={() => setSideMenu("info")}>
            離開
          </button>
          {(
            [
              ["GOODS_RECEIPT", "到貨"],
              ["SALES_RETURN", "退貨"],
              ["STOCK_TRANSFER_OUT", "轉出"],
              ["WRITE_OFF", "報銷"],
              ["STOCK_ADJUSTMENT", "調整"],
              ["PETTY_PAYOUT", "Payout"],
            ] as Array<[OfficeDocType, string]>
          ).map(([type, label]) => (
            <button key={type} type="button" className={panelBtn} onClick={() => setOfficeTxnType(type)}>
              {label}
            </button>
          ))}
        </div>
      );
    }

    if (sideMenu === "cashier") {
      return (
        <div className="flex w-[96px] shrink-0 flex-col gap-1 border-l border-[#aca899] bg-[#f0f0f0] p-1">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-1 py-1 text-center text-[12px] font-bold text-black">
            收銀選項
          </div>
          <button type="button" className={panelBtn} onClick={() => setSideMenu("info")}>
            離開
          </button>
          <button
            type="button"
            className={`${panelBtn} flex items-center gap-1`}
            onClick={() => setShowFloatModal(true)}
          >
            <LegacyIcon name="cashier" className="h-4 w-4 shrink-0" />
            <span>銀頭</span>
          </button>
          <button type="button" className={panelBtn} onClick={() => void openCashDrawerNoSale()}>
            開柜
          </button>
          <button type="button" className={panelBtn} onClick={() => router.push("/backoffice/day-end")}>
            轉更/日結
          </button>
          <button
            type="button"
            className={panelBtn}
            onClick={() => showMsg("000", "港幣 (HKD) 基準匯率：1.0000")}
          >
            上數落價
          </button>
          {outboxCount > 0 ? (
            <button type="button" className={panelBtn} onClick={() => void flushOfflineOutbox()}>
              離線單據重送 ({outboxCount})
            </button>
          ) : null}
        </div>
      );
    }

    if (sideMenu === "manager") {
      return (
        <div className="flex w-[96px] shrink-0 flex-col gap-1 border-l border-[#aca899] bg-[#f0f0f0] p-1">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-1 py-1 text-center text-[12px] font-bold text-black">
            經理選項
          </div>
          <button type="button" className={panelBtn} onClick={() => setSideMenu("info")}>
            離開
          </button>
          <button type="button" className={panelBtn} onClick={() => setShowPrinter(true)}>
            印表機設定
          </button>
          <button
            type="button"
            className={panelBtn}
            title="維修入口僅供系統行政使用"
            onClick={() => showMsg("031", "維修模式 — 請聯絡系統行政。")}
          >
            維修
          </button>
          <button type="button" className={panelBtn} onClick={() => setShowPassword(true)}>
            更改密碼
          </button>
        </div>
      );
    }

    if (sideMenu === "salesData") {
      return (
        <div className="flex w-[108px] shrink-0 flex-col gap-1 border-l border-[#aca899] bg-[#f0f0f0] p-1">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-1 py-1 text-center text-[12px] font-bold text-black">
            營業數據
          </div>
          <button
            type="button"
            className={panelBtn}
            onClick={() => {
              setSideMenu("info");
              setWorkspaceMode("retail");
            }}
          >
            離開
          </button>
          <button type="button" className={panelBtn} onClick={() => setWorkspaceMode("receiptHourly")}>
            時飛
          </button>
          <button type="button" className={panelBtn} onClick={() => setWorkspaceMode("receiptItem")}>
            項飛
          </button>
          <button type="button" className={panelBtn} onClick={() => setSideMenu("historicalData")}>
            歷史數據
          </button>
          <button
            type="button"
            className={panelBtn}
            onClick={() => {
              setCenterTab("allstat");
              setActiveReport("center");
            }}
          >
            營運通報表中心
          </button>
        </div>
      );
    }

    if (sideMenu === "historicalData") {
      return (
        <div className="flex w-[108px] shrink-0 flex-col gap-1 border-l border-[#aca899] bg-[#f0f0f0] p-1">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-1 py-1 text-center text-[12px] font-bold text-black">
            歷史數據
          </div>
          <button type="button" className={panelBtn} onClick={() => setSideMenu("salesData")}>
            返回
          </button>
          <button type="button" className={panelBtn} onClick={() => setWorkspaceMode("salesStats")}>
            銷售統計
          </button>
          <button type="button" className={panelBtn} onClick={() => setWorkspaceMode("memberStats")}>
            會員統計
          </button>
          <button type="button" className={panelBtn} onClick={() => setWorkspaceMode("staffStats")}>
            職員統計
          </button>
          <button type="button" className={panelBtn} onClick={() => setWorkspaceMode("monthlyBusiness")}>
            本月生意
          </button>
          <button type="button" className={panelBtn} onClick={() => setWorkspaceMode("monthlyItem")}>
            本月項飛
          </button>
        </div>
      );
    }

    if (sideMenu === "support") {
      return (
        <div className="flex w-[96px] shrink-0 flex-col gap-1 border-l border-[#aca899] bg-[#f0f0f0] p-1">
          <div className="border-b border-[#aca899] bg-[#e8eef5] px-1 py-1 text-center text-[12px] font-bold text-black">
            支援
          </div>
          <button type="button" className={panelBtn} onClick={() => setSideMenu("info")}>
            離開
          </button>
          <button type="button" className={panelBtn} onClick={() => setSupportKind("support")}>
            營運通支援
          </button>
          <button type="button" className={panelBtn} onClick={() => setSupportKind("internet")}>
            互聯網
          </button>
          <button type="button" className={panelBtn} onClick={() => setSupportKind("ip")}>
            IP
          </button>
          <button type="button" className={panelBtn} onClick={() => setSupportKind("helper")}>
            小幫手
          </button>
          <button type="button" className={panelBtn} onClick={() => setSupportKind("manual")}>
            用戶手冊
          </button>
          <button type="button" className={panelBtn} onClick={() => setShowAbout(true)}>
            關於軟件
          </button>
        </div>
      );
    }

    // sideMenu === "buttons" (Screenshots 039-046)
    return (
      <div className="flex w-[124px] shrink-0 flex-col gap-1 border-l border-[#aca899] bg-[#f0f0f0] p-1">
        <button
          type="button"
          className={panelBtn}
          onClick={() => {
            setSideMenu("info");
            setRightPanel("image");
          }}
        >
          返回
        </button>
        <button
          type="button"
          aria-label="上一頁分類"
          disabled={buttonCatPage === 0}
          onClick={() => setButtonCatPage((p) => Math.max(0, p - 1))}
          className={`${panelBtn} flex items-center justify-between text-[11px] disabled:opacity-40`}
        >
          <span className="truncate">更多的分…</span>
          <LegacyIcon name="upArrow" className="h-3.5 w-3.5 shrink-0" />
        </button>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {pagedMenus.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => selectQuickPickMenu(m)}
              className={`w-full border px-1.5 py-2 text-left text-[11px] leading-tight ${
                activeQuickMenu?.id === m.id
                  ? "border-[#316ac5] bg-[#316ac5] font-bold text-white"
                  : "border-[#aca899] bg-[#e4e2da] text-black hover:bg-[#fff8dc]"
              }`}
            >
              {m.titleZh || m.titleEn}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="下一頁分類"
          disabled={buttonCatPage >= 2}
          onClick={() => setButtonCatPage((p) => Math.min(2, p + 1))}
          className={`${panelBtn} flex items-center justify-between text-[11px] disabled:opacity-40`}
        >
          <span className="truncate">更多的分…</span>
          <LegacyIcon name="downArrow" className="h-3.5 w-3.5 shrink-0" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col select-none"
      style={{ background: "#f0f0f0", fontFamily: VB_FONT }}
    >
      {/* ── 1. top toolbar ─────────────────────────────────────────────── */}
      <div className="flex items-stretch border-b border-[#aca899] bg-[#f0f0f0]">
        <button type="button" className={toolbarBtn} onClick={() => void logout()} title="登出">
          <LegacyIcon name="logout" className="h-5 w-5" />
          登出
        </button>
        <button
          type="button"
          className={toolbarBtn}
          style={showBillQuery ? { background: "#fff8dc" } : undefined}
          onClick={() => setShowBillQuery(true)}
          title="查單"
        >
          <LegacyIcon name="billQuery" className="h-5 w-5" />
          查單
        </button>
        <div className="my-1 w-px bg-[#aca899]" aria-hidden="true" />
        <button
          type="button"
          className={toolbarBtn}
          style={workspaceMode === "inventory" ? { background: "#fff8dc" } : undefined}
          onClick={() => setWorkspaceMode((w) => (w === "inventory" ? "retail" : "inventory"))}
          title="存貨"
        >
          <LegacyIcon name="stock" className="h-5 w-5" />
          存貨
        </button>
        <div className="my-1 w-px bg-[#aca899]" aria-hidden="true" />
        <button
          type="button"
          className={toolbarBtn}
          style={
            workspaceMode === "retail" && docType === "RETAIL_SALE" && sideMenu === "info"
              ? { background: "#fff8dc" }
              : workspaceMode === "priceCheck"
                ? { background: "#fff3c4" }
                : undefined
          }
          onClick={() => {
            if (
              workspaceMode === "retail" &&
              docType === "RETAIL_SALE" &&
              sideMenu === "info" &&
              (rightPanel === "image" || rightPanel === "info")
            ) {
              setWorkspaceMode("priceCheck");
              setTenderMode(false);
              return;
            }
            setDocType("RETAIL_SALE");
            setWorkspaceMode("retail");
            setSideMenu("info");
            setRightPanel("image");
            setTenderMode(false);
          }}
          title="零售"
        >
          <LegacyIcon name="retail" className="h-5 w-5" />
          零售
        </button>
        <button
          type="button"
          className={toolbarBtn}
          style={sideMenu === "otherTxn" ? { background: "#fff8dc" } : undefined}
          onClick={() => {
            setWorkspaceMode("retail");
            setSideMenu("otherTxn");
          }}
          title="其他交易"
        >
          <LegacyIcon name="otherTxn" className="h-5 w-5" />
          其他交易
        </button>
        <div className="my-1 w-px bg-[#aca899]" aria-hidden="true" />
        <button
          type="button"
          className={toolbarBtn}
          style={sideMenu === "cashier" ? { background: "#fff8dc" } : undefined}
          onClick={() => {
            setWorkspaceMode("retail");
            setSideMenu("cashier");
          }}
          title="收銀員"
        >
          <LegacyIcon name="cashier" className="h-5 w-5" />
          收銀員
        </button>
        <button
          type="button"
          className={toolbarBtn}
          style={sideMenu === "manager" ? { background: "#fff8dc" } : undefined}
          onClick={() => {
            setWorkspaceMode("retail");
            setSideMenu("manager");
          }}
          title="經理"
        >
          <LegacyIcon name="manager" className="h-5 w-5" />
          經理
        </button>
        <button
          type="button"
          className={toolbarBtn}
          style={sideMenu === "salesData" || sideMenu === "historicalData" ? { background: "#fff8dc" } : undefined}
          onClick={() => {
            if (!["receiptHourly", "receiptItem"].includes(workspaceMode)) {
              setWorkspaceMode("retail");
            }
            setSideMenu("salesData");
          }}
          title="營業數據"
        >
          <LegacyIcon name="bdata" className="h-5 w-5" />
          營業數據
        </button>
        <button
          type="button"
          className={toolbarBtn}
          style={sideMenu === "support" ? { background: "#fff8dc" } : undefined}
          onClick={() => {
            setWorkspaceMode("retail");
            setSideMenu("support");
          }}
          title="支援"
        >
          <LegacyIcon name="support" className="h-5 w-5" />
          支援
        </button>
        <div className="my-1 w-px bg-[#aca899]" aria-hidden="true" />
        <button
          type="button"
          className={toolbarBtn}
          style={sideMenu === "buttons" ? { background: "#fff8dc" } : undefined}
          onClick={() => {
            setWorkspaceMode("retail");
            setSideMenu("buttons");
            setRightPanel("quickpick");
            setButtonCatPage(0);
          }}
          title="按鈕"
        >
          <LegacyIcon name="buttons" className="h-5 w-5" />
          按鈕
        </button>
        <button
          type="button"
          className={toolbarBtn}
          style={rightPanel === "info" && sideMenu === "info" ? { background: "#fff8dc" } : undefined}
          onClick={() => {
            setWorkspaceMode("retail");
            setSideMenu("info");
            setRightPanel("info");
          }}
          title="資訊"
        >
          <LegacyIcon name="info" className="h-5 w-5" />
          資訊
        </button>
        <div className="ml-auto flex items-center pr-3">
          <ERunWordmark />
        </div>
      </div>

      {/* ── 2. status strip ────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-[#d4d0c8] bg-[#f0f0f0] text-[12px] text-black">
        <span className="border-r border-[#d4d0c8] px-2 py-0.5">
          {storeContext?.shopNameEn ?? "Central"}({storeContext?.legacySn ?? 1})
        </span>
        <span className="border-r border-[#d4d0c8] px-2 py-0.5">{session?.displayName ?? "未登入"}</span>
        <span suppressHydrationWarning className="border-r border-[#d4d0c8] px-2 py-0.5">{dateStr}</span>
        <span suppressHydrationWarning className="border-r border-[#d4d0c8] px-2 py-0.5">{timeStr}</span>
        {selectedCustomer ? (
          <span className="border-r border-[#d4d0c8] px-2 py-0.5">
            會員：{selectedCustomer.nameZh || selectedCustomer.nameEn}（{selectedCustomer.pointsBalance} 分）
          </span>
        ) : null}
        {selectedSalesperson ? (
          <span className="border-r border-[#d4d0c8] bg-[#e8eef5] px-2 py-0.5">
            銷售員：{selectedSalesperson.displayName}
          </span>
        ) : null}
        {isDelivery ? <span className="border-r border-[#d4d0c8] bg-[#fff3c4] px-2 py-0.5 font-bold">送貨</span> : null}
        {editingInvoiceNo ? <span className="px-2 py-0.5 text-[#c00000]">修改：{editingInvoiceNo}</span> : null}
        <span className="ml-auto px-2 py-0.5 font-bold">{modeLabel}</span>
      </div>

      {/* ── 3. main area ───────────────────────────────────────────────── */}
      {workspaceMode === "inventory" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <StockPanel embedded onClose={() => setWorkspaceMode("retail")} />
        </div>
      ) : workspaceMode === "priceCheck" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <PriceCheckWorkspace
            entryBuffer={entryBuffer}
            onEntryBufferChange={setEntryBuffer}
            productQuery={productQuery}
            onProductQueryChange={setProductQuery}
            onSwitchToRetail={() => setWorkspaceMode("retail")}
            onOpenQuickPick={() => {
              setWorkspaceMode("retail");
              setSideMenu("buttons");
              setRightPanel("quickpick");
              setButtonCatPage(0);
            }}
            onAddItemToCart={(p) => {
              addItem(p);
              setWorkspaceMode("retail");
            }}
          />
        </div>
      ) : workspaceMode === "monthlyBusiness" || workspaceMode === "monthlyItem" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1">
            <LegacyReceiptReportView
              kind={workspaceMode}
              shopLabel={`${storeContext?.shopNameEn ?? "Central"}(${storeContext?.legacySn ?? 1})`}
              staffName={session?.displayName ?? "收銀員"}
              staffCode={String(session?.staffId ?? 1)}
              onExit={() => setWorkspaceMode("retail")}
              onOpenTabularReport={() => {
                if (workspaceMode === "monthlyBusiness") {
                  setActiveReport("history");
                } else {
                  setCenterTab("items");
                  setActiveReport("center");
                }
              }}
            />
          </div>
          {renderSideMenu()}
        </div>
      ) : workspaceMode === "salesStats" ||
        workspaceMode === "memberStats" ||
        workspaceMode === "staffStats" ? (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1">
            <LegacyStatsWorkspace
              kind={
                workspaceMode === "salesStats"
                  ? "sales"
                  : workspaceMode === "memberStats"
                    ? "member"
                    : "staff"
              }
              categories={storeCategories}
              onOpenFullStatsModal={() => setActiveReport("stats")}
            />
          </div>
          {renderSideMenu()}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* left: receipt view (時飛/項飛) OR retail input + grid + totals + tender + 6 function buttons */}
          <div className="flex min-w-0 flex-1 flex-col">
            {workspaceMode === "receiptHourly" || workspaceMode === "receiptItem" ? (
              <LegacyReceiptReportView
                kind={workspaceMode === "receiptHourly" ? "hourly" : "item"}
                shopLabel={`${storeContext?.shopNameEn ?? "Central"}(${storeContext?.legacySn ?? 1})`}
                staffName={session?.displayName ?? "收銀員"}
                staffCode={String(session?.staffId ?? 1)}
                onExit={() => setWorkspaceMode("retail")}
                onOpenTabularReport={() =>
                  setActiveReport(workspaceMode === "receiptHourly" ? "hourly" : "items")
                }
              />
            ) : (
              <>
                <div className="flex items-center gap-1 border-b border-[#d4d0c8] p-1">
                  <button
                    type="button"
                    title="查價模式"
                    onClick={() => setWorkspaceMode("priceCheck")}
                    className="border border-[#c99e00] bg-[#ffe650] px-1.5 py-0.5 text-[11px] font-bold text-[#003399] hover:bg-[#ffdf22]"
                  >
                    查價
                  </button>
                  <span className="text-[11px] text-[#555]">Item1</span>
                  <AutoSuggestInput
                    theme="legacy"
                    name="posBarcode"
                    autoComplete="on"
                    suggestKind="product"
                    minChars={2}
                    historyKey="pos_barcode"
                    value={entryBuffer}
                    onChange={(e) => setEntryBuffer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitBarcode();
                    }}
                    placeholder="條碼"
                    className="w-36 border border-[#aca899] bg-white px-1 py-1 text-[13px]"
                  />
                  <span className="text-[11px] text-[#555]">Item2</span>
                  <AutoSuggestInput
                    theme="legacy"
                    name="posProductQuery"
                    autoComplete="on"
                    suggestKind="product"
                    historyKey="pos_prod_query"
                    value={productQuery}
                    onChange={(e) => void runProductSearch(e.target.value)}
                    placeholder="貨品編號 / 名稱"
                    className="min-w-0 flex-1 border border-[#aca899] bg-white px-1 py-1 text-[13px]"
                  />
                  <button
                    type="button"
                    className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1"
                    title="查單"
                    onClick={() => setShowBillQuery(true)}
                  >
                    🧾
                  </button>
                  <button
                    type="button"
                    className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1"
                    title="上一筆"
                    onClick={() => moveSelection(-1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1"
                    title="下一筆"
                    onClick={() => moveSelection(1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1"
                    title="鍵盤"
                    onClick={() => {
                      setWorkspaceMode("retail");
                      setSideMenu("buttons");
                      setRightPanel("quickpick");
                      setButtonCatPage(0);
                    }}
                  >
                    ⌨️
                  </button>
                  <button
                    type="button"
                    className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1"
                    title="輸入"
                    onClick={() => void commitBarcode()}
                  >
                    ➡️
                  </button>
                </div>

                {/* item grid — 條碼 | 貨品 | 顏色 | 尺碼 | 數量 | 單價 | % | 價錢 */}
                <div className="min-h-0 flex-1 overflow-auto bg-[#dfe7f0]">
                  <table className="w-full border-collapse text-[12px]">
                    <thead className="sticky top-0">
                      <tr className="bg-[#e8eef5] text-left text-black">
                        <th className="border-b border-[#aca899] px-2 py-1 font-normal">貨碼</th>
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
                            onDoubleClick={() =>
                              setEditingLineState({
                                sku: line.item.sku,
                                qty: String(line.quantity),
                                price: String(getLineUnitPrice(line)),
                                discPct: String(Number((line.discountRate * 100).toFixed(2))),
                                notes: line.notes ?? "",
                                serialNo: line.serialNo ?? "",
                              })
                            }
                            title={`雙擊修改數量 / 單價 / 折扣 / 備註 / 序號（條碼: ${line.item.sku}）`}
                            className={`cursor-pointer ${active ? "bg-[#316ac5] text-white" : idx % 2 ? "bg-[#e9eff6]" : "bg-[#dfe7f0]"}`}
                          >
                            <td className="px-2 py-1 font-mono" title={`條碼: ${line.item.sku}`}>
                              <div>{line.item.ubc || line.item.sku}</div>
                              {line.item.ubc && line.item.ubc !== line.item.sku ? (
                                <div className={`text-[10px] ${active ? "text-[#dbeafe]" : "text-[#666]"}`}>
                                  {line.item.sku}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-1">
                              <div>{line.item.nameZh || line.item.nameEn}</div>
                              {line.serialNo || line.notes ? (
                                <div className={`text-[10px] ${active ? "text-[#ffe6a0]" : "text-[#444]"}`}>
                                  {line.serialNo ? `S/N:${line.serialNo}` : ""}
                                  {line.serialNo && line.notes ? " · " : ""}
                                  {line.notes ?? ""}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-2 py-1">{line.item.colorName || "-"}</td>
                            <td className="px-2 py-1">
                              {line.item.sizeName ||
                                (line.item.buttonLabelZh && line.item.buttonLabelZh !== line.item.nameZh
                                  ? line.item.buttonLabelZh
                                  : "-")}
                            </td>
                            <td className="px-2 py-1 text-right font-mono">{line.quantity}</td>
                            <td className="px-2 py-1 text-right font-mono">{formatHkd(getLineUnitPrice(line))}</td>
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
                    <div className="w-52 border-r border-[#d4d0c8] p-1 text-[12px] text-black">
                      <div className="flex justify-between">
                        <span>客付</span>
                        <span>{TENDERS.find((t) => t.key === selectedTender)?.zh ?? ""}</span>
                        <span className="font-mono">
                          {selectedTender === "CASH" ? entryBuffer || "0.0" : formatHkd(remainingDue)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-end justify-between">
                        <span className="font-bold text-[#2e7ec2]">應找</span>
                        <span className="font-mono text-[20px] font-bold text-[#2e7ec2]">
                          {formatHkd(changeDue)}
                        </span>
                      </div>
                    </div>
                  ) : null}
                  <div className="ml-auto flex items-end gap-5 px-3 py-1 text-[12px] text-black">
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
                      <div className="font-mono">
                        {crm.redeemedPoints > 0 ? `-${crm.redeemedPoints}分` : "0"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1 text-[14px] font-bold">
                        <span className="text-[11px] text-[#003399]">▸</span>
                        <span>總計</span>
                      </div>
                      <div className="font-mono text-[26px] font-bold leading-none">
                        {netPayableHkd === 0 ? "$0.0" : formatHkd(netPayableHkd)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── 4. tender panel (方法) inside left column ────────── */}
                {tenderMode ? (
                  <div className="border-t border-[#aca899] bg-[#f0f0f0] p-1">
                    {depositTargetInvoice ? (
                      <div
                        data-testid="deposit-topup-banner"
                        className="mb-1 flex flex-wrap items-center justify-between gap-2 border border-[#2e7ec2] bg-[#e6f0fa] px-2 py-1 text-[11px] text-black"
                      >
                        <span>
                          <strong>加訂模式</strong> · 原單 <span className="font-mono font-bold">{depositTargetInvoice.invoiceNo}</span>
                        </span>
                        <span className="font-mono">
                          總額 {formatHkd(depositTargetInvoice.netAmountHkd)} ｜ 已付訂金{" "}
                          <strong className="text-[#0a7a2f]">{formatHkd(depositTargetInvoice.alreadyPaidHkd)}</strong>
                        </span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5 pb-1 text-[11px] text-black">
                      <span>
                        尚欠餘額：
                        <strong className="font-mono text-[#c00000]">{formatHkd(remainingDue)}</strong>
                      </span>
                      {appliedSplits.map((sp) => (
                        <span
                          key={sp.id}
                          className="inline-flex items-center gap-1 border border-[#7f9db9] bg-white px-1.5 py-0.5 font-mono"
                        >
                          {sp.tenderCode} {formatHkd(sp.amountHkd)}
                          <button
                            type="button"
                            onClick={() =>
                              setAppliedSplits((prev) => prev.filter((x) => x.id !== sp.id))
                            }
                            className="text-[#c00000]"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={addSplitPayment}
                        disabled={remainingDue <= 0 || cart.length === 0}
                        className="ml-auto border border-[#7f9db9] bg-[#fff8dc] px-2 py-0.5 text-[11px] text-black hover:bg-[#ffefb5] disabled:opacity-40"
                      >
                        加入部分付款 (付款二)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPay2Amount(String(remainingDue));
                          setShowPayMethod2(true);
                        }}
                        className="border border-[#7f9db9] bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-black hover:bg-[#e5e1d5]"
                      >
                        付款二
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTender("UNPAID_INVOICE");
                          if (depositMode === "NONE") setDepositMode("CASH");
                        }}
                        className={`border border-[#7f9db9] px-2 py-0.5 text-[11px] text-black ${
                          selectedTender === "UNPAID_INVOICE" && depositMode !== "NONE"
                            ? "bg-[#316ac5] font-bold text-white"
                            : "bg-[#f0f0f0] hover:bg-[#e5e1d5]"
                        }`}
                      >
                        落訂
                      </button>
                    </div>
                    <div className="flex flex-wrap items-stretch gap-1">
                      {TENDERS.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setSelectedTender(t.key)}
                          className={`flex min-w-[76px] flex-1 items-center justify-center border px-1.5 py-1.5 text-[12px] ${
                            selectedTender === t.key
                              ? "border-[#316ac5] bg-[#316ac5] font-bold text-white"
                              : "border-[#aca899] bg-white text-black hover:bg-[#e5e1d5]"
                          }`}
                        >
                          <span className="font-bold">{t.zh}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* ── 5. function key row directly under LEFT pane ─────── */}
                <div className="flex border-t border-[#aca899] bg-[#f0f0f0]">
                  {selectedLine ? (
                    <button
                      type="button"
                      className={fnBtn}
                      onClick={() => removeLine(selectedLine.item.sku)}
                      title="取消項目"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M5 5l14 14M19 5L5 19"
                          stroke="#d0523c"
                          strokeWidth="3.5"
                          strokeLinecap="round"
                        />
                      </svg>
                      取消項目
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={fnBtn}
                      style={docType === "SALES_RETURN" ? { background: "#ffd7d7" } : undefined}
                      onClick={toggleReturnMode}
                      title="退售"
                    >
                      <svg className="h-5 w-9" viewBox="0 0 36 20" aria-hidden="true">
                        <text x="18" y="15" textAnchor="middle" fontSize="12" fontWeight="700" fill="#c9543d">
                          VOID
                        </text>
                      </svg>
                      退售
                    </button>
                  )}
                  <button type="button" className={fnBtn} onClick={priceEnquiry} title="選價">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 12l8.5-8.5H20v8.5L11.5 20.5 3 12z" fill="#4f9d69" />
                      <circle cx="16.5" cy="7.5" r="1.5" fill="#fff" />
                      <rect x="13" y="13" width="8" height="8" rx="1" fill="#fff" stroke="#333" strokeWidth="1.2" />
                      <path
                        d="M14.5 17l1.8 1.8 3.2-3.6"
                        fill="none"
                        stroke="#2e7d47"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    選價
                  </button>
                  <button type="button" className={fnBtn} onClick={overridePrice} title="改價">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M3 12l8.5-8.5H20v8.5L11.5 20.5 3 12z" fill="#4f9d69" />
                      <circle cx="16.5" cy="7.5" r="1.5" fill="#fff" />
                      <path d="M13 21l2-5 6-6 2 2-6 6-4 3z" fill="#2e7ec2" />
                    </svg>
                    改價
                  </button>
                  <button
                    type="button"
                    className={fnBtn}
                    style={tenderMode ? { background: "#d7e7ff" } : undefined}
                    onClick={() => setTenderMode((v) => !v)}
                    title="方法"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="3" y="4" width="13" height="8" rx="1" fill="#4f9d69" />
                      <rect x="2" y="11" width="12" height="9" rx="1.5" fill="#2e7ec2" />
                      <rect x="4" y="15" width="4" height="2" fill="#e6f0fa" />
                      <ellipse cx="18" cy="18" rx="4" ry="2" fill="#d9a441" />
                      <ellipse cx="18" cy="15" rx="4" ry="2" fill="#e5b857" />
                    </svg>
                    方法
                  </button>
                  <button type="button" className={fnBtn} onClick={reselect} title="重選">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" fill="none" stroke="#c9543d" strokeWidth="3.2" />
                      <path d="M6.5 6.5l11 11" stroke="#c9543d" strokeWidth="3.2" strokeLinecap="round" />
                    </svg>
                    重選
                  </button>
                  <button
                    type="button"
                    className={`${fnBtn} border-r-0`}
                    disabled={cart.length === 0 || submitting}
                    style={cart.length === 0 || submitting ? { opacity: 0.35, cursor: "not-allowed" } : undefined}
                    onClick={() => void submitBill("completed")}
                    title="完成"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="10" fill="#4f9d69" />
                      <path
                        d="M7.5 12.2l3 3.1 6-6.3"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {submitting ? "儲存中…" : "完成"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* right: panel area + keypad */}
          <div className="flex w-[42%] min-w-[430px] flex-col border-l border-[#aca899]">
            {/* panel area */}
            <div className="min-h-0 flex-1 overflow-auto bg-white">
              {rightPanel === "quickpick" ? (
                <div className="p-1.5">
                  {quickPickTabEntries.length > 0 ? (
                    <div className="mb-1.5 flex flex-wrap gap-0.5 border-b border-[#aca899] pb-1">
                      {quickPickTabEntries.map((tab) => (
                        <button
                          key={tab.ft}
                          type="button"
                          onClick={() => setActiveFt(tab.ft)}
                          className={`border px-2.5 py-0.5 text-[11px] ${
                            activeFt === tab.ft
                              ? "border-[#808080] border-b-white bg-white font-bold text-black"
                              : "border-[#aca899] bg-[#e4e1d8] text-black hover:bg-[#edeae0]"
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-5 gap-1">
                    {quickPickSlots.map(({ slot, item }) =>
                      item ? (
                        <button
                          key={`${activeQuickMenu?.id ?? 0}-${activeFt}-${slot}-${item.sku}`}
                          type="button"
                          onClick={() => addItem(item)}
                          className="flex h-14 flex-col justify-between overflow-hidden border border-[#aca899] bg-[#e6e4dc] px-1 py-0.5 text-left text-[10px] leading-tight text-black hover:bg-[#fff3c4] active:bg-[#ffe899]"
                          style={
                            item.colorHex && /^#[0-9a-f]{3,8}$/i.test(item.colorHex)
                              ? { backgroundColor: item.colorHex }
                              : undefined
                          }
                          title={`${item.sku} · ${item.nameZh || item.nameEn} · ${formatHkd(item.unitPriceHkd)}`}
                        >
                          <span className="line-clamp-2 font-medium">
                            {item.buttonLabelZh || item.nameZh || item.nameEn}
                          </span>
                          <span className="font-mono text-[9px] text-[#555]">(${item.unitPriceHkd})</span>
                        </button>
                      ) : (
                        <div key={`empty-${slot}`} className="h-14" aria-hidden="true" />
                      ),
                    )}
                  </div>
                </div>
              ) : null}

              {rightPanel === "products" ? (
                <LegacyPicker
                  title="貨品"
                  suggestKind="product"
                  items={products}
                  total={productTotal}
                  page={productPage}
                  pageSize={12}
                  query={productQuery}
                  loading={pickerLoading}
                  getKey={(product) => product.sku}
                  columns={[
                    { header: "貨碼(*)", render: (product) => product.ubc || product.sku },
                    { header: "貨品", render: (product) => product.nameZh || product.nameEn },
                    { header: "顏色", render: (product) => product.colorName || "-" },
                    { header: "單價", numeric: true, render: (product) => formatHkd(product.unitPriceHkd) },
                  ]}
                  onQueryChange={(query) => void runProductSearch(query, 1)}
                  onPageChange={(page) => void runProductSearch(productQuery, page)}
                  onSelect={addItem}
                />
              ) : null}

              {rightPanel === "members" ? (
                <LegacyPicker
                  title="會員"
                  suggestKind={memberSearchScope === "all" ? "customer" : undefined}
                  items={customers}
                  total={customerTotal}
                  page={customerPage}
                  pageSize={12}
                  query={customerQuery}
                  loading={pickerLoading}
                  selectedKey={selectedCustomer?.id}
                  getKey={(customer) => customer.id}
                  headerActions={
                    <>
                      <button
                        type="button"
                        title="新增會員"
                        onClick={() => setQuickMemberModal({ mode: "add" })}
                        className="border border-[#aca899] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] font-bold hover:bg-white"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        title="修改會員"
                        disabled={!selectedCustomer && customers.length === 0}
                        onClick={() =>
                          setQuickMemberModal({
                            mode: "edit",
                            customer: selectedCustomer ?? customers[0] ?? null,
                          })
                        }
                        className="border border-[#aca899] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] hover:bg-white disabled:opacity-40"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        title="會員積分詳情"
                        disabled={!selectedCustomer && customers.length === 0}
                        onClick={() =>
                          setQuickMemberModal({
                            mode: "detail",
                            customer: selectedCustomer ?? customers[0] ?? null,
                          })
                        }
                        className="border border-[#aca899] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] hover:bg-white disabled:opacity-40"
                      >
                        🪪
                      </button>
                      <button
                        type="button"
                        title="切換會員排序"
                        onClick={() => {
                          const nextSort = memberSortBy === "newest_id" ? "points" : "newest_id";
                          setMemberSortBy(nextSort);
                          void runCustomerSearch(customerQuery, 1, memberSearchScope, nextSort);
                        }}
                        className="border border-[#aca899] bg-white px-1.5 py-0.5 text-[10px] hover:bg-[#e5e1d5]"
                      >
                        {memberSortBy === "newest_id" ? "排序:最新編號" : "排序:積分"}
                      </button>
                      <select
                        aria-label="會員搜尋範圍"
                        value={memberSearchScope}
                        onChange={(e) => {
                          const nextScope = e.target.value as "all" | "id" | "name" | "phone";
                          setMemberSearchScope(nextScope);
                          void runCustomerSearch(customerQuery, 1, nextScope, memberSortBy);
                        }}
                        className="border border-[#aca899] bg-white px-1 py-0.5 text-[10px]"
                      >
                        <option value="all">...▼</option>
                        <option value="id">號碼</option>
                        <option value="name">姓名</option>
                        <option value="phone">電話</option>
                      </select>
                    </>
                  }
                  columns={[
                    { header: "號碼", render: (customer) => customer.legacyId },
                    { header: "姓名", render: (customer) => customer.nameZh || customer.nameEn },
                    { header: "電話", render: (customer) => customer.phone || "-" },
                    { header: "積分", numeric: true, render: (customer) => customer.pointsBalance },
                  ]}
                  onQueryChange={(query) => void runCustomerSearch(query, 1)}
                  onPageChange={(page) => void runCustomerSearch(customerQuery, page)}
                  onSelect={(customer) => {
                    const deselect = selectedCustomer?.id === customer.id;
                    setSelectedCustomer(deselect ? null : customer);
                    setStatusMessage(
                      deselect ? "已取消會員" : `會員：${customer.nameZh || customer.nameEn}`,
                    );
                  }}
                />
              ) : null}

              {rightPanel === "staff" ? (
                <LegacyPicker
                  title="職員"
                  suggestKind="staff_login"
                  items={staffItems}
                  total={staffTotal}
                  page={staffPage}
                  pageSize={12}
                  query={staffQuery}
                  loading={pickerLoading}
                  selectedKey={selectedSalesperson?.id ?? session?.staffId}
                  getKey={(member) => member.id}
                  columns={[
                    { header: "號碼", render: (member) => member.legacyId ?? member.id },
                    { header: "姓名", render: (member) => member.displayName },
                    { header: "電話", render: (member) => member.phone || "-" },
                    { header: "卡號", render: (member) => member.cardNo || "-" },
                    { header: "級別", numeric: true, render: (member) => `L${member.roleLevel}` },
                  ]}
                  onQueryChange={(query) => void runStaffSearch(query, 1)}
                  onPageChange={(page) => void runStaffSearch(staffQuery, page)}
                  onSelect={(member) => {
                    const deselect = selectedSalesperson?.id === member.id;
                    setSelectedSalesperson(deselect ? null : member);
                    setStatusMessage(
                      deselect
                        ? "已重設銷售職員為登入收銀員"
                        : `銷售職員：${member.displayName} · L${member.roleLevel}`,
                    );
                  }}
                />
              ) : null}

              {rightPanel === "promo" ? (
                <div className="p-2 text-[12px] text-black">
                  <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center font-bold">
                    優惠
                  </div>
                  <div className="mt-2 space-y-1">
                    <div>本單賺取積分：+{crm.earnedPoints} 分</div>
                    <div>本單兌換積分：-{crm.redeemedPoints} 分</div>
                    <div>
                      會員：
                      {selectedCustomer
                        ? `${selectedCustomer.nameZh || selectedCustomer.nameEn}（結餘 ${selectedCustomer.pointsBalance} 分）`
                        : "未選擇"}
                    </div>
                    <div className="mt-2 border-t border-[#d4d0c8] pt-2">
                      <div className="mb-1 font-bold">快速折扣原因（DiscountReason）：</div>
                      <div className="grid grid-cols-2 gap-1">
                        {(
                          [
                            ["VIP 9折 (10%)", 0.1],
                            ["師生 85折 (15%)", 0.15],
                            ["生日 8折 (20%)", 0.2],
                            ["員工 7折 (30%)", 0.3],
                            ["清除折扣 (0%)", 0],
                          ] as Array<[string, number]>
                        ).map(([label, rate]) => (
                          <button
                            key={label}
                            type="button"
                            onClick={() => applyPresetDiscount(label, rate)}
                            className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1 text-left text-[11px] text-black hover:bg-[#e5e1d5]"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {promoResult.applied.length > 0 ? (
                      <div className="mt-2 border-t border-[#d4d0c8] pt-1">
                        <div className="font-bold">已套用推廣優惠：</div>
                        {promoResult.applied.map((a) => (
                          <div key={a.ruleId} className="flex justify-between text-[#0a7a2f]">
                            <span>
                              {a.name} ({a.code})
                            </span>
                            <span>-{formatHkd(a.discountHkd)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {cart.length === 0 ? <div className="text-[#808080]">（空單暫無優惠）</div> : null}
                  </div>
                </div>
              ) : null}

              {rightPanel === "image" ? (
                <div className="flex h-full flex-col bg-white">
                  <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center text-[12px] font-bold text-black">
                    影像
                  </div>
                  <div className="flex flex-1 items-center justify-center p-4">
                    <HarpCentreLogo showHotline />
                  </div>
                </div>
              ) : null}

              {rightPanel === "info" ? (
                <div className="p-2 text-[12px] text-black">
                  <div className="border-b border-[#aca899] bg-[#e8eef5] px-2 py-1 text-center font-bold">
                    資訊
                  </div>
                  <div className="mt-2 space-y-1">
                    <div>
                      分店：{storeContext?.shopNameEn ?? "Central"}({storeContext?.legacySn ?? 1})
                    </div>
                    <div>終端機：{storeContext?.legacyMn ?? 1}</div>
                    <div>收銀員：{session?.displayName ?? "未登入"}</div>
                    <div>版本：POS v2（重製 POSGV3.3 build 678）</div>
                    <div>資料庫：MySQL 8.4（連線正常）</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1 border-t border-[#d4d0c8] pt-2">
                    <button
                      type="button"
                      onClick={() => router.push("/invoices")}
                      className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1 text-[11px] hover:bg-[#e5e1d5]"
                    >
                      發票及應收帳
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push("/backoffice/products")}
                      className="border border-[#aca899] bg-[#f0f0f0] px-2 py-1 text-[11px] hover:bg-[#e5e1d5]"
                    >
                      後台維護
                    </button>
                  </div>
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
                <AutoSuggestInput
                  theme="legacy"
                  name="octopusCardId"
                  autoComplete="on"
                  suggestions={["88419204", "88001234", "91234567"]}
                  historyKey="pos_octo_card"
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
                  <AutoSuggestInput
                    theme="legacy"
                    name="approvalCode"
                    autoComplete="on"
                    suggestKind="payment_ref"
                    historyKey="pos_approval_code"
                    value={approvalCode}
                    onChange={(e) => setApprovalCode(e.target.value)}
                    className="ml-1 w-24 border border-[#aca899] bg-white px-1 py-0.5 font-mono"
                  />
                </label>
                <label>
                  卡號尾四位
                  <AutoSuggestInput
                    theme="legacy"
                    name="cardLast4"
                    autoComplete="cc-number"
                    historyKey="pos_card_last4"
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

            {/* keypad (Screenshot 001 exact 6x4 matrix) */}
            <div className="border-t border-[#aca899] bg-[#f0f0f0] p-1">
              <div className="grid grid-cols-6 gap-1">
                {/* Row 1: 7 8 9 [Black LCD col-span-3] */}
                {["7", "8", "9"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEntryBuffer((prev) => (prev + k).slice(0, 16))}
                    className="border border-[#aca899] bg-white py-2 text-center font-mono text-[20px] leading-none text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                  >
                    {k}
                  </button>
                ))}
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="數字鍵盤輸入"
                  data-testid="keypad-lcd"
                  value={entryBuffer}
                  placeholder={pendingQty > 1 ? `x${pendingQty}` : ""}
                  onChange={(e) => {
                    const sanitized = e.target.value.replace(/[^0-9.-]/g, "").slice(0, 16);
                    setEntryBuffer(sanitized);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!tenderMode && entryBuffer.trim()) {
                        void commitBarcode();
                      }
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setEntryBuffer("");
                    }
                  }}
                  className="col-span-3 w-full border-2 border-[#404040] bg-black px-2 text-right font-mono text-[20px] text-[#7fff7f] placeholder:text-[#7fff7f]/70 focus:border-[#7fff7f] focus:outline-none"
                />

                {/* Row 2: 4 5 6 數量 條碼 項折 */}
                {["4", "5", "6"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEntryBuffer((prev) => (prev + k).slice(0, 16))}
                    className="border border-[#aca899] bg-white py-2 text-center font-mono text-[20px] leading-none text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                  >
                    {k}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={applyQuantity}
                  className="border border-[#aca899] bg-white py-1 text-[11px] leading-tight text-black hover:bg-[#e5e1d5]"
                >
                  <div className="font-mono text-[13px]">{entryBuffer || "1"}</div>數量
                </button>
                <button
                  type="button"
                  onClick={() => commitBarcode()}
                  className="flex flex-col items-center justify-center border border-[#aca899] bg-white py-1 text-[10px] leading-tight text-black hover:bg-[#e5e1d5]"
                  title="輸入條碼"
                >
                  <LegacyIcon name="barcode" className="h-3.5 w-6" />
                  <span>條碼</span>
                </button>
                <button
                  type="button"
                  onClick={cycleLineDiscount}
                  className="flex flex-col items-center justify-center border border-[#aca899] bg-white py-1 text-[11px] leading-tight text-black hover:bg-[#e5e1d5]"
                >
                  <LegacyIcon name="itemDisc" className="h-4 w-4" />
                  <span>項折</span>
                </button>

                {/* Row 3: 1 2 3 - 送貨 單折 */}
                {["1", "2", "3"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEntryBuffer((prev) => (prev + k).slice(0, 16))}
                    className="border border-[#aca899] bg-white py-2 text-center font-mono text-[20px] leading-none text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                  >
                    {k}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEntryBuffer((prev) => (prev + "-").slice(0, 16))}
                  className="border border-[#aca899] bg-white py-2 text-center font-mono text-[20px] leading-none text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                  title="-"
                >
                  -
                </button>
                <button
                  type="button"
                  onClick={flagDelivery}
                  className="flex flex-col items-center justify-center border border-[#aca899] bg-white py-1 text-[11px] leading-tight text-black hover:bg-[#e5e1d5]"
                  style={isDelivery ? { background: "#fff3c4", fontWeight: 700 } : undefined}
                >
                  <LegacyIcon name="delivery" className="h-4 w-4" />
                  <span>送貨</span>
                </button>
                <button
                  type="button"
                  onClick={applyBillDiscount}
                  className="flex flex-col items-center justify-center border border-[#aca899] bg-white py-1 text-[11px] leading-tight text-black hover:bg-[#e5e1d5]"
                >
                  <LegacyIcon name="billDisc" className="h-4 w-4" />
                  <span>單折</span>
                </button>

                {/* Row 4: 0 00 . C _ _ */}
                {["0", "00", "."].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEntryBuffer((prev) => (prev + k).slice(0, 16))}
                    className="border border-[#aca899] bg-white py-2 text-center font-mono text-[20px] leading-none text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                  >
                    {k}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setEntryBuffer("")}
                  className="border border-[#aca899] bg-white py-2 text-center font-mono text-[20px] leading-none text-black hover:bg-[#e5e1d5] active:bg-[#d4d0c8]"
                >
                  C
                </button>
                <div className="border border-[#d4d0c8] bg-[#e6e4dc]" aria-hidden="true" />
                <div className="border border-[#d4d0c8] bg-[#e6e4dc]" aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* far-right side menu rail */}
          {renderSideMenu()}
        </div>
      )}

      {/* status line */}
      {statusMessage ? (
        <div className="border-t border-[#d4d0c8] bg-[#ffffe1] px-2 py-0.5 text-[12px] text-black">
          {statusMessage}
        </div>
      ) : null}

      {/* ── 6. VB6 message dialog ──────────────────────────────────────── */}
      {msg ? (
        <div
          className="absolute inset-0 z-10 flex items-start justify-center bg-black/10 pt-24"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`營運通訊息 - ${msg.code}`}
            className="w-[480px] border border-[#808080] bg-[#f0f0f0] shadow-[4px_4px_8px_rgba(0,0,0,0.4)]"
          >
            <div className="border-b border-[#d4d0c8] px-2 py-0.5 text-[12px] font-bold text-black">營運通訊息</div>
            <div className="flex items-start gap-3 p-3">
              <span className="text-[28px]">💬</span>
              <div className="min-h-16 flex-1 border border-[#aca899] bg-white p-2">
                <div className="text-[13px] font-bold text-[#2e7ec2]">營運通訊息 - {msg.code}</div>
                <div className="mt-1 whitespace-pre-line text-[13px] font-bold text-[#c00000]">{msg.text}</div>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-2">
              {completedInvoiceNo ? (
                <button
                  type="button"
                  onClick={() => router.push(`/invoices/${encodeURIComponent(completedInvoiceNo)}/print`)}
                  className="border border-[#aca899] bg-white px-4 py-1.5 text-[13px] text-black hover:bg-[#e5e1d5]"
                >
                  收據預覽
                </button>
              ) : null}
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

      {/* ── 7. 查單 & subscreen dialogs ──────────────────────────────── */}
      {showBillQuery ? (
        <BillQueryDialog onClose={() => setShowBillQuery(false)} onLoad={loadQueriedBill} />
      ) : null}

      {officeTxnType ? <OfficeTxnPanel initialType={officeTxnType} products={products} onSearch={runProductSearch} onClose={() => setOfficeTxnType(null)} /> : null}
      {activeReport === "hourly" ? <HourlyReport onClose={() => setActiveReport(null)} /> : null}
      {activeReport === "items" ? <ItemReport onClose={() => setActiveReport(null)} /> : null}
      {activeReport === "history" ? <HistoryReport onClose={() => setActiveReport(null)} /> : null}
      {activeReport === "stats" ? <ManagerStatsReport onClose={() => setActiveReport(null)} /> : null}
      {activeReport === "center" ? (
        <LegacyReportCenter mode="modal" initialTab={centerTab} onClose={() => setActiveReport(null)} />
      ) : null}
      {supportKind ? <SupportDialog kind={supportKind} shopId={storeContext?.legacySn ?? 1} terminalId={storeContext?.legacyMn ?? 1} onClose={() => setSupportKind(null)} /> : null}
      {quickMemberModal ? (
        <QuickMemberModal
          mode={quickMemberModal.mode}
          customer={quickMemberModal.customer}
          onClose={() => setQuickMemberModal(null)}
          onSaved={(saved) => {
            setSelectedCustomer({
              id: saved.id,
              legacyId: saved.legacyId,
              cardNo: saved.cardNo,
              nameZh: saved.nameZh,
              nameEn: saved.nameEn,
              phone: saved.phone,
              address: saved.address,
              pointsBalance: quickMemberModal.customer?.pointsBalance ?? 0,
            });
            setQuickMemberModal(null);
            setStatusMessage(`會員：${saved.nameZh || saved.nameEn}`);
            void runCustomerSearch(customerQuery, customerPage);
          }}
        />
      ) : null}
      {showPassword ? (
        <ChangePasswordDialog
          staffLabel={session?.displayName ?? "收銀員"}
          onClose={() => setShowPassword(false)}
        />
      ) : null}
      {showPrinter ? <PrinterSetupDialog onClose={() => setShowPrinter(false)} /> : null}
      {showFloatModal ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label="銀頭設定"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div className="w-[360px] border border-[#808080] bg-[#f0f0f0] p-4 shadow-xl text-[12px] text-black">
            <div className="font-bold">本更銀頭 (Cash Open)</div>
            <label className="mt-3 block">
              本更銀頭 (Cash Open) — HKD
              <input
                type="number"
                min="0"
                step="0.01"
                value={floatInput}
                onChange={(e) => setFloatInput(e.target.value)}
                className="mt-1 w-full border border-[#7f9db9] bg-white px-2 py-1 font-mono"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => void saveOpeningFloat()} className="border border-[#7f9db9] bg-[#f0f0f0] px-5 py-1">儲存</button>
              <button type="button" onClick={() => setShowFloatModal(false)} className="border border-[#7f9db9] bg-[#e1dfff] px-5 py-1">離開</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* fmholdbill: 擱置 / 取消功能 */}
      {showHoldDialog ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label="擱置 / 取消功能"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div className="w-[360px] border border-[#808080] bg-[#f0f0f0] shadow-xl text-[12px] text-black">
            <div className="border-b border-[#d4d0c8] px-3 py-1 font-bold">擱置 / 取消功能</div>
            <div className="p-4 text-[#333]">請選擇要擱置（暫停單）或取消目前帳單：</div>
            <div className="flex flex-col gap-2 px-4 pb-4">
              <button
                type="button"
                onClick={() => {
                  setShowHoldDialog(false);
                  void submitBill("held");
                }}
                className={panelBtn}
              >
                擱置本單
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowHoldDialog(false);
                  cancelCurrentBill();
                }}
                className={panelBtn}
              >
                取消本單
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setShowHoldDialog(false)}
                className="w-full border border-[#7f9db9] bg-[#e1dfff] px-2 py-1.5 text-left text-[12px] text-black hover:bg-[#d0ccff]"
              >
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* fmpaymethod2: 付款2 */}
      {showPayMethod2 ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label="付款2"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div className="w-[460px] border border-[#808080] bg-[#f0f0f0] shadow-xl text-[12px] text-black">
            <div className="border-b border-[#d4d0c8] px-3 py-1 font-bold">付款2 (Payment 2)</div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-3 gap-2 border border-[#aca899] bg-white p-2 text-right font-mono">
                <div>
                  <div className="text-[11px] text-[#555]">銷售額</div>
                  <div className="font-bold">{formatHkd(netPayableHkd)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#555]">付款 1 (已付)</div>
                  <div className="font-bold text-[#0a7a2f]">{formatHkd(splitPaidTotal)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#555]">付款 2 (尚欠餘額)</div>
                  <div className="font-bold text-[#c00000]">{formatHkd(remainingDue)}</div>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {TENDERS.filter((t) => t.key !== "UNPAID_INVOICE").map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setSelectedTender(t.key)}
                    className={`border px-2 py-1.5 text-[11px] ${
                      selectedTender === t.key
                        ? "border-[#316ac5] bg-[#316ac5] font-bold text-white"
                        : "border-[#aca899] bg-white text-black hover:bg-[#e5e1d5]"
                    }`}
                  >
                    {t.zh}
                  </button>
                ))}
              </div>
              <label className="block">
                請輸入第二付款資料 (HKD)
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={pay2Amount}
                  onChange={(e) => setPay2Amount(e.target.value)}
                  className="mt-1 w-full border border-[#7f9db9] bg-white px-2 py-1 font-mono"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d4d0c8] p-2">
              <button
                type="button"
                disabled={remainingDue <= 0 || cart.length === 0 || selectedTender === "UNPAID_INVOICE"}
                onClick={() => {
                  const rawAmt = Number(pay2Amount || remainingDue);
                  if (!Number.isFinite(rawAmt) || rawAmt <= 0) {
                    setStatusMessage("請輸入有效的第二付款金額");
                    return;
                  }
                  if (selectedTender !== "CASH" && rawAmt > remainingDue + 0.001) {
                    setStatusMessage(`非現金付款不可超過尚欠餘額 ${formatHkd(remainingDue)}`);
                    return;
                  }
                  if (selectedTender === "OCTOPUS" && !octopusApprovedInfo) {
                    showLegacyMsg("101");
                    return;
                  }
                  const appliedAmt = Math.min(rawAmt, remainingDue);
                  setAppliedSplits((prev) => [
                    ...prev,
                    {
                      id: `sp-${Date.now()}-${prev.length}`,
                      tenderCode: selectedTender as TenderCode,
                      amountHkd: Number(appliedAmt.toFixed(2)),
                      approvalCode: approvalCode.trim() || undefined,
                      cardLast4: cardLast4.length === 4 ? cardLast4 : undefined,
                    },
                  ]);
                  setShowPayMethod2(false);
                  setStatusMessage(`已加入付款二 ${selectedTender} ${formatHkd(appliedAmt)}`);
                }}
                className="border border-[#7f9db9] bg-[#f0f0f0] px-5 py-1 disabled:opacity-40"
              >
                完成
              </button>
              <button
                type="button"
                onClick={() => {
                  setAppliedSplits([]);
                  setShowPayMethod2(false);
                  setStatusMessage("已取消付款 2");
                }}
                className="border border-[#7f9db9] bg-[#fff0f0] px-4 py-1 text-[#900]"
              >
                取消付款2
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setShowPayMethod2(false)}
                className="border border-[#7f9db9] bg-[#e1dfff] px-5 py-1"
              >
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Double-click line editor dialog: 修改項目 */}
      {editingLineState ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-black/20"
          role="dialog"
          aria-modal="true"
          aria-label="修改項目"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div className="w-[460px] border border-[#808080] bg-[#f0f0f0] shadow-xl text-[12px] text-black">
            <div className="border-b border-[#d4d0c8] px-3 py-1 font-bold">
              浮動價格輸入 / 修改項目 · {editingLineState.sku}
            </div>
            <div className="space-y-2.5 p-4">
              {(() => {
                const targetItem = cart.find((c) => c.item.sku === editingLineState.sku)?.item;
                const priceLocked = Boolean(targetItem?.isFixedPrice);
                const discLocked = Boolean(targetItem?.isFixedPrice || targetItem?.allowItemDiscount === false);
                return (
                  <>
                    <div className="font-bold">
                      {targetItem?.nameZh || targetItem?.nameEn}
                      {targetItem?.colorName ? (
                        <span className="ml-1.5 font-normal text-[#555]">({targetItem.colorName})</span>
                      ) : null}
                    </div>
                    <label className="grid grid-cols-[100px_1fr] items-center">
                      數量
                      <input
                        name="editQty"
                        type="number"
                        min="1"
                        step="1"
                        value={editingLineState.qty}
                        onChange={(e) => setEditingLineState((s) => (s ? { ...s, qty: e.target.value } : s))}
                        className="border border-[#7f9db9] bg-white px-2 py-1 font-mono"
                      />
                    </label>
                    <label className="grid grid-cols-[100px_1fr] items-center">
                      售價 / 單價
                      <input
                        name="editPrice"
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={priceLocked}
                        value={editingLineState.price}
                        onChange={(e) => setEditingLineState((s) => (s ? { ...s, price: e.target.value } : s))}
                        className="border border-[#7f9db9] bg-white px-2 py-1 font-mono disabled:bg-[#e8e8e8]"
                      />
                    </label>
                    <label className="grid grid-cols-[100px_1fr] items-center">
                      項折 (%)
                      <input
                        name="editDiscPct"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        disabled={discLocked}
                        value={editingLineState.discPct}
                        onChange={(e) => setEditingLineState((s) => (s ? { ...s, discPct: e.target.value } : s))}
                        className="border border-[#7f9db9] bg-white px-2 py-1 font-mono disabled:bg-[#e8e8e8]"
                      />
                    </label>
                    <label className="grid grid-cols-[100px_1fr] items-center">
                      序號 (S/N)
                      <input
                        name="editSerialNo"
                        type="text"
                        maxLength={80}
                        placeholder="例如：琴身序號 S/N"
                        value={editingLineState.serialNo}
                        onChange={(e) => setEditingLineState((s) => (s ? { ...s, serialNo: e.target.value } : s))}
                        className="border border-[#7f9db9] bg-white px-2 py-1 font-mono"
                      />
                    </label>
                    <label className="grid grid-cols-[100px_1fr] items-start">
                      <span className="pt-1">備註</span>
                      <div className="space-y-1">
                        <textarea
                          name="editNotes"
                          rows={3}
                          maxLength={300}
                          placeholder="例如：租琴日期 Dec 2026、配件說明…"
                          value={editingLineState.notes}
                          onChange={(e) => setEditingLineState((s) => (s ? { ...s, notes: e.target.value } : s))}
                          className="w-full border border-[#7f9db9] bg-white px-2 py-1"
                        />
                        {targetItem ? (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingLineState((s) => {
                                if (!s) return s;
                                const tag = `原價 ${formatHkd(targetItem.unitPriceHkd)}`;
                                return {
                                  ...s,
                                  notes: s.notes.includes(tag) ? s.notes : [s.notes.trim(), tag].filter(Boolean).join(" "),
                                };
                              })
                            }
                            className="border border-[#aca899] bg-[#e6e4dc] px-2 py-0.5 text-[11px] hover:bg-white"
                          >
                            備註顯示原價
                          </button>
                        ) : null}
                      </div>
                    </label>
                  </>
                );
              })()}
            </div>
            <div className="flex justify-end gap-2 border-t border-[#d4d0c8] p-2">
              <button type="button" onClick={saveLineModalEdit} className="border border-[#7f9db9] bg-[#f0f0f0] px-5 py-1">
                確定
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setEditingLineState(null)}
                className="border border-[#7f9db9] bg-[#e1dfff] px-5 py-1"
              >
                離開
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── 8. 關於軟件 dialog (Screen 038) ───────────────────────────────── */}
      {showAbout ? (
        <div
          className="absolute inset-0 z-10 flex items-start justify-center bg-black/10 pt-24"
          role="dialog"
          aria-modal="true"
          aria-label="關於軟件"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        >
          <div className="w-[460px] border border-[#808080] bg-[#f0f0f0] text-black shadow-[4px_4px_8px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between border-b border-[#d4d0c8] bg-white px-2.5 py-1 text-[12px] font-bold text-black">
              <span>關於 eRun POSG</span>
              <button
                type="button"
                aria-label="關閉關於"
                onClick={() => setShowAbout(false)}
                className="px-1 text-[#666] hover:text-black"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3 p-4 text-[12px]">
              <div className="flex items-start gap-4">
                <ERunAboutBadge />
                <div className="space-y-1">
                  <div className="text-[14px] font-bold">eRun Systems Limited</div>
                  <div className="font-bold">eRun POSGV3.3 678</div>
                  <div>Copyright(C) 2001-2026</div>
                  <div className="pt-1 font-bold text-[#003399]">本產品授權給: eRun</div>
                </div>
              </div>
              <div>
                <div className="mb-1 font-bold text-[#333]">責任免除及限制責任</div>
                <textarea
                  readOnly
                  rows={4}
                  value={
                    "本軟件按「現狀」提供，不附帶任何明示或暗示之保證。在適用法律允許的最大範圍內，eRun Systems Limited 及其供應商不對因使用或無法使用本系統而引致之任何直接、間接、附帶或衍生性損害承擔責任。\n(POS v2 Web 重製系統 — 100% 保留原有數據庫及業務邏輯)"
                  }
                  className="w-full resize-none border border-[#7f9db9] bg-white p-2 text-[11px] leading-relaxed text-[#333]"
                />
              </div>
            </div>
            <div className="flex justify-end border-t border-[#d4d0c8] p-2">
              <button
                type="button"
                autoFocus
                className="border border-[#aca899] bg-[#e1dfff] px-7 py-1 text-[12px] text-black hover:bg-[#d0ccff]"
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

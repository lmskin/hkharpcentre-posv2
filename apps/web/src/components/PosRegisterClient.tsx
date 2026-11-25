"use client";

import { useState } from "react";
import Link from "next/link";
import { AutoSuggestInput } from "@/components/AutoSuggestInput";
import type { BillDocType, TenderCode } from "@hkharp/contracts";
import type { SessionPayload } from "@hkharp/db";
import { calculateBillTotals } from "@hkharp/domain/bill-math";
import { calculateCrmPoints } from "@hkharp/domain/crm-rules";
import { formatHkd } from "@hkharp/domain/money";
import { validateOctopusAmountHkd } from "@hkharp/domain/octopus-rules";

export interface PosProduct {
  id?: number;
  sku: string;
  ubc?: string;
  nameZh: string;
  nameEn: string;
  colorName?: string;
  sizeName?: string;
  buttonLabelZh?: string;
  buttonLabelEn?: string;
  ft?: number;
  bli?: number;
  colorHex?: string | null;
  categoryLabel?: string;
  categoryC1: number;
  unitPriceHkd: number;
  fixedPriceHkd?: number | null;
  allowItemDiscount?: boolean;
  isFixedPrice?: boolean;
  excludeFromCrmBonus?: boolean;
}

export interface PosMenuGroup {
  id: number;
  code: string;
  titleZh: string;
  titleEn: string;
  buttons: PosProduct[];
}

export interface PosCustomer {
  id: number;
  legacyId: string;
  gradeId?: number | null;
  gradeName?: string;
  cardNo?: string;
  nameZh: string;
  nameEn: string;
  phone: string;
  email?: string;
  address?: string;
  pointsBalance: number;
}

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

const STANDALONE_CARDS: ReadonlyArray<{ code: TenderCode; label: string }> = [
  { code: "VISA", label: "Visa (PM=2)" },
  { code: "MASTERCARD", label: "MasterCard (PM=3)" },
  { code: "UNIONPAY", label: "UnionPay (PM=4)" },
  { code: "AMEX", label: "AE (PM=6)" },
];

const OFFLINE_QUEUE_KEY = "hkharp_offline_bills_v2";

export function PosRegisterClient({
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
  const [products, setProducts] = useState<PosProduct[]>(initialProducts);
  const [productQuery, setProductQuery] = useState("");
  const [activeMenuId, setActiveMenuId] = useState<number | null>(menus[0]?.id ?? null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customers, setCustomers] = useState<PosCustomer[]>(initialCustomers);
  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);

  const [docType, setDocType] = useState<BillDocType>("RETAIL_SALE");
  const [selectedTender, setSelectedTender] = useState<"OCTOPUS" | "CASH" | "UNPAID_INVOICE" | TenderCode>(
    "MASTERCARD",
  );
  const [depositMode, setDepositMode] = useState<"NONE" | TenderCode>("NONE");
  const [depositAmount, setDepositAmount] = useState<string>("");
  const [cardLast4, setCardLast4] = useState("");
  const [approvalCode, setApprovalCode] = useState("");
  const [cashTendered, setCashTendered] = useState("");
  const [notes, setNotes] = useState("");

  // Live Octopus RWL bridge state
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

  const activeMenuButtons =
    activeMenuId !== null ? (menus.find((m) => m.id === activeMenuId)?.buttons ?? []) : products;
  const displayedProducts = productQuery.trim() ? products : activeMenuButtons.length > 0 ? activeMenuButtons : products;

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

  function addItem(item: PosProduct) {
    setOctopusApprovedInfo(null);
    setCart((prev) => {
      const existingIdx = prev.findIndex((x) => x.item.sku === item.sku);
      if (existingIdx >= 0) {
        return prev.map((entry, idx) =>
          idx === existingIdx ? { ...entry, quantity: entry.quantity + 1 } : entry,
        );
      }
      return [...prev, { item, quantity: 1, discountRate: 0 }];
    });
  }

  function updateQty(sku: string, delta: number) {
    setOctopusApprovedInfo(null);
    setCart((prev) =>
      prev
        .map((c) => (c.item.sku === sku ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c))
        .filter((c) => c.quantity > 0),
    );
  }

  async function callOctopusBridge(outcome: "APPROVE" | "INCOMPLETE_100022") {
    if (!octopusValidation.ok) {
      setStatusMessage(octopusValidation.reason);
      return;
    }
    try {
      const res = await fetch(`${bridgeUrl}/octopus/simulate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Token": bridgeToken,
        },
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
        `Octopus approved via 127.0.0.1:17880 (Card ${data.cardId}, Bal ${formatHkd((data.remainingValueCents ?? 0) / 100)}).`,
      );
    } catch {
      setStatusMessage("Unable to reach local Windows x86 hardware bridge at 127.0.0.1:17880.");
    }
  }

  async function submitBill() {
    if (cart.length === 0) return;
    if (!session) {
      setStatusMessage("Please sign in at /login before posting transactions to MySQL 8.");
      return;
    }
    if (selectedCustomer && !crm.redemptionAllowed) {
      setStatusMessage(crm.redemptionError ?? "Insufficient CRM points for voucher redemption.");
      return;
    }
    if (octopusLockCardId) {
      setStatusMessage(
        `Bill locked by Octopus 100022 (Card ${octopusLockCardId}) — retry the same Octopus card first.`,
      );
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
        setStatusMessage("Tap / approve Octopus on the PC RWL bridge before completing sale.");
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
          selectedTender === "CASH" && Number(cashTendered) > totals.netAmountHkd
            ? `Cash tendered ${cashTendered}`
            : undefined,
      });
    }

    const payload = {
      clientIdempotencyKey: `bill-${crypto.randomUUID()}`,
      shopId: session.shopId || 1,
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
        setStatusMessage(data.error ?? "Failed to save bill");
        return;
      }

      // Kick ESC/POS cash drawer on Cash transactions if bridge responds cleanly
      if (selectedTender === "CASH" && bridgeToken) {
        fetch(`${bridgeUrl}/drawer/open`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Bridge-Token": bridgeToken },
          body: JSON.stringify({ requestId: payload.clientIdempotencyKey, reason: "CASH_SALE" }),
        }).catch(() => {});
      }

      setRecentDocs((prev) => [data, ...prev]);
      setCart([]);
      setOctopusApprovedInfo(null);
      setApprovalCode("");
      setCardLast4("");
      setCashTendered("");
      setDepositAmount("");
      setNotes("");
      setStatusMessage(
        `Saved ${data.invoiceNo} to MySQL 8 (${data.paymentStatus.toUpperCase()} · Balance ${formatHkd(data.balanceDueHkd)}).`,
      );
    } catch {
      const existingRaw = localStorage.getItem(OFFLINE_QUEUE_KEY);
      const queued = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : [];
      queued.push(payload);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queued));
      setStatusMessage("Server unreachable — saved transaction to offline browser outbox for retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <section className="space-y-4 lg:col-span-7">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
              Catalog &amp; V47 Menu Groups
            </h1>
            <AutoSuggestInput
              theme="modern"
              type="search"
              name="regProductQuery"
              autoComplete="on"
              suggestKind="product"
              historyKey="reg_prod_q"
              value={productQuery}
              onChange={(e) => void runProductSearch(e.target.value)}
              placeholder="Search 1,983 SKUs by code, English, or Chinese name..."
              className="w-72 rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
            />
          </div>

          {!productQuery.trim() && menus.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {menus.slice(0, 12).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveMenuId(m.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                    activeMenuId === m.id
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {m.titleEn}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setActiveMenuId(null)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  activeMenuId === null
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                All SKUs
              </button>
            </div>
          ) : null}

          <div className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {displayedProducts.map((item) => (
              <button
                key={item.sku}
                type="button"
                onClick={() => addItem(item)}
                className="flex flex-col items-start rounded-lg border border-slate-200 p-3 text-left transition hover:border-indigo-500 hover:bg-indigo-50/40"
              >
                <span className="font-mono text-[11px] font-semibold text-indigo-600">
                  {item.sku} · C1={item.categoryC1}
                </span>
                <span className="mt-0.5 text-sm font-medium text-slate-900">
                  {item.nameEn || item.nameZh}
                </span>
                <span className="text-xs text-slate-500">{item.nameZh}</span>
                <span className="mt-1.5 font-mono text-sm font-bold text-slate-900">
                  {formatHkd(item.unitPriceHkd)}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Member &amp; Cart Lines</h2>
            <div className="flex items-center gap-2 text-xs">
              <AutoSuggestInput
                theme="modern"
                name="regCustomerQuery"
                autoComplete="on"
                suggestKind="customer"
                valueField="nameEn"
                historyKey="reg_cust_q"
                value={customerQuery}
                onChange={(e) => void runCustomerSearch(e.target.value)}
                placeholder="Filter 2,302 customers..."
                className="w-44 rounded border border-slate-300 px-2 py-1"
              />
              <select
                value={selectedCustomer?.id ?? ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSelectedCustomer(customers.find((c) => c.id === id) ?? null);
                }}
                className="max-w-52 rounded border border-slate-300 px-2 py-1"
              >
                <option value="">Walk-in Customer (0 pts)</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameEn || c.nameZh} ({c.pointsBalance} pts)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {cart.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Cart is empty. Tap any product card above.</p>
          ) : (
            <div className="mt-3 divide-y divide-slate-100">
              {cart.map((line, idx) => (
                <div key={line.item.sku} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{line.item.nameEn || line.item.nameZh}</div>
                    <div className="text-xs text-slate-500">
                      {line.item.sku} · {formatHkd(line.item.unitPriceHkd)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={`Discount for ${line.item.sku}`}
                      value={line.discountRate}
                      onChange={(e) => {
                        const rate = Number(e.target.value);
                        setCart((prev) =>
                          prev.map((c) => (c.item.sku === line.item.sku ? { ...c, discountRate: rate } : c)),
                        );
                      }}
                      className="rounded border border-slate-300 px-1.5 py-1 text-xs"
                    >
                      <option value={0}>0% off</option>
                      <option value={0.1}>10% off</option>
                      <option value={0.15}>15% off</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => updateQty(line.item.sku, -1)}
                      className="h-7 w-7 rounded border border-slate-300 hover:bg-slate-100"
                    >
                      -
                    </button>
                    <span className="w-6 text-center font-mono">{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => updateQty(line.item.sku, 1)}
                      className="h-7 w-7 rounded border border-slate-300 hover:bg-slate-100"
                    >
                      +
                    </button>
                    <span className="w-24 text-right font-mono font-semibold">
                      {formatHkd(totals.lines[idx]?.netHkd ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4 lg:col-span-5">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          {!session ? (
            <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
              Staff sign-in required to write bills to MySQL 8.{" "}
              <Link href="/login" className="font-semibold underline">
                Sign in now →
              </Link>
            </div>
          ) : null}

          <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
            <span className="text-sm font-medium text-slate-600">Net Total</span>
            <span className="font-mono text-2xl font-bold text-slate-900">{formatHkd(totals.netAmountHkd)}</span>
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-600">
            <span>CRM Earn: +{crm.earnedPoints} pts</span>
            <span>Redeem: -{crm.redeemedPoints} pts</span>
          </div>

          <div className="mt-3 flex gap-1.5 text-xs">
            {(["RETAIL_SALE", "SALES_RETURN", "PETTY_PAYOUT"] as const).map((dt) => (
              <button
                key={dt}
                type="button"
                onClick={() => setDocType(dt)}
                className={`rounded border px-2 py-1 font-medium ${
                  docType === dt ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600"
                }`}
              >
                {dt === "RETAIL_SALE" ? "Sale (XC=99)" : dt === "SALES_RETURN" ? "Return (XC=9)" : "Payout (XC=12)"}
              </button>
            ))}
          </div>

          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tender or Issue Unpaid Invoice
          </h3>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <button
              type="button"
              onClick={() => setSelectedTender("OCTOPUS")}
              className={`rounded-lg border px-3 py-2 text-left font-medium ${
                selectedTender === "OCTOPUS" ? "border-orange-500 bg-orange-50 text-orange-900" : "border-slate-200"
              }`}
            >
              Octopus (PM=1 · RWL)
            </button>
            <button
              type="button"
              onClick={() => setSelectedTender("CASH")}
              className={`rounded-lg border px-3 py-2 text-left font-medium ${
                selectedTender === "CASH" ? "border-emerald-500 bg-emerald-50 text-emerald-900" : "border-slate-200"
              }`}
            >
              Cash (PM=0)
            </button>
            {STANDALONE_CARDS.map((card) => (
              <button
                key={card.code}
                type="button"
                onClick={() => setSelectedTender(card.code)}
                className={`rounded-lg border px-3 py-2 text-left font-medium ${
                  selectedTender === card.code
                    ? "border-indigo-500 bg-indigo-50 text-indigo-900"
                    : "border-slate-200"
                }`}
              >
                {card.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelectedTender("UNPAID_INVOICE")}
              className={`col-span-2 rounded-lg border px-3 py-2.5 text-left font-semibold ${
                selectedTender === "UNPAID_INVOICE"
                  ? "border-amber-600 bg-amber-50 text-amber-950"
                  : "border-slate-200 bg-slate-50"
              }`}
            >
              Issue Formal Invoice (Customer Pays Later by Bank Transfer PM=5)
            </button>
          </div>

          {selectedTender === "OCTOPUS" ? (
            <div className="mt-4 rounded-lg border border-orange-200 bg-orange-50/50 p-3 text-xs space-y-2">
              <div className="font-semibold text-orange-950">Octopus RWL Bridge ({bridgeUrl})</div>
              <div>
                10-cent rule:{" "}
                {octopusValidation.ok ? (
                  <span className="font-medium text-emerald-700">Valid ({octopusValidation.amountCents}¢)</span>
                ) : (
                  <span className="font-medium text-rose-700">{octopusValidation.reason}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <AutoSuggestInput
                  theme="modern"
                  name="regOctopusCardId"
                  autoComplete="on"
                  suggestions={["88419204", "88001234", "91234567"]}
                  historyKey="reg_octo_card"
                  value={octopusCardIdInput}
                  onChange={(e) => setOctopusCardIdInput(e.target.value)}
                  className="w-28 rounded border border-slate-300 bg-white px-2 py-1 font-mono"
                />
                <button
                  type="button"
                  onClick={() => void callOctopusBridge("APPROVE")}
                  className="rounded bg-orange-600 px-2.5 py-1 font-medium text-white hover:bg-orange-700"
                >
                  Tap / Approve
                </button>
                <button
                  type="button"
                  onClick={() => void callOctopusBridge("INCOMPLETE_100022")}
                  className="rounded border border-orange-400 px-2 py-1 font-medium text-orange-900"
                >
                  Test 100022 Lock
                </button>
              </div>
              {octopusLockCardId ? (
                <div className="rounded bg-rose-100 p-2 font-semibold text-rose-900">
                  +++DO NOT CANCEL THE TXN+++ Locked on Card {octopusLockCardId}. Present same card again.
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedTender === "UNPAID_INVOICE" ? (
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs">
              <div>
                <label className="block text-slate-700">Optional Deposit Tender</label>
                <select
                  value={depositMode}
                  onChange={(e) => setDepositMode(e.target.value as "NONE" | TenderCode)}
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1"
                >
                  <option value="NONE">Unpaid ($0 deposit)</option>
                  <option value="VISA">Visa Deposit</option>
                  <option value="MASTERCARD">MasterCard Deposit</option>
                  <option value="CASH">Cash Deposit</option>
                  <option value="BANK_XFER">Bank Transfer Deposit</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-700">Deposit Amount (HKD)</label>
                <input
                  type="number"
                  disabled={depositMode === "NONE"}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono disabled:bg-slate-100"
                />
              </div>
            </div>
          ) : null}

          {STANDALONE_CARDS.some((c) => c.code === selectedTender) || depositMode !== "NONE" ? (
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <div>
                <label className="block text-slate-600">Approval Code</label>
                <AutoSuggestInput
                  theme="modern"
                  name="regApprovalCode"
                  autoComplete="on"
                  suggestKind="payment_ref"
                  historyKey="reg_approval_code"
                  value={approvalCode}
                  onChange={(e) => setApprovalCode(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-600">Card Last 4</label>
                <AutoSuggestInput
                  theme="modern"
                  name="regCardLast4"
                  autoComplete="cc-number"
                  historyKey="reg_card_last4"
                  value={cardLast4}
                  maxLength={4}
                  onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, ""))}
                  placeholder="1234"
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono"
                />
              </div>
            </div>
          ) : null}

          {selectedTender === "CASH" ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
              <label className="block text-slate-600">Cash Tendered (HKD)</label>
              <input
                type="number"
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
                placeholder={String(totals.netAmountHkd)}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono"
              />
              {Number(cashTendered) > totals.netAmountHkd ? (
                <div className="mt-1 font-semibold text-emerald-700">
                  Change Due: {formatHkd(Number(cashTendered) - totals.netAmountHkd)}
                </div>
              ) : null}
            </div>
          ) : null}

          <AutoSuggestInput
            theme="modern"
            name="regBillNotes"
            autoComplete="on"
            suggestions={["送貨安排", "銀行轉帳跟進", "VIP折扣單", "分期付訂"]}
            historyKey="reg_bill_notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Invoice / bill remarks (optional)"
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs"
          />

          <button
            type="button"
            disabled={cart.length === 0 || submitting}
            onClick={() => void submitBill()}
            className="mt-3 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-300"
          >
            {submitting
              ? "Saving to MySQL 8..."
              : selectedTender === "UNPAID_INVOICE"
                ? "Issue Formal Invoice"
                : "Complete Sale"}
          </button>

          {statusMessage ? (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
              {statusMessage}
            </div>
          ) : null}
        </div>

        {recentDocs.length > 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Saved Documents (MySQL 8)
            </h3>
            <ul className="mt-2 space-y-1.5 text-xs">
              {recentDocs.map((doc) => (
                <li
                  key={doc.invoiceNo}
                  className="flex items-center justify-between rounded bg-slate-50 px-2.5 py-2"
                >
                  <div>
                    <span className="font-mono font-semibold text-slate-900">{doc.invoiceNo}</span>
                    <div className="text-[11px] text-slate-600">
                      {doc.paymentStatus.toUpperCase()} · Bal {formatHkd(doc.balanceDueHkd)}
                    </div>
                  </div>
                  <Link
                    href={`/invoices/${encodeURIComponent(doc.invoiceNo)}/print`}
                    className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    Print
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

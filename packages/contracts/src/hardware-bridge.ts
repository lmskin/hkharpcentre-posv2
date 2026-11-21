import { z } from "zod";

/**
 * WebSocket / HTTP contract between Chromium POS PWA and local Windows x86
 * pos-hardware-bridge (127.0.0.1:17880).
 *
 * Primary scope:
 *  - Octopus 32-bit rwl.dll (InitComm, TimeVer, Poll, Deduct, 100022 incomplete-tap lock, XFile + OSDXC.exe)
 *  - ESC/POS thermal receipt printer + RJ11 cash drawer kick
 * Optional scope (behind ENABLE_INTEGRATED_PAX_EDC):
 *  - PAX S60 (RS-232) / PAX A920 (LAN TCP)
 */
export const BridgeCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("BRIDGE_PING"),
    requestId: z.string(),
  }),
  z.object({
    type: z.literal("OCTOPUS_DEDUCT"),
    requestId: z.string(),
    billRef: z.string().min(1).max(40),
    amountCents: z.number().int().positive().refine((c) => c % 10 === 0, {
      message: "Octopus amountCents must be divisible by 10",
    }),
    expectedRetryCardId: z.string().optional(),
  }),
  z.object({
    type: z.literal("OCTOPUS_XFILE_SETTLE"),
    requestId: z.string(),
    runOsdxcExchange: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("ESCPOS_PRINT_RECEIPT"),
    requestId: z.string(),
    invoiceNo: z.string(),
    openCashDrawer: z.boolean().default(false),
    lines: z.array(z.string()),
  }),
  z.object({
    type: z.literal("OPEN_CASH_DRAWER"),
    requestId: z.string(),
    reason: z.enum(["CASH_SALE", "PETTY_PAYOUT", "NO_SALE_AUTH"]),
  }),
]);
export type BridgeCommand = z.infer<typeof BridgeCommandSchema>;

export const BridgeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("BRIDGE_STATUS"),
    requestId: z.string().optional(),
    version: z.string(),
    arch: z.literal("x86"),
    octopusReaderReady: z.boolean(),
    blacklistUpToDate: z.boolean(),
    printerReady: z.boolean(),
    integratedPaxEdcEnabled: z.boolean(),
  }),
  z.object({
    type: z.literal("OCTOPUS_APPROVED"),
    requestId: z.string(),
    billRef: z.string(),
    cardId: z.string(),
    deviceId: z.string(),
    deductedCents: z.number().int(),
    remainingValueCents: z.number().int(),
    lastAddValueDate: z.string().optional(),
  }),
  z.object({
    type: z.literal("OCTOPUS_INCOMPLETE_100022"),
    requestId: z.string(),
    billRef: z.string(),
    lockedCardId: z.string(),
    promptEn: z.string(),
    promptZh: z.string(),
  }),
  z.object({
    type: z.literal("OCTOPUS_DECLINED"),
    requestId: z.string(),
    errorCode: z.number().int(),
    message: z.string(),
  }),
  z.object({
    type: z.literal("PRINT_COMPLETED"),
    requestId: z.string(),
    drawerOpened: z.boolean(),
  }),
]);
export type BridgeEvent = z.infer<typeof BridgeEventSchema>;

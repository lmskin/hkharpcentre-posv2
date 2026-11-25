import crypto from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { BridgeEventSchema } from "@hkharp/contracts";

const PORT = Number(process.env.PORT ?? "17889");
const TOKEN = process.env.HARDWARE_BRIDGE_TOKEN ?? "e2e-bridge-token";
const MAX_OCTOPUS_HKD = 3000;

interface JournalEntry {
  requestId: string;
  billRef: string;
  cardId: string;
  deviceId: string;
  amountCents: number;
  remainingValueCents: number;
  recoveredFrom100022: boolean;
  transactedAt: string;
}

const incompleteLocks = new Map<string, string>();
const journalEntries: JournalEntry[] = [];
const drawerOpens: Array<{ requestId: string; reason: string; atIso: string }> = [];
const printedReceipts: Array<{ requestId: string; invoiceNo: string; lines: string[]; openCashDrawer: boolean }> = [];

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin ?? "http://127.0.0.1:3100";
  if (
    origin === "http://127.0.0.1:3100" ||
    origin === "http://localhost:3100" ||
    origin === "http://127.0.0.1:3501" ||
    origin === "http://localhost:3501"
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Bridge-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  setCors(req, res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function isAuthorized(req: IncomingMessage): boolean {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice("bearer ".length).trim();
    if (t === TOKEN) return true;
  }
  const xtok = req.headers["x-bridge-token"];
  if (typeof xtok === "string" && xtok.trim() === TOKEN) return true;
  return false;
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function buildWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

  if (req.method === "OPTIONS") {
    setCors(req, res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    const statusPayload = BridgeEventSchema.parse({
      type: "BRIDGE_STATUS",
      version: "0.2.0-e2e",
      arch: "x86",
      octopusReaderReady: true,
      blacklistUpToDate: true,
      printerReady: true,
      integratedPaxEdcEnabled: false,
    });
    sendJson(req, res, 200, {
      ...statusPayload,
      simulatorEnabled: true,
      activeIncompleteLocks: incompleteLocks.size,
      journalCount: journalEntries.length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/test/state") {
    sendJson(req, res, 200, {
      incompleteLocks: Object.fromEntries(incompleteLocks.entries()),
      journalEntries,
      drawerOpens,
      printedReceipts,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/test/reset") {
    incompleteLocks.clear();
    journalEntries.length = 0;
    drawerOpens.length = 0;
    printedReceipts.length = 0;
    sendJson(req, res, 200, { ok: true });
    return;
  }

  if (!isAuthorized(req)) {
    sendJson(req, res, 401, { error: "Unauthorized bridge token" });
    return;
  }

  const body = await readBody(req).catch(() => ({}));

  if (req.method === "POST" && (url.pathname === "/octopus/simulate" || url.pathname === "/octopus/deduct")) {
    const requestId = String(body.requestId ?? `req-${Date.now()}`);
    const billRef = String(body.billRef ?? `POS-${Date.now()}`);
    const amountCents = Number(body.amountCents ?? 0);
    const cardId = String(body.cardId ?? body.expectedRetryCardId ?? "88419204").trim() || "88419204";
    const simulateOutcome = typeof body.simulateOutcome === "string" ? body.simulateOutcome : "APPROVE";

    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents % 10 !== 0) {
      const declined = BridgeEventSchema.parse({
        type: "OCTOPUS_DECLINED",
        requestId,
        errorCode: 100099,
        message: "Deduction only multiply of 10 cents allowed",
      });
      sendJson(req, res, 400, declined);
      return;
    }

    if (amountCents > MAX_OCTOPUS_HKD * 100) {
      const declined = BridgeEventSchema.parse({
        type: "OCTOPUS_DECLINED",
        requestId,
        errorCode: 100098,
        message: `Amount exceeds OctoMaxValue HK$${MAX_OCTOPUS_HKD}`,
      });
      sendJson(req, res, 400, declined);
      return;
    }

    if (simulateOutcome.toUpperCase() === "INCOMPLETE_100022") {
      incompleteLocks.set(billRef, cardId);
      const incomplete = BridgeEventSchema.parse({
        type: "OCTOPUS_INCOMPLETE_100022",
        requestId,
        billRef,
        lockedCardId: cardId,
        promptEn:
          "+++DO NOT CANCEL THE TXN+++ Transaction Incomplete! Please request customer to present the same card again (100022).",
        promptZh: "+++請勿取消交易+++ 交易未完成，請顧客再次拍同一張八達通卡 (100022)。",
      });
      sendJson(req, res, 409, incomplete);
      return;
    }

    const lockedCardId = incompleteLocks.get(billRef);
    const presentedOrExpected =
      url.pathname === "/octopus/deduct" ? String(body.expectedRetryCardId ?? "").trim() : cardId;
    if (lockedCardId && lockedCardId !== presentedOrExpected) {
      const mismatch = BridgeEventSchema.parse({
        type: "OCTOPUS_INCOMPLETE_100022",
        requestId,
        billRef,
        lockedCardId,
        promptEn: `Card mismatch: expected locked card ${lockedCardId}, got ${presentedOrExpected || "none"}. Present the same card again (100022).`,
        promptZh: `卡號不符：請使用同一張八達通卡 (${lockedCardId}) 完成交易 (100022)。`,
      });
      sendJson(req, res, 409, mismatch);
      return;
    }

    const recovered = incompleteLocks.delete(billRef);
    const remainingValueCents = Math.max(0, 20000 - amountCents);
    journalEntries.push({
      requestId,
      billRef,
      cardId,
      deviceId: "SIM-RWL-01",
      amountCents,
      remainingValueCents,
      recoveredFrom100022: recovered,
      transactedAt: new Date().toISOString(),
    });

    const approved = BridgeEventSchema.parse({
      type: "OCTOPUS_APPROVED",
      requestId,
      billRef,
      cardId,
      deviceId: "SIM-RWL-01",
      deductedCents: amountCents,
      remainingValueCents,
    });
    sendJson(req, res, 200, { ...approved, recoveredFrom100022: recovered });
    return;
  }

  if (req.method === "POST" && url.pathname === "/octopus/xfile") {
    const totalCents = journalEntries.reduce((sum, e) => sum + e.amountCents, 0);
    sendJson(req, res, 200, {
      type: "OCTOPUS_XFILE_SUMMARY",
      pendingLocks: incompleteLocks.size,
      journalTransactions: journalEntries.length,
      totalCents,
      generatedAtIso: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/print/receipt") {
    const requestId = String(body.requestId ?? `prt-${Date.now()}`);
    const invoiceNo = String(body.invoiceNo ?? "");
    const lines = Array.isArray(body.lines) ? body.lines.map(String) : [];
    const openCashDrawer = Boolean(body.openCashDrawer);
    printedReceipts.push({ requestId, invoiceNo, lines, openCashDrawer });
    const ev = BridgeEventSchema.parse({
      type: "PRINT_COMPLETED",
      requestId,
      drawerOpened: openCashDrawer,
    });
    sendJson(req, res, 200, { ...ev, invoiceNo, payloadBytes: lines.join("\n").length });
    return;
  }

  if (req.method === "POST" && url.pathname === "/drawer/open") {
    const requestId = String(body.requestId ?? `drw-${Date.now()}`);
    const reason = String(body.reason ?? "CASH_SALE");
    drawerOpens.push({ requestId, reason, atIso: new Date().toISOString() });
    const ev = BridgeEventSchema.parse({
      type: "PRINT_COMPLETED",
      requestId,
      drawerOpened: true,
    });
    sendJson(req, res, 200, { ...ev, commandBytes: 5 });
    return;
  }

  sendJson(req, res, 404, { error: "Not found" });
});

server.on("upgrade", (req: IncomingMessage, socket: Duplex) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }
  const key = req.headers["sec-websocket-key"];
  if (!key || Array.isArray(key)) {
    socket.destroy();
    return;
  }
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );

  const statusPayload = BridgeEventSchema.parse({
    type: "BRIDGE_STATUS",
    version: "0.2.0-e2e",
    arch: "x86",
    octopusReaderReady: true,
    blacklistUpToDate: true,
    printerReady: true,
    integratedPaxEdcEnabled: false,
  });
  socket.write(buildWsTextFrame(JSON.stringify(statusPayload)));
  socket.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`E2E Hardware Bridge listening on http://127.0.0.1:${PORT}`);
});

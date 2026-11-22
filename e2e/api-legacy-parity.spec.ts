import { execFile } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import { promisify } from "node:util";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { BridgeEventSchema } from "@hkharp/contracts";
import type { Connection } from "mysql2/promise";
import { captureDbSnapshot, openE2eMysqlConnection, restoreDbSnapshot, type DbSnapshot } from "./helpers/cleanup";
import { loadRootDotEnv } from "./helpers/env";

const execFileAsync = promisify(execFile);
const BRIDGE_URL = "http://127.0.0.1:17889";
const BRIDGE_TOKEN = "e2e-bridge-token";

async function loginApi(request: APIRequestContext, payload: { pin?: string; staffCode?: string; password?: string }) {
  const res = await request.post("/api/auth/login", { data: payload });
  return res;
}

function readSingleWebSocketFrame(urlStr: string): Promise<string> {
  const url = new URL(urlStr);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port) }, () => {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        [
          `GET ${url.pathname} HTTP/1.1`,
          `Host: ${url.host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n"),
      );
    });
    const chunks: Buffer[] = [];
    socket.on("data", (d) => chunks.push(d));
    socket.on("end", () => {
      const buf = Buffer.concat(chunks);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return reject(new Error("Missing HTTP upgrade header"));
      const frame = buf.subarray(headerEnd + 4);
      const lenByte = frame[1]! & 0x7f;
      const offset = lenByte === 126 ? 4 : 2;
      const payloadLen = lenByte === 126 ? frame.readUInt16BE(2) : lenByte;
      resolve(frame.subarray(offset, offset + payloadLen).toString("utf8"));
    });
    socket.on("error", reject);
  });
}

test.describe("Modules 1-12: Full-Stack API, Hardware Bridge & Legacy V47 Parity", () => {
  let conn: Connection;
  let snapshot: DbSnapshot;

  test.beforeAll(async () => {
    conn = await openE2eMysqlConnection();
    snapshot = await captureDbSnapshot(conn);
    await fetch(`${BRIDGE_URL}/test/reset`, { method: "POST" });
  });

  test.afterAll(async () => {
    if (conn && snapshot) {
      await restoreDbSnapshot(conn, snapshot);
      await conn.end();
    }
    await fetch(`${BRIDGE_URL}/test/reset`, { method: "POST" }).catch(() => {});
  });

  test("Module 1 & 2: Legacy V47 XC/PM parity & Central store/catalog scoping", async ({ request }) => {
    const healthRes = await request.get("/api/health");
    expect(healthRes.status()).toBe(200);
    const health = (await healthRes.json()) as {
      ok: boolean;
      mysql: { connected: boolean; tableCount: number; productCount: number };
    };
    expect(health.ok).toBe(true);
    expect(health.mysql.connected).toBe(true);
    expect(health.mysql.tableCount).toBe(37);
    expect(health.mysql.productCount).toBe(1983);

    // Compare MySQL bills.doc_type counts directly against SQL Server Scratch_DataGXHarpS1V47
    const { stdout } = await execFileAsync("sqlcmd", [
      "-S",
      "localhost",
      "-d",
      "Scratch_DataGXHarpS1V47",
      "-E",
      "-C",
      "-h",
      "-1",
      "-W",
      "-s",
      "|",
      "-Q",
      `SET NOCOUNT ON;
       SELECT XC, COUNT(*) FROM (
         SELECT RL, XC FROM dbo.HistHeader
         UNION ALL
         SELECT O.RL, O.XC FROM dbo.OfficeXHeader O WHERE NOT EXISTS (SELECT 1 FROM dbo.HistHeader H WHERE H.RL = O.RL)
       ) T GROUP BY XC ORDER BY XC;`,
    ]);
    const mssqlByXc = new Map<number, number>();
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.trim().split("|");
      if (parts.length === 2) mssqlByXc.set(Number(parts[0]), Number(parts[1]));
    }

    const [mysqlDocRows] = await conn.query(
      "SELECT doc_type, COUNT(*) AS cnt FROM bills WHERE source_table IN ('HistHeader', 'OfficeXHeader') GROUP BY doc_type",
    );
    const mysqlByDoc = new Map<string, number>();
    for (const r of mysqlDocRows as Array<{ doc_type: string; cnt: number }>) {
      mysqlByDoc.set(r.doc_type, Number(r.cnt));
    }

    expect(mysqlByDoc.get("RETAIL_SALE")).toBe(mssqlByXc.get(99));
    expect(mysqlByDoc.get("SALES_INVOICE")).toBe((mssqlByXc.get(22) ?? 0) + (mssqlByXc.get(23) ?? 0));
    expect(mysqlByDoc.get("GOODS_RECEIPT")).toBe(mssqlByXc.get(1));
    expect(mysqlByDoc.get("PURCHASE_RETURN")).toBe(mssqlByXc.get(4));
    expect(mysqlByDoc.get("SALES_RETURN")).toBe(mssqlByXc.get(9));
    expect(mysqlByDoc.get("WRITE_OFF")).toBe(mssqlByXc.get(10));
    expect(mysqlByDoc.get("PETTY_PAYOUT")).toBe(mssqlByXc.get(12));
    expect(mysqlByDoc.get("STOCK_ADJUSTMENT")).toBe(mssqlByXc.get(15));
    expect(mysqlByDoc.get("CRM_POINT_TXN")).toBe(mssqlByXc.get(54));
    expect(mysqlByDoc.get("STOCKTAKE")).toBe(mssqlByXc.get(93));

    const [pmCheck] = await conn.query(
      "SELECT COUNT(*) AS dlybal FROM bill_payments bp JOIN pay_methods pm ON pm.id = bp.pay_method_id WHERE pm.legacy_pm = 8",
    );
    expect(Number((pmCheck as Array<{ dlybal: number }>)[0]?.dlybal ?? -1)).toBe(0);

    // Staff login resolves Central shop_id=2 (SN=1) and sees all 1,983 master SKUs + Central stock
    const loginRes = await loginApi(request, { pin: "000000" });
    expect(loginRes.status()).toBe(200);
    const loginBody = (await loginRes.json()) as { user: { shopId: number; legacyId: string } };
    expect(loginBody.user.shopId).toBe(2);

    const stockView = await request.get("/api/catalog?view=stock&pageSize=10");
    expect(stockView.status()).toBe(200);
    const stockJson = (await stockView.json()) as { total: number; items: unknown[] };
    expect(stockJson.total).toBe(1983);
  });

  test("Module 6: Hardware Bridge WS/HTTP contract, 100022 recovery, & /api/octopus/settle", async ({ request }) => {
    const hRes = await fetch(`${BRIDGE_URL}/health`);
    expect(hRes.status).toBe(200);
    const hJson = await hRes.json();
    expect(BridgeEventSchema.parse(hJson).type).toBe("BRIDGE_STATUS");

    const wsText = await readSingleWebSocketFrame("ws://127.0.0.1:17889/ws");
    const wsEvent = BridgeEventSchema.parse(JSON.parse(wsText));
    expect(wsEvent.type).toBe("BRIDGE_STATUS");

    // Unauthorized rejection
    const unauthRes = await fetch(`${BRIDGE_URL}/octopus/deduct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "e2e-u1", billRef: "E2E-1", amountCents: 100 }),
    });
    expect(unauthRes.status).toBe(401);

    // 10-cent divisibility & HK$3000 max value checks
    const badCentRes = await fetch(`${BRIDGE_URL}/octopus/deduct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bridge-Token": BRIDGE_TOKEN },
      body: JSON.stringify({ requestId: "e2e-c1", billRef: "E2E-1", amountCents: 105 }),
    });
    expect(badCentRes.status).toBe(400);
    expect((await badCentRes.json()).errorCode).toBe(100099);

    const overMaxRes = await fetch(`${BRIDGE_URL}/octopus/deduct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bridge-Token": BRIDGE_TOKEN },
      body: JSON.stringify({ requestId: "e2e-m1", billRef: "E2E-1", amountCents: 300100 }),
    });
    expect(overMaxRes.status).toBe(400);
    expect((await overMaxRes.json()).errorCode).toBe(100098);

    // 100022 incomplete tap -> wrong card blocked -> same card recovered
    const lockRes = await fetch(`${BRIDGE_URL}/octopus/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bridge-Token": BRIDGE_TOKEN },
      body: JSON.stringify({
        requestId: "e2e-l1",
        billRef: "E2E-OCTO-100022",
        amountCents: 11300,
        cardId: "99887766",
        simulateOutcome: "INCOMPLETE_100022",
      }),
    });
    expect(lockRes.status).toBe(409);

    const mismatchRes = await fetch(`${BRIDGE_URL}/octopus/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bridge-Token": BRIDGE_TOKEN },
      body: JSON.stringify({
        requestId: "e2e-l2",
        billRef: "E2E-OCTO-100022",
        amountCents: 11300,
        cardId: "11112222",
        simulateOutcome: "APPROVE",
      }),
    });
    expect(mismatchRes.status).toBe(409);

    const recoverRes = await fetch(`${BRIDGE_URL}/octopus/deduct`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Bridge-Token": BRIDGE_TOKEN },
      body: JSON.stringify({
        requestId: "e2e-l3",
        billRef: "E2E-OCTO-100022",
        amountCents: 11300,
        expectedRetryCardId: "99887766",
      }),
    });
    expect(recoverRes.status).toBe(200);
    const recBody = (await recoverRes.json()) as { type: string; recoveredFrom100022: boolean };
    expect(recBody.type).toBe("OCTOPUS_APPROVED");
    expect(recBody.recoveredFrom100022).toBe(true);

    // Settle XFile through web API
    await loginApi(request, { pin: "000000" });
    const settleRes = await request.post("/api/octopus/settle", {
      data: { xfileName: "E2E-XFILE.DAT", runOsdxcExchange: false },
    });
    expect(settleRes.status()).toBe(201);
    const settleJson = (await settleRes.json()) as { xfileName: string; txnCount: number; totalCents: number };
    expect(settleJson.xfileName).toBe("E2E-XFILE.DAT");
    expect(settleJson.txnCount).toBe(1);
    expect(settleJson.totalCents).toBe(11300);
  });

  test("Module 3: Auth audit, RBAC L1 vs L5, Supervisor managerPin override, & password/PIN update", async ({
    request,
  }) => {
    const badLogin = await loginApi(request, { staffCode: "101", password: "wrong-password" });
    expect(badLogin.status()).toBe(401);
    expect((await badLogin.json()).code).toBe("003");

    // Sign in as L1 cashier (101)
    const l1Res = await loginApi(request, { pin: "111111" });
    expect(l1Res.status()).toBe(200);

    // L1 blocked from L4/L5 endpoints
    const prodDeny = await request.post("/api/products", {
      data: { barcode: "E2E-DENY", nameZh: "Denied", legacyC1: 1, sellPriceHkd: 10 },
    });
    expect(prodDeny.status()).toBe(403);

    const dayEndDeny = await request.post("/api/day-end", {
      data: { action: "CLOSE", businessDate: "2099-12-31", countedByTender: [] },
    });
    expect(dayEndDeny.status()).toBe(403);

    // L1 creates a retail sale and tries void without/with manager PIN
    const createRes = await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-rbac-${Date.now()}`,
        docType: "RETAIL_SALE",
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 1, unitPriceHkd: 113 }],
        initialPayments: [{ clientIdempotencyKey: `e2e-pmt-${Date.now()}`, tenderCode: "CASH", amountHkd: 113 }],
        notes: "E2E RBAC void test",
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()) as { invoiceNo: string };

    const voidDeny = await request.post(`/api/bills/${encodeURIComponent(created.invoiceNo)}/void`, {
      data: { reason: "L1 unauthorized attempt" },
    });
    expect(voidDeny.status()).toBe(403);

    const voidOverride = await request.post(`/api/bills/${encodeURIComponent(created.invoiceNo)}/void`, {
      data: { reason: "L1 with manager PIN", managerPin: "000000" },
    });
    expect(voidOverride.status()).toBe(200);

    // L1 changes own password + 6-digit PIN and logs in with new PIN
    const chgRes = await request.post("/api/auth/change-password", {
      data: { oldPassword: "Cashier!101", newPassword: "Cashier!New1", newPin: "222222" },
    });
    expect(chgRes.status()).toBe(200);

    const newPinLogin = await loginApi(request, { pin: "222222" });
    expect(newPinLogin.status()).toBe(200);

    // Restore 101 credentials so subsequent/filtered specs can also log in with 111111
    const resetRes = await request.post("/api/auth/change-password", {
      data: { oldPassword: "Cashier!New1", newPassword: "Cashier!101", newPin: "111111" },
    });
    expect(resetRes.status()).toBe(200);
  });

  test("Module 4, 5, 7: UBC lookup, Promotions/Rounding/CRM calculate, Hold->Resume, Amend, & Delivery", async ({
    request,
  }) => {
    await loginApi(request, { pin: "000000" });

    // UBC lookup (930100 has UBC=HCAS045)
    const ubcRes = await request.get("/api/products?exactCode=HCAS045");
    expect(ubcRes.status()).toBe(200);
    const ubcJson = (await ubcRes.json()) as { item: { sku: string } | null };
    expect(ubcJson.item?.sku).toBe("930100");

    // Member card lookup
    const [custRows] = await conn.query("SELECT id FROM customers WHERE legacy_id='2261' LIMIT 1");
    const custId = (custRows as Array<{ id: number }>)[0]!.id;
    await conn.query("INSERT INTO member_cards (customer_id, card_no, active) VALUES (?, 'E2E-CARD-777', 1)", [
      custId,
    ]);
    const custSearch = await request.get("/api/customers?q=E2E-CARD-777");
    expect(custSearch.status()).toBe(200);
    const custJson = (await custSearch.json()) as { customers: Array<{ legacyId: string; cardNo: string }> };
    expect(custJson.customers.some((c) => c.legacyId === "2261" && c.cardNo === "E2E-CARD-777")).toBe(true);

    // Promotions + Rounding + CRM calculate
    const calcRes = await request.post("/api/bills/calculate", {
      data: {
        clientIdempotencyKey: `e2e-calc-${Date.now()}`,
        docType: "RETAIL_SALE",
        customerId: custId,
        customerCurrentPoints: 0,
        roundSpec: "1U",
        promotionRules: [
          {
            id: 1,
            code: "HARP10",
            name: "10% Off C1=0",
            priority: 1,
            stackable: true,
            targetCategoryC1: [0],
            action: { type: "PERCENT_OFF", percent: 10 },
          },
        ],
        lines: [
          { sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 1, unitPriceHkd: 113 },
          { sku: "HCHP85", nameZh: "Harp", categoryC1: 3, quantity: 1, unitPriceHkd: 42120 },
        ],
      },
    });
    expect(calcRes.status()).toBe(200);
    const calcJson = (await calcRes.json()) as {
      promotions: { applied: Array<{ code: string }> };
      roundedNetAmountHkd: number;
      crm: { earnedPoints: number };
    };
    expect(calcJson.promotions.applied[0]?.code).toBe("HARP10");
    // 113 * 0.9 = 101.70 + 42120 = 42221.70 (already 10c aligned); RID=1 floor(101.7/10)=10 + RID=2 floor(42120/100)=421 => 431 pts
    expect(calcJson.roundedNetAmountHkd).toBe(42221.7);
    expect(calcJson.crm.earnedPoints).toBe(431);

    // Hold -> Resume -> Amend -> Delivery
    const holdRes = await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-hold-${Date.now()}`,
        docType: "RETAIL_SALE",
        status: "held",
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 1, unitPriceHkd: 113 }],
        notes: "E2E Hold test",
      },
    });
    expect(holdRes.status()).toBe(201);
    const held = (await holdRes.json()) as { invoiceNo: string; status: string };
    expect(held.status).toBe("held");

    // Held bill appears under view=held and must NOT have stock movements
    const heldList = await (await request.get("/api/invoices?view=held")).json();
    expect((heldList.invoices as Array<{ invoiceNo: string }>).some((b) => b.invoiceNo === held.invoiceNo)).toBe(true);

    // Resume held bill & create delivery order
    const resumeRes = await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-res-${Date.now()}`,
        docType: "RETAIL_SALE",
        status: "completed",
        supersedeInvoiceNo: held.invoiceNo,
        createDeliveryOrder: true,
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 2, unitPriceHkd: 113 }],
        initialPayments: [{ clientIdempotencyKey: `e2e-res-p-${Date.now()}`, tenderCode: "CASH", amountHkd: 226 }],
        notes: "E2E Resumed Delivery",
      },
    });
    expect(resumeRes.status()).toBe(201);
    const resumed = (await resumeRes.json()) as { invoiceNo: string };

    // Confirm delivery
    const delivRes = await request.post(`/api/bills/${encodeURIComponent(resumed.invoiceNo)}/delivery`);
    expect(delivRes.status()).toBe(200);
    expect((await delivRes.json()).deliveryStatus).toBe("delivered");
  });

  test("Module 9 & 10: All OfficeX docTypes, moving-avg cost, signed adjustment void, & Stocktake XC=93", async ({
    request,
  }) => {
    await loginApi(request, { pin: "000000" });

    const prodRes = await request.post("/api/products", {
      data: { barcode: "E2E-SKU-01", nameZh: "E2E 測試豎琴弦", nameEn: "E2E Harp String", legacyC1: 1, sellPriceHkd: 120 },
    });
    expect(prodRes.status()).toBe(201);
    const prodId = ((await prodRes.json()) as { id: number }).id;

    const postOffice = async (
      docType: string,
      qty: number,
      price: number,
      adjustmentDirection: 1 | -1 = 1,
    ) => {
      const r = await request.post("/api/office-txn", {
        data: {
          clientIdempotencyKey: `e2e-off-${docType}-${Date.now()}-${Math.random()}`,
          docType,
          reference: "E2E-REF",
          lines: [{ sku: "E2E-SKU-01", nameZh: "E2E 測試豎琴弦", categoryC1: 1, quantity: qty, unitPriceHkd: price, adjustmentDirection }],
        },
      });
      expect(r.status()).toBe(201);
      return (await r.json()) as { invoiceNo: string };
    };

    const getStockQtyCost = async () => {
      const r = await request.get("/api/stock?q=E2E-SKU-01");
      const d = (await r.json()) as { items: Array<{ productId: number; onHandQty: number; movingAvgCostHkd: number }> };
      return d.items.find((i) => i.productId === prodId)!;
    };

    await postOffice("GOODS_RECEIPT", 10, 50); // qty=10, avgCost=50
    await postOffice("GOODS_RECEIPT", 10, 70); // qty=20, avgCost=60
    expect((await getStockQtyCost()).onHandQty).toBe(20);
    expect((await getStockQtyCost()).movingAvgCostHkd).toBe(60);

    await postOffice("PURCHASE_RETURN", 2, 70); // qty=18
    await postOffice("STOCK_TRANSFER_OUT", 3, 60); // qty=15
    await postOffice("STOCK_TRANSFER_IN", 4, 60); // qty=19
    await postOffice("WRITE_OFF", 1, 60); // qty=18
    await postOffice("STOCK_ADJUSTMENT", 5, 60, 1); // qty=23
    const negAdj = await postOffice("STOCK_ADJUSTMENT", 2, 60, -1); // qty=21
    expect((await getStockQtyCost()).onHandQty).toBe(21);

    // Void negative adjustment -> restores +2 => 23
    const voidAdjRes = await request.post(`/api/bills/${encodeURIComponent(negAdj.invoiceNo)}/void`, {
      data: { reason: "E2E void neg adj" },
    });
    expect(voidAdjRes.status()).toBe(200);
    expect((await getStockQtyCost()).onHandQty).toBe(23);

    // Stocktake XC=93 -> set countedQty=20 (delta -3)
    const stRes = await request.post("/api/stock", {
      data: {
        operationType: "STOCKTAKE",
        remarks: "E2E Stocktake XC=93",
        lines: [{ productId: prodId, quantityOrCount: 20 }],
      },
    });
    expect(stRes.status()).toBe(201);
    expect((await getStockQtyCost()).onHandQty).toBe(20);

    // Petty payout voucher
    const payRes = await postOffice("PETTY_PAYOUT", 1, 35);
    expect(payRes.invoiceNo.startsWith("PAY-")).toBe(true);

    // Movement ledger check
    const movRes = await request.get(`/api/stock?productId=${prodId}`);
    expect(movRes.status()).toBe(200);
    const movJson = (await movRes.json()) as { movements: Array<{ movementType: string }> };
    expect(movJson.movements.some((m) => m.movementType === "STOCKTAKE")).toBe(true);
    expect(movJson.movements.some((m) => m.movementType === "PURCHASE_RETURN")).toBe(true);
    expect(movJson.movements.some((m) => m.movementType === "TRANSFER_IN")).toBe(true);
  });

  test("Module 11 & 12: Signed Day-End on 2099-12-31, sealed lockout, & Manager/Operational reports", async ({
    request,
  }) => {
    await loginApi(request, { pin: "000000" });
    const testDate = "2099-12-31";

    // Opening float
    const floatRes = await request.post("/api/day-end", {
      data: { action: "SET_FLOAT", businessDate: testDate, amountHkd: 1500 },
    });
    expect(floatRes.status()).toBe(200);

    // 1. Retail Sale $200 Cash
    await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-de-1-${Date.now()}`,
        docType: "RETAIL_SALE",
        businessDateOverride: testDate,
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 2, unitPriceHkd: 100 }],
        initialPayments: [{ clientIdempotencyKey: `e2e-dep-1-${Date.now()}`, tenderCode: "CASH", amountHkd: 200 }],
      },
    });

    // 2. Sales Invoice $500 with $100 Bank Transfer deposit (AR balance $400)
    const invRes = await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-de-2-${Date.now()}`,
        docType: "SALES_INVOICE",
        businessDateOverride: testDate,
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 5, unitPriceHkd: 100 }],
        initialPayments: [{ clientIdempotencyKey: `e2e-dep-2-${Date.now()}`, tenderCode: "BANK_XFER", amountHkd: 100 }],
      },
    });
    const invNo = ((await invRes.json()) as { invoiceNo: string }).invoiceNo;

    // 3. Sales Return $50 Cash refund
    await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-de-3-${Date.now()}`,
        docType: "SALES_RETURN",
        businessDateOverride: testDate,
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 1, unitPriceHkd: 50 }],
        initialPayments: [{ clientIdempotencyKey: `e2e-dep-3-${Date.now()}`, tenderCode: "CASH", amountHkd: 50 }],
      },
    });

    // 4. Petty Payout $30 Cash
    await request.post("/api/office-txn", {
      data: {
        clientIdempotencyKey: `e2e-de-4-${Date.now()}`,
        docType: "PETTY_PAYOUT",
        businessDateOverride: testDate,
        reference: "E2E Taxi",
        lines: [{ sku: "TAXI", nameZh: "Courier", categoryC1: 0, quantity: 1, unitPriceHkd: 30 }],
      },
    });

    const previewRes = await request.get(`/api/day-end?date=${testDate}`);
    expect(previewRes.status()).toBe(200);
    const preview = (await previewRes.json()) as {
      openingFloatHkd: number;
      billCount: number;
      issuedSalesTotalHkd: number;
      unpaidIssuedBalanceHkd: number;
      collectedByTender: Array<{ tenderCode: string; collectedAmountHkd: number }>;
    };
    expect(preview.openingFloatHkd).toBe(1500);
    expect(preview.billCount).toBe(3); // excludes PETTY_PAYOUT
    expect(preview.issuedSalesTotalHkd).toBe(650); // 200 + 500 - 50
    expect(preview.unpaidIssuedBalanceHkd).toBe(400);
    const cashRow = preview.collectedByTender.find((t) => t.tenderCode === "CASH");
    const bankRow = preview.collectedByTender.find((t) => t.tenderCode === "BANK_XFER");
    expect(cashRow?.collectedAmountHkd).toBe(120); // 200 - 50 - 30
    expect(bankRow?.collectedAmountHkd).toBe(100);

    // Reports parity on 2099-12-31
    const [hourlyRes, itemRes, histRes, opsRes] = await Promise.all([
      request.get(`/api/reports/hourly?date=${testDate}`),
      request.get(`/api/reports/items?date=${testDate}`),
      request.get(`/api/reports/history?from=${testDate}&to=${testDate}`),
      request.get(`/api/reports?from=${testDate}&to=${testDate}`),
    ]);
    expect((await hourlyRes.json()).totalSalesHkd).toBe(650);
    expect((await itemRes.json()).totalSalesHkd).toBe(650);
    expect((await histRes.json()).days[0].netSalesHkd).toBe(650);
    const opsJson = (await opsRes.json()) as { salesByTender: Array<{ tenderCode: string; totalHkd: number }> };
    expect(opsJson.salesByTender.find((t) => t.tenderCode === "CASH")?.totalHkd).toBe(120);

    // Close Day-End batch
    const closeRes = await request.post("/api/day-end", {
      data: {
        action: "CLOSE",
        businessDate: testDate,
        countedByTender: [
          { tenderCode: "CASH", countedAmountHkd: 120 },
          { tenderCode: "BANK_XFER", countedAmountHkd: 100 },
        ],
      },
    });
    expect(closeRes.status()).toBe(201);

    // Sealed date rejects new bills & voids
    const blockedBill = await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-de-sealed-${Date.now()}`,
        docType: "RETAIL_SALE",
        businessDateOverride: testDate,
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 1, unitPriceHkd: 100 }],
        initialPayments: [{ clientIdempotencyKey: `e2e-de-sp-${Date.now()}`, tenderCode: "CASH", amountHkd: 100 }],
      },
    });
    expect(blockedBill.status()).toBe(422);

    const blockedVoid = await request.post(`/api/bills/${encodeURIComponent(invNo)}/void`, {
      data: { reason: "Should fail on sealed date" },
    });
    expect(blockedVoid.status()).toBe(422);
  });

  test("Second-Pass Parity: Suppliers master, extended Product/Card fields, Bill Query filters, Salesperson stats, & Worker check", async ({
    request,
  }) => {
    // 1. Suppliers GET (76 migrated V47 suppliers) + RBAC L1 403 vs L5 201
    await loginApi(request, { pin: "111111" });
    const supGet = await request.get("/api/suppliers");
    expect(supGet.status()).toBe(200);
    const supJson = (await supGet.json()) as { suppliers: Array<{ legacyId: string }>; total: number };
    expect(supJson.total).toBe(76);

    const supDeny = await request.post("/api/suppliers", {
      data: { nameZh: "E2E Denied Supplier" },
    });
    expect(supDeny.status()).toBe(403);

    await loginApi(request, { pin: "000000" });
    const supCreate = await request.post("/api/suppliers", {
      data: { legacyId: "E2E-SUP-99", nameZh: "E2E 測試供應商", nameEn: "E2E Supplier Co", phone: "25551234" },
    });
    expect(supCreate.status()).toBe(201);

    // 2. Product upsert with UBC, fixedPriceHkd, allowItemDiscount, excludeFromCrmBonus
    const prodPost = await request.post("/api/products", {
      data: {
        barcode: "E2E-EXT-01",
        ubc: "E2E-UBC-88",
        nameZh: "E2E 固定價配件",
        nameEn: "E2E Fixed Accessory",
        legacyC1: 1,
        sellPriceHkd: 320,
        fixedPriceHkd: 300,
        allowItemDiscount: false,
        excludeFromCrmBonus: true,
      },
    });
    expect(prodPost.status()).toBe(201);
    const exactUbc = await (await request.get("/api/products?exactCode=E2E-UBC-88")).json();
    expect(exactUbc.item.sku).toBe("E2E-EXT-01");
    expect(exactUbc.item.fixedPriceHkd).toBe(300);
    expect(exactUbc.item.isFixedPrice).toBe(true);
    expect(exactUbc.item.allowItemDiscount).toBe(false);
    expect(exactUbc.item.excludeFromCrmBonus).toBe(true);

    // 3. Customer cardNo assignment & lookup
    const [custRows] = await conn.query("SELECT id FROM customers WHERE legacy_id='2261' LIMIT 1");
    const custId = (custRows as Array<{ id: number }>)[0]!.id;
    const custUpdate = await request.post("/api/customers", {
      data: { id: custId, nameZh: "Yeung Kam Yan", cardNo: "E2E-MEMBER-888" },
    });
    expect(custUpdate.status()).toBe(201);
    const custCardSearch = await (await request.get("/api/customers?q=E2E-MEMBER-888")).json();
    expect(custCardSearch.customers.some((c: { legacyId: string; cardNo: string }) => c.legacyId === "2261" && c.cardNo === "E2E-MEMBER-888")).toBe(true);

    // 4. Salesperson attribution & extended Bill Query filters + Manager stats report
    const [staff101] = await conn.query("SELECT id FROM staff WHERE legacy_id='101' LIMIT 1");
    const salespersonId = (staff101 as Array<{ id: number }>)[0]!.id;
    const spBillRes = await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-sp-${Date.now()}`,
        docType: "RETAIL_SALE",
        businessDateOverride: "2099-12-30",
        salespersonId,
        customerId: custId,
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 1, unitPriceHkd: 113 }],
        initialPayments: [{ clientIdempotencyKey: `e2e-spp-${Date.now()}`, tenderCode: "CASH", amountHkd: 113 }],
        notes: "E2E-SALESPERSON-QUERY",
      },
    });
    expect(spBillRes.status()).toBe(201);
    const spBill = (await spBillRes.json()) as { invoiceNo: string };

    // Deposit / Unpaid invoice for subFilter=deposit check
    const depInvRes = await request.post("/api/bills", {
      data: {
        clientIdempotencyKey: `e2e-depq-${Date.now()}`,
        docType: "SALES_INVOICE",
        businessDateOverride: "2099-12-30",
        lines: [{ sku: "210810", nameZh: "CD", categoryC1: 0, quantity: 2, unitPriceHkd: 113 }],
        initialPayments: [],
        notes: "E2E-DEPOSIT-QUERY",
      },
    });
    expect(depInvRes.status()).toBe(201);
    const depInv = (await depInvRes.json()) as { invoiceNo: string };

    const qMatch = await (
      await request.get("/api/invoices?view=today&date=2099-12-30&q=E2E-SALESPERSON-QUERY&subFilter=completed")
    ).json();
    expect((qMatch.invoices as Array<{ invoiceNo: string }>).some((b) => b.invoiceNo === spBill.invoiceNo)).toBe(true);

    const depMatch = await (
      await request.get("/api/invoices?view=today&date=2099-12-30&subFilter=deposit")
    ).json();
    expect((depMatch.invoices as Array<{ invoiceNo: string }>).some((b) => b.invoiceNo === depInv.invoiceNo)).toBe(true);

    const last30Match = await (
      await request.get("/api/invoices?view=today&date=ALL&subFilter=last30")
    ).json();
    expect((last30Match.invoices as unknown[]).length).toBeLessThanOrEqual(30);

    // Void one and check subFilter=cancelled
    expect(
      (await request.post(`/api/bills/${encodeURIComponent(depInv.invoiceNo)}/void`, { data: { reason: "客人取消" } })).status(),
    ).toBe(200);
    const cancelMatch = await (
      await request.get("/api/invoices?view=today&date=2099-12-30&subFilter=cancelled")
    ).json();
    expect((cancelMatch.invoices as Array<{ invoiceNo: string }>).some((b) => b.invoiceNo === depInv.invoiceNo)).toBe(true);

    // Manager stats report on 2099-12-30
    const statsRes = await request.get("/api/reports?view=stats&from=2099-12-30&to=2099-12-30");
    expect(statsRes.status()).toBe(200);
    const stats = (await statsRes.json()) as {
      customerStats: Array<{ legacyId: string; netSpendHkd: number }>;
      staffStats: Array<{ legacyId: string; netSalesHkd: number }>;
      docTypeStats: Array<{ docType: string; docCount: number }>;
    };
    expect(stats.customerStats.some((c) => c.legacyId === "2261" && c.netSpendHkd === 113)).toBe(true);
    expect(stats.staffStats.some((s) => s.legacyId === "101" && s.netSalesHkd === 113)).toBe(true);
    expect(stats.docTypeStats.some((d) => d.docType === "RETAIL_SALE" && d.docCount >= 1)).toBe(true);

    // 5. Worker scheduled health & check (real worker CLI execution)
    const dotEnv = loadRootDotEnv();
    const { stdout: workerStdout } = await execFileAsync(
      process.execPath,
      ["./node_modules/tsx/dist/cli.mjs", "apps/worker/src/index.ts"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...dotEnv,
          DATABASE_URL: dotEnv.DATABASE_URL ?? process.env.DATABASE_URL ?? "",
          MIGRATE_DATABASE_URL: dotEnv.MIGRATE_DATABASE_URL ?? dotEnv.DATABASE_URL ?? "",
        },
      },
    );
    const workerOut = JSON.parse(workerStdout) as {
      service: string;
      mysql: { connected: boolean; productCount: number };
      scheduledTasks: unknown[];
    };
    const [prodCountRows] = await conn.query("SELECT COUNT(*) AS cnt FROM products");
    const expectedProductCount = Number((prodCountRows as Array<{ cnt: number }>)[0]?.cnt ?? 0);
    expect(workerOut.service).toBe("@hkharp/worker");
    expect(workerOut.mysql.connected).toBe(true);
    expect(workerOut.mysql.productCount).toBe(expectedProductCount);
    expect(workerOut.scheduledTasks).toHaveLength(4);
  });
});

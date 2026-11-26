import { test, expect, type Page } from "@playwright/test";
import type { Connection } from "mysql2/promise";
import { captureDbSnapshot, openE2eMysqlConnection, restoreDbSnapshot, type DbSnapshot } from "./helpers/cleanup";

const BRIDGE_URL = "http://127.0.0.1:17889";
const unloadHandledPages = new WeakSet<Page>();

async function openCashierHome(page: Page) {
  if (!unloadHandledPages.has(page)) {
    unloadHandledPages.add(page);
    page.on("dialog", (dialog) => {
      if (dialog.type() === "beforeunload") {
        void dialog.accept();
      }
    });
  }
  await page.goto("/");
  await expect(page.getByPlaceholder("條碼", { exact: true })).toBeVisible();
}

async function enterBarcodeOnPos(page: Page, code: string) {
  const input = page.getByPlaceholder("條碼", { exact: true });
  await input.fill(code);
  await input.press("Enter");
}

test.describe("UI Workflows: Classic POS, AR Invoices & Back Office (Real Chrome)", () => {
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

  test("UI 1: Startup Cashier Homepage (/) without login (no portal) -> /login redirect -> Barcode/UBC -> Split Tender & Drawer Kick", async ({
    page,
  }) => {
    await openCashierHome(page);
    await expect(page.getByText("Central(1)")).toBeVisible();
    await expect(page.getByText("Morris", { exact: true })).toBeVisible();
    await expect(page.getByText("Migrated Catalog SKUs")).toHaveCount(0);
    await expect(page.getByText("1. Open POS Counter")).toHaveCount(0);

    // /login redirects back to Cashier homepage (/) when login is disabled
    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByPlaceholder("條碼", { exact: true })).toBeVisible();

    // Unknown barcode -> 017 modal
    await enterBarcodeOnPos(page, "NO-SUCH-999");
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 017" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 017" }).getByRole("button", { name: "離開" }).click();

    // Fixed-price SKU 350104-001 -> discount triggers 026 modal
    await enterBarcodeOnPos(page, "350104-001");
    await expect(page.locator("tbody tr", { hasText: "350104-001" })).toBeVisible();
    await page.getByRole("button", { name: /項折/ }).click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 026" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 026" }).getByRole("button", { name: "離開" }).click();
    await page.getByRole("button", { name: "取消項目" }).click();

    // UBC lookup (HCAS045 -> 930100) + 選價 (025) + 數量 + 項折 + 改價 + 重選
    await enterBarcodeOnPos(page, "HCAS045");
    await expect(page.locator("tbody tr", { hasText: "930100" })).toBeVisible();
    await page.getByRole("button", { name: /選價/ }).click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 025" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 025" }).getByRole("button", { name: "離開" }).click();
    await page.getByPlaceholder("條碼", { exact: true }).fill("2");
    await page.getByRole("button", { name: /數量/ }).click();
    await expect(page.locator("tbody tr", { hasText: "930100" })).toContainText("2");
    await page.getByRole("button", { name: /項折/ }).click();
    await expect(page.locator("tbody tr", { hasText: "930100" })).toContainText("5");
    await page.getByRole("button", { name: "取消項目" }).click();

    // Split Tender: 210810 x2 ($226.00) -> Cash $100 split + MasterCard $126 -> Drawer kick + Receipt preview
    await enterBarcodeOnPos(page, "210810");
    await page.getByPlaceholder("條碼", { exact: true }).fill("2");
    await page.getByRole("button", { name: /數量/ }).click();
    await page.getByRole("button", { name: /方法/ }).click();
    await page.getByRole("button", { name: /現金/ }).click();
    await page.getByPlaceholder("條碼", { exact: true }).fill("100");
    await page.getByRole("button", { name: /加入部分付款/ }).click();
    await expect(page.getByText("HK$126.00").first()).toBeVisible();

    await page.getByRole("button", { name: "支付寶", exact: true }).click();
    await page.getByLabel("批核碼").fill("AUTH88");
    await page.getByLabel("卡號尾四位").fill("4321");
    await page.locator('button[title="完成"]').click();

    const okDialog = page.getByRole("dialog", { name: "營運通訊息 - 000" });
    await expect(okDialog).toBeVisible();
    const bridgeState = await (await fetch(`${BRIDGE_URL}/test/state`)).json();
    expect(bridgeState.drawerOpens.some((d: { reason: string }) => d.reason === "CASH_SALE")).toBe(true);

    await okDialog.getByRole("button", { name: "收據預覽" }).click();
    await page.waitForURL("**/invoices/**/print");
    await expect(page.getByText("210810")).toBeVisible();
    await expect(page.getByText("MASTERCARD")).toBeVisible();
  });

  test("UI 2: Hold/Recall (暫停單), Amend (修改), & Delivery Order (送貨 -> 提貨)", async ({ page }) => {
    await openCashierHome(page);

    // Hold bill via legacy 重選 -> fmholdbill (擱置 / 取消功能) -> 擱置本單
    await enterBarcodeOnPos(page, "210810");
    await page.locator('button[title="重選"]').click();
    const holdDlg = page.getByRole("dialog", { name: "擱置 / 取消功能" });
    await expect(holdDlg).toBeVisible();
    await holdDlg.getByRole("button", { name: "擱置本單", exact: true }).click();
    await expect(page.getByText(/暫停單 .* 已儲存/)).toBeVisible();

    // Recall held bill via 查單 [暫停單] -> 修改 -> 送貨 -> 完成
    await page.locator('button[title="查單"]').first().click();
    const queryDlg = page.getByRole("dialog", { name: "查單" });
    await expect(queryDlg).toBeVisible();
    await queryDlg.getByRole("button", { name: "暫停單" }).click();
    await expect(queryDlg.locator("tbody tr", { hasText: "POS-" }).first()).toBeVisible();
    await queryDlg.getByRole("button", { name: "修改" }).click();
    await expect(page.locator("tbody tr", { hasText: "210810" })).toBeVisible();

    await page.getByRole("button", { name: /送貨/ }).click();
    await page.locator('button[title="完成"]').click();
    const okDlg = page.getByRole("dialog", { name: "營運通訊息 - 000" });
    await expect(okDlg).toBeVisible();
    await okDlg.getByRole("button", { name: "離開" }).click();

    // Check 查單 [未處理單] -> 提貨
    await page.locator('button[title="查單"]').first().click();
    await expect(queryDlg).toBeVisible();
    await queryDlg.getByRole("button", { name: "未處理單" }).click();
    await expect(queryDlg.locator("tbody tr", { hasText: "POS-" }).first()).toBeVisible();
    await queryDlg.getByRole("button", { name: "選單接收" }).click();
    await expect(queryDlg.getByText("提貨狀態：已提貨")).toBeVisible();
    await queryDlg.getByRole("button", { name: "離開" }).click();
  });

  test("UI 3: CRM Member Voucher 044 guard & Octopus 100022 Lock -> Same-Card Recovery", async ({ page }) => {
    await openCashierHome(page);

    // Select 0-point customer 2261 (Yeung Kam Yan) + add HCOS001 -> triggers 044 modal
    await page.getByRole("button", { name: /會員/ }).click();
    await page.getByPlaceholder("搜尋", { exact: false }).fill("Yeung Kam Yan");
    await page.locator("tbody tr", { hasText: "Yeung Kam Yan" }).first().click();
    await enterBarcodeOnPos(page, "HCOS001");
    await page.locator('button[title="完成"]').click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 044" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 044" }).getByRole("button", { name: "離開" }).click();

    // Clear voucher (already selected by addItem) & deselect member
    await page.getByRole("button", { name: "取消項目" }).click();
    await page.locator("tbody tr", { hasText: "Yeung Kam Yan" }).first().click();

    // Octopus 100022 UI flow
    await enterBarcodeOnPos(page, "210810");
    await page.getByRole("button", { name: /方法/ }).click();
    await page.getByRole("button", { name: /八達通/ }).click();
    await page.getByRole("button", { name: "測試 100022" }).click();
    await expect(page.getByText(/請勿取消交易/)).toBeVisible();

    // Attempting submit while locked triggers msg 100
    await page.locator('button[title="完成"]').click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 100" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 100" }).getByRole("button", { name: "離開" }).click();

    // Retry same card -> approved -> submit succeeds
    await page.getByRole("button", { name: "拍卡收費" }).click();
    await expect(page.getByText(/已批准：卡/)).toBeVisible();
    await page.locator('button[title="完成"]').click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 000" })).toBeVisible();
  });

  test("UI 4: Issue Invoice (付款一) -> /invoices Partial Bank Transfer & Final Cheque -> Print", async ({
    page,
  }) => {
    await openCashierHome(page);
    await enterBarcodeOnPos(page, "210810");
    await page.getByPlaceholder("條碼", { exact: true }).fill("2");
    await page.getByRole("button", { name: /數量/ }).click();
    await page.getByRole("button", { name: /方法/ }).click();
    await page.getByRole("button", { name: /付款一/ }).click();
    await page.locator('button[title="完成"]').click();

    const okDlg = page.getByRole("dialog", { name: "營運通訊息 - 000" });
    await expect(okDlg).toBeVisible();
    const dlgText = await okDlg.innerText();
    const match = dlgText.match(/INV-\d+-\d+/);
    expect(match).not.toBeNull();
    const invoiceNo = match![0];

    await page.goto("/invoices");
    await page.getByRole("button", { name: new RegExp(invoiceNo) }).click();
    await page.locator("select").selectOption("BANK_XFER");
    await page.locator('input[type="number"]').fill("100");
    await page.getByPlaceholder(/HSBC-TT/).fill("E2E-HSBC-01");
    await page.getByRole("button", { name: "Post Settlement Payment" }).click();
    await expect(page.getByText(/Status: PARTIAL/)).toBeVisible();

    await page.locator("select").selectOption("CHEQUE");
    await page.locator('input[type="number"]').fill("126");
    await page.getByPlaceholder(/HSBC-TT/).fill("E2E-CHQ-02");
    await page.getByRole("button", { name: "Post Settlement Payment" }).click();
    await expect(page.getByText(/Status: PAID/)).toBeVisible();

    await page.goto(`/invoices/${encodeURIComponent(invoiceNo)}/print`);
    await expect(page.getByText(invoiceNo).first()).toBeVisible();
    await expect(page.getByText(/E2E-HSBC-01/)).toBeVisible();
    await expect(page.getByText(/E2E-CHQ-02/)).toBeVisible();
  });

  test("UI 5: POS Modals (其他交易, 存貨+盤點+CSV, 收銀員, 經理 Reports+CSV) & Back Office Pages", async ({
    page,
  }) => {
    await openCashierHome(page);

    // 1. 其他交易 (legacy VMXact1 menu: 離開, 到貨, 退貨, 轉出, 報銷, 調整, Payout -> open panel -> 轉入)
    await page.getByRole("button", { name: /其他交易/ }).click();
    for (const lbl of ["到貨", "退貨", "轉出", "報銷", "調整", "Payout"]) {
      await expect(page.getByRole("button", { name: lbl, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "轉出", exact: true }).click();
    const officeDlg = page.getByRole("dialog", { name: "其他交易" });
    await expect(officeDlg).toBeVisible();
    await officeDlg.getByRole("button", { name: "轉入", exact: true }).click();
    await officeDlg.getByPlaceholder("搜尋條碼 / 貨品").fill("210810");
    await officeDlg.locator("button", { hasText: "210810" }).first().click();
    await officeDlg.getByRole("button", { name: "完成" }).click();
    await expect(officeDlg.getByText(/已完成並落庫/)).toBeVisible();
    await officeDlg.getByRole("button", { name: "離開" }).click();

    // 2. 存貨 -> 1,983 items, CSV export, movement modal, 盤點模式
    await page.locator('button[title="存貨"]').click();
    const stockDlg = page.getByRole("dialog", { name: "存貨" });
    await expect(stockDlg).toContainText("共 1983 項");
    const [stockDl] = await Promise.all([
      page.waitForEvent("download"),
      stockDlg.getByRole("button", { name: "產生 Excel", exact: true }).click(),
    ]);
    expect(stockDl.suggestedFilename()).toBe("stock-balances.csv");
    await stockDlg.locator("tbody tr", { hasText: "210810" }).first().click();
    const movDlg = page.getByRole("dialog", { name: "存貨異動明細" });
    await expect(movDlg).toBeVisible();
    await movDlg.getByRole("button", { name: "關閉" }).click();
    await stockDlg.getByRole("button", { name: "輸入點存" }).click();
    await stockDlg.locator("tbody tr", { hasText: "210810" }).first().locator('input[type="number"]').fill("5");
    await stockDlg.getByRole("button", { name: "確認盤點 (XC=93)" }).click();
    await expect(stockDlg.getByText(/已完成 1 項盤點更新/)).toBeVisible();
    await stockDlg.getByRole("button", { name: "離開" }).click();

    // 3. 收銀員 (VMCash1: 離開, 銀頭, 開柜, 轉更/日結, 上數落價) & 經理 (VMMgr1: 離開, 印表機設定, 維修, 更改密碼)
    await page.locator('button[title="收銀員"]').click();
    await page.getByRole("button", { name: "開柜", exact: true }).click();
    await expect(page.getByText("錢柜已開啟（No Sale）")).toBeVisible();
    await page.getByRole("button", { name: "銀頭", exact: true }).click();
    const floatDlg = page.getByRole("dialog", { name: "銀頭設定" });
    await floatDlg.locator('input[type="number"]').fill("1800");
    await floatDlg.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByText("今日銀頭已設定為 HK$1,800.00")).toBeVisible();
    await page.locator('button[title="經理"]').click();
    await page.getByRole("button", { name: "印表機設定", exact: true }).click();
    const prtDlg = page.getByRole("dialog", { name: "印表機設定" });
    await prtDlg.getByRole("button", { name: "套用", exact: true }).click();
    await expect(prtDlg.getByText("印表機設定已儲存")).toBeVisible();
    await prtDlg.getByRole("button", { name: "離開" }).click();

    // 4. 營業數據 (VMBData1) -> 時飛 inline + tabular 時報 CSV export
    await page.locator('button[title="營業數據"]').click();
    await page.getByRole("button", { name: "時飛", exact: true }).click();
    await expect(page.getByText("總銷售收入")).toBeVisible();
    await page.getByRole("button", { name: "報表圖示" }).click();
    const repDlg = page.getByRole("dialog", { name: "時報" });
    await expect(repDlg).toBeVisible();
    const [repDl] = await Promise.all([
      page.waitForEvent("download"),
      repDlg.getByRole("button", { name: "匯出 CSV" }).click(),
    ]);
    expect(repDl.suggestedFilename()).toMatch(/^hourly-/);
    await repDlg.getByRole("button", { name: "離開" }).click();
    await page.locator('button[title="零售"]').click();

    // 5. Back Office pages
    await page.goto("/backoffice/customers");
    await expect(page.getByText("CRM Customers & Bonus Points")).toBeVisible();
    await page.locator("tbody tr").first().click();
    await expect(page.getByText("Recent Point Ledger")).toBeVisible();

    await page.goto("/backoffice/products");
    await expect(page.getByText("Catalog Masters")).toBeVisible();

    await page.goto("/backoffice/reports");
    await expect(page.getByText(/營運通報表中心/)).toBeVisible();
    await expect(page.getByText(/營運通報表\s+版權©2001-2009。/)).toBeVisible();

    await page.goto("/backoffice/settings");
    await expect(page.getByText("Invoice & Terminal Settings")).toBeVisible();

    await page.goto("/backoffice/day-end");
    await page.locator('input[type="date"]').fill("2099-12-31");
    await page.getByRole("button", { name: "重新計算" }).click();
    await expect(page.getByText("開櫃銀頭")).toBeVisible();
  });

  test("UI 6: Open-Price 改價, Salesperson/Promo Presets, Offline Outbox Replay, Enhanced 查單, Manager 營業統計, Suppliers, Barcode Label & 80mm/A4 Print", async ({
    page,
  }) => {
    await openCashierHome(page);

    // 1. Open-price SKU HCHP69 ($0.00 -> 38000 via 改價) + fixed-price 350104-001 -> 026 modal
    await enterBarcodeOnPos(page, "HCHP69");
    await expect(page.locator("tbody tr", { hasText: "HCHP69" })).toBeVisible();
    await page.getByPlaceholder("條碼", { exact: true }).fill("38000");
    await page.getByRole("button", { name: /改價/ }).click();
    await expect(page.locator("tbody tr", { hasText: "HCHP69" })).toContainText("HK$38,000.00");
    await page.getByRole("button", { name: "取消項目" }).click();

    await enterBarcodeOnPos(page, "350104-001");
    await page.getByPlaceholder("條碼", { exact: true }).fill("200");
    await page.getByRole("button", { name: /改價/ }).click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 026" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 026" }).getByRole("button", { name: "離開" }).click();
    await page.getByRole("button", { name: "取消項目" }).click();

    // 2. Select salesperson in 職員 panel & apply VIP 9折 (10%) preset in 優惠 panel
    await enterBarcodeOnPos(page, "210810");
    await page.getByRole("button", { name: /職員/ }).click();
    await expect(page.locator("tbody tr", { hasText: "101" }).first()).toBeVisible();
    await page.locator("tbody tr", { hasText: "101" }).first().click();
    await expect(page.getByText(/銷售員：/)).toBeVisible();

    await page.getByRole("button", { name: /優惠/ }).click();
    await page.getByRole("button", { name: "VIP 9折 (10%)" }).click();
    await expect(page.locator("tbody tr", { hasText: "210810" })).toContainText("HK$101.70");

    // 3. Offline Outbox queue (abort /api/bills -> 999 -> unroute -> 離線單據重送 (1))
    await page.route("**/api/bills", (route) => route.abort("failed"));
    await page.locator('button[title="完成"]').click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 999" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 999" }).getByRole("button", { name: "離開" }).click();
    await page.unroute("**/api/bills");

    await page.locator('button[title="收銀員"]').click();
    await page.getByRole("button", { name: /離線單據重送 \(1\)/ }).click();
    await expect(page.getByText("已重送 1 筆離線單據，剩餘 0 筆")).toBeVisible();

    // 4. Enhanced 查單: search VIP, filter 完成單, void with 客人取消 preset -> filter 取消單
    await page.locator('button[title="查單"]').first().click();
    const queryDlg = page.getByRole("dialog", { name: "查單" });
    await expect(queryDlg).toBeVisible();
    await queryDlg.getByRole("button", { name: "搜尋", exact: true }).click();
    await queryDlg.getByPlaceholder("搜尋單號 / 會員 / 電話").fill("VIP");
    await queryDlg.getByRole("button", { name: "執行搜尋" }).click();
    await queryDlg.getByRole("button", { name: "返回", exact: true }).click();
    await queryDlg.getByRole("button", { name: "完成單", exact: true }).click();
    await expect(queryDlg.locator("tbody tr", { hasText: "POS-" }).first()).toBeVisible();

    await queryDlg.getByRole("button", { name: "取消", exact: true }).click();
    await queryDlg.getByRole("button", { name: "客人取消", exact: true }).click();
    await queryDlg.getByRole("button", { name: "確定取消單" }).click();
    await queryDlg.getByRole("button", { name: "取消單", exact: true }).click();
    await expect(queryDlg.locator("tbody tr", { hasText: "已取消" }).first()).toBeVisible();
    await queryDlg.getByRole("button", { name: "離開" }).click();

    // 5. 營業數據 -> 歷史數據 -> 職員統計 (inline stats + ManagerStatsReport modal) + CSV export
    await page.locator('button[title="營業數據"]').click();
    await page.getByRole("button", { name: "歷史數據", exact: true }).click();
    await page.getByRole("button", { name: "職員統計", exact: true }).click();
    await expect(page.getByText("職員統計 - 本店")).toBeVisible();
    await page.getByRole("button", { name: "明細表", exact: true }).click();
    const statsDlg = page.getByRole("dialog", { name: "營業統計" });
    await expect(statsDlg).toBeVisible();
    await statsDlg.getByRole("button", { name: "職員統計" }).click();
    await statsDlg.getByRole("button", { name: "交易及損耗紀錄" }).click();
    const [statsDl] = await Promise.all([
      page.waitForEvent("download"),
      statsDlg.getByRole("button", { name: "匯出 CSV" }).click(),
    ]);
    expect(statsDl.suggestedFilename()).toMatch(/^stats-/);
    await statsDlg.getByRole("button", { name: "離開" }).click();
    await page.locator('button[title="零售"]').click();

    // 6. 其他交易 -> 到貨 -> select migrated supplier -> post
    await page.getByRole("button", { name: /其他交易/ }).click();
    await page.getByRole("button", { name: "到貨", exact: true }).click();
    const officeDlg = page.getByRole("dialog", { name: "其他交易" });
    await expect(officeDlg).toBeVisible();
    await expect(officeDlg.locator('select[aria-label="供應商"] option')).not.toHaveCount(1);
    await officeDlg.getByLabel("供應商", { exact: true }).selectOption({ index: 1 });
    await officeDlg.getByPlaceholder("搜尋條碼 / 貨品").fill("210810");
    await officeDlg.locator("button", { hasText: "210810" }).first().click();
    await officeDlg.getByRole("button", { name: "完成" }).click();
    await expect(officeDlg.getByText(/已完成並落庫/)).toBeVisible();
    await officeDlg.getByRole("button", { name: "離開" }).click();

    // 7. Back Office pagination, barcode label preview, cardNo update, suppliers page & 80mm/A4 print toggle
    await page.goto("/backoffice/products");
    await expect(page.getByText(/Page 1\//)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/Page 2\//)).toBeVisible();
    await page.locator("tbody tr").first().click();
    await page.getByRole("button", { name: /列印條碼標籤/ }).click();
    await expect(page.getByRole("dialog", { name: "條碼標籤預覽" })).toContainText("HK HARP CENTRE");

    await page.goto("/backoffice/customers");
    await expect(page.getByText(/Page 1\//)).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(/Page 2\//)).toBeVisible();
    await page.getByPlaceholder(/Search ID, card/).fill("Yeung Kam Yan");
    await page.locator("tbody tr", { hasText: "2261" }).first().click();
    await page.getByPlaceholder("e.g. RWC-0001").fill("E2E-UI-CARD-9");
    await page.getByRole("button", { name: "Update Customer" }).click();
    await expect(page.getByText("Updated customer 2261")).toBeVisible();
    await page.getByPlaceholder(/Search ID, card/).fill("E2E-UI-CARD-9");
    await expect(page.locator("tbody tr", { hasText: "2261" }).first()).toBeVisible();

    await page.goto("/backoffice/suppliers");
    await expect(page.getByText("Total 76 suppliers")).toBeVisible();

    await page.goto("/invoices");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("link", { name: "Print" }).first().click();
    await page.waitForURL("**/invoices/**/print");
    await page.getByRole("button", { name: "80mm Thermal Receipt" }).click();
    await expect(page.getByText(/歡迎再次光臨/)).toBeVisible();
    await page.getByRole("button", { name: "A4 Formal Invoice" }).click();
    await expect(page.getByText("Bank Transfer Payment Instructions")).toBeVisible();
  });

  test("UI 7: Legacy Report Center (ReportG / BOSMaint) via POS 營業數據 & /backoffice/reports", async ({
    page,
  }) => {
    await openCashierHome(page);

    // 1. Top toolbar 營業數據 opens in-place VMBData1 menu -> 營運通報表中心 modal in POS without leaving /
    await page.locator('button[title="營業數據"]').click();
    for (const lbl of ["離開", "時飛", "項飛", "歷史數據", "營運通報表中心"]) {
      await expect(page.getByRole("button", { name: lbl, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "營運通報表中心", exact: true }).click();
    const centerDlg = page.getByRole("dialog", { name: "營運通報表中心" });
    await expect(centerDlg).toBeVisible();
    await expect(centerDlg.getByText(/編印 Printed:/)).toBeVisible();
    await expect(centerDlg.getByText(/營運通報表\s+版權©2001-2009。/)).toBeVisible();

    // Switch through all legacy report tabs inside the ReportG workbench
    for (const tabName of [
      "每日時飛 (時報)",
      "每日交更埋數",
      "項目銷售 (項報)",
      "歷史營業及月計",
      "10403 成本報表",
      "10405 存貨價值/呆貨",
      "10407 存貨變動",
      "查單/收款/AR帳齡",
      "其他交易及盤點",
      "會員/職員/供應商/日誌",
    ]) {
      await centerDlg.getByRole("button", { name: tabName, exact: true }).click();
      await expect(centerDlg.getByText(/總計|AR 帳齡|盤點紀錄|活動日誌/).first()).toBeVisible();
    }

    await centerDlg.getByRole("button", { name: "離開" }).click();
    await expect(centerDlg).not.toBeVisible();

    // 2. Back Office /backoffice/reports hosts full legacy workbench & clean CSV export
    await page.goto("/backoffice/reports");
    await page.getByRole("button", { name: "10403 成本報表", exact: true }).click();
    await expect(page.getByText("原價銷售額 SalesRSP")).toBeVisible();
    await expect(page.getByText("平均成本 CostAV")).toBeVisible();
    const [costDl] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "匯出 CSV" }).click(),
    ]);
    expect(costDl.suggestedFilename()).toMatch(/^bos-cost-10403-/);
  });

  test("UI 8: Autocomplete attributes & live autosuggestions across Cashier (/), AR Invoices, & Back Office", async ({
    page,
  }) => {
    await openCashierHome(page);

    // 1. Cashier / 職員 panel: autoComplete & live staff_login suggestions with ArrowDown + Enter pick
    await page.getByRole("button", { name: /職員/ }).click();
    const staffSearch = page.getByPlaceholder("搜尋職員…");
    await expect(staffSearch).toHaveAttribute("autocomplete", "on");
    await staffSearch.click();
    await staffSearch.fill("10");
    const staffListbox = page.getByRole("listbox");
    await expect(staffListbox).toBeVisible();
    await expect(staffListbox.getByRole("option", { name: /101/ }).first()).toBeVisible();
    await staffSearch.press("ArrowDown");
    await staffSearch.press("Enter");
    await expect(staffSearch).toHaveValue("101");

    // 2. Cashier /: product search & barcode inputs expose autoComplete & live product suggestions
    const posSearch = page.getByPlaceholder("貨品編號 / 名稱");
    await expect(posSearch).toHaveAttribute("autocomplete", "on");
    await posSearch.click();
    await posSearch.fill("210810");
    const posListbox = page.getByRole("listbox");
    await expect(posListbox).toBeVisible();
    await posListbox.getByRole("option", { name: /210810/ }).first().click();
    await expect(posSearch).toHaveValue("210810");

    // 3. /invoices: invoice search & HK bank ref suggestions
    await page.goto("/invoices");
    await expect(page.locator('input[name="invoiceSearch"]')).toHaveAttribute("autocomplete", "on");
    const refInput = page.locator('input[name="referenceNo"]');
    if ((await refInput.count()) > 0) {
      await expect(refInput).toHaveAttribute("autocomplete", "on");
      await refInput.click();
      await refInput.fill("HSBC");
      await expect(page.getByRole("listbox")).toContainText("HSBC-TT-");
    }

    // 4. /backoffice/customers: email domain autosuggestion & autocomplete="email"
    await page.goto("/backoffice/customers");
    const emailInput = page.locator('input[name="customerEmail"]');
    await expect(emailInput).toHaveAttribute("autocomplete", "email");
    await emailInput.click();
    await emailInput.fill("alice");
    const emailList = page.getByRole("listbox");
    await expect(emailList).toBeVisible();
    await emailList.getByRole("option", { name: /alice@gmail\.com/ }).click();
    await expect(emailInput).toHaveValue("alice@gmail.com");

    // 5. /backoffice/settings: bank preset & textarea template autosuggestion
    await page.goto("/backoffice/settings");
    await expect(page.locator('form[data-loaded="true"]')).toBeVisible();
    const bankInput = page.locator('input[name="bankName"]');
    await expect(bankInput).toHaveAttribute("autocomplete", "on");
    await bankInput.click();
    await bankInput.fill("HSBC");
    await expect(page.getByRole("listbox").getByRole("option", { name: /HSBC Hong Kong/ })).toBeVisible();
    await page.getByRole("listbox").getByRole("option", { name: /HSBC Hong Kong/ }).click();
    await expect(bankInput).toHaveValue("HSBC Hong Kong");

    const noteArea = page.locator('textarea[name="paymentTermsNote"]');
    await expect(noteArea).toHaveAttribute("autocomplete", "on");
    await noteArea.click();
    await noteArea.fill("");
    await expect(page.getByRole("listbox")).toBeVisible();
    await noteArea.press("ArrowDown");
    await noteArea.press("Enter");
    await expect(noteArea).not.toHaveValue("");
  });

  test("UI 9: All-Screens & All-Modals Live Remote MySQL Connectivity Sweep", async ({ page }) => {
    const pageErrors: string[] = [];
    const apiErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("response", (res) => {
      if (res.status() >= 400 && !res.url().includes("favicon.ico")) {
        apiErrors.push(`${res.status()} ${res.url()}`);
      }
    });

    // 1. Confirm backend is connected to remote Percona MySQL 8.4 (37 tables, 1983+ SKUs, 58112+ bills)
    const healthRes = await page.request.get("/api/health");
    expect(healthRes.status()).toBe(200);
    const health = (await healthRes.json()) as {
      ok: boolean;
      mysql: { connected: boolean; mysqlVersion: string; tableCount: number; productCount: number; billCount: number };
    };
    expect(health.ok).toBe(true);
    expect(health.mysql.connected).toBe(true);
    expect(health.mysql.mysqlVersion).toContain("8.4");
    expect(health.mysql.tableCount).toBe(37);
    expect(health.mysql.productCount).toBeGreaterThanOrEqual(1983);
    expect(health.mysql.billCount).toBeGreaterThanOrEqual(58112);

    // 2. Startup Cashier (/): legacy toolbar, keypad, & every right panel backed by live remote MySQL
    await openCashierHome(page);
    await expect(page.getByText("Central(1)")).toBeVisible();
    await expect(page.getByText("Morris", { exact: true })).toBeVisible();
    await expect(page.getByText("POSGV3.3")).toBeVisible();
    await expect(page.getByLabel("介面語言")).toHaveCount(0);

    // Keypad "-" button appends hyphen & "C" clears buffer
    await page.getByRole("button", { name: "-", exact: true }).click();
    await expect(page.getByPlaceholder("條碼", { exact: true })).toHaveValue("-");
    await page.getByRole("button", { name: "C", exact: true }).click();
    await expect(page.getByPlaceholder("條碼", { exact: true })).toHaveValue("");

    // Right panels: 按鈕 shows 3-page right rail across 17 retail Category1 groups (excluding PAYOUT), octave sub-tabs, and distinct note labels
    await page.locator('button[title="按鈕"]').click();
    for (const catName of [
      "BOW BRAND PEDAL GUT",
      "Burgundy",
      "Pedal Nylon",
      "Silkgut",
      "Lever Gut",
      "Lever Wire",
      "Pedal Wire",
      "OTHERS",
      "SILKGUT COPPER",
    ]) {
      await expect(page.getByRole("button", { name: catName, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "下一頁分類" }).click();
    for (const catName of [
      "BIO LEVER",
      "BIO PEDAL",
      "GUT GOLD",
      "BioNylon",
      "SIPARIO PEDAL WIRE",
      "SIPARIO LEVER GUT",
      "SIPARIO LEVER WIRE",
      "Sipario Silkgut",
    ]) {
      await expect(page.getByRole("button", { name: catName, exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "下一頁分類" }).click();
    await expect(page.getByRole("button", { name: "BOW BRAND PEDAL GUT", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "BIO LEVER", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "上一頁分類" }).click();
    await page.getByRole("button", { name: "上一頁分類" }).click();
    await expect(page.getByRole("button", { name: "PAYOUT", exact: true })).toHaveCount(0);
    for (const tabLbl of ["Top", "1st", "2nd", "3rd", "4th", "5th"]) {
      await expect(page.getByRole("button", { name: tabLbl, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /Top Octave G - No\. 00/ })).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();

    await page.locator('button[title="貨品"]').click();
    await expect(page.getByText(/貨品 \[1\//)).toBeVisible();
    await page.getByRole("button", { name: "下一頁", exact: true }).click();
    await expect(page.getByText("貨品 [13/1983]")).toBeVisible();

    await page.locator('button[title="會員"]').click();
    await expect(page.getByText(/會員 \[1\//)).toBeVisible();
    await page.getByRole("button", { name: "下一頁", exact: true }).click();
    await expect(page.getByText(/會員 \[13\/\d+\]/)).toBeVisible();

    await page.locator('button[title="職員"]').click();
    await expect(page.getByText("職員 [1/8]")).toBeVisible();

    await page.locator('button[title="優惠"]').click();
    await expect(page.getByText(/本單賺取積分/)).toBeVisible();

    await page.locator('button[title="資訊"]').first().click();
    await expect(page.getByText("分店：Central(1)")).toBeVisible();

    await page.locator('button[title="支援"]').click();
    await expect(page.getByRole("button", { name: "營運通支援" })).toBeVisible();

    // Modals on / (查單, 營業數據->項飛, 營業數據->歷史數據->本月生意, 經理->更改密碼)
    await page.locator('button[title="查單"]').first().click();
    const qDlg = page.getByRole("dialog", { name: "查單" });
    await expect(qDlg).toBeVisible();
    await qDlg.getByRole("button", { name: "最後30單", exact: true }).click();
    await expect(qDlg.locator("tbody tr").first()).toBeVisible();
    await qDlg.getByRole("button", { name: "離開" }).click();

    await page.locator('button[title="營業數據"]').click();
    await page.getByRole("button", { name: "項飛", exact: true }).click();
    await expect(page.getByText("銷售數量")).toBeVisible();
    await page.getByRole("button", { name: "報表圖示" }).click();
    const itemDlg = page.getByRole("dialog", { name: "項報" });
    await expect(itemDlg).toBeVisible();
    await expect(itemDlg.getByText(/編印 Printed:/)).toBeVisible();
    await itemDlg.getByRole("button", { name: "離開" }).click();
    await page.locator('button[title="零售"]').click();

    await page.locator('button[title="營業數據"]').click();
    await page.getByRole("button", { name: "歷史數據", exact: true }).click();
    await page.getByRole("button", { name: "本月生意", exact: true }).click();
    await expect(page.getByText("每月營業額")).toBeVisible();
    await page.getByRole("button", { name: "報表圖示" }).click();
    const histDlg = page.getByRole("dialog", { name: "歷史數據" });
    await expect(histDlg).toBeVisible();
    await expect(histDlg.getByText(/編印 Printed:/)).toBeVisible();
    await histDlg.getByRole("button", { name: "離開" }).click();
    await page.locator('button[title="零售"]').click();

    await page.locator('button[title="經理"]').click();
    await page.getByRole("button", { name: "更改密碼", exact: true }).click();
    const pwdDlg = page.getByRole("dialog", { name: "更改密碼" });
    await expect(pwdDlg).toBeVisible();
    await pwdDlg.getByRole("button", { name: "取消" }).click();

    // 3. /pos alias & /login -> / redirect
    await page.goto("/pos");
    await expect(page.getByPlaceholder("條碼", { exact: true })).toBeVisible();
    await expect(page.getByText("Central(1)")).toBeVisible();

    await page.goto("/login");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByPlaceholder("條碼", { exact: true })).toBeVisible();

    // 4. /invoices & /invoices/[invoiceNo]/print
    await page.goto("/invoices");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("link", { name: "Print" }).first()).toBeVisible();
    await page.getByRole("link", { name: "Print" }).first().click();
    await page.waitForURL("**/invoices/**/print");
    await expect(page.getByRole("button", { name: "80mm Thermal Receipt" })).toBeVisible();
    await expect(page.getByRole("button", { name: "A4 Formal Invoice" })).toBeVisible();

    // 5. All 8 /backoffice/* routes
    await page.goto("/backoffice/products");
    await expect(page.getByText("Catalog Masters")).toBeVisible();
    await expect(page.getByText(/Page 1\//)).toBeVisible();

    await page.goto("/backoffice/customers");
    await expect(page.getByText("CRM Customers & Bonus Points")).toBeVisible();
    await expect(page.getByText(/Page 1\//)).toBeVisible();

    await page.goto("/backoffice/suppliers");
    await expect(page.getByText("Total 76 suppliers")).toBeVisible();

    await page.goto("/backoffice/stock");
    const stockDlg = page.getByRole("dialog", { name: "存貨" });
    await expect(stockDlg).toBeVisible();
    await expect(stockDlg).toContainText("共 1983 項");
    await stockDlg.getByRole("button", { name: "離開" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/backoffice/other-transactions");
    const officeDlg = page.getByRole("dialog", { name: "其他交易" });
    await expect(officeDlg).toBeVisible();
    await expect(officeDlg.locator('select[aria-label="供應商"] option').first()).toContainText("(76)");
    await officeDlg.getByPlaceholder("搜尋條碼 / 貨品").fill("210810");
    await expect(officeDlg.locator("button", { hasText: "210810" }).first()).toBeVisible();
    await officeDlg.getByRole("button", { name: "離開" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/backoffice/day-end");
    await expect(page.getByText("開櫃銀頭")).toBeVisible();

    await page.goto("/backoffice/reports");
    await expect(page.getByText(/營運通報表中心/)).toBeVisible();
    await expect(page.getByText(/編印 Printed:/)).toBeVisible();

    await page.goto("/backoffice/settings");
    await expect(page.getByText("Invoice & Terminal Settings")).toBeVisible();
    await expect(page.locator('input[name="bankName"]')).toHaveValue(/HSBC/i);

    expect(pageErrors).toEqual([]);
    expect(apiErrors).toEqual([]);
  });

  test("UI 10: Complete Legacy Interactions, Prefix Operators, Function Keys & Subscreens Parity", async ({ page }) => {
    await openCashierHome(page);

    // 1. retailsf prefix operators: *qty*barcode, =qty, [itemDisc%, >allDisc%, /change, x cancel line
    await enterBarcodeOnPos(page, "*3*210810");
    const row210810 = page.locator("tbody tr", { hasText: "210810" });
    await expect(row210810).toContainText("3");
    await enterBarcodeOnPos(page, "=2");
    await expect(row210810).toContainText("2");
    await enterBarcodeOnPos(page, "[10");
    await expect(row210810).toContainText("10");
    await enterBarcodeOnPos(page, ">15");
    await expect(row210810).toContainText("15");
    await enterBarcodeOnPos(page, "/500");
    await expect(page.getByText("應找")).toBeVisible();
    await enterBarcodeOnPos(page, "x");
    await expect(row210810).toHaveCount(0);

    // 2. Double-click row editor + Escape blocked + ↑/↓ selection + 重選 -> 取消本單
    await enterBarcodeOnPos(page, "210810");
    await row210810.dblclick();
    const editDlg = page.getByRole("dialog", { name: "修改項目" });
    await expect(editDlg).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(editDlg).toBeVisible();
    await editDlg.locator('input[name="editQty"]').fill("4");
    await editDlg.locator('input[name="editDiscPct"]').fill("5");
    await editDlg.getByRole("button", { name: "確定", exact: true }).click();
    await expect(editDlg).not.toBeVisible();
    await expect(row210810).toContainText("4");
    await expect(row210810).toContainText("5");

    await enterBarcodeOnPos(page, "930100");
    await page.locator('button[title="上一筆"]').click();
    await expect(row210810).toHaveClass(/bg-\[#316ac5\]/);
    await page.locator('button[title="下一筆"]').click();
    await expect(page.locator("tbody tr", { hasText: "930100" })).toHaveClass(/bg-\[#316ac5\]/);

    // 付款2 modal check before clearing
    await page.getByRole("button", { name: "付款二", exact: true }).click();
    const pay2Dlg = page.getByRole("dialog", { name: "付款2" });
    await expect(pay2Dlg).toBeVisible();
    await expect(pay2Dlg.getByText("銷售額")).toBeVisible();
    await pay2Dlg.getByRole("button", { name: "離開", exact: true }).click();
    await expect(pay2Dlg).not.toBeVisible();

    await page.locator('button[title="重選"]').click();
    const holdDlg = page.getByRole("dialog", { name: "擱置 / 取消功能" });
    await expect(holdDlg).toBeVisible();
    await holdDlg.getByRole("button", { name: "取消本單", exact: true }).click();
    await expect(row210810).toHaveCount(0);

    // 3. StockPanel VMStock1 sidebar: 預覽點存表, 列印條碼, 重計存貨
    await page.locator('button[title="存貨"]').click();
    const stockDlg = page.getByRole("dialog", { name: "存貨" });
    await expect(stockDlg).toBeVisible();
    await expect(stockDlg).toContainText("共 1983 項");
    await stockDlg.getByRole("button", { name: "預覽點存表", exact: true }).click();
    const takeDlg = page.getByRole("dialog", { name: "預覽點存表" });
    await expect(takeDlg).toBeVisible();
    await takeDlg.getByRole("button", { name: "離開", exact: true }).click();
    await stockDlg.getByRole("button", { name: "列印條碼", exact: true }).click();
    const lblDlg = page.getByRole("dialog", { name: "列印條碼" });
    await expect(lblDlg).toBeVisible();
    await lblDlg.getByRole("button", { name: "離開", exact: true }).click();
    await stockDlg.getByRole("button", { name: "重計存貨", exact: true }).click();
    await expect(stockDlg.getByText(/已完成重計即時存貨/)).toBeVisible();
    await stockDlg.getByRole("button", { name: "離開", exact: true }).click();

    // 4. 經理 -> 印表機設定 (編印細節設定 & 進階 tabs & 測試 button)
    await page.locator('button[title="經理"]').click();
    await page.getByRole("button", { name: "印表機設定", exact: true }).click();
    const prtDlg = page.getByRole("dialog", { name: "印表機設定" });
    await expect(prtDlg).toBeVisible();
    await prtDlg.getByRole("button", { name: "編印細節設定", exact: true }).click();
    await expect(prtDlg.getByText("單項單印", { exact: true })).toBeVisible();
    await expect(prtDlg.getByText("列印臨時收據")).toBeVisible();
    await prtDlg.getByRole("button", { name: "進階", exact: true }).click();
    await expect(prtDlg.getByText("時飛", { exact: true })).toBeVisible();
    await expect(prtDlg.getByText("簡化時飛")).toBeVisible();
    await prtDlg.getByRole("button", { name: "印表機設定", exact: true }).click();
    await prtDlg.getByRole("button", { name: "測試", exact: true }).first().click();
    await expect(prtDlg.getByText(/已傳送測試頁至 Printer101/)).toBeVisible();
    await prtDlg.getByRole("button", { name: "離開", exact: true }).click();

    // 5. 查單 -> HarpReceipt preview -> 正式發票 A5 Harp Invoice (Legacy)
    await page.locator('button[title="查單"]').first().click();
    const qDlg = page.getByRole("dialog", { name: "查單" });
    await expect(qDlg).toBeVisible();
    await qDlg.getByRole("button", { name: "最後30單", exact: true }).click();
    await expect(qDlg.getByText("Harp Invoice")).toBeVisible();
    await expect(qDlg.getByText(/395-417017-883/)).toBeVisible();
    await qDlg.getByRole("button", { name: "正式發票", exact: true }).click();
    await page.waitForURL("**/invoices/**/print");
    await page.getByRole("button", { name: "A5 Harp Invoice (Legacy)", exact: true }).click();
    await expect(page.getByText("Harp Invoice", { exact: true })).toBeVisible();
    await expect(page.getByText(/395-417017-883/)).toBeVisible();

    // 6. 收銀員 -> 轉更/日結 -> 離開 returns cleanly to /
    await openCashierHome(page);
    await page.locator('button[title="收銀員"]').click();
    await page.getByRole("button", { name: "轉更/日結", exact: true }).click();
    await page.waitForURL("**/backoffice/day-end");
    await expect(page.getByText("銀頭 Cash Open：")).toBeVisible();
    await page.getByRole("button", { name: "離開", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("UI 11: Complete 51-Screen & 9-Workflow Legacy Parity Sweep", async ({ page }) => {
    test.setTimeout(240_000);
    await openCashierHome(page);

    // 1. Screen 001: 6x4 keypad (Black LCD numeric input + 數量/條碼/項折/-/送貨/單折/C) & left-pane 6 function buttons
    const keypadLcd = page.getByTestId("keypad-lcd");
    await expect(keypadLcd).toBeVisible();
    await keypadLcd.fill("123abc.5");
    await expect(keypadLcd).toHaveValue("123.5");
    await page.getByRole("button", { name: "C", exact: true }).click();
    await expect(keypadLcd).toHaveValue("");
    for (const label of ["數量", "項折", "送貨", "單折"]) {
      await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "-", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "C", exact: true })).toBeVisible();
    await expect(page.locator('button[title="輸入條碼"]')).toBeVisible();
    for (const fnTitle of ["退售", "選價", "改價", "方法", "重選", "完成"]) {
      await expect(page.locator(`button[title="${fnTitle}"]`)).toBeVisible();
    }

    // 2. Screens 020-022, 027, 030, 037: Side menus keep 影像 (HARP CENTRE + 51 888 902) intact
    await page.locator('button[title="其他交易"]').click();
    await expect(page.getByRole("button", { name: "報銷", exact: true })).toBeVisible();
    await expect(page.getByText("HARP CENTRE", { exact: true })).toBeVisible();
    await expect(page.getByText("51 888 902")).toBeVisible();

    await page.locator('button[title="收銀員"]').click();
    await expect(page.getByRole("button", { name: "銀頭", exact: true })).toBeVisible();
    await expect(page.getByText("HARP CENTRE", { exact: true })).toBeVisible();

    await page.locator('button[title="經理"]').click();
    await expect(page.getByRole("button", { name: "印表機設定", exact: true })).toBeVisible();
    await expect(page.getByText("HARP CENTRE", { exact: true })).toBeVisible();

    await page.locator('button[title="營業數據"]').click();
    await expect(page.getByRole("button", { name: "時飛", exact: true })).toBeVisible();
    await expect(page.getByText("HARP CENTRE", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "歷史數據", exact: true }).click();
    await expect(page.getByRole("button", { name: "銷售統計", exact: true })).toBeVisible();
    await expect(page.getByText("HARP CENTRE", { exact: true })).toBeVisible();

    await page.locator('button[title="支援"]').click();
    await expect(page.getByRole("button", { name: "關於軟件", exact: true })).toBeVisible();
    await expect(page.getByText("HARP CENTRE", { exact: true })).toBeVisible();

    // Screen 038: 關於 eRun POSG
    await page.getByRole("button", { name: "關於軟件", exact: true }).click();
    const aboutDlg = page.getByRole("dialog", { name: "關於軟件" });
    await expect(aboutDlg.getByText("關於 eRun POSG")).toBeVisible();
    await expect(aboutDlg.getByText("eRun Systems Limited", { exact: true })).toBeVisible();
    await expect(aboutDlg.getByText("責任免除及限制責任")).toBeVisible();
    await aboutDlg.getByRole("button", { name: "離開", exact: true }).click();

    await page.locator('button[title="零售"]').click();

    // 3. Create a delivery bill and test 查單 Screens 002-018
    await enterBarcodeOnPos(page, "210810");
    await page.getByRole("button", { name: /送貨/ }).click();
    await page.locator('button[title="完成"]').click();
    const okDlg = page.getByRole("dialog", { name: "營運通訊息 - 000" });
    await expect(okDlg).toBeVisible();
    const createdMsg = await okDlg.innerText();
    const invMatch = createdMsg.match(/POS-[A-Za-z0-9-]+/);
    const createdInvNo = invMatch ? invMatch[0] : "POS-";
    await okDlg.getByRole("button", { name: "離開", exact: true }).click();

    await page.locator('button[title="查單"]').first().click();
    const qDlg = page.getByRole("dialog", { name: "查單" });
    await expect(qDlg).toBeVisible();

    // Sub-filters on 今日銷售 (002-004)
    for (const sf of ["完成單", "取消單", "落訂單", "所有單", "最後30單"]) {
      await qDlg.getByRole("button", { name: sf, exact: true }).click();
    }

    // Calendar popup (Screen 015)
    await qDlg.locator('button[title="日期"]').click();
    const calPop = qDlg.getByTestId("bill-query-calendar");
    await expect(calPop).toBeVisible();
    await expect(calPop.getByText(/公元 \d{4} 年/)).toBeVisible();
    await expect(calPop.getByText("週日")).toBeVisible();
    await calPop.getByRole("button", { name: /今天:/ }).click();
    await expect(calPop).not.toBeVisible();

    // 未處理單 workflow (005-006, 011-014): 問題 -> 問題單 -> 拒收 -> 拒收單 -> 選單接收 -> 已收單 -> 所有單
    await qDlg.getByRole("button", { name: "未處理單", exact: true }).click();
    await expect(qDlg.getByText("Delivery Note")).toBeVisible();
    await expect(qDlg.locator("tbody tr", { hasText: createdInvNo }).first()).toBeVisible();
    await qDlg.locator("tbody tr", { hasText: createdInvNo }).first().click();

    await qDlg.getByRole("button", { name: "問題", exact: true }).click();
    await qDlg.getByPlaceholder("輸入拒收或問題詳情...").fill("UI11 問題測試");
    await qDlg.getByRole("button", { name: "確定", exact: true }).click();
    await expect(qDlg.getByText(/已標記問題單/)).toBeVisible();
    await qDlg.getByRole("button", { name: "問題單", exact: true }).click();
    await expect(qDlg.locator("tbody tr", { hasText: createdInvNo }).first()).toBeVisible();
    await qDlg.locator("tbody tr", { hasText: createdInvNo }).first().click();

    await qDlg.getByRole("button", { name: "拒收", exact: true }).click();
    await qDlg.getByPlaceholder("輸入拒收或問題詳情...").fill("UI11 拒收測試");
    await qDlg.getByRole("button", { name: "確定", exact: true }).click();
    await expect(qDlg.getByText(/已標記拒收/)).toBeVisible();
    await qDlg.getByRole("button", { name: "拒收單", exact: true }).click();
    await expect(qDlg.locator("tbody tr", { hasText: createdInvNo }).first()).toBeVisible();
    await qDlg.locator("tbody tr", { hasText: createdInvNo }).first().click();

    await qDlg.getByRole("button", { name: "選單接收", exact: true }).click();
    await expect(qDlg.getByText(/已提貨/).first()).toBeVisible();
    await qDlg.getByRole("button", { name: "已收單", exact: true }).click();
    await expect(qDlg.locator("tbody tr", { hasText: createdInvNo }).first()).toBeVisible();
    await qDlg.getByRole("button", { name: "所有單", exact: true }).click();
    await expect(qDlg.locator("tbody tr", { hasText: createdInvNo }).first()).toBeVisible();

    // Confirm 接收所有 opens confirmation dialog and cancels cleanly without mutating seeded orders
    await qDlg.getByRole("button", { name: "接收所有", exact: true }).click();
    await expect(qDlg.getByText(/確定將目前顯示的/)).toBeVisible();
    await qDlg.getByRole("button", { name: "取消", exact: true }).click();

    // Search mode (Screens 016-018)
    await qDlg.getByRole("button", { name: "搜尋", exact: true }).click();
    await qDlg.getByRole("button", { name: "ab...", exact: true }).click();
    await qDlg.getByRole("button", { name: "..ab..", exact: true }).click();
    await qDlg.getByPlaceholder("搜尋單號 / 會員 / 電話").fill("210810");
    await qDlg.getByRole("button", { name: "執行搜尋" }).click();
    await qDlg.getByRole("button", { name: "項資訊", exact: true }).click();
    await expect(qDlg.getByRole("columnheader", { name: "貨號" })).toBeVisible();
    await qDlg.getByRole("button", { name: "付款資訊", exact: true }).click();
    await expect(qDlg.getByRole("columnheader", { name: "付款" })).toBeVisible();
    await qDlg.getByRole("button", { name: "整單資訊", exact: true }).click();
    await qDlg.getByRole("button", { name: "返回", exact: true }).click();
    await qDlg.getByRole("button", { name: "離開", exact: true }).click();

    // 4. Screen 019: Embedded 存貨 workspace under top toolbar
    await page.locator('button[title="存貨"]').click();
    const stockArea = page.getByRole("dialog", { name: "存貨" });
    await expect(stockArea).toBeVisible();
    await expect(stockArea.getByRole("columnheader", { name: "待送" })).toBeVisible();
    await expect(stockArea.getByRole("columnheader", { name: "可用" })).toBeVisible();
    await expect(stockArea.getByRole("columnheader", { name: "最後銷售", exact: true })).toBeVisible();
    await expect(stockArea.getByRole("columnheader", { name: "最後購貨", exact: true })).toBeVisible();
    await stockArea.getByRole("button", { name: "存貨 GO" }).click();
    await expect(stockArea.getByText("共 1983 項", { exact: true })).toBeVisible();
    await stockArea.getByRole("button", { name: "離開", exact: true }).click();

    // 5. Screens 023-026: Printer setup (重寫咭 & persistence) & Change Password touch keypad (鎖訊)
    await page.locator('button[title="經理"]').click();
    await page.getByRole("button", { name: "印表機設定", exact: true }).click();
    const prtDlg = page.getByRole("dialog", { name: "印表機設定" });
    await expect(prtDlg.getByRole("button", { name: "重寫咭" })).toBeVisible();
    await prtDlg.getByRole("button", { name: "編印細節設定", exact: true }).click();
    const tempReceiptCb = prtDlg.getByLabel("列印臨時收據");
    const wasChecked = await tempReceiptCb.isChecked();
    await tempReceiptCb.setChecked(!wasChecked);
    await prtDlg.getByRole("button", { name: "套用", exact: true }).click();
    await expect(prtDlg.getByText("印表機設定已儲存")).toBeVisible();
    await prtDlg.getByRole("button", { name: "離開", exact: true }).click();

    await page.getByRole("button", { name: "印表機設定", exact: true }).click();
    await prtDlg.getByRole("button", { name: "編印細節設定", exact: true }).click();
    await expect(prtDlg.getByLabel("列印臨時收據")).toBeChecked({ checked: !wasChecked });
    await prtDlg.getByLabel("列印臨時收據").setChecked(wasChecked);
    await prtDlg.getByRole("button", { name: "套用", exact: true }).click();
    await prtDlg.getByRole("button", { name: "離開", exact: true }).click();

    await page.getByRole("button", { name: "更改密碼", exact: true }).click();
    const pwdDlg = page.getByRole("dialog", { name: "更改密碼" });
    await pwdDlg.getByRole("button", { name: "鎖訊", exact: true }).click();
    await expect(pwdDlg.getByText("舊密碼")).toBeVisible();
    await expect(pwdDlg.getByText("6位 PIN")).toBeVisible();
    await pwdDlg.getByRole("button", { name: "1", exact: true }).click();
    await pwdDlg.getByRole("button", { name: "2", exact: true }).click();
    await expect(pwdDlg.locator('input[name="newPassword"]')).toHaveValue("12");
    await pwdDlg.getByRole("button", { name: "取消", exact: true }).click();

    // 6. Screens 028-029, 031-036: Inline receipt & stats workspaces
    await page.locator('button[title="營業數據"]').click();
    await page.getByRole("button", { name: "時飛", exact: true }).click();
    await expect(page.getByText("總銷售收入")).toBeVisible();
    await page.getByRole("button", { name: "項飛", exact: true }).click();
    await expect(page.getByText("銷售數量")).toBeVisible();

    await page.getByRole("button", { name: "歷史數據", exact: true }).click();
    await page.getByRole("button", { name: "銷售統計", exact: true }).click();
    await expect(page.getByText("銷售統計 - 本店")).toBeVisible();
    await page.getByRole("button", { name: "GO", exact: true }).click();

    await page.getByRole("button", { name: "會員統計", exact: true }).click();
    await expect(page.getByText("會員統計 - 本店")).toBeVisible();
    await page.getByRole("button", { name: "職員統計", exact: true }).click();
    await expect(page.getByText("職員統計 - 本店")).toBeVisible();
    await page.getByRole("button", { name: "本月生意", exact: true }).click();
    await expect(page.getByText("每月營業額")).toBeVisible();
    await page.getByRole("button", { name: "本月項飛", exact: true }).click();
    await expect(page.getByText("每月銷售量")).toBeVisible();
    await page.locator('button[title="零售"]').click();

    // 7. Screens 049-050: 會員 (+/✏️/🪪 quick member modal) & 職員 (電話/卡號)
    await page.locator('button[title="會員"]').click();
    await page.locator('button[title="新增會員"]').click();
    const addMemDlg = page.getByRole("dialog", { name: "新增會員" });
    await addMemDlg.locator('input[name="memberNameZh"]').fill("UI11測試會員");
    await addMemDlg.locator('input[name="memberPhone"]').fill("91112222");
    await addMemDlg.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(addMemDlg).not.toBeVisible();
    await expect(page.getByText(/會員：UI11測試會員/).first()).toBeVisible();

    await page.locator('button[title="會員積分詳情"]').click();
    const detDlg = page.getByRole("dialog", { name: "會員卡及積分明細" });
    await expect(detDlg.getByText("UI11測試會員")).toBeVisible();
    await detDlg.getByRole("button", { name: "離開", exact: true }).click();

    await page.locator('button[title="職員"]').click();
    await expect(page.getByRole("columnheader", { name: "電話" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "卡號" })).toBeVisible();

    // 8. Screen 051: 零售 toggle -> 查價 mode -> lookup -> 零售 restore
    await page.locator('button[title="影像"]').click();
    await page.locator('button[title="零售"]').click();
    await expect(page.getByTestId("price-check-watermark")).toBeVisible();
    const pcBarcode = page.locator('input[name="priceCheckBarcode"]');
    await pcBarcode.fill("210810");
    await pcBarcode.press("Enter");
    await expect(page.getByText("標準售價")).toBeVisible();
    await page.locator('button[title="零售"]').click();
    await expect(page.getByTestId("price-check-watermark")).toHaveCount(0);
    await expect(page.getByPlaceholder("條碼", { exact: true })).toBeVisible();
  });

  test("UI 12: Reviewer Feedback — Product Color & UBC, Line Remarks/SN, 2nd Deposit Balance, Member Address & Auto Sequential ID", async ({
    page,
  }) => {
    await openCashierHome(page);

    // 1 & 2. Product picker shows primary 貨碼(*) (UBC) and 顏色 (e.g. Mia BioCarbon -> HCHP03 / Natural)
    await page.locator('button[title="貨品"]').click();
    await expect(page.getByRole("columnheader", { name: "貨碼(*)" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "顏色" }).nth(1)).toBeVisible();
    const prodSearch = page.getByPlaceholder("搜尋貨品…");
    await prodSearch.fill("Mia (BioCarbon)");
    await prodSearch.press("Escape");
    const miaRow = page.locator("tbody tr", { hasText: "Natural" }).first();
    await expect(miaRow).toBeVisible();
    await expect(miaRow).toContainText("HCHP03");
    await miaRow.click();

    // Cart grid displays 貨碼 (HCHP03) and 顏色 (Natural)
    const cartTable = page.locator("table").first();
    await expect(cartTable.locator("tbody tr", { hasText: "Mia (BioCarbon)" })).toContainText("Natural");
    await expect(cartTable.locator("tbody tr", { hasText: "Mia (BioCarbon)" })).toContainText("HCHP03");

    // 3. 改價 with empty keypad opens 浮動價格輸入 / 修改項目 with 備註 & 序號 (S/N)
    await page.locator('button[title="改價"]').click();
    const editDlg = page.getByRole("dialog", { name: "修改項目" });
    await expect(editDlg).toBeVisible();
    await editDlg.locator('input[name="editSerialNo"]').fill("SN-MIA-2026");
    await editDlg.locator('textarea[name="editNotes"]').fill("租琴日期 Dec 2026");
    await editDlg.getByRole("button", { name: "備註顯示原價" }).click();
    await expect(editDlg.locator('textarea[name="editNotes"]')).toHaveValue(/原價/);
    await editDlg.getByRole("button", { name: "確定" }).click();
    await expect(editDlg).not.toBeVisible();
    await expect(cartTable).toContainText("S/N:SN-MIA-2026");
    await expect(cartTable).toContainText("租琴日期 Dec 2026");

    // Clear Mia and test deposit + 2nd deposit flow with 210810 (HK$113 x 2 = HK$226)
    await page.getByRole("button", { name: "取消項目" }).click();
    await enterBarcodeOnPos(page, "210810");

    // Set qty=2, line note & S/N on 210810 and issue invoice with HK$100 initial deposit
    await page.locator("tbody tr", { hasText: "210810" }).first().dblclick();
    await expect(editDlg).toBeVisible();
    await editDlg.locator('input[name="editQty"]').fill("2");
    await editDlg.locator('input[name="editSerialNo"]').fill("SN-HARP-888");
    await editDlg.locator('textarea[name="editNotes"]').fill("Dec 2026 租琴");
    await editDlg.getByRole("button", { name: "確定" }).click();

    // 5 & 6. Members: default sort newest numeric ID, auto sequential ID on add, address field, and scoped 號碼 search
    await page.locator('button[title="會員"]').click();
    await expect(page.getByRole("button", { name: "排序:最新編號" })).toBeVisible();
    await page.locator('button[title="新增會員"]').click();
    const addMemDlg = page.getByRole("dialog", { name: "新增會員" });
    await expect(addMemDlg).toBeVisible();
    const autoIdInput = addMemDlg.locator('input[name="memberLegacyId"]');
    await expect(autoIdInput).toHaveValue(/^\d+$/);
    const assignedLegacyId = await autoIdInput.inputValue();
    expect(Number(assignedLegacyId)).toBeGreaterThanOrEqual(4563);
    await addMemDlg.locator('input[name="memberNameZh"]').fill("UI12地址測試");
    await addMemDlg.locator('input[name="memberPhone"]').fill("98887777");
    await addMemDlg.locator('textarea[name="memberAddress"]').fill("Room 2016, United Centre, Admiralty");
    await addMemDlg.getByRole("button", { name: "儲存", exact: true }).click();
    await expect(addMemDlg).not.toBeVisible();

    // Scoped 號碼 search should match assignedLegacyId and NOT match phone digits
    await page.getByLabel("會員搜尋範圍").selectOption("id");
    await page.getByPlaceholder("搜尋會員…").fill("98887777");
    await expect(page.getByText("沒有記錄")).toBeVisible();
    await page.getByPlaceholder("搜尋會員…").fill(assignedLegacyId);
    await expect(page.locator("tbody tr", { hasText: "UI12地址測試" }).first()).toBeVisible();

    // Issue invoice with initial deposit HK$100 via 付款一
    await page.getByRole("button", { name: /方法/ }).click();
    await page.getByRole("button", { name: /付款一/ }).click();
    await page.getByLabel("訂金方式").selectOption("CASH");
    await page.getByLabel("訂金", { exact: true }).fill("100");
    await page.locator('button[title="完成"]').click();

    const okDlg = page.getByRole("dialog", { name: "營運通訊息 - 000" });
    await expect(okDlg).toBeVisible();
    const dlgText = await okDlg.innerText();
    const match = dlgText.match(/INV-\d+-\d+/);
    expect(match).not.toBeNull();
    const invoiceNo = match![0];
    await okDlg.getByRole("button", { name: "離開" }).click();

    // 4. Open 查單 -> select the half-paid invoice -> 加訂/提貨 -> 加訂 / 續付尾數
    await page.locator('button[title="查單"]').first().click();
    const qDlg = page.getByRole("dialog", { name: "查單" });
    await expect(qDlg).toBeVisible();
    await qDlg.locator("tbody tr", { hasText: invoiceNo }).first().click();
    await qDlg.getByRole("button", { name: "加訂/提貨", exact: true }).click();
    await qDlg.getByRole("button", { name: "加訂 / 續付尾數", exact: true }).click();
    await expect(qDlg).not.toBeVisible();

    // Verify 2nd deposit mode recognizes HK$100 already paid and shows HK$126 remaining (NOT full HK$226!)
    await expect(page.getByTestId("deposit-topup-banner")).toContainText(invoiceNo);
    await expect(page.getByTestId("deposit-topup-banner")).toContainText("HK$100.00");
    await expect(page.getByText(/尚欠餘額：\s*HK\$126\.00/).first()).toBeVisible();

    // Enter 2nd partial deposit of HK$50 in the black keypad LCD and click 完成 -> settles same invoice to HK$76 balance
    await page.getByTestId("keypad-lcd").fill("50");
    await page.locator('button[title="完成"]').click();
    await expect(okDlg).toBeVisible();
    await expect(okDlg).toContainText(invoiceNo);
    await expect(okDlg).toContainText("HK$76.00");
    await okDlg.getByRole("button", { name: "收據預覽" }).click();

    // Print page shows line S/N, line remarks, and customer delivery address
    await expect(page.getByText(invoiceNo).first()).toBeVisible();
    await expect(page.getByText("SN-HARP-888")).toBeVisible();
    await expect(page.getByText("Dec 2026 租琴")).toBeVisible();
    await expect(page.getByText("Room 2016, United Centre, Admiralty")).toBeVisible();
  });

  test("UI 13: Reviewer 20261126 — Close Confirm, 3-Step Deposit + Edit/Cancel Deposit, In-Place Amend Keeping Deposit & Invoice No, Delivery Date/Addr, Print Sheet & Item Reorder", async ({
    page,
  }) => {
    await openCashierHome(page);

    // 1. Add 2 items and test cart item reordering (上移 / 下移)
    await enterBarcodeOnPos(page, "HCSNG001"); // $70.00
    const cartRows = page.locator("table").first().locator("tbody tr");
    await expect(cartRows.nth(0)).toContainText("HCSNG001");
    await enterBarcodeOnPos(page, "210810");   // $113.00
    await expect(cartRows.nth(0)).toContainText("HCSNG001");
    await expect(cartRows.nth(1)).toContainText("210810");

    // 210810 is selected; click 上移 -> moves to row 0
    await page.locator('button[title="上移項目 (Alt+↑)"]').click();
    await expect(cartRows.nth(0)).toContainText("210810");
    await expect(cartRows.nth(1)).toContainText("HCSNG001");

    // 2. Close confirmation prompt on 登出 & global beforeunload handler when unsaved work is in cart
    const beforeUnloadPrevented = await page.evaluate(() => {
      const ev = new Event("beforeunload", { cancelable: true });
      return !window.dispatchEvent(ev);
    });
    expect(beforeUnloadPrevented).toBe(true);

    await page.locator('button[title="登出"]').click();
    const exitDlg = page.getByRole("dialog", { name: "確定離開" });
    await expect(exitDlg).toBeVisible();
    await exitDlg.getByRole("button", { name: "取消", exact: true }).click();
    await expect(exitDlg).not.toBeVisible();
    await expect(cartRows.nth(0)).toContainText("210810");

    // Remove 210810 so cart only has HCSNG001 ($70) for $40 + $20 + $10 deposit test
    await page.getByRole("button", { name: "取消項目" }).click();
    await expect(cartRows).toHaveCount(1);

    // 3. First deposit $40 via keypad + 落訂 button -> 完成
    await page.getByRole("button", { name: /方法/ }).click();
    await page.getByTestId("keypad-lcd").fill("40");
    await page.getByRole("button", { name: "落訂", exact: true }).click();
    await expect(page.getByText(/尚欠餘額：\s*HK\$30\.00/).first()).toBeVisible();
    await page.locator('button[title="完成"]').click();

    const okDlg = page.getByRole("dialog", { name: "營運通訊息 - 000" });
    await expect(okDlg).toBeVisible();
    const firstDlgText = await okDlg.innerText();
    const invMatch = firstDlgText.match(/INV-\d+-\d+/);
    expect(invMatch).not.toBeNull();
    const invoiceNo = invMatch![0];
    await expect(okDlg).toContainText("PARTIAL");
    await expect(okDlg).toContainText("HK$30.00");
    await okDlg.getByRole("button", { name: "離開" }).click();

    // 4. Second partial deposit $20 via 加訂 + 加入部分付款 (付款二) -> leaves $10 remaining (NOT full paid!)
    await page.locator('button[title="查單"]').first().click();
    const qDlg = page.getByRole("dialog", { name: "查單" });
    await expect(qDlg).toBeVisible();
    await qDlg.locator("tbody tr", { hasText: invoiceNo }).first().click();
    await qDlg.getByRole("button", { name: "加訂/提貨", exact: true }).click();
    await qDlg.getByRole("button", { name: "加訂 / 續付尾數", exact: true }).click();

    await page.getByTestId("keypad-lcd").fill("20");
    await page.getByRole("button", { name: "加入部分付款 (付款二)" }).click();
    await expect(page.getByText(/尚欠餘額：\s*HK\$10\.00/).first()).toBeVisible();
    await page.locator('button[title="完成"]').click();
    await expect(okDlg).toBeVisible();
    await expect(okDlg).toContainText(invoiceNo);
    await expect(okDlg).toContainText("PARTIAL");
    await expect(okDlg).toContainText("HK$10.00");
    await okDlg.getByRole("button", { name: "離開" }).click();

    // 5. Open DepositPaymentDialog from 查單 -> test 改訂 (Bank Transfer $15) + 尾數付款 + 取消訂
    await page.locator('button[title="查單"]').first().click();
    await expect(qDlg).toBeVisible();
    await qDlg.locator("tbody tr", { hasText: invoiceNo }).first().click();
    await qDlg.getByRole("button", { name: "加訂/提貨", exact: true }).click();
    await qDlg.getByRole("button", { name: "落訂 / 改訂 / 取消訂", exact: true }).click();

    const depDlg = page.getByRole("dialog", { name: "付款 / 落訂管理" });
    await expect(depDlg).toBeVisible();
    await expect(depDlg.getByTestId("deposit-dlg-paid")).toHaveText("HK$60.00");
    await expect(depDlg.getByTestId("deposit-dlg-balance")).toHaveText("HK$10.00");

    // Edit 2nd payment ($20) -> Bank Transfer $15
    await depDlg.locator("tbody tr").nth(1).click();
    await depDlg.getByRole("button", { name: "改訂", exact: true }).click();
    await depDlg.getByRole("button", { name: "Bank Transfer", exact: true }).click();
    await depDlg.locator('input[name="depositEditAmount"]').fill("15");
    await depDlg.locator('input[name="depositEditRemarks"]').fill("paid on 26/11");
    await depDlg.getByRole("button", { name: "儲存改訂" }).click();
    await expect(depDlg.getByTestId("deposit-dlg-paid")).toHaveText("HK$55.00");
    await expect(depDlg.getByTestId("deposit-dlg-balance")).toHaveText("HK$15.00");

    // Add remaining $15 via 尾數付款, then cancel that last payment via 取消訂 -> back to Paid $55 / Balance $15
    await depDlg.getByRole("button", { name: "尾數付款" }).click();
    await expect(depDlg.getByTestId("deposit-dlg-paid")).toHaveText("HK$70.00");
    await expect(depDlg.getByTestId("deposit-dlg-balance")).toHaveText("HK$0.00");

    await depDlg.locator("tbody tr").nth(2).click();
    await depDlg.getByRole("button", { name: "取消訂", exact: true }).click();
    await expect(depDlg.getByTestId("deposit-dlg-paid")).toHaveText("HK$55.00");
    await expect(depDlg.getByTestId("deposit-dlg-balance")).toHaveText("HK$15.00");
    await depDlg.getByRole("button", { name: "離開" }).click();

    // 6. Modify same invoice in-place (保留原單號 & 保留已付訂金) + add item + set delivery date/phone/address
    await qDlg.getByRole("button", { name: "修改", exact: true }).click();
    await expect(page.getByTestId("amend-mode-banner")).toContainText(invoiceNo);
    await expect(page.getByTestId("amend-mode-banner")).toContainText("HK$55.00");

    await enterBarcodeOnPos(page, "210810"); // New net total $183, paid $55 -> balance $128
    await page.getByRole("button", { name: /送貨/ }).first().click();
    await page.getByRole("button", { name: "送貨設定 (改期/改地址)" }).click();
    const dlyDlg = page.getByRole("dialog", { name: "送貨設定" });
    await expect(dlyDlg).toBeVisible();
    await dlyDlg.locator('input[name="deliveryScheduledDate"]').fill("2026-12-05");
    await dlyDlg.locator('input[name="deliveryRecipientPhone"]').fill("91234567");
    await dlyDlg.locator('textarea[name="deliveryAddress"]').fill("Flat D, 2/F, Kennedy Court\nHong Kong");
    await dlyDlg.locator('input[name="deliveryRemarks"]').fill("Call 30 mins before");
    await dlyDlg.getByRole("button", { name: "儲存送貨設定" }).click();
    await expect(dlyDlg).not.toBeVisible();

    await page.locator('button[title="完成"]').click();
    await expect(okDlg).toBeVisible();
    await expect(okDlg).toContainText(invoiceNo); // SAME invoiceNo preserved!
    await expect(okDlg).toContainText("PARTIAL");
    await expect(okDlg).toContainText("HK$128.00"); // $55 deposit preserved!
    await okDlg.getByRole("button", { name: "離開" }).click();

    // 7. Verify isolated print portal #bill-query-print-sheet in 查單 + Delivery Note tab on /print
    await page.locator('button[title="查單"]').first().click();
    await expect(qDlg).toBeVisible();
    await qDlg.getByRole("button", { name: "未處理單" }).click();
    await qDlg.locator("tbody tr", { hasText: invoiceNo }).first().click();
    const printPortal = page.locator("#bill-query-print-sheet");
    await expect(printPortal).toContainText(invoiceNo);
    await expect(printPortal).toContainText("2026-12-05");
    await expect(printPortal).toContainText("91234567");
    await expect(printPortal).toContainText("Flat D, 2/F, Kennedy Court");
    await qDlg.getByRole("button", { name: "離開", exact: true }).click();

    await page.goto(`/invoices/${encodeURIComponent(invoiceNo)}/print`);
    await page.getByRole("button", { name: "Delivery Note (送貨單)" }).click();
    await expect(page.getByText("2026/12/05")).toBeVisible();
    await expect(page.getByText("91234567")).toBeVisible();
    await expect(page.getByText("Flat D, 2/F, Kennedy Court")).toBeVisible();
  });
});

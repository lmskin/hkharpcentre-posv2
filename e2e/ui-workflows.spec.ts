import { test, expect, type Page } from "@playwright/test";
import type { Connection } from "mysql2/promise";
import { captureDbSnapshot, openE2eMysqlConnection, restoreDbSnapshot, type DbSnapshot } from "./helpers/cleanup";

const BRIDGE_URL = "http://127.0.0.1:17889";

async function loginThroughUi(page: Page, pin = "000000") {
  await page.goto("/login");
  await page.getByRole("button", { name: "六位收銀密碼" }).click();
  await page.locator('input[maxlength="6"]').fill(pin);
  await page.getByRole("button", { name: "確定" }).click();
  await page.waitForURL("**/pos");
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

  test("UI 1: Login error 003 -> PIN login -> Barcode/UBC -> Qty/Discount/Fixed-Price 026 -> Split Tender & Drawer Kick", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator('input[type="password"]').fill("wrong-pass");
    await page.getByRole("button", { name: "確定" }).click();
    await expect(page.getByText("營運通訊息 - 003")).toBeVisible();

    await loginThroughUi(page, "000000");
    await expect(page.getByText("Central(1)")).toBeVisible();

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

    await page.getByRole("button", { name: /Master/ }).click();
    await page.getByLabel("批核碼").fill("AUTH88");
    await page.getByLabel("卡號尾四位").fill("4321");
    await page.getByRole("button", { name: /^✅/ }).click();

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
    await loginThroughUi(page, "000000");

    // Hold bill
    await enterBarcodeOnPos(page, "210810");
    await page.getByRole("button", { name: /暫停/ }).click();
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
    await page.getByRole("button", { name: /^✅/ }).click();
    const okDlg = page.getByRole("dialog", { name: "營運通訊息 - 000" });
    await expect(okDlg).toBeVisible();
    await okDlg.getByRole("button", { name: "離開" }).click();

    // Check 查單 [未處理單] -> 提貨
    await page.locator('button[title="查單"]').first().click();
    await expect(queryDlg).toBeVisible();
    await queryDlg.getByRole("button", { name: "未處理單" }).click();
    await expect(queryDlg.locator("tbody tr", { hasText: "POS-" }).first()).toBeVisible();
    await queryDlg.getByRole("button", { name: "提貨" }).click();
    await expect(queryDlg.getByText("提貨狀態：已提貨")).toBeVisible();
    await queryDlg.getByRole("button", { name: "離開" }).click();
  });

  test("UI 3: CRM Member Voucher 044 guard & Octopus 100022 Lock -> Same-Card Recovery", async ({ page }) => {
    await loginThroughUi(page, "000000");

    // Select 0-point customer 2261 (Yeung Kam Yan) + add HCOS001 -> triggers 044 modal
    await page.getByRole("button", { name: /會員/ }).click();
    await page.getByPlaceholder("搜尋", { exact: false }).fill("Yeung Kam Yan");
    await page.locator("tbody tr", { hasText: "Yeung Kam Yan" }).first().click();
    await enterBarcodeOnPos(page, "HCOS001");
    await page.getByRole("button", { name: /^✅/ }).click();
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
    await page.getByRole("button", { name: /^✅/ }).click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 100" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 100" }).getByRole("button", { name: "離開" }).click();

    // Retry same card -> approved -> submit succeeds
    await page.getByRole("button", { name: "拍卡收費" }).click();
    await expect(page.getByText(/已批准：卡/)).toBeVisible();
    await page.getByRole("button", { name: /^✅/ }).click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 000" })).toBeVisible();
  });

  test("UI 4: Issue Invoice (付款一) -> /invoices Partial Bank Transfer & Final Cheque -> Print", async ({
    page,
  }) => {
    await loginThroughUi(page, "000000");
    await enterBarcodeOnPos(page, "210810");
    await page.getByPlaceholder("條碼", { exact: true }).fill("2");
    await page.getByRole("button", { name: /數量/ }).click();
    await page.getByRole("button", { name: /方法/ }).click();
    await page.getByRole("button", { name: /付款一/ }).click();
    await page.getByRole("button", { name: /完成\(開票\)/ }).click();

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
    await loginThroughUi(page, "000000");

    // 1. 其他交易 (轉入)
    await page.getByRole("button", { name: /其他交易/ }).click();
    await page.getByRole("button", { name: "轉入", exact: true }).click();
    const officeDlg = page.getByRole("dialog", { name: "其他交易" });
    await expect(officeDlg).toBeVisible();
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
      stockDlg.getByRole("button", { name: "產生 Excel (CSV)" }).click(),
    ]);
    expect(stockDl.suggestedFilename()).toBe("stock-balances.csv");
    await stockDlg.locator("tbody tr", { hasText: "210810" }).first().click();
    const movDlg = page.getByRole("dialog", { name: "存貨異動明細" });
    await expect(movDlg).toBeVisible();
    await movDlg.getByRole("button", { name: "關閉" }).click();
    await stockDlg.getByRole("button", { name: "盤點輸入 (XC=93)" }).click();
    await stockDlg.locator("tbody tr", { hasText: "210810" }).first().locator('input[type="number"]').fill("5");
    await stockDlg.getByRole("button", { name: "確認盤點 (XC=93)" }).click();
    await expect(stockDlg.getByText(/已完成 1 項盤點更新/)).toBeVisible();
    await stockDlg.getByRole("button", { name: "離開" }).click();

    // 3. 收銀員 -> 開柜, 銀頭, 印表機設定
    await page.getByRole("button", { name: /收銀員/ }).click();
    await page.getByRole("button", { name: "開柜 (No Sale)" }).click();
    await expect(page.getByText("錢柜已開啟（No Sale）")).toBeVisible();
    await page.getByRole("button", { name: "銀頭 (Opening Float)" }).click();
    const floatDlg = page.getByRole("dialog", { name: "銀頭設定" });
    await floatDlg.locator('input[type="number"]').fill("1800");
    await floatDlg.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByText("今日銀頭已設定為 HK$1,800.00")).toBeVisible();
    await page.getByRole("button", { name: "印表機設定" }).click();
    const prtDlg = page.getByRole("dialog", { name: "印表機設定" });
    await prtDlg.getByRole("button", { name: "儲存" }).click();
    await expect(prtDlg.getByText("印表機設定已儲存")).toBeVisible();
    await prtDlg.getByRole("button", { name: "離開" }).click();

    // 4. 經理 -> 時報 + CSV export
    await page.getByRole("button", { name: /經理/ }).click();
    await page.getByRole("button", { name: "時報" }).click();
    const repDlg = page.getByRole("dialog", { name: "時報" });
    await expect(repDlg).toBeVisible();
    const [repDl] = await Promise.all([
      page.waitForEvent("download"),
      repDlg.getByRole("button", { name: "匯出 CSV" }).click(),
    ]);
    expect(repDl.suggestedFilename()).toMatch(/^hourly-/);
    await repDlg.getByRole("button", { name: "離開" }).click();

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
    await loginThroughUi(page, "000000");

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
    await page.getByRole("button", { name: /^✅/ }).click();
    await expect(page.getByRole("dialog", { name: "營運通訊息 - 999" })).toBeVisible();
    await page.getByRole("dialog", { name: "營運通訊息 - 999" }).getByRole("button", { name: "離開" }).click();
    await page.unroute("**/api/bills");

    await page.getByRole("button", { name: /收銀員/ }).click();
    await page.getByRole("button", { name: /離線單據重送 \(1\)/ }).click();
    await expect(page.getByText("已重送 1 筆離線單據，剩餘 0 筆")).toBeVisible();

    // 4. Enhanced 查單: search VIP, filter 完成單, void with 客人取消 preset -> filter 取消單
    await page.locator('button[title="查單"]').first().click();
    const queryDlg = page.getByRole("dialog", { name: "查單" });
    await expect(queryDlg).toBeVisible();
    await queryDlg.getByPlaceholder("搜尋單號 / 會員 / 電話").fill("VIP");
    await queryDlg.getByRole("button", { name: "完成單", exact: true }).click();
    await expect(queryDlg.locator("tbody tr", { hasText: "POS-" }).first()).toBeVisible();

    await queryDlg.getByRole("button", { name: "取消", exact: true }).click();
    await queryDlg.getByRole("button", { name: "客人取消", exact: true }).click();
    await queryDlg.getByRole("button", { name: "確定取消單" }).click();
    await queryDlg.getByRole("button", { name: "取消單", exact: true }).click();
    await expect(queryDlg.locator("tbody tr", { hasText: "已取消" }).first()).toBeVisible();
    await queryDlg.getByRole("button", { name: "離開" }).click();

    // 5. Manager 營業統計 (會員/職員/分類) + CSV export
    await page.getByRole("button", { name: /經理/ }).click();
    await page.getByRole("button", { name: "營業統計 (會員/職員/分類)" }).click();
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
    await loginThroughUi(page, "000000");

    // 1. Top toolbar 營業數據 opens 營運通報表中心 modal in POS without leaving /pos
    await page.locator('button[title="營業數據"]').click();
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
});

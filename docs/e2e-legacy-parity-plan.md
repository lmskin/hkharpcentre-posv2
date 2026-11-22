# Full-Stack E2E Testing & Legacy eRun V47 Parity Plan

Last updated: 2026-11-22

## 1. Purpose & Isolation Architecture

This document defines the end-to-end (E2E) test suite and legacy parity verification across all 12 functional modules comparing **Hong Kong Harp Centre POS v2** (`@hkharp/web`, `@hkharp/domain`, `@hkharp/db`, `@hkharp/etl`, `PosHardwareBridge`) against the on-prem legacy **eRun POS 330G / V47** system (`C:\eRun\POS330G.exe`, `Scratch_DataGSHarpS1V47`, `Scratch_DataGXHarpS1V47`).

### Runtime & Data Isolation Guarantees
- **Web E2E Server**: Runs production build (`next start -p 3100`) on `http://127.0.0.1:3100`, isolated from the live store server on port `3000` (`HKHarpPOS`).
- **Hardware Bridge E2E Instance**: Runs contract-verified Node.js HTTP+WebSocket bridge (`e2e/helpers/mock-bridge.ts`, validated against `@hkharp/contracts` `BridgeEventSchema`) on `http://127.0.0.1:17889`. (`npm.cmd run build:bridge` compiles `PosHardwareBridge.csproj` on counter machines with `.NET 9 SDK`; hosts with runtime-only `.NET` use `mock-bridge.ts` for E2E.)
- **Environment Variable Safety**: Every test/build shell explicitly clears inherited user-level `DATABASE_URL` and `MIGRATE_DATABASE_URL` (used by `schooltracs` on port `3307`) before loading `.env` (`hkharp_pos` on port `3306`).
- **Non-Destructive MySQL Hygiene**:
  - `hkharp` MySQL user operates on `hkharp_pos`.
  - All Day-End batch sealing E2E tests exclusively target synthetic future business date **`2099-12-31`** (never touching live store dates).
  - Test harness snapshots touched `stock_balances`, `customers.points_balance`, `staff`, `app_settings`, and `bill_sequences`, and deterministically deletes all `E2E-*` / test-created rows and `2099-12-31` batches on teardown, verified by `npm.cmd run etl:verify` (`allCountsExact: true`).

---

## 2. Module-by-Module Legacy Comparison & Gap Closure Matrix

| # | Module | Legacy eRun V47 Reference | POS v2 Implementation & Gaps Closed | E2E Verification Coverage |
|---|---|---|---|---|
| 1 | **ETL & SQL Server Read** | `Scratch_DataGSHarpS1V47` / `GXHarpS1V47` (`sqlcmd -f 65001`, `XC` codes `1,4,9,10,12,13,14,15,22,23,54,93,99`) | Fixed UTF-8 `sqlcmd` decoding in `mssql-read.ts`; mapped all `XC` codes accurately in `migrate-v47.ts` and backfilled `hkharp_pos.bills.doc_type` | `packages/etl/src/etl.test.ts`, `etl:verify`, `api-legacy-parity.spec.ts` |
| 2 | **Store & Terminal Scoping** | Active shop `SN=1` (`CENTRAL`, `shops.id=2`), active terminal `MN=1` (`terminals.id=3`), global `ProductOnSale` (`SN=0`) | Added `resolveActiveStoreContext()` so `SN=0` staff log into Central (`shop_id=2`, `terminal_id=3`); stock & catalog queries read master `products` joined to Central `stock_balances` (1,983 SKUs / 1,933 stock rows) | Login session check, `StockPanel` 1,983/1,933 counts, `bill_sequences` check |
| 3 | **Auth, RBAC & Supervisor Override** | `frmLogin1`, `StaffCounterparty TP='0'`, `SGR=1..5`, manager PIN override, password change | PIN & password auth, `003` invalid error & `audit_logs`, `managerPin` supervisor override for Void (`L4+`) and Day-End (`L4+`), password + 6-digit PIN change + audit, POS `職員` salesperson attribution (`bills.staff_id`) | `ui-workflows.spec.ts` (`/login`, `更改密碼`, salesperson), `api-legacy-parity.spec.ts` RBAC matrix |
| 4 | **Classic POS Retail Checkout** | `POS330G.exe`: barcode + `UBC`, `數量`, `項折`, `單折`, fixed price (`FP`), `選價 (025)`, `改價`, `退售 (XC=9)` | Full `PosClassicClient` flow + `UBC` lookup + `allowItemDiscount` / `isFixedPrice` guard (`026`) + direct `overrideUnitPriceHkd` (`$0.00` open-price & upward `改價`) + `DiscountReason` quick presets + `SALES_RETURN` signed accounting + ESC/POS receipt print trigger | `ui-workflows.spec.ts` POS keypad/grid/barcode/open-price/return workflows |
| 5 | **Hold, Amend & Delivery Orders** | `VMHoldBill1` (`暫停單`), `AllowAmendBill=1` (`查單 -> 修改`), `VMTdyBill1`, `CancelReason`, `AllowDelivery` (`送貨` -> `提貨`) | `暫停` saves `status='held'` without touching stock/CRM; `查單` search + date filter + `VMTdyBill1` sub-filters (`最後30單/完成單/取消單/落訂單`) + `CancelReason` presets; `修改` atomically voids & replaces; `送貨` -> `提貨` | `ui-workflows.spec.ts` Hold/Recall, Amend, `查單` filters, Void presets, Delivery -> Pickup flows |
| 6 | **Multi-Payment, Cash Drawer & Octopus 100022** | `AllowMultiPayment=1`, `PM=0..7` (`PM=3` = MasterCard), `eRunOcto` (`100022` card lock, `10¢` step, `HK$3000` max, `XFile`), offline outbox | Split tender (`加入收款` multi-tender), cash change due, `PosHardwareBridge` `/octopus/deduct` & `/octopus/simulate` `100022` lock + same-card recovery, `/octopus/settle` (`octopus_settlements`), `/drawer/open`, offline queue save + auto/manual replay | `api-legacy-parity.spec.ts` bridge WS/HTTP tests + `ui-workflows.spec.ts` split tender, `100022` recovery, offline replay |
| 7 | **CRM Members, Cards, Grades & Promotions** | `CRMRule RID=1..3` (`C1=0..2 $10/pt`, `C1=3 $100/pt`, `HCOS001 100pts`), `RWCards`, `CustGrade 0..4`, `PEng`, `MessageToCustomer` | `calculateCrmPoints`, `promotion-engine.ts` + `優惠` quick `DiscountReason` presets, customer search & Backoffice assignment of `member_cards.card_no`, pagination across 2,305 customers, grade selector, `crm_point_ledger` viewer, `MessageToCustomer` receipt footer | `ui-workflows.spec.ts` CRM earn/redeem/`044` guard + `/backoffice/customers` cardNo & pagination |
| 8 | **Invoices, Bank Transfer AR & Dual Print** | `XC=23/22` upfront invoice settled later (retiring `$0 PM=8 dlybal`), A4 & 80mm print | `SALES_INVOICE` upfront revenue + stock deduction; `/invoices` partial/full AR settlement; `/invoices/[invoiceNo]/print` interactive toggle between **A4 Formal Invoice** and **80mm Thermal Receipt** | `ui-workflows.spec.ts` `付款一` -> `/invoices` AR settlement + A4/80mm print toggle |
| 9 | **Other Transactions (`OfficeX`) & Suppliers** | `VMXact1`: `XC=1` 到貨, `XC=4` 退貨確認, `XC=13` 轉出, `XC=14` 轉入, `XC=10` 報銷, `XC=15` 調整, `XC=12` Payout, `StaffCounterparty TP='1'` | `PURCHASE_RETURN (XC=4)`, `STOCK_TRANSFER_IN (XC=14)`, `STOCK_TRANSFER_OUT (XC=13)`, supplier dropdown picker on `到貨`/`退貨確認`, `/api/suppliers` & `/backoffice/suppliers` (76 suppliers), exact signed void reversals | `api-legacy-parity.spec.ts` & `ui-workflows.spec.ts` OfficeX + suppliers + Void reversal |
| 10 | **Stock, Catalog Masters & Barcode Labels** | `StockDetailBD`, `VMStock1`, `VMStake1` (`XC=93`), `ProductOnSale` (`UBC`, `FP`), `列印條碼`, `產生 Excel` | Master catalog + Central `stock_balances` (1,983 SKUs), category filter & pagination on `StockPanel` & `/backoffice/products`, `UBC`/`fixedPrice`/`allowItemDiscount` edit, printable barcode label preview, `stock_movements` modal, `盤點 (XC=93)`, CSV export | `ui-workflows.spec.ts` `存貨` modal, movement history, `盤點`, `/backoffice/products` pagination & barcode label preview |
| 11 | **Cashier Shift & Day-End Closing** | `VMCash1` (`銀頭`, `開柜`, `轉更/日結`), `BatchHeader`, `DayendPad`, `DHSales` | Signed `issuedSalesTotal` & `collectedByTender` (subtracts `SALES_RETURN` & `PETTY_PAYOUT`), opening float (`銀頭`), shift seal blocks new bills & voids, `@hkharp/worker` `runWorkerCheck()` nightly task readiness | `api-legacy-parity.spec.ts` & `ui-workflows.spec.ts` on `2099-12-31` + worker check |
| 12 | **Manager & Backoffice Reports** | `時報`, `項報`, `歷史數據`, `VMHData1` (`會員統計`, `職員統計`), `ReportOnScreen`, `ReportG` | Signed sales & `legacy_dk > 0` across `HourlyReport`, `ItemReport`, `HistoryReport`, `ManagerStatsReport` (`會員統計`/`職員統計`/`交易及損耗紀錄`), `getOperationalReports`, plus CSV export on all reports | `ui-workflows.spec.ts` Manager reports + `營業統計` + `/backoffice/reports` + CSV download |

---

## 3. Running the E2E Suite Locally

```powershell
# Always clear inherited user-level DATABASE_URL / MIGRATE_DATABASE_URL first
$env:DATABASE_URL = $null; $env:MIGRATE_DATABASE_URL = $null

# 1. Typecheck, unit/DB/ETL tests, and 28,299-bill V47 Golden Replay
npm.cmd run typecheck
npm.cmd test

# 2. Production builds (Web + .NET x86 Hardware Bridge)
npm.cmd run build
npm.cmd run build:bridge

# 3. Run full-stack Playwright E2E suite (starts bridge on 17889 + Next.js on 3100)
npm.cmd run test:e2e

# 4. Confirm zero DB pollution against V47 SQL Server
npm.cmd run etl:verify
```

---

## 4. Latest Execution & Verification Report

Verified after all second-pass legacy V47 gap closures:
- **`npm.cmd run typecheck`**: 0 errors across all 6 workspaces (`@hkharp/contracts`, `@hkharp/db`, `@hkharp/domain`, `@hkharp/etl`, `@hkharp/web`, `@hkharp/worker`).
- **`npm.cmd test`**: **17/17** Vitest tests passed (`@hkharp/db` 3/3, `@hkharp/domain` 10/10 including 28,299-bill V47 golden-master replay, `@hkharp/etl` 4/4).
- **`npm.cmd run build`**: Production Next.js 15 build + `@hkharp/worker` typecheck succeeded with 0 errors.
- **`npm.cmd run test:e2e`**: **13/13** Playwright E2E specs passed in 22.0s (7 API/bridge/worker parity specs in `e2e/api-legacy-parity.spec.ts` + 6 Real Chrome UI specs in `e2e/ui-workflows.spec.ts`).
- **`npm.cmd run etl:verify`**: `"ok": true`, `"allCountsExact": true`, `"allNaExact": true`, `"allTendersWithinTol": true` (`delta: 0` across all 11 count metrics, 2016–2026 annual Net Amount sums, and PM=0..7 tender totals).

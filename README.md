# Hong Kong Harp Centre POS v2 (`hkharpcentre-pos-v2`)

On-prem replacement for legacy **eRun POS 330G / V47** built with **React 19, Next.js 15 (App Router), Drizzle ORM + MySQL 8**, and a local Windows 32-bit (`win-x86`) **.NET Hardware Bridge** for the counter **Octopus RWL reader** (`rwl.dll` + `OSDXC.exe`) and **ESC/POS receipt printer + cash drawer**.

## Locked-In Domain & Hardware Scope

1. **Payment Methods**:
   - **Cash (`PM=0`)**
   - **Octopus (`PM=1`)**: Integrated via `apps/pos-hardware-bridge` (`32-bit rwl.dll`, 10-cent divisibility check, mandatory `100022` incomplete-tap same-CardID recovery, nightly `XFile` + `OSDXC.exe`).
   - **Credit Cards (`Visa PM=2`, `MasterCard PM=3`, `UnionPay PM=4`, `AE PM=6`)**: Recorded from standalone bank card terminals with optional approval code and masked last-4 capture (`PM=3` is authoritatively **MasterCard**, overriding legacy `CustomerData` `AliPay` mislabeling). Optional PAX S60/A920 ECR adapter retained behind `ENABLE_INTEGRATED_PAX_EDC`.
   - **Bank Transfer (`PM=5`) & Cheque (`PM=7`)**: First-class Accounts Receivable settlement tenders.
2. **Issue Invoice First → Settle Later by Bank Transfer**:
   - Staff issue formal **`UNPAID` / `PARTIAL` invoices** upfront (`issued_at` recognizes sales revenue and deducts stock once; no `$0 PM=8 dlybal` dummy payment rows).
   - Customers pay later by **Bank Transfer (`PM=5`)** or **Cheque (`PM=7`)**; staff settle open balances in `/invoices` (`paid_at` reconciles day-end bank/cheque collections without double-counting sales).

## Monorepo Layout

```text
apps/
  web/                    # Next.js 15 App Router (POS Counter, Invoice AR Settlement, Back Office, API routes)
  worker/                 # Node.js background service (stock/cost checks, EOD audit, MySQL dump, OSDXC trigger)
  pos-hardware-bridge/    # .NET (win-x86) Windows Service on 127.0.0.1:17880 (rwl.dll Octopus + ESC/POS + Drawer)
packages/
  contracts/              # Shared Zod DTOs & hardware-bridge WebSocket/HTTP contracts
  domain/                 # Pure TS pricing, POSRound, bill math, CRM RID=1..3, Octopus 100022, & AR state machines
  db/                     # Drizzle ORM MySQL 8 schema (InnoDB, utf8mb4_0900_as_ci, DECIMAL(18,4)) & FOR UPDATE sequences
  etl/                    # Read-only V47 SQL Server (Scratch_Data*V47) -> MySQL 8 audit & migration toolkit
```

## Quick Start

```powershell
# 1. Install dependencies (Node 22/24 LTS)
npm install

# 2. Run TypeScript checks across all workspaces
npm run typecheck

# 3. Run unit tests + V47 SQL Server Golden-Master Replay (28,285 XC=99 bills)
npm test
npm run test:golden

# 4. Run read-only V47 SQL Server ETL readiness audit
npm run etl:audit

# 5. Build Next.js web app & .NET win-x86 Octopus hardware bridge
npm run build
npm run build:bridge

# 6. Start local development server
npm run dev
```

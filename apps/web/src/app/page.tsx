import Link from "next/link";
import { getDashboardSummary, pingMySqlHealth } from "@hkharp/db";
import { formatHkd } from "@hkharp/domain/money";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [health, summary] = await Promise.all([pingMySqlHealth(), getDashboardSummary()]);

  const cards = [
    {
      label: "Migrated Catalog SKUs",
      value: summary ? summary.productCount.toLocaleString() : "0",
      sub: "ProductOnSale (MySQL 8)",
      href: "/backoffice/products",
    },
    {
      label: "Migrated Customers",
      value: summary ? summary.customerCount.toLocaleString() : "0",
      sub: "CRM Members & Balances",
      href: "/backoffice/customers",
    },
    {
      label: "Total Historical + Live Bills",
      value: summary ? summary.billCount.toLocaleString() : "0",
      sub: "HistHeader + OfficeX + V2",
      href: "/pos",
    },
    {
      label: "Open Unpaid Invoices (AR)",
      value: summary ? `${summary.openArCount.toLocaleString()} · ${formatHkd(summary.openArTotalHkd)}` : "HK$0.00",
      sub: "Issue First -> Bank Transfer PM=5",
      href: "/invoices",
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
              On-Prem Production Stack · React 19 + Next.js 15 + MySQL {health.mysqlVersion ?? "8.0"}
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">
              Hong Kong Harp Centre — POS &amp; Back Office
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Live MySQL 8 operations for Retail POS (XC=99), PC Octopus RWL Reader (`PM=1`), Standalone Bank
              Terminals (`Visa PM=2`, `MasterCard PM=3`, `UnionPay PM=4`, `AE PM=6`), and Issue Invoice →
              Bank Transfer (`PM=5`) / Cheque (`PM=7`) Accounts Receivable.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 space-y-1">
            <div>
              <span className="font-semibold">MySQL 8:</span>{" "}
              {health.connected ? (
                <span className="font-semibold text-emerald-700">ONLINE ({health.tableCount} tables)</span>
              ) : (
                <span className="font-semibold text-rose-700">OFFLINE</span>
              )}
            </div>
            <div>
              <span className="font-semibold">Octopus Bridge:</span> 127.0.0.1:17880 (win-x86)
            </div>
            <div>
              <span className="font-semibold">Today ({summary?.todayBusinessDate}):</span> Issued{" "}
              {formatHkd(summary?.todayIssuedSalesHkd ?? 0)} · Collected{" "}
              {formatHkd(summary?.todayCollectedPaymentsHkd ?? 0)}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-indigo-400"
          >
            <div className="text-xs font-medium text-slate-500">{c.label}</div>
            <div className="mt-1 font-mono text-xl font-bold text-slate-900">{c.value}</div>
            <div className="mt-1 text-xs text-slate-500">{c.sub}</div>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Link
          href="/pos"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-indigo-500"
        >
          <h2 className="font-semibold text-slate-900">1. Open POS Counter</h2>
          <p className="mt-1 text-xs text-slate-600">
            Search all 1,983 SKUs &amp; V47 Menu groups, apply CRM points, take Octopus / Standalone Cards / Cash,
            or Issue Unpaid Invoices.
          </p>
        </Link>
        <Link
          href="/invoices"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-indigo-500"
        >
          <h2 className="font-semibold text-slate-900">2. Settle Invoices by Bank Transfer</h2>
          <p className="mt-1 text-xs text-slate-600">
            Print customer invoices with HSBC/FPS instructions and record later Bank Transfer (`PM=5`) or Cheque
            (`PM=7`) settlements.
          </p>
        </Link>
        <Link
          href="/backoffice/day-end"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-indigo-500"
        >
          <h2 className="font-semibold text-slate-900">3. Day-End, Stock &amp; Reports</h2>
          <p className="mt-1 text-xs text-slate-600">
            Manage stock receiving/adjustments, close daily shifts separating sales vs collections, and export
            reports.
          </p>
        </Link>
      </section>
    </div>
  );
}

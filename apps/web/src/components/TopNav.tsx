"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionPayload } from "@hkharp/db";

const NAV_LINKS = [
  { href: "/", label: "POS" },
  { href: "/invoices", label: "Invoices & AR" },
  { href: "/backoffice/products", label: "Products" },
  { href: "/backoffice/customers", label: "Customers" },
  { href: "/backoffice/suppliers", label: "Suppliers" },
  { href: "/backoffice/stock", label: "Stock" },
  { href: "/backoffice/other-transactions", label: "Other Transactions" },
  { href: "/backoffice/day-end", label: "Day-End" },
  { href: "/backoffice/reports", label: "Reports" },
  { href: "/backoffice/settings", label: "Settings" },
];

export function TopNav({ session, authRequired = false }: { session: SessionPayload | null; authRequired?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(authRequired ? "/login" : "/");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-base font-bold tracking-tight text-slate-900">
          HK Harp Centre · POS v2
        </Link>
        <nav className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-700">
          {NAV_LINKS.map((item) => {
            const active = item.href === "/" ? pathname === "/" || pathname.startsWith("/pos") : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-2.5 py-1.5 transition ${
                  active ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 text-xs">
          {session ? (
            <>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">
                {session.displayName} (L{session.roleLevel}{authRequired ? "" : " · Dev"})
              </span>
              {authRequired ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50"
                >
                  Sign out
                </button>
              ) : null}
            </>
          ) : authRequired ? (
            <Link
              href="/login"
              className="rounded-md bg-indigo-600 px-3 py-1.5 font-semibold text-white hover:bg-indigo-700"
            >
              Staff Sign In
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}

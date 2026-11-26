"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionPayload } from "@hkharp/db";
import { hasPosUnsavedWork, setPosUnsavedWork } from "@/components/WindowCloseGuard";

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
  const [confirmHref, setConfirmHref] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  async function executeLogout() {
    setPosUnsavedWork(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(authRequired ? "/login" : "/");
    router.refresh();
  }

  function handleNavClick(e: React.MouseEvent, href: string) {
    if ((pathname === "/" || pathname.startsWith("/pos")) && href !== pathname && hasPosUnsavedWork()) {
      e.preventDefault();
      setConfirmHref(href);
    }
  }

  return (
    <>
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/"
            onClick={(e) => handleNavClick(e, "/")}
            className="text-base font-bold tracking-tight text-slate-900"
          >
            HK Harp Centre · POS v2
          </Link>
          <nav className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-700">
            {NAV_LINKS.map((item) => {
              const active = item.href === "/" ? pathname === "/" || pathname.startsWith("/pos") : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => handleNavClick(e, item.href)}
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
                    onClick={() => setConfirmLogout(true)}
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

      {confirmHref || confirmLogout ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="確定離開"
        >
          <div className="w-[380px] border-2 border-[#0a246a] bg-[#ece9d8] text-xs text-black shadow-2xl">
            <div className="bg-[#0a246a] px-3 py-1 font-bold text-white">確定離開</div>
            <div className="p-4 text-[13px]">
              目前仍有處理中的開單或修改內容，確定要離開嗎？未儲存的變更將會消失。
            </div>
            <div className="flex justify-end gap-2 border-t border-[#aca899] p-2">
              <button
                type="button"
                onClick={() => {
                  const target = confirmHref;
                  const doLogout = confirmLogout;
                  setConfirmHref(null);
                  setConfirmLogout(false);
                  if (doLogout) {
                    void executeLogout();
                  } else if (target) {
                    setPosUnsavedWork(false);
                    router.push(target);
                  }
                }}
                className="border border-[#808080] bg-[#ece9d8] px-4 py-1 font-bold text-[#c00000] hover:bg-white"
              >
                確定離開
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setConfirmHref(null);
                  setConfirmLogout(false);
                }}
                className="border border-[#808080] bg-[#e1dfff] px-4 py-1 font-bold hover:bg-white"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

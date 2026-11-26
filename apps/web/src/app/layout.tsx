import type { Metadata } from "next";
import { getCurrentSession, isAuthRequired } from "@/lib/session";
import { TopNav } from "@/components/TopNav";
import { WindowCloseGuard } from "@/components/WindowCloseGuard";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hong Kong Harp Centre POS v2",
  description: "On-prem POS, Octopus RWL Bridge, and Issue-Invoice -> Bank Transfer AR System",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getCurrentSession();
  const authRequired = isAuthRequired();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <WindowCloseGuard />
        <TopNav session={session} authRequired={authRequired} />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

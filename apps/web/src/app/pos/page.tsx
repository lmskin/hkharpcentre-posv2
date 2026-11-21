import { listCatalogProducts, listPosMenusWithButtons, searchCustomers } from "@hkharp/db";
import { getCurrentSession } from "@/lib/session";
import { PosRegisterClient } from "@/components/PosRegisterClient";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const [session, menus, initialProducts, initialCustomers] = await Promise.all([
    getCurrentSession(),
    listPosMenusWithButtons(),
    listCatalogProducts(60),
    searchCustomers({ limit: 20 }),
  ]);

  return (
    <PosRegisterClient
      session={session}
      menus={menus}
      initialProducts={initialProducts ?? []}
      initialCustomers={initialCustomers}
      bridgeUrl={process.env.NEXT_PUBLIC_HARDWARE_BRIDGE_URL ?? "http://127.0.0.1:17880"}
      bridgeToken={session ? (process.env.HARDWARE_BRIDGE_TOKEN ?? "dev-local-bridge-token-change-me") : ""}
    />
  );
}

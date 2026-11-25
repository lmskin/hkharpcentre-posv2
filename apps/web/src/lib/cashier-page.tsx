import { listCatalogProducts, listPosMenusWithButtons, resolveActiveStoreContext, searchCustomers } from "@hkharp/db";
import { getCurrentSession, isAuthRequired } from "@/lib/session";
import { PosClassicClient } from "@/components/PosClassicClient";
import { STARTER_CATALOG } from "@/lib/sample-catalog";

/** Loads initial catalog/CRM/menu data and renders the Classic Cashier till. */
export async function renderCashierPage() {
  const [session, storeContext, menus, initialProducts, initialCustomers] = await Promise.all([
    getCurrentSession(),
    resolveActiveStoreContext().catch(() => null),
    listPosMenusWithButtons().catch(() => []),
    listCatalogProducts(60).catch(() => null),
    searchCustomers({ limit: 20 }).catch(() => []),
  ]);

  return (
    <PosClassicClient
      session={session}
      authRequired={isAuthRequired()}
      storeContext={storeContext}
      menus={menus}
      initialProducts={initialProducts ?? STARTER_CATALOG.map((item) => ({ ...item, excludeFromCrmBonus: false }))}
      initialCustomers={initialCustomers}
      bridgeUrl={
        process.env.HARDWARE_BRIDGE_URL ??
        process.env.NEXT_PUBLIC_HARDWARE_BRIDGE_URL ??
        "http://127.0.0.1:17880"
      }
      bridgeToken={session ? (process.env.HARDWARE_BRIDGE_TOKEN ?? "dev-local-bridge-token-change-me") : ""}
    />
  );
}

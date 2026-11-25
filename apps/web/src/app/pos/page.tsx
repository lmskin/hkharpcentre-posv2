import { renderCashierPage } from "@/lib/cashier-page";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  return renderCashierPage();
}

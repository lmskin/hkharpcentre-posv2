import { listInvoices } from "@hkharp/db";
import { InvoiceSettlementClient, type InvoiceListItem } from "@/components/InvoiceSettlementClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const initialInvoices = (await listInvoices({ statusFilter: "open", limit: 60 })) as InvoiceListItem[];
  return <InvoiceSettlementClient initialInvoices={initialInvoices} />;
}

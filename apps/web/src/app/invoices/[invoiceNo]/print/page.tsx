import { notFound } from "next/navigation";
import { getInvoiceDetailByNo } from "@hkharp/db";
import { PrintableDocumentView } from "@/components/PrintableDocumentView";

export const dynamic = "force-dynamic";

export default async function PrintableInvoicePage({
  params,
}: {
  params: Promise<{ invoiceNo: string }>;
}) {
  const { invoiceNo } = await params;
  const detail = await getInvoiceDetailByNo(decodeURIComponent(invoiceNo));
  if (!detail) notFound();

  return <PrintableDocumentView detail={detail} />;
}

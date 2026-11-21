import { and, eq, sql } from "drizzle-orm";
import type { BillDocType } from "@hkharp/contracts";
import { billSequences } from "./schema/sales-ar";
import type { HarpDb } from "./client";

/**
 * Allocates the next monotonic invoice/receipt number using MySQL row-level locking
 * (SELECT ... FOR UPDATE equivalent inside db.transaction).
 */
export async function allocateNextDocumentNumber(
  db: HarpDb,
  params: { shopId: number; terminalId: number; docType: BillDocType; prefix: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(billSequences)
      .where(
        and(
          eq(billSequences.shopId, params.shopId),
          eq(billSequences.terminalId, params.terminalId),
          eq(billSequences.docType, params.docType),
        ),
      )
      .for("update");

    let seq = 1;
    if (existing.length === 0) {
      await tx.insert(billSequences).values({
        shopId: params.shopId,
        terminalId: params.terminalId,
        docType: params.docType,
        nextSeq: 2,
      });
    } else {
      seq = existing[0]!.nextSeq;
      await tx
        .update(billSequences)
        .set({ nextSeq: sql`${billSequences.nextSeq} + 1` })
        .where(eq(billSequences.id, existing[0]!.id));
    }

    return `${params.prefix}-${String(params.shopId).padStart(2, "0")}${String(params.terminalId).padStart(2, "0")}-${String(seq).padStart(7, "0")}`;
  });
}

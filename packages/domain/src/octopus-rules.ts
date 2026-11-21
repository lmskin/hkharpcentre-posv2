/**
 * Octopus RWL Business & Incomplete-Transaction (100022) Rules
 * Derived from eRunOcto.dll static inspection + rwl.dll boundary.
 */

export const OCTOPUS_MAX_VALUE_HKD = 3000;
export const OCTOPUS_INCOMPLETE_TXN_CODE = 100022;

export function validateOctopusAmountHkd(amountHkd: number): { ok: true; amountCents: number } | { ok: false; reason: string } {
  if (!Number.isFinite(amountHkd) || amountHkd <= 0) {
    return { ok: false, reason: "Octopus deduction must be positive" };
  }
  const amountCents = Math.round((amountHkd + 1e-9) * 100);
  if (Math.abs(amountCents - amountHkd * 100) > 1e-4) {
    return { ok: false, reason: "Octopus deduction cannot contain fractions of a cent" };
  }
  if (amountCents % 10 !== 0) {
    return { ok: false, reason: "Deduction only multiply of 10 cents allowed" };
  }
  if (amountHkd > OCTOPUS_MAX_VALUE_HKD) {
    return { ok: false, reason: `Deduction exceeds Octopus maximum HK$${OCTOPUS_MAX_VALUE_HKD}` };
  }
  return { ok: true, amountCents };
}

export type OctopusAttemptState =
  | { status: "READY" }
  | { status: "INCOMPLETE_LOCKED_100022"; billRef: string; lockedCardId: string; amountCents: number }
  | { status: "APPROVED"; billRef: string; cardId: string; deductedCents: number; remainingCents: number };

export type OctopusReaderResult =
  | { code: 0; cardId: string; remainingCents: number }
  | { code: typeof OCTOPUS_INCOMPLETE_TXN_CODE; cardId: string }
  | { code: number; message: string };

export function handleOctopusResult(
  prevState: OctopusAttemptState,
  billRef: string,
  amountCents: number,
  result: OctopusReaderResult,
): { nextState: OctopusAttemptState; canCancelBill: boolean; message: string } {
  if ("message" in result) {
    // Note: While locked in 100022 recovery, non-0/non-100022 transient reader errors keep bill locked until safe retry or manager intervention
    return {
      nextState: prevState.status === "INCOMPLETE_LOCKED_100022" ? prevState : { status: "READY" },
      canCancelBill: prevState.status !== "INCOMPLETE_LOCKED_100022",
      message: `Octopus error (${result.code}): ${result.message}`,
    };
  }

  if (result.code === OCTOPUS_INCOMPLETE_TXN_CODE) {
    return {
      nextState: {
        status: "INCOMPLETE_LOCKED_100022",
        billRef,
        lockedCardId: result.cardId,
        amountCents,
      },
      canCancelBill: false,
      message:
        "+++DO NOT CANCEL THE TXN+++ Transaction Incomplete! Please request customer to present the same card again (100022).",
    };
  }

  if (
    prevState.status === "INCOMPLETE_LOCKED_100022" &&
    prevState.lockedCardId &&
    result.cardId !== prevState.lockedCardId
  ) {
    return {
      nextState: prevState,
      canCancelBill: false,
      message: `Card ID mismatch during 100022 retry: expected ${prevState.lockedCardId}, got ${result.cardId}. Present the same card again.`,
    };
  }

  return {
    nextState: {
      status: "APPROVED",
      billRef,
      cardId: result.cardId,
      deductedCents: amountCents,
      remainingCents: result.remainingCents,
    },
    canCancelBill: false,
    message: "Octopus payment approved",
  };
}

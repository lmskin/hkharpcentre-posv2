/**
 * Exact TypeScript equivalent of eRunCommon.POSRound & RoundType:
 * Supported increments: 0.01, 0.1, 0.5, 1, 10, 100
 * Round modes: Down (10/"D"), Up (20/"U"), RAwayFromZero (30/"R"), Undefine (40)
 */

export type PosRoundMode = "D" | "U" | "R" | "NONE";
export type PosRoundUnit = 0.01 | 0.1 | 0.5 | 1 | 10 | 100;

export interface PosRoundRule {
  unit: PosRoundUnit;
  mode: PosRoundMode;
}

export function parsePosRoundSpec(spec: string): PosRoundRule {
  const clean = spec.trim().toUpperCase();
  if (clean === "1U") return { unit: 0.1, mode: "U" }; // eRun CustomerData BillItemRound='1U' (10-cent retail decimal=1)
  if (clean === "1D") return { unit: 0.1, mode: "D" };
  if (clean === "10U") return { unit: 1, mode: "U" };
  if (clean === "10D") return { unit: 1, mode: "D" };

  const match = clean.match(/^(\d+(?:\.\d+)?)([DUR])$/);
  if (!match) return { unit: 0.1, mode: "NONE" };
  const rawNum = Number(match[1]);
  const mode = match[2] as PosRoundMode;
  const unit: PosRoundUnit =
    rawNum === 0.01 || rawNum === 0.1 || rawNum === 0.5 || rawNum === 1 || rawNum === 10 || rawNum === 100
      ? rawNum
      : 0.1;
  return { unit, mode };
}

export function posRound(value: number, unit: PosRoundUnit, mode: PosRoundMode): number {
  if (!Number.isFinite(value) || mode === "NONE") return value;
  const factor = Math.round(1 / unit);
  const eps = 1e-9;

  // Work in scaled unit steps to eliminate binary floating-point edge flips
  const steps = unit >= 1 ? value / unit : value * factor;

  let roundedSteps: number;
  if (mode === "D") {
    roundedSteps = steps >= 0 ? Math.floor(steps + eps) : Math.ceil(steps - eps);
  } else if (mode === "U") {
    roundedSteps = steps >= 0 ? Math.ceil(steps - eps) : Math.floor(steps + eps);
  } else {
    // Away from zero at half
    const absSteps = Math.abs(steps);
    const floored = Math.floor(absSteps + eps);
    const frac = absSteps - floored;
    roundedSteps = (frac >= 0.5 - eps ? floored + 1 : floored) * (steps < 0 ? -1 : 1);
  }

  return unit >= 1 ? roundedSteps * unit : Number((roundedSteps / factor).toFixed(4));
}

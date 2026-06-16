import { FORMULAS, getFormula } from "./registry";
import {
  AMAZING_SPIRE,
  BICOMPLEX_DRIFT,
  BLOOM_BULB,
  BUBBLE_FOAM,
  BUBBLE_ORB,
  CORAL_BLOOM,
  CROSS_VAULT,
  DIAMOND_LATTICE,
  FOAM_ORB,
  FROZEN_BLOOM,
  KLEINIAN_SANCTUM,
  LATTICE_BASTION,
  REEF_SPIRES,
  SPONGE_BALL,
  TAFFY_BLOOM,
  TETRA_GASKET,
  THORN_RELIQUARY,
  WISP_BLOOM,
} from "./shapes";
import type { FormulaSettings, FractalFormulaId, FractalShape } from "./types";

/**
 * Shape generator (ADR-0011): pure random rolling and mutation over the formula
 * registry's parameter schemas. No engine or state access - the controller snapshots
 * the live shape, calls in here, and applies the result.
 */

/** [0,1) source, injectable for deterministic tests. Defaults to Math.random. */
export type Rng = () => number;

export interface GeneratorLocks {
  /** Param keys whose current live values must be kept. */
  readonly params: ReadonlySet<string>;
  readonly iterations: boolean;
}

/**
 * Per-formula framing/march/trap baseline for generated shapes. Camera, focus, render
 * quality, and the trap mapping are all formula-dependent (an apollonian's raw trap
 * range is ~5x a mandelbox's), so each formula borrows them from a curated shape with
 * a generic outside-looking framing. None has a `dive`, so generated shapes are
 * top-level.
 */
export const GENERATOR_BASELINES: Record<FractalFormulaId, FractalShape> = {
  mandelbox: REEF_SPIRES,
  mandelbulb: BLOOM_BULB,
  apollonian: BUBBLE_FOAM,
  menger: LATTICE_BASTION,
  kifs: THORN_RELIQUARY,
  quatjulia: TAFFY_BLOOM,
  kleinian: KLEINIAN_SANCTUM,
  juliabulb: FROZEN_BLOOM,
  amazingbox: AMAZING_SPIRE,
  sierpinski: TETRA_GASKET,
  octahedral: DIAMOND_LATTICE,
  crossmenger: CROSS_VAULT,
  bicomplex: BICOMPLEX_DRIFT,
  trigbulb: WISP_BLOOM,
  spherepack: BUBBLE_ORB,
  mengersphere: SPONGE_BALL,
  kleinsphere: FOAM_ORB,
  coral: CORAL_BLOOM,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Snap to the param's step grid (anchored at min) so rolled values read tidily. */
const snapToStep = (value: number, min: number, step: number): number =>
  min + Math.round((value - min) / step) * step;

export function rollShape(args: {
  readonly formula: FractalFormulaId | "any";
  /** Live shape snapshot - supplies locked values and the lock-eligibility formula. */
  readonly current: FractalShape;
  readonly locks: GeneratorLocks;
  readonly rng?: Rng;
}): FractalShape {
  const rng = args.rng ?? Math.random;
  const resolved =
    args.formula === "any"
      ? (FORMULAS[Math.floor(rng() * FORMULAS.length)]?.id ?? args.current.formula)
      : args.formula;
  const def = getFormula(resolved);
  // Locks only mean something while the schema is the same one they were set against:
  // a mandelbox "scale" and an apollonian "scale" share a key but not a range.
  const locksApply = resolved === args.current.formula;
  const values = Object.fromEntries(
    def.params.map((param) => {
      const locked = locksApply && args.locks.params.has(param.key);
      const value = locked
        ? (args.current.formulaSettings.values[param.key] ?? param.defaultValue)
        : snapToStep(param.min + rng() * (param.max - param.min), param.min, param.step);
      return [param.key, clamp(value, param.min, param.max)];
    }),
  );
  const { min: itMin, max: itMax } = def.iterations;
  const iterations =
    locksApply && args.locks.iterations
      ? clamp(Math.round(args.current.formulaSettings.iterations), itMin, itMax)
      : itMin + Math.floor(rng() * (itMax - itMin + 1));
  // Deep-clone the baseline: a shallow spread would share its `camera`/`render`/`trap`/`warp`
  // sub-objects by reference with the curated constant, so any later in-place edit of a
  // generated shape would silently mutate the curated default for the whole session.
  return {
    ...structuredClone(GENERATOR_BASELINES[resolved]),
    id: "",
    name: `Generated ${def.name}`,
    description: "",
    formulaSettings: { iterations, values },
  };
}

export function mutateFormulaSettings(
  formula: FractalFormulaId,
  current: FormulaSettings,
  /** 0..1; each unlocked param moves by (2·rng−1)·strength·(max−min), clamped. */
  strength: number,
  locks: GeneratorLocks,
  rng: Rng = Math.random,
): FormulaSettings {
  const def = getFormula(formula);
  const values = Object.fromEntries(
    def.params.map((param) => {
      const base = current.values[param.key] ?? param.defaultValue;
      if (locks.params.has(param.key) || strength === 0) return [param.key, base];
      const moved = base + (2 * rng() - 1) * strength * (param.max - param.min);
      return [param.key, clamp(snapToStep(moved, param.min, param.step), param.min, param.max)];
    }),
  );
  const { min: itMin, max: itMax } = def.iterations;
  const iterations =
    locks.iterations || strength === 0
      ? current.iterations
      : clamp(
          Math.round(current.iterations + (2 * rng() - 1) * strength * (itMax - itMin)),
          itMin,
          itMax,
        );
  return { iterations, values };
}

import { clampChain, frameFromExtent, probeChainExtent } from "./chain";
import { FORMULAS, getFormula } from "./registry";
import { getTransform, TRANSFORM_LIST } from "./transforms";
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
import type { TransformId } from "./transforms";
import type { FormulaChain, FormulaSettings, FractalFormulaId, FractalShape } from "./types";

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

// Smallest scale magnitude that drives divergence: below this the scale+addC iterate contracts
// to a fixed point (dr stops growing) and no surface forms. Matches the rendered-shape evidence.
const MIN_DRIVER_SCALE = 1.3;

/**
 * Roll a random hybrid formula chain (hybrid-formula-chains design, Phase 2): 2-4 stages of
 * random transforms with params drawn from each transform's schema. addC is always on (escape-time
 * reinjection); a chain with a bulb lobe gets a finite bailout (and may use the sharper log DE),
 * pure fold/IFS chains run unbounded under the linear DE. The result is clamped to registry-safe
 * ranges.
 *
 * The first stage is always a derivative-growing DRIVER - a bulb power, or a scale with magnitude
 * past MIN_DRIVER_SCALE. This is the renderability hinge: the chain DE is length(p)/dr, so without
 * something to grow dr (folds, rotations and lattice reflections are isometries that leave dr~=1)
 * the DE stays a bounded constant that never resolves to a surface and nothing renders. Forcing a
 * driver roughly halves the dead-roll rate; rollChainShape re-rolls away the remainder.
 */
export function rollChain(rng: Rng = Math.random): FormulaChain {
  const ids = TRANSFORM_LIST.map((t) => t.id);
  const length = 2 + Math.floor(rng() * 3); // 2..4 stages
  const rollStage = (id: TransformId) => ({
    transform: id,
    values: Object.fromEntries(
      getTransform(id).params.map((p) => [
        p.key,
        snapToStep(p.min + rng() * (p.max - p.min), p.min, p.step),
      ]),
    ),
  });
  // Driver: a bulb power, or a scale forced past the divergence threshold (random sign), clamped
  // to the scaleAddC schema range.
  const rollDriver = () => {
    if (rng() < 0.5) return rollStage("bulbPow");
    const def = getTransform("scaleAddC").params[0]!;
    const signed = (rng() < 0.5 ? 1 : -1) * (MIN_DRIVER_SCALE + rng() * (3 - MIN_DRIVER_SCALE));
    return {
      transform: "scaleAddC" as TransformId,
      values: { scale: clamp(snapToStep(signed, def.min, def.step), def.min, def.max) },
    };
  };
  const stages = [rollDriver()];
  // Cap bulb stages at one: two+ bulbPow stages compound within a single iteration
  // ((p^8)^8...) and overflow to Inf/NaN before the next iteration's bailout check fires - a
  // garbage DE (~0.5% of unconstrained rolls). One bulb, bounded by the bailout, is well-behaved.
  for (let i = 1; i < length; i += 1) {
    const hasBulb = stages.some((s) => s.transform === "bulbPow");
    const pool = hasBulb ? ids.filter((id) => id !== "bulbPow") : ids;
    stages.push(rollStage(pool[Math.floor(rng() * pool.length)]!));
  }
  const hasBulb = stages.some((s) => s.transform === "bulbPow");
  const chain: FormulaChain = {
    stages,
    iterations: 24 + Math.floor(rng() * 40), // 24..63: well into the raised cap
    addC: true,
    bailout: hasBulb ? 2 + rng() * 6 : Infinity,
    deForm: hasBulb && rng() < 0.5 ? "log" : "linear",
  };
  // rollStage always yields registry-valid stages, so clampChain never returns null here.
  return clampChain(chain) ?? chain;
}

/**
 * Seed a chain's orbit-trap mapping (design §4): the raw trap range depends on the operator
 * mix, so a fresh chain borrows the trap of the curated shape whose DE family it most
 * resembles - a bulb lobe traps like the Mandelbulb, everything else like the Mandelbox.
 */
export function seedChainTrap(chain: FormulaChain): { scale: number; power: number } {
  const ref = chain.stages.some((s) => s.transform === "bulbPow") ? BLOOM_BULB : REEF_SPIRES;
  return { scale: ref.trap.scale, power: ref.trap.power };
}

/**
 * Roll a complete generated hybrid-chain shape: a random chain on a generic outside-looking
 * baseline, with a seeded trap. The atomic `formula` is left as the baseline's (the
 * best-effort fallback for builds without chain support).
 */
// Acceptance for a generated chain, scored on the render-march visibility of its frame (not just
// the conservative geometry probe): the probe can resolve a surface the renderer's coarser step
// tunnels through, so a roll only counts as "good" once it actually fills a sensible slice of the
// framed view and isn't sitting on/inside the surface.
const MIN_COVERAGE = 0.08; // below this the shape is a speck / empty on screen
const MIN_CENTER_FRAC = 0.04; // below this the camera is on/inside the surface (dark)
const MAX_ROLL_TRIES = 8;

/** Visibility score of a probed extent: 0 if it doesn't render, else its on-screen coverage. */
function renderScore(ext: ReturnType<typeof probeChainExtent>): number {
  if (!ext || ext.hitFrac < 0.1) return 0;
  if (ext.coverage < MIN_COVERAGE || ext.centerFrac < MIN_CENTER_FRAC) return 0;
  return ext.coverage;
}

export function rollChainShape(rng: Rng = Math.random): FractalShape {
  // Re-roll past chains that frame poorly: even with a forced driver, a fraction of rolls produce a
  // DE the renderer shows as a speck, empty, or only from inside (dark). Probe each roll, predict
  // its on-screen visibility, and keep the first that renders well - or the best seen after a few
  // tries so generation always returns something.
  let chain = rollChain(rng);
  let ext = probeChainExtent(chain);
  let bestScore = renderScore(ext);
  let best = chain;
  let bestExt = ext;
  for (let tries = 1; tries < MAX_ROLL_TRIES && bestScore <= 0; tries += 1) {
    chain = rollChain(rng);
    ext = probeChainExtent(chain);
    const score = renderScore(ext);
    if (score > bestScore) {
      bestScore = score;
      best = chain;
      bestExt = ext;
    }
  }
  // Auto-frame from the chain's own surface: the mandelbox baseline's camera doesn't fit an
  // arbitrary rolled chain (different scale/centre), so frame to fit instead of inheriting it.
  const camera = bestExt
    ? frameFromExtent(bestExt)
    : {
        target: [0, 0, 0] as [number, number, number],
        yaw: -0.72,
        pitch: -0.2,
        distance: 6,
        fov: 45,
      };
  return {
    ...structuredClone(GENERATOR_BASELINES.mandelbox),
    id: "",
    name: "Generated Hybrid",
    description: "",
    chain: best,
    trap: seedChainTrap(best),
    camera,
    focusDistance: camera.distance,
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

import { getTransform, TRANSFORM_LIST } from "./transforms";
import type { ChainState, TransformId } from "./transforms";
import type { ChainStage, FormulaChain } from "./types";

/**
 * Hybrid formula chain codegen + interpretation (hybrid-formula-chains design, Phase 0).
 *
 * A chain is an ordered list of transforms (transforms.ts) applied per iteration. This
 * module turns one `FormulaChain` into the two things the engine needs, from the SAME
 * object so they cannot structurally drift:
 *
 *   compileChainDE(chain) -> a WGSL `formulaDE` string, drop-in for the registry's atomic
 *     DEs (the existing buildRenderSampleWGSL path is unchanged downstream). Stage params
 *     are read from the `gStageP` uniform array, so value tweaks are uniforms (no recompile)
 *     - only structural edits (add/remove/reorder/addC/bailout/deForm) change this string.
 *
 *   chainDe(chain, x, y, z) -> an f64 distance, the CPU mirror the DiveController marches
 *     (interpreting the same transforms in the same order, no per-chain hand-port).
 *
 * Re-expressing an atomic formula as a canned chain reproduces its DE exactly (proven for
 * mandelbox/mandelbulb in chain.test.ts): the per-iteration `p`/`dr` evolution is identical,
 * so the distance matches to f64 precision.
 */

/** Max chain stages, bounding shader size/compile time and the gStageP uniform array. */
export const CHAIN_MAX_STAGES = 8;

/** Raised iteration cap for chains (design §3.5) - well above the atomic formulas' 4-24. */
export const CHAIN_MAX_ITERATIONS = 128;

/**
 * Escape radius a chain with a bulb stage falls back to when none is set. A bulb iteration
 * diverges without a bailout - dr = pow(r,power-1)*power*dr+1 and r itself compound unbounded
 * over the iterations, overflowing to Inf so length(p)/dr is NaN (the CPU marcher guards that
 * with a finiteness check; the GPU does not). Escape-time fractals require a bailout, so both
 * chain builders (clampChain for import/storage, chainFromState for the editor) force this when
 * a bulbPow stage is present but the bailout is non-finite.
 */
export const BULB_FALLBACK_BAILOUT = 4;

/** Does the chain contain an escape-time (bulb) stage that needs a finite bailout? */
export function chainNeedsBailout(stages: readonly ChainStage[]): boolean {
  return stages.some((s) => s.transform === "bulbPow");
}

/**
 * Live-preview iteration cap for chains (design §3.5): deep counts dominate per-sample cost, so
 * the interactive preview marches at most this many iterations while the explicit render/export
 * uses the full count. A conservative interactivity guard, tunable on the target GPU.
 */
export const CHAIN_PREVIEW_ITERS = 48;

const COMP = ["x", "y", "z", "w"] as const;

/** Format a JS number as a WGSL f32 literal (always with a decimal point). */
function wgslFloat(n: number): string {
  if (Number.isInteger(n)) return `${n}.0`;
  return `${n}`;
}

/**
 * Rewrite a transform's `$0..$3` param tokens to this stage's uniform slot. Param index k
 * (its position in the transform's param schema) maps to component {x,y,z,w} of `gStageP[stage]`.
 */
function bindStageParams(wgsl: string, stage: number): string {
  return wgsl.replace(/\$(\d)/g, (_, d: string) => {
    const k = Number(d);
    if (k >= COMP.length) {
      // A transform may declare at most COMP.length params (one stage vec4); $4+ would bind to
      // `.undefined`. Guarded by MAX_TRANSFORM_PARAMS too, but fail loudly at codegen if violated.
      throw new Error(`transform param token $${k} exceeds the ${COMP.length}-slot stage vec4`);
    }
    return `gStageP[${stage}].${COMP[k]}`;
  });
}

export function compileChainDE(chain: FormulaChain): string {
  if (chain.stages.length > CHAIN_MAX_STAGES) {
    throw new Error(
      `chain has ${chain.stages.length} stages, exceeding the ${CHAIN_MAX_STAGES}-stage cap`,
    );
  }
  const stageBlocks = chain.stages
    .map(
      (s, i) => `    {
${bindStageParams(getTransform(s.transform).wgsl, i)}
    }`,
    )
    .join("\n");

  // Bailout is structural (it gates the `break`), so it is baked in as a literal: a pure
  // fold/IFS chain (bailout = Infinity) emits no break and runs the full iteration count,
  // exactly like the atomic mandelbox.
  const bailoutLine = Number.isFinite(chain.bailout)
    ? `    if (r > ${wgslFloat(chain.bailout)}) { break; }\n`
    : "";

  const addCLine = chain.addC ? "    p = p + c;\n" : "";

  const deExpr =
    chain.deForm === "log" ? "0.25 * log(max(r, 1.0e-6)) * r / dr" : "length(p) / abs(dr)";

  // Final-DE finiteness guard: a pathological chain (e.g. stacked bulb stages a user authored or
  // imported - rollChain caps these, but the editor/codec don't) can overflow p/dr to Inf within
  // an iteration, so the DE is Inf/Inf = NaN. The CPU dive treats a non-finite DE as a ray miss;
  // the GPU has no such guard, so NaN would render as black/garbage pixels. Returning a large
  // finite distance degrades the same way (the marcher steps past and misses). `!(d < BIG)` is
  // the NaN-safe idiom (NaN fails every comparison): it catches NaN, Inf, and absurd-but-finite,
  // while any real scene distance (O(10s)) passes untouched.
  return /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var dr = 1.0;
  var trap = 1.0e10;
  var r = length(p);
  for (var i = 0; i < gIters; i = i + 1) {
    r = length(p);
${bailoutLine}${stageBlocks}
${addCLine}    trap = min(trap, dot(p, p));
  }
  let d = ${deExpr};
  if (!(d < 1.0e30)) {
    return vec2<f32>(1.0e30, trap);
  }
  return vec2<f32>(d, trap);
}
`;
}

// Reused across the dive's per-frame collision march (up to MARCH_STEPS steering rays):
// a fresh object per chainDe call churned visible GC hitches mid-dive in the warp work, so
// the state is a module-level scratch fully reset at entry (JS is single-threaded, and no
// transform re-enters chainDe, so sequential reuse is safe).
const scratch: ChainState = { px: 0, py: 0, pz: 0, dr: 1 };

/**
 * f64 distance for a chain at a fractal-space point. Mirror of compileChainDE's WGSL: same
 * transforms, same order, same addC/bailout/deForm. The orbit trap is GPU-only (colour), so
 * the CPU side - which only the dive consumes, for distance - does not track it.
 *
 * `iters` overrides the chain's iteration count: the DiveController boosts it with depth
 * (extraIterations), exactly as it does the atomic formulas' gIters.
 */
export function chainDe(
  chain: FormulaChain,
  cx: number,
  cy: number,
  cz: number,
  iters: number = chain.iterations,
): number {
  const s = scratch;
  s.px = cx;
  s.py = cy;
  s.pz = cz;
  s.dr = 1;
  const hasBailout = Number.isFinite(chain.bailout);
  let r = Math.sqrt(cx * cx + cy * cy + cz * cz);
  for (let i = 0; i < iters; i += 1) {
    r = Math.sqrt(s.px * s.px + s.py * s.py + s.pz * s.pz);
    if (hasBailout && r > chain.bailout) break;
    for (const stage of chain.stages) {
      getTransform(stage.transform).cpu(s, stage.values);
    }
    if (chain.addC) {
      s.px += cx;
      s.py += cy;
      s.pz += cz;
    }
  }
  if (chain.deForm === "log") {
    return (0.25 * Math.log(Math.max(r, 1e-6)) * r) / s.dr;
  }
  return Math.sqrt(s.px * s.px + s.py * s.py + s.pz * s.pz) / Math.abs(s.dr);
}

const TRANSFORM_IDS = new Set<string>(TRANSFORM_LIST.map((t) => t.id));
const clampNum = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Bring an imported/stored chain into safe ranges, mirroring clampShapeToRegistry on the
 * atomic side: stages with an unknown transform are dropped, each stage's params are clamped
 * to the transform's registry ranges (unknown keys dropped, missing ones defaulted), the count
 * is capped, iterations clamped, and the DE form / addC / bailout validated. Returns null when
 * nothing valid remains, so the caller falls back to the atomic `formula`.
 */
export function clampChain(chain: FormulaChain): FormulaChain | null {
  const stages: ChainStage[] = [];
  for (const raw of chain.stages.slice(0, CHAIN_MAX_STAGES)) {
    if (!TRANSFORM_IDS.has(raw.transform)) continue;
    const def = getTransform(raw.transform as TransformId);
    const values: Record<string, number> = {};
    for (const p of def.params) {
      const v = raw.values[p.key] ?? p.defaultValue;
      values[p.key] = clampNum(Number.isFinite(v) ? v : p.defaultValue, p.min, p.max);
    }
    stages.push({ transform: raw.transform, values });
  }
  if (stages.length === 0) return null;
  // Defend iterations against non-finite like bailout below: NaN survives clampNum/round.
  const rawIters = Number.isFinite(chain.iterations) ? chain.iterations : 24;
  const iterations = Math.round(clampNum(rawIters, 1, CHAIN_MAX_ITERATIONS));
  // Escape radius: a finite value in the authoring range (the editor slider matches this), or
  // Infinity for pure fold/IFS. 64 is well past any useful escape radius (bulbs escape at ~2). A
  // bulb stage with no bailout diverges (see BULB_FALLBACK_BAILOUT), so force one there.
  const bailout =
    Number.isFinite(chain.bailout) && chain.bailout > 0
      ? clampNum(chain.bailout, 0.5, 64)
      : chainNeedsBailout(stages)
        ? BULB_FALLBACK_BAILOUT
        : Infinity;
  const deForm = chain.deForm === "log" ? "log" : "linear";
  return { stages, iterations, addC: chain.addC !== false, bailout, deForm };
}

/**
 * Conservative sphere-trace step tightening for a chain (design §3.4 mitigation 1): the
 * largest single-stage expansion factor, capped. A chain can raise the field's Lipschitz
 * constant above 1, so the marcher takes proportionally smaller steps to avoid tunnelling
 * through thin features - the same idea as warpStepBoost. Returns a factor >= 1 to divide
 * the step by (1 = no tightening). The per-iteration derivative `dr` already corrects the
 * DE itself; this only guards the march cadence against aggressive operator mixes.
 */
export function chainStepScale(chain: FormulaChain): number {
  let s = 1;
  for (const stage of chain.stages) {
    if (stage.transform === "scaleAddC") {
      s = Math.max(s, Math.abs(stage.values.scale ?? 2));
    } else if (stage.transform === "boxFold") {
      s = Math.max(s, 2);
    } else if (stage.transform === "sphereFold") {
      const mr = Math.max(stage.values.minRadius ?? 0.5, 0.1);
      s = Math.max(s, 1 / (mr * mr));
    } else if (stage.transform === "sphereInvert") {
      // Inversion expands strongly near the sphere; dr tracks the exact factor, but the march
      // cadence still wants a firm guard. A moderate constant (not the unbounded factor/r2).
      s = Math.max(s, 4);
    } else if (stage.transform === "sinWarp") {
      s = Math.max(s, 1 + (stage.values.amp ?? 0.1) * (stage.values.freq ?? 2));
    }
    // bulbPow does NOT contribute: its analytic `dr` (pow(r,power-1)*power*dr) is an exact
    // derivative, so the DE stays a conservative lower bound and sphere-traces at 0.9 relax with
    // no boost - the shipped atomic power-8 Mandelbulb proves it. Its exponent is not a field
    // expansion factor. mengerFold / kifsFold / latticeFold / rotate are isometries (Lipschitz 1).
  }
  return Math.min(8, s);
}

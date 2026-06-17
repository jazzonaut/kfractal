import { getTransform, TRANSFORM_LIST } from "./transforms";
import type { ChainState, TransformId } from "./transforms";
import type { CameraPreset, ChainStage, FormulaChain } from "./types";

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

// --- Auto-framing (hybrid-formula-chains design) -------------------------------------------
//
// An earlier attempt scanned chainDe on a grid and kept cells whose DE read below ~a cell width.
// That trusts the DE *magnitude*, which an arbitrary chain does not honour: a fold/isometry-only
// stack keeps dr~=1, so length(p)/dr is a bounded constant the marcher never resolves to a hit
// (nothing renders); a scale-/bulb-heavy stack blows dr up, so the DE reads ~0 across the whole
// cube and the "extent" balloons to the search bound. Either way the grid mis-frames it.
//
// Instead we frame off the geometry's real surface: cast rays inward from a shell, collect the
// hit points, and fit the camera to their centroid and bounding radius. The probe march is
// CONSERVATIVE (step tightened by chainStepScale, like the dive's collision march) so it lands on
// the true OUTER surface rather than tunnelling through the thin outer shell - that keeps the
// camera, placed a full radius outside, from ending up inside the shape. If too few rays hit, the
// chain has no resolvable surface and the caller re-rolls / falls back to a default frame.
//
// Framing radius is a mid percentile of the hit distances, not the max: a sparse fractal's outer
// wisps shouldn't shrink the dense body to a speck in the frame. The body fills the view; stray
// filaments may run past the edges. The camera still clears the true max extent (distance is a
// large multiple of the framing radius), so trimming the radius never buries the camera.

const FRAME_FOV = 45;
/** Probe-ray start radius. Inside FRAME_MAX_T so a centre-bound surface is always reachable. */
const FRAME_R = 24;
/** The pixel march's reach (shapes' render.maxDistance, shapes.ts). */
const FRAME_MAX_T = 40;
/** Conservative step budget (grown with stepScale, like dive.ts) so the probe reaches the surface. */
const FRAME_MARCH_STEPS = 384;
/**
 * Iteration count the probe marches at: the interactive preview a fresh shape first appears under
 * caps chains at CHAIN_PREVIEW_ITERS, so framing at min(count, cap) makes the probe see the same
 * silhouette the user sees (more iterations carve the set thinner, shifting the surface).
 */
const frameIters = (chain: FormulaChain): number => Math.min(chain.iterations, CHAIN_PREVIEW_ITERS);
/** Percentile of hit distances used as the framing radius (the dense body, not the outliers). */
const FRAME_RADIUS_PCT = 0.8;
/** Breathing room beyond the fit distance. */
const FRAME_MARGIN = 1.1;
const FRAME_PROBES = 48;
/** Neutral 3/4 orbit heading the frame uses (target -> camera yaw/pitch). */
const FRAME_YAW = -0.72;
const FRAME_PITCH = -0.2;

// Render-march mirror of the GPU pixel pass (pathtrace.ts march): flat 0.9 relax, pixel-footprint
// hit epsilon, render reach + budget. Used only to predict whether the framed camera will actually
// SEE the surface - the conservative probe above can resolve a surface the renderer's coarser step
// tunnels straight through, so the geometry frame alone doesn't guarantee anything renders.
const FRAME_RENDER_STEPS = 200;
/** gPixelEps at a representative 1080p with surfaceEpsilon == EPS_REF (pathtrace.ts:306). */
const FRAME_PIXEL_EPS = (2 * Math.tan((FRAME_FOV * Math.PI) / 180 / 2)) / 1080;
const FRAME_EPS_FLOOR = 0.0004 * 0.05;
/** Coverage grid resolution for the render-visibility check (NxN rays across the FOV). */
const FRAME_COVER_GRID = 5;

/** Fibonacci-sphere unit directions: an even angular spread of probe rays, computed once. */
const FRAME_DIRS: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < FRAME_PROBES; i += 1) {
    const y = 1 - (i / (FRAME_PROBES - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    out.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return out;
})();

/**
 * Conservatively sphere-trace one ray in chain-space toward the centre, tightening the step by
 * chainStepScale (as the dive's collision march does) so an aggressive chain's higher Lipschitz
 * constant doesn't tunnel the ray through the outer shell. Returns the hit distance `t` along the
 * ray (the true near surface), or null on a miss / non-finite DE.
 */
function marchChainSurface(
  chain: FormulaChain,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number | null {
  const stepScale = chainStepScale(chain);
  const relax = 0.9 / stepScale;
  // Grow the budget with the tightened step so the probe still reaches the surface, but cap it:
  // an unbounded stepScale*budget makes framing an aggressive chain a multi-hundred-ms hitch.
  const steps = Math.min(Math.round(FRAME_MARCH_STEPS * stepScale), 768);
  let t = 0;
  for (let i = 0; i < steps && t < FRAME_MAX_T; i += 1) {
    const d = chainDe(chain, ox + dx * t, oy + dy * t, oz + dz * t, frameIters(chain));
    if (!Number.isFinite(d)) return null;
    if (d < 1e-3 * t + 1e-30) return t;
    t += d * relax;
  }
  return null;
}

/**
 * Render-march one ray as the GPU pixel pass does (flat 0.9 relax, pixel-footprint epsilon, render
 * budget/reach). Returns the hit `t`, or null on a miss - the predictor for "does this render".
 */
function renderMarchRay(
  chain: FormulaChain,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
): number | null {
  let t = 0;
  for (let i = 0; i < FRAME_RENDER_STEPS; i += 1) {
    const d = chainDe(chain, ox + dx * t, oy + dy * t, oz + dz * t, frameIters(chain));
    if (!Number.isFinite(d)) return null;
    if (d < Math.max(FRAME_EPS_FLOOR, t * FRAME_PIXEL_EPS)) return t;
    t += d * 0.9;
    if (t > FRAME_MAX_T) return null;
  }
  return null;
}

/**
 * Predict how the framed camera sees the surface: march an NxN ray fan across the FOV from the
 * frame's camera pose with the render march. Returns the fraction of rays that hit (on-screen
 * coverage) and the centre-ray hit fraction t/distance (near 0 = camera sitting on/in the surface).
 */
function renderVisibility(
  chain: FormulaChain,
  center: [number, number, number],
  distance: number,
): { coverage: number; centerFrac: number } {
  // Camera world pose: dir is target -> camera (matches stage.ts applyOrbit).
  const cp = Math.cos(FRAME_PITCH);
  const dir: [number, number, number] = [
    Math.sin(FRAME_YAW) * cp,
    Math.sin(FRAME_PITCH),
    Math.cos(FRAME_YAW) * cp,
  ];
  const eye: [number, number, number] = [
    center[0] + dir[0] * distance,
    center[1] + dir[1] * distance,
    center[2] + dir[2] * distance,
  ];
  const fwd: [number, number, number] = [-dir[0], -dir[1], -dir[2]];
  // right = normalize(cross(worldUp, fwd)); up = cross(fwd, right).
  let rx = fwd[2];
  let rz = -fwd[0];
  const rl = Math.hypot(rx, 0, rz) || 1;
  rx /= rl;
  rz /= rl;
  const right: [number, number, number] = [rx, 0, rz];
  const up: [number, number, number] = [
    fwd[1] * right[2] - fwd[2] * right[1],
    fwd[2] * right[0] - fwd[0] * right[2],
    fwd[0] * right[1] - fwd[1] * right[0],
  ];
  const tanHalf = Math.tan((FRAME_FOV * Math.PI) / 180 / 2);
  let hits = 0;
  let total = 0;
  let centerFrac = Infinity;
  const G = FRAME_COVER_GRID;
  for (let a = 0; a < G; a += 1) {
    for (let b = 0; b < G; b += 1) {
      const sx = ((a / (G - 1)) * 2 - 1) * tanHalf;
      const sy = ((b / (G - 1)) * 2 - 1) * tanHalf;
      let dx = fwd[0] + right[0] * sx + up[0] * sy;
      let dy = fwd[1] + right[1] * sx + up[1] * sy;
      let dz = fwd[2] + right[2] * sx + up[2] * sy;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l;
      dy /= l;
      dz /= l;
      const t = renderMarchRay(chain, eye[0], eye[1], eye[2], dx, dy, dz);
      total += 1;
      if (t != null) {
        hits += 1;
        if (a === (G - 1) / 2 && b === (G - 1) / 2) centerFrac = t / distance;
      }
    }
  }
  return { coverage: hits / total, centerFrac };
}

/** Mean of a non-empty list of points. */
function centroid(pts: readonly [number, number, number][]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / pts.length, y / pts.length, z / pts.length];
}

export interface ChainExtent {
  /** Centroid of the rendered surface (camera target). */
  readonly center: [number, number, number];
  /** Radius that frames the bulk of the surface about `center`. */
  readonly radius: number;
  /** Fraction of probe rays that hit a surface; 0 means nothing renders. */
  readonly hitFrac: number;
  /** The surface reaches the probe shell (a space-filling / repeating field). */
  readonly unbounded: boolean;
  /** Fraction of the framed view the render march fills (predicts speck/empty on screen). */
  readonly coverage: number;
  /** Centre-ray hit distance as a fraction of camera distance; small = camera on/in the surface. */
  readonly centerFrac: number;
}

/**
 * Probe the rendered surface of a chain by ray-casting (see the framing notes above). Returns the
 * surface centroid + a framing radius, or null when too few rays hit (no resolvable surface). The
 * generator uses `hitFrac` to reject dead rolls; frameChain turns the extent into a camera.
 */
export function probeChainExtent(chain: FormulaChain): ChainExtent | null {
  // Cast every probe ray inward from the shell toward (cx,cy,cz); collect the surface hit points.
  const probe = (cx: number, cy: number, cz: number): [number, number, number][] => {
    const pts: [number, number, number][] = [];
    for (const [ux, uy, uz] of FRAME_DIRS) {
      const t = marchChainSurface(
        chain,
        cx + FRAME_R * ux,
        cy + FRAME_R * uy,
        cz + FRAME_R * uz,
        -ux,
        -uy,
        -uz,
      );
      if (t != null)
        pts.push([
          cx + FRAME_R * ux - ux * t,
          cy + FRAME_R * uy - uy * t,
          cz + FRAME_R * uz - uz * t,
        ]);
    }
    return pts;
  };

  const first = probe(0, 0, 0);
  if (first.length < 3) return null; // no resolvable surface
  const c0 = centroid(first);
  // Pass 2: re-cast toward the rough centre - captures off-origin lobes and a centred radius. Keep
  // whichever pass hit more (the refined aim occasionally grazes fewer rays on a thin shape).
  const second = probe(c0[0], c0[1], c0[2]);
  const pts = second.length >= first.length ? second : first;
  const center = centroid(pts);

  // `.sort` mutates, but `dists` is a fresh array `map` just produced, so there is nothing to alias
  // (toSorted would be cleaner but is past the project's TS lib target).
  const dists = pts
    .map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]))
    .sort((a, b) => a - b);
  const maxd = dists[dists.length - 1]!;
  // A mid percentile, not the max: a sparse fractal's outer wisps shouldn't shrink the dense body
  // to a speck. The body fills the frame; the camera still clears `maxd` (distance >> radius).
  const pct = dists[Math.floor(FRAME_RADIUS_PCT * (dists.length - 1))]!;
  // A surface still present out at the shell is space-filling/repeating (a lattice) - it has no
  // finite bound, so frame a representative near region instead of the (meaningless) full extent.
  const unbounded = maxd > 0.8 * FRAME_R;
  const radius = Math.max(unbounded ? Math.min(pct, 3.5) : pct, 0.05);
  const distance = (radius / Math.sin((FRAME_FOV * Math.PI) / 180 / 2)) * FRAME_MARGIN;
  const { coverage, centerFrac } = renderVisibility(chain, center, distance);
  return { center, radius, hitFrac: pts.length / FRAME_PROBES, unbounded, coverage, centerFrac };
}

/** Build a neutral 3/4 orbit camera that frames a probed extent (target = centre, fit distance). */
export function frameFromExtent(ext: ChainExtent): CameraPreset {
  const distance = (ext.radius / Math.sin((FRAME_FOV * Math.PI) / 180 / 2)) * FRAME_MARGIN;
  return { target: ext.center, yaw: -0.72, pitch: -0.2, distance, fov: FRAME_FOV, roll: 0 };
}

/**
 * Auto-frame a chain: ray-cast its rendered surface (probeChainExtent) and fit an orbit camera to
 * the surface's centroid and extent. A chain's geometry has a different scale, extent, AND centre
 * from the atomic baseline it borrows its march/trap from, so inheriting that camera mis-frames it
 * (off to the side, or the camera buried inside an under-estimated bound). Used by the generator,
 * "Start hybrid chain", the curated chain shapes, and the editor's "Fit to view". When nothing
 * renders, returns a usable default frame rather than a zoom-to-point.
 */
export function frameChain(chain: FormulaChain): CameraPreset {
  const ext = probeChainExtent(chain);
  if (!ext)
    return { target: [0, 0, 0], yaw: -0.72, pitch: -0.2, distance: 6, fov: FRAME_FOV, roll: 0 };
  return frameFromExtent(ext);
}

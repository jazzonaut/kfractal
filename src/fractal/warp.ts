import type { WarpAxis, WarpSettings } from "./types";

/**
 * Domain warp (ADR-0012): shared pure helpers for the shape-side warp.
 *
 * The GPU applies the warp inside de() (pathtrace.ts warpDomain/warpLipschitz);
 * this module owns the parameter ranges, the CPU f64 mirror the DiveController
 * marches, and the Lipschitz bookkeeping both sides share. Keep the math in
 * lockstep with the WGSL - same composition order (twist -> bend -> ripple ->
 * noise), same noise constants.
 */

export const WARP_RANGES = {
  twist: { min: -1.5, max: 1.5, step: 0.01 },
  bend: { min: -1.0, max: 1.0, step: 0.01 },
  rippleAmp: { min: 0, max: 0.3, step: 0.005 },
  rippleFreq: { min: 0.5, max: 16, step: 0.1 },
  noiseAmp: { min: 0, max: 0.4, step: 0.005 },
  noiseFreq: { min: 0.25, max: 4, step: 0.05 },
} as const;

/**
 * Empirical bound on the warp FBM's gradient magnitude (two value-noise octaves,
 * 1 + 0.5 at 2.17x frequency). Same spirit as growth's slope constants: validated
 * by the warp stress harness rather than derived tightly.
 */
export const WARP_NOISE_GRAD = 3.0;

const AXIS_INDEX: Record<WarpAxis, number> = { x: 0, y: 1, z: 2 };
const AXES: readonly WarpAxis[] = ["x", "y", "z"];

export function defaultWarp(): WarpSettings {
  return {
    twist: 0,
    twistAxis: "y",
    bend: 0,
    bendAxis: "x",
    rippleAmp: 0,
    rippleFreq: 4,
    rippleAxis: "y",
    noiseAmp: 0,
    noiseFreq: 1.5,
  };
}

export function isWarpOff(w: WarpSettings | undefined): boolean {
  return !w || (w.twist === 0 && w.bend === 0 && w.rippleAmp <= 0 && w.noiseAmp <= 0);
}

const clampNum = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const clampAxis = (a: WarpAxis, fallback: WarpAxis): WarpAxis => (AXES.includes(a) ? a : fallback);

export function clampWarp(w: WarpSettings): WarpSettings {
  const r = WARP_RANGES;
  return {
    twist: clampNum(w.twist, r.twist.min, r.twist.max),
    twistAxis: clampAxis(w.twistAxis, "y"),
    bend: clampNum(w.bend, r.bend.min, r.bend.max),
    bendAxis: clampAxis(w.bendAxis, "x"),
    rippleAmp: clampNum(w.rippleAmp, r.rippleAmp.min, r.rippleAmp.max),
    rippleFreq: clampNum(w.rippleFreq, r.rippleFreq.min, r.rippleFreq.max),
    rippleAxis: clampAxis(w.rippleAxis, "y"),
    noiseAmp: clampNum(w.noiseAmp, r.noiseAmp.min, r.noiseAmp.max),
    noiseFreq: clampNum(w.noiseFreq, r.noiseFreq.min, r.noiseFreq.max),
  };
}

/** Flat 0..26 axis encoding carried in one uniform float (twist + 3*bend + 9*ripple). */
export function packWarpAxes(w: WarpSettings): number {
  return AXIS_INDEX[w.twistAxis] + 3 * AXIS_INDEX[w.bendAxis] + 9 * AXIS_INDEX[w.rippleAxis];
}

/**
 * Position-independent part of the warp's Lipschitz constant (ripple and noise);
 * twist and bend depend on the distance from their axes and are evaluated per
 * point (GPU: warpLipschitz private state; CPU: warpCpuDe below).
 */
export function warpConstLipschitz(w: WarpSettings): number {
  return (
    (1 + Math.abs(w.rippleAmp) * w.rippleFreq) * (1 + w.noiseAmp * w.noiseFreq * WARP_NOISE_GRAD)
  );
}

/**
 * March step-budget multiplier compensating the warp's Lipschitz slowdown: the field
 * under-reports distance by the local factor, so rays need proportionally more steps
 * to cover the same span (the dive applies the same idea against zoom depth). The
 * twist/bend terms estimate the per-point factors at a typical structure radius of 2;
 * the cap keeps a maxed-out warp from blowing the frame budget (slow > black, but
 * 8x of a 128-step march is already half a million steps per frame on a 1080p miss).
 */
export function warpStepBoost(w: WarpSettings): number {
  const twist = Math.sqrt(1 + 4 * w.twist * w.twist);
  const bend = 1 + 2 * Math.abs(w.bend);
  return Math.min(8, Math.max(1, warpConstLipschitz(w) * twist * bend));
}

// ---- CPU f64 mirror of the WGSL warp -------------------------------------------------
// The DiveController steers and collides against the formula's f64 CPU DE; a warp the
// CPU cannot see would pin pivots onto the UN-warped surface and dive cameras into
// walls. The noise is a port of the shader's hash31/valueNoise - f32/f64 divergence in
// the pattern is acceptable (the Lipschitz division keeps collision conservative).

const fract = (x: number): number => x - Math.floor(x);

function hash31(px: number, py: number, pz: number): number {
  let qx = fract(px * 0.1031);
  let qy = fract(py * 0.103);
  let qz = fract(pz * 0.0973);
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d;
  qy += d;
  qz += d;
  return fract((qx + qy) * qz);
}

function valueNoise(px: number, py: number, pz: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const fx = px - ix;
  const fy = py - iy;
  const fz = pz - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  let acc = 0;
  for (let c = 0; c < 8; c += 1) {
    const ox = c & 1;
    const oy = (c >> 1) & 1;
    const oz = (c >> 2) & 1;
    const wx = ox === 1 ? ux : 1 - ux;
    const wy = oy === 1 ? uy : 1 - uy;
    const wz = oz === 1 ? uz : 1 - uz;
    acc += hash31(ix + ox, iy + oy, iz + oz) * wx * wy * wz;
  }
  return acc;
}

function warpFbm(x: number, y: number, z: number): number {
  return valueNoise(x, y, z) + 0.5 * valueNoise(x * 2.17, y * 2.17, z * 2.17);
}

export interface WarpedPoint {
  x: number;
  y: number;
  z: number;
  /** Distance from the twist axis at the twist's input (0 when twist is off). */
  rTwist: number;
  /** Distance from the bend's rotation plane axis at the bend's input (0 when off). */
  rBend: number;
}

// Reused result: applyWarpCpu runs once per DE evaluation inside the dive's per-frame
// collision march (up to MARCH_STEPS x steering rays), where fresh objects and the
// tuple churn the swizzles used to cost fed visible GC hitches mid-dive.
const warpScratch: WarpedPoint = { x: 0, y: 0, z: 0, rTwist: 0, rBend: 0 };

/**
 * f64 mirror of the WGSL warpDomain: twist -> bend -> ripple -> noise.
 *
 * Allocation-free: the axis swizzles (self-inverse permutations mapping the chosen
 * axis onto canonical y or x) are inlined as scalar swaps, and the returned object is
 * a module-level scratch overwritten by the next call - copy fields out to keep them.
 */
export function applyWarpCpu(x: number, y: number, z: number, w: WarpSettings): WarpedPoint {
  let px = x;
  let py = y;
  let pz = z;
  let rTwist = 0;
  let rBend = 0;
  if (w.twist !== 0) {
    const a = AXIS_INDEX[w.twistAxis];
    // swzY in: map the twist axis onto y.
    if (a === 0) {
      const t = px;
      px = py;
      py = t;
    } else if (a === 2) {
      const t = py;
      py = pz;
      pz = t;
    }
    rTwist = Math.hypot(px, pz);
    const ang = w.twist * py;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const nx = c * px + s * pz;
    pz = -s * px + c * pz;
    px = nx;
    // swzY out (self-inverse).
    if (a === 0) {
      const t = px;
      px = py;
      py = t;
    } else if (a === 2) {
      const t = py;
      py = pz;
      pz = t;
    }
  }
  if (w.bend !== 0) {
    const a = AXIS_INDEX[w.bendAxis];
    // swzX in: map the bend axis onto x.
    if (a === 1) {
      const t = px;
      px = py;
      py = t;
    } else if (a === 2) {
      const t = px;
      px = pz;
      pz = t;
    }
    rBend = Math.hypot(px, py);
    const ang = w.bend * px;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const nx = c * px - s * py;
    py = s * px + c * py;
    px = nx;
    // swzX out (self-inverse).
    if (a === 1) {
      const t = px;
      px = py;
      py = t;
    } else if (a === 2) {
      const t = px;
      px = pz;
      pz = t;
    }
  }
  if (w.rippleAmp > 0) {
    const a = AXIS_INDEX[w.rippleAxis];
    // swzY in: map the ripple axis onto y.
    if (a === 0) {
      const t = px;
      px = py;
      py = t;
    } else if (a === 2) {
      const t = py;
      py = pz;
      pz = t;
    }
    py += w.rippleAmp * Math.sin(w.rippleFreq * px) * Math.sin(w.rippleFreq * pz);
    // swzY out (self-inverse).
    if (a === 0) {
      const t = px;
      px = py;
      py = t;
    } else if (a === 2) {
      const t = py;
      py = pz;
      pz = t;
    }
  }
  if (w.noiseAmp > 0) {
    const f = w.noiseFreq;
    const sx = px * f;
    const sy = py * f;
    const sz = pz * f;
    px += w.noiseAmp * (warpFbm(sx, sy, sz) - 0.75);
    py += w.noiseAmp * (warpFbm(sx + 19.7, sy + 7.3, sz + 11.1) - 0.75);
    pz += w.noiseAmp * (warpFbm(sx + 5.1, sy + 27.9, sz + 13.7) - 0.75);
  }
  warpScratch.x = px;
  warpScratch.y = py;
  warpScratch.z = pz;
  warpScratch.rTwist = rTwist;
  warpScratch.rBend = rBend;
  return warpScratch;
}

/**
 * Local Lipschitz bound of the warp around a sample: constant ripple/noise part times
 * per-point twist (1 + |k| r) and bend (1 + |k| r) factors. Radii are inflated by the
 * raw formula distance dF so the bound holds over the entire sphere-trace step (the step
 * in warp-input space is at most dF, and both factors are non-decreasing in r).
 *
 * Both factors use the triangle-inequality form 1 + |k| r. The tighter sqrt(1 + k^2 r^2)
 * is NOT a true operator-norm bound for twist (the twist Jacobian's σ is larger, up to
 * ~13% over the supported range), so a sqrt bound lets sphere-trace overstep and tunnel
 * through twisted thin features; the linear form is conservative.
 */
export function warpLipschitz(w: WarpSettings, rTwist: number, rBend: number, dF: number): number {
  let l = warpConstLipschitz(w);
  if (w.twist !== 0) {
    l *= 1 + Math.abs(w.twist) * (rTwist + dF);
  }
  if (w.bend !== 0) {
    l *= 1 + Math.abs(w.bend) * (rBend + dF);
  }
  return l;
}

/** Warped, Lipschitz-corrected distance from a raw fractal-space DE. */
export function warpCpuDe(
  rawDe: (x: number, y: number, z: number) => number,
  w: WarpSettings,
  x: number,
  y: number,
  z: number,
): number {
  const q = applyWarpCpu(x, y, z, w);
  // Copy out before rawDe runs: q is applyWarpCpu's scratch, and a rawDe that warps
  // again (however unlikely) would clobber it.
  const rT = q.rTwist;
  const rB = q.rBend;
  const dF = rawDe(q.x, q.y, q.z);
  return dF / warpLipschitz(w, rT, rB, Math.max(dF, 0));
}

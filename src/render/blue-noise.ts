import * as THREE from "three";

/**
 * Procedural blue-noise dither texture for screen-space sample decorrelation.
 *
 * The path tracer shares one Owen-scrambled Sobol sequence across every pixel and
 * decorrelates neighbours with a per-pixel Cranley-Patterson rotation (see rndf/rnd2f
 * in pathtrace.ts). For the residual error to land as blue noise in screen space - the
 * spectrum the eye tolerates best at the low sample counts users compose against - that
 * per-pixel rotation offset must itself be blue-noise distributed (Heitz & Belcour 2019).
 *
 * We generate the mask with Ulichney's void-and-cluster method so nothing has to ship as
 * a binary asset and the procedural-only philosophy holds. Two independent channels (R, G)
 * give a 2D rotation offset; higher path dimensions advance the offset with an R2 additive
 * sequence in the shader. The tile repeats across the framebuffer, so it stays small.
 */

const SIZE = 64;
const N = SIZE * SIZE;
// Energy filter spread (Ulichney recommends ~1.5). Wider spreads push the noise bluer at
// the cost of a slightly slower convergence of the generator; 1.9 is a good middle.
const SIGMA = 1.9;

/** Deterministic PRNG (mulberry32) so the mask is reproducible and unit-testable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Kernel {
  readonly dx: Int32Array;
  readonly dy: Int32Array;
  readonly w: Float32Array;
}

/** Truncated Gaussian splat kernel; entries below a small threshold are pruned. */
function buildKernel(): Kernel {
  const r = Math.ceil(3 * SIGMA);
  const inv2s2 = 1 / (2 * SIGMA * SIGMA);
  const dx: number[] = [];
  const dy: number[] = [];
  const w: number[] = [];
  for (let oy = -r; oy <= r; oy += 1) {
    for (let ox = -r; ox <= r; ox += 1) {
      const weight = Math.exp(-(ox * ox + oy * oy) * inv2s2);
      if (weight < 1e-4) continue;
      dx.push(ox);
      dy.push(oy);
      w.push(weight);
    }
  }
  return { dx: Int32Array.from(dx), dy: Int32Array.from(dy), w: Float32Array.from(w) };
}

/** Add (sign +1) or remove (sign -1) a point's Gaussian energy with toroidal wrap. */
function splat(energy: Float32Array, kernel: Kernel, p: number, sign: number): void {
  const px = p % SIZE;
  const py = (p / SIZE) | 0;
  const { dx, dy, w } = kernel;
  for (let k = 0; k < w.length; k += 1) {
    const qx = (px + dx[k]! + SIZE) % SIZE;
    const qy = (py + dy[k]! + SIZE) % SIZE;
    const idx = qy * SIZE + qx;
    energy[idx] = energy[idx]! + sign * w[k]!;
  }
}

/** Index of the 1-pixel with the most surrounding energy (the tightest cluster). */
function tightestCluster(energy: Float32Array, pattern: Uint8Array): number {
  let best = -1;
  let bestE = -Infinity;
  for (let i = 0; i < N; i += 1) {
    if (pattern[i] === 1 && energy[i]! > bestE) {
      bestE = energy[i]!;
      best = i;
    }
  }
  return best;
}

/** Index of the 0-pixel with the least surrounding energy (the largest void). */
function largestVoid(energy: Float32Array, pattern: Uint8Array): number {
  let best = -1;
  let bestE = Infinity;
  for (let i = 0; i < N; i += 1) {
    if (pattern[i] === 0 && energy[i]! < bestE) {
      bestE = energy[i]!;
      best = i;
    }
  }
  return best;
}

/** One blue-noise channel: per-pixel ranks 0..N-1, returned as dither values (rank+0.5)/N. */
function generateChannel(seed: number): Float32Array {
  const kernel = buildKernel();
  const pattern = new Uint8Array(N);
  const energy = new Float32Array(N);
  const rng = mulberry32(seed);

  // Initial pattern: a sparse random scatter of ones (~1/10 of the grid).
  let ones = 0;
  const target = Math.max(1, Math.floor(N / 10));
  while (ones < target) {
    const p = Math.floor(rng() * N);
    if (pattern[p] === 0) {
      pattern[p] = 1;
      splat(energy, kernel, p, 1);
      ones += 1;
    }
  }

  // Phase I: relax the initial pattern into a homogeneous prototype by repeatedly moving
  // the tightest-cluster point into the largest void until that move is a no-op. The swap
  // is guaranteed to reach a fixed point in practice; the iteration cap is a hard safety
  // bound against a pathological non-converging input rather than an expected exit.
  for (let iter = 0; iter < 4 * N; iter += 1) {
    const tight = tightestCluster(energy, pattern);
    pattern[tight] = 0;
    splat(energy, kernel, tight, -1);
    const voidP = largestVoid(energy, pattern);
    if (voidP === tight) {
      pattern[tight] = 1;
      splat(energy, kernel, tight, 1);
      break;
    }
    pattern[voidP] = 1;
    splat(energy, kernel, voidP, 1);
  }

  const prototype = pattern.slice();
  const ranks = new Int32Array(N);

  // Phase II: remove ones from the prototype tightest-cluster first, assigning descending
  // ranks. The last point standing in the prototype is the most isolated, so rank 0.
  for (let rank = ones - 1; rank >= 0; rank -= 1) {
    const tight = tightestCluster(energy, pattern);
    pattern[tight] = 0;
    splat(energy, kernel, tight, -1);
    ranks[tight] = rank;
  }

  // Phase III: restore the prototype, then fill the largest void repeatedly. Adding a point
  // to the largest void keeps the ones maximally spread and removes the most-clustered hole
  // at every step, so the mask stays blue across the whole threshold range.
  pattern.set(prototype);
  energy.fill(0);
  for (let i = 0; i < N; i += 1) {
    if (pattern[i] === 1) splat(energy, kernel, i, 1);
  }
  for (let rank = ones; rank < N; rank += 1) {
    const voidP = largestVoid(energy, pattern);
    pattern[voidP] = 1;
    splat(energy, kernel, voidP, 1);
    ranks[voidP] = rank;
  }

  const dither = new Float32Array(N);
  for (let i = 0; i < N; i += 1) dither[i] = (ranks[i]! + 0.5) / N;
  return dither;
}

// The void-and-cluster pass is the costly part (~tens of ms per channel), so memoise the
// packed texel data at module scope: a second FractalPass (e.g. after a device-lost rebuild)
// reuses it instead of regenerating. The data is read-only and static.
let cachedTexelData: Uint16Array | null = null;

function blueNoiseTexelData(): Uint16Array {
  if (cachedTexelData) return cachedTexelData;
  const r = generateChannel(0x9e3779b9);
  const g = generateChannel(0x85ebca6b);
  const data = new Uint16Array(N * 4);
  for (let i = 0; i < N; i += 1) {
    data[i * 4] = THREE.DataUtils.toHalfFloat(r[i]!);
    data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(g[i]!);
    data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(1);
  }
  cachedTexelData = data;
  return data;
}

/**
 * Build the GPU-side blue-noise texture: two independent void-and-cluster channels packed
 * into R and G. Half float for the reliable WebGPU backend path in three r184. The shader
 * reads it with textureLoad (see pathtrace.ts), so the sampler is never consulted - the
 * wrap/filter settings below are inert defaults and the 64x64 tile is wrapped by an explicit
 * `px % 64` in WGSL. Built once and never swapped (a static texture keeps one binding layout
 * for every pipeline).
 *
 * Note: the CPU channels are an exact rank permutation, but toHalfFloat quantises them - near
 * 1.0 the f16 step (~2^-11) is coarser than the 1/4096 rank step, so a few top-end ranks
 * collide on the GPU mask. Visually irrelevant for a dither offset; the permutation property
 * the unit test asserts holds for the generator, not the quantised texture.
 */
export function makeBlueNoiseTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    blueNoiseTexelData(),
    SIZE,
    SIZE,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Exposed for tests: the tile dimension. */
export const BLUE_NOISE_SIZE = SIZE;

/** Exposed for tests: generate one raw dither channel (values in [0,1)). */
export function generateBlueNoiseChannel(seed: number): Float32Array {
  return generateChannel(seed);
}

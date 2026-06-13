import * as THREE from "three/webgpu";
import { getEnvironment } from "../fractal/environments";
import type { EnvironmentDef, ProceduralEnvSpec } from "../fractal/environments";

/**
 * Procedural environment rasterizer and importance-sampling tables (ADR-0009).
 *
 * An environment spec (graded dome + glow blobs + seeded noise, no real-world imagery)
 * is rasterized to an equirect half-float texture, then one CPU pass derives everything
 * the shader and the preview need:
 * - an alias table over a GRID_W x GRID_H luminance grid, packed into the radiance atlas
 *   as RGBA half-float cells (R = acceptance probability, G/B = alias cell xy,
 *   A = solid-angle pdf), so the WGSL side draws one env NEE sample from atlas texels;
 * - the mean radiance of the sphere (preview ambient stand-in);
 * - the dominant bright region's direction and flux (preview key-light stand-in).
 *
 * Everything is deterministic (seeded hashes, no clock or Math.random), so the same
 * preset always produces the same picture. Results are cached per environment id.
 */

export interface EnvironmentData {
  /** Equirect RGBA half-float radiance, ENV_W x ENV_H. */
  readonly radiance: Uint16Array;
  /** Packed (prob, aliasX, aliasY, pdf) RGBA half-float cells, GRID_W x GRID_H. */
  readonly aliasTable: Uint16Array;
  /** Map-space spherical angles of the brightest region (yaw is applied by the caller). */
  readonly domTheta: number;
  readonly domPhi: number;
  /** Flux of the dominant region over pi: a key-light color for the preview. */
  readonly domColor: THREE.Vector3;
  /** Mean radiance of the sphere: a flat-irradiance ambient for the preview. */
  readonly avgColor: THREE.Vector3;
}

/** Equirect raster size: plenty for smooth domes and soft glows. */
export const ENV_W = 512;
export const ENV_H = 256;

export const GRID_W = 256;
export const GRID_H = 128;
export const ENV_ATLAS_H = ENV_H + GRID_H;

/**
 * The GPU-side environment texture is allocated ONCE at fixed atlas size and updated
 * in place (`image.data.set(...)` + `needsUpdate`): swapping a texture node's `.value`
 * does not reliably rebind for raw WGSL texture access, and an in-place update keeps one
 * binding layout for every pipeline. It starts black/uniform, which is what studio and
 * preetham modes (which never read the atlas) are bound against.
 *
 * The atlas is half float: only filterable texture types get the reliable WebGPU backend
 * path in three r184, while float32 filterability is an optional device feature.
 */
export function makeEnvRadianceTexture(): THREE.DataTexture {
  const data = new Uint16Array(ENV_W * ENV_ATLAS_H * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  const uniformPdf = THREE.DataUtils.toHalfFloat(1 / (4 * Math.PI));
  for (let i = 3; i < ENV_W * ENV_H * 4; i += 4) data[i] = one;
  for (let cell = 0; cell < GRID_W * GRID_H; cell += 1) {
    const x = cell % GRID_W;
    const y = Math.floor(cell / GRID_W);
    const o = ((ENV_H + y) * ENV_W + x) * 4;
    data[o] = one;
    data[o + 1] = THREE.DataUtils.toHalfFloat(x / (GRID_W - 1));
    data[o + 2] = THREE.DataUtils.toHalfFloat(y / (GRID_H - 1));
    data[o + 3] = uniformPdf;
  }
  const tex = new THREE.DataTexture(
    data,
    ENV_W,
    ENV_ATLAS_H,
    THREE.RGBAFormat,
    THREE.HalfFloatType,
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/** Deterministic lattice hash → [0, 1); murmur-style finalizer over integer coords. */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(z | 0, 0x9e3779b1) ^
    Math.imul(seed | 0, 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Trilinear value noise on the 3D lattice → [0, 1). Seamless because it lives on dir. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const fz = smooth(z - z0);
  let result = 0;
  for (let dz = 0; dz <= 1; dz += 1) {
    for (let dy = 0; dy <= 1; dy += 1) {
      for (let dx = 0; dx <= 1; dx += 1) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        result += w * hash3(x0 + dx, y0 + dy, z0 + dz, seed);
      }
    }
  }
  return result;
}

function fbm(x: number, y: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let f = 1;
  for (let o = 0; o < octaves; o += 1) {
    sum += amp * valueNoise(x * f, y * f, z * f, seed + o * 101);
    total += amp;
    amp *= 0.5;
    f *= 2.13;
  }
  return sum / total;
}

/** Rasterize a spec to an equirect half-float radiance map (the WGSL uv convention). */
function rasterizeEnvironment(spec: ProceduralEnvSpec): Uint16Array {
  const data = new Uint16Array(ENV_W * ENV_H * 4);
  const glowDirs = spec.glows.map((glow) => ({
    x: Math.sin(glow.theta) * Math.cos(glow.phi),
    y: Math.cos(glow.theta),
    z: Math.sin(glow.theta) * Math.sin(glow.phi),
  }));
  const noise = spec.noise;
  const starsPerPixel = (spec.starDensity ?? 0) / 10000;
  const one = THREE.DataUtils.toHalfFloat(1);

  for (let py = 0; py < ENV_H; py += 1) {
    const theta = (Math.PI * (py + 0.5)) / ENV_H;
    const sinT = Math.sin(theta);
    const dirY = Math.cos(theta);
    for (let px = 0; px < ENV_W; px += 1) {
      const phi = ((px + 0.5) / ENV_W - 0.5) * 2 * Math.PI;
      const dirX = sinT * Math.cos(phi);
      const dirZ = sinT * Math.sin(phi);

      // Dome gradient: horizon → zenith above, horizon → nadir below.
      const up = Math.abs(dirY) ** 0.8;
      const [za, zb, zc] = dirY >= 0 ? spec.zenith : spec.nadir;
      const [ha, hb, hc] = spec.horizon;
      let r = ha + (za - ha) * up;
      let g = hb + (zb - hb) * up;
      let b = hc + (zc - hc) * up;

      // Soft gaussian glows: the environment's area lights.
      for (let i = 0; i < spec.glows.length; i += 1) {
        const glow = spec.glows[i];
        const gd = glowDirs[i];
        if (!glow || !gd) continue;
        const cosAng = Math.min(Math.max(dirX * gd.x + dirY * gd.y + dirZ * gd.z, -1), 1);
        const ang = Math.acos(cosAng);
        const falloff = Math.exp(-((ang / glow.size) ** 2));
        if (falloff > 1e-5) {
          r += glow.color[0] * falloff;
          g += glow.color[1] * falloff;
          b += glow.color[2] * falloff;
        }
      }

      // Seeded fbm wisps; bandiness < 1 stretches the lattice into horizontal streaks.
      if (noise) {
        const n =
          fbm(
            dirX * noise.frequency,
            (dirY * noise.frequency) / Math.max(noise.bandiness, 0.05),
            dirZ * noise.frequency,
            noise.seed,
            noise.octaves,
          ) ** noise.power;
        r += noise.color[0] * n;
        g += noise.color[1] * n;
        b += noise.color[2] * n;
      }

      // Sparse cold-white star speckles (midnight looks).
      if (starsPerPixel > 0) {
        const h = hash3(px, py, 7, 977);
        if (h < starsPerPixel) {
          const mag = 14 + 30 * hash3(px, py, 13, 977);
          r += mag * 0.85;
          g += mag * 0.92;
          b += mag;
        }
      }

      const o = (py * ENV_W + px) * 4;
      data[o] = THREE.DataUtils.toHalfFloat(r);
      data[o + 1] = THREE.DataUtils.toHalfFloat(g);
      data[o + 2] = THREE.DataUtils.toHalfFloat(b);
      data[o + 3] = one;
    }
  }
  return data;
}

/** Walker's alias method over normalized weights; returns per-cell (prob, alias). */
function buildAliasTable(weights: Float64Array): { prob: Float32Array; alias: Float32Array } {
  const n = weights.length;
  let total = 0;
  for (let i = 0; i < n; i += 1) total += weights[i] ?? 0;
  const prob = new Float32Array(n);
  const alias = new Float32Array(n);
  const scaled = new Float64Array(n);
  const small: number[] = [];
  const large: number[] = [];
  for (let i = 0; i < n; i += 1) {
    scaled[i] = ((weights[i] ?? 0) / total) * n;
    ((scaled[i] ?? 0) < 1 ? small : large).push(i);
  }
  while (small.length > 0 && large.length > 0) {
    const s = small.pop() as number;
    const l = large.pop() as number;
    prob[s] = scaled[s] ?? 0;
    alias[s] = l;
    scaled[l] = (scaled[l] ?? 0) + (scaled[s] ?? 0) - 1;
    (scaled[l] < 1 ? small : large).push(l);
  }
  for (const i of [...small, ...large]) {
    prob[i] = 1;
    alias[i] = i;
  }
  return { prob, alias };
}

function buildEnvironmentData(data: Uint16Array): EnvironmentData {
  const width = ENV_W;
  const height = ENV_H;
  const toFloat = THREE.DataUtils.fromHalfFloat;

  // Per-cell mean radiance, accumulated over every pixel (cached per env, so one-off).
  const cells = GRID_W * GRID_H;
  const sumR = new Float64Array(cells);
  const sumG = new Float64Array(cells);
  const sumB = new Float64Array(cells);
  const counts = new Float64Array(cells);
  for (let y = 0; y < height; y += 1) {
    const cy = Math.min(Math.floor((y / height) * GRID_H), GRID_H - 1);
    for (let x = 0; x < width; x += 1) {
      const cell = cy * GRID_W + Math.min(Math.floor((x / width) * GRID_W), GRID_W - 1);
      const o = (y * width + x) * 4;
      sumR[cell] = (sumR[cell] ?? 0) + toFloat(data[o] ?? 0);
      sumG[cell] = (sumG[cell] ?? 0) + toFloat(data[o + 1] ?? 0);
      sumB[cell] = (sumB[cell] ?? 0) + toFloat(data[o + 2] ?? 0);
      counts[cell] = (counts[cell] ?? 0) + 1;
    }
  }

  // Cell solid angles (sum to 4pi), importance weights, and sphere statistics.
  const weights = new Float64Array(cells);
  const omega = new Float64Array(GRID_H);
  for (let j = 0; j < GRID_H; j += 1) {
    omega[j] =
      ((2 * Math.PI) / GRID_W) *
      (Math.cos((Math.PI * j) / GRID_H) - Math.cos((Math.PI * (j + 1)) / GRID_H));
  }
  const avg = new THREE.Vector3();
  let maxFlux = 0;
  let maxCell = 0;
  for (let cell = 0; cell < cells; cell += 1) {
    const count = Math.max(counts[cell] ?? 0, 1);
    const r = (sumR[cell] ?? 0) / count;
    const g = (sumG[cell] ?? 0) / count;
    const b = (sumB[cell] ?? 0) / count;
    const cellOmega = omega[Math.floor(cell / GRID_W)] ?? 0;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const flux = lum * cellOmega;
    weights[cell] = flux > 0 ? flux : 0;
    avg.x += r * cellOmega;
    avg.y += g * cellOmega;
    avg.z += b * cellOmega;
    if (flux > maxFlux) {
      maxFlux = flux;
      maxCell = cell;
    }
  }
  avg.divideScalar(4 * Math.PI);

  // A fully black map degenerates to uniform sampling rather than NaNs.
  let totalWeight = 0;
  for (let cell = 0; cell < cells; cell += 1) totalWeight += weights[cell] ?? 0;
  if (totalWeight <= 0) {
    for (let cell = 0; cell < cells; cell += 1) {
      weights[cell] = omega[Math.floor(cell / GRID_W)] ?? 0;
    }
    totalWeight = 4 * Math.PI;
  }

  // Dominant region: flux of the 5x5 cell neighborhood around the brightest cell,
  // over pi so `albedo * domColor * cos` approximates the path-traced response.
  const domX = maxCell % GRID_W;
  const domY = Math.floor(maxCell / GRID_W);
  const domColor = new THREE.Vector3();
  for (let dy = -2; dy <= 2; dy += 1) {
    const y = domY + dy;
    if (y < 0 || y >= GRID_H) continue;
    for (let dx = -2; dx <= 2; dx += 1) {
      const x = (domX + dx + GRID_W) % GRID_W;
      const cell = y * GRID_W + x;
      const count = Math.max(counts[cell] ?? 0, 1);
      const cellOmega = omega[y] ?? 0;
      domColor.x += ((sumR[cell] ?? 0) / count) * cellOmega;
      domColor.y += ((sumG[cell] ?? 0) / count) * cellOmega;
      domColor.z += ((sumB[cell] ?? 0) / count) * cellOmega;
    }
  }
  domColor.divideScalar(Math.PI);

  // Pack (prob, alias x/y, pdf) for the WGSL sampler; pdf is per solid angle. Alias x/y
  // are normalized instead of a scalar cell id so half-float precision is exact enough.
  const { prob, alias } = buildAliasTable(weights);
  const packed = new Uint16Array(cells * 4);
  for (let cell = 0; cell < cells; cell += 1) {
    const aliasCell = alias[cell] ?? cell;
    const cellOmega = omega[Math.floor(cell / GRID_W)] ?? 0;
    const pdf = (weights[cell] ?? 0) / totalWeight / Math.max(cellOmega, 1e-9);
    packed[cell * 4] = THREE.DataUtils.toHalfFloat(prob[cell] ?? 1);
    packed[cell * 4 + 1] = THREE.DataUtils.toHalfFloat((aliasCell % GRID_W) / (GRID_W - 1));
    packed[cell * 4 + 2] = THREE.DataUtils.toHalfFloat(
      Math.floor(aliasCell / GRID_W) / (GRID_H - 1),
    );
    packed[cell * 4 + 3] = THREE.DataUtils.toHalfFloat(pdf);
  }
  return {
    radiance: data,
    aliasTable: packed,
    domTheta: (Math.PI * (domY + 0.5)) / GRID_H,
    domPhi: ((domX + 0.5) / GRID_W - 0.5) * 2 * Math.PI,
    domColor,
    avgColor: avg,
  };
}

export class EnvironmentManager {
  private readonly cache = new Map<string, EnvironmentData>();

  /**
   * Resolve a procedural environment by id (unknown ids fall back, ADR-0009).
   * Generation is synchronous (~tens of ms) but the async seam stays: callers treat
   * environments as arriving later and reset accumulation when one is applied.
   */
  load(id: string): Promise<EnvironmentData> {
    const def: EnvironmentDef = getEnvironment(id);
    let data = this.cache.get(def.id);
    if (!data) {
      data = buildEnvironmentData(rasterizeEnvironment(def.spec));
      this.cache.set(def.id, data);
    }
    return Promise.resolve(data);
  }
}

/**
 * Sun color for the Preetham mode via the classic clear-sky transmittance fit
 * (Rayleigh + aerosol extinction at three representative wavelengths), scaled so a
 * mid-elevation sun reads like the curated Studio key lights.
 */
export function preethamSunColor(elevationDeg: number, turbidity: number): THREE.Vector3 {
  const elevation = Math.max(elevationDeg, 0.5) * (Math.PI / 180);
  const zenithDeg = 90 - Math.max(elevationDeg, 0.5);
  const airMass = 1 / (Math.cos(Math.PI / 2 - elevation) + 0.15 * (93.885 - zenithDeg) ** -1.253);
  const beta = 0.04608 * turbidity - 0.04586;
  const wavelengths = [0.65, 0.57, 0.475];
  const SUN_BASE = 3.5;
  const [r, g, b] = wavelengths.map((lambda) => {
    const rayleigh = 0.008735 * lambda ** -4.08;
    const aerosol = beta * lambda ** -1.3;
    return SUN_BASE * Math.exp(-airMass * (rayleigh + aerosol));
  });
  return new THREE.Vector3(r, g, b);
}

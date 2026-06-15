import type { FractalFormulaId } from "./types";

/**
 * f64 CPU ports of the registry's WGSL distance estimators (same math, same param
 * slots). The DiveController marches these to retarget the orbit pivot onto the
 * fractal surface and to drive infinite-zoom re-anchoring with full f64 precision -
 * keep them in lockstep with the WGSL in registry.ts.
 */

export interface CpuDeParams {
  readonly p0: number;
  readonly p1: number;
  readonly p2: number;
  readonly p3: number;
  readonly iterations: number;
}

export type CpuDe = (x: number, y: number, z: number, params: CpuDeParams) => number;

/** One coordinate of the Apollonian lattice fold: into [-1, 1), period 2. */
export function latticeFoldComponent(x: number): number {
  const f = x * 0.5 + 0.5;
  return (f - Math.floor(f)) * 2 - 1;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Fractional part, matching WGSL `fract(x)` = x - floor(x). */
const fract = (x: number): number => x - Math.floor(x);

const mandelbox: CpuDe = (cx, cy, cz, { p0, p1, p2, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let dr = 1;
  const mr2 = p2 * p2;
  let r2 = 0;
  for (let i = 0; i < iterations; i += 1) {
    px = clamp(px, -p1, p1) * 2 - px;
    py = clamp(py, -p1, p1) * 2 - py;
    pz = clamp(pz, -p1, p1) * 2 - pz;
    r2 = px * px + py * py + pz * pz;
    if (r2 < mr2) {
      const f = 1 / mr2;
      px *= f;
      py *= f;
      pz *= f;
      dr *= f;
    } else if (r2 < 1) {
      const f = 1 / r2;
      px *= f;
      py *= f;
      pz *= f;
      dr *= f;
    }
    px = px * p0 + cx;
    py = py * p0 + cy;
    pz = pz * p0 + cz;
    dr = dr * Math.abs(p0) + 1;
  }
  return Math.sqrt(px * px + py * py + pz * pz) / Math.abs(dr);
};

const mandelbulb: CpuDe = (cx, cy, cz, { p0, iterations }) => {
  let zx = cx;
  let zy = cy;
  let zz = cz;
  let dr = 1;
  let r = Math.sqrt(zx * zx + zy * zy + zz * zz);
  for (let i = 0; i < iterations; i += 1) {
    r = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (r > 2) break;
    const rr = Math.max(r, 1e-9);
    const theta = Math.acos(clamp(zz / rr, -1, 1)) * p0;
    const phi = Math.atan2(zy, zx) * p0;
    const zr = Math.pow(rr, p0);
    dr = Math.pow(rr, p0 - 1) * p0 * dr + 1;
    const st = Math.sin(theta);
    zx = zr * st * Math.cos(phi) + cx;
    zy = zr * st * Math.sin(phi) + cy;
    zz = zr * Math.cos(theta) + cz;
  }
  return (0.25 * Math.log(Math.max(r, 1e-9)) * r) / dr;
};

const apollonian: CpuDe = (cx, cy, cz, { p0, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let s = 1;
  for (let i = 0; i < iterations; i += 1) {
    px = latticeFoldComponent(px);
    py = latticeFoldComponent(py);
    pz = latticeFoldComponent(pz);
    const r2 = px * px + py * py + pz * pz;
    const k = p0 / Math.max(r2, 1e-30);
    px *= k;
    py *= k;
    pz *= k;
    s *= k;
  }
  return (0.25 * Math.abs(py)) / s;
};

const menger: CpuDe = (cx, cy, cz, { p0, p1, p2, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let s = 1;
  const ca = Math.cos(p2);
  const sa = Math.sin(p2);
  for (let i = 0; i < iterations; i += 1) {
    const rx = ca * px + sa * pz;
    pz = -sa * px + ca * pz;
    px = rx;
    px = Math.abs(px);
    py = Math.abs(py);
    pz = Math.abs(pz);
    // Temp-variable swaps (not destructuring, which can allocate a tuple in
    // unoptimized tiers); matches the WGSL twin's `let t = ...` form.
    if (px < py) {
      const t = px;
      px = py;
      py = t;
    }
    if (px < pz) {
      const t = px;
      px = pz;
      pz = t;
    }
    if (py < pz) {
      const t = py;
      py = pz;
      pz = t;
    }
    const off = p1 * (p0 - 1);
    px = px * p0 - off;
    py = py * p0 - off;
    pz = pz * p0 - off;
    if (pz < -0.5 * off) pz += off;
    s *= p0;
  }
  const qx = Math.abs(px) - 1;
  const qy = Math.abs(py) - 1;
  const qz = Math.abs(pz) - 1;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return (outside + inside) / s;
};

const kifs: CpuDe = (cx, cy, cz, { p0, p1, p2, p3, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let s = 1;
  const c1 = Math.cos(p2);
  const s1 = Math.sin(p2);
  const c2 = Math.cos(p3);
  const s2 = Math.sin(p3);
  for (let i = 0; i < iterations; i += 1) {
    const rx = c1 * px + s1 * pz;
    pz = -s1 * px + c1 * pz;
    px = rx;
    // Negated temp-variable swaps; see menger above for why not destructuring.
    if (px + py < 0) {
      const t = px;
      px = -py;
      py = -t;
    }
    if (px + pz < 0) {
      const t = px;
      px = -pz;
      pz = -t;
    }
    if (py + pz < 0) {
      const t = py;
      py = -pz;
      pz = -t;
    }
    const ry = c2 * py - s2 * pz;
    pz = s2 * py + c2 * pz;
    py = ry;
    const off = p1 * (p0 - 1);
    px = px * p0 - off;
    py = py * p0 - off;
    pz = pz * p0 - off;
    s *= p0;
  }
  return (Math.sqrt(px * px + py * py + pz * pz) - 2) / s;
};

const quatjulia: CpuDe = (cx, cy, cz, { p0, p1, p2, p3, iterations }) => {
  let zx = cx;
  let zy = cy;
  let zz = cz;
  let zw = 0;
  let md2 = 1;
  let mz2 = zx * zx + zy * zy + zz * zz + zw * zw;
  for (let i = 0; i < iterations; i += 1) {
    md2 *= 4 * mz2;
    const nx = zx * zx - zy * zy - zz * zz - zw * zw + p0;
    const ny = 2 * zx * zy + p1;
    const nz = 2 * zx * zz + p2;
    const nw = 2 * zx * zw + p3;
    zx = nx;
    zy = ny;
    zz = nz;
    zw = nw;
    mz2 = zx * zx + zy * zy + zz * zz + zw * zw;
    if (mz2 > 4) break;
  }
  return 0.25 * Math.sqrt(mz2 / md2) * Math.log(Math.max(mz2, 1e-30));
};

const kleinian: CpuDe = (cx, cy, cz, { p0, p1, p2, p3, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let dr = 1;
  for (let i = 0; i < iterations; i += 1) {
    px = 2 * clamp(px, -p0, p0) - px;
    py = 2 * clamp(py, -p1, p1) - py;
    pz = 2 * clamp(pz, -p2, p2) - pz;
    const r2 = px * px + py * py + pz * pz;
    const k = Math.max(p3 / Math.max(r2, 1e-30), 1);
    px *= k;
    py *= k;
    pz *= k;
    dr *= k;
  }
  const rxy = Math.sqrt(px * px + py * py);
  const len = Math.sqrt(px * px + py * py + pz * pz);
  const d = Math.max(rxy - 0.92784, Math.abs(rxy * pz) / Math.max(len, 1e-30)) / dr;
  return 0.6 * d;
};

const juliabulb: CpuDe = (cx, cy, cz, { p0, p1, p2, p3, iterations }) => {
  let zx = cx;
  let zy = cy;
  let zz = cz;
  const kx = p1;
  const ky = p2;
  const kz = p3;
  let dr = 1;
  let r = Math.sqrt(zx * zx + zy * zy + zz * zz);
  for (let i = 0; i < iterations; i += 1) {
    r = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (r > 2) break;
    const rr = Math.max(r, 1e-6);
    const theta = Math.acos(clamp(zz / rr, -1, 1)) * p0;
    const phi = Math.atan2(zy, zx) * p0;
    const zr = Math.pow(rr, p0);
    dr = Math.pow(rr, p0 - 1) * p0 * dr + 1;
    const st = Math.sin(theta);
    zx = zr * st * Math.cos(phi) + kx;
    zy = zr * st * Math.sin(phi) + ky;
    zz = zr * Math.cos(theta) + kz;
  }
  return (0.25 * Math.log(Math.max(r, 1e-6)) * r) / dr;
};

const amazingbox: CpuDe = (cx, cy, cz, { p0, p1, p2, p3, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let dr = 1;
  const mr2 = p2 * p2;
  const ca = Math.cos(p3);
  const sa = Math.sin(p3);
  for (let i = 0; i < iterations; i += 1) {
    // Per-iteration rotation about Y (rigid, so dr is unaffected).
    const rx = ca * px + sa * pz;
    pz = -sa * px + ca * pz;
    px = rx;
    // box fold on all three axes
    px = clamp(px, -p1, p1) * 2 - px;
    py = clamp(py, -p1, p1) * 2 - py;
    pz = clamp(pz, -p1, p1) * 2 - pz;
    const r2 = px * px + py * py + pz * pz;
    if (r2 < mr2) {
      const f = 1 / mr2;
      px *= f;
      py *= f;
      pz *= f;
      dr *= f;
    } else if (r2 < 1) {
      const f = 1 / r2;
      px *= f;
      py *= f;
      pz *= f;
      dr *= f;
    }
    px = px * p0 + cx;
    py = py * p0 + cy;
    pz = pz * p0 + cz;
    dr = dr * Math.abs(p0) + 1;
  }
  return Math.sqrt(px * px + py * py + pz * pz) / Math.abs(dr);
};

const sierpinski: CpuDe = (cx, cy, cz, { p0, p1, p2, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let s = 1;
  const ca = Math.cos(p2);
  const sa = Math.sin(p2);
  for (let i = 0; i < iterations; i += 1) {
    const rx = ca * px + sa * pz;
    pz = -sa * px + ca * pz;
    px = rx;
    // Negated temp-variable swaps; see kifs above for why not destructuring.
    if (px + py < 0) {
      const t = -py;
      py = -px;
      px = t;
    }
    if (px + pz < 0) {
      const t = -pz;
      pz = -px;
      px = t;
    }
    if (py + pz < 0) {
      const t = -pz;
      pz = -py;
      py = t;
    }
    const off = p1 * (p0 - 1);
    px = px * p0 - off;
    py = py * p0 - off;
    pz = pz * p0 - off;
    s *= p0;
  }
  return Math.sqrt(px * px + py * py + pz * pz) / s;
};

const octahedral: CpuDe = (cx, cy, cz, { p0, p1, p2, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let s = 1;
  const ca = Math.cos(p2);
  const sa = Math.sin(p2);
  for (let i = 0; i < iterations; i += 1) {
    const rx = ca * px + sa * pz;
    pz = -sa * px + ca * pz;
    px = rx;
    px = Math.abs(px);
    py = Math.abs(py);
    pz = Math.abs(pz);
    if (px < py) {
      const t = px;
      px = py;
      py = t;
    }
    if (px < pz) {
      const t = px;
      px = pz;
      pz = t;
    }
    if (py < pz) {
      const t = py;
      py = pz;
      pz = t;
    }
    px = px * p0 - p1 * (p0 - 1);
    py = py * p0;
    pz = pz * p0;
    s *= p0;
  }
  const qx = Math.abs(px) - 1;
  const qy = Math.abs(py) - 1;
  const qz = Math.abs(pz) - 1;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return (outside + inside) / s;
};

const crossmenger: CpuDe = (cx, cy, cz, { p0, p1, p2, p3, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let s = 1;
  const off = p1;
  const cxa = Math.cos(p2);
  const sxa = Math.sin(p2);
  const cya = Math.cos(p3);
  const sya = Math.sin(p3);
  for (let i = 0; i < iterations; i += 1) {
    // rotX (twistX)
    const ry = cxa * py - sxa * pz;
    pz = sxa * py + cxa * pz;
    py = ry;
    // rotY (twistY)
    const rx = cya * px + sya * pz;
    pz = -sya * px + cya * pz;
    px = rx;
    px = Math.abs(px);
    py = Math.abs(py);
    pz = Math.abs(pz);
    if (px < py) {
      const t = px;
      px = py;
      py = t;
    }
    if (px < pz) {
      const t = px;
      px = pz;
      pz = t;
    }
    if (py < pz) {
      const t = py;
      py = pz;
      pz = t;
    }
    const o2 = off * (p0 - 1);
    px = px * p0 - o2;
    py = py * p0 - o2;
    pz = pz * p0 - o2;
    // Cross-channel carve: fold the two minor axes back symmetrically.
    if (py < -0.5 * o2) py += o2;
    if (pz < -0.5 * o2) pz += o2;
    s *= p0;
  }
  const qx = Math.abs(px) - 1;
  const qy = Math.abs(py) - 1;
  const qz = Math.abs(pz) - 1;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return (outside + inside) / s;
};

const bicomplex: CpuDe = (cx, cy, cz, { p0, p1, p2, p3, iterations }) => {
  let zx = cx;
  let zy = cy;
  let zz = cz;
  let zw = 0;
  let md2 = 1;
  let mz2 = zx * zx + zy * zy + zz * zz + zw * zw;
  for (let i = 0; i < iterations; i += 1) {
    md2 *= 4 * mz2;
    // White/Nylander hypercomplex square (commutative; distinct from quaternion mult).
    const nx = zx * zx - zy * zy - zz * zz + zw * zw + p0;
    const ny = 2 * (zx * zy - zz * zw) + p1;
    const nz = 2 * (zx * zz - zy * zw) + p2;
    const nw = 2 * (zx * zw + zy * zz) + p3;
    zx = nx;
    zy = ny;
    zz = nz;
    zw = nw;
    mz2 = zx * zx + zy * zy + zz * zz + zw * zw;
    if (mz2 > 4) break;
  }
  return 0.25 * Math.sqrt(mz2 / md2) * Math.log(Math.max(mz2, 1e-9));
};

const trigbulb: CpuDe = (cx, cy, cz, { p0, p1, p2, iterations }) => {
  let zx = cx;
  let zy = cy;
  let zz = cz;
  let dr = 1;
  let r = Math.sqrt(zx * zx + zy * zy + zz * zz);
  const warpL = 1 + p1 * p2;
  for (let i = 0; i < iterations; i += 1) {
    r = Math.sqrt(zx * zx + zy * zy + zz * zz);
    if (r > 2) break;
    const rr = Math.max(r, 1e-6);
    const theta = Math.acos(clamp(zz / rr, -1, 1)) * p0;
    const phi = Math.atan2(zy, zx) * p0;
    const zr = Math.pow(rr, p0);
    dr = Math.pow(rr, p0 - 1) * p0 * dr * warpL + 1;
    const st = Math.sin(theta);
    const wx = zr * st * Math.cos(phi);
    const wy = zr * st * Math.sin(phi);
    const wz = zr * Math.cos(theta);
    // Bounded sine domain perturbation using w.zxy (all from the pre-warp w).
    const nx = wx + p1 * Math.sin(p2 * wz);
    const ny = wy + p1 * Math.sin(p2 * wx);
    const nz = wz + p1 * Math.sin(p2 * wy);
    zx = nx + cx;
    zy = ny + cy;
    zz = nz + cz;
  }
  return (0.25 * Math.log(Math.max(r, 1e-6)) * r) / dr;
};

const cellFold = (x: number, period: number): number => (fract(x / period + 0.5) - 0.5) * period;

const spherepack: CpuDe = (cx, cy, cz, { p0, p1, iterations }) => {
  // Solid ball carved by spherical holes at finer scales (max = SDF subtraction).
  let d = Math.sqrt(cx * cx + cy * cy + cz * cz) - p1;
  let freq = 3;
  for (let i = 0; i < iterations; i += 1) {
    const period = 2 / freq;
    const qx = cellFold(cx, period);
    const qy = cellFold(cy, period);
    const qz = cellFold(cz, period);
    const hole = Math.sqrt(qx * qx + qy * qy + qz * qz) - p0 * period * 0.5;
    d = Math.max(d, -hole);
    freq *= 3;
  }
  return d;
};

const mengersphere: CpuDe = (cx, cy, cz, { p0, p1, p2, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let s = 1;
  for (let i = 0; i < iterations; i += 1) {
    px = Math.abs(px);
    py = Math.abs(py);
    pz = Math.abs(pz);
    if (px < py) {
      const t = px;
      px = py;
      py = t;
    }
    if (px < pz) {
      const t = px;
      px = pz;
      pz = t;
    }
    if (py < pz) {
      const t = py;
      py = pz;
      pz = t;
    }
    const off = p1 * (p0 - 1);
    px = px * p0 - off;
    py = py * p0 - off;
    pz = pz * p0 - off;
    if (pz < -0.5 * off) pz += off;
    s *= p0;
  }
  const qx = Math.abs(px) - 1;
  const qy = Math.abs(py) - 1;
  const qz = Math.abs(pz) - 1;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  const box = (outside + inside) / s;
  const shell = Math.sqrt(cx * cx + cy * cy + cz * cz) - p2;
  return Math.max(box, shell);
};

const kleinsphere: CpuDe = (cx, cy, cz, { p0, p1, p2, iterations }) => {
  let px = cx;
  let py = cy;
  let pz = cz;
  let dr = 1;
  for (let i = 0; i < iterations; i += 1) {
    px = 2 * clamp(px, -p0, p0) - px;
    py = 2 * clamp(py, -p0, p0) - py;
    pz = 2 * clamp(pz, -p0, p0) - pz;
    const r2 = px * px + py * py + pz * pz;
    const k = Math.max(p1 / Math.max(r2, 1e-30), 1);
    px *= k;
    py *= k;
    pz *= k;
    dr *= k;
  }
  const rxy = Math.sqrt(px * px + py * py);
  const len = Math.sqrt(px * px + py * py + pz * pz);
  const inner = (0.6 * Math.max(rxy - 0.92784, Math.abs(rxy * pz) / Math.max(len, 1e-30))) / dr;
  const shell = Math.sqrt(cx * cx + cy * cy + cz * cz) - p2;
  return Math.max(inner, shell);
};

const CPU_DES: Record<FractalFormulaId, CpuDe> = {
  mandelbox,
  mandelbulb,
  apollonian,
  menger,
  kifs,
  quatjulia,
  kleinian,
  juliabulb,
  amazingbox,
  sierpinski,
  octahedral,
  crossmenger,
  bicomplex,
  trigbulb,
  spherepack,
  mengersphere,
  kleinsphere,
};

export function getCpuDe(id: FractalFormulaId): CpuDe {
  return CPU_DES[id];
}

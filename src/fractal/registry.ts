import type { FractalFormulaId } from "./types";

/**
 * Formula registry (ADR-0004): each formula is WGSL DE source + a param schema.
 * The DE is injected into the render-core template and compiled into one cached
 * pipeline per formula; the schema drives generic formula controls.
 *
 * DE contract: `fn formulaDE(c: vec3<f32>) -> vec2<f32>` returning
 * (distance, raw orbit trap). The template provides module-private params
 * `gP0..gP3: f32` (schema slots) and `gIters: i32`.
 */

export interface FormulaParamDef {
  readonly key: string;
  readonly label: string;
  /** One-line tooltip explaining what the param does. */
  readonly description: string;
  /** Which generic uniform slot (gP0..gP3) this param feeds. */
  readonly slot: 0 | 1 | 2 | 3;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
}

export interface FormulaDef {
  readonly id: FractalFormulaId;
  readonly name: string;
  readonly iterations: {
    readonly min: number;
    readonly max: number;
    readonly defaultValue: number;
  };
  readonly params: readonly FormulaParamDef[];
  readonly de: string;
}

const MANDELBOX: FormulaDef = {
  id: "mandelbox",
  name: "Mandelbox",
  iterations: { min: 4, max: 24, defaultValue: 14 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description:
        "Folding scale factor - the core Mandelbox knob. Sign and magnitude reshape the whole structure.",
      slot: 0,
      min: -3,
      max: 3.5,
      step: 0.01,
      defaultValue: 2.8,
    },
    {
      key: "fold",
      label: "Fold",
      description: "Box-fold limit - the distance at which space folds back on itself.",
      slot: 1,
      min: 0.5,
      max: 2,
      step: 0.01,
      defaultValue: 1.0,
    },
    {
      key: "minRadius",
      label: "Min radius",
      description: "Sphere-fold inner radius - controls how much inner detail is inflated.",
      slot: 2,
      min: 0.1,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var dr = 1.0;
  var trap = 1.0e10;
  let mr2 = gP2 * gP2;
  for (var i = 0; i < gIters; i = i + 1) {
    // box fold
    p = clamp(p, vec3<f32>(-gP1), vec3<f32>(gP1)) * 2.0 - p;
    // sphere fold
    let r2 = dot(p, p);
    if (r2 < mr2) {
      let f = 1.0 / mr2;
      p = p * f;
      dr = dr * f;
    } else if (r2 < 1.0) {
      let f = 1.0 / r2;
      p = p * f;
      dr = dr * f;
    }
    p = p * gP0 + c;
    dr = dr * abs(gP0) + 1.0;
    trap = min(trap, r2);
  }
  return vec2<f32>(length(p) / abs(dr), trap);
}
`,
};

const MANDELBULB: FormulaDef = {
  id: "mandelbulb",
  name: "Mandelbulb",
  iterations: { min: 3, max: 16, defaultValue: 8 },
  params: [
    {
      key: "power",
      label: "Power",
      description: "Exponent of the bulb - 8 is the classic form; higher values add more lobes.",
      slot: 0,
      min: 2,
      max: 16,
      step: 0.05,
      defaultValue: 8,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var z = c;
  var dr = 1.0;
  var r = length(z);
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    r = length(z);
    if (r > 2.0) {
      break;
    }
    let rr = max(r, 1.0e-6);
    let theta = acos(clamp(z.z / rr, -1.0, 1.0)) * gP0;
    let phi = atan2(z.y, z.x) * gP0;
    let zr = pow(rr, gP0);
    dr = pow(rr, gP0 - 1.0) * gP0 * dr + 1.0;
    z = zr * vec3<f32>(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + c;
    trap = min(trap, dot(z, z));
  }
  return vec2<f32>(0.25 * log(max(r, 1.0e-6)) * r / dr, trap);
}
`,
};

const APOLLONIAN: FormulaDef = {
  id: "apollonian",
  name: "Apollonian",
  iterations: { min: 4, max: 14, defaultValue: 9 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description: "Inversion scale - packs the repeating spheres tighter or looser.",
      slot: 0,
      min: 0.9,
      max: 1.6,
      step: 0.005,
      defaultValue: 1.1,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var s = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = -1.0 + 2.0 * fract(0.5 * p + vec3<f32>(0.5));
    let r2 = dot(p, p);
    trap = min(trap, r2);
    let k = gP0 / r2;
    p = p * k;
    s = s * k;
  }
  return vec2<f32>(0.25 * abs(p.y) / s, trap);
}
`,
};

const MENGER: FormulaDef = {
  id: "menger",
  name: "Menger Sponge",
  iterations: { min: 3, max: 10, defaultValue: 5 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description:
        "Fold scale per iteration - 3 is the classic sponge; off-3 values warp the lattice.",
      slot: 0,
      min: 2.2,
      max: 4,
      step: 0.01,
      defaultValue: 3,
    },
    {
      key: "offset",
      label: "Offset",
      description: "Fold offset - widens or narrows the holes carved out of each cell.",
      slot: 1,
      min: 0.6,
      max: 1.4,
      step: 0.01,
      defaultValue: 1,
    },
    {
      key: "twist",
      label: "Twist",
      description: "Per-iteration rotation - shears the strict cubic lattice into spirals.",
      slot: 2,
      min: -0.6,
      max: 0.6,
      step: 0.005,
      defaultValue: 0,
    },
  ],
  de: /* wgsl */ `
fn mengerRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var s = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = mengerRotY(p, gP2);
    p = abs(p);
    if (p.x < p.y) { let t = p.x; p.x = p.y; p.y = t; }
    if (p.x < p.z) { let t = p.x; p.x = p.z; p.z = t; }
    if (p.y < p.z) { let t = p.y; p.y = p.z; p.z = t; }
    trap = min(trap, dot(p, p));
    p = p * gP0 - vec3<f32>(gP1 * (gP0 - 1.0));
    if (p.z < -0.5 * gP1 * (gP0 - 1.0)) {
      p.z = p.z + gP1 * (gP0 - 1.0);
    }
    s = s * gP0;
  }
  let q = abs(p) - vec3<f32>(1.0);
  let d = length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
  return vec2<f32>(d / s, trap);
}
`,
};

const KIFS: FormulaDef = {
  id: "kifs",
  name: "Kaleidoscopic IFS",
  iterations: { min: 6, max: 24, defaultValue: 14 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description: "Fold scale per iteration - higher packs the spires tighter.",
      slot: 0,
      min: 1.4,
      max: 2.4,
      step: 0.005,
      defaultValue: 1.85,
    },
    {
      key: "offset",
      label: "Offset",
      description: "Fold offset - pushes the copies apart, opening the structure.",
      slot: 1,
      min: 0.6,
      max: 1.4,
      step: 0.01,
      defaultValue: 1,
    },
    {
      key: "angle1",
      label: "Pre-rotate",
      description: "Rotation before the fold - the main kaleidoscope knob.",
      slot: 2,
      min: -1.5,
      max: 1.5,
      step: 0.005,
      defaultValue: 0.25,
    },
    {
      key: "angle2",
      label: "Post-rotate",
      description: "Rotation after the fold - skews each recursion level.",
      slot: 3,
      min: -1.5,
      max: 1.5,
      step: 0.005,
      defaultValue: 0.3,
    },
  ],
  de: /* wgsl */ `
fn kifsRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn kifsRotX(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var s = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = kifsRotY(p, gP2);
    // Tetrahedral fold: reflect into the fundamental wedge.
    if (p.x + p.y < 0.0) { let t = -p.y; p.y = -p.x; p.x = t; }
    if (p.x + p.z < 0.0) { let t = -p.z; p.z = -p.x; p.x = t; }
    if (p.y + p.z < 0.0) { let t = -p.z; p.z = -p.y; p.y = t; }
    p = kifsRotX(p, gP3);
    trap = min(trap, dot(p, p));
    p = p * gP0 - vec3<f32>(gP1 * (gP0 - 1.0));
    s = s * gP0;
  }
  return vec2<f32>((length(p) - 2.0) / s, trap);
}
`,
};

const QUATJULIA: FormulaDef = {
  id: "quatjulia",
  name: "Quaternion Julia",
  iterations: { min: 4, max: 16, defaultValue: 9 },
  params: [
    {
      key: "cx",
      label: "Seed X",
      description: "Julia constant, real part - morphs the whole set continuously.",
      slot: 0,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: -0.45,
    },
    {
      key: "cy",
      label: "Seed Y",
      description: "Julia constant, i part.",
      slot: 1,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: 0.55,
    },
    {
      key: "cz",
      label: "Seed Z",
      description: "Julia constant, j part.",
      slot: 2,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: 0.35,
    },
    {
      key: "cw",
      label: "Seed W",
      description: "Julia constant, k part - sweeps through 4D slices of the set.",
      slot: 3,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: 0,
    },
  ],
  de: /* wgsl */ `
fn quatJuliaSq(q: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(q.x * q.x - q.y * q.y - q.z * q.z - q.w * q.w, 2.0 * q.x * q.yzw);
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var z = vec4<f32>(c, 0.0);
  let k = vec4<f32>(gP0, gP1, gP2, gP3);
  var md2 = 1.0;
  var mz2 = dot(z, z);
  var trap = mz2;
  for (var i = 0; i < gIters; i = i + 1) {
    md2 = md2 * 4.0 * mz2;
    z = quatJuliaSq(z) + k;
    mz2 = dot(z, z);
    trap = min(trap, mz2);
    if (mz2 > 4.0) {
      break;
    }
  }
  return vec2<f32>(0.25 * sqrt(mz2 / md2) * log(mz2), trap);
}
`,
};

const KLEINIAN: FormulaDef = {
  id: "kleinian",
  name: "Pseudo-Kleinian",
  iterations: { min: 4, max: 14, defaultValue: 8 },
  params: [
    {
      key: "foldX",
      label: "Fold X",
      description: "Box-fold half-width on X - reshapes the vault walls.",
      slot: 0,
      min: 0.6,
      max: 1.2,
      step: 0.005,
      defaultValue: 0.925,
    },
    {
      key: "foldY",
      label: "Fold Y",
      description: "Box-fold half-width on Y - stretches the arches vertically.",
      slot: 1,
      min: 0.6,
      max: 1.2,
      step: 0.005,
      defaultValue: 0.91,
    },
    {
      key: "foldZ",
      label: "Fold Z",
      description: "Box-fold half-width on Z - reshapes the vault depth.",
      slot: 2,
      min: 0.6,
      max: 1.2,
      step: 0.005,
      defaultValue: 0.925,
    },
    {
      key: "inversion",
      label: "Inversion",
      description: "Sphere-inversion radius - inflates or collapses the nested chambers.",
      slot: 3,
      min: 0.7,
      max: 1.3,
      step: 0.005,
      defaultValue: 1,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  let csize = vec3<f32>(gP0, gP1, gP2);
  var dr = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = 2.0 * clamp(p, -csize, csize) - p;
    let r2 = dot(p, p);
    trap = min(trap, r2);
    let k = max(gP3 / r2, 1.0);
    p = p * k;
    dr = dr * k;
  }
  let rxy = length(p.xy);
  let d = max(rxy - 0.92784, abs(rxy * p.z) / length(p)) / dr;
  // 0.6 safety factor: this DE overestimates near the inversion seams.
  return vec2<f32>(0.6 * d, trap);
}
`,
};

export const FORMULAS: readonly FormulaDef[] = [
  MANDELBOX,
  MANDELBULB,
  APOLLONIAN,
  MENGER,
  KIFS,
  QUATJULIA,
  KLEINIAN,
];

export function getFormula(id: FractalFormulaId): FormulaDef {
  const def = FORMULAS.find((formula) => formula.id === id);
  if (!def) throw new Error(`Unknown fractal formula: ${id}`);
  return def;
}

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

const JULIABULB: FormulaDef = {
  id: "juliabulb",
  name: "Julia Bulb",
  iterations: { min: 3, max: 16, defaultValue: 9 },
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
    {
      key: "seedX",
      label: "Seed X",
      description: "Julia constant, x part - the same bulb family, morphed by a fixed seed.",
      slot: 1,
      min: -1,
      max: 1,
      step: 0.005,
      defaultValue: 0.35,
    },
    {
      key: "seedY",
      label: "Seed Y",
      description: "Julia constant, y part.",
      slot: 2,
      min: -1,
      max: 1,
      step: 0.005,
      defaultValue: 0.1,
    },
    {
      key: "seedZ",
      label: "Seed Z",
      description: "Julia constant, z part - sweeps the seed through the bulb's 3D slices.",
      slot: 3,
      min: -1,
      max: 1,
      step: 0.005,
      defaultValue: 0.2,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var z = c;
  let k = vec3<f32>(gP1, gP2, gP3);
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
    z = zr * vec3<f32>(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + k;
    trap = min(trap, dot(z, z));
  }
  return vec2<f32>(0.25 * log(max(r, 1.0e-6)) * r / dr, trap);
}
`,
};

const AMAZINGBOX: FormulaDef = {
  id: "amazingbox",
  name: "Amazing Box",
  iterations: { min: 4, max: 24, defaultValue: 14 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description:
        "Folding scale factor - the core knob. Sign and magnitude reshape the structure.",
      slot: 0,
      min: -3,
      max: 3.5,
      step: 0.01,
      defaultValue: 2.0,
    },
    {
      key: "fold",
      label: "Fold",
      description: "Box-fold limit on all three axes - the distance at which space folds back.",
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
    {
      key: "rotate",
      label: "Rotate",
      description:
        "Per-iteration rotation - the 'amazing' twist that spirals the box into 3D forms distinct from a plain Mandelbox.",
      slot: 3,
      min: -0.6,
      max: 0.6,
      step: 0.005,
      defaultValue: 0.2,
    },
  ],
  de: /* wgsl */ `
fn aboxRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var dr = 1.0;
  var trap = 1.0e10;
  let mr2 = gP2 * gP2;
  for (var i = 0; i < gIters; i = i + 1) {
    // Per-iteration rotation (rigid, so dr is unaffected) - the distinguishing twist.
    p = aboxRotY(p, gP3);
    // box fold on all three axes (keeps the structure solid, unlike the flat surf fold)
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

const SIERPINSKI: FormulaDef = {
  id: "sierpinski",
  name: "Sierpinski Tetrahedron",
  iterations: { min: 6, max: 24, defaultValue: 15 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description: "Fold scale per iteration - 2 is the canonical gasket; off-2 warps the cells.",
      slot: 0,
      min: 1.5,
      max: 2.6,
      step: 0.005,
      defaultValue: 2,
    },
    {
      key: "offset",
      label: "Offset",
      description: "Fold offset - the tetrahedron vertex spacing; opens or tightens the gasket.",
      slot: 1,
      min: 0.6,
      max: 1.4,
      step: 0.01,
      defaultValue: 1,
    },
    {
      key: "angle",
      label: "Rotate",
      description: "Per-iteration rotation - shears the strict gasket into spirals.",
      slot: 2,
      min: -1.5,
      max: 1.5,
      step: 0.005,
      defaultValue: 0,
    },
  ],
  de: /* wgsl */ `
fn sierpRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var s = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = sierpRotY(p, gP2);
    // Tetrahedral vertex fold: reflect into the fundamental cell.
    if (p.x + p.y < 0.0) { let t = -p.y; p.y = -p.x; p.x = t; }
    if (p.x + p.z < 0.0) { let t = -p.z; p.z = -p.x; p.x = t; }
    if (p.y + p.z < 0.0) { let t = -p.z; p.z = -p.y; p.y = t; }
    trap = min(trap, dot(p, p));
    p = p * gP0 - vec3<f32>(gP1 * (gP0 - 1.0));
    s = s * gP0;
  }
  return vec2<f32>(length(p) / s, trap);
}
`,
};

const OCTAHEDRAL: FormulaDef = {
  id: "octahedral",
  name: "Octahedral IFS",
  iterations: { min: 6, max: 24, defaultValue: 14 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description: "Fold scale per iteration - packs the octahedral cells tighter.",
      slot: 0,
      min: 1.5,
      max: 2.6,
      step: 0.005,
      defaultValue: 2,
    },
    {
      key: "offset",
      label: "Offset",
      description: "Fold offset - the octahedron face spacing; opens or tightens the lattice.",
      slot: 1,
      min: 0.6,
      max: 1.4,
      step: 0.01,
      defaultValue: 1,
    },
    {
      key: "angle",
      label: "Rotate",
      description: "Per-iteration rotation - shears the octahedral lattice into spirals.",
      slot: 2,
      min: -1.5,
      max: 1.5,
      step: 0.005,
      defaultValue: 0,
    },
  ],
  de: /* wgsl */ `
fn octRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var s = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = octRotY(p, gP2);
    // Octahedral fold: abs into the positive octant, then sort descending.
    p = abs(p);
    if (p.x < p.y) { let t = p.x; p.x = p.y; p.y = t; }
    if (p.x < p.z) { let t = p.x; p.x = p.z; p.z = t; }
    if (p.y < p.z) { let t = p.y; p.y = p.z; p.z = t; }
    trap = min(trap, dot(p, p));
    // Pull toward the octahedron vertex on X, leaving Y/Z to recurse.
    p.x = p.x * gP0 - gP1 * (gP0 - 1.0);
    p.y = p.y * gP0;
    p.z = p.z * gP0;
    s = s * gP0;
  }
  let q = abs(p) - vec3<f32>(1.0);
  let d = length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
  return vec2<f32>(d / s, trap);
}
`,
};

const CROSSMENGER: FormulaDef = {
  id: "crossmenger",
  name: "Cross Menger",
  iterations: { min: 3, max: 10, defaultValue: 5 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description: "Fold scale per iteration - 3 is the classic sponge; off-3 warps the lattice.",
      slot: 0,
      min: 2.2,
      max: 4,
      step: 0.01,
      defaultValue: 3,
    },
    {
      key: "offset",
      label: "Offset",
      description: "Fold offset - widens or narrows the cross channels carved from each cell.",
      slot: 1,
      min: 0.6,
      max: 1.4,
      step: 0.01,
      defaultValue: 1,
    },
    {
      key: "twistX",
      label: "Twist X",
      description: "Per-iteration rotation about X - shears the lattice on the first axis.",
      slot: 2,
      min: -0.6,
      max: 0.6,
      step: 0.005,
      defaultValue: 0,
    },
    {
      key: "twistY",
      label: "Twist Y",
      description: "Per-iteration rotation about Y - the second twist axis, distinct from Menger.",
      slot: 3,
      min: -0.6,
      max: 0.6,
      step: 0.005,
      defaultValue: 0,
    },
  ],
  de: /* wgsl */ `
fn cmRotX(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}
fn cmRotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var s = 1.0;
  var trap = 1.0e10;
  let off = gP1;
  for (var i = 0; i < gIters; i = i + 1) {
    p = cmRotX(p, gP2);
    p = cmRotY(p, gP3);
    p = abs(p);
    if (p.x < p.y) { let t = p.x; p.x = p.y; p.y = t; }
    if (p.x < p.z) { let t = p.x; p.x = p.z; p.z = t; }
    if (p.y < p.z) { let t = p.y; p.y = p.z; p.z = t; }
    trap = min(trap, dot(p, p));
    let o2 = off * (gP0 - 1.0);
    p = p * gP0 - vec3<f32>(o2);
    // Cross-channel carve: fold the two minor axes back symmetrically.
    if (p.y < -0.5 * o2) { p.y = p.y + o2; }
    if (p.z < -0.5 * o2) { p.z = p.z + o2; }
    s = s * gP0;
  }
  let q = abs(p) - vec3<f32>(1.0);
  let d = length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
  return vec2<f32>(d / s, trap);
}
`,
};

const BICOMPLEX: FormulaDef = {
  id: "bicomplex",
  name: "Bicomplex Julia",
  iterations: { min: 4, max: 16, defaultValue: 9 },
  params: [
    {
      key: "cx",
      label: "Seed X",
      description: "Hypercomplex constant, real part - morphs the whole set continuously.",
      slot: 0,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: -0.2,
    },
    {
      key: "cy",
      label: "Seed Y",
      description: "Hypercomplex constant, i part.",
      slot: 1,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: 0.4,
    },
    {
      key: "cz",
      label: "Seed Z",
      description: "Hypercomplex constant, j part.",
      slot: 2,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: -0.25,
    },
    {
      key: "cw",
      label: "Seed W",
      description: "Hypercomplex constant, k part - sweeps through 4D slices of the set.",
      slot: 3,
      min: -1.2,
      max: 1.2,
      step: 0.005,
      defaultValue: 0,
    },
  ],
  de: /* wgsl */ `
fn hyperSq(q: vec4<f32>) -> vec4<f32> {
  // White/Nylander hypercomplex square (commutative; distinct from quaternion mult).
  return vec4<f32>(
    q.x * q.x - q.y * q.y - q.z * q.z + q.w * q.w,
    2.0 * (q.x * q.y - q.z * q.w),
    2.0 * (q.x * q.z - q.y * q.w),
    2.0 * (q.x * q.w + q.y * q.z),
  );
}
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var z = vec4<f32>(c, 0.0);
  let k = vec4<f32>(gP0, gP1, gP2, gP3);
  var md2 = 1.0;
  var mz2 = dot(z, z);
  var trap = mz2;
  for (var i = 0; i < gIters; i = i + 1) {
    md2 = md2 * 4.0 * mz2;
    z = hyperSq(z) + k;
    mz2 = dot(z, z);
    trap = min(trap, mz2);
    if (mz2 > 4.0) {
      break;
    }
  }
  return vec2<f32>(0.25 * sqrt(mz2 / md2) * log(max(mz2, 1.0e-9)), trap);
}
`,
};

const TRIGBULB: FormulaDef = {
  id: "trigbulb",
  name: "Sinusoidal Bulb",
  iterations: { min: 3, max: 14, defaultValue: 8 },
  params: [
    {
      key: "power",
      label: "Power",
      description: "Exponent of the bulb - sets the base lobe count before the sine warp.",
      slot: 0,
      min: 2,
      max: 12,
      step: 0.05,
      defaultValue: 8,
    },
    {
      key: "amp",
      label: "Warp amp",
      description: "Sine domain-warp amplitude - wisps and tendrils. Keep low for a stable march.",
      slot: 1,
      min: 0,
      max: 0.4,
      step: 0.005,
      defaultValue: 0.15,
    },
    {
      key: "freq",
      label: "Warp freq",
      description: "Sine warp frequency - finer ripples at higher values.",
      slot: 2,
      min: 0.5,
      max: 4,
      step: 0.01,
      defaultValue: 2,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var z = c;
  var dr = 1.0;
  var r = length(z);
  var trap = 1.0e10;
  // Lipschitz bound of the sine domain warp, folded into the running derivative.
  let warpL = 1.0 + gP1 * gP2;
  for (var i = 0; i < gIters; i = i + 1) {
    r = length(z);
    if (r > 2.0) {
      break;
    }
    let rr = max(r, 1.0e-6);
    let theta = acos(clamp(z.z / rr, -1.0, 1.0)) * gP0;
    let phi = atan2(z.y, z.x) * gP0;
    let zr = pow(rr, gP0);
    dr = pow(rr, gP0 - 1.0) * gP0 * dr * warpL + 1.0;
    var w = zr * vec3<f32>(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
    // Bounded sine domain perturbation - the wispy, alien character.
    w = w + gP1 * sin(gP2 * w.zxy);
    z = w + c;
    trap = min(trap, dot(z, z));
  }
  // Conservative factor (matches the bulb family): the warped DE overestimates near the tendrils.
  return vec2<f32>(0.25 * log(max(r, 1.0e-6)) * r / dr, trap);
}
`,
};

const SPHEREPACK: FormulaDef = {
  id: "spherepack",
  name: "Bubble Sphere",
  iterations: { min: 1, max: 6, defaultValue: 4 },
  params: [
    {
      key: "holes",
      label: "Hole size",
      description:
        "How much of each lattice cell the carved bubble fills - bigger = more porous, thinner webbing.",
      slot: 0,
      min: 0.3,
      max: 0.95,
      step: 0.01,
      defaultValue: 0.7,
    },
    {
      key: "radius",
      label: "Ball radius",
      description: "Radius of the solid ball the bubbles are carved out of.",
      slot: 1,
      min: 0.5,
      max: 2.5,
      step: 0.01,
      defaultValue: 1.0,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  // Start from a solid ball, then carve spherical holes at successively finer
  // scales. Domain repetition (fract) is a translation, so it preserves distance;
  // max(d, -hole) is exact SDF subtraction. The result is a fractal bubble-orb.
  var d = length(c) - gP1;
  var trap = dot(c, c);
  var freq = 3.0;
  for (var i = 0; i < gIters; i = i + 1) {
    let period = 2.0 / freq;
    let cell = (fract(c / period + vec3<f32>(0.5)) - vec3<f32>(0.5)) * period;
    trap = min(trap, dot(cell, cell));
    let hole = length(cell) - gP0 * period * 0.5;
    d = max(d, -hole);
    freq = freq * 3.0;
  }
  return vec2<f32>(d, trap);
}
`,
};

const MENGERSPHERE: FormulaDef = {
  id: "mengersphere",
  name: "Sphere Sponge",
  iterations: { min: 3, max: 10, defaultValue: 5 },
  params: [
    {
      key: "scale",
      label: "Scale",
      description: "Fold scale per iteration - 3 is the classic sponge; off-3 warps the holes.",
      slot: 0,
      min: 2.2,
      max: 4,
      step: 0.01,
      defaultValue: 3,
    },
    {
      key: "offset",
      label: "Offset",
      description: "Fold offset - widens or narrows the holes bored through the ball.",
      slot: 1,
      min: 0.6,
      max: 1.4,
      step: 0.01,
      defaultValue: 1,
    },
    {
      key: "radius",
      label: "Ball radius",
      description:
        "Bounding-sphere radius - keep it under ~1 so the ball sits inside the sponge faces and reads as a sphere; larger lets the cube corners poke through.",
      slot: 2,
      min: 0.5,
      max: 2.5,
      step: 0.01,
      defaultValue: 0.9,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  var s = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = abs(p);
    if (p.x < p.y) { let t = p.x; p.x = p.y; p.y = t; }
    if (p.x < p.z) { let t = p.x; p.x = p.z; p.z = t; }
    if (p.y < p.z) { let t = p.y; p.y = p.z; p.z = t; }
    trap = min(trap, dot(p, p));
    let off = gP1 * (gP0 - 1.0);
    p = p * gP0 - vec3<f32>(off);
    if (p.z < -0.5 * off) {
      p.z = p.z + off;
    }
    s = s * gP0;
  }
  let q = abs(p) - vec3<f32>(1.0);
  let box = (length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0)) / s;
  // Intersect the sponge with a bounding sphere: a solid ball with holes bored through it.
  let shell = length(c) - gP2;
  return vec2<f32>(max(box, shell), trap);
}
`,
};

const KLEINSPHERE: FormulaDef = {
  id: "kleinsphere",
  name: "Sphere Foam",
  iterations: { min: 4, max: 14, defaultValue: 8 },
  params: [
    {
      key: "fold",
      label: "Fold",
      description:
        "Box-fold half-width - lower keeps the chambers compact inside the ball; higher pokes them out past the sphere.",
      slot: 0,
      min: 0.5,
      max: 1.2,
      step: 0.005,
      defaultValue: 0.6,
    },
    {
      key: "inversion",
      label: "Inversion",
      description: "Sphere-inversion radius - inflates or collapses the nested chambers.",
      slot: 1,
      min: 0.7,
      max: 1.3,
      step: 0.005,
      defaultValue: 1,
    },
    {
      key: "radius",
      label: "Ball radius",
      description:
        "Bounding-sphere radius - the Kleinian chambers are carved into a ball this size.",
      slot: 2,
      min: 0.5,
      max: 2.5,
      step: 0.01,
      defaultValue: 1.1,
    },
  ],
  de: /* wgsl */ `
fn formulaDE(c: vec3<f32>) -> vec2<f32> {
  var p = c;
  let csize = vec3<f32>(gP0);
  var dr = 1.0;
  var trap = 1.0e10;
  for (var i = 0; i < gIters; i = i + 1) {
    p = 2.0 * clamp(p, -csize, csize) - p;
    let r2 = dot(p, p);
    trap = min(trap, r2);
    let k = max(gP1 / max(r2, 1.0e-30), 1.0);
    p = p * k;
    dr = dr * k;
  }
  let rxy = length(p.xy);
  let inner = 0.6 * max(rxy - 0.92784, abs(rxy * p.z) / max(length(p), 1.0e-30)) / dr;
  // Intersect the Kleinian foam with a bounding sphere: a sphere of nested chambers.
  let shell = length(c) - gP2;
  return vec2<f32>(max(inner, shell), trap);
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
  JULIABULB,
  AMAZINGBOX,
  SIERPINSKI,
  OCTAHEDRAL,
  CROSSMENGER,
  BICOMPLEX,
  TRIGBULB,
  SPHEREPACK,
  MENGERSPHERE,
  KLEINSPHERE,
];

export function getFormula(id: FractalFormulaId): FormulaDef {
  const def = FORMULAS.find((formula) => formula.id === id);
  if (!def) throw new Error(`Unknown fractal formula: ${id}`);
  return def;
}

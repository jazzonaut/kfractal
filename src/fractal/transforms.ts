/**
 * Hybrid-chain transform registry (hybrid-formula-chains design, Phase 0).
 *
 * A transform is one composable operator from the per-iteration body of the atomic
 * formulas (registry.ts). A FormulaChain (chain.ts) is an ordered list of these,
 * applied every iteration. Each transform is defined ONCE in two paired
 * implementations - a WGSL body and an f64 CPU mirror - exactly like the warp
 * (warp.ts): the GPU renders one, the DiveController marches the other, and the
 * per-transform agreement test guards them against drift.
 *
 * The agreement burden is per-transform (~5 operators), not per-formula (18) or
 * per-chain (unbounded): if each transform's two impls agree, every chain built from
 * them agrees by construction.
 *
 * Shared iteration state (the chain threads this through every stage):
 *   p   running position   (vec3)
 *   dr  running derivative (f32) - the linear-DE denominator; folds/scales multiply
 *       into it, escape-time steps do `dr = dr*k + 1`.
 * The orbit trap is accumulated by the chain after each iteration (chain.ts), not by
 * individual transforms, so it stays a single closed-form measure across any operator mix.
 *
 * WGSL bodies reference their stage params with `$0..$3` tokens (param index within the
 * stage). The chain compiler rewrites each `$k` to the stage's uniform slot
 * (`gStageP[<stage>].{x,y,z,w}`) so value tweaks are uniforms (no recompile) - only
 * structural edits recompile. Each stage body is emitted inside its own `{ }` block, so
 * transforms may freely declare local `let`s (`r`, `f`, ...) without colliding across stages.
 */

export type TransformId =
  | "boxFold"
  | "sphereFold"
  | "scaleAddC"
  | "bulbPow"
  | "rotate"
  | "mengerFold"
  | "kifsFold"
  | "sphereInvert"
  | "latticeFold"
  | "sinWarp";

export interface TransformParamDef {
  readonly key: string;
  readonly label: string;
  /** One-line tooltip explaining what the param does. */
  readonly description: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
}

/** Mutable f64 iteration state the CPU transforms operate on in place. */
export interface ChainState {
  px: number;
  py: number;
  pz: number;
  dr: number;
}

export interface Transform {
  readonly id: TransformId;
  readonly name: string;
  readonly params: readonly TransformParamDef[];
  /** WGSL body operating on `p`/`dr`, params as `$0..$3`. Emitted inside a `{ }` block. */
  readonly wgsl: string;
  /** f64 mirror: mutate `s` in place; `v` is this stage's params keyed by `params[].key`. */
  readonly cpu: (s: ChainState, v: Readonly<Record<string, number>>) => void;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** One axis of the period-2 lattice fold into [-1, 1) (Apollonian gasket repeat). */
const latticeFoldAxis = (x: number): number => {
  const f = x * 0.5 + 0.5;
  return (f - Math.floor(f)) * 2 - 1;
};

const BOX_FOLD: Transform = {
  id: "boxFold",
  name: "Box fold",
  params: [
    {
      key: "fold",
      label: "Fold",
      description: "Box-fold limit - the distance at which space folds back on itself.",
      min: 0.5,
      max: 2,
      step: 0.01,
      defaultValue: 1,
    },
  ],
  wgsl: /* wgsl */ `p = clamp(p, vec3<f32>(-($0)), vec3<f32>($0)) * 2.0 - p;`,
  cpu: (s, v) => {
    const f = v.fold!;
    s.px = clamp(s.px, -f, f) * 2 - s.px;
    s.py = clamp(s.py, -f, f) * 2 - s.py;
    s.pz = clamp(s.pz, -f, f) * 2 - s.pz;
  },
};

const SPHERE_FOLD: Transform = {
  id: "sphereFold",
  name: "Sphere fold",
  params: [
    {
      key: "minRadius",
      label: "Min radius",
      description: "Sphere-fold inner radius - controls how much inner detail is inflated.",
      min: 0.1,
      max: 1,
      step: 0.01,
      defaultValue: 0.5,
    },
  ],
  wgsl: /* wgsl */ `
    let mr2 = $0 * $0;
    let r2 = dot(p, p);
    if (r2 < mr2) {
      let f = 1.0 / mr2;
      p = p * f;
      dr = dr * f;
    } else if (r2 < 1.0) {
      let f = 1.0 / r2;
      p = p * f;
      dr = dr * f;
    }`,
  cpu: (s, v) => {
    const mr2 = v.minRadius! * v.minRadius!;
    const r2 = s.px * s.px + s.py * s.py + s.pz * s.pz;
    if (r2 < mr2) {
      const f = 1 / mr2;
      s.px *= f;
      s.py *= f;
      s.pz *= f;
      s.dr *= f;
    } else if (r2 < 1) {
      const f = 1 / r2;
      s.px *= f;
      s.py *= f;
      s.pz *= f;
      s.dr *= f;
    }
  },
};

const SCALE_ADD_C: Transform = {
  id: "scaleAddC",
  name: "Scale",
  params: [
    {
      key: "scale",
      label: "Scale",
      description:
        "Linear scale factor applied to the running position; the chain's `addC` reinjects c after the stages.",
      min: -3,
      max: 3.5,
      step: 0.01,
      defaultValue: 2,
    },
  ],
  // The `+ c` reinjection is the chain's `addC` step, applied after all stages, so this
  // transform is the pure scale: `p*s` + `dr*|s| + 1` reproduces the mandelbox/IFS iterate.
  wgsl: /* wgsl */ `
    p = p * $0;
    dr = dr * abs($0) + 1.0;`,
  cpu: (s, v) => {
    const scale = v.scale!;
    s.px *= scale;
    s.py *= scale;
    s.pz *= scale;
    s.dr = s.dr * Math.abs(scale) + 1;
  },
};

const BULB_POW: Transform = {
  id: "bulbPow",
  name: "Bulb power",
  params: [
    {
      key: "power",
      label: "Power",
      description: "Exponent of the spherical power iteration - 8 is the classic Mandelbulb.",
      min: 2,
      max: 16,
      step: 0.05,
      defaultValue: 8,
    },
  ],
  // Spherical power iteration without the `+ c` (the chain's `addC` does that) and without
  // the bailout/trap (chain-level). Reproduces the mandelbulb iterate exactly under `addC`.
  wgsl: /* wgsl */ `
    let r = length(p);
    let rr = max(r, 1.0e-6);
    let theta = acos(clamp(p.z / rr, -1.0, 1.0)) * $0;
    let phi = atan2(p.y, p.x) * $0;
    let zr = pow(rr, $0);
    dr = pow(rr, $0 - 1.0) * $0 * dr + 1.0;
    p = zr * vec3<f32>(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));`,
  cpu: (s, v) => {
    const power = v.power!;
    const r = Math.sqrt(s.px * s.px + s.py * s.py + s.pz * s.pz);
    const rr = Math.max(r, 1e-6);
    const theta = Math.acos(clamp(s.pz / rr, -1, 1)) * power;
    const phi = Math.atan2(s.py, s.px) * power;
    const zr = Math.pow(rr, power);
    s.dr = Math.pow(rr, power - 1) * power * s.dr + 1;
    const st = Math.sin(theta);
    s.px = zr * st * Math.cos(phi);
    s.py = zr * st * Math.sin(phi);
    s.pz = zr * Math.cos(theta);
  },
};

const ROTATE: Transform = {
  id: "rotate",
  name: "Rotate",
  params: [
    {
      key: "angle",
      label: "Angle",
      description: "Rotation angle in radians (rigid, so it does not change the derivative dr).",
      min: -Math.PI,
      max: Math.PI,
      step: 0.01,
      defaultValue: 0,
    },
    {
      key: "axis",
      label: "Axis",
      description: "Rotation axis: 0 = X, 1 = Y, 2 = Z.",
      min: 0,
      max: 2,
      step: 1,
      defaultValue: 1,
    },
  ],
  // Right-handed rotation about the selected axis. Rigid, so dr is untouched.
  wgsl: /* wgsl */ `
    let ang = $0;
    let ca = cos(ang);
    let sa = sin(ang);
    let ax = i32($1 + 0.5);
    if (ax == 0) {
      p = vec3<f32>(p.x, ca * p.y - sa * p.z, sa * p.y + ca * p.z);
    } else if (ax == 2) {
      p = vec3<f32>(ca * p.x - sa * p.y, sa * p.x + ca * p.y, p.z);
    } else {
      p = vec3<f32>(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
    }`,
  cpu: (s, v) => {
    const ca = Math.cos(v.angle!);
    const sa = Math.sin(v.angle!);
    const ax = Math.round(v.axis!);
    if (ax === 0) {
      const ny = ca * s.py - sa * s.pz;
      const nz = sa * s.py + ca * s.pz;
      s.py = ny;
      s.pz = nz;
    } else if (ax === 2) {
      const nx = ca * s.px - sa * s.py;
      const ny = sa * s.px + ca * s.py;
      s.px = nx;
      s.py = ny;
    } else {
      const nx = ca * s.px + sa * s.pz;
      const nz = -sa * s.px + ca * s.pz;
      s.px = nx;
      s.pz = nz;
    }
  },
};

const MENGER_FOLD: Transform = {
  id: "mengerFold",
  name: "Menger fold",
  params: [
    {
      key: "offset",
      label: "Offset",
      description: "Corner translation after the abs+sort fold - sets the Menger/octahedral cell.",
      min: 0,
      max: 2,
      step: 0.01,
      defaultValue: 1,
    },
  ],
  // abs into the first octant, sort the axes descending, translate by the offset, and shift the
  // minor axis back (the Menger corner carve). All rigid/reflective, so dr is untouched.
  wgsl: /* wgsl */ `
    p = abs(p);
    if (p.x < p.y) { let t = p.x; p.x = p.y; p.y = t; }
    if (p.x < p.z) { let t = p.x; p.x = p.z; p.z = t; }
    if (p.y < p.z) { let t = p.y; p.y = p.z; p.z = t; }
    p = p - vec3<f32>($0);
    if (p.z < -0.5 * $0) { p.z = p.z + $0; }`,
  cpu: (s, v) => {
    const off = v.offset!;
    s.px = Math.abs(s.px);
    s.py = Math.abs(s.py);
    s.pz = Math.abs(s.pz);
    if (s.px < s.py) {
      const t = s.px;
      s.px = s.py;
      s.py = t;
    }
    if (s.px < s.pz) {
      const t = s.px;
      s.px = s.pz;
      s.pz = t;
    }
    if (s.py < s.pz) {
      const t = s.py;
      s.py = s.pz;
      s.pz = t;
    }
    s.px -= off;
    s.py -= off;
    s.pz -= off;
    if (s.pz < -0.5 * off) s.pz += off;
  },
};

const KIFS_FOLD: Transform = {
  id: "kifsFold",
  name: "Tetra fold",
  params: [],
  // Tetrahedral (Sierpinski) reflection fold: reflect across the three diagonal planes. Rigid,
  // so dr is untouched.
  wgsl: /* wgsl */ `
    if (p.x + p.y < 0.0) { let t = -p.y; p.y = -p.x; p.x = t; }
    if (p.x + p.z < 0.0) { let t = -p.z; p.z = -p.x; p.x = t; }
    if (p.y + p.z < 0.0) { let t = -p.z; p.z = -p.y; p.y = t; }`,
  cpu: (s) => {
    if (s.px + s.py < 0) {
      const t = -s.py;
      s.py = -s.px;
      s.px = t;
    }
    if (s.px + s.pz < 0) {
      const t = -s.pz;
      s.pz = -s.px;
      s.px = t;
    }
    if (s.py + s.pz < 0) {
      const t = -s.pz;
      s.pz = -s.py;
      s.py = t;
    }
  },
};

const SPHERE_INVERT: Transform = {
  id: "sphereInvert",
  name: "Sphere inversion",
  params: [
    {
      key: "factor",
      label: "Radius²",
      description: "Inversion radius squared - the Apollonian/Kleinian sphere inversion strength.",
      min: 0.1,
      max: 2,
      step: 0.01,
      defaultValue: 1,
    },
  ],
  // Inversion in a sphere: p <- factor/|p|^2 * p, updating the derivative by the same factor.
  wgsl: /* wgsl */ `
    let r2 = max(dot(p, p), 1.0e-12);
    let k = $0 / r2;
    p = p * k;
    dr = dr * k;`,
  cpu: (s, v) => {
    const r2 = Math.max(s.px * s.px + s.py * s.py + s.pz * s.pz, 1e-12);
    const k = v.factor! / r2;
    s.px *= k;
    s.py *= k;
    s.pz *= k;
    s.dr *= k;
  },
};

const LATTICE_FOLD: Transform = {
  id: "latticeFold",
  name: "Lattice fold",
  params: [],
  // Period-2 lattice fold of each axis into [-1, 1) (the Apollonian gasket's repeat). A
  // piecewise translation, so dr is untouched.
  wgsl: /* wgsl */ `
    let f = p * 0.5 + vec3<f32>(0.5);
    p = (f - floor(f)) * 2.0 - vec3<f32>(1.0);`,
  cpu: (s) => {
    s.px = latticeFoldAxis(s.px);
    s.py = latticeFoldAxis(s.py);
    s.pz = latticeFoldAxis(s.pz);
  },
};

const SIN_WARP: Transform = {
  id: "sinWarp",
  name: "Sine warp",
  params: [
    {
      key: "amp",
      label: "Amplitude",
      description: "Sinusoidal domain-warp amplitude - bends the iterate along each axis.",
      min: 0,
      max: 0.5,
      step: 0.01,
      defaultValue: 0.1,
    },
    {
      key: "freq",
      label: "Frequency",
      description: "Sinusoidal warp frequency.",
      min: 0.5,
      max: 8,
      step: 0.1,
      defaultValue: 2,
    },
  ],
  // Bounded sinusoidal cross-axis displacement (the trigbulb warp). dr is multiplied by the
  // warp's Lipschitz bound (1 + amp*freq) to keep the march conservative.
  wgsl: /* wgsl */ `
    let w = p;
    p = vec3<f32>(
      w.x + $0 * sin($1 * w.z),
      w.y + $0 * sin($1 * w.x),
      w.z + $0 * sin($1 * w.y)
    );
    dr = dr * (1.0 + $0 * $1);`,
  cpu: (s, v) => {
    const amp = v.amp!;
    const freq = v.freq!;
    const wx = s.px;
    const wy = s.py;
    const wz = s.pz;
    s.px = wx + amp * Math.sin(freq * wz);
    s.py = wy + amp * Math.sin(freq * wx);
    s.pz = wz + amp * Math.sin(freq * wy);
    s.dr *= 1 + amp * freq;
  },
};

const TRANSFORMS: Record<TransformId, Transform> = {
  boxFold: BOX_FOLD,
  sphereFold: SPHERE_FOLD,
  scaleAddC: SCALE_ADD_C,
  bulbPow: BULB_POW,
  rotate: ROTATE,
  mengerFold: MENGER_FOLD,
  kifsFold: KIFS_FOLD,
  sphereInvert: SPHERE_INVERT,
  latticeFold: LATTICE_FOLD,
  sinWarp: SIN_WARP,
};

export const TRANSFORM_LIST: readonly Transform[] = Object.values(TRANSFORMS);

export function getTransform(id: TransformId): Transform {
  return TRANSFORMS[id];
}

/** Max params any single transform declares - the per-stage uniform vec4 must hold this. */
export const MAX_TRANSFORM_PARAMS = 4;

import { sortStopsByPosition } from "../fractal/types";
import type { ColorStop, RampColorSpace, RampInterpolation } from "../fractal/types";

/**
 * CPU-side gradient-ramp baker — drives the editor's gradient PREVIEW only (a CSS strip in
 * GradientStops.vue). The actual render does NOT use this: the GPU blends the stops analytically
 * in WGSL (`gradient()` in shaders/pathtrace.ts), fed by per-stop uniforms from fractal-pass.
 *
 * The two are independent implementations of the same maths (segment search, easing, OKLab) and
 * MUST stay in agreement so the preview matches the render. ramp.test.ts pins this side against a
 * reference that mirrors the WGSL; change the easing or an OKLab coefficient in one place and you
 * must change it in both. (A GPU-readback parity check is the proper long-term guard — see the
 * standing CPU↔WGSL agreement follow-up.)
 *
 * Output is LINEAR RGB. RGB-space interpolation therefore mixes in linear light, matching both the
 * WGSL blend and the pre-multi-stop `mix(colA, colB, t)`.
 */

/** Sample count the baked ramp is evaluated at; the preview reads a subset of these. */
export const RAMP_SIZE = 256;

/** Single sRGB channel (0..1) → linear light, the standard sRGB EOTF (matches THREE.Color). */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parse `#rrggbb` → linear-RGB triple. */
function srgbHexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.replace(/^#/, ""), 16);
  return [
    srgbToLinear(((n >> 16) & 0xff) / 255),
    srgbToLinear(((n >> 8) & 0xff) / 255),
    srgbToLinear((n & 0xff) / 255),
  ];
}

/** Linear sRGB → OKLab (Björn Ottosson). Operates on linear-light triples. */
function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const lc = Math.cbrt(l);
  const mc = Math.cbrt(m);
  const sc = Math.cbrt(s);
  return [
    0.2104542553 * lc + 0.793617785 * mc - 0.0040720468 * sc,
    1.9779984951 * lc - 2.428592205 * mc + 0.4505937099 * sc,
    0.0259040371 * lc + 0.7827717662 * mc - 0.808675766 * sc,
  ];
}

/** OKLab → linear sRGB (inverse of {@link linearToOklab}). */
function oklabToLinear(L: number, a: number, bb: number): [number, number, number] {
  const lc = L + 0.3963377774 * a + 0.2158037573 * bb;
  const mc = L - 0.1055613458 * a - 0.0638541728 * bb;
  const sc = L - 0.0894841775 * a - 1.291485548 * bb;
  const l = lc * lc * lc;
  const m = mc * mc * mc;
  const s = sc * sc * sc;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Eased blend fraction within a segment. `stepped` holds the lower stop (hard bands). */
function ease(f: number, interpolation: RampInterpolation): number {
  if (interpolation === "stepped") return 0;
  if (interpolation === "smooth") return f * f * (3 - 2 * f);
  return f;
}

/**
 * Bake `stops` into a {@link RAMP_SIZE}×4 linear-RGBA `Float32Array` (alpha always 1). Stops
 * are sorted by position and clamped to [0,1]; the ramp holds flat below the first and above
 * the last stop. Requires at least one stop (callers guarantee ≥2).
 */
export function bakeRamp(
  stops: readonly ColorStop[],
  interpolation: RampInterpolation,
  colorSpace: RampColorSpace,
): Float32Array {
  const sorted = sortStopsByPosition(stops);
  const pos = sorted.map((s) => Math.min(1, Math.max(0, s.position)));
  const lin = sorted.map((s) => srgbHexToLinear(s.color));
  const lab = colorSpace === "oklab" ? lin.map(([r, g, b]) => linearToOklab(r, g, b)) : lin;

  const out = new Float32Array(RAMP_SIZE * 4);
  let seg = 0;
  for (let i = 0; i < RAMP_SIZE; i += 1) {
    const t = i / (RAMP_SIZE - 1);
    // Advance to the segment [pos[seg], pos[seg+1]] that brackets t.
    while (seg < pos.length - 2 && t > pos[seg + 1]!) seg += 1;

    let rgb: [number, number, number];
    if (t <= pos[0]!) {
      rgb = lin[0]!;
    } else if (t >= pos[pos.length - 1]!) {
      rgb = lin[lin.length - 1]!;
    } else {
      const span = pos[seg + 1]! - pos[seg]!;
      const f = span > 1e-6 ? ease((t - pos[seg]!) / span, interpolation) : 0;
      const a = lab[seg]!;
      const b = lab[seg + 1]!;
      const mix: [number, number, number] = [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
      ];
      rgb = colorSpace === "oklab" ? oklabToLinear(mix[0], mix[1], mix[2]) : mix;
    }

    // Gamut-clip to [0,1]. RGB interpolation of in-gamut stops never leaves the cube, but an
    // OKLab lerp can land out of sRGB gamut and convert back above 1.0 — and this feeds
    // surfaceMaterial().albedo, where >1 is reflectance > 100% (energy gain in the tracer).
    const o = i * 4;
    out[o] = Math.min(1, Math.max(0, rgb[0]));
    out[o + 1] = Math.min(1, Math.max(0, rgb[1]));
    out[o + 2] = Math.min(1, Math.max(0, rgb[2]));
    out[o + 3] = 1;
  }
  return out;
}

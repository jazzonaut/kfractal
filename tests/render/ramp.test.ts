import { describe, expect, it } from "vitest";
import { RAMP_SIZE, bakeRamp } from "../../src/render/ramp";
import { buildRenderSampleWGSL } from "../../src/render/shaders/pathtrace";
import { MAX_PALETTE_STOPS, sortStopsByPosition } from "../../src/fractal/types";
import type { ColorStop, RampColorSpace, RampInterpolation } from "../../src/fractal/types";

// sRGB EOTF, matched to the baker, so expectations are written in human #hex terms.
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
const first = (r: Float32Array) => [r[0]!, r[1]!, r[2]!] as const;
const last = (r: Float32Array) => {
  const o = (RAMP_SIZE - 1) * 4;
  return [r[o]!, r[o + 1]!, r[o + 2]!] as const;
};
const mid = (r: Float32Array) => {
  const o = (RAMP_SIZE >> 1) * 4;
  return [r[o]!, r[o + 1]!, r[o + 2]!] as const;
};

const BLACK_GREY_WHITE: ColorStop[] = [
  { position: 0, color: "#000000" },
  { position: 0.5, color: "#808080" },
  { position: 1, color: "#ffffff" },
];

describe("bakeRamp", () => {
  it("produces RAMP_SIZE RGBA texels with alpha 1", () => {
    const r = bakeRamp(BLACK_GREY_WHITE, "linear", "rgb");
    expect(r.length).toBe(RAMP_SIZE * 4);
    for (let i = 3; i < r.length; i += 4) expect(r[i]).toBe(1);
  });

  it("pins the endpoints to the first and last stop colours (linear light)", () => {
    const r = bakeRamp(BLACK_GREY_WHITE, "linear", "rgb");
    expect(first(r)).toEqual([0, 0, 0]);
    last(r).forEach((c) => expect(c).toBeCloseTo(1, 5));
  });

  it("hits the mid stop colour near t=0.5 in linear RGB", () => {
    // Texel 128 sits at t≈0.502, a fraction past the 0.5 grey stop, so allow the ~0.003
    // quantization slack rather than demand the exact grey value.
    const r = bakeRamp(BLACK_GREY_WHITE, "linear", "rgb");
    mid(r).forEach((c) => expect(c).toBeCloseTo(lin(0x80), 2));
  });

  it("stepped interpolation holds the lower stop (hard bands)", () => {
    const r = bakeRamp(
      [
        { position: 0, color: "#000000" },
        { position: 0.5, color: "#ffffff" },
      ],
      "stepped",
      "rgb",
    );
    // Just below the boundary still reads black; the upper stop only appears at t>=0.5.
    const o = ((RAMP_SIZE >> 1) - 1) * 4;
    expect([r[o], r[o + 1], r[o + 2]]).toEqual([0, 0, 0]);
  });

  it("OKLab interpolation diverges from RGB at the midpoint", () => {
    const stops: ColorStop[] = [
      { position: 0, color: "#ff0000" },
      { position: 1, color: "#0000ff" },
    ];
    const rgb = mid(bakeRamp(stops, "linear", "rgb"));
    const oklab = mid(bakeRamp(stops, "linear", "oklab"));
    const delta =
      Math.abs(rgb[0] - oklab[0]) + Math.abs(rgb[1] - oklab[1]) + Math.abs(rgb[2] - oklab[2]);
    expect(delta).toBeGreaterThan(0.01);
  });

  it("clamps flat outside the stop range when stops do not span 0..1", () => {
    const r = bakeRamp(
      [
        { position: 0.25, color: "#ff0000" },
        { position: 0.75, color: "#00ff00" },
      ],
      "linear",
      "rgb",
    );
    expect(first(r)[0]).toBeCloseTo(1, 5); // red holds below 0.25
    expect(last(r)[1]).toBeCloseTo(1, 5); // green holds above 0.75
  });

  it("keeps OKLab output in [0,1] so albedo never exceeds 100% reflectance", () => {
    // Saturated blue↔yellow in OKLab bulges out of sRGB gamut; the bake must clip it.
    const r = bakeRamp(
      [
        { position: 0, color: "#0000ff" },
        { position: 1, color: "#ffff00" },
      ],
      "linear",
      "oklab",
    );
    for (let i = 0; i < r.length; i += 1) {
      expect(r[i]).toBeGreaterThanOrEqual(0);
      expect(r[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ── CPU↔GPU parity ───────────────────────────────────────────────────────────────────────
// `bakeRamp` drives the editor preview; the GPU blends the stops independently in WGSL
// (`gradient()` in shaders/pathtrace.ts). `referenceGradient` below is a faithful TS transcription
// of that WGSL so the two implementations can't silently diverge: if either's easing/OKLab maths
// changes, this test breaks until both agree. (A GPU-readback check would close the loop fully.)
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}
function toOklab([r, g, b]: number[]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function fromOklab([L, A, B]: number[]): [number, number, number] {
  const lc = L! + 0.3963377774 * A! + 0.2158037573 * B!;
  const mc = L! - 0.1055613458 * A! - 0.0638541728 * B!;
  const sc = L! - 0.0894841775 * A! - 1.291485548 * B!;
  const l = lc ** 3;
  const m = mc ** 3;
  const s = sc ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
function referenceGradient(
  stops: ColorStop[],
  interp: RampInterpolation,
  space: RampColorSpace,
  tIn: number,
): number[] {
  const sorted = sortStopsByPosition(stops);
  const pos = sorted.map((s) => Math.min(1, Math.max(0, s.position)));
  const cols = sorted.map((s) => hexToLinear(s.color));
  const t = Math.min(1, Math.max(0, tIn));
  const lastIdx = pos.length - 1;
  if (t <= pos[0]!) return cols[0]!;
  if (t >= pos[lastIdx]!) return cols[lastIdx]!;
  let lo = 0;
  for (let i = 0; i < lastIdx; i += 1)
    if (t >= pos[i]! && t <= pos[i + 1]!) {
      lo = i;
      break;
    }
  const span = pos[lo + 1]! - pos[lo]!;
  let f = span > 1e-6 ? (t - pos[lo]!) / span : 0;
  if (interp === "stepped") f = 0;
  else if (interp === "smooth") f = f * f * (3 - 2 * f);
  const a = cols[lo]!;
  const b = cols[lo + 1]!;
  if (space === "oklab") {
    const la = toOklab(a);
    const lb = toOklab(b);
    const mixed = fromOklab([0, 1, 2].map((k) => la[k]! + (lb[k]! - la[k]!) * f));
    return mixed.map((c) => Math.min(1, Math.max(0, c)));
  }
  return [0, 1, 2].map((k) => a[k]! + (b[k]! - a[k]!) * f);
}

describe("ramp preview ↔ WGSL render parity", () => {
  const STOPS: ColorStop[] = [
    { position: 0, color: "#140c3f" },
    { position: 0.35, color: "#4f8fe8" },
    { position: 1, color: "#e84fd0" },
  ];
  const interps: RampInterpolation[] = ["linear", "smooth", "stepped"];
  const spaces: RampColorSpace[] = ["rgb", "oklab"];
  for (const interp of interps) {
    for (const space of spaces) {
      it(`bakeRamp matches the WGSL reference (${interp}/${space})`, () => {
        const ramp = bakeRamp(STOPS, interp, space);
        for (let i = 0; i < RAMP_SIZE; i += 1) {
          const want = referenceGradient(STOPS, interp, space, i / (RAMP_SIZE - 1));
          const o = i * 4;
          for (let c = 0; c < 3; c += 1) expect(ramp[o + c]).toBeCloseTo(want[c]!, 5);
        }
      });
    }
  }
});

describe("palette stop count is GPU-bound", () => {
  it("the WGSL declares exactly MAX_PALETTE_STOPS stop slots", () => {
    const wgsl = buildRenderSampleWGSL(
      "fn formulaDE(c: vec3<f32>) -> vec2<f32> { return vec2<f32>(0.0); }",
    );
    // Raising MAX_PALETTE_STOPS without widening the shader would silently drop stops on the GPU.
    expect(wgsl).toContain(`array<vec4<f32>, ${MAX_PALETTE_STOPS}>`);
    expect(wgsl).toContain(`paletteStop${MAX_PALETTE_STOPS - 1}: vec4<f32>`);
    expect(wgsl).not.toContain(`paletteStop${MAX_PALETTE_STOPS}: vec4<f32>`);
  });
});

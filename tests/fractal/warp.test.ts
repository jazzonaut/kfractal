import { describe, expect, it } from "vitest";
import {
  WARP_RANGES,
  applyWarpCpu,
  clampWarp,
  defaultWarp,
  isWarpOff,
  packWarpAxes,
  warpConstLipschitz,
  warpCpuDe,
  warpLipschitz,
  warpStepBoost,
} from "../../src/fractal/warp";
import type { WarpSettings } from "../../src/fractal/types";

const on = (over: Partial<WarpSettings>): WarpSettings => ({ ...defaultWarp(), ...over });

describe("defaultWarp / isWarpOff", () => {
  it("default warp is off", () => {
    expect(isWarpOff(defaultWarp())).toBe(true);
  });

  it("undefined is off", () => {
    expect(isWarpOff(undefined)).toBe(true);
  });

  it("any non-zero twist/bend or positive ripple/noise amp is on", () => {
    expect(isWarpOff(on({ twist: 0.1 }))).toBe(false);
    expect(isWarpOff(on({ bend: -0.1 }))).toBe(false);
    expect(isWarpOff(on({ rippleAmp: 0.01 }))).toBe(false);
    expect(isWarpOff(on({ noiseAmp: 0.01 }))).toBe(false);
  });

  it("negative ripple/noise amp is still treated as off (amp <= 0)", () => {
    expect(isWarpOff(on({ rippleAmp: -0.01, noiseAmp: -0.01 }))).toBe(true);
  });
});

describe("clampWarp", () => {
  it("clamps every numeric field into its range", () => {
    const c = clampWarp({
      twist: 99,
      twistAxis: "y",
      bend: -99,
      bendAxis: "x",
      rippleAmp: 99,
      rippleFreq: -99,
      rippleAxis: "y",
      noiseAmp: 99,
      noiseFreq: 99,
    });
    expect(c.twist).toBe(WARP_RANGES.twist.max);
    expect(c.bend).toBe(WARP_RANGES.bend.min);
    expect(c.rippleAmp).toBe(WARP_RANGES.rippleAmp.max);
    expect(c.rippleFreq).toBe(WARP_RANGES.rippleFreq.min);
    expect(c.noiseAmp).toBe(WARP_RANGES.noiseAmp.max);
    expect(c.noiseFreq).toBe(WARP_RANGES.noiseFreq.max);
  });

  it("leaves in-range values untouched", () => {
    const w = on({
      twist: 0.5,
      bend: -0.3,
      rippleAmp: 0.1,
      rippleFreq: 4,
      noiseAmp: 0.2,
      noiseFreq: 2,
    });
    expect(clampWarp(w)).toEqual(w);
  });

  it("falls back invalid axes to their defaults, keeps valid ones", () => {
    const c = clampWarp(on({ twistAxis: "q" as never, bendAxis: "z", rippleAxis: "w" as never }));
    expect(c.twistAxis).toBe("y");
    expect(c.bendAxis).toBe("z");
    expect(c.rippleAxis).toBe("y");
  });
});

describe("packWarpAxes", () => {
  it("encodes twist + 3*bend + 9*ripple", () => {
    expect(packWarpAxes(on({ twistAxis: "x", bendAxis: "x", rippleAxis: "x" }))).toBe(0);
    expect(packWarpAxes(on({ twistAxis: "z", bendAxis: "z", rippleAxis: "z" }))).toBe(2 + 6 + 18);
    // Defaults: twist y(1), bend x(0), ripple y(1) -> 1 + 0 + 9.
    expect(packWarpAxes(defaultWarp())).toBe(10);
  });

  it("is uniquely decodable across all 27 combinations", () => {
    const seen = new Set<number>();
    for (const t of ["x", "y", "z"] as const)
      for (const b of ["x", "y", "z"] as const)
        for (const r of ["x", "y", "z"] as const)
          seen.add(packWarpAxes(on({ twistAxis: t, bendAxis: b, rippleAxis: r })));
    expect(seen.size).toBe(27);
    expect(Math.max(...seen)).toBe(26);
    expect(Math.min(...seen)).toBe(0);
  });
});

describe("warpConstLipschitz / warpStepBoost", () => {
  it("is exactly 1 when ripple and noise are off", () => {
    expect(warpConstLipschitz(defaultWarp())).toBe(1);
  });

  it("grows monotonically with ripple and noise amplitude", () => {
    const base = warpConstLipschitz(defaultWarp());
    expect(warpConstLipschitz(on({ rippleAmp: 0.2, rippleFreq: 8 }))).toBeGreaterThan(base);
    expect(warpConstLipschitz(on({ noiseAmp: 0.3, noiseFreq: 3 }))).toBeGreaterThan(base);
  });

  it("step boost stays within [1, 8] and is 1 for an off warp", () => {
    expect(warpStepBoost(defaultWarp())).toBe(1);
    const maxed = on({
      twist: 1.5,
      bend: 1,
      rippleAmp: 0.3,
      rippleFreq: 16,
      noiseAmp: 0.4,
      noiseFreq: 4,
    });
    const boost = warpStepBoost(maxed);
    expect(boost).toBeGreaterThanOrEqual(1);
    expect(boost).toBeLessThanOrEqual(8);
  });
});

describe("applyWarpCpu", () => {
  it("twist about the y axis preserves py and the radius in the xz plane", () => {
    const q = applyWarpCpu(0.7, 0.4, -0.2, on({ twist: 1.2, twistAxis: "y" }));
    expect(q.y).toBeCloseTo(0.4, 12);
    expect(Math.hypot(q.x, q.z)).toBeCloseTo(Math.hypot(0.7, -0.2), 12);
    expect(q.rTwist).toBeCloseTo(Math.hypot(0.7, -0.2), 12);
    expect(q.rBend).toBe(0);
  });

  it("twist with zero coordinate along the axis is the identity (angle 0) but still records rTwist", () => {
    const q = applyWarpCpu(0.5, 0, 0.3, on({ twist: 1.0, twistAxis: "y" }));
    expect(q.x).toBeCloseTo(0.5, 12);
    expect(q.z).toBeCloseTo(0.3, 12);
    expect(q.rTwist).toBeCloseTo(Math.hypot(0.5, 0.3), 12);
  });

  it("bend about the x axis rotates the xy plane (radius preserved, perpendicular z untouched)", () => {
    const q = applyWarpCpu(0.3, 0.6, 0.9, on({ bend: 0.8, bendAxis: "x" }));
    // Bend rotates (x,y) by an angle proportional to x, so px itself is not preserved;
    // the in-plane radius is, and the coordinate perpendicular to the plane (z) is untouched.
    expect(q.z).toBeCloseTo(0.9, 12);
    expect(Math.hypot(q.x, q.y)).toBeCloseTo(Math.hypot(0.3, 0.6), 12);
    expect(q.rBend).toBeCloseTo(Math.hypot(0.3, 0.6), 12);
  });

  it("is deterministic for identical inputs", () => {
    const w = on({
      twist: 0.4,
      bend: 0.3,
      rippleAmp: 0.1,
      rippleFreq: 5,
      noiseAmp: 0.2,
      noiseFreq: 2,
    });
    const a = { ...applyWarpCpu(0.1, 0.2, 0.3, w) };
    const b = { ...applyWarpCpu(0.1, 0.2, 0.3, w) };
    expect(b).toEqual(a);
  });

  it("returns the shared module scratch (documented aliasing contract)", () => {
    const w = on({ twist: 0.4 });
    const a = applyWarpCpu(0.1, 0.2, 0.3, w);
    const b = applyWarpCpu(0.9, 0.8, 0.7, w);
    // Same object identity: callers must copy fields out before the next call.
    expect(a).toBe(b);
  });
});

describe("warpLipschitz", () => {
  it("is at least the constant part and grows with twist radius and dF", () => {
    const w = on({ twist: 1.0 });
    const k = warpConstLipschitz(w);
    expect(warpLipschitz(w, 0, 0, 0)).toBeCloseTo(k, 12); // 1 + |twist|*(0+0) == 1
    expect(warpLipschitz(w, 2, 0, 0)).toBeGreaterThan(warpLipschitz(w, 0, 0, 0));
    expect(warpLipschitz(w, 0, 0, 3)).toBeGreaterThan(warpLipschitz(w, 0, 0, 0));
  });

  it("uses the conservative linear form 1 + |k|(r + dF), not the tighter sqrt", () => {
    const w = on({ twist: 1.0 });
    const k = warpConstLipschitz(w);
    const r = 2;
    const dF = 0;
    const linear = k * (1 + 1.0 * (r + dF));
    const sqrtForm = k * Math.sqrt(1 + (1.0 * (r + dF)) ** 2);
    expect(warpLipschitz(w, r, 0, dF)).toBeCloseTo(linear, 12);
    // The linear bound must be the larger (more conservative) of the two.
    expect(warpLipschitz(w, r, 0, dF)).toBeGreaterThan(sqrtForm);
  });

  it("ignores twist/bend terms when those axes are off", () => {
    const w = on({ rippleAmp: 0.1, rippleFreq: 4 });
    // twist and bend are 0, so radii must not matter.
    expect(warpLipschitz(w, 5, 5, 5)).toBeCloseTo(warpConstLipschitz(w), 12);
  });
});

describe("warpCpuDe", () => {
  it("divides the raw distance by the local Lipschitz bound", () => {
    const w = on({ twist: 1.0, twistAxis: "y" });
    const value = warpCpuDe(() => 1, w, 0.7, 0.4, -0.2); // constant raw field
    const rTwist = Math.hypot(0.7, -0.2);
    const expected = 1 / warpLipschitz(w, rTwist, 0, 1);
    expect(value).toBeCloseTo(expected, 12);
  });

  it("evaluates the raw DE at the warped point", () => {
    const w = on({ twist: 1.2, twistAxis: "y" });
    const seen: number[] = [];
    warpCpuDe(
      (x, y, z) => {
        seen.push(x, y, z);
        return 0.5;
      },
      w,
      0.7,
      0.4,
      -0.2,
    );
    const q = applyWarpCpu(0.7, 0.4, -0.2, w);
    expect(seen).toEqual([q.x, q.y, q.z]);
  });

  it("stays correct even if rawDe clobbers the warp scratch (copy-out guard)", () => {
    const w = on({ twist: 1.0, twistAxis: "y" });
    const plain = warpCpuDe(() => 1, w, 0.7, 0.4, -0.2);
    // A rawDe that re-runs applyWarpCpu internally (overwriting the module scratch)
    // must not change the outer result: rTwist/rBend are copied out beforehand.
    const reentrant = warpCpuDe(
      () => {
        applyWarpCpu(9, 9, 9, on({ bend: 1, bendAxis: "x" }));
        return 1;
      },
      w,
      0.7,
      0.4,
      -0.2,
    );
    expect(reentrant).toBeCloseTo(plain, 12);
  });
});

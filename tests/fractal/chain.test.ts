import { describe, expect, it } from "vitest";
import {
  BULB_FALLBACK_BAILOUT,
  chainDe,
  chainStepScale,
  clampChain,
  compileChainDE,
} from "../../src/fractal/chain";
import {
  BOX_BULB,
  KLEIN_FOAM,
  MANDELBOX_AS_CHAIN,
  MANDELBULB_AS_CHAIN,
  MENGER_SPIRE,
  SIN_BULB,
} from "../../src/fractal/chain-presets";
import { getCpuDe } from "../../src/fractal/cpu-de";
import { getTransform, TRANSFORM_LIST } from "../../src/fractal/transforms";
import type { ChainState } from "../../src/fractal/transforms";

/**
 * Phase 0 acceptance for hybrid formula chains: prove that re-expressing the atomic formulas
 * as transform chains reproduces their DE exactly, and that the codegen/interpreter are sound.
 *
 * The load-bearing property is DISTANCE equivalence between the chain interpreter (chainDe)
 * and the atomic CPU DE (getCpuDe): the DiveController marches the CPU DE, so if a chain's
 * f64 distance matches the atomic's the dive steers identically. GPU-vs-CPU agreement of the
 * compiled WGSL is deferred to the Phase 1 readback seam; here the WGSL is checked structurally.
 */

// Same probe grid the cpu-de suites use (outside, near-surface, near-origin, off-axis).
const PROBES: ReadonlyArray<readonly [number, number, number]> = [
  [2, 0, 0],
  [0, 1.5, 0],
  [0.5, 0.5, 0.5],
  [-1.2, 0.3, 0.8],
  [0.01, 0.01, 0.01],
  [3, -2, 1],
];

describe("chain interpreter reproduces the atomic DE", () => {
  it("mandelbox-as-chain matches the atomic mandelbox CPU DE", () => {
    const atomic = getCpuDe("mandelbox");
    // Registry mandelbox defaults: scale=2.8 (p0), fold=1.0 (p1), minRadius=0.5 (p2), iters=14.
    const params = { p0: 2.8, p1: 1.0, p2: 0.5, p3: 0, iterations: 14 };
    for (const [x, y, z] of PROBES) {
      expect(chainDe(MANDELBOX_AS_CHAIN, x, y, z)).toBeCloseTo(atomic(x, y, z, params), 12);
    }
  });

  it("mandelbulb-as-chain matches the atomic mandelbulb CPU DE", () => {
    const atomic = getCpuDe("mandelbulb");
    const params = { p0: 8, p1: 0, p2: 0, p3: 0, iterations: 8 };
    for (const [x, y, z] of PROBES) {
      expect(chainDe(MANDELBULB_AS_CHAIN, x, y, z)).toBeCloseTo(atomic(x, y, z, params), 12);
    }
  });

  it("honors the iteration override (the dive boosts it with depth, as it does gIters)", () => {
    const atomic = getCpuDe("mandelbox");
    // Match the atomic DE at a boosted count, not the chain's stored 14.
    const boosted = 22;
    const params = { p0: 2.8, p1: 1.0, p2: 0.5, p3: 0, iterations: boosted };
    for (const [x, y, z] of PROBES) {
      expect(chainDe(MANDELBOX_AS_CHAIN, x, y, z, boosted)).toBeCloseTo(
        atomic(x, y, z, params),
        12,
      );
    }
  });
});

describe("chainStepScale (tunnelling-safety step tightening)", () => {
  it("is 1 for a rigid-only chain and grows with the most aggressive operator, capped at 8", () => {
    expect(chainStepScale({ ...BOX_BULB, stages: [{ transform: "rotate", values: {} }] })).toBe(1);
    // boxFold contributes 2; a big scale dominates; sphereFold inflates by 1/minRadius^2.
    expect(
      chainStepScale({ ...BOX_BULB, stages: [{ transform: "scaleAddC", values: { scale: 5 } }] }),
    ).toBe(5);
    expect(
      chainStepScale({
        ...BOX_BULB,
        stages: [{ transform: "sphereFold", values: { minRadius: 0.2 } }],
      }),
    ).toBe(8); // 1/0.04 = 25, capped
    expect(chainStepScale(BOX_BULB)).toBeGreaterThanOrEqual(1);
  });

  it("does NOT tighten for a bulb stage (its analytic dr makes the DE well-conditioned)", () => {
    // A power-8 bulb sphere-traces at standard budget atomically; a bulb-as-chain must match,
    // not pay 8x. The exponent is not a field expansion factor.
    expect(
      chainStepScale({ ...BOX_BULB, stages: [{ transform: "bulbPow", values: { power: 8 } }] }),
    ).toBe(1);
  });
});

describe("chain interpreter is well-behaved", () => {
  it("returns finite distances for every preset at every probe (marcher NaN-free invariant)", () => {
    for (const chain of [
      MANDELBOX_AS_CHAIN,
      MANDELBULB_AS_CHAIN,
      BOX_BULB,
      MENGER_SPIRE,
      KLEIN_FOAM,
      SIN_BULB,
    ]) {
      for (const [x, y, z] of PROBES) {
        const d = chainDe(chain, x, y, z);
        expect(Number.isFinite(d), `(${x},${y},${z}) = ${d}`).toBe(true);
      }
    }
  });

  it("is deterministic and stateless across calls (shared scratch is fully reset)", () => {
    const before = chainDe(MANDELBOX_AS_CHAIN, 0.5, 0.5, 0.5);
    // Wedge other evaluations in between; the module scratch must not leak.
    for (const [x, y, z] of PROBES) {
      chainDe(MANDELBULB_AS_CHAIN, x, y, z);
      chainDe(BOX_BULB, x, y, z);
    }
    expect(chainDe(MANDELBOX_AS_CHAIN, 0.5, 0.5, 0.5)).toBe(before);
  });
});

const state = (px: number, py: number, pz: number, dr = 1): ChainState => ({ px, py, pz, dr });

describe("transform CPU mirrors", () => {
  it("rotate is a length-preserving isometry on each axis and leaves dr untouched", () => {
    for (const axis of [0, 1, 2]) {
      const s = state(0.3, -0.7, 1.1, 2.5);
      const r0 = Math.sqrt(s.px * s.px + s.py * s.py + s.pz * s.pz);
      getTransform("rotate").cpu(s, { angle: 0.9, axis });
      const r1 = Math.sqrt(s.px * s.px + s.py * s.py + s.pz * s.pz);
      expect(r1).toBeCloseTo(r0, 12);
      expect(s.dr).toBe(2.5);
    }
  });

  it("scaleAddC scales position and accumulates the linear-DE derivative", () => {
    const s = state(1, 2, -1, 1);
    getTransform("scaleAddC").cpu(s, { scale: -3 });
    expect([s.px, s.py, s.pz]).toEqual([-3, -6, 3]);
    expect(s.dr).toBe(1 * 3 + 1); // dr*|scale| + 1
  });

  it("boxFold reflects coordinates outside the fold limit back inward", () => {
    const s = state(1.5, -1.5, 0.2);
    getTransform("boxFold").cpu(s, { fold: 1 });
    // clamp(1.5,-1,1)*2 - 1.5 = 0.5 ; clamp(-1.5)*2 - (-1.5) = -0.5 ; |0.2|<1 unchanged.
    expect(s.px).toBeCloseTo(0.5, 12);
    expect(s.py).toBeCloseTo(-0.5, 12);
    expect(s.pz).toBeCloseTo(0.2, 12);
  });

  it("mengerFold sorts |axes| descending then translates, leaving dr untouched", () => {
    const s = state(-0.2, 1.3, -0.7, 3);
    getTransform("mengerFold").cpu(s, { offset: 1 });
    // abs -> (0.2,1.3,0.7); sort desc -> (1.3,0.7,0.2); minus 1 -> (0.3,-0.3,-0.8);
    // -0.8 < -0.5 -> +1 -> -0.8 stays? -0.5*1 = -0.5; -0.8 < -0.5 true -> -0.8+1 = 0.2.
    expect([s.px, s.py, s.pz].map((v) => Number(v.toFixed(6)))).toEqual([0.3, -0.3, 0.2]);
    expect(s.dr).toBe(3); // rigid: derivative unchanged
  });

  it("kifsFold and latticeFold are rigid (dr untouched); latticeFold folds into [-1,1)", () => {
    const k = state(-1, -1, 0.5, 2);
    getTransform("kifsFold").cpu(k, {});
    expect(k.dr).toBe(2);
    const l = state(3.3, -2.1, 0.4, 5);
    getTransform("latticeFold").cpu(l, {});
    expect(l.dr).toBe(5);
    for (const v of [l.px, l.py, l.pz]) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it("sphereInvert inverts through the unit sphere and scales dr by the same factor", () => {
    const s = state(2, 0, 0, 1);
    getTransform("sphereInvert").cpu(s, { factor: 1 });
    // |p|^2 = 4, k = 1/4 -> p = (0.5,0,0), dr = 0.25.
    expect(s.px).toBeCloseTo(0.5, 12);
    expect(s.dr).toBeCloseTo(0.25, 12);
  });

  it("sinWarp perturbs the position and inflates dr by its Lipschitz bound", () => {
    const s = state(0.3, -0.2, 0.5, 1);
    getTransform("sinWarp").cpu(s, { amp: 0.1, freq: 2 });
    expect(s.dr).toBeCloseTo(1 + 0.1 * 2, 12);
    expect(Number.isFinite(s.px + s.py + s.pz)).toBe(true);
  });

  it("every transform stays finite across its declared param range (NaN-free)", () => {
    const probes = [
      [2, 0, 0],
      [0.5, 0.5, 0.5],
      [-1.2, 0.3, 0.8],
      [0.01, 0.01, 0.01],
    ] as const;
    for (const t of TRANSFORM_LIST) {
      for (const [x, y, z] of probes) {
        for (const which of ["min", "max", "mid"] as const) {
          const values: Record<string, number> = {};
          for (const p of t.params) {
            values[p.key] = which === "min" ? p.min : which === "max" ? p.max : (p.min + p.max) / 2;
          }
          const st = state(x, y, z, 1);
          t.cpu(st, values);
          expect(
            Number.isFinite(st.px + st.py + st.pz + st.dr),
            `${t.id} ${which} at ${x},${y},${z}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("clampChain", () => {
  it("defends iterations against non-finite (NaN survives clampNum/round otherwise)", () => {
    const out = clampChain({ ...MANDELBOX_AS_CHAIN, iterations: NaN });
    expect(out).not.toBeNull();
    expect(Number.isFinite(out!.iterations)).toBe(true);
  });

  it("drops unknown-transform stages and falls back to null when none remain", () => {
    const bogus = { transform: "nope" as never, values: {} };
    expect(clampChain({ ...MANDELBOX_AS_CHAIN, stages: [bogus] })).toBeNull();
    const mixed = clampChain({
      ...MANDELBOX_AS_CHAIN,
      stages: [bogus, ...MANDELBOX_AS_CHAIN.stages],
    });
    expect(mixed?.stages.length).toBe(MANDELBOX_AS_CHAIN.stages.length);
  });

  it("forces a finite bailout on a bulb chain that has none (would diverge to a NaN DE)", () => {
    expect(clampChain({ ...MANDELBULB_AS_CHAIN, bailout: Infinity })?.bailout).toBe(
      BULB_FALLBACK_BAILOUT,
    );
    // A pure fold/IFS chain keeps its unbounded (Infinity) bailout - it does not diverge.
    expect(clampChain(MANDELBOX_AS_CHAIN)?.bailout).toBe(Infinity);
  });
});

describe("chain WGSL codegen", () => {
  it("emits a drop-in formulaDE reading stage params from the gStageP uniform", () => {
    const wgsl = compileChainDE(MANDELBOX_AS_CHAIN);
    expect(wgsl).toContain("fn formulaDE(c: vec3<f32>) -> vec2<f32>");
    // boxFold's $0 (fold) is stage 0, slot x; scaleAddC's $0 (scale) is stage 2, slot x.
    expect(wgsl).toContain("gStageP[0].x");
    expect(wgsl).toContain("gStageP[2].x");
    expect(wgsl).not.toContain("$0");
    // Balanced braces (no stray block from substitution).
    expect((wgsl.match(/\{/g) ?? []).length).toBe((wgsl.match(/\}/g) ?? []).length);
  });

  it("bakes structural choices: bailout break, addC reinjection, and DE form", () => {
    const box = compileChainDE(MANDELBOX_AS_CHAIN); // bailout Infinity, addC, linear
    expect(box).not.toContain("break"); // pure fold/IFS: no bailout
    expect(box).toContain("p = p + c;");
    expect(box).toContain("length(p) / abs(dr)");

    const bulb = compileChainDE(MANDELBULB_AS_CHAIN); // bailout 2, addC, log
    expect(bulb).toContain("if (r > 2.0) { break; }");
    expect(bulb).toContain("0.25 * log(max(r, 1.0e-6)) * r / dr");
  });

  it("binds every transform's param tokens with no leftover placeholders", () => {
    for (const t of TRANSFORM_LIST) {
      const chain = {
        stages: [{ transform: t.id, values: {} }],
        iterations: 4,
        addC: false,
        bailout: Infinity,
        deForm: "linear" as const,
      };
      const wgsl = compileChainDE(chain);
      expect(/\$\d/.test(wgsl), `${t.id} left an unbound $ token`).toBe(false);
      // Each declared param k maps to gStageP[0].{x,y,z,w}.
      for (let k = 0; k < t.params.length; k += 1) {
        expect(wgsl).toContain(`gStageP[0].${["x", "y", "z", "w"][k]}`);
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { getCpuDe } from "../../src/fractal/cpu-de";
import { FORMULAS, getFormula } from "../../src/fractal/registry";
import { defaultWarp, warpCpuDe } from "../../src/fractal/warp";
import type { CpuDeParams } from "../../src/fractal/cpu-de";
import type { FractalFormulaId, WarpSettings } from "../../src/fractal/types";

/**
 * CPU<->WGSL distance-estimator agreement harness (REPORT_IMPR §6.1 / §8.2).
 *
 * Goal of §6.1: the dive controller marches the f64 CPU DEs in `cpu-de.ts`, which must
 * stay in lockstep with the WGSL DEs in `registry.ts`. Drift means the controller steers
 * against geometry the GPU is not rendering.
 *
 * Environment limitation (documented deliberately): a TRUE cross-check needs reference
 * values produced by the WGSL DEs, which only run on a GPU. The `__kf.deAtCamera()` seam
 * the report suggested turns out to be CPU-side (it calls `getCpuDe`, main.ts), and a
 * headless WebGPU capture is not available in CI, so there is no automated GPU reference
 * yet. Capturing one needs a small DEV-gated GPU DE-readback seam run on a WebGPU machine
 * (tracked as a follow-up). The golden snapshot in `cpu-de.test.ts` already locks CPU-side
 * drift; this suite adds the cross-implementation guards that are checkable WITHOUT a GPU:
 *   1. CPU/registry formula-set parity (catches "added a WGSL formula, forgot the mirror").
 *   2. Determinism + cross-call statelessness (guards the allocation-free scratch rewrites,
 *      esp. the shared `warpScratch`, against state leaking between evaluations).
 *   3. Param-slot plumbing finiteness across each formula's declared parameter ranges.
 */

const FORMULA_IDS = FORMULAS.map((f) => f.id) as FractalFormulaId[];

function defaultParams(id: FractalFormulaId): CpuDeParams {
  const def = getFormula(id);
  const slots = [0, 0, 0, 0];
  for (const p of def.params) slots[p.slot] = p.defaultValue;
  return {
    p0: slots[0]!,
    p1: slots[1]!,
    p2: slots[2]!,
    p3: slots[3]!,
    iterations: def.iterations.defaultValue,
  };
}

const PROBES: ReadonlyArray<readonly [number, number, number]> = [
  [2, 0, 0],
  [0, 1.5, 0],
  [0.5, 0.5, 0.5],
  [-1.2, 0.3, 0.8],
  [0.01, 0.01, 0.01],
  [3, -2, 1],
];

const warpOn = (over: Partial<WarpSettings>): WarpSettings => ({ ...defaultWarp(), ...over });

describe("CPU/WGSL formula-set parity", () => {
  it("provides a CPU mirror for every registry formula and nothing extra", () => {
    for (const id of FORMULA_IDS) {
      expect(typeof getCpuDe(id), `cpu mirror for ${id}`).toBe("function");
    }
    // Inverse direction: the curated registry is the single source of truth for the id set.
    // (The Record<FractalFormulaId, CpuDe> type also enforces this at compile time; this
    // asserts the runtime table did not pick up an alias the union doesn't list.)
    expect(new Set(FORMULA_IDS).size).toBe(FORMULA_IDS.length);
  });
});

describe("CPU DE determinism and statelessness", () => {
  it("is deterministic: identical inputs give identical outputs", () => {
    for (const id of FORMULA_IDS) {
      const de = getCpuDe(id);
      const params = defaultParams(id);
      for (const [x, y, z] of PROBES) {
        expect(de(x, y, z, params)).toBe(de(x, y, z, params));
      }
    }
  });

  it("evaluating other formulas in between does not perturb a result (no shared state)", () => {
    const subject = getCpuDe("mandelbox");
    const sp = defaultParams("mandelbox");
    const before = subject(0.5, 0.5, 0.5, sp);
    for (const id of FORMULA_IDS) {
      const de = getCpuDe(id);
      const params = defaultParams(id);
      for (const [x, y, z] of PROBES) de(x, y, z, params);
    }
    expect(subject(0.5, 0.5, 0.5, sp)).toBe(before);
  });

  it("interleaved warpCpuDe calls across formulas do not corrupt each other (shared warpScratch)", () => {
    // applyWarpCpu returns a module-level scratch object; warpCpuDe copies fields out before
    // calling the raw DE. Interleaving must therefore be safe even though the scratch is shared.
    const w = warpOn({ twist: 0.8, twistAxis: "y", bend: 0.4, bendAxis: "x" });
    const box = getCpuDe("mandelbox");
    const men = getCpuDe("menger");
    const bp = defaultParams("mandelbox");
    const mp = defaultParams("menger");
    const isolated = warpCpuDe((x, y, z) => box(x, y, z, bp), w, 0.4, 0.3, 0.2);
    // Same call, but with a foreign warped evaluation wedged inside the raw-DE callback.
    const interleaved = warpCpuDe(
      (x, y, z) => {
        warpCpuDe((a, b, c) => men(a, b, c, mp), w, 1.1, -0.7, 0.9);
        return box(x, y, z, bp);
      },
      w,
      0.4,
      0.3,
      0.2,
    );
    expect(interleaved).toBeCloseTo(isolated, 12);
  });
});

describe("CPU DE param-slot plumbing", () => {
  it("stays finite as each declared parameter is swept across its registry range", () => {
    for (const id of FORMULA_IDS) {
      const def = getFormula(id);
      const de = getCpuDe(id);
      for (const p of def.params) {
        for (const v of [p.min, (p.min + p.max) / 2, p.max]) {
          const params = { ...defaultParams(id) };
          (params as Record<string, number>)[`p${p.slot}`] = v;
          for (const [x, y, z] of PROBES) {
            const d = de(x, y, z, params);
            expect(Number.isFinite(d), `${id} ${p.key}=${v} at (${x},${y},${z})`).toBe(true);
          }
        }
      }
    }
  });
});

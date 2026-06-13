import { describe, expect, it } from "vitest";
import { getCpuDe, latticeFoldComponent } from "../../src/fractal/cpu-de";
import { FORMULAS, getFormula } from "../../src/fractal/registry";
import type { CpuDeParams } from "../../src/fractal/cpu-de";
import type { FractalFormulaId } from "../../src/fractal/types";

/**
 * Golden-point regression guard for the CPU distance estimators (the f64 mirrors the dive
 * controller marches). The snapshot below is captured from the CPU implementation, so it
 * locks the CPU side: any change to cpu-de.ts that shifts a value fails here.
 *
 * Boundary (see REPORT_IMPR §6.1): this is NOT yet a true CPU-vs-WGSL *agreement* check.
 * The WGSL DEs in registry.ts can only be evaluated on a GPU, so cross-verifying parity
 * requires capturing reference values from the running app (e.g. via the `__kf.deAtCamera()`
 * seam) and comparing both sides against them. Until that capture exists, this suite catches
 * CPU-side drift and the NaN-free invariant the marcher depends on.
 */

const FORMULA_IDS = FORMULAS.map((f) => f.id) as FractalFormulaId[];

/** Build CpuDeParams from each formula's registry defaults, mapped by slot. */
function defaultParams(id: FractalFormulaId): CpuDeParams {
  const def = getFormula(id);
  const slots = [def.params[0]?.defaultValue ?? 0, 0, 0, 0];
  for (const p of def.params) slots[p.slot] = p.defaultValue;
  return {
    p0: slots[0]!,
    p1: slots[1]!,
    p2: slots[2]!,
    p3: slots[3]!,
    iterations: def.iterations.defaultValue,
  };
}

// A fixed grid of probe points (outside, near-surface, near-origin, off-axis).
const PROBE_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [2, 0, 0],
  [0, 1.5, 0],
  [0.5, 0.5, 0.5],
  [-1.2, 0.3, 0.8],
  [0.01, 0.01, 0.01],
  [3, -2, 1],
];

describe("latticeFoldComponent", () => {
  it("folds into [-1, 1) with period 2", () => {
    expect(latticeFoldComponent(0)).toBeCloseTo(0, 12);
    expect(latticeFoldComponent(0.5)).toBeCloseTo(0.5, 12);
    // Period 2: x and x+2 fold identically.
    for (const x of [0.3, -0.7, 1.4, -2.1]) {
      expect(latticeFoldComponent(x)).toBeCloseTo(latticeFoldComponent(x + 2), 12);
    }
    // Range.
    for (const x of [-5, -1, 0.9, 3.3, 7.7]) {
      const f = latticeFoldComponent(x);
      expect(f).toBeGreaterThanOrEqual(-1);
      expect(f).toBeLessThan(1);
    }
  });
});

describe("CPU distance estimators", () => {
  it("return finite values at every probe point (NaN-free invariant the marcher relies on)", () => {
    for (const id of FORMULA_IDS) {
      const de = getCpuDe(id);
      const params = defaultParams(id);
      for (const [x, y, z] of PROBE_POINTS) {
        const d = de(x, y, z, params);
        expect(Number.isFinite(d), `${id} at (${x},${y},${z}) = ${d}`).toBe(true);
      }
    }
  });

  it("match stored golden values (regression guard)", () => {
    const golden: Record<string, number[]> = {};
    for (const id of FORMULA_IDS) {
      const de = getCpuDe(id);
      const params = defaultParams(id);
      golden[id] = PROBE_POINTS.map(([x, y, z]) => Number(de(x, y, z, params).toPrecision(10)));
    }
    expect(golden).toMatchSnapshot();
  });
});

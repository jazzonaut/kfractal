import { describe, expect, it } from "vitest";
import {
  GENERATOR_BASELINES,
  mutateFormulaSettings,
  rollShape,
} from "../../src/fractal/shape-generator";
import { FORMULAS, getFormula } from "../../src/fractal/registry";
import type { FractalFormulaId } from "../../src/fractal/types";

/** Deterministic [0,1) RNG (mulberry32) so generator output is reproducible in tests. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FORMULA_IDS = FORMULAS.map((f) => f.id) as FractalFormulaId[];
const noLocks = { params: new Set<string>(), iterations: false };

describe("rollShape", () => {
  it("is deterministic for a given rng seed", () => {
    const a = rollShape({
      formula: "mandelbox",
      current: GENERATOR_BASELINES.mandelbox,
      locks: noLocks,
      rng: seeded(42),
    });
    const b = rollShape({
      formula: "mandelbox",
      current: GENERATOR_BASELINES.mandelbox,
      locks: noLocks,
      rng: seeded(42),
    });
    expect(a.formulaSettings).toEqual(b.formulaSettings);
  });

  it("keeps every rolled value within its registry range and on the step grid", () => {
    for (const id of FORMULA_IDS) {
      const def = getFormula(id);
      const shape = rollShape({
        formula: id,
        current: GENERATOR_BASELINES[id],
        locks: noLocks,
        rng: seeded(7),
      });
      for (const param of def.params) {
        const value = shape.formulaSettings.values[param.key]!;
        expect(value).toBeGreaterThanOrEqual(param.min);
        expect(value).toBeLessThanOrEqual(param.max);
        // On the step grid anchored at min (within float tolerance).
        const steps = (value - param.min) / param.step;
        expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
      }
      expect(shape.formulaSettings.iterations).toBeGreaterThanOrEqual(def.iterations.min);
      expect(shape.formulaSettings.iterations).toBeLessThanOrEqual(def.iterations.max);
    }
  });

  it("retains locked params when the formula is unchanged", () => {
    const def = getFormula("mandelbox");
    const key = def.params[0]!.key;
    const current = GENERATOR_BASELINES.mandelbox;
    const lockedValue = current.formulaSettings.values[key]!;
    const shape = rollShape({
      formula: "mandelbox",
      current,
      locks: { params: new Set([key]), iterations: true },
      rng: seeded(99),
    });
    expect(shape.formulaSettings.values[key]).toBe(lockedValue);
    expect(shape.formulaSettings.iterations).toBe(current.formulaSettings.iterations);
  });

  it("drops locks when the formula changes (key collision across schemas)", () => {
    // mandelbox and apollonian both have a "scale"-ish slot-0 param with different ranges;
    // a lock set against mandelbox must not pin the apollonian roll.
    const current = GENERATOR_BASELINES.mandelbox;
    const def = getFormula("apollonian");
    const shape = rollShape({
      formula: "apollonian",
      current,
      locks: { params: new Set(def.params.map((p) => p.key)), iterations: true },
      rng: seeded(3),
    });
    for (const param of def.params) {
      const value = shape.formulaSettings.values[param.key]!;
      expect(value).toBeGreaterThanOrEqual(param.min);
      expect(value).toBeLessThanOrEqual(param.max);
    }
  });
});

describe("mutateFormulaSettings", () => {
  it("returns the input unchanged at strength 0", () => {
    const current = GENERATOR_BASELINES.mandelbulb.formulaSettings;
    const out = mutateFormulaSettings("mandelbulb", current, 0, noLocks, seeded(1));
    expect(out.values).toEqual(current.values);
    expect(out.iterations).toBe(current.iterations);
  });

  it("keeps locked params fixed and mutated values in range", () => {
    const def = getFormula("menger");
    const current = GENERATOR_BASELINES.menger.formulaSettings;
    const lockKey = def.params[0]!.key;
    const out = mutateFormulaSettings(
      "menger",
      current,
      1,
      { params: new Set([lockKey]), iterations: false },
      seeded(11),
    );
    expect(out.values[lockKey]).toBe(current.values[lockKey]);
    for (const param of def.params) {
      const value = out.values[param.key]!;
      expect(value).toBeGreaterThanOrEqual(param.min);
      expect(value).toBeLessThanOrEqual(param.max);
    }
  });
});

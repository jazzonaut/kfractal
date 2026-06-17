import { describe, expect, it } from "vitest";
import {
  GENERATOR_BASELINES,
  mutateFormulaSettings,
  rollChain,
  rollChainShape,
  rollShape,
  seedChainTrap,
} from "../../src/fractal/shape-generator";
import { chainDe } from "../../src/fractal/chain";
import { FORMULAS, getFormula } from "../../src/fractal/registry";
import { getTransform } from "../../src/fractal/transforms";
import { CHAIN_MAX_ITERATIONS, CHAIN_MAX_STAGES } from "../../src/fractal/chain";
import { BLOOM_BULB } from "../../src/fractal/shapes";
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

describe("rollChain / rollChainShape (Phase 2 generator)", () => {
  it("is deterministic for a given rng seed", () => {
    expect(rollChain(seeded(42))).toEqual(rollChain(seeded(42)));
  });

  it("rolls a registry-valid chain within the stage and iteration caps", () => {
    for (const seed of [1, 7, 42, 99, 1000]) {
      const chain = rollChain(seeded(seed));
      expect(chain.stages.length).toBeGreaterThanOrEqual(2);
      expect(chain.stages.length).toBeLessThanOrEqual(CHAIN_MAX_STAGES);
      expect(chain.iterations).toBeLessThanOrEqual(CHAIN_MAX_ITERATIONS);
      // Never a pure rigid motion: at least one structure-forming operator.
      expect(chain.stages.some((s) => s.transform !== "rotate")).toBe(true);
      for (const stage of chain.stages) {
        for (const p of getTransform(stage.transform).params) {
          const v = stage.values[p.key]!;
          expect(v).toBeGreaterThanOrEqual(p.min);
          expect(v).toBeLessThanOrEqual(p.max);
        }
      }
    }
  });

  it("produces a finite distance everywhere across a wide seed fuzz (marcher NaN-free invariant)", () => {
    // Fuzz hundreds of seeds, not a handful: stacking expansive stages (esp. multiple bulbPow)
    // in one chain can compound to Inf/NaN within a single iteration, before the next iteration's
    // bailout check fires. A 5-seed test gave false green; this is the real coverage. Probes
    // include exterior points (large radius), where escape-time divergence shows up.
    const probes = [
      [2, 0, 0],
      [0.5, 0.5, 0.5],
      [-1.2, 0.3, 0.8],
      [0.01, 0.01, 0.01],
      [3, -2, 1],
      [1.5, 1.5, 1.5],
    ] as const;
    for (let seed = 0; seed < 500; seed += 1) {
      const chain = rollChain(seeded(seed));
      for (const [x, y, z] of probes) {
        const d = chainDe(chain, x, y, z);
        expect(
          Number.isFinite(d),
          `seed ${seed} ${chain.stages.map((s) => s.transform).join(">")} @ ${x},${y},${z} = ${d}`,
        ).toBe(true);
      }
    }
  });

  it("seeds a bulb-family trap when the chain has a bulb lobe", () => {
    const bulbChain = {
      stages: [{ transform: "bulbPow" as const, values: { power: 8 } }],
      iterations: 24,
      addC: true,
      bailout: 2,
      deForm: "log" as const,
    };
    expect(seedChainTrap(bulbChain)).toEqual({
      scale: BLOOM_BULB.trap.scale,
      power: BLOOM_BULB.trap.power,
    });
  });

  it("rollChainShape attaches a chain + seeded trap on an outside-looking baseline", () => {
    const shape = rollChainShape(seeded(5));
    expect(shape.chain).toBeDefined();
    expect(shape.trap.scale).toBeGreaterThan(0);
    expect(shape.name).toBe("Generated Hybrid");
    // The fallback formula is left intact for builds without chain support.
    expect(shape.formula).toBe(GENERATOR_BASELINES.mandelbox.formula);
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

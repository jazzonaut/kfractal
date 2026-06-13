import { describe, expect, it } from "vitest";
import { FORMULAS, getFormula } from "../../src/fractal/registry";
import {
  DEFAULT_ENVIRONMENT_ID,
  DEFAULT_SKY,
  ENVIRONMENTS,
  getEnvironment,
} from "../../src/fractal/environments";

describe("registry: FORMULAS structural invariants", () => {
  it("every formula id is unique", () => {
    const ids = FORMULAS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every param has a sane range with the default inside it", () => {
    for (const formula of FORMULAS) {
      for (const p of formula.params) {
        expect(p.min, `${formula.id}.${p.key} min<max`).toBeLessThan(p.max);
        expect(p.step, `${formula.id}.${p.key} step>0`).toBeGreaterThan(0);
        expect(p.defaultValue, `${formula.id}.${p.key} default>=min`).toBeGreaterThanOrEqual(p.min);
        expect(p.defaultValue, `${formula.id}.${p.key} default<=max`).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("param slots are within 0..3 and not duplicated within a formula", () => {
    for (const formula of FORMULAS) {
      const slots = formula.params.map((p) => p.slot);
      for (const s of slots) expect(s).toBeGreaterThanOrEqual(0);
      for (const s of slots) expect(s).toBeLessThanOrEqual(3);
      expect(new Set(slots).size, `${formula.id} slots unique`).toBe(slots.length);
      expect(formula.params.length).toBeLessThanOrEqual(4);
    }
  });

  it("iterations range is sane with default inside", () => {
    for (const formula of FORMULAS) {
      const iter = formula.iterations;
      expect(iter.min).toBeLessThanOrEqual(iter.max);
      expect(iter.defaultValue).toBeGreaterThanOrEqual(iter.min);
      expect(iter.defaultValue).toBeLessThanOrEqual(iter.max);
    }
  });

  it("every formula carries a non-empty WGSL DE body", () => {
    for (const formula of FORMULAS) {
      expect(formula.de.length, `${formula.id} has DE`).toBeGreaterThan(0);
    }
  });
});

describe("registry: getFormula", () => {
  it("returns the matching definition", () => {
    expect(getFormula("mandelbox").id).toBe("mandelbox");
    expect(getFormula("kleinian").id).toBe("kleinian");
  });

  it("throws on an unknown id", () => {
    expect(() => getFormula("not-a-formula" as never)).toThrow(/Unknown fractal formula/);
  });
});

describe("environments: getEnvironment", () => {
  it("returns the matching environment", () => {
    const env = ENVIRONMENTS[0]!;
    expect(getEnvironment(env.id).id).toBe(env.id);
  });

  it("falls back to the default for an unknown id (never throws)", () => {
    expect(getEnvironment("does-not-exist").id).toBe(DEFAULT_ENVIRONMENT_ID);
  });

  it("the default environment id actually exists in the set", () => {
    expect(ENVIRONMENTS.some((e) => e.id === DEFAULT_ENVIRONMENT_ID)).toBe(true);
  });

  it("environment ids are unique", () => {
    const ids = ENVIRONMENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("environments: DEFAULT_SKY", () => {
  it("references a real environment id and uses studio mode", () => {
    expect(DEFAULT_SKY.mode).toBe("studio");
    expect(ENVIRONMENTS.some((e) => e.id === DEFAULT_SKY.envId)).toBe(true);
  });
});

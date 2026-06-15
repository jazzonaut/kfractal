import { describe, expect, it } from "vitest";
import {
  buildLibraryFile,
  clampLookToEnvironments,
  clampShapeToRegistry,
  lookSchema,
  parseLibraryFile,
} from "../../src/fractal/library-codec";
import { getFormula } from "../../src/fractal/registry";
import { defaultEffects } from "../../src/fractal/effects-defaults";
import { SHAPES } from "../../src/fractal/shapes";
import { LOOKS } from "../../src/fractal/looks";
import { PRESETS } from "../../src/fractal/presets";
import { glassParams } from "../../src/fractal/types";

/**
 * The curated library is the app's source of truth and ships unvalidated at runtime (it is
 * trusted, not range-checked on load). These tests guard it at build time: every curated
 * item must parse against its zod schema, survive a codec round-trip, and already sit inside
 * the registry/clamp ranges - so a future authoring edit that drifts a value out of range
 * (which would be silently clamped or altered on the user's machine) fails here instead.
 */

describe("curated shapes", () => {
  it("every shape round-trips through the codec", () => {
    for (const shape of SHAPES) {
      const result = parseLibraryFile(buildLibraryFile("shape", shape));
      expect(result.ok, `${shape.id} parses`).toBe(true);
    }
  });

  it("every shape is already within registry ranges (no silent clamp on load)", () => {
    for (const shape of SHAPES) {
      // clampShapeToRegistry rebuilds formulaSettings from the registry; a curated shape that
      // is already valid must come back unchanged.
      expect(clampShapeToRegistry(shape), `${shape.id} unchanged by clamp`).toEqual(shape);
    }
  });

  it("every declared param value sits within its registry [min, max]", () => {
    for (const shape of SHAPES) {
      const def = getFormula(shape.formula);
      for (const p of def.params) {
        const v = shape.formulaSettings.values[p.key];
        expect(v, `${shape.id}.${p.key} present`).toBeTypeOf("number");
        expect(v!).toBeGreaterThanOrEqual(p.min);
        expect(v!).toBeLessThanOrEqual(p.max);
      }
      const iters = shape.formulaSettings.iterations;
      expect(iters).toBeGreaterThanOrEqual(def.iterations.min);
      expect(iters).toBeLessThanOrEqual(def.iterations.max);
    }
  });
});

describe("curated looks", () => {
  it("every look round-trips through the codec", () => {
    for (const look of LOOKS) {
      const result = parseLibraryFile(buildLibraryFile("look", look));
      expect(result.ok, `${look.id} parses`).toBe(true);
    }
  });

  it("every look is already within clamp ranges (no silent alteration on import)", () => {
    for (const look of LOOKS) {
      expect(clampLookToEnvironments(look), `${look.id} unchanged by clamp`).toEqual(look);
    }
  });

  it("yields finite glass params for every look (no undefined → NaN into the uniform)", () => {
    // Regression guard: the curated looks predate the refraction split and omit the optional
    // fields. Every look-application path reads them through glassParams(); if any site forgot
    // the default it would feed undefined → NaN into matQ, which silently kills the
    // translucency branch in the shader. A curated look with the fields absent must default to
    // exactly 0 here.
    for (const look of LOOKS) {
      const g = glassParams(look.material);
      expect(Number.isFinite(g.refraction), `${look.id} refraction finite`).toBe(true);
      expect(Number.isFinite(g.dispersion), `${look.id} dispersion finite`).toBe(true);
      if (look.material.refraction === undefined) expect(g.refraction).toBe(0);
      if (look.material.dispersion === undefined) expect(g.dispersion).toBe(0);
    }
  });
});

describe("curated presets", () => {
  it("every preset round-trips through the codec", () => {
    for (const preset of PRESETS) {
      const result = parseLibraryFile(buildLibraryFile("preset", preset));
      expect(result.ok, `${preset.id} parses`).toBe(true);
    }
  });
});

describe("defaultEffects (REPORT_IMPR §6.5)", () => {
  it("validates against the look schema's effects definition", () => {
    // The hand-built EffectsSettings literal and the zod schema are two parallel definitions;
    // this pins them together so a field/shape drift in either is caught.
    expect(() => lookSchema.shape.effects.parse(defaultEffects())).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  LIBRARY_FILE_VERSION,
  buildLibraryFile,
  clampLookToEnvironments,
  clampShapeToRegistry,
  parseLibraryFile,
} from "../../src/fractal/library-codec";
import { AO_DEFAULTS } from "../../src/fractal/effects-defaults";
import { BOX_BULB, MANDELBOX_AS_CHAIN } from "../../src/fractal/chain-presets";
import { SHAPES } from "../../src/fractal/shapes";
import { LOOKS } from "../../src/fractal/looks";
import { PRESETS } from "../../src/fractal/presets";
import { ENVIRONMENTS } from "../../src/fractal/environments";
import { MAX_PALETTE_STOPS } from "../../src/fractal/types";
import type { FractalShape, Look } from "../../src/fractal/types";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("buildLibraryFile / parseLibraryFile round-trip", () => {
  it("round-trips a curated shape", () => {
    const shape = SHAPES[0]!;
    const result = parseLibraryFile(buildLibraryFile("shape", shape));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "shape") {
      expect(result.item.formula).toBe(shape.formula);
      expect(result.item.formulaSettings).toEqual(shape.formulaSettings);
    }
  });

  it("round-trips a curated look", () => {
    const look = LOOKS[0]!;
    const result = parseLibraryFile(buildLibraryFile("look", look));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "look") {
      expect(result.item.lights.length).toBe(look.lights.length);
      expect(result.item.sky.mode).toBe(look.sky.mode);
    }
  });

  it("round-trips a curated preset", () => {
    const preset = PRESETS[0]!;
    const result = parseLibraryFile(buildLibraryFile("preset", preset));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "preset") {
      expect(result.item.shape.formula).toBe(preset.shape.formula);
    }
  });

  it("stamps the current file version on export", () => {
    const envelope = JSON.parse(buildLibraryFile("shape", SHAPES[0]!)) as { version: number };
    expect(envelope.version).toBe(LIBRARY_FILE_VERSION);
  });
});

describe("spatial colour / AO / sky-haze fields (proposals #2-#4)", () => {
  const baseLook = (): Look => clone(LOOKS[0]!);

  it("deep round-trips the new material, AO, and fog fields in range", () => {
    const base = baseLook();
    const look: Look = {
      ...base,
      material: {
        ...base.material,
        triplanarAmount: 0.4,
        triplanarScale: 3,
        cavityShift: -0.5,
        cavityRoughness: 0.6,
      },
      effects: {
        ...base.effects,
        surface: { ...base.effects.surface, aoStrength: 0.5, aoEmphasis: 0.2 },
        fog: { ...base.effects.fog, density: 0.05, skyHaze: 0.8 },
      },
    };
    const result = parseLibraryFile(buildLibraryFile("look", look));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "look") {
      expect(result.item.material.triplanarAmount).toBe(0.4);
      expect(result.item.material.triplanarScale).toBe(3);
      expect(result.item.material.cavityShift).toBe(-0.5);
      expect(result.item.material.cavityRoughness).toBe(0.6);
      expect(result.item.effects.surface.aoStrength).toBe(0.5);
      expect(result.item.effects.surface.aoEmphasis).toBe(0.2);
      expect(result.item.effects.fog.skyHaze).toBe(0.8);
    }
  });

  it("clamps out-of-range values to their bounds", () => {
    const base = baseLook();
    const look: Look = {
      ...base,
      material: {
        ...base.material,
        triplanarAmount: 5,
        cavityShift: -3,
        cavityRoughness: 9,
      },
      effects: {
        ...base.effects,
        surface: { ...base.effects.surface, aoStrength: 9, aoEmphasis: -1 },
        fog: { ...base.effects.fog, skyHaze: 2 },
      },
    };
    const result = parseLibraryFile(buildLibraryFile("look", look));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "look") {
      expect(result.item.material.triplanarAmount).toBe(1);
      expect(result.item.material.cavityShift).toBe(-1);
      expect(result.item.material.cavityRoughness).toBe(1);
      expect(result.item.effects.surface.aoStrength).toBe(1);
      expect(result.item.effects.surface.aoEmphasis).toBe(0);
      expect(result.item.effects.fog.skyHaze).toBe(1);
    }
  });

  it("backfills AO_DEFAULTS when a pre-AO look omits the fields", () => {
    const file = JSON.parse(buildLibraryFile("look", baseLook())) as {
      item: { effects: { surface: Record<string, unknown> } };
    };
    delete file.item.effects.surface.aoStrength;
    delete file.item.effects.surface.aoEmphasis;
    const result = parseLibraryFile(JSON.stringify(file));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "look") {
      expect(result.item.effects.surface.aoStrength).toBe(AO_DEFAULTS.strength);
      expect(result.item.effects.surface.aoEmphasis).toBe(AO_DEFAULTS.emphasis);
    }
  });
});

describe("envelope version guards", () => {
  it("rejects a file from a newer version", () => {
    const file = JSON.parse(buildLibraryFile("shape", SHAPES[0]!)) as Record<string, unknown>;
    file.version = LIBRARY_FILE_VERSION + 1;
    const result = parseLibraryFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
  });

  it("rejects a file from an older version", () => {
    const file = JSON.parse(buildLibraryFile("look", LOOKS[0]!)) as Record<string, unknown>;
    file.version = LIBRARY_FILE_VERSION - 1;
    const result = parseLibraryFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
  });

  it("rejects non-KFractal files", () => {
    expect(parseLibraryFile("{}").ok).toBe(false);
    expect(parseLibraryFile("not json").ok).toBe(false);
  });

  it("accepts the current version", () => {
    const result = parseLibraryFile(buildLibraryFile("look", LOOKS[0]!));
    expect(result.ok).toBe(true);
  });
});

describe("palette ramp", () => {
  it("round-trips a curated multi-stop ramp", () => {
    const result = parseLibraryFile(buildLibraryFile("look", LOOKS[0]!));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "look") {
      expect(result.item.palette.stops.length).toBeGreaterThanOrEqual(2);
      expect(result.item.palette.interpolation).toBe("linear");
      expect(result.item.palette.colorSpace).toBe("rgb");
    }
  });

  it("rejects a palette with more than MAX_PALETTE_STOPS stops", () => {
    const file = JSON.parse(buildLibraryFile("look", LOOKS[0]!)) as Record<string, unknown>;
    const look = file.item as Record<string, unknown>;
    const palette = look.palette as Record<string, unknown>;
    palette.stops = Array.from({ length: MAX_PALETTE_STOPS + 1 }, (_, i) => ({
      position: i / MAX_PALETTE_STOPS,
      color: "#808080",
    }));
    expect(parseLibraryFile(JSON.stringify(file)).ok).toBe(false);
  });

  it("rejects a palette with no stops (pre-ramp files are not supported)", () => {
    const file = JSON.parse(buildLibraryFile("look", LOOKS[0]!)) as Record<string, unknown>;
    const look = file.item as Record<string, unknown>;
    delete (look.palette as Record<string, unknown>).stops;
    expect(parseLibraryFile(JSON.stringify(file)).ok).toBe(false);
  });
});

describe("clampShapeToRegistry", () => {
  it("clamps out-of-range params and rounds iterations", () => {
    const base = SHAPES[0]!;
    const key = Object.keys(base.formulaSettings.values)[0]!;
    const shape: FractalShape = {
      ...base,
      formulaSettings: { iterations: 1e9, values: { ...base.formulaSettings.values, [key]: 1e9 } },
    };
    const clamped = clampShapeToRegistry(shape);
    expect(Number.isFinite(clamped.formulaSettings.values[key]!)).toBe(true);
    expect(clamped.formulaSettings.values[key]!).toBeLessThan(1e9);
    expect(Number.isInteger(clamped.formulaSettings.iterations)).toBe(true);
  });

  it("drops unknown param keys", () => {
    const base = SHAPES[0]!;
    const shape: FractalShape = {
      ...base,
      formulaSettings: {
        ...base.formulaSettings,
        values: { ...base.formulaSettings.values, bogusKey: 5 },
      },
    };
    const clamped = clampShapeToRegistry(shape);
    expect("bogusKey" in clamped.formulaSettings.values).toBe(false);
  });
});

const chainShape = (chain: NonNullable<FractalShape["chain"]>): FractalShape => ({
  ...SHAPES[0]!,
  chain,
});

describe("hybrid formula chain (Phase 2 codec)", () => {
  it("round-trips a chain shape with a finite bailout", () => {
    const result = parseLibraryFile(buildLibraryFile("shape", chainShape(BOX_BULB)));
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "shape") {
      expect(result.item.chain?.stages.length).toBe(BOX_BULB.stages.length);
      expect(result.item.chain?.deForm).toBe("linear");
      expect(result.item.chain?.bailout).toBe(6);
      expect(result.item.chain?.stages[2]?.transform).toBe("bulbPow");
    }
  });

  it("round-trips an Infinity bailout through JSON null (pure fold/IFS chains)", () => {
    // JSON cannot carry Infinity; buildLibraryFile emits null and the reader maps it back.
    const file = buildLibraryFile("shape", chainShape(MANDELBOX_AS_CHAIN));
    expect(JSON.parse(file).item.chain.bailout).toBeNull();
    const result = parseLibraryFile(file);
    expect(result.ok).toBe(true);
    if (result.ok && result.kind === "shape") {
      expect(result.item.chain?.bailout).toBe(Infinity);
    }
  });

  it("drops a stage whose transform is unknown and clamps out-of-range params", () => {
    const file = JSON.parse(buildLibraryFile("shape", chainShape(BOX_BULB))) as any;
    file.item.chain.stages.push({ transform: "notATransform", values: {} });
    file.item.chain.stages[0].values.fold = 999; // boxFold fold max is 2
    const result = parseLibraryFile(JSON.stringify(file));
    // zod's enum rejects the unknown transform at parse time, so the whole file is invalid -
    // an importer cannot smuggle in a stage the engine has no transform for.
    expect(result.ok).toBe(false);
  });

  it("falls back to the atomic formula when clampChain finds nothing valid", () => {
    // A structurally-valid-but-empty-after-clamp chain (zero stages can't pass the min(1)
    // schema, so simulate the clamp path directly): clampShapeToRegistry drops it.
    const shape = chainShape({ ...BOX_BULB, stages: [] });
    const clamped = clampShapeToRegistry(shape);
    expect(clamped.chain).toBeUndefined();
    expect(clamped.formula).toBe(SHAPES[0]!.formula);
  });
});

describe("clampLookToEnvironments", () => {
  const badLook = (): Look => {
    const look = clone(LOOKS[0]!) as Look;
    look.ambient = 1e9;
    look.lights[0]!.intensity = -5;
    look.lights[0]!.direction = [0, 0, 0];
    look.sky.intensity = 1e9;
    look.sky.envId = "does-not-exist";
    return look;
  };

  it("clamps negative intensity to >= 0", () => {
    expect(clampLookToEnvironments(badLook()).lights[0]!.intensity).toBeGreaterThanOrEqual(0);
  });

  it("clamps absurd ambient into range", () => {
    expect(clampLookToEnvironments(badLook()).ambient).toBeLessThanOrEqual(0.02);
  });

  it("replaces a zero-length direction with a non-degenerate one", () => {
    const dir = clampLookToEnvironments(badLook()).lights[0]!.direction;
    expect(Math.hypot(dir[0], dir[1], dir[2])).toBeGreaterThan(1e-6);
  });

  it("falls back to a known environment id", () => {
    const envId = clampLookToEnvironments(badLook()).sky.envId;
    expect(ENVIRONMENTS.some((env) => env.id === envId)).toBe(true);
  });

  it("leaves the glass fields absent on pre-refraction looks", () => {
    // Curated looks predate the refraction split and omit the optional fields; clamping must
    // not materialize them, or the canonical-content check would see a silent alteration.
    const m = clampLookToEnvironments(clone(LOOKS[0]!) as Look).material;
    expect(m.refraction).toBeUndefined();
    expect(m.dispersion).toBeUndefined();
  });

  it("clamps out-of-range glass fields in place when present", () => {
    const look = clone(LOOKS[0]!) as Look;
    look.material.refraction = 5;
    look.material.dispersion = -1;
    const m = clampLookToEnvironments(look).material;
    expect(m.refraction).toBe(1);
    expect(m.dispersion).toBe(0);
  });
});

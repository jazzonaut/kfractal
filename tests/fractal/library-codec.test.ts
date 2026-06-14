import { describe, expect, it } from "vitest";
import {
  LIBRARY_FILE_VERSION,
  buildLibraryFile,
  clampLookToEnvironments,
  clampShapeToRegistry,
  migrateLookLightV4,
  parseLibraryFile,
} from "../../src/fractal/library-codec";
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

describe("envelope version guards", () => {
  it("rejects a file from a newer version", () => {
    const file = JSON.parse(buildLibraryFile("shape", SHAPES[0]!)) as Record<string, unknown>;
    file.version = LIBRARY_FILE_VERSION + 1;
    const result = parseLibraryFile(JSON.stringify(file));
    expect(result.ok).toBe(false);
  });

  it("rejects pre-split (v < 4) files", () => {
    const file = JSON.parse(buildLibraryFile("look", LOOKS[0]!)) as Record<string, unknown>;
    file.version = 3;
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

describe("migrateLookLightV4", () => {
  it("converts a single v4 light into a lights array", () => {
    const v4 = {
      id: "x",
      name: "X",
      light: { color: "#abcdef", intensity: 2, size: 0.2, direction: [0, 1, 0] },
    };
    const migrated = migrateLookLightV4(v4) as Record<string, unknown>;
    expect(Array.isArray(migrated.lights)).toBe(true);
    const lights = migrated.lights as Array<Record<string, unknown>>;
    expect(lights).toHaveLength(1);
    expect(lights[0]!.type).toBe("directional");
    expect(lights[0]!.color).toBe("#abcdef");
    expect("light" in migrated).toBe(false);
  });

  it("is a pass-through when lights already exist", () => {
    const v5 = { id: "x", name: "X", lights: [{ type: "directional" }] };
    expect(migrateLookLightV4(v5)).toBe(v5);
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
});

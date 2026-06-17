import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkstationState } from "../../src/fractal/state-bridge";
import { AO_DEFAULTS, FOG_DEFAULTS } from "../../src/fractal/effects-defaults";
import { PRESETS } from "../../src/fractal/presets";
import type { FractalPreset } from "../../src/fractal/types";

// createWorkstationState reads loadUserLibrary() (localStorage); give it an empty store so the
// mapping under test runs without depending on a real browser.
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => vi.unstubAllGlobals());

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("createWorkstationState: spatial colour / AO / sky-haze mapping (look -> state)", () => {
  it("maps explicit new-field values onto the flat state", () => {
    const base = PRESETS[0]!;
    const preset: FractalPreset = {
      ...base,
      look: {
        ...base.look,
        material: {
          ...base.look.material,
          triplanarAmount: 0.4,
          triplanarScale: 3,
          cavityShift: -0.5,
          cavityRoughness: 0.6,
        },
        effects: {
          ...base.look.effects,
          surface: { ...base.look.effects.surface, aoStrength: 0.5, aoEmphasis: 0.2 },
          fog: { ...base.look.effects.fog, skyHaze: 0.8 },
        },
      },
    };
    const state = createWorkstationState(preset, 800, 600);
    expect(state.triplanarAmount).toBe(0.4);
    expect(state.triplanarScale).toBe(3);
    expect(state.cavityShift).toBe(-0.5);
    expect(state.cavityRoughness).toBe(0.6);
    expect(state.aoStrength).toBe(0.5);
    expect(state.aoEmphasis).toBe(0.2);
    expect(state.fogSkyHaze).toBe(0.8);
  });

  it("falls back to the documented defaults when the look omits the fields", () => {
    // Strip the optional/legacy fields to exercise the `?? default` mapping (guards against a
    // typo'd default, e.g. `?? 1.5` vs `?? 0`).
    const preset = clone(PRESETS[0]!);
    const mat = preset.look.material as unknown as Record<string, unknown>;
    delete mat.triplanarAmount;
    delete mat.triplanarScale;
    delete mat.cavityShift;
    delete mat.cavityRoughness;
    const surf = preset.look.effects.surface as unknown as Record<string, unknown>;
    delete surf.aoStrength;
    delete surf.aoEmphasis;
    const fog = preset.look.effects.fog as unknown as Record<string, unknown>;
    delete fog.skyHaze;

    const state = createWorkstationState(preset, 800, 600);
    expect(state.triplanarAmount).toBe(0);
    expect(state.triplanarScale).toBe(1.5);
    expect(state.cavityShift).toBe(0);
    expect(state.cavityRoughness).toBe(0);
    expect(state.aoStrength).toBe(AO_DEFAULTS.strength);
    expect(state.aoEmphasis).toBe(AO_DEFAULTS.emphasis);
    expect(state.fogSkyHaze).toBe(FOG_DEFAULTS.skyHaze);
  });
});

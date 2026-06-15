import type { EffectsSettings, FogShape } from "./types";

/**
 * Canonical defaults for the fog placement fields (shape/level/pocket*). These are
 * optional on FogSettings so presets and scenes saved before the pocket feature still
 * parse; every `?? ...` fallback that fills them in references this object, so the values
 * live in exactly one place.
 */
export const FOG_DEFAULTS: {
  shape: FogShape;
  level: number;
  pocketX: number;
  pocketY: number;
  pocketZ: number;
  pocketRadius: number;
  pocketEdge: number;
} = {
  shape: "layer",
  level: 0,
  pocketX: 0,
  pocketY: 0,
  pocketZ: 5,
  pocketRadius: 3,
  pocketEdge: 0.5,
};

/**
 * Everything off (ADR-0007-style opt-in): zero strengths reproduce the pre-effects
 * look exactly. Shape params (height, radius, filmShift, ...) carry pleasant values
 * so the first strength-slider nudge already looks good.
 */
export function defaultEffects(): EffectsSettings {
  return {
    fog: { density: 0, height: 1.5, anisotropy: 0.4, color: "#a8c4e0", ...FOG_DEFAULTS },
    glow: { strength: 0, radius: 0.25, usePalette: true, color: "#ffd9a0" },
    surface: { iridescence: 0, filmShift: 0.3, rimStrength: 0, microScale: 12, microRoughness: 0 },
    growth: {
      length: 0,
      density: 80,
      mode: "spikes",
      sharpness: 3,
      coverage: 1,
      trapBias: 0,
      color: "#7be38a",
      colorBlend: 0.85,
      emission: 0,
    },
    post: { vignetteStrength: 0, vignetteSoftness: 0.5, grainStrength: 0, distortion: 0 },
  };
}

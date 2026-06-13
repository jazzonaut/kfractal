import type { EffectsSettings } from "./types";

/**
 * Everything off (ADR-0007-style opt-in): zero strengths reproduce the pre-effects
 * look exactly. Shape params (height, radius, filmShift, ...) carry pleasant values
 * so the first strength-slider nudge already looks good.
 */
export function defaultEffects(): EffectsSettings {
  return {
    fog: { density: 0, height: 1.5, anisotropy: 0.4, color: "#a8c4e0" },
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

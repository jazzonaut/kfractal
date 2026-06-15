import { defaultEffects } from "./effects-defaults";
import { DEFAULT_SKY } from "./environments";
import type { EffectsSettings, LightSource, Look, PaletteSettings } from "./types";

/** A linear/RGB palette ramp with the given colours spread evenly across 0..1. */
function evenRamp(
  colors: string[],
): Pick<PaletteSettings, "stops" | "interpolation" | "colorSpace"> {
  return {
    stops: colors.map((color, i) => ({ position: i / (colors.length - 1), color })),
    interpolation: "linear",
    colorSpace: "rgb",
  };
}

/**
 * Directional key light with the positional-side fields at sensible defaults, so the
 * curated looks stay terse while every LightSource round-trips both placement modes.
 */
function keyLight(l: {
  direction: [number, number, number];
  size: number;
  intensity: number;
  color: string;
}): LightSource {
  return {
    type: "directional",
    enabled: true,
    position: [1.2, 1.2, 1.2],
    falloff: 1.5,
    ...l,
  };
}

/** A subtle thin-film iridescence accent on top of the all-off defaults (for Oil Slick). */
function iridescentEffects(): EffectsSettings {
  const base = defaultEffects();
  return { ...base, surface: { ...base.surface, iridescence: 0.3, filmShift: 0.5 } };
}

/** Starting point for a light added from the UI: a small white positional fill. */
export function defaultNewLight(): LightSource {
  return {
    type: "positional",
    enabled: true,
    color: "#ffffff",
    intensity: 1.2,
    size: 0.05,
    direction: [0.48, 0.72, 0.42],
    position: [0.9, 0.9, 0.9],
    falloff: 1.5,
  };
}

/**
 * Curated look library (ADR-0010): the art-direction axis, factored out of the original
 * monolithic presets - lighting, environment, surface response, palette, grade, and lens
 * character. A look never moves the camera or changes geometry; any look can be paired
 * with any shape.
 *
 * The set is tuned for variety: dark, hued palette bases and restrained bloom keep
 * contrast high so the geometry reads, and no two looks sit in the same hue/mood.
 */

export const AMETHYST_TIDE: Look = {
  id: "amethyst-tide",
  name: "Amethyst Tide",
  description: "Purple/cyan gradient under a warm studio key; glossy crystal response.",
  lens: { aperture: 0.0, chromaticAberration: 0.01 },
  ambient: 0.008,
  lights: [
    keyLight({ direction: [0.45, 0.72, 0.45], size: 0.25, intensity: 2.2, color: "#fff2e4" }),
  ],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.45,
    specular: 0.6,
    translucency: 0.12,
    ior: 1.6,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#140c3f", "#4f8fe8", "#e84fd0"]),
    saturation: 0.95,
    exposure: 1.05,
    contrast: 1.08,
    bloomStrength: 0.25,
    bloomRadius: 0.4,
    bloomThreshold: 0.7,
  },
  effects: defaultEffects(),
};

export const WARM_IVORY: Look = {
  id: "warm-ivory",
  name: "Warm Ivory",
  description: "High-contrast carved marble: cool umber shadows into warm ivory highlights.",
  lens: { aperture: 0.0, chromaticAberration: 0.013 },
  ambient: 0.002,
  lights: [keyLight({ direction: [0.35, 0.75, 0.5], size: 0.3, intensity: 1.7, color: "#fff0d8" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.6,
    specular: 0.4,
    translucency: 0.18,
    ior: 1.45,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#0099f2", "#7a5a3a", "#cdb487", "#fff6e2"]),
    saturation: 0.77,
    exposure: 1.0,
    contrast: 1.5,
    bloomStrength: 0.22,
    bloomRadius: 0.45,
    bloomThreshold: 0.7,
  },
  effects: defaultEffects(),
};

export const INNER_FIRE: Look = {
  id: "inner-fire",
  name: "Inner Fire",
  description: "Molten body: near-black crust into a white-hot emissive core.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.001,
  lights: [keyLight({ direction: [0.3, 0.8, 0.35], size: 0.3, intensity: 1.0, color: "#ffd9a8" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.42,
    specular: 0.5,
    translucency: 0.0,
    ior: 1.5,
    emissionStrength: 0.8,
    emissionColor: "#ffce86",
  },
  palette: {
    ...evenRamp(["#0a0200", "#6e1c06", "#e0631a", "#fff0c0"]),
    saturation: 0.95,
    exposure: 0.92,
    contrast: 1.32,
    bloomStrength: 0.45,
    bloomRadius: 0.55,
    bloomThreshold: 0.55,
  },
  effects: {
    ...defaultEffects(),
    glow: { strength: 0.4, radius: 0.3, usePalette: true, color: "#ff8a3c" },
    surface: {
      iridescence: 0,
      filmShift: 0.3,
      rimStrength: 1.3,
      microScale: 12,
      microRoughness: 0,
    },
    growth: {
      length: 0.05,
      density: 60,
      mode: "crystals",
      sharpness: 4,
      coverage: 0.7,
      trapBias: 0.2,
      color: "#ff6a1a",
      colorBlend: 0.7,
      emission: 1.2,
    },
  },
};

export const MOSSY_BACKLIGHT: Look = {
  id: "mossy-backlight",
  name: "Mossy Backlight",
  description: "Waxy backlit translucency; dark forest shadow into glowing lime pores.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.006,
  lights: [keyLight({ direction: [0.3, 0.85, 0.3], size: 0.35, intensity: 3.0, color: "#fff8e0" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.35,
    specular: 0.55,
    translucency: 0.42,
    ior: 1.5,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#06140a", "#2f7a2e", "#9bd83a", "#eaffb0"]),
    saturation: 1.0,
    exposure: 1.05,
    contrast: 1.18,
    bloomStrength: 0.3,
    bloomRadius: 0.45,
    bloomThreshold: 0.55,
  },
  effects: defaultEffects(),
};

export const WET_JADE: Look = {
  id: "wet-jade",
  name: "Wet Jade",
  description: "Cold turquoise jewel; deep teal shadow into a wet aqua sheen.",
  lens: { aperture: 0.0, chromaticAberration: 0.008 },
  ambient: 0.004,
  lights: [keyLight({ direction: [0.5, 0.65, 0.4], size: 0.18, intensity: 2.4, color: "#f2fffb" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.2,
    specular: 0.9,
    translucency: 0.06,
    ior: 1.7,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#04221f", "#0e7068", "#2fd0b8", "#c6fff0"]),
    saturation: 0.98,
    exposure: 1.3,
    contrast: 1.25,
    bloomStrength: 0.3,
    bloomRadius: 0.4,
    bloomThreshold: 0.6,
  },
  effects: defaultEffects(),
};

export const DESERT_SUN: Look = {
  id: "desert-sun",
  name: "Desert Sun",
  description: "Low Preetham sun raking warm light over sandstone tones.",
  lens: { aperture: 0.0, chromaticAberration: 0.01 },
  ambient: 0.004,
  lights: [
    keyLight({ direction: [0.45, 0.72, 0.45], size: 0.3, intensity: 0.5, color: "#ffe9d0" }),
  ],
  sky: {
    mode: "preetham",
    intensity: 0.45,
    sunElevation: 14,
    sunAzimuth: 35,
    turbidity: 4.5,
    sunSize: 0.04,
    envId: "aurora-veil",
    yaw: 0,
  },
  material: {
    roughness: 0.55,
    specular: 0.45,
    translucency: 0.08,
    ior: 1.5,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#1c1208", "#c89a5e", "#f7e6c4"]),
    saturation: 0.9,
    exposure: 0.95,
    contrast: 1.15,
    bloomStrength: 0.3,
    bloomRadius: 0.45,
    bloomThreshold: 0.6,
  },
  effects: defaultEffects(),
};

export const GILDED_HAZE: Look = {
  id: "gilded-haze",
  name: "Gilded Haze",
  description: "Rose-copper dusk; wine shadows into warm coral and pale peach.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.002,
  lights: [keyLight({ direction: [0.35, 0.75, 0.5], size: 0.3, intensity: 0.7, color: "#ffe2c2" })],
  sky: {
    mode: "envmap",
    intensity: 1.2,
    sunElevation: 35,
    sunAzimuth: 0,
    turbidity: 3,
    sunSize: 0.05,
    envId: "gilded-haze",
    yaw: 0,
  },
  material: {
    roughness: 0.5,
    specular: 0.45,
    translucency: 0.12,
    ior: 1.45,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#2a1418", "#b85e54", "#eaa878", "#ffe8d0"]),
    saturation: 0.9,
    exposure: 1.12,
    contrast: 1.12,
    bloomStrength: 0.3,
    bloomRadius: 0.45,
    bloomThreshold: 0.6,
  },
  effects: defaultEffects(),
};

export const EMBER_STORM: Look = {
  id: "ember-storm",
  name: "Ember Storm",
  description: "Smouldering storm; smoky purple-black into deep ember and hot orange.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.001,
  lights: [keyLight({ direction: [0.3, 0.8, 0.35], size: 0.3, intensity: 0.3, color: "#ffc89a" })],
  sky: {
    mode: "envmap",
    intensity: 0.5,
    sunElevation: 35,
    sunAzimuth: 0,
    turbidity: 3,
    sunSize: 0.05,
    envId: "ember-storm",
    yaw: 0,
  },
  material: {
    roughness: 0.45,
    specular: 0.5,
    translucency: 0.0,
    ior: 1.5,
    emissionStrength: 1.1,
    emissionColor: "#ff7a2a",
  },
  palette: {
    ...evenRamp(["#0c0614", "#6a164a", "#d2401a", "#ffd24a"]),
    saturation: 0.95,
    exposure: 1.05,
    contrast: 1.28,
    bloomStrength: 0.5,
    bloomRadius: 0.55,
    bloomThreshold: 0.5,
  },
  effects: {
    ...defaultEffects(),
    fog: { density: 0.035, height: 1.5, anisotropy: 0.65, color: "#c0401a" },
    glow: { strength: 0.5, radius: 0.3, usePalette: true, color: "#ff8a3c" },
    surface: {
      iridescence: 0,
      filmShift: 0.3,
      rimStrength: 1.1,
      microScale: 12,
      microRoughness: 0,
    },
  },
};

export const MOONLIT_LANTERNS: Look = {
  id: "moonlit-lanterns",
  name: "Moonlit Lanterns",
  description: "Calm moonless blue; a soft warm lantern glow from the pores.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.001,
  lights: [keyLight({ direction: [0.3, 0.85, 0.3], size: 0.4, intensity: 0.5, color: "#aacbff" })],
  sky: {
    mode: "envmap",
    intensity: 0.2,
    sunElevation: 35,
    sunAzimuth: 0,
    turbidity: 3,
    sunSize: 0.05,
    envId: "midnight",
    yaw: 0,
  },
  material: {
    roughness: 0.4,
    specular: 0.5,
    translucency: 0.3,
    ior: 1.5,
    emissionStrength: 0.5,
    emissionColor: "#ffc97f",
  },
  palette: {
    ...evenRamp(["#03060e", "#143049", "#5b86b8", "#cfe6ff"]),
    saturation: 0.85,
    exposure: 1.25,
    contrast: 1.4,
    bloomStrength: 0.45,
    bloomRadius: 0.5,
    bloomThreshold: 0.55,
  },
  effects: {
    ...defaultEffects(),
    glow: { strength: 0.4, radius: 0.3, usePalette: false, color: "#ffc97f" },
  },
};

export const GLACIER_STEEL: Look = {
  id: "glacier-steel",
  name: "Glacier Steel",
  description: "Near-monochrome cold steel; matte metal that reads pure form.",
  lens: { aperture: 0.0, chromaticAberration: 0.006 },
  ambient: 0.003,
  lights: [keyLight({ direction: [0.4, 0.7, 0.5], size: 0.28, intensity: 1.7, color: "#eaf2ff" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.3,
    specular: 0.7,
    translucency: 0.0,
    ior: 1.5,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#04070e", "#22354e", "#5a86b8", "#dce9fb"]),
    saturation: 0.68,
    exposure: 1.14,
    contrast: 1.8,
    bloomStrength: 0.25,
    bloomRadius: 0.4,
    bloomThreshold: 0.65,
  },
  effects: defaultEffects(),
};

export const SYNTH_NEON: Look = {
  id: "synth-neon",
  name: "Synth Neon",
  description: "Electric magenta-to-cyan on black; heavy glow, high saturation.",
  lens: { aperture: 0.0, chromaticAberration: 0.02 },
  ambient: 0.002,
  lights: [keyLight({ direction: [0.4, 0.7, 0.45], size: 0.25, intensity: 1.4, color: "#ffffff" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.3,
    specular: 0.7,
    translucency: 0.0,
    ior: 1.5,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#05010a", "#5a17a8", "#ff2bd6", "#28f0ff"]),
    saturation: 1.12,
    exposure: 1.05,
    contrast: 1.05,
    bloomStrength: 0.65,
    bloomRadius: 0.6,
    bloomThreshold: 0.38,
  },
  effects: {
    ...defaultEffects(),
    fog: { density: 0.025, height: 1.5, anisotropy: 0.5, color: "#2a0a4a" },
    glow: { strength: 0.6, radius: 0.3, usePalette: true, color: "#ff2bd6" },
  },
};

export const OIL_SLICK: Look = {
  id: "oil-slick",
  name: "Oil Slick",
  description: "Dark glossy petrol shell banded blue-purple-teal like an oil-film sheen.",
  lens: { aperture: 0.0, chromaticAberration: 0.014 },
  ambient: 0.004,
  lights: [
    keyLight({ direction: [0.45, 0.7, 0.45], size: 0.22, intensity: 2.2, color: "#ffffff" }),
  ],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.15,
    specular: 0.9,
    translucency: 0.0,
    ior: 1.6,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#28286a", "#2f6ad0", "#b84ac8", "#46f0d6"]),
    saturation: 0.95,
    exposure: 1.5,
    contrast: 1.2,
    bloomStrength: 0.4,
    bloomRadius: 0.45,
    bloomThreshold: 0.5,
  },
  effects: iridescentEffects(),
};

export const LOOKS: readonly Look[] = [
  AMETHYST_TIDE,
  WARM_IVORY,
  WET_JADE,
  MOSSY_BACKLIGHT,
  DESERT_SUN,
  GILDED_HAZE,
  INNER_FIRE,
  EMBER_STORM,
  MOONLIT_LANTERNS,
  GLACIER_STEEL,
  SYNTH_NEON,
  OIL_SLICK,
];

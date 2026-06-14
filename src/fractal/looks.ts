import { defaultEffects } from "./effects-defaults";
import { DEFAULT_SKY } from "./environments";
import type { LightSource, Look, PaletteSettings } from "./types";

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
 * Values are copied verbatim from the pre-split presets so every curated pairing in
 * `presets.ts` reproduces its original image exactly.
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
  description: "Soft warm key over pale carved-ivory tones, near-black fill.",
  lens: { aperture: 0.0, chromaticAberration: 0.013 },
  ambient: 0.002,
  lights: [keyLight({ direction: [0.35, 0.75, 0.5], size: 0.3, intensity: 1.9, color: "#fff0d8" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.6,
    specular: 0.35,
    translucency: 0.18,
    ior: 1.4,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#241a10", "#b5a37d", "#f0e8cf"]),
    saturation: 0.82,
    exposure: 1.12,
    contrast: 1.1,
    bloomStrength: 0.25,
    bloomRadius: 0.45,
    bloomThreshold: 0.6,
  },
  effects: defaultEffects(),
};

export const INNER_FIRE: Look = {
  id: "inner-fire",
  name: "Inner Fire",
  description: "Dim amber key; the surface glows white-hot from inside.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.001,
  lights: [keyLight({ direction: [0.3, 0.8, 0.35], size: 0.3, intensity: 0.7, color: "#ffd9a8" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.42,
    specular: 0.5,
    translucency: 0.0,
    ior: 1.5,
    emissionStrength: 2.2,
    emissionColor: "#fff3c4",
  },
  palette: {
    ...evenRamp(["#140602", "#703a10", "#ffd584"]),
    saturation: 0.85,
    exposure: 0.95,
    contrast: 1.2,
    bloomStrength: 0.6,
    bloomRadius: 0.5,
    bloomThreshold: 0.45,
  },
  effects: defaultEffects(),
};

export const MOSSY_BACKLIGHT: Look = {
  id: "mossy-backlight",
  name: "Mossy Backlight",
  description: "Bright backlit key through waxy translucency; olive tones, bright pores.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.006,
  lights: [keyLight({ direction: [0.3, 0.85, 0.3], size: 0.35, intensity: 3.0, color: "#fff8e0" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.35,
    specular: 0.55,
    translucency: 0.4,
    ior: 1.5,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#1a1505", "#5c6e22", "#d3e26b"]),
    saturation: 1.0,
    exposure: 1.25,
    contrast: 1.1,
    bloomStrength: 0.3,
    bloomRadius: 0.45,
    bloomThreshold: 0.55,
  },
  effects: defaultEffects(),
};

export const WET_JADE: Look = {
  id: "wet-jade",
  name: "Wet Jade",
  description: "Single hard key on a wet, glossy green surface.",
  lens: { aperture: 0.0, chromaticAberration: 0.008 },
  ambient: 0.004,
  lights: [keyLight({ direction: [0.5, 0.65, 0.4], size: 0.2, intensity: 2.4, color: "#f2fff4" })],
  sky: { ...DEFAULT_SKY },
  material: {
    roughness: 0.25,
    specular: 0.85,
    translucency: 0.1,
    ior: 1.7,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#07140c", "#256b46", "#8fd470"]),
    saturation: 0.95,
    exposure: 1.05,
    contrast: 1.1,
    bloomStrength: 0.25,
    bloomRadius: 0.4,
    bloomThreshold: 0.65,
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
  description: "Golden procedural dusk environment over warm plaster pinks.",
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
    roughness: 0.55,
    specular: 0.4,
    translucency: 0.15,
    ior: 1.45,
    emissionStrength: 0,
    emissionColor: "#000000",
  },
  palette: {
    ...evenRamp(["#221318", "#c99a8a", "#ffd9b0"]),
    saturation: 0.9,
    exposure: 1.0,
    contrast: 1.1,
    bloomStrength: 0.3,
    bloomRadius: 0.45,
    bloomThreshold: 0.6,
  },
  effects: defaultEffects(),
};

export const EMBER_STORM: Look = {
  id: "ember-storm",
  name: "Ember Storm",
  description: "A burning procedural sky with a faint inner ember glow.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.001,
  lights: [keyLight({ direction: [0.3, 0.8, 0.35], size: 0.3, intensity: 0.3, color: "#ffd9a8" })],
  sky: {
    mode: "envmap",
    intensity: 0.8,
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
    emissionStrength: 0.9,
    emissionColor: "#ff9540",
  },
  palette: {
    ...evenRamp(["#0b0302", "#38130a", "#e8a05a"]),
    saturation: 0.8,
    exposure: 0.95,
    contrast: 1.18,
    bloomStrength: 0.4,
    bloomRadius: 0.5,
    bloomThreshold: 0.6,
  },
  effects: defaultEffects(),
};

export const MOONLIT_LANTERNS: Look = {
  id: "moonlit-lanterns",
  name: "Moonlit Lanterns",
  description: "Moonless midnight environment; warm emissive pores carry the light.",
  lens: { aperture: 0.0, chromaticAberration: 0.012 },
  ambient: 0.001,
  lights: [keyLight({ direction: [0.3, 0.85, 0.3], size: 0.4, intensity: 0.25, color: "#bcd4ff" })],
  sky: {
    mode: "envmap",
    intensity: 1.0,
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
    emissionStrength: 3.2,
    emissionColor: "#ffc97f",
  },
  palette: {
    ...evenRamp(["#050a14", "#1c3a55", "#9fd0ff"]),
    saturation: 1.0,
    exposure: 1.2,
    contrast: 1.12,
    bloomStrength: 0.7,
    bloomRadius: 0.5,
    bloomThreshold: 0.4,
  },
  effects: defaultEffects(),
};

export const LOOKS: readonly Look[] = [
  AMETHYST_TIDE,
  WARM_IVORY,
  INNER_FIRE,
  MOSSY_BACKLIGHT,
  WET_JADE,
  DESERT_SUN,
  GILDED_HAZE,
  EMBER_STORM,
  MOONLIT_LANTERNS,
];

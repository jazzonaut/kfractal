import { z } from "zod";
import { defaultEffects } from "./effects-defaults";
import { DEFAULT_SKY, ENVIRONMENTS } from "./environments";
import { FORMULAS, getFormula } from "./registry";
import { MAX_LIGHTS, MAX_PALETTE_STOPS } from "./types";
import { clampWarp, isWarpOff } from "./warp";
import type { FractalFormulaId, FractalPreset, FractalShape, LibraryKind, Look } from "./types";

/**
 * Library (de)serialization for authoring (ADR-0007, recast by ADR-0010): one zod schema
 * per library kind (shape / look / preset), shared by the localStorage library and the
 * exported JSON files, plus the file envelope and the name/id helpers that keep user
 * items distinct from curated ones.
 */

const finite = z.number().finite();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb hex color");
const vec3 = z.tuple([finite, finite, finite]);

const formulaIds = FORMULAS.map((formula) => formula.id) as [
  FractalFormulaId,
  ...FractalFormulaId[],
];

export const shapeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  formula: z.enum(formulaIds),
  formulaSettings: z.object({
    iterations: finite,
    values: z.record(z.string(), finite),
  }),
  camera: z.object({
    target: vec3,
    yaw: finite,
    pitch: finite,
    distance: finite,
    fov: finite,
    // Optional so files saved before roll existed still parse.
    roll: finite.optional(),
  }),
  focusDistance: finite,
  render: z.object({
    maxSteps: finite,
    maxDistance: finite,
    surfaceEpsilon: finite,
    normalEpsilon: finite,
  }),
  trap: z.object({ scale: finite, power: finite }),
  // Domain warp (ADR-0012), added after v5 shipped; optional so older files keep
  // parsing (absent = identity, and snapshots omit it when fully off).
  warp: z
    .object({
      twist: finite,
      twistAxis: z.enum(["x", "y", "z"]),
      bend: finite,
      bendAxis: z.enum(["x", "y", "z"]),
      rippleAmp: finite,
      rippleFreq: finite,
      rippleAxis: z.enum(["x", "y", "z"]),
      noiseAmp: finite,
      noiseFreq: finite,
    })
    .optional(),
  // Deep-zoom frame, present only when the framing was captured mid-dive.
  dive: z
    .object({
      offset: vec3,
      basis: z.tuple([finite, finite, finite, finite, finite, finite, finite, finite, finite]),
      scale: finite,
    })
    .optional(),
});

export const lightSourceSchema = z.object({
  type: z.enum(["directional", "positional"]),
  enabled: z.boolean(),
  color: hexColor,
  intensity: finite,
  size: finite,
  direction: vec3,
  position: vec3,
  falloff: finite,
});

export const lookSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  lens: z.object({
    aperture: finite,
    chromaticAberration: finite,
  }),
  ambient: finite,
  lights: z.array(lightSourceSchema).min(1).max(MAX_LIGHTS),
  sky: z.object({
    mode: z.enum(["studio", "preetham", "envmap"]),
    intensity: finite,
    sunElevation: finite,
    sunAzimuth: finite,
    turbidity: finite,
    sunSize: finite,
    envId: z.string().min(1),
    yaw: finite,
  }),
  material: z.object({
    roughness: finite,
    specular: finite,
    translucency: finite,
    ior: finite,
    emissionStrength: finite,
    emissionColor: hexColor,
  }),
  palette: z.object({
    // Multi-stop ramp, capped like lights so import honours the same MAX_PALETTE_STOPS the editor
    // enforces. Positions are clamped to [0,1] — the render reads them straight into a uniform, so
    // an out-of-range import would otherwise disagree with the [0,1]-clamped preview.
    stops: z
      .array(z.object({ position: finite.min(0).max(1), color: hexColor }))
      .min(2)
      .max(MAX_PALETTE_STOPS),
    interpolation: z.enum(["linear", "smooth", "stepped"]),
    colorSpace: z.enum(["rgb", "oklab"]),
    saturation: finite,
    exposure: finite,
    contrast: finite,
    bloomStrength: finite,
    bloomRadius: finite,
    bloomThreshold: finite,
  }),
  effects: z.object({
    fog: z.object({
      density: finite,
      height: finite,
      anisotropy: finite,
      color: hexColor,
      // Pocket/altitude fields added after the height-fog era; all optional so older
      // files keep parsing (consumers default them via `?? ...`).
      shape: z.enum(["layer", "pocket"]).optional(),
      level: finite.optional(),
      pocketX: finite.optional(),
      pocketY: finite.optional(),
      pocketZ: finite.optional(),
      pocketRadius: finite.optional(),
      pocketEdge: finite.optional(),
    }),
    glow: z.object({ strength: finite, radius: finite, usePalette: z.boolean(), color: hexColor }),
    surface: z.object({
      iridescence: finite,
      filmShift: finite,
      rimStrength: finite,
      microScale: finite,
      microRoughness: finite,
    }),
    // Added after v5 shipped; defaulted (growth off) so older files keep parsing.
    growth: z
      .object({
        length: finite,
        density: finite,
        mode: z.enum(["spikes", "bumps", "crystals", "fins"]),
        sharpness: finite,
        coverage: finite,
        trapBias: finite,
        color: hexColor,
        colorBlend: finite,
        emission: finite,
      })
      .default(() => defaultEffects().growth),
    post: z.object({
      vignetteStrength: finite,
      vignetteSoftness: finite,
      grainStrength: finite,
      distortion: finite,
    }),
  }),
});

export const presetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  shape: shapeSchema,
  look: lookSchema,
});

const stamps = { createdAt: z.string(), updatedAt: z.string() };
export const userShapeSchema = shapeSchema.extend(stamps);
export const userLookSchema = lookSchema.extend(stamps);
export const userPresetSchema = presetSchema.extend(stamps);

/**
 * Bumped when any library item changes shape; the parser is the migration seam.
 * Version 4 is the ADR-0010 shape/look split - older monolithic files are rejected
 * (pre-release app, no installed base to migrate). Version 5 replaces the single
 * `light` object with `ambient` + a `lights` array; v4 files are migrated in place.
 * Version 6 records the post-v5 additions of `shape.warp` (geometry-altering) and
 * `effects.growth` (look-altering): both are optional/defaulted, so a v5 file imports as
 * "warp/growth absent, use defaults", while a current export carries version 6 so older
 * v5-era builds reject it (newer-version guard) instead of silently dropping those fields.
 * Version 7 replaces the palette's fixed baseA/baseB/accent with a required multi-stop ramp
 * (`stops` + interpolation/colorSpace); there is no migration, so pre-ramp files are rejected
 * (pre-release app, no installed base to preserve).
 * Rule: any schema-shape change bumps the version.
 */
export const LIBRARY_FILE_VERSION = 7;

/**
 * v4 → v5 look migration: the old single key light becomes lights[0] (directional),
 * with the positional-side fields at the same defaults `keyLight()` uses. Shared by
 * the file parser and the localStorage loader. Pass-through for anything else.
 */
export function migrateLookLightV4(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const look = raw as Record<string, unknown>;
  if (!("light" in look) || "lights" in look) return raw;
  const { light, ...rest } = look;
  const old = (typeof light === "object" && light !== null ? light : {}) as Record<string, unknown>;
  return {
    ...rest,
    ambient: old.ambient ?? 0,
    lights: [
      {
        type: "directional",
        enabled: true,
        color: old.color ?? "#ffffff",
        intensity: old.intensity ?? 1.5,
        size: old.size ?? 0.18,
        direction: old.direction ?? [0.48, 0.72, 0.42],
        position: [1.2, 1.2, 1.2],
        falloff: 1.5,
      },
    ],
  };
}

export type ParseLibraryResult =
  | { readonly ok: true; readonly kind: "shape"; readonly item: FractalShape }
  | { readonly ok: true; readonly kind: "look"; readonly item: Look }
  | { readonly ok: true; readonly kind: "preset"; readonly item: FractalPreset }
  | { readonly ok: false; readonly error: string };

/** Serialize one library item as a standalone, pretty-printed export file. */
export function buildLibraryFile(
  kind: LibraryKind,
  item: FractalShape | Look | FractalPreset,
): string {
  return JSON.stringify({ app: "kfractal", kind, version: LIBRARY_FILE_VERSION, item }, null, 2);
}

/**
 * Schema-known numerics are clamped against the formula registry rather than rejected
 * (curated shapes aren't range-checked either); unknown param keys are dropped and
 * missing ones take the registry default, so the result always drives the DE safely.
 */
export function clampShapeToRegistry(shape: FractalShape): FractalShape {
  const def = getFormula(shape.formula);
  const values: Record<string, number> = {};
  for (const param of def.params) {
    const raw = shape.formulaSettings.values[param.key] ?? param.defaultValue;
    values[param.key] = Math.min(param.max, Math.max(param.min, raw));
  }
  const iterations = Math.round(
    Math.min(def.iterations.max, Math.max(def.iterations.min, shape.formulaSettings.iterations)),
  );
  // The march budget is validated only as `finite` by the schema, so a crafted/corrupt file
  // could carry surfaceEpsilon: 0 (the DE never registers a hit, so the march runs every ray
  // to the step cap), a negative maxDistance, or maxSteps: 1e9 (a GPU/tab lockup). These never
  // reach a UI slider - they only arrive via import/localStorage - so this is their only guard.
  const r = shape.render;
  const render = {
    maxSteps: Math.round(clamp(r.maxSteps, 16, 2000)),
    maxDistance: clamp(r.maxDistance, 1, 1000),
    surfaceEpsilon: clamp(r.surfaceEpsilon, 1e-6, 0.1),
    normalEpsilon: clamp(r.normalEpsilon, 1e-6, 0.1),
  };
  const { warp: rawWarp, ...rest } = shape;
  const clamped: FractalShape = { ...rest, render, formulaSettings: { iterations, values } };
  if (rawWarp) {
    const warp = clampWarp(rawWarp);
    if (!isWarpOff(warp)) return { ...clamped, warp };
  }
  return clamped;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Bring an imported look into safe ranges, mirroring `clampShapeToRegistry` on the shape
 * side: an envId from a different set falls back to the default (ADR-0009); light, ambient,
 * sky, palette, material, lens, and effects numerics are clamped to the same ranges the UI
 * sliders enforce (kept in sync with LightingSection/MaterialSection/CameraLensSection/
 * EffectsSection/GrowthSection.vue); and a degenerate zero-length direction is replaced.
 * Without this a crafted/corrupt look file (intensity: -5, ambient: 1e9, direction: [0,0,0],
 * ior: 1e9, fog.density: 1e9, growth.length: 1e6 - which also perturbs the dive march) imports
 * "successfully" but renders black, locks up, or with absurd lighting. Periodic angles
 * (azimuth, yaw) are left alone - they wrap rather than break.
 */
export function clampLookToEnvironments(look: Look): Look {
  const envId = ENVIRONMENTS.some((env) => env.id === look.sky.envId)
    ? look.sky.envId
    : DEFAULT_SKY.envId;
  const lights = look.lights.map((light) => {
    const [sizeMin, sizeMax] = light.type === "directional" ? [0.02, 0.7] : [0.005, 0.5];
    const dirLen = Math.hypot(light.direction[0], light.direction[1], light.direction[2]);
    return {
      ...light,
      intensity: clamp(light.intensity, 0, 6),
      size: clamp(light.size, sizeMin!, sizeMax!),
      falloff: clamp(light.falloff, 0.05, 8),
      direction: (dirLen > 1e-6 ? light.direction : [0.48, 0.72, 0.42]) as [number, number, number],
    };
  });
  // Grade/palette, material, lens, and effects numerics are schema-validated only as `finite`;
  // a crafted file with exposure: 1e9, ior: 1e9, a negative bloom, or growth.length: 1e6 (which
  // also feeds dive.growthMargin and perturbs the collision march) imports cleanly and renders
  // an unusable image or locks the tab. These never reach a UI slider - they only arrive via
  // import/localStorage - so clamp each to the same range its slider enforces (kept in sync).
  const p = look.palette;
  const palette = {
    ...p,
    saturation: clamp(p.saturation, 0, 1.6),
    exposure: clamp(p.exposure, 0.35, 2.2),
    contrast: clamp(p.contrast, 0.6, 1.8),
    bloomStrength: clamp(p.bloomStrength, 0, 1.4),
    bloomRadius: clamp(p.bloomRadius, 0, 1),
    bloomThreshold: clamp(p.bloomThreshold, 0, 1.5),
  };
  const m = look.material;
  const material = {
    ...m,
    roughness: clamp(m.roughness, 0.02, 1),
    specular: clamp(m.specular, 0, 1),
    translucency: clamp(m.translucency, 0, 0.9),
    ior: clamp(m.ior, 1, 2.5),
    emissionStrength: clamp(m.emissionStrength, 0, 8),
  };
  const lens = {
    aperture: clamp(look.lens.aperture, 0, 0.14),
    chromaticAberration: clamp(look.lens.chromaticAberration, 0, 0.025),
  };
  const fx = look.effects;
  // Pocket/altitude fields are optional; clamp them in place only when present so an absent
  // field stays absent (exactOptionalPropertyTypes), rather than materializing as `undefined`.
  const fog = {
    ...fx.fog,
    density: clamp(fx.fog.density, 0, 0.15),
    height: clamp(fx.fog.height, 0.1, 6),
    anisotropy: clamp(fx.fog.anisotropy, -0.9, 0.9),
  };
  if (fog.level !== undefined) fog.level = clamp(fog.level, -4, 4);
  if (fog.pocketX !== undefined) fog.pocketX = clamp(fog.pocketX, -6, 6);
  if (fog.pocketY !== undefined) fog.pocketY = clamp(fog.pocketY, -6, 6);
  if (fog.pocketZ !== undefined) fog.pocketZ = clamp(fog.pocketZ, 0, 12);
  if (fog.pocketRadius !== undefined) fog.pocketRadius = clamp(fog.pocketRadius, 0.2, 10);
  if (fog.pocketEdge !== undefined) fog.pocketEdge = clamp(fog.pocketEdge, 0, 1);
  const effects = {
    fog,
    glow: {
      ...fx.glow,
      strength: clamp(fx.glow.strength, 0, 2),
      radius: clamp(fx.glow.radius, 0.02, 1),
    },
    surface: {
      ...fx.surface,
      iridescence: clamp(fx.surface.iridescence, 0, 1),
      filmShift: clamp(fx.surface.filmShift, 0, 1),
      rimStrength: clamp(fx.surface.rimStrength, 0, 2),
      microScale: clamp(fx.surface.microScale, 1, 60),
      microRoughness: clamp(fx.surface.microRoughness, 0, 1),
    },
    growth: {
      ...fx.growth,
      length: clamp(fx.growth.length, 0, 0.15),
      density: clamp(fx.growth.density, 5, 150),
      sharpness: clamp(fx.growth.sharpness, 0.5, 8),
      coverage: clamp(fx.growth.coverage, 0, 1),
      trapBias: clamp(fx.growth.trapBias, -1, 1),
      colorBlend: clamp(fx.growth.colorBlend, 0, 1),
      emission: clamp(fx.growth.emission, 0, 4),
    },
    post: {
      ...fx.post,
      vignetteStrength: clamp(fx.post.vignetteStrength, 0, 1),
      vignetteSoftness: clamp(fx.post.vignetteSoftness, 0.05, 1),
      grainStrength: clamp(fx.post.grainStrength, 0, 0.25),
      distortion: clamp(fx.post.distortion, -1, 1),
    },
  };
  return {
    ...look,
    ambient: clamp(look.ambient, 0, 0.02),
    lights,
    palette,
    material,
    lens,
    effects,
    sky: {
      ...look.sky,
      envId,
      intensity: clamp(look.sky.intensity, 0, 3),
      sunElevation: clamp(look.sky.sunElevation, 2, 89),
      turbidity: clamp(look.sky.turbidity, 2, 10),
      sunSize: clamp(look.sky.sunSize, 0.01, 0.25),
    },
  };
}

const KIND_SCHEMAS = {
  shape: shapeSchema,
  look: lookSchema,
  preset: presetSchema,
} as const;

function isLibraryKind(kind: unknown): kind is LibraryKind {
  return kind === "shape" || kind === "look" || kind === "preset";
}

/** Parse + validate an exported library file. Never throws; errors are user-facing text. */
export function parseLibraryFile(text: string): ParseLibraryResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not valid JSON." };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "Not a KFractal library file." };
  }
  const envelope = raw as { app?: unknown; kind?: unknown; version?: unknown; item?: unknown };
  if (envelope.app !== "kfractal" || !isLibraryKind(envelope.kind)) {
    return { ok: false, error: "Not a KFractal shape, look, or preset file." };
  }
  if (typeof envelope.version !== "number" || envelope.version > LIBRARY_FILE_VERSION) {
    return { ok: false, error: "This file was exported by a newer KFractal version." };
  }
  if (envelope.version < 4) {
    return { ok: false, error: "This file predates the shape/look split and can't be imported." };
  }
  const kind = envelope.kind;
  let item = envelope.item;
  if (envelope.version === 4) {
    if (kind === "look") {
      item = migrateLookLightV4(item);
    } else if (kind === "preset" && typeof item === "object" && item !== null) {
      const preset = item as Record<string, unknown>;
      item = { ...preset, look: migrateLookLightV4(preset.look) };
    }
  }
  const parsed = KIND_SCHEMAS[kind].safeParse(item);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || kind;
    return { ok: false, error: `Invalid ${kind}: ${path} - ${issue?.message ?? "unknown error"}` };
  }
  if (kind === "shape") {
    return { ok: true, kind, item: clampShapeToRegistry(parsed.data as FractalShape) };
  }
  if (kind === "look") {
    return { ok: true, kind, item: clampLookToEnvironments(parsed.data as Look) };
  }
  const preset = parsed.data as FractalPreset;
  return {
    ok: true,
    kind,
    item: {
      ...preset,
      shape: clampShapeToRegistry(preset.shape),
      look: clampLookToEnvironments(preset.look),
    },
  };
}

/** Filename- and id-safe slug; never empty. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "preset";
}

/** Returns `name`, or the first free `name (2)`, `name (3)`, … */
export function uniquifyName(name: string, takenNames: ReadonlySet<string>): string {
  if (!takenNames.has(name)) return name;
  for (let n = 2; ; n += 1) {
    const candidate = `${name} (${n})`;
    if (!takenNames.has(candidate)) return candidate;
  }
}

/** `user-<slug>` ids can never collide with curated kebab-case ids. */
export function makeUserItemId(name: string, takenIds: ReadonlySet<string>): string {
  const base = `user-${slugify(name)}`;
  if (!takenIds.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!takenIds.has(candidate)) return candidate;
  }
}

import { reactive } from "vue";
import {
  AUTO_QUALITY_KEY,
  CONTROL_SENSITIVITY_DEFAULT,
  CONTROL_SENSITIVITY_KEY,
  CONTROL_SENSITIVITY_MAX,
  CONTROL_SENSITIVITY_MIN,
  SAMPLE_CAP,
} from "../config/constants";
import { EnvironmentManager } from "../render/environment";
import type { RenderEngine } from "../render/engine";
import { ENVIRONMENTS } from "./environments";
import { LOOKS } from "./looks";
import { PRESETS } from "./presets";
import { getFormula } from "./registry";
import { SHAPES } from "./shapes";
import { loadUserLibrary } from "./user-library";
import { autoQualityDefault } from "../render/preview-quality";
import { defaultWarp, isWarpOff } from "./warp";
import type {
  EffectsSettings,
  FractalPreset,
  FractalShape,
  LightSource,
  Look,
  SkySettings,
  WarpSettings,
} from "./types";
import type { WorkstationState } from "../ui/controller";

/** Read the persisted control sensitivity, clamped to range; default on missing/garbage. */
function loadControlSensitivity(): number {
  if (typeof localStorage === "undefined") return CONTROL_SENSITIVITY_DEFAULT;
  const raw = Number(localStorage.getItem(CONTROL_SENSITIVITY_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return CONTROL_SENSITIVITY_DEFAULT;
  return Math.min(CONTROL_SENSITIVITY_MAX, Math.max(CONTROL_SENSITIVITY_MIN, raw));
}

/** Read the persisted auto-quality choice; falls back to the per-device default (on for touch). */
function loadAutoQuality(): boolean {
  if (typeof localStorage === "undefined") return autoQualityDefault();
  const raw = localStorage.getItem(AUTO_QUALITY_KEY);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return autoQualityDefault();
}

/** Deep copy so the live (mutable) state never aliases a stored look's tuples. */
function copyLights(lights: readonly LightSource[]): LightSource[] {
  return lights.map((l) => ({
    ...l,
    direction: [...l.direction] as [number, number, number],
    position: [...l.position] as [number, number, number],
  }));
}

/**
 * Session-stable ids for palette ramp stops (UI-only, never serialized). A monotonic counter
 * is enough: ids only need to stay distinct within one editing session so the editor list keys
 * survive add/remove/reorder. Shared with the controller's `addPaletteStop`.
 */
let stopIdSeq = 0;
export function nextPaletteStopId(): string {
  stopIdSeq += 1;
  return `stop-${stopIdSeq}`;
}

/**
 * Build the flat, reactive UI state (ADR-0006) from a preset's two nested halves plus the
 * persisted user library. This is the canonical store the controller setters write to and the
 * snapshot helpers read back from.
 */
export function createWorkstationState(
  preset: FractalPreset,
  width: number,
  height: number,
): WorkstationState {
  const { shape, look } = preset;
  const library = loadUserLibrary();
  return reactive({
    presets: PRESETS,
    shapes: SHAPES,
    looks: LOOKS,
    userPresets: library.presets,
    userShapes: library.shapes,
    userLooks: library.looks,
    selectedPresetId: preset.id,
    selectedShapeId: shape.id,
    selectedLookId: look.id,
    fps: 0,
    sampleCount: 0,
    rendering: false,
    denoise: true,
    diveEnabled: true,
    controlSensitivity: loadControlSensitivity(),
    autoQuality: loadAutoQuality(),
    previewScale: 1,
    formulaName: "",
    formulaId: shape.formula,
    formulaParams: [],
    iterations: shape.formulaSettings.iterations,
    iterationsMin: 4,
    iterationsMax: 24,
    roughness: look.material.roughness,
    specular: look.material.specular,
    translucency: look.material.translucency,
    ior: look.material.ior,
    emissionStrength: look.material.emissionStrength,
    lights: copyLights(look.lights),
    ambient: look.ambient,
    environments: ENVIRONMENTS.map((env) => ({ id: env.id, name: env.name })),
    skyMode: look.sky.mode,
    envIntensity: look.sky.intensity,
    sunElevation: look.sky.sunElevation,
    sunAzimuth: look.sky.sunAzimuth,
    turbidity: look.sky.turbidity,
    sunSize: look.sky.sunSize,
    envId: look.sky.envId,
    envYaw: look.sky.yaw,
    aperture: look.lens.aperture,
    focusDistance: shape.focusDistance,
    chromaticAberration: look.lens.chromaticAberration,
    exposure: look.palette.exposure,
    contrast: look.palette.contrast,
    bloomStrength: look.palette.bloomStrength,
    bloomRadius: look.palette.bloomRadius,
    bloomThreshold: look.palette.bloomThreshold,
    saturation: look.palette.saturation,
    fogDensity: look.effects.fog.density,
    fogHeight: look.effects.fog.height,
    fogAnisotropy: look.effects.fog.anisotropy,
    glowStrength: look.effects.glow.strength,
    glowRadius: look.effects.glow.radius,
    glowUsePalette: look.effects.glow.usePalette,
    iridescence: look.effects.surface.iridescence,
    filmShift: look.effects.surface.filmShift,
    rimStrength: look.effects.surface.rimStrength,
    microNoiseScale: look.effects.surface.microScale,
    microNoiseRoughness: look.effects.surface.microRoughness,
    growthLength: look.effects.growth.length,
    growthDensity: look.effects.growth.density,
    growthMode: look.effects.growth.mode,
    growthSharpness: look.effects.growth.sharpness,
    growthCoverage: look.effects.growth.coverage,
    growthTrapBias: look.effects.growth.trapBias,
    growthColorBlend: look.effects.growth.colorBlend,
    growthEmission: look.effects.growth.emission,
    vignetteStrength: look.effects.post.vignetteStrength,
    vignetteSoftness: look.effects.post.vignetteSoftness,
    grainStrength: look.effects.post.grainStrength,
    lensDistortion: look.effects.post.distortion,
    emissionColor: look.material.emissionColor,
    fogColor: look.effects.fog.color,
    glowColor: look.effects.glow.color,
    growthColor: look.effects.growth.color,
    paletteStops: look.palette.stops.map((s) => ({
      id: nextPaletteStopId(),
      position: s.position,
      color: s.color,
    })),
    paletteInterpolation: look.palette.interpolation,
    paletteColorSpace: look.palette.colorSpace,
    trapScale: shape.trap.scale,
    trapPower: shape.trap.power,
    warpTwist: (shape.warp ?? defaultWarp()).twist,
    warpTwistAxis: (shape.warp ?? defaultWarp()).twistAxis,
    warpBend: (shape.warp ?? defaultWarp()).bend,
    warpBendAxis: (shape.warp ?? defaultWarp()).bendAxis,
    warpRippleAmp: (shape.warp ?? defaultWarp()).rippleAmp,
    warpRippleFreq: (shape.warp ?? defaultWarp()).rippleFreq,
    warpRippleAxis: (shape.warp ?? defaultWarp()).rippleAxis,
    warpNoiseAmp: (shape.warp ?? defaultWarp()).noiseAmp,
    warpNoiseFreq: (shape.warp ?? defaultWarp()).noiseFreq,
    cameraFov: shape.camera.fov,
    resolutionWidth: width,
    resolutionHeight: height,
    sampleCap: SAMPLE_CAP,
  });
}

/**
 * Translates between the flat reactive UI state and the nested domain halves (ADR-0010): it
 * applies stored shapes/looks/presets onto the engine and `state`, repacks the live `state`
 * back into `SkySettings`/`EffectsSettings`/`WarpSettings`, and snapshots the live state into
 * library items. The geometry half lives on the engine (`engine.shape`); the art-direction
 * half is held here.
 */
export interface StateBridge {
  /** Apply a stored preset (both halves) by id; no-ops with a warning on an unknown id. */
  readonly applyPreset: (id: string) => void;
  /** Swap just the geometry half by id; the art-direction half stays live. */
  readonly applyShapeById: (id: string) => void;
  /** Swap just the art-direction half by id; the geometry half stays live. */
  readonly applyLookById: (id: string) => void;
  /** Apply a geometry half value directly (used by the shape generator/mutator). */
  readonly applyShape: (next: FractalShape) => void;
  readonly snapshotShape: (id: string, name: string, description: string) => FractalShape;
  readonly snapshotLook: (id: string, name: string, description: string) => Look;
  readonly snapshotPreset: (id: string, name: string, description: string) => FractalPreset;
  /** Repack the live sky-related UI state into the nested SkySettings shape. */
  readonly liveSky: () => SkySettings;
  /** Repack the live effects UI state into the nested EffectsSettings shape. */
  readonly liveEffects: () => EffectsSettings;
  /** Repack the live warp UI state into the nested WarpSettings shape. */
  readonly liveWarp: () => WarpSettings;
  /** Mirror the warp onto the dive's f64 CPU surface (null = identity). */
  readonly syncDiveWarp: (warp: WarpSettings) => void;
  /** Generate (or fetch the cached) environment map for an id and apply it when still current. */
  readonly ensureEnvironment: (id: string) => void;
}

export function createStateBridge(deps: {
  engine: RenderEngine;
  state: WorkstationState;
  initialLook: Look;
}): StateBridge {
  const { engine, state } = deps;
  const { stage, fractal, dive, post } = engine;
  const resetAccumulation = (): void => engine.resetAccumulation();
  // The art-direction half (ADR-0010). The geometry half lives on the engine; this one is only
  // ever read right after being applied, but we hold it for parity with the engine's `shape`.
  let look: Look = deps.initialLook;

  const findPreset = (id: string): FractalPreset | undefined =>
    PRESETS.find((item) => item.id === id) ?? state.userPresets.find((item) => item.id === id);
  const findShape = (id: string): FractalShape | undefined =>
    SHAPES.find((item) => item.id === id) ?? state.userShapes.find((item) => item.id === id);
  const findLook = (id: string): Look | undefined =>
    LOOKS.find((item) => item.id === id) ?? state.userLooks.find((item) => item.id === id);

  // Environment lighting (ADR-0009). The sky uniforms apply synchronously; environment maps
  // are generated on demand (rasterize + alias-table build, cached per id) and reset the
  // accumulation when applied so a render never mixes two environments.
  const environments = new EnvironmentManager();
  const liveSky = (): SkySettings => ({
    mode: state.skyMode,
    intensity: state.envIntensity,
    sunElevation: state.sunElevation,
    sunAzimuth: state.sunAzimuth,
    turbidity: state.turbidity,
    sunSize: state.sunSize,
    envId: state.envId,
    yaw: state.envYaw,
  });
  // The single repack seam between flat UI state and the nested effects shape; the
  // controller setters and snapshotPreset both go through it.
  const liveEffects = (): EffectsSettings => ({
    fog: {
      density: state.fogDensity,
      height: state.fogHeight,
      anisotropy: state.fogAnisotropy,
      color: state.fogColor,
    },
    glow: {
      strength: state.glowStrength,
      radius: state.glowRadius,
      usePalette: state.glowUsePalette,
      color: state.glowColor,
    },
    surface: {
      iridescence: state.iridescence,
      filmShift: state.filmShift,
      rimStrength: state.rimStrength,
      microScale: state.microNoiseScale,
      microRoughness: state.microNoiseRoughness,
    },
    growth: {
      length: state.growthLength,
      density: state.growthDensity,
      mode: state.growthMode,
      sharpness: state.growthSharpness,
      coverage: state.growthCoverage,
      trapBias: state.growthTrapBias,
      color: state.growthColor,
      colorBlend: state.growthColorBlend,
      emission: state.growthEmission,
    },
    post: {
      vignetteStrength: state.vignetteStrength,
      vignetteSoftness: state.vignetteSoftness,
      grainStrength: state.grainStrength,
      distortion: state.lensDistortion,
    },
  });
  // Same repack seam as liveEffects, for the shape-side warp (ADR-0012).
  const liveWarp = (): WarpSettings => ({
    twist: state.warpTwist,
    twistAxis: state.warpTwistAxis,
    bend: state.warpBend,
    bendAxis: state.warpBendAxis,
    rippleAmp: state.warpRippleAmp,
    rippleFreq: state.warpRippleFreq,
    rippleAxis: state.warpRippleAxis,
    noiseAmp: state.warpNoiseAmp,
    noiseFreq: state.warpNoiseFreq,
  });
  // The dive's f64 CPU mirror must march the same surface the GPU renders; null = identity.
  const syncDiveWarp = (warp: WarpSettings): void => {
    dive.warp = isWarpOff(warp) ? null : warp;
  };
  const ensureEnvironment = (id: string): void => {
    environments
      .load(id)
      .then((data) => {
        // Stale guard: the user may have switched again while this one decoded.
        if (state.envId !== id || state.skyMode !== "envmap") return;
        fractal.setEnvironmentData(data);
        resetAccumulation();
      })
      .catch((error: unknown) => {
        console.warn(`KFractal: failed to load environment "${id}".`, error);
      });
  };

  // Apply the geometry half: camera framing, formula pipeline, march quality, focus, trap.
  const applyShape = (next: FractalShape): void => {
    engine.setShape(next);
    const shape = next;
    const def = getFormula(shape.formula);
    stage.applyPreset(shape.camera);
    // The saved pose only means something inside the dive frame it was captured in.
    dive.restore(shape.dive);
    fractal.applyShape(shape);
    state.formulaName = def.name;
    state.formulaId = shape.formula;
    state.formulaParams = def.params.map((param) => ({
      key: param.key,
      label: param.label,
      description: param.description,
      min: param.min,
      max: param.max,
      step: param.step,
      value: shape.formulaSettings.values[param.key] ?? param.defaultValue,
    }));
    state.iterations = shape.formulaSettings.iterations;
    state.iterationsMin = def.iterations.min;
    state.iterationsMax = def.iterations.max;
    state.focusDistance = shape.focusDistance;
    state.trapScale = shape.trap.scale;
    state.trapPower = shape.trap.power;
    const warp = shape.warp ?? defaultWarp();
    state.warpTwist = warp.twist;
    state.warpTwistAxis = warp.twistAxis;
    state.warpBend = warp.bend;
    state.warpBendAxis = warp.bendAxis;
    state.warpRippleAmp = warp.rippleAmp;
    state.warpRippleFreq = warp.rippleFreq;
    state.warpRippleAxis = warp.rippleAxis;
    state.warpNoiseAmp = warp.noiseAmp;
    state.warpNoiseFreq = warp.noiseFreq;
    syncDiveWarp(warp);
    state.cameraFov = shape.camera.fov;
  };

  // Apply the art-direction half: never touches the camera, dive state, or pipeline.
  const applyLook = (next: Look): void => {
    look = next;
    fractal.applyLook(look);
    post.applyLook(look);
    state.roughness = look.material.roughness;
    state.specular = look.material.specular;
    state.translucency = look.material.translucency;
    state.ior = look.material.ior;
    state.emissionStrength = look.material.emissionStrength;
    state.lights = copyLights(look.lights);
    state.ambient = look.ambient;
    state.skyMode = look.sky.mode;
    state.envIntensity = look.sky.intensity;
    state.sunElevation = look.sky.sunElevation;
    state.sunAzimuth = look.sky.sunAzimuth;
    state.turbidity = look.sky.turbidity;
    state.sunSize = look.sky.sunSize;
    state.envId = look.sky.envId;
    state.envYaw = look.sky.yaw;
    if (look.sky.mode === "envmap") ensureEnvironment(look.sky.envId);
    state.aperture = look.lens.aperture;
    state.chromaticAberration = look.lens.chromaticAberration;
    state.exposure = look.palette.exposure;
    state.contrast = look.palette.contrast;
    state.bloomStrength = look.palette.bloomStrength;
    state.bloomRadius = look.palette.bloomRadius;
    state.bloomThreshold = look.palette.bloomThreshold;
    state.saturation = look.palette.saturation;
    state.emissionColor = look.material.emissionColor;
    state.paletteStops = look.palette.stops.map((s) => ({
      id: nextPaletteStopId(),
      position: s.position,
      color: s.color,
    }));
    state.paletteInterpolation = look.palette.interpolation;
    state.paletteColorSpace = look.palette.colorSpace;
    const fx = look.effects;
    state.fogDensity = fx.fog.density;
    state.fogHeight = fx.fog.height;
    state.fogAnisotropy = fx.fog.anisotropy;
    state.fogColor = fx.fog.color;
    state.glowStrength = fx.glow.strength;
    state.glowRadius = fx.glow.radius;
    state.glowUsePalette = fx.glow.usePalette;
    state.glowColor = fx.glow.color;
    state.iridescence = fx.surface.iridescence;
    state.filmShift = fx.surface.filmShift;
    state.rimStrength = fx.surface.rimStrength;
    state.microNoiseScale = fx.surface.microScale;
    state.microNoiseRoughness = fx.surface.microRoughness;
    state.growthLength = fx.growth.length;
    state.growthDensity = fx.growth.density;
    state.growthMode = fx.growth.mode;
    state.growthSharpness = fx.growth.sharpness;
    state.growthCoverage = fx.growth.coverage;
    state.growthTrapBias = fx.growth.trapBias;
    state.growthColor = fx.growth.color;
    state.growthColorBlend = fx.growth.colorBlend;
    state.growthEmission = fx.growth.emission;
    // Growth protrudes past the formula's own DE; the dive's surface-pin march must respect it.
    dive.growthMargin = fx.growth.length;
    state.vignetteStrength = fx.post.vignetteStrength;
    state.vignetteSoftness = fx.post.vignetteSoftness;
    state.grainStrength = fx.post.grainStrength;
    state.lensDistortion = fx.post.distortion;
  };

  const applyPreset = (nextPresetId: string): void => {
    const next = findPreset(nextPresetId);
    if (!next) {
      // A stale id (e.g. a deleted user preset) must not crash; keep the live view.
      console.warn(`KFractal: unknown preset id "${nextPresetId}".`);
      return;
    }
    applyShape(next.shape);
    applyLook(next.look);
    state.selectedPresetId = next.id;
    // A preset's embedded halves can carry ids that resolve in no library: a half saved
    // while "Custom" is stored under the preset's own id, and imported presets carry the
    // exporter's ids. Only hold the axis selection when its id resolves; otherwise clear to
    // the "Custom" sentinel ("") so the picker, Update target, and export naming stay sane.
    state.selectedShapeId = findShape(next.shape.id) ? next.shape.id : "";
    state.selectedLookId = findLook(next.look.id) ? next.look.id : "";
    resetAccumulation();
  };

  // Swapping one axis keeps the other live; the pairing selection no longer holds.
  const applyShapeById = (id: string): void => {
    const next = findShape(id);
    if (!next) {
      console.warn(`KFractal: unknown shape id "${id}".`);
      return;
    }
    applyShape(next);
    state.selectedShapeId = next.id;
    state.selectedPresetId = "";
    resetAccumulation();
  };

  const applyLookById = (id: string): void => {
    const next = findLook(id);
    if (!next) {
      console.warn(`KFractal: unknown look id "${id}".`);
      return;
    }
    applyLook(next);
    state.selectedLookId = next.id;
    state.selectedPresetId = "";
    resetAccumulation();
  };

  // Live state as library items (ADR-0007/0010). Camera pose comes from the stage;
  // render quality and light direction are not user-editable, so the last-applied
  // halves hold their exact values; everything else reads the canonical copies in `state`.
  const snapshotShape = (id: string, name: string, description: string): FractalShape => {
    const shape = engine.shape;
    const diveFrame = dive.frame();
    const warp = liveWarp();
    return {
      id,
      name,
      description,
      formula: shape.formula,
      formulaSettings: {
        iterations: state.iterations,
        values: Object.fromEntries(state.formulaParams.map((param) => [param.key, param.value])),
      },
      camera: {
        target: stage.target.toArray() as [number, number, number],
        yaw: stage.yaw,
        pitch: stage.pitch,
        roll: stage.roll,
        distance: stage.distance,
        fov: state.cameraFov,
      },
      focusDistance: state.focusDistance,
      render: { ...shape.render },
      trap: { scale: state.trapScale, power: state.trapPower },
      ...(isWarpOff(warp) ? {} : { warp }),
      ...(diveFrame ? { dive: diveFrame } : {}),
    };
  };

  const snapshotLook = (id: string, name: string, description: string): Look => ({
    id,
    name,
    description,
    lens: {
      aperture: state.aperture,
      chromaticAberration: state.chromaticAberration,
    },
    ambient: state.ambient,
    lights: copyLights(state.lights),
    sky: liveSky(),
    material: {
      roughness: state.roughness,
      specular: state.specular,
      translucency: state.translucency,
      ior: state.ior,
      emissionStrength: state.emissionStrength,
      emissionColor: state.emissionColor,
    },
    palette: {
      stops: state.paletteStops.map((s) => ({ position: s.position, color: s.color })),
      interpolation: state.paletteInterpolation,
      colorSpace: state.paletteColorSpace,
      saturation: state.saturation,
      exposure: state.exposure,
      contrast: state.contrast,
      bloomStrength: state.bloomStrength,
      bloomRadius: state.bloomRadius,
      bloomThreshold: state.bloomThreshold,
    },
    effects: liveEffects(),
  });

  // The embedded halves are value snapshots, but they keep the *identity* of the shape
  // and look still selected on each axis - so reloading the pairing re-selects the
  // library entries it was built from instead of falling back to "Custom". A cleared
  // axis (truly custom) falls back to the pairing's own identity.
  const snapshotPreset = (id: string, name: string, description: string): FractalPreset => {
    const shapeOrigin = findShape(state.selectedShapeId);
    const lookOrigin = findLook(state.selectedLookId);
    return {
      id,
      name,
      description,
      shape: snapshotShape(
        shapeOrigin?.id ?? id,
        shapeOrigin?.name ?? name,
        shapeOrigin?.description ?? description,
      ),
      look: snapshotLook(
        lookOrigin?.id ?? id,
        lookOrigin?.name ?? name,
        lookOrigin?.description ?? description,
      ),
    };
  };

  return {
    applyPreset,
    applyShapeById,
    applyLookById,
    applyShape,
    snapshotShape,
    snapshotLook,
    snapshotPreset,
    liveSky,
    liveEffects,
    liveWarp,
    syncDiveWarp,
    ensureEnvironment,
  };
}

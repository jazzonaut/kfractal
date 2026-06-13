import * as THREE from "three/webgpu";
import { reactive } from "vue";
import { PRESETS } from "./fractal/presets";
import { SHAPES } from "./fractal/shapes";
import { LOOKS, defaultNewLight } from "./fractal/looks";
import {
  buildLibraryFile,
  makeUserItemId,
  parseLibraryFile,
  slugify,
  uniquifyName,
} from "./fractal/library-codec";
import { getCpuDe } from "./fractal/cpu-de";
import { getFormula } from "./fractal/registry";
import { defaultWarp, isWarpOff, warpCpuDe, warpStepBoost } from "./fractal/warp";
import { mutateFormulaSettings, rollShape } from "./fractal/shape-generator";
import { loadUserLibrary, saveUserLibrary } from "./fractal/user-library";
import { ENVIRONMENTS } from "./fractal/environments";
import { downloadTextFile } from "./core/download";
import { startLoop } from "./core/loop";
import { AccumulationBuffer } from "./render/accumulation";
import { CameraControls } from "./render/camera-controls";
import { AtrousDenoiser } from "./render/denoise";
import { DiveController } from "./render/dive";
import { EnvironmentManager } from "./render/environment";
import {
  FractalPass,
  MODE_FEATURE_ALBEDO,
  MODE_FEATURE_ND,
  MODE_PATHTRACE,
  MODE_PREVIEW,
} from "./render/fractal-pass";
import { PostChain } from "./render/post";
import { createRenderer } from "./render/renderer";
import { Stage } from "./render/stage";
import { mountUi } from "./ui/mount-ui";
import { FPS_INTERVAL, SAMPLE_CAP } from "./config/constants";
import type { Controller, LibraryActionResult, WorkstationState } from "./ui/controller";
import { MAX_LIGHTS } from "./fractal/types";
import type {
  AuthoringStamps,
  EffectsSettings,
  FractalPreset,
  FractalShape,
  LibraryKind,
  LightSource,
  Look,
  SkySettings,
  WarpSettings,
} from "./fractal/types";
import "./styles.css";

/** Deep copy so the live (mutable) state never aliases a stored look's tuples. */
function copyLights(lights: readonly LightSource[]): LightSource[] {
  return lights.map((l) => ({
    ...l,
    direction: [...l.direction] as [number, number, number],
    position: [...l.position] as [number, number, number],
  }));
}

function makeSampleTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(width, height, {
    type: THREE.FloatType,
    depthBuffer: false,
  });
}

/** Update the status line on the boot loading screen (#loading), if still present. */
function setLoadingStatus(message: string): void {
  const status = document.getElementById("loading-status");
  if (status) status.textContent = message;
}

/** Fade out and remove the boot loading screen. Safe to call more than once. */
function hideLoading(): void {
  const el = document.getElementById("loading");
  if (!el) return;
  el.classList.add("hide");
  // Drop it from the tree once the fade completes so it never traps pointer events.
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  // Fallback for prefers-reduced-motion (no transition fires) or a missed event.
  window.setTimeout(() => el.remove(), 600);
}

/** Show the full-screen fatal banner (reuses #unsupported) with a custom message. */
function showFatal(message: string): void {
  // The fatal banner sits below the loader; drop the loader so the message is visible.
  hideLoading();
  const el = document.getElementById("unsupported");
  if (!el) return;
  const inner = el.querySelector("div");
  if (inner) inner.textContent = message;
  el.classList.add("show");
}

async function main(): Promise<void> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    showFatal(
      "KFractal needs a WebGPU-capable browser. Use a recent desktop Chrome or Edge build.",
    );
    return;
  }

  const container = document.getElementById("app");
  if (!container) return;

  const initialPreset = PRESETS[0];
  if (!initialPreset) throw new Error("KFractal needs at least one preset.");
  // The two live halves (ADR-0010): geometry and art direction, applied independently.
  let shape: FractalShape = initialPreset.shape;
  let look: Look = initialPreset.look;

  let renderer: THREE.WebGPURenderer;
  try {
    renderer = await createRenderer(container, (info) => {
      showFatal(
        `The graphics device was lost${info.message ? ` (${info.message})` : ""}. Reload the page to continue.`,
      );
    });
  } catch (error) {
    showFatal(
      `KFractal could not start the WebGPU renderer: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
    return;
  }
  setLoadingStatus("Compiling shaders…");
  const stage = new Stage();
  const fractal = new FractalPass(shape.formula);
  const controls = new CameraControls(renderer.domElement, stage);
  const dive = new DiveController();

  // Space reserved for docked UI (inspector, status bar); the canvas gets the rest.
  let viewportRightInset = 0;
  let viewportBottomInset = 0;
  let width = window.innerWidth;
  let height = window.innerHeight;
  const sampleRT = makeSampleTarget(width, height);
  const accumulation = new AccumulationBuffer(width, height, sampleRT.texture);
  const denoiser = new AtrousDenoiser(width, height);
  const post = new PostChain(renderer, accumulation.texture);

  // Accumulation state, owned by the loop (ADR-0003, amended: render is explicit).
  let sampleIndex = 0;
  // Denoised-frame cache: the à-trous chain (4 full-res passes + bloom) only needs to re-run
  // when the accumulated mean or the denoise toggle changes. Re-presents driven by animated
  // grain or post-side tweaks at a converged frame reuse the cached output and just re-grade.
  let denoiseCacheSample = -1;
  let denoiseCacheTex: THREE.Texture | undefined;
  let fpsElapsed = 0;
  let fpsFrames = 0;
  // True while exporting a still at an off-screen resolution: freezes the live update loop
  // so the pinned camera/dive state and resized buffers are not disturbed mid-capture.
  let exporting = false;
  // Set by `cancelExport` to abort an in-flight export run; the poll loop bails and the
  // `finally` restores the live pipeline, skipping the download.
  let exportCancelled = false;
  // Presentation gating: GPU work runs only when something visible changed, instead of
  // re-marching and re-grading an unchanged image at vsync forever. sceneDirty means the
  // fractal must re-march (camera/shape/look/size moved); presentDirty means only the
  // post/denoise side changed and the existing buffer just needs re-presenting.
  let sceneDirty = true;
  let presentDirty = true;

  // Resize the whole render pipeline (canvas buffer + every target + camera aspect) in one
  // place, shared by the window resize handler and the still exporter. `updateStyle` is false
  // during export so the on-screen canvas box stays put while only its backing buffer grows.
  const resizeTargets = (w: number, h: number, updateStyle = true): void => {
    renderer.setSize(w, h, updateStyle);
    stage.resize(w, h);
    fractal.resize(w, h);
    sampleRT.setSize(w, h);
    accumulation.resize(w, h);
    denoiser.resize(w, h);
    sceneDirty = true;
  };

  // Any change drops back to the live preview and discards the render in progress.
  const resetAccumulation = (): void => {
    sampleIndex = 0;
    state.sampleCount = 0;
    state.rendering = false;
    sceneDirty = true;
    // A new run reuses sampleIndex 0, so a stale cache key would mask the fresh mean.
    denoiseCacheSample = -1;
  };

  // Size the live pipeline to the window minus the reserved inset (docked UI).
  const resizeLiveViewport = (): void => {
    // Ignore live resizes while an export owns the pipeline; it restores the buffers itself.
    if (exporting) return;
    width = Math.max(1, window.innerWidth - viewportRightInset);
    height = Math.max(1, window.innerHeight - viewportBottomInset);
    state.resolutionWidth = width;
    state.resolutionHeight = height;
    resizeTargets(width, height);
    resetAccumulation();
  };

  // Resize storms (window-edge drags, UI inset animations) fire roughly per frame, and each
  // resizeLiveViewport disposes and reallocates ~7 full-res float32 targets (~230 MB at
  // 1080p). Accumulation resets on every resize anyway, so intermediate sizes are pure waste:
  // coalesce to the trailing edge so only the final size pays the reallocation.
  let resizeTimer = 0;
  const scheduleResize = (): void => {
    if (resizeTimer !== 0) clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeTimer = 0;
      resizeLiveViewport();
    }, 150);
  };

  const library = loadUserLibrary();
  const state: WorkstationState = reactive({
    presets: PRESETS,
    shapes: SHAPES,
    looks: LOOKS,
    userPresets: library.presets,
    userShapes: library.shapes,
    userLooks: library.looks,
    selectedPresetId: initialPreset.id,
    selectedShapeId: shape.id,
    selectedLookId: look.id,
    fps: 0,
    sampleCount: 0,
    rendering: false,
    denoise: true,
    diveAssist: false,
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
    paletteBaseA: look.palette.baseA,
    paletteBaseB: look.palette.baseB,
    paletteAccent: look.palette.accent,
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
    shape = next;
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
    state.paletteBaseA = look.palette.baseA;
    state.paletteBaseB = look.palette.baseB;
    state.paletteAccent = look.palette.accent;
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
    // Growth protrudes past the formula's own DE; the dive steering must respect it.
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
      baseA: state.paletteBaseA,
      baseB: state.paletteBaseB,
      accent: state.paletteAccent,
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

  // One generic authoring surface over the three library kinds (ADR-0010).
  type LibraryItem = FractalShape | Look | FractalPreset;
  type UserItem = LibraryItem & AuthoringStamps;
  interface KindOps {
    readonly label: string;
    readonly curated: readonly LibraryItem[];
    readonly list: () => UserItem[];
    readonly snapshot: (id: string, name: string, description: string) => LibraryItem;
    readonly select: (id: string) => void;
    readonly selectedId: () => string;
    readonly apply: (id: string) => void;
  }
  const KIND_OPS: Record<LibraryKind, KindOps> = {
    shape: {
      label: "Shape",
      curated: SHAPES,
      list: () => state.userShapes,
      snapshot: snapshotShape,
      select: (id) => {
        state.selectedShapeId = id;
      },
      selectedId: () => state.selectedShapeId,
      apply: (id) => applyShapeById(id),
    },
    look: {
      label: "Look",
      curated: LOOKS,
      list: () => state.userLooks,
      snapshot: snapshotLook,
      select: (id) => {
        state.selectedLookId = id;
      },
      selectedId: () => state.selectedLookId,
      apply: (id) => applyLookById(id),
    },
    preset: {
      label: "Preset",
      curated: PRESETS,
      list: () => state.userPresets,
      snapshot: snapshotPreset,
      select: (id) => {
        state.selectedPresetId = id;
      },
      selectedId: () => state.selectedPresetId,
      apply: (id) => applyPreset(id),
    },
  };

  const takenNames = (kind: LibraryKind): Set<string> =>
    new Set([...KIND_OPS[kind].curated, ...KIND_OPS[kind].list()].map((item) => item.name));
  const takenIds = (kind: LibraryKind): Set<string> =>
    new Set([...KIND_OPS[kind].curated, ...KIND_OPS[kind].list()].map((item) => item.id));

  // The single push seam for every light edit: re-sync the uniforms and restart.
  const pushLights = (): void => {
    fractal.applyLights(state.lights, state.ambient);
    resetAccumulation();
  };

  // On failure the in-memory library is left intact, so the item stays usable
  // (and exportable) for the rest of the session.
  const persistLibrary = (): LibraryActionResult =>
    saveUserLibrary({
      shapes: state.userShapes,
      looks: state.userLooks,
      presets: state.userPresets,
    })
      ? { ok: true }
      : { ok: false, error: "Could not save to browser storage." };

  const controller: Controller = {
    state,
    startRender: () => {
      sampleIndex = 0;
      state.sampleCount = 0;
      state.rendering = true;
    },
    stopRender: () => {
      resetAccumulation();
    },
    setSampleCap: (value: number) => {
      // No accumulation reset: raising the cap resumes a converged render, lowering it
      // simply moves the finish line.
      state.sampleCap = value;
      presentDirty = true;
    },
    setDenoise: (value: boolean) => {
      // Post-side only: no accumulation reset, the next presented frame re-filters.
      state.denoise = value;
      presentDirty = true;
    },
    setDiveAssist: (value: boolean) => {
      // Takes effect on the next zoom gesture; the current image is untouched.
      state.diveAssist = value;
      dive.assist = value;
    },
    setViewportRightInset: (px: number) => {
      const next = Math.max(0, Math.round(px));
      if (next === viewportRightInset) return;
      viewportRightInset = next;
      scheduleResize();
    },
    setViewportBottomInset: (px: number) => {
      const next = Math.max(0, Math.round(px));
      if (next === viewportBottomInset) return;
      viewportBottomInset = next;
      scheduleResize();
    },
    setPreset: applyPreset,
    setShape: applyShapeById,
    setLook: applyLookById,
    setFormulaParam: (key: string, value: number) => {
      const def = getFormula(shape.formula);
      const param = def.params.find((item) => item.key === key);
      if (!param) return;
      // Clamp at the seam: UI widgets enforce ranges, but the __kf hook and any future
      // programmatic caller would otherwise push out-of-range values straight to the GPU
      // slot. The codec already clamps on import; live setters should match.
      const clamped = Math.min(param.max, Math.max(param.min, value));
      const live = state.formulaParams.find((item) => item.key === key);
      if (live) live.value = clamped;
      fractal.setFormulaSlot(param.slot, clamped);
      resetAccumulation();
    },
    setIterations: (value: number) => {
      const { iterations } = getFormula(shape.formula);
      const clamped = Math.round(Math.min(iterations.max, Math.max(iterations.min, value)));
      state.iterations = clamped;
      fractal.uniforms.iterations.value = clamped;
      resetAccumulation();
    },
    setMaterialParam: (key, value) => {
      state[key] = value;
      const matP = fractal.uniforms.matP.value;
      if (key === "roughness") matP.x = value;
      else if (key === "specular") matP.y = value;
      else if (key === "translucency") matP.z = value;
      else if (key === "ior") matP.w = value;
      else fractal.uniforms.emissionP.value.w = value;
      resetAccumulation();
    },
    setLightParam: (index, key, value) => {
      const light = state.lights[index];
      if (!light) return;
      if (key === "intensity") light.intensity = value;
      else if (key === "size") light.size = value;
      else light.falloff = value;
      pushLights();
    },
    setLightColor: (index, hex) => {
      const light = state.lights[index];
      if (!light) return;
      light.color = hex;
      pushLights();
    },
    setLightType: (index, type) => {
      const light = state.lights[index];
      if (!light) return;
      light.type = type;
      pushLights();
    },
    setLightEnabled: (index, enabled) => {
      const light = state.lights[index];
      if (!light) return;
      light.enabled = enabled;
      pushLights();
    },
    setLightDirection: (index, dir) => {
      const light = state.lights[index];
      if (!light) return;
      light.direction = [dir[0], dir[1], dir[2]];
      pushLights();
    },
    setLightPosition: (index, pos) => {
      const light = state.lights[index];
      if (!light) return;
      light.position = [pos[0], pos[1], pos[2]];
      pushLights();
    },
    placeLightAtCamera: (index) => {
      const light = state.lights[index];
      if (!light) return;
      light.position = stage.camera.position.toArray() as [number, number, number];
      light.type = "positional";
      pushLights();
    },
    addLight: () => {
      if (state.lights.length >= MAX_LIGHTS) return null;
      state.lights.push(defaultNewLight());
      pushLights();
      return state.lights.length - 1;
    },
    removeLight: (index) => {
      if (state.lights.length <= 1 || !state.lights[index]) return;
      state.lights.splice(index, 1);
      pushLights();
    },
    setAmbient: (value) => {
      state.ambient = value;
      pushLights();
    },
    setSkyMode: (mode) => {
      state.skyMode = mode;
      fractal.applySky(liveSky());
      if (mode === "envmap") ensureEnvironment(state.envId);
      resetAccumulation();
    },
    setSkyParam: (key, value) => {
      if (key === "intensity") state.envIntensity = value;
      else if (key === "sunElevation") state.sunElevation = value;
      else if (key === "sunAzimuth") state.sunAzimuth = value;
      else if (key === "turbidity") state.turbidity = value;
      else if (key === "sunSize") state.sunSize = value;
      else state.envYaw = value;
      fractal.applySky(liveSky());
      resetAccumulation();
    },
    setEnvMap: (id: string) => {
      state.envId = id;
      fractal.applySky(liveSky());
      ensureEnvironment(id);
      resetAccumulation();
    },
    setAperture: (value: number) => {
      state.aperture = value;
      fractal.uniforms.lens.value.x = value;
      resetAccumulation();
    },
    setFocusDistance: (value: number) => {
      state.focusDistance = value;
      fractal.uniforms.lens.value.y = value;
      resetAccumulation();
    },
    // Post-side setters: no accumulation reset (like setDenoise) - the post chain
    // re-grades on the next presented frame (presentDirty), so a render in progress
    // survives the tweak.
    setExposure: (value: number) => {
      state.exposure = value;
      post.exposure.value = value;
      presentDirty = true;
    },
    setContrast: (value: number) => {
      state.contrast = value;
      post.contrast.value = value;
      presentDirty = true;
    },
    setBloomStrength: (value: number) => {
      state.bloomStrength = value;
      post.bloom.strength.value = value;
      presentDirty = true;
    },
    setChromaticAberration: (value: number) => {
      state.chromaticAberration = value;
      post.caAmount.value = value;
      presentDirty = true;
    },
    setBloomRadius: (value: number) => {
      state.bloomRadius = value;
      post.bloom.radius.value = value;
      presentDirty = true;
    },
    setBloomThreshold: (value: number) => {
      state.bloomThreshold = value;
      post.bloom.threshold.value = value;
      presentDirty = true;
    },
    setSaturation: (value: number) => {
      state.saturation = value;
      post.saturation.value = value;
      presentDirty = true;
    },
    setFogParam: (key, value) => {
      if (key === "density") state.fogDensity = value;
      else if (key === "height") state.fogHeight = value;
      else state.fogAnisotropy = value;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setFogColor: (hex: string) => {
      state.fogColor = hex;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setGlowParam: (key, value) => {
      if (key === "strength") state.glowStrength = value;
      else state.glowRadius = value;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setGlowColor: (hex: string) => {
      state.glowColor = hex;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setGlowPaletteLink: (value: boolean) => {
      state.glowUsePalette = value;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setSurfaceFxParam: (key, value) => {
      if (key === "iridescence") state.iridescence = value;
      else if (key === "filmShift") state.filmShift = value;
      else if (key === "rimStrength") state.rimStrength = value;
      else if (key === "microScale") state.microNoiseScale = value;
      else state.microNoiseRoughness = value;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setGrowthParam: (key, value) => {
      if (key === "length") {
        state.growthLength = value;
        // Keep the dive steering conservative against the displaced GPU surface.
        dive.growthMargin = value;
      } else if (key === "density") state.growthDensity = value;
      else if (key === "sharpness") state.growthSharpness = value;
      else if (key === "coverage") state.growthCoverage = value;
      else if (key === "trapBias") state.growthTrapBias = value;
      else if (key === "colorBlend") state.growthColorBlend = value;
      else state.growthEmission = value;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setGrowthMode: (mode) => {
      state.growthMode = mode;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setGrowthColor: (hex: string) => {
      state.growthColor = hex;
      fractal.applyEffects(liveEffects());
      resetAccumulation();
    },
    setPostFxParam: (key, value) => {
      // Post-side only: no accumulation reset, the next presented frame re-grades.
      if (key === "vignetteStrength") {
        state.vignetteStrength = value;
        post.vignetteStrength.value = value;
      } else if (key === "vignetteSoftness") {
        state.vignetteSoftness = value;
        post.vignetteSoftness.value = value;
      } else if (key === "grainStrength") {
        state.grainStrength = value;
        post.grainStrength.value = value;
      } else {
        state.lensDistortion = value;
        post.distortion.value = value;
      }
      presentDirty = true;
    },
    setEmissionColor: (hex: string) => {
      state.emissionColor = hex;
      fractal.setEmissionColor(hex);
      resetAccumulation();
    },
    setPaletteColor: (key, hex) => {
      if (key === "baseA") state.paletteBaseA = hex;
      else if (key === "baseB") state.paletteBaseB = hex;
      else state.paletteAccent = hex;
      fractal.setPaletteColor(key, hex);
      resetAccumulation();
    },
    setTrapScale: (value: number) => {
      state.trapScale = value;
      fractal.setTrapScale(value);
      resetAccumulation();
    },
    setTrapPower: (value: number) => {
      state.trapPower = value;
      fractal.setTrapPower(value);
      resetAccumulation();
    },
    setWarpParam: (key, value) => {
      if (key === "twist") state.warpTwist = value;
      else if (key === "bend") state.warpBend = value;
      else if (key === "rippleAmp") state.warpRippleAmp = value;
      else if (key === "rippleFreq") state.warpRippleFreq = value;
      else if (key === "noiseAmp") state.warpNoiseAmp = value;
      else state.warpNoiseFreq = value;
      const warp = liveWarp();
      fractal.applyWarp(warp);
      syncDiveWarp(warp);
      resetAccumulation();
    },
    setWarpAxis: (key, axis) => {
      if (key === "twistAxis") state.warpTwistAxis = axis;
      else if (key === "bendAxis") state.warpBendAxis = axis;
      else state.warpRippleAxis = axis;
      const warp = liveWarp();
      fractal.applyWarp(warp);
      syncDiveWarp(warp);
      resetAccumulation();
    },
    setCameraFov: (value: number) => {
      state.cameraFov = value;
      stage.setFov(value);
      resetAccumulation();
    },
    resetCamera: () => {
      stage.applyPreset(shape.camera);
      // Reset means "back to this shape's framing", which includes its dive frame.
      dive.restore(shape.dive);
      state.cameraFov = shape.camera.fov;
      resetAccumulation();
    },
    cancelExport: () => {
      exportCancelled = true;
    },
    exportImage: async (options, onProgress) => {
      if (exporting) return { ok: false, error: "An export is already in progress." };
      exporting = true;
      exportCancelled = false;
      // Settings the export perturbs, captured so the live view is restored verbatim. The
      // viewport size is NOT captured: it's re-derived from the window in the `finally`, so a
      // resize that happened mid-export is applied rather than swallowed.
      const live = {
        pixelRatio: renderer.getPixelRatio(),
        sampleCap: state.sampleCap,
        denoise: state.denoise,
      };
      try {
        // 1:1 device pixels so the captured buffer is exactly the requested resolution.
        renderer.setPixelRatio(1);
        resizeTargets(options.width, options.height, false);

        // Kick off a fresh converged run at the export settings. resetAccumulation clears
        // `rendering`, so re-arm it after; the loop accumulates one sample per frame.
        state.denoise = options.denoise;
        state.sampleCap = options.sampleCap;
        resetAccumulation();
        state.rendering = true;

        // Wait for the loop to reach the cap (or a cancel), reporting progress as it climbs.
        await new Promise<void>((resolve) => {
          const poll = (): void => {
            onProgress?.(Math.min(1, sampleIndex / options.sampleCap));
            if (exportCancelled || sampleIndex >= options.sampleCap) resolve();
            else requestAnimationFrame(poll);
          };
          requestAnimationFrame(poll);
        });
        // Cancelled mid-run: abandon the capture; the `finally` restores the live view.
        if (exportCancelled) return { ok: false, cancelled: true };
        // One more frame so the converged branch presents the final (denoised) image
        // (presentDirty forces it; the gated loop would otherwise idle there).
        presentDirty = true;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        // toBlob snapshots the canvas at call time (same timing contract the old
        // toDataURL relied on) but encodes off the main thread - toDataURL froze the
        // UI for seconds on a 33 MP 8K PNG.
        const mime = options.format === "jpeg" ? "image/jpeg" : "image/png";
        const blob = await new Promise<Blob | null>((resolve) =>
          renderer.domElement.toBlob(resolve, mime, options.quality),
        );
        if (!blob) return { ok: false, error: "Could not encode the image." };
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.download = options.filename;
        anchor.href = url;
        anchor.click();
        // Defer revoke: a synchronous revoke can race the download fetch's blob deref.
        setTimeout(() => URL.revokeObjectURL(url), 0);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Export failed." };
      } finally {
        renderer.setPixelRatio(live.pixelRatio);
        state.denoise = live.denoise;
        state.sampleCap = live.sampleCap;
        // Clear the flag before resizing so resizeLiveViewport doesn't early-return. It
        // re-derives the size from the current window (applying any swallowed mid-export
        // resize), reallocates targets to that size, and resets accumulation.
        exporting = false;
        resizeLiveViewport();
      }
    },
    saveUserItem: (kind: LibraryKind, name: string, description: string) => {
      const ops = KIND_OPS[kind];
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: `${ops.label} name is required.` };
      const uniqueName = uniquifyName(trimmed, takenNames(kind));
      const id = makeUserItemId(uniqueName, takenIds(kind));
      const now = new Date().toISOString();
      ops.list().push({
        ...ops.snapshot(id, uniqueName, description.trim()),
        createdAt: now,
        updatedAt: now,
      });
      // Select without applying: the image already equals the snapshot, so an
      // in-progress render must survive the save.
      ops.select(id);
      return persistLibrary();
    },
    updateUserItem: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      const list = ops.list();
      const index = list.findIndex((item) => item.id === id);
      const existing = list[index];
      if (!existing) return { ok: false, error: `Not a saved ${kind}.` };
      list[index] = {
        ...ops.snapshot(existing.id, existing.name, existing.description),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      return persistLibrary();
    },
    renameUserItem: (kind: LibraryKind, id: string, name: string, description: string) => {
      const ops = KIND_OPS[kind];
      const list = ops.list();
      const index = list.findIndex((item) => item.id === id);
      const existing = list[index];
      if (!existing) return { ok: false, error: `Not a saved ${kind}.` };
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: `${ops.label} name is required.` };
      const otherNames = new Set(
        [...ops.curated, ...list.filter((item) => item.id !== id)].map((item) => item.name),
      );
      list[index] = {
        ...existing,
        name: uniquifyName(trimmed, otherNames),
        description: description.trim(),
        updatedAt: new Date().toISOString(),
      };
      return persistLibrary();
    },
    duplicateUserItem: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      // Curated items clone too (ADR-0011); the push below stamps the copy fresh dates.
      const existing =
        ops.list().find((item) => item.id === id) ?? ops.curated.find((item) => item.id === id);
      if (!existing) return { ok: false, error: `No such ${kind}.` };
      const copy = JSON.parse(JSON.stringify(existing)) as LibraryItem & Partial<AuthoringStamps>;
      const uniqueName = uniquifyName(copy.name, takenNames(kind));
      const now = new Date().toISOString();
      ops.list().push({
        ...copy,
        id: makeUserItemId(uniqueName, takenIds(kind)),
        name: uniqueName,
        createdAt: now,
        updatedAt: now,
      });
      return persistLibrary();
    },
    deleteUserItem: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      const list = ops.list();
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return { ok: false, error: `Not a saved ${kind}.` };
      list.splice(index, 1);
      // The pixels on screen are still valid (module-level `shape`/`look` keep working),
      // so only the selection clears - no accumulation reset.
      if (ops.selectedId() === id) ops.select("");
      return persistLibrary();
    },
    generateShape: (options) => {
      const next = rollShape({
        formula: options.formula,
        current: snapshotShape("", "", ""),
        locks: { params: new Set(options.lockedParams), iterations: options.lockIterations },
      });
      applyShape(next);
      // Generated state is unsaved ("Custom"): a held selection would let Update
      // silently overwrite the stored item with the rolled values.
      state.selectedShapeId = "";
      state.selectedPresetId = "";
      resetAccumulation();
    },
    mutateShape: (strength, options) => {
      // The snapshot carries the live pose + dive frame, so re-applying never moves
      // the camera - only the formula settings change.
      const live = snapshotShape("", "Mutated", "");
      const formulaSettings = mutateFormulaSettings(live.formula, live.formulaSettings, strength, {
        params: new Set(options.lockedParams),
        iterations: options.lockIterations,
      });
      applyShape({ ...live, formulaSettings });
      state.selectedShapeId = "";
      state.selectedPresetId = "";
      resetAccumulation();
    },
    exportLibraryJson: (kind: LibraryKind) => {
      // Always the live state, including unsaved tweaks; named after the selection if any.
      const ops = KIND_OPS[kind];
      const selected = [...ops.curated, ...ops.list()].find((item) => item.id === ops.selectedId());
      const name = selected?.name ?? "Untitled";
      const slug = slugify(name);
      const json = buildLibraryFile(
        kind,
        ops.snapshot(`user-${slug}`, name, selected?.description ?? ""),
      );
      downloadTextFile(`kfractal-${kind}-${slug}.json`, json);
    },
    exportLibraryItemJson: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      const found = [...ops.curated, ...ops.list()].find((item) => item.id === id);
      if (!found) return { ok: false, error: `No such ${kind}.` };
      // Strip the authoring stamps so the file matches the live-state exports exactly.
      const {
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...item
      } = found as LibraryItem & Partial<AuthoringStamps>;
      downloadTextFile(
        `kfractal-${kind}-${slugify(item.name)}.json`,
        buildLibraryFile(kind, item as LibraryItem),
      );
      return { ok: true };
    },
    importLibraryJson: async (file: File) => {
      const parsed = parseLibraryFile(await file.text());
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const ops = KIND_OPS[parsed.kind];
      const uniqueName = uniquifyName(parsed.item.name, takenNames(parsed.kind));
      const id = makeUserItemId(uniqueName, takenIds(parsed.kind));
      const now = new Date().toISOString();
      const list = ops.list();
      list.push({
        ...parsed.item,
        id,
        name: uniqueName,
        createdAt: now,
        updatedAt: now,
      });
      const result = persistLibrary();
      if (!result.ok) {
        // Persisting failed (e.g. storage quota). Roll the in-memory add back so the import
        // is all-or-nothing: don't switch the canvas to a half-saved item, and don't leave
        // it in the list to pile up as "name (2)/(3)" duplicates on the user's retry.
        const index = list.findIndex((item) => item.id === id);
        if (index >= 0) list.splice(index, 1);
        return result;
      }
      ops.apply(id);
      return { ...result, name: uniqueName };
    },
  };

  applyPreset(initialPreset.id);
  fractal.resize(width, height);
  mountUi(controller);

  // Dev/authoring hook (ADR-0007): lets the settle-shots harness and preset authors drive
  // the camera and controls programmatically. Not part of the Controller seam.
  (window as unknown as Record<string, unknown>).__kf = {
    controller,
    camera: () => ({
      target: stage.target.toArray(),
      yaw: stage.yaw,
      pitch: stage.pitch,
      roll: stage.roll,
      distance: stage.distance,
      fov: stage.camera.fov,
    }),
    setCamera: (cam: {
      target?: [number, number, number];
      yaw?: number;
      pitch?: number;
      roll?: number;
      distance?: number;
      fov?: number;
    }) => {
      if (cam.target) stage.target.set(cam.target[0], cam.target[1], cam.target[2]);
      stage.applyPreset({
        target: cam.target ?? (stage.target.toArray() as [number, number, number]),
        yaw: cam.yaw ?? stage.yaw,
        pitch: cam.pitch ?? stage.pitch,
        roll: cam.roll ?? stage.roll,
        distance: cam.distance ?? stage.distance,
        fov: cam.fov ?? stage.camera.fov,
      });
      dive.reset();
      resetAccumulation();
    },
    samples: () => sampleIndex,
    dive: () => ({ offset: dive.offset.toArray(), scale: dive.scale, debug: { ...dive.debug } }),
    // Camera-space distance to the surface per the f64 CPU DE; diagnoses buried (≈0)
    // vs empty-space (≫ extent) cameras during dive verification. Growth-adjusted so
    // it stays truthful against the displaced GPU surface.
    deAtCamera: () => {
      const p = fractal.uniforms.formulaP.value;
      const f = stage.camera.position
        .clone()
        .applyMatrix3(dive.basis)
        .multiplyScalar(dive.scale)
        .add(dive.offset);
      const params = {
        p0: p.x,
        p1: p.y,
        p2: p.z,
        p3: p.w,
        iterations: fractal.uniforms.iterations.value,
      };
      const de = getCpuDe(shape.formula);
      // Warp-adjusted (like the dive's own probes) so it stays truthful under warp.
      const raw = dive.warp
        ? warpCpuDe((x, y, z) => de(x, y, z, params), dive.warp, f.x, f.y, f.z)
        : de(f.x, f.y, f.z, params);
      return raw / dive.scale - dive.growthMargin;
    },
  };

  window.addEventListener("resize", scheduleResize);

  // Once a render/shader error is surfaced, stop driving the loop so it isn't spammed.
  let fatalError = false;
  // The boot loading screen stays up until the first preview frame has been rendered and
  // presented (the first renderTo compiles the WGSL preview pipeline); then it fades out.
  let firstFramePresented = false;
  const loop = startLoop({
    update: (dt) => {
      // While exporting, the camera/dive are pinned and the buffers are export-sized:
      // skip all live bookkeeping so nothing resets the accumulation mid-capture.
      if (exporting) return;
      fpsElapsed += dt;
      fpsFrames += 1;
      if (controls.consumeChanged()) resetAccumulation();
      // Dive bookkeeping (infinite zoom): steer the orbit pivot onto the surface, re-base
      // the world scale when the camera leaves the orbit band, and re-anchor through the
      // Apollonian's own self-similarity map. Every change is view-preserving, but the
      // uniforms moved, so drop the accumulation.
      if (
        dive.update(
          stage,
          shape.formula,
          fractal.uniforms.formulaP.value,
          state.iterations,
          controls.pointerNdc(),
        )
      ) {
        resetAccumulation();
      }
      fractal.syncDive(dive.offset, dive.basis, dive.scale);
      fractal.uniforms.iterations.value = state.iterations + dive.extraIterations(stage.distance);
      // Warp Lipschitz division shrinks every step; grow the budget to match (capped).
      const warpBoost = dive.warp ? warpStepBoost(dive.warp) : 1;
      fractal.uniforms.renderP.value.x = Math.round(
        dive.marchSteps(shape.render.maxSteps, stage.distance) * warpBoost,
      );
      // Floor the draw distance at the camera's own distance (plus the fractal's extent):
      // shapes tune maxDistance for close-up framing, and a far pull-back would otherwise
      // march past the budget and silently cull the whole shape.
      fractal.uniforms.renderP.value.y = Math.max(
        dive.maxDistance(shape.render.maxDistance),
        stage.distance + 8,
      );
      if (fpsElapsed >= FPS_INTERVAL) {
        state.fps = Math.round(fpsFrames / fpsElapsed);
        fpsElapsed = 0;
        fpsFrames = 0;
      }
    },
    render: () => {
      if (fatalError) return;
      try {
        if (!state.rendering) {
          // Preview: one sharp analytic sample, shown directly (blend factor 1).
          // Skipped entirely while nothing changed - the canvas holds the last frame,
          // so an idle workstation costs zero GPU. Animated grain alone keeps the
          // cheap post pass ticking.
          if (sceneDirty) {
            // Track the live camera while interacting.
            fractal.syncCamera(stage.camera);
            fractal.setMode(MODE_PREVIEW);
            fractal.setFrame(0);
            fractal.renderTo(renderer, sampleRT);
            accumulation.accumulate(renderer, 0);
            post.setSource(accumulation.texture);
            sceneDirty = false;
            presentDirty = false;
            post.render();
            sampleIndex = 0;
            // First real pixels are up: retire the boot loading screen.
            if (!firstFramePresented) {
              firstFramePresented = true;
              hideLoading();
            }
          } else if (presentDirty || post.grainStrength.value > 0) {
            presentDirty = false;
            post.render();
          }
          return;
        }

        // Rendering (explicit action): accumulate path-traced samples up to the cap.
        const present = (): void => {
          let tex: THREE.Texture;
          if (state.denoise) {
            // Re-filter only when the mean advanced (or denoise was just re-enabled, which
            // resets the key to -1 below); otherwise reuse the cached denoised texture so a
            // converged frame doesn't re-run 4 à-trous passes per vsync for animated grain.
            if (denoiseCacheSample !== sampleIndex) {
              denoiseCacheTex = denoiser.run(renderer, accumulation.texture, sampleIndex);
              denoiseCacheSample = sampleIndex;
            }
            tex = denoiseCacheTex!;
          } else {
            tex = accumulation.texture;
            denoiseCacheSample = -1;
          }
          post.setSource(tex);
          post.render();
          presentDirty = false;
          // The samples readout follows the present cadence rather than the frame
          // rate, so this reactive write stops re-rendering the status bar at 60+ Hz.
          state.sampleCount = sampleIndex;
        };

        if (sampleIndex >= state.sampleCap) {
          // Converged: idle. Re-present only when the post/denoise side changes (the
          // denoise toggle still takes effect) or animated grain needs a fresh seed -
          // not 4 bilateral passes plus the bloom chain at vsync forever.
          if (presentDirty || post.grainStrength.value > 0) present();
          return;
        }
        if (sampleIndex === 0) {
          // Pin the camera for the whole run so every sample shares one orientation,
          // and capture the denoiser's primary-hit feature buffers once per run.
          fractal.syncCamera(stage.camera);
          fractal.setMode(MODE_FEATURE_ND);
          fractal.renderTo(renderer, denoiser.featureND);
          fractal.setMode(MODE_FEATURE_ALBEDO);
          fractal.renderTo(renderer, denoiser.featureAlbedo);
        }
        fractal.setMode(MODE_PATHTRACE);
        fractal.setFrame(sampleIndex);
        fractal.renderTo(renderer, sampleRT);
        accumulation.accumulate(renderer, sampleIndex);
        sampleIndex += 1;
        // Present every Nth sample: the denoise + bloom + post chain can cost as much
        // as the sample itself, so presenting at ~8-15 Hz instead of every frame buys
        // back a large slice of convergence throughput. The first and final samples
        // always present, as does any post-side tweak mid-render.
        const presentEvery = sampleIndex < 64 ? 4 : 8;
        if (
          sampleIndex >= state.sampleCap ||
          sampleIndex === 1 ||
          sampleIndex % presentEvery === 0 ||
          presentDirty
        ) {
          present();
        }
      } catch (error) {
        fatalError = true;
        loop.stop();
        showFatal(
          `KFractal hit a rendering error: ${error instanceof Error ? error.message : "unknown error"}. Reload the page to continue.`,
        );
        console.error(error);
      }
    },
  });

  // Single teardown path (HMR, embedding, tests). Stops the loop, drops the resize listener,
  // and releases the GPU resources whose dispose() methods exist for exactly this purpose.
  const teardown = (): void => {
    loop.stop();
    window.removeEventListener("resize", scheduleResize);
    controls.dispose();
    fractal.dispose();
    accumulation.dispose();
    denoiser.dispose();
    post.dispose();
    sampleRT.dispose();
  };
  (window as unknown as { __kf: Record<string, unknown> }).__kf.teardown = teardown;
}

void main();

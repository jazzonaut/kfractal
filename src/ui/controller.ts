import type {
  ColorStop,
  FractalFormulaId,
  FractalPreset,
  FogShape,
  FractalShape,
  GrowthMode,
  LibraryKind,
  LightSource,
  LightType,
  Look,
  RampColorSpace,
  RampInterpolation,
  SkyMode,
  UserLook,
  UserPreset,
  UserShape,
  WarpAxis,
} from "../fractal/types";

/**
 * A palette ramp stop as the editor sees it: a domain {@link ColorStop} plus a session-stable
 * `id`. The id keys the editor list (Vue keys + per-stop edits) so reordering/removing a stop
 * never rebinds a control to the wrong one; it is never serialized — `snapshotLook` strips it.
 */
export interface PaletteStop extends ColorStop {
  readonly id: string;
}

/** A live, schema-driven formula control (built from the registry's param defs). */
export interface FormulaParamState {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  value: number;
}

export type MaterialParamKey =
  | "roughness"
  | "specular"
  | "translucency"
  | "ior"
  | "refraction"
  | "dispersion"
  | "emissionStrength";

export type LightParamKey = "intensity" | "size" | "falloff";

export type SkyParamKey =
  | "intensity"
  | "sunElevation"
  | "sunAzimuth"
  | "turbidity"
  | "sunSize"
  | "yaw";

export type FogParamKey = "density" | "height" | "anisotropy" | "level";

export type FogPocketKey = "x" | "y" | "z" | "radius" | "edge";

export type GlowParamKey = "strength" | "radius";

export type SurfaceFxParamKey =
  | "iridescence"
  | "filmShift"
  | "rimStrength"
  | "microScale"
  | "microRoughness";

export type GrowthParamKey =
  | "length"
  | "density"
  | "sharpness"
  | "coverage"
  | "trapBias"
  | "colorBlend"
  | "emission";

export type PostFxParamKey =
  | "vignetteStrength"
  | "vignetteSoftness"
  | "grainStrength"
  | "distortion";

export type WarpParamKey = "twist" | "bend" | "rippleAmp" | "rippleFreq" | "noiseAmp" | "noiseFreq";

export type WarpAxisKey = "twistAxis" | "bendAxis" | "rippleAxis";

/** A bundled environment as the UI sees it (ADR-0009). */
export interface EnvironmentOption {
  readonly id: string;
  readonly name: string;
}

/** Outcome of a library authoring action; `error` is user-facing text for the toast. */
export interface LibraryActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

export type ExportFormat = "png" | "jpeg";

/** Settings for a one-off still export, gathered by the export dialog. */
export interface ExportOptions {
  /** Output pixel dimensions; the camera re-frames to this aspect (vertical FOV kept). */
  readonly width: number;
  readonly height: number;
  /** Samples to accumulate before capture - a fresh, converged run, not the live state. */
  readonly sampleCap: number;
  readonly denoise: boolean;
  readonly format: ExportFormat;
  /** JPEG quality in 0..1; ignored for PNG. */
  readonly quality: number;
  /** Download filename including extension. */
  readonly filename: string;
}

/** Outcome of an export; `error` is user-facing text for the toast. */
export interface ExportResult {
  readonly ok: boolean;
  /** True when the user aborted the run via `cancelExport`; no error, no download. */
  readonly cancelled?: boolean;
  readonly error?: string;
}

export interface WorkstationState {
  /** Curated libraries (ADR-0010): a preset is a named shape × look pairing. */
  readonly presets: readonly FractalPreset[];
  readonly shapes: readonly FractalShape[];
  readonly looks: readonly Look[];
  /** User-authored libraries (ADR-0007), mirrored to localStorage on every change. */
  userPresets: UserPreset[];
  userShapes: UserShape[];
  userLooks: UserLook[];
  /** Last applied pairing; cleared when a shape or look is picked independently. */
  selectedPresetId: string;
  selectedShapeId: string;
  selectedLookId: string;
  fps: number;
  sampleCount: number;
  /** True while the progressive path trace is accumulating (explicit Render action). */
  rendering: boolean;
  /** True between pressing Render and accumulation starting, while the full path-trace pipeline
   * compiles off the blocking path; the live preview keeps running. */
  preparingRender: boolean;
  /** Edge-aware à-trous filter on the accumulating render (fades out as it converges). */
  denoise: boolean;
  /** Deep-zoom dive (default on): scrolling in performs the infinite zoom into surface
   * detail (pivot pins to the surface straight ahead, world scale re-bases). Off means the
   * wheel is a manual push-through dolly that flies the camera through surfaces. */
  diveEnabled: boolean;
  formulaName: string;
  /** Live formula id (registry key); `formulaName` is its display name. */
  formulaId: FractalFormulaId;
  formulaParams: FormulaParamState[];
  iterations: number;
  iterationsMin: number;
  iterationsMax: number;
  roughness: number;
  specular: number;
  translucency: number;
  ior: number;
  refraction: number;
  dispersion: number;
  emissionStrength: number;
  /** User lights (1..MAX_LIGHTS); lights[0] is the traditional key light. */
  lights: LightSource[];
  ambient: number;
  /** Environment lighting (ADR-0009); the studio key light above coexists with it. */
  readonly environments: readonly EnvironmentOption[];
  skyMode: SkyMode;
  envIntensity: number;
  sunElevation: number;
  sunAzimuth: number;
  turbidity: number;
  sunSize: number;
  envId: string;
  envYaw: number;
  aperture: number;
  focusDistance: number;
  chromaticAberration: number;
  exposure: number;
  contrast: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  saturation: number;
  /** Special effects (all opt-in; zero strengths are off). */
  fogDensity: number;
  fogHeight: number;
  fogAnisotropy: number;
  fogShape: FogShape;
  fogLevel: number;
  fogPocketX: number;
  fogPocketY: number;
  fogPocketZ: number;
  fogPocketRadius: number;
  fogPocketEdge: number;
  glowStrength: number;
  glowRadius: number;
  glowUsePalette: boolean;
  iridescence: number;
  filmShift: number;
  rimStrength: number;
  microNoiseScale: number;
  microNoiseRoughness: number;
  /** Surface growth (the look's one geometric effect; zero length is off). */
  growthLength: number;
  growthDensity: number;
  growthMode: GrowthMode;
  growthSharpness: number;
  growthCoverage: number;
  growthTrapBias: number;
  growthColorBlend: number;
  growthEmission: number;
  vignetteStrength: number;
  vignetteSoftness: number;
  grainStrength: number;
  lensDistortion: number;
  /** sRGB hex (`#rrggbb`), matching the preset format. */
  emissionColor: string;
  fogColor: string;
  glowColor: string;
  growthColor: string;
  /** Orbit-trap palette ramp stops, ≥2. Stored in insertion order; the editor sorts by
   * position for display. Each carries a session-stable id (see {@link PaletteStop}). */
  paletteStops: PaletteStop[];
  paletteInterpolation: RampInterpolation;
  paletteColorSpace: RampColorSpace;
  trapScale: number;
  trapPower: number;
  /** Domain warp (ADR-0012, shape-side; zero amounts are identity). */
  warpTwist: number;
  warpTwistAxis: WarpAxis;
  warpBend: number;
  warpBendAxis: WarpAxis;
  warpRippleAmp: number;
  warpRippleFreq: number;
  warpRippleAxis: WarpAxis;
  warpNoiseAmp: number;
  warpNoiseFreq: number;
  cameraFov: number;
  resolutionWidth: number;
  resolutionHeight: number;
  /** Samples at which the progressive render stops accumulating (user-adjustable). */
  sampleCap: number;
  /** One multiplier on every camera gesture (orbit/pan/roll/zoom, mouse and touch). A UI
   * preference, not part of any shape/look/preset; persisted to localStorage on change. */
  controlSensitivity: number;
  /** Live-preview auto-quality: when on, the engine lowers the preview's internal resolution
   * on devices that can't sustain a smooth frame rate (render/export stay native). A UI
   * preference; persisted to localStorage on change. */
  autoQuality: boolean;
  /** Current live-preview render scale (1 = native). Driven by the engine while auto-quality
   * adapts; surfaced in the status bar as a quality badge. */
  previewScale: number;
}

export interface Controller {
  readonly state: WorkstationState;
  /** Start (or restart) the progressive path-traced render from the current view. */
  startRender: () => void;
  /** Abandon the accumulating render and drop back to the live preview. */
  stopRender: () => void;
  /** Raising the cap mid-render keeps accumulating; lowering it does not reset. */
  setSampleCap: (value: number) => void;
  setDenoise: (value: boolean) => void;
  setDiveEnabled: (value: boolean) => void;
  /** Scale every camera gesture (mouse + touch); persisted across reloads. No render reset. */
  setControlSensitivity: (value: number) => void;
  /** Toggle live-preview auto-quality (dynamic resolution scaling); persisted across reloads. */
  setAutoQuality: (value: boolean) => void;
  /** Reserve horizontal space for docked UI; the canvas resizes to the remaining width. */
  setViewportRightInset: (px: number) => void;
  /** Reserve vertical space for docked UI; the canvas resizes to the remaining height. */
  setViewportBottomInset: (px: number) => void;
  /** Apply a pairing: both halves, camera included. */
  setPreset: (id: string) => void;
  /** Apply only the geometry half (formula, params, framing, focus, march quality). */
  setShape: (id: string) => void;
  /** Apply only the art-direction half (light, sky, material, palette, effects, lens). */
  setLook: (id: string) => void;
  setFormulaParam: (key: string, value: number) => void;
  setIterations: (value: number) => void;
  setMaterialParam: (key: MaterialParamKey, value: number) => void;
  /** Per-light numeric props; `index` into `state.lights`. */
  setLightParam: (index: number, key: LightParamKey, value: number) => void;
  setLightColor: (index: number, hex: string) => void;
  setLightType: (index: number, type: LightType) => void;
  setLightEnabled: (index: number, enabled: boolean) => void;
  /** Unit vector toward the light (directional type). */
  setLightDirection: (index: number, dir: readonly [number, number, number]) => void;
  /** Scene-space position (positional type). */
  setLightPosition: (index: number, pos: readonly [number, number, number]) => void;
  /** Drop the light at the current camera position and force it positional. */
  placeLightAtCamera: (index: number) => void;
  /** Append a new light; returns its index, or null at the MAX_LIGHTS cap. */
  addLight: () => number | null;
  /** Remove a light; refused (no-op) when only one remains. */
  removeLight: (index: number) => void;
  setAmbient: (value: number) => void;
  setSkyMode: (mode: SkyMode) => void;
  setSkyParam: (key: SkyParamKey, value: number) => void;
  /** Select a procedural environment; generates it (cached after the first time) and applies it. */
  setEnvMap: (id: string) => void;
  setAperture: (value: number) => void;
  setFocusDistance: (value: number) => void;
  setExposure: (value: number) => void;
  setContrast: (value: number) => void;
  setBloomStrength: (value: number) => void;
  setChromaticAberration: (value: number) => void;
  setBloomRadius: (value: number) => void;
  setBloomThreshold: (value: number) => void;
  setSaturation: (value: number) => void;
  setFogParam: (key: FogParamKey, value: number) => void;
  setFogColor: (hex: string) => void;
  setFogShape: (shape: FogShape) => void;
  setFogPocket: (key: FogPocketKey, value: number) => void;
  /** Drop the fog pocket onto the current focal point (sets pocket mode, centred ahead). */
  placeFogAtFocus: () => void;
  setGlowParam: (key: GlowParamKey, value: number) => void;
  setGlowColor: (hex: string) => void;
  setGlowPaletteLink: (value: boolean) => void;
  setSurfaceFxParam: (key: SurfaceFxParamKey, value: number) => void;
  setGrowthParam: (key: GrowthParamKey, value: number) => void;
  setGrowthMode: (mode: GrowthMode) => void;
  setGrowthColor: (hex: string) => void;
  /** Post-side only (vignette/grain/distortion): no accumulation reset, like setDenoise. */
  setPostFxParam: (key: PostFxParamKey, value: number) => void;
  setEmissionColor: (hex: string) => void;
  /** Palette ramp edits, addressed by stable stop id; all re-bake the LUT and reset accumulation. */
  setPaletteStopColor: (id: string, hex: string) => void;
  setPaletteStopPosition: (id: string, position: number) => void;
  /** Inserts a stop at the widest gap with the interpolated colour; capped at MAX_PALETTE_STOPS. */
  addPaletteStop: () => void;
  /** Removes the stop with this id; no-op below 2 stops. */
  removePaletteStop: (id: string) => void;
  setPaletteInterpolation: (mode: RampInterpolation) => void;
  setPaletteColorSpace: (mode: RampColorSpace) => void;
  setTrapScale: (value: number) => void;
  setTrapPower: (value: number) => void;
  /** Domain warp (ADR-0012): shape-side, uniforms-only (no recompile, no dive reset). */
  setWarpParam: (key: WarpParamKey, value: number) => void;
  setWarpAxis: (key: WarpAxisKey, axis: WarpAxis) => void;
  setCameraFov: (value: number) => void;
  resetCamera: () => void;
  /**
   * Render a fresh, converged still at an arbitrary resolution and download it. Resizes the
   * render pipeline to the target, drives a path-trace to `sampleCap` (reporting 0..1 progress),
   * captures the framebuffer, then restores the live view. Resolves when the download fires.
   */
  exportImage: (
    options: ExportOptions,
    onProgress?: (fraction: number) => void,
  ) => Promise<ExportResult>;
  /** Abort an in-flight `exportImage` run; it resolves with `{ ok: false, cancelled: true }`. */
  cancelExport: () => void;
  /** Snapshot the live state as a new user item of `kind`. Selects it; never resets the render. */
  saveUserItem: (kind: LibraryKind, name: string, description: string) => LibraryActionResult;
  /** Overwrite a stored user item's params with the live state (keeps its identity). */
  updateUserItem: (kind: LibraryKind, id: string) => LibraryActionResult;
  renameUserItem: (
    kind: LibraryKind,
    id: string,
    name: string,
    description: string,
  ) => LibraryActionResult;
  /** Copy a stored user or curated item into the user library (not applied, not selected). */
  duplicateUserItem: (kind: LibraryKind, id: string) => LibraryActionResult;
  deleteUserItem: (kind: LibraryKind, id: string) => LibraryActionResult;
  /** Roll a random unsaved shape (registry ranges) and apply it. Clears shape/preset selection. */
  generateShape: (options: {
    readonly formula: FractalFormulaId | "any";
    readonly lockedParams: readonly string[];
    readonly lockIterations: boolean;
  }) => void;
  /** Perturb the live shape's unlocked params/iterations by strength 0..1; camera untouched. */
  mutateShape: (
    strength: number,
    options: { readonly lockedParams: readonly string[]; readonly lockIterations: boolean },
  ) => void;
  /** Download the live state (including unsaved tweaks) as a JSON file of `kind`. */
  exportLibraryJson: (kind: LibraryKind) => void;
  /** Download one stored item (curated or user) exactly as stored, stamps stripped. */
  exportLibraryItemJson: (kind: LibraryKind, id: string) => LibraryActionResult;
  /** Import a shape/look/preset file: add to its library and apply it. Resolves with the name. */
  importLibraryJson: (file: File) => Promise<LibraryActionResult & { name?: string }>;
}

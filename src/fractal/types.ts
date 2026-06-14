export type FractalFormulaId =
  | "mandelbox"
  | "mandelbulb"
  | "apollonian"
  | "menger"
  | "kifs"
  | "quatjulia"
  | "kleinian";

export interface CameraPreset {
  readonly target: readonly [number, number, number];
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly fov: number;
  /** Rotation around the view axis (radians). Absent means level (0). */
  readonly roll?: number;
}

/** Lens *character* (Look-side); `focusDistance` lives on the shape with its framing. */
export interface LensSettings {
  aperture: number;
  chromaticAberration: number;
}

/** March quality knobs, plumbed into the WGSL core as uniforms. */
export interface RenderSettings {
  maxSteps: number;
  maxDistance: number;
  /** Base hit epsilon; the march widens it with distance for stability. */
  surfaceEpsilon: number;
  normalEpsilon: number;
}

export type LightType = "directional" | "positional";

/** Hard cap on the lights array; mirrored by fixed-size arrays in the WGSL core. */
export const MAX_LIGHTS = 4;

/**
 * One user light. "directional" is the classic studio key (a cone of sky at infinity);
 * "positional" is an invisible sphere light placed in the scene with inverse-square
 * falloff. Both `direction` and `position` persist regardless of type so switching
 * types round-trips losslessly (same rule SkySettings follows for its modes).
 * Positions are scene-space (camera-space): during a dive a light keeps constant
 * apparent scale relative to the camera, exactly like fog and glow.
 */
export interface LightSource {
  type: LightType;
  enabled: boolean;
  color: string;
  intensity: number;
  /** Directional: cone half-angle (radians-ish). Positional: sphere radius. Drives shadow softness. */
  size: number;
  /** Unit vector toward the light (directional type). */
  direction: [number, number, number];
  /** Scene-space position (positional type). */
  position: [number, number, number];
  /** Falloff distance f: attenuation = f²/(f²+d²) (positional type). */
  falloff: number;
}

export type SkyMode = "studio" | "preetham" | "envmap";

/**
 * Environment lighting (ADR-0009): what miss rays see, layered with the key light.
 * All fields persist regardless of mode so switching modes round-trips losslessly.
 */
export interface SkySettings {
  mode: SkyMode;
  /** Linear multiplier on the environment radiance (preetham/envmap modes). */
  intensity: number;
  /** Preetham sun elevation above the horizon, degrees. */
  sunElevation: number;
  /** Preetham sun azimuth, degrees. */
  sunAzimuth: number;
  /** Preetham atmospheric haze: 2 (crisp) .. 10 (milky). */
  turbidity: number;
  /** Cone half-angle (radians-ish) of the Preetham sun; drives shadow softness. */
  sunSize: number;
  /** Procedural environment id (ENVIRONMENTS registry); used in envmap mode. */
  envId: string;
  /** Environment yaw rotation, degrees. */
  yaw: number;
}

/** Full surface material (ADR-0005): albedo comes from the orbit-trap gradient. */
export interface MaterialSettings {
  /** 0 = mirror reflections, 1 = fully diffused bounce. */
  roughness: number;
  /** Specular lobe weight 0..1. */
  specular: number;
  /** Diffuse transmission probability 0..1 (wax/foam look). */
  translucency: number;
  /** Index of refraction; sets the fresnel F0 of the specular lobe. */
  ior: number;
  emissionStrength: number;
  readonly emissionColor: string;
}

/**
 * Maps raw orbit-trap values onto the 0..1 gradient axis: t = (trap*scale)^power.
 * Shape-side (ADR-0010): raw trap ranges are a property of the formula (apollonian ~5x
 * a mandelbox's), so the mapping must travel with the geometry or look-swaps flatten.
 */
export interface OrbitTrapSettings {
  scale: number;
  power: number;
}

/** How the ramp blends between adjacent stops. */
export type RampInterpolation = "linear" | "smooth" | "stepped";

/** Colour space the per-segment interpolation happens in. */
export type RampColorSpace = "rgb" | "oklab";

/** One colour stop on the orbit-trap ramp: an sRGB `#rrggbb` colour at position 0..1. */
export interface ColorStop {
  readonly position: number;
  readonly color: string;
}

/**
 * Upper bound on ramp stops. GPU-bound: the WGSL declares a fixed `array<vec4<f32>, 8>` and 8
 * `paletteStop0..7` uniforms, and `fractal-pass.setPaletteRamp` packs into 8 fixed slots. Raising
 * this REQUIRES widening the WGSL array, its entry params, and the slots/uniforms in fractal-pass
 * to match — otherwise stops past 8 are silently dropped on the GPU. ramp.test.ts guards the count.
 */
export const MAX_PALETTE_STOPS = 8;

/** A position-sorted (ascending) copy of the stops; the input is never mutated. */
export function sortStopsByPosition<T extends { readonly position: number }>(
  stops: readonly T[],
): T[] {
  // eslint-disable-next-line no-array-sort -- operating on a copy, the input is untouched
  return [...stops].sort((a, b) => a.position - b.position);
}

export interface PaletteSettings {
  /** Ordered (by position) colour stops; at least 2. */
  readonly stops: readonly ColorStop[];
  readonly interpolation: RampInterpolation;
  readonly colorSpace: RampColorSpace;
  saturation: number;
  exposure: number;
  contrast: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
}

/** Path-traced atmosphere: exponential height fog with single-scatter light shafts. */
export interface FogSettings {
  /** Extinction at the height base, camera-space units. 0 disables fog entirely. */
  density: number;
  /** Exponential height falloff; larger = fog hugs the floor harder. */
  height: number;
  /** Henyey-Greenstein g, -0.9..0.9; positive scatters forward (shafty). */
  anisotropy: number;
  readonly color: string;
}

/** Volumetric aura: rays accumulate emission near the surface during the march. */
export interface GlowSettings {
  strength: number;
  /** Proximity falloff radius, camera-space units. */
  radius: number;
  /** When true the aura tints from the orbit-trap palette instead of `color`. */
  usePalette: boolean;
  readonly color: string;
}

/** Surface response extras: thin-film iridescence, rim light, micro-detail noise. */
export interface SurfaceFxSettings {
  iridescence: number;
  /** Thin-film thickness 0..1, remapped to ~100..1000nm; shifts the interference hue. */
  filmShift: number;
  rimStrength: number;
  /** Micro-noise frequency in fractal space; detail renews continuously while diving. */
  microScale: number;
  /** How much micro-noise perturbs roughness/albedo, 0..1. */
  microRoughness: number;
}

export type GrowthMode = "spikes" | "bumps" | "crystals" | "fins";

/**
 * Procedural protrusions displaced out of the distance field near the surface.
 * The look's one sanctioned geometric effect (ADR-0010 exception): protrusion is
 * bounded by `length`, so a look swap perturbs geometry by at most that much.
 */
export interface GrowthSettings {
  /** Protrusion length, camera-space units. 0 disables growth entirely. */
  length: number;
  /** Feature frequency in fractal space; dive-rescaled like micro noise. */
  density: number;
  mode: GrowthMode;
  /** Profile exponent: low = soft blobs, high = needle spikes / hard facets. */
  sharpness: number;
  /** Fraction of the surface carrying growth (low-frequency noise mask). */
  coverage: number;
  /** Orbit-trap placement bias: positive favors crevices, negative exposed ridges. */
  trapBias: number;
  readonly color: string;
  /** 0 = growth keeps the trap palette, 1 = fully recolored. */
  colorBlend: number;
  /** Emissive boost on growth, fed through the growth color. */
  emission: number;
}

/** Lens/post effects, applied in PostChain after denoise + accumulation. */
export interface PostFxSettings {
  vignetteStrength: number;
  /** Width of the vignette falloff band, 0.05..1. */
  vignetteSoftness: number;
  /** Animated per-frame film grain; applied last in post so it never averages away. */
  grainStrength: number;
  /** Barrel (>0) / pincushion (<0) radial distortion. */
  distortion: number;
}

/** All special effects (opt-in: zero strengths reproduce the effect-free image). */
export interface EffectsSettings {
  readonly fog: FogSettings;
  readonly glow: GlowSettings;
  readonly surface: SurfaceFxSettings;
  readonly growth: GrowthSettings;
  readonly post: PostFxSettings;
}

/** Generic per-formula parameters, keyed by the formula's param schema. */
export interface FormulaSettings {
  iterations: number;
  readonly values: Readonly<Record<string, number>>;
}

export type WarpAxis = "x" | "y" | "z";

/**
 * Domain transforms applied to the fractal's sample space before the formula runs
 * (ADR-0012). Shape-side: a warp restructures the geometry itself, so it travels
 * with the shape. All amounts default to 0 = identity; the field is omitted from
 * saved shapes when fully off.
 */
export interface WarpSettings {
  /** Rotation around `twistAxis`, radians per fractal-space unit along it. */
  twist: number;
  twistAxis: WarpAxis;
  /** Curvature along `bendAxis`, radians per fractal-space unit. */
  bend: number;
  bendAxis: WarpAxis;
  /** Sinusoidal displacement of `rippleAxis`, fractal-space units. */
  rippleAmp: number;
  rippleFreq: number;
  rippleAxis: WarpAxis;
  /** FBM domain offset amplitude, fractal-space units. Fully procedural. */
  noiseAmp: number;
  noiseFreq: number;
}

/**
 * Deep-zoom frame: the dive transform F(p) = offset + scale*(R*p) active when a shape
 * was snapshotted. Without it a camera saved mid-dive reapplies in unrebased world
 * space and lands buried or lost. Omitted when the view was at top level (identity).
 */
export interface DiveFrame {
  readonly offset: readonly [number, number, number];
  /** Column-major 3x3 rotation (THREE.Matrix3 element order). */
  readonly basis: readonly [number, number, number, number, number, number, number, number, number];
  readonly scale: number;
}

/**
 * The geometry axis (ADR-0010): which fractal, its parameters, and everything that
 * only makes sense for that geometry - framing, focus distance, and march quality
 * (epsilons and step counts track the geometry's scale, not its lighting).
 */
export interface FractalShape {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly formula: FractalFormulaId;
  readonly formulaSettings: FormulaSettings;
  readonly camera: CameraPreset;
  /** Default focus distance for this framing; travels with the shape, not the look. */
  readonly focusDistance: number;
  readonly render: RenderSettings;
  readonly trap: OrbitTrapSettings;
  /** Domain warp (ADR-0012). Absent = identity. */
  readonly warp?: WarpSettings;
  /** Present only when the framing was captured mid-dive (deep zoom). */
  readonly dive?: DiveFrame;
}

/**
 * The art-direction axis (ADR-0010): lighting, surface response, color, and effects.
 * A look is shape-agnostic - swapping it never moves the camera or the geometry.
 */
export interface Look {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly lens: LensSettings;
  /** Linear sky-fill level (studio mode). Keep tiny - references live on black negative space. */
  ambient: number;
  /** 1..MAX_LIGHTS user lights; lights[0] is the traditional key light. */
  readonly lights: readonly LightSource[];
  readonly sky: SkySettings;
  readonly material: MaterialSettings;
  readonly palette: PaletteSettings;
  readonly effects: EffectsSettings;
}

/** A named shape × look pairing. Halves are embedded, so applying never needs a lookup. */
export interface FractalPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly shape: FractalShape;
  readonly look: Look;
}

/** The three user-authorable library kinds (ADR-0010). */
export type LibraryKind = "shape" | "look" | "preset";

/** Authoring metadata stamped onto every saved library item (ADR-0007). ISO 8601. */
export interface AuthoringStamps {
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UserShape extends FractalShape, AuthoringStamps {}
export interface UserLook extends Look, AuthoringStamps {}
export interface UserPreset extends FractalPreset, AuthoringStamps {}

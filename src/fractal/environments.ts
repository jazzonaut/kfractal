import type { SkySettings } from "./types";

/**
 * Procedural environment maps (ADR-0009). No real-world imagery anywhere in the app:
 * each environment is an artistic spec - a graded dome, a few soft glow blobs acting as
 * area lights, optional seeded noise for nebula texture - rasterized to an equirect HDR
 * texture by `render/environment.ts` and importance-sampled like any light rig.
 * Presets reference environments by id, so exported JSON stays fully portable.
 */

/** A soft radial glow on the dome: the environment's area lights. */
export interface EnvGlowSpec {
  /** Direction of the glow center: polar angle from zenith and azimuth, radians. */
  readonly theta: number;
  readonly phi: number;
  /** Gaussian angular falloff (radians); small = hard sun-like, large = wash. */
  readonly size: number;
  /** Linear RGB at the glow center; HDR values well above 1 are expected. */
  readonly color: readonly [number, number, number];
}

/** Seeded fbm modulation, for nebula streaks and burning-cloud texture. */
export interface EnvNoiseSpec {
  readonly seed: number;
  /** Lattice frequency over the unit sphere; higher = finer streaks. */
  readonly frequency: number;
  readonly octaves: number;
  /** Vertical squash of the lattice: <1 smears the noise into horizontal bands. */
  readonly bandiness: number;
  /** Linear RGB the noise adds at full strength. */
  readonly color: readonly [number, number, number];
  /** Sharpening exponent: >1 turns smooth fbm into ragged wisps. */
  readonly power: number;
}

export interface ProceduralEnvSpec {
  /** Dome gradient, zenith → horizon → nadir, linear RGB. */
  readonly zenith: readonly [number, number, number];
  readonly horizon: readonly [number, number, number];
  readonly nadir: readonly [number, number, number];
  readonly glows: readonly EnvGlowSpec[];
  readonly noise?: EnvNoiseSpec;
  /** Sparse stars per ~10k pixels (0 = none); cold-white HDR speckles. */
  readonly starDensity?: number;
}

export interface EnvironmentDef {
  readonly id: string;
  readonly name: string;
  readonly spec: ProceduralEnvSpec;
}

export const ENVIRONMENTS: readonly EnvironmentDef[] = [
  {
    // Cool indigo dome with teal/violet aurora curtains and one cold key glow.
    id: "aurora-veil",
    name: "Aurora Veil",
    spec: {
      zenith: [0.012, 0.018, 0.05],
      horizon: [0.02, 0.05, 0.07],
      nadir: [0.004, 0.005, 0.01],
      glows: [
        { theta: 0.7, phi: 0.6, size: 0.18, color: [14, 26, 30] },
        { theta: 1.1, phi: 3.6, size: 0.5, color: [1.6, 0.9, 3.2] },
      ],
      noise: {
        seed: 11,
        frequency: 3.5,
        octaves: 3,
        bandiness: 0.35,
        color: [0.05, 0.16, 0.13],
        power: 2.2,
      },
    },
  },
  {
    // Golden-hour dusk: plum zenith, amber horizon, one hot low sun-glow plus halo.
    id: "gilded-haze",
    name: "Gilded Haze",
    spec: {
      zenith: [0.025, 0.014, 0.03],
      horizon: [0.22, 0.1, 0.05],
      nadir: [0.012, 0.006, 0.004],
      glows: [
        { theta: 1.38, phi: 0, size: 0.07, color: [70, 38, 14] },
        { theta: 1.32, phi: 0, size: 0.45, color: [2.6, 1.2, 0.4] },
      ],
      noise: {
        seed: 23,
        frequency: 2.5,
        octaves: 3,
        bandiness: 0.25,
        color: [0.1, 0.05, 0.03],
        power: 1.6,
      },
    },
  },
  {
    // A burning sky: near-black maroon dome, fiery turbulent cloud band, white-hot rift.
    id: "ember-storm",
    name: "Ember Storm",
    spec: {
      zenith: [0.004, 0.0012, 0.0008],
      horizon: [0.045, 0.011, 0.004],
      nadir: [0.003, 0.001, 0.0005],
      glows: [
        { theta: 1.25, phi: 2.0, size: 0.1, color: [55, 22, 6] },
        { theta: 1.4, phi: 2.0, size: 0.3, color: [0.9, 0.22, 0.05] },
      ],
      noise: {
        seed: 47,
        frequency: 4,
        octaves: 4,
        bandiness: 0.3,
        color: [0.3, 0.07, 0.02],
        power: 3.2,
      },
    },
  },
  {
    // Moonless night: almost nothing - faint cold horizon, a dim moon wash, rare stars.
    id: "midnight",
    name: "Midnight",
    spec: {
      zenith: [0.0015, 0.002, 0.006],
      horizon: [0.006, 0.009, 0.02],
      nadir: [0.001, 0.001, 0.003],
      glows: [{ theta: 0.55, phi: 4.4, size: 0.35, color: [0.5, 0.65, 1.1] }],
      starDensity: 1.2,
    },
  },
];

export const DEFAULT_ENVIRONMENT_ID = "aurora-veil";

/** Unknown ids (e.g. a preset from a build with a different set) fall back, never throw. */
export function getEnvironment(id: string): EnvironmentDef {
  const found = ENVIRONMENTS.find((env) => env.id === id);
  if (found) return found;
  const fallback = ENVIRONMENTS.find((env) => env.id === DEFAULT_ENVIRONMENT_ID);
  if (!fallback) throw new Error("KFractal needs at least the default environment.");
  return fallback;
}

/** The sky every pre-M5 preset (and v1 preset file) gets: the original studio fill. */
export const DEFAULT_SKY: SkySettings = {
  mode: "studio",
  intensity: 1,
  sunElevation: 35,
  sunAzimuth: 0,
  turbidity: 3,
  sunSize: 0.05,
  envId: DEFAULT_ENVIRONMENT_ID,
  yaw: 0,
};

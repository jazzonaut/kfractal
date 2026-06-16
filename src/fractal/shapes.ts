import type { FractalShape } from "./types";

/**
 * Curated shape library (ADR-0010): the geometry axis, factored out of the original
 * monolithic presets. A shape is a formula + its parameters plus everything that only
 * makes sense for that geometry - default framing, focus distance, march quality, and
 * the orbit-trap mapping (raw trap ranges are formula-dependent).
 *
 * The original Mandelbox/Apollonian shapes carry values copied verbatim from the
 * pre-split presets so their curated pairings reproduce the original image exactly;
 * Reef Spires vs Citadel Ramparts is a deliberate near-duplicate kept for that reason.
 * Shapes for the later formulas are tuned per formula (framing, march quality, and the
 * orbit-trap mapping all track the geometry's scale and raw trap range).
 */

export const REEF_SPIRES: FractalShape = {
  id: "reef-spires",
  name: "Reef Spires",
  description: "Recursive mandelbox crystal spires, framed wide with deep sightlines.",
  formula: "mandelbox",
  formulaSettings: { iterations: 14, values: { scale: 2.82, fold: 1.0, minRadius: 0.5 } },
  camera: { target: [0, 0, 0], yaw: -0.72, pitch: -0.18, distance: 11, fov: 45 },
  focusDistance: 9.5,
  render: { maxSteps: 160, maxDistance: 40, surfaceEpsilon: 0.0004, normalEpsilon: 0.0008 },
  trap: { scale: 1.0, power: 0.5 },
};

export const CARVED_PAGODA: FractalShape = {
  id: "carved-pagoda",
  name: "Carved Pagoda",
  description: "Negative-scale mandelbox tower of stacked, carved relief.",
  formula: "mandelbox",
  formulaSettings: { iterations: 16, values: { scale: -1.9, fold: 1.0, minRadius: 0.5 } },
  camera: { target: [0, 0, 0], yaw: 0.32, pitch: -0.05, distance: 9, fov: 45 },
  focusDistance: 6.5,
  render: { maxSteps: 170, maxDistance: 30, surfaceEpsilon: 0.00035, normalEpsilon: 0.0007 },
  trap: { scale: 1.1, power: 0.45 },
};

export const CITADEL_RAMPARTS: FractalShape = {
  id: "citadel-ramparts",
  name: "Citadel Ramparts",
  description: "Mandelbox ramparts and terraces, seen from across the approach.",
  formula: "mandelbox",
  formulaSettings: { iterations: 14, values: { scale: 2.6, fold: 1.0, minRadius: 0.5 } },
  camera: { target: [0, 0, 0], yaw: 0.9, pitch: -0.1, distance: 10, fov: 45 },
  focusDistance: 8.5,
  render: { maxSteps: 160, maxDistance: 40, surfaceEpsilon: 0.0004, normalEpsilon: 0.0008 },
  trap: { scale: 1.1, power: 0.5 },
};

export const CAVERN_PORES: FractalShape = {
  id: "cavern-pores",
  name: "Cavern Pores",
  description: "Open apollonian cavern, pores and arches close to the lens.",
  formula: "apollonian",
  formulaSettings: { iterations: 9, values: { scale: 1.15 } },
  camera: { target: [0, 0.35, 0.5], yaw: -1.57, pitch: 0.05, distance: 1.0, fov: 55 },
  focusDistance: 0.9,
  render: { maxSteps: 170, maxDistance: 20, surfaceEpsilon: 0.00035, normalEpsilon: 0.0007 },
  trap: { scale: 6.0, power: 0.5 },
};

export const BUBBLE_FOAM: FractalShape = {
  id: "bubble-foam",
  name: "Bubble Foam",
  description: "Apollonian bubble-foam sheets viewed steeply from above.",
  formula: "apollonian",
  formulaSettings: { iterations: 11, values: { scale: 1.3 } },
  camera: { target: [0.5, 0.05, 0.5], yaw: 1.2, pitch: -0.75, distance: 2.2, fov: 50 },
  focusDistance: 2.1,
  render: { maxSteps: 170, maxDistance: 20, surfaceEpsilon: 0.00035, normalEpsilon: 0.0007 },
  trap: { scale: 5.0, power: 0.6 },
};

export const BLOOM_BULB: FractalShape = {
  id: "bloom-bulb",
  name: "Bloom Bulb",
  description: "Classic power-8 mandelbulb, fully in frame.",
  formula: "mandelbulb",
  formulaSettings: { iterations: 9, values: { power: 8 } },
  camera: { target: [0, 0, 0], yaw: 2.2, pitch: -0.15, distance: 3.0, fov: 42 },
  focusDistance: 2.8,
  render: { maxSteps: 180, maxDistance: 24, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.45, power: 0.5 },
};

export const LATTICE_BASTION: FractalShape = {
  id: "lattice-bastion",
  name: "Lattice Bastion",
  description: "Classic Menger sponge, cubic vaults carved to five levels.",
  formula: "menger",
  formulaSettings: { iterations: 5, values: { scale: 3, offset: 1, twist: 0 } },
  camera: { target: [0, 0, 0], yaw: -0.6, pitch: -0.2, distance: 4.5, fov: 45 },
  focusDistance: 4,
  render: { maxSteps: 160, maxDistance: 20, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.25, power: 0.5 },
};

export const THORN_RELIQUARY: FractalShape = {
  id: "thorn-reliquary",
  name: "Thorn Reliquary",
  description: "Kaleidoscopic tetrahedral folds rising into thorned gothic spires.",
  formula: "kifs",
  formulaSettings: {
    iterations: 14,
    values: { scale: 1.85, offset: 1, angle1: 0.25, angle2: 0.3 },
  },
  camera: { target: [0, 0.3, 0], yaw: 0.5, pitch: -0.05, distance: 6.5, fov: 45 },
  focusDistance: 6,
  render: { maxSteps: 170, maxDistance: 20, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 1.0, power: 0.5 },
};

export const TAFFY_BLOOM: FractalShape = {
  id: "taffy-bloom",
  name: "Taffy Bloom",
  description: "Quaternion Julia set, smooth folds pulled like taffy.",
  formula: "quatjulia",
  formulaSettings: { iterations: 9, values: { cx: -0.45, cy: 0.55, cz: 0.35, cw: 0 } },
  camera: { target: [0, 0, 0], yaw: 1.0, pitch: -0.25, distance: 3.8, fov: 42 },
  focusDistance: 3.4,
  render: { maxSteps: 180, maxDistance: 24, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.6, power: 0.5 },
};

export const KLEINIAN_SANCTUM: FractalShape = {
  id: "kleinian-sanctum",
  name: "Kleinian Sanctum",
  description: "Pseudo-Kleinian vault, nested chambers and arches seen from the nave.",
  formula: "kleinian",
  formulaSettings: {
    iterations: 8,
    values: { foldX: 0.925, foldY: 0.91, foldZ: 0.925, inversion: 1 },
  },
  camera: { target: [0, 0.55, 0], yaw: 1.57, pitch: -0.2, distance: 2.2, fov: 50 },
  focusDistance: 2,
  render: { maxSteps: 200, maxDistance: 20, surfaceEpsilon: 0.0004, normalEpsilon: 0.0008 },
  trap: { scale: 2.0, power: 0.5 },
};

export const FROZEN_BLOOM: FractalShape = {
  id: "frozen-bloom",
  name: "Frozen Bloom",
  description: "Julia-mode mandelbulb: the same power-8 family frozen around a fixed seed.",
  formula: "juliabulb",
  formulaSettings: { iterations: 9, values: { power: 8, seedX: 0.35, seedY: 0.1, seedZ: 0.2 } },
  camera: { target: [0, 0, 0], yaw: 2.2, pitch: -0.15, distance: 3.0, fov: 42 },
  focusDistance: 2.8,
  render: { maxSteps: 180, maxDistance: 24, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.45, power: 0.5 },
};

export const AMAZING_SPIRE: FractalShape = {
  id: "amazing-spire",
  name: "Amazing Spire",
  description: "Rotated Amazing Box folds spiraling into a solid 3D structure of carved spires.",
  formula: "amazingbox",
  formulaSettings: {
    iterations: 14,
    values: { scale: 2.0, fold: 1.0, minRadius: 0.5, rotate: 0.2 },
  },
  camera: { target: [0, 0, 0], yaw: -0.6, pitch: -0.18, distance: 7.0, fov: 45 },
  focusDistance: 6.0,
  render: { maxSteps: 170, maxDistance: 40, surfaceEpsilon: 0.0004, normalEpsilon: 0.0008 },
  trap: { scale: 1.0, power: 0.5 },
};

export const TETRA_GASKET: FractalShape = {
  id: "tetra-gasket",
  name: "Tetra Gasket",
  description: "Canonical scale-2 Sierpinski tetrahedron, the sharp recursive gasket.",
  formula: "sierpinski",
  formulaSettings: { iterations: 15, values: { scale: 2, offset: 1, angle: 0 } },
  camera: { target: [0, 0, 0], yaw: 0.7, pitch: -0.2, distance: 5.0, fov: 45 },
  focusDistance: 4.5,
  render: { maxSteps: 170, maxDistance: 20, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 1.0, power: 0.5 },
};

export const DIAMOND_LATTICE: FractalShape = {
  id: "diamond-lattice",
  name: "Diamond Lattice",
  description: "Octahedral IFS - a clean diamond-symmetry counterpoint to the cubic sponge.",
  formula: "octahedral",
  formulaSettings: { iterations: 14, values: { scale: 2, offset: 1, angle: 0 } },
  camera: { target: [0, 0, 0], yaw: -0.5, pitch: -0.2, distance: 5.0, fov: 45 },
  focusDistance: 4.5,
  render: { maxSteps: 170, maxDistance: 20, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.5, power: 0.5 },
};

export const CROSS_VAULT: FractalShape = {
  id: "cross-vault",
  name: "Cross Vault",
  description: "Menger variant with dual-axis twist carving cross channels through the lattice.",
  formula: "crossmenger",
  formulaSettings: { iterations: 5, values: { scale: 3, offset: 1, twistX: 0.15, twistY: 0.1 } },
  camera: { target: [0, 0, 0], yaw: -0.6, pitch: -0.2, distance: 4.5, fov: 45 },
  focusDistance: 4,
  render: { maxSteps: 160, maxDistance: 20, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.4, power: 0.6 },
};

export const BICOMPLEX_DRIFT: FractalShape = {
  id: "bicomplex-drift",
  name: "Bicomplex Drift",
  description: "Hypercomplex Julia set - exotic 4D shapes distinct from the quaternion lane.",
  formula: "bicomplex",
  formulaSettings: { iterations: 9, values: { cx: -0.2, cy: 0.4, cz: -0.25, cw: 0 } },
  camera: { target: [0, 0, 0], yaw: 1.0, pitch: -0.25, distance: 3.8, fov: 42 },
  focusDistance: 3.4,
  render: { maxSteps: 180, maxDistance: 24, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 1.4, power: 0.65 },
};

export const WISP_BLOOM: FractalShape = {
  id: "wisp-bloom",
  name: "Wisp Bloom",
  description: "Sinusoidal bulb - a bulb domain-warped by sine into wispy, alien tendrils.",
  formula: "trigbulb",
  formulaSettings: { iterations: 8, values: { power: 8, amp: 0.15, freq: 2 } },
  camera: { target: [0, 0, 0], yaw: 2.2, pitch: -0.15, distance: 3.0, fov: 42 },
  focusDistance: 2.8,
  render: { maxSteps: 200, maxDistance: 24, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.45, power: 0.6 },
};

export const BUBBLE_ORB: FractalShape = {
  id: "bubble-orb",
  name: "Bubble Orb",
  description: "A solid ball carved into Swiss-cheese foam by bubbles at ever-finer scales.",
  formula: "spherepack",
  formulaSettings: { iterations: 4, values: { holes: 0.7, radius: 1.0 } },
  camera: { target: [0, 0, 0], yaw: 0.6, pitch: -0.2, distance: 3.0, fov: 45 },
  focusDistance: 2.8,
  render: { maxSteps: 180, maxDistance: 20, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 1.0, power: 0.5 },
};

export const SPONGE_BALL: FractalShape = {
  id: "sponge-ball",
  name: "Sponge Ball",
  description: "A solid ball with Menger holes bored clean through it, seen from outside.",
  formula: "mengersphere",
  formulaSettings: { iterations: 5, values: { scale: 3, offset: 1, radius: 0.9 } },
  camera: { target: [0, 0, 0], yaw: -0.5, pitch: -0.2, distance: 3.0, fov: 45 },
  focusDistance: 2.8,
  render: { maxSteps: 170, maxDistance: 20, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.4, power: 0.6 },
};

export const FOAM_ORB: FractalShape = {
  id: "foam-orb",
  name: "Foam Orb",
  description: "A sphere of nested Kleinian chambers and round openings - the holey-sphere look.",
  formula: "kleinsphere",
  formulaSettings: { iterations: 8, values: { fold: 0.6, inversion: 1, radius: 1.1 } },
  camera: { target: [0, 0, 0], yaw: 1.0, pitch: -0.15, distance: 3.4, fov: 48 },
  focusDistance: 3.1,
  render: { maxSteps: 200, maxDistance: 20, surfaceEpsilon: 0.0004, normalEpsilon: 0.0008 },
  trap: { scale: 2.0, power: 0.5 },
};

export const CORAL_BLOOM: FractalShape = {
  id: "coral-bloom",
  name: "Coral Bloom",
  description: "Smooth-union DIFS: spheres fused level by level into fleshy, branching coral.",
  formula: "coral",
  formulaSettings: { iterations: 12, values: { scale: 2.0, fold: 1.0, rotate: 0.3, smooth: 0.25 } },
  camera: { target: [0, 0, 0], yaw: 2.2, pitch: -0.15, distance: 3.2, fov: 42 },
  focusDistance: 3.0,
  render: { maxSteps: 200, maxDistance: 24, surfaceEpsilon: 0.0003, normalEpsilon: 0.0006 },
  trap: { scale: 0.5, power: 0.5 },
};

export const SHAPES: readonly FractalShape[] = [
  REEF_SPIRES,
  CARVED_PAGODA,
  CITADEL_RAMPARTS,
  CAVERN_PORES,
  BUBBLE_FOAM,
  BLOOM_BULB,
  LATTICE_BASTION,
  THORN_RELIQUARY,
  TAFFY_BLOOM,
  KLEINIAN_SANCTUM,
  FROZEN_BLOOM,
  AMAZING_SPIRE,
  TETRA_GASKET,
  DIAMOND_LATTICE,
  CROSS_VAULT,
  BICOMPLEX_DRIFT,
  WISP_BLOOM,
  BUBBLE_ORB,
  SPONGE_BALL,
  FOAM_ORB,
  CORAL_BLOOM,
];

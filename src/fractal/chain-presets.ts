import type { FormulaChain } from "./types";

/**
 * Canonical hybrid chains (hybrid-formula-chains design).
 *
 * The two `*_AS_CHAIN` presets re-express atomic formulas as transform chains and exist to
 * prove the codegen/interpreter reproduce the atomic DE exactly (chain.test.ts). They use
 * each formula's registry default params so the equivalence check lines up with the CPU
 * mirror's defaults. The genuinely-new hybrids (e.g. BOX_BULB) are the point of the feature:
 * an operator mix no single atomic formula expresses.
 */

/** Mandelbox (scale 2.8, fold 1.0, minRadius 0.5) as boxFold -> sphereFold -> scale + c. */
export const MANDELBOX_AS_CHAIN: FormulaChain = {
  stages: [
    { transform: "boxFold", values: { fold: 1.0 } },
    { transform: "sphereFold", values: { minRadius: 0.5 } },
    { transform: "scaleAddC", values: { scale: 2.8 } },
  ],
  iterations: 14,
  addC: true,
  bailout: Infinity,
  deForm: "linear",
};

/** Mandelbulb (power 8) as a single bulbPow stage with escape-time reinjection. */
export const MANDELBULB_AS_CHAIN: FormulaChain = {
  stages: [{ transform: "bulbPow", values: { power: 8 } }],
  iterations: 8,
  addC: true,
  bailout: 2,
  deForm: "log",
};

/**
 * A true hybrid: a box-fold cellular grid, sphere-fold inflation, then a low-power bulb lobe
 * per iteration with a rotation spinning it - the stacked-operator structure MB3D hybrids get
 * their architectural look from, expressible only as a chain.
 */
export const BOX_BULB: FormulaChain = {
  stages: [
    { transform: "boxFold", values: { fold: 1.0 } },
    { transform: "sphereFold", values: { minRadius: 0.5 } },
    { transform: "bulbPow", values: { power: 4 } },
    { transform: "rotate", values: { angle: 0.4, axis: 1 } },
  ],
  iterations: 24,
  addC: true,
  bailout: 6,
  deForm: "linear",
};

/**
 * Building-block hybrids exercising the Phase 3 transforms. Each is a DE-valid starting point
 * (finiteness is locked in chain.test.ts), not a framed/colour-tuned curated shape - those need
 * GPU iteration on the camera/trap, tracked as a follow-up.
 */

/** A spun Menger lattice: rotate -> abs/sort fold -> scale, run as a pure IFS attractor. */
export const MENGER_SPIRE: FormulaChain = {
  stages: [
    { transform: "rotate", values: { angle: 0.5, axis: 1 } },
    { transform: "mengerFold", values: { offset: 1 } },
    { transform: "scaleAddC", values: { scale: 2 } },
  ],
  iterations: 20,
  addC: false,
  bailout: Infinity,
  deForm: "linear",
};

/** Apollonian-flavoured foam: period-2 lattice fold then a sphere inversion, pure IFS. */
export const KLEIN_FOAM: FormulaChain = {
  stages: [
    { transform: "latticeFold", values: {} },
    { transform: "sphereInvert", values: { factor: 1 } },
  ],
  iterations: 16,
  addC: false,
  bailout: Infinity,
  deForm: "linear",
};

/** A trigbulb-like lobe: a bulb power per iteration, then a sinusoidal domain warp. */
export const SIN_BULB: FormulaChain = {
  stages: [
    { transform: "bulbPow", values: { power: 8 } },
    { transform: "sinWarp", values: { amp: 0.1, freq: 2 } },
  ],
  iterations: 8,
  addC: true,
  bailout: 2,
  deForm: "log",
};

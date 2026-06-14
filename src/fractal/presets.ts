import { AMETHYST_TIDE, DESERT_SUN, MOONLIT_LANTERNS, WET_JADE } from "./looks";
import {
  BLOOM_BULB,
  BUBBLE_FOAM,
  CITADEL_RAMPARTS,
  KLEINIAN_SANCTUM,
  REEF_SPIRES,
  THORN_RELIQUARY,
} from "./shapes";
import type { FractalPreset, FractalShape, Look } from "./types";

/**
 * Curated presets (ADR-0007, recast by ADR-0010): each is now a named shape × look
 * pairing instead of a monolithic snapshot. The pairings reproduce the original
 * M2/M5 images exactly; the halves live in `shapes.ts` and `looks.ts`.
 */

const pair = (
  id: string,
  name: string,
  description: string,
  shape: FractalShape,
  look: Look,
): FractalPreset => ({ id, name, description, shape, look });

export const PRESETS: readonly FractalPreset[] = [
  pair(
    "crystal-reef",
    "Crystal Reef",
    "Purple/cyan recursive crystals with shallow focus.",
    REEF_SPIRES,
    AMETHYST_TIDE,
  ),
  pair(
    "verdant-bloom",
    "Verdant Bloom",
    "Green mandelbulb, wet glossy surface, single hard key light.",
    BLOOM_BULB,
    WET_JADE,
  ),
  pair(
    "sunlit-citadel",
    "Sunlit Citadel",
    "Low Preetham sun raking warm light across sandstone ramparts.",
    CITADEL_RAMPARTS,
    DESERT_SUN,
  ),
  pair(
    "lantern-grotto",
    "Lantern Grotto",
    "Moonless night; the bubble foam glows from warm lantern pores.",
    BUBBLE_FOAM,
    MOONLIT_LANTERNS,
  ),
  pair(
    "sunstone-reliquary",
    "Sunstone Reliquary",
    "Thorned kaleidoscopic spires in low raking desert sun, sandstone tones.",
    THORN_RELIQUARY,
    DESERT_SUN,
  ),
  pair(
    "amethyst-sanctum",
    "Amethyst Sanctum",
    "Pseudo-Kleinian vaults in glossy purple/cyan crystal, lit from the nave.",
    KLEINIAN_SANCTUM,
    AMETHYST_TIDE,
  ),
];

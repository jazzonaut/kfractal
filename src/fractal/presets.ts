import {
  AMETHYST_TIDE,
  DESERT_SUN,
  EMBER_STORM,
  GILDED_HAZE,
  INNER_FIRE,
  MOONLIT_LANTERNS,
  MOSSY_BACKLIGHT,
  WARM_IVORY,
  WET_JADE,
} from "./looks";
import {
  BLOOM_BULB,
  BUBBLE_FOAM,
  CARVED_PAGODA,
  CAVERN_PORES,
  CITADEL_RAMPARTS,
  KLEINIAN_SANCTUM,
  LATTICE_BASTION,
  PLASTER_RELIEF,
  REEF_SPIRES,
  TAFFY_BLOOM,
  THORN_RELIQUARY,
  VAULT_LATTICE,
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
    "Purple/cyan recursive crystals with shallow FPT-style focus.",
    REEF_SPIRES,
    AMETHYST_TIDE,
  ),
  pair(
    "ivory-pagoda",
    "Ivory Pagoda",
    "Beige recursive tower in warm soft light, heavy depth of field.",
    CARVED_PAGODA,
    WARM_IVORY,
  ),
  pair(
    "ember-vault",
    "Ember Vault",
    "Apollonian lattice glowing white-hot from inside, black negative space.",
    VAULT_LATTICE,
    INNER_FIRE,
  ),
  pair(
    "moss-foam",
    "Moss Foam",
    "Backlit apollonian bubble-foam sheets, olive green with bright pores.",
    BUBBLE_FOAM,
    MOSSY_BACKLIGHT,
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
    "gilded-dusk",
    "Gilded Dusk",
    "Carved plaster relief soaked in a golden procedural dusk.",
    PLASTER_RELIEF,
    GILDED_HAZE,
  ),
  pair(
    "ember-sky",
    "Ember Sky",
    "A burning procedural sky over an apollonian cavern lit from within.",
    CAVERN_PORES,
    EMBER_STORM,
  ),
  pair(
    "lantern-grotto",
    "Lantern Grotto",
    "Moonless night; the bubble foam glows from warm lantern pores.",
    BUBBLE_FOAM,
    MOONLIT_LANTERNS,
  ),
  pair(
    "ivory-lattice",
    "Ivory Lattice",
    "Menger sponge in pale carved ivory, soft warm key and deep focus falloff.",
    LATTICE_BASTION,
    WARM_IVORY,
  ),
  pair(
    "sunstone-reliquary",
    "Sunstone Reliquary",
    "Thorned kaleidoscopic spires in low raking desert sun, sandstone tones.",
    THORN_RELIQUARY,
    DESERT_SUN,
  ),
  pair(
    "amethyst-taffy",
    "Amethyst Taffy",
    "Quaternion Julia swirl in glossy purple/cyan crystal tones.",
    TAFFY_BLOOM,
    AMETHYST_TIDE,
  ),
  pair(
    "amethyst-sanctum",
    "Amethyst Sanctum",
    "Pseudo-Kleinian vaults in glossy purple/cyan crystal, lit from the nave.",
    KLEINIAN_SANCTUM,
    AMETHYST_TIDE,
  ),
];

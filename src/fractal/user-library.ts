import {
  clampLookToEnvironments,
  clampShapeToRegistry,
  userLookSchema,
  userPresetSchema,
  userShapeSchema,
} from "./library-codec";
import type { UserLook, UserPreset, UserShape } from "./types";

/**
 * The user library in localStorage (ADR-0007, recast by ADR-0010): one blob holding the
 * three authorable kinds. Plain explicit read/write - not a reactive composable - so
 * quota failures have one seam, and the controller (which lives outside Vue) can own
 * the in-memory lists.
 */

const STORAGE_KEY = "kf.library.user";

/**
 * Stamped on write and required to match on read; a mismatched blob is ignored wholesale.
 * Bumped to 3 when `effects.growth` became a required schema field (its `.default()` was
 * removed), so a pre-growth blob is rejected as a unit rather than silently thinned of the
 * looks that predate it - keeping this path's "older = reject" stance identical to the
 * file-import version guard.
 */
const STORAGE_VERSION = 3;

export interface UserLibrary {
  shapes: UserShape[];
  looks: UserLook[];
  presets: UserPreset[];
}

interface StorageBlob {
  readonly version: number;
  readonly shapes: readonly UserShape[];
  readonly looks: readonly UserLook[];
  readonly presets: readonly UserPreset[];
}

const EMPTY = (): UserLibrary => ({ shapes: [], looks: [], presets: [] });

function parseList<T>(
  entries: unknown,
  schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } },
  label: string,
): T[] {
  if (!Array.isArray(entries)) return [];
  const items: T[] = [];
  for (const entry of entries) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) {
      items.push(parsed.data as T);
    } else {
      console.warn(`KFractal: dropping invalid stored ${label}.`);
    }
  }
  return items;
}

/**
 * Reads the library, dropping anything unusable: an unparseable or wrong-version blob
 * yields an empty library (the raw value is left in place, nothing is destroyed), and
 * individually invalid entries are skipped with a warning rather than nuking the rest.
 */
export function loadUserLibrary(): UserLibrary {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY();
  }
  if (!raw) return EMPTY();

  let blob: unknown;
  try {
    blob = JSON.parse(raw);
  } catch {
    console.warn(`KFractal: ignoring unparseable ${STORAGE_KEY} blob.`);
    return EMPTY();
  }
  const candidate = blob as Partial<StorageBlob>;
  if (candidate.version !== STORAGE_VERSION) {
    console.warn(`KFractal: ignoring ${STORAGE_KEY} blob with unknown version.`);
    return EMPTY();
  }
  // Clamp on load to the same registry/environment ranges the file-import path enforces
  // (library-codec.parseLibraryFile): both feed the GPU, so a stored blob written by an older
  // build or hand-edited must not push out-of-range values straight to a uniform slot. The
  // clamp helpers preserve the createdAt/updatedAt stamps via spread.
  return {
    shapes: parseList<UserShape>(candidate.shapes, userShapeSchema, "shape").map(
      (shape) => clampShapeToRegistry(shape) as UserShape,
    ),
    looks: parseList<UserLook>(candidate.looks, userLookSchema, "look").map(
      (look) => clampLookToEnvironments(look) as UserLook,
    ),
    presets: parseList<UserPreset>(candidate.presets, userPresetSchema, "preset").map((preset) => ({
      ...preset,
      shape: clampShapeToRegistry(preset.shape),
      look: clampLookToEnvironments(preset.look),
    })),
  };
}

/** Returns false on write failure (quota, privacy mode); the in-memory lists are unaffected. */
export function saveUserLibrary(library: UserLibrary): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...library }));
    return true;
  } catch {
    return false;
  }
}

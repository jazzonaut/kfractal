import {
  clampLookToEnvironments,
  clampShapeToRegistry,
  migrateLookLightV4,
  userLookSchema,
  userPresetSchema,
  userShapeSchema,
} from "./library-codec";
import type { UserLook, UserPreset, UserShape } from "./types";

/**
 * The user library in localStorage (ADR-0007, recast by ADR-0010): one blob holding the
 * three authorable kinds. Plain explicit read/write - not a reactive composable - so
 * quota failures and schema migration have one seam, and the controller (which lives
 * outside Vue) can own the in-memory lists.
 *
 * Replaces the pre-split `kf.presets.user` key (pre-release, intentionally abandoned).
 */

const STORAGE_KEY = "kf.library.user";

/**
 * Bumped when the stored blob changes shape; `loadUserLibrary` is the migration seam.
 * Version 2 replaces the single look light with `ambient` + a `lights` array; v1 blobs
 * are migrated on load (the schemas would otherwise silently drop every stored look).
 */
const STORAGE_VERSION = 2;

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
  let looks: unknown = candidate.looks;
  let presets: unknown = candidate.presets;
  if (candidate.version === 1) {
    looks = Array.isArray(looks) ? looks.map(migrateLookLightV4) : looks;
    presets = Array.isArray(presets)
      ? presets.map((p: unknown) =>
          typeof p === "object" && p !== null
            ? { ...p, look: migrateLookLightV4((p as { look?: unknown }).look) }
            : p,
        )
      : presets;
  } else if (candidate.version !== STORAGE_VERSION) {
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
    looks: parseList<UserLook>(looks, userLookSchema, "look").map(
      (look) => clampLookToEnvironments(look) as UserLook,
    ),
    presets: parseList<UserPreset>(presets, userPresetSchema, "preset").map((preset) => ({
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUserLibrary, saveUserLibrary } from "../../src/fractal/user-library";
import { SHAPES } from "../../src/fractal/shapes";
import type { UserShape } from "../../src/fractal/types";

const STORAGE_KEY = "kf.library.user";

/** Minimal in-memory localStorage with hooks to force getItem/setItem failures. */
class MockStorage {
  store = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(key: string): string | null {
    if (this.failGet) throw new Error("blocked");
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new Error("quota");
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

let mock: MockStorage;

const userShape = (over: Partial<UserShape> = {}): UserShape => ({
  ...SHAPES[0]!,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  mock = new MockStorage();
  vi.stubGlobal("localStorage", mock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadUserLibrary", () => {
  it("returns an empty library when nothing is stored", () => {
    expect(loadUserLibrary()).toEqual({ shapes: [], looks: [], presets: [] });
  });

  it("returns empty (never throws) when localStorage access throws", () => {
    mock.failGet = true;
    expect(loadUserLibrary()).toEqual({ shapes: [], looks: [], presets: [] });
  });

  it("returns empty and warns on unparseable JSON without destroying the raw value", () => {
    mock.store.set(STORAGE_KEY, "not json{");
    expect(loadUserLibrary()).toEqual({ shapes: [], looks: [], presets: [] });
    expect(console.warn).toHaveBeenCalled();
    expect(mock.store.get(STORAGE_KEY)).toBe("not json{");
  });

  it("returns empty for an unknown blob version", () => {
    mock.store.set(STORAGE_KEY, JSON.stringify({ version: 999, shapes: [userShape()] }));
    expect(loadUserLibrary().shapes).toHaveLength(0);
  });

  it("loads valid current-version items", () => {
    saveUserLibrary({ shapes: [userShape()], looks: [], presets: [] });
    const lib = loadUserLibrary();
    expect(lib.shapes).toHaveLength(1);
    expect(lib.shapes[0]!.formula).toBe(SHAPES[0]!.formula);
  });

  it("drops only the invalid entries in a list, keeping the valid ones", () => {
    mock.store.set(
      STORAGE_KEY,
      JSON.stringify({
        version: 3,
        shapes: [userShape(), { garbage: true }],
        looks: [],
        presets: [],
      }),
    );
    const lib = loadUserLibrary();
    expect(lib.shapes).toHaveLength(1);
    expect(console.warn).toHaveBeenCalled();
  });
});

describe("saveUserLibrary", () => {
  it("writes the current storage version and returns true", () => {
    expect(saveUserLibrary({ shapes: [userShape()], looks: [], presets: [] })).toBe(true);
    const blob = JSON.parse(mock.store.get(STORAGE_KEY)!) as { version: number; shapes: unknown[] };
    expect(blob.version).toBe(3);
    expect(blob.shapes).toHaveLength(1);
  });

  it("returns false on a write failure without throwing", () => {
    mock.failSet = true;
    expect(saveUserLibrary({ shapes: [], looks: [], presets: [] })).toBe(false);
  });
});

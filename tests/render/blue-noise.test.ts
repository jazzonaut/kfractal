import { describe, expect, it } from "vitest";
import { BLUE_NOISE_SIZE, generateBlueNoiseChannel } from "../../src/render/blue-noise";

const N = BLUE_NOISE_SIZE * BLUE_NOISE_SIZE;

/** Toroidal mean nearest-neighbour distance for a point set on the SIZE x SIZE grid. */
function meanNearestNeighbour(indices: number[]): number {
  const xs = indices.map((i) => i % BLUE_NOISE_SIZE);
  const ys = indices.map((i) => Math.floor(i / BLUE_NOISE_SIZE));
  let total = 0;
  for (let a = 0; a < indices.length; a += 1) {
    let best = Infinity;
    for (let b = 0; b < indices.length; b += 1) {
      if (a === b) continue;
      let dx = Math.abs(xs[a]! - xs[b]!);
      let dy = Math.abs(ys[a]! - ys[b]!);
      if (dx > BLUE_NOISE_SIZE / 2) dx = BLUE_NOISE_SIZE - dx;
      if (dy > BLUE_NOISE_SIZE / 2) dy = BLUE_NOISE_SIZE - dy;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    total += Math.sqrt(best);
  }
  return total / indices.length;
}

describe("blue-noise void-and-cluster", () => {
  const channel = generateBlueNoiseChannel(0x9e3779b9);

  it("covers every rank exactly once (a full permutation)", () => {
    expect(channel.length).toBe(N);
    const seen = new Uint8Array(N);
    for (const v of channel) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const rank = Math.round(v * N - 0.5);
      expect(seen[rank]).toBe(0);
      seen[rank] = 1;
    }
    expect(seen.every((s) => s === 1)).toBe(true);
  });

  it("has a uniform value histogram (mean ~ 0.5)", () => {
    const mean = channel.reduce((a, b) => a + b, 0) / N;
    expect(mean).toBeCloseTo(0.5, 2);
  });

  it("distributes a thresholded point set with blue-noise spacing", () => {
    // At a sparse threshold the on-set should be spread far more evenly than a random set of
    // the same size: blue noise maximises the minimum spacing, so its mean nearest-neighbour
    // distance comfortably exceeds the white-noise baseline. (At ~50% density both sets hit
    // the grid's adjacency floor, so the property is only visible while sparse.)
    const onSet: number[] = [];
    for (let i = 0; i < N; i += 1) if (channel[i]! < 0.1) onSet.push(i);

    // White-noise baseline: the SAME count of points placed by a plain pseudo-random shuffle.
    let a = 0x12345678;
    const rand = (): number => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const all = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [all[i], all[j]] = [all[j]!, all[i]!];
    }
    const whiteSet = all.slice(0, onSet.length);

    const blue = meanNearestNeighbour(onSet);
    const white = meanNearestNeighbour(whiteSet);
    expect(blue).toBeGreaterThan(white * 1.25);
  });

  it("produces decorrelated channels from different seeds", () => {
    const other = generateBlueNoiseChannel(0x85ebca6b);
    let identical = 0;
    for (let i = 0; i < N; i += 1) if (channel[i] === other[i]) identical += 1;
    // Two independent permutations should almost never agree per cell.
    expect(identical).toBeLessThan(N * 0.05);
  });
});

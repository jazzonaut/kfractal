import { describe, expect, it } from "vitest";
import { PreviewQuality, initialPreviewScale } from "../../src/render/preview-quality";

// PreviewQuality is pure (no DOM, no clock): the engine feeds it active-preview frame times
// and re-applies the returned scale. These cover the ladder stepping, hysteresis gap, and the
// post-change cooldown that keeps a resize spike from immediately re-triggering.

const TIERS = [1, 0.75, 0.5, 0.33];

/** Feed `count` frames at `ms` each; return how many of them reported a scale change. */
function feed(q: PreviewQuality, ms: number, count: number): number {
  let changes = 0;
  for (let i = 0; i < count; i += 1) {
    if (q.sample(ms / 1000)) changes += 1;
  }
  return changes;
}

describe("PreviewQuality", () => {
  it("starts at native scale and snaps the initial scale to the nearest tier", () => {
    expect(new PreviewQuality({ tiers: TIERS }).scale).toBe(1);
    expect(new PreviewQuality({ tiers: TIERS, initialScale: 0.55 }).scale).toBe(0.5);
    expect(new PreviewQuality({ tiers: TIERS, initialScale: 0.1 }).scale).toBe(0.33);
  });

  it("does not change scale before a full window of samples", () => {
    const q = new PreviewQuality({ tiers: TIERS, window: 10, dwell: 0, dropAboveMs: 40 });
    expect(feed(q, 100, 9)).toBe(0);
    expect(q.scale).toBe(1);
  });

  it("drops one tier when sustained frames exceed the drop threshold", () => {
    const q = new PreviewQuality({ tiers: TIERS, window: 8, dwell: 8, dropAboveMs: 40 });
    const changes = feed(q, 100, 8); // far above 40ms
    expect(changes).toBe(1);
    expect(q.scale).toBe(0.75);
  });

  it("waits out the cooldown before dropping again (debounce)", () => {
    const q = new PreviewQuality({ tiers: TIERS, window: 4, dwell: 6, dropAboveMs: 40 });
    expect(feed(q, 100, 4)).toBe(1); // first drop -> 0.75
    expect(q.scale).toBe(0.75);
    // The next 6 slow frames are swallowed by the cooldown; only after it can a window build.
    const changes = feed(q, 100, 6 + 4);
    expect(changes).toBe(1);
    expect(q.scale).toBe(0.5);
  });

  it("raises a tier when sustained frames are comfortably under the raise threshold", () => {
    const q = new PreviewQuality({
      tiers: TIERS,
      initialScale: 0.5,
      window: 6,
      dwell: 0,
      raiseBelowMs: 18,
    });
    expect(feed(q, 10, 6)).toBe(1); // 10ms << 18ms
    expect(q.scale).toBe(0.75);
  });

  it("clamps at the bottom and top of the ladder", () => {
    const low = new PreviewQuality({ tiers: TIERS, initialScale: 0.33, window: 4, dwell: 0 });
    expect(feed(low, 100, 40)).toBe(0); // already at the smallest tier
    expect(low.scale).toBe(0.33);

    const high = new PreviewQuality({ tiers: TIERS, window: 4, dwell: 0, raiseBelowMs: 18 });
    expect(feed(high, 5, 40)).toBe(0); // already native
    expect(high.scale).toBe(1);
  });

  it("holds scale in the hysteresis band (between raise and drop thresholds)", () => {
    const q = new PreviewQuality({
      tiers: TIERS,
      initialScale: 0.5,
      window: 6,
      dwell: 0,
      dropAboveMs: 40,
      raiseBelowMs: 18,
    });
    expect(feed(q, 28, 60)).toBe(0); // 18ms < 28ms < 40ms: no movement either way
    expect(q.scale).toBe(0.5);
  });

  it("resets the rolling window", () => {
    const q = new PreviewQuality({ tiers: TIERS, window: 8, dwell: 0, dropAboveMs: 40 });
    feed(q, 100, 7); // 7 < window, no decision yet
    q.reset();
    expect(feed(q, 100, 7)).toBe(0); // window restarted, still one short
    expect(q.scale).toBe(1);
  });

  it("returns native scale in a non-window environment", () => {
    // No `window` global under the node test env: the boot guess must not throw.
    expect(initialPreviewScale()).toBe(1);
  });
});

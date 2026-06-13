import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { DiveController } from "../../src/render/dive";

// DiveController's constructor touches no DOM globals (only Three.js math types), so the
// pure depth/budget scaling and persistence contract are testable in the node env. The
// stateful steering loop (assist) needs a live GPU camera and stays in the Playwright
// dive-smoke harness.

const ITERS_PER_OCTAVE = 0.75;
const MAX_EXTRA_ITERS = 16;
const MARCH_STEPS_CAP_FACTOR = 5;

describe("DiveController defaults", () => {
  it("starts at the identity transform with assist OFF (manual control by default)", () => {
    const d = new DiveController();
    expect(d.assist).toBe(false);
    expect(d.scale).toBe(1);
    expect(d.offset.lengthSq()).toBe(0);
    expect(d.basis.equals(new THREE.Matrix3())).toBe(true);
  });
});

describe("DiveController.extraIterations", () => {
  it("adds nothing while the view extent is still >= 1", () => {
    const d = new DiveController();
    expect(d.extraIterations(2)).toBe(0); // scale 1 * distance 2
    expect(d.extraIterations(1)).toBe(0);
  });

  it("adds log2-scaled iterations as the extent shrinks, capped at the max", () => {
    const d = new DiveController();
    // extent = 0.25 -> log2(4) = 2 octaves.
    expect(d.extraIterations(0.25)).toBe(Math.round(2 * ITERS_PER_OCTAVE));
    // A deep dive saturates the cap.
    d.scale = 1e-9;
    expect(d.extraIterations(1)).toBe(MAX_EXTRA_ITERS);
  });
});

describe("DiveController.marchSteps", () => {
  it("returns the base budget while the extent is >= 1", () => {
    const d = new DiveController();
    expect(d.marchSteps(128, 5)).toBe(128);
  });

  it("grows the budget as the extent shrinks, capped at 5x", () => {
    const d = new DiveController();
    const grown = d.marchSteps(128, 0.1);
    expect(grown).toBeGreaterThan(128);
    d.scale = 1e-12;
    expect(d.marchSteps(128, 1)).toBe(128 * MARCH_STEPS_CAP_FACTOR);
  });
});

describe("DiveController.maxDistance", () => {
  it("never shrinks below the base and guarantees pocket visibility as scale drops", () => {
    const d = new DiveController();
    expect(d.maxDistance(3)).toBe(6); // 6 / scale(1) beats base 3
    expect(d.maxDistance(10)).toBe(10); // base wins when larger
    d.scale = 1e-3;
    expect(d.maxDistance(10)).toBe(6 / 1e-3);
  });

  it("is capped at 1e6", () => {
    const d = new DiveController();
    d.scale = 1e-12;
    expect(d.maxDistance(10)).toBe(1e6);
  });
});

describe("DiveController frame() / restore() persistence (ADR-0010)", () => {
  it("returns undefined at the identity transform", () => {
    expect(new DiveController().frame()).toBeUndefined();
  });

  it("round-trips a non-trivial transform exactly", () => {
    const a = new DiveController();
    a.offset.set(1.5, -2.25, 0.5);
    a.scale = 0.125;
    const snap = a.frame();
    expect(snap).toBeDefined();

    const b = new DiveController();
    b.restore(snap);
    expect(b.scale).toBe(0.125);
    expect(b.offset.toArray()).toEqual([1.5, -2.25, 0.5]);
    expect(b.frame()).toEqual(snap);
  });

  it("restore(undefined) resets to the identity transform", () => {
    const d = new DiveController();
    d.offset.set(5, 5, 5);
    d.scale = 0.01;
    d.restore(undefined);
    expect(d.scale).toBe(1);
    expect(d.offset.lengthSq()).toBe(0);
    expect(d.frame()).toBeUndefined();
  });
});

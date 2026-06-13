import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as THREE from "three/webgpu";

// Stage's constructor reads window.innerWidth/Height for the initial aspect. Stub it
// (no jsdom dependency) so the pure camera math is exercisable in the node test env.
beforeAll(() => {
  vi.stubGlobal("window", { innerWidth: 1920, innerHeight: 1080 });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

// Imported after the stub is installed.
const { Stage } = await import("../../src/render/stage");

const MAX_PITCH = 1.45;

describe("Stage orbit / dolly clamps", () => {
  it("clamps pitch to +/- MAX_PITCH", () => {
    const s = new Stage();
    s.orbit(0, 100);
    expect(s.pitch).toBeCloseTo(MAX_PITCH, 12);
    s.orbit(0, -100);
    expect(s.pitch).toBeCloseTo(-MAX_PITCH, 12);
  });

  it("accumulates yaw without clamping", () => {
    const s = new Stage();
    s.orbit(0.5, 0);
    s.orbit(0.5, 0);
    expect(s.yaw).toBeCloseTo(1.0, 12);
  });

  it("clamps dolly distance to [0.2, 200]", () => {
    const s = new Stage();
    s.dolly(1000);
    expect(s.distance).toBeLessThanOrEqual(200);
    s.dolly(-1000);
    expect(s.distance).toBeGreaterThanOrEqual(0.2);
  });
});

describe("Stage.retargetAt (L5: camera position stays fixed)", () => {
  it("sets the pivot to the point exactly when no pitch clamp is needed", () => {
    const s = new Stage();
    const camBefore = s.camera.position.clone();
    const point = new THREE.Vector3(1, 0.5, 0);
    s.retargetAt(point);
    expect(s.camera.position.distanceTo(camBefore)).toBeLessThan(1e-9);
    expect(s.target.distanceTo(point)).toBeLessThan(1e-9);
  });

  it("keeps the camera fixed even when the derived pitch clamps", () => {
    const s = new Stage();
    const camBefore = s.camera.position.clone();
    // A nearly-vertical camera->point vector forces asin past MAX_PITCH.
    const point = new THREE.Vector3(0, -100, 5);
    s.retargetAt(point);
    expect(Math.abs(s.pitch)).toBeCloseTo(MAX_PITCH, 9);
    // Contract: camera position is preserved (the clamp shifts the pivot, not the view).
    expect(s.camera.position.distanceTo(camBefore)).toBeLessThan(1e-6);
    // ...and the pivot is therefore NOT the requested point.
    expect(s.target.distanceTo(point)).toBeGreaterThan(0.1);
  });

  it("is a no-op for a point coincident with the camera", () => {
    const s = new Stage();
    const before = { yaw: s.yaw, pitch: s.pitch, distance: s.distance };
    s.retargetAt(s.camera.position.clone());
    expect(s.yaw).toBe(before.yaw);
    expect(s.distance).toBe(before.distance);
  });
});

describe("Stage misc", () => {
  it("setFov updates the camera fov", () => {
    const s = new Stage();
    s.setFov(60);
    expect(s.camera.fov).toBe(60);
  });

  it("resize updates the aspect ratio", () => {
    const s = new Stage();
    s.resize(800, 400);
    expect(s.camera.aspect).toBeCloseTo(2, 12);
  });

  it("rebase recentres the pivot at the origin and sets distance", () => {
    const s = new Stage();
    s.target.set(3, 3, 3);
    s.rebase(7);
    expect(s.target.length()).toBe(0);
    expect(s.distance).toBe(7);
  });

  it("pan moves the orbit pivot", () => {
    const s = new Stage();
    const before = s.target.clone();
    s.pan(50, 0);
    expect(s.target.distanceTo(before)).toBeGreaterThan(0);
  });

  it("setHeading clamps pitch from a near-vertical direction", () => {
    const s = new Stage();
    s.setHeading(new THREE.Vector3(0, 1, 0));
    expect(Math.abs(s.pitch)).toBeCloseTo(MAX_PITCH, 9);
  });
});

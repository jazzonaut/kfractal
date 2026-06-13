import * as THREE from "three/webgpu";
import type { CameraPreset } from "../fractal/types";

// Near-vertical headroom matters for dives that approach horizontal surfaces head-on;
// stop just short of the poles to keep the yaw/pitch parametrization stable.
const MIN_PITCH = -1.45;
const MAX_PITCH = 1.45;

export class Stage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly target = new THREE.Vector3();

  yaw = 0;
  pitch = 0;
  distance = 5;
  /** Rotation around the view axis (radians); 0 keeps the horizon level. */
  roll = 0;

  constructor() {
    // Far plane covers the full dolly range (max distance 200) with headroom.
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.05,
      500,
    );
    this.applyOrbit();
  }

  applyPreset(camera: CameraPreset): void {
    this.target.set(camera.target[0], camera.target[1], camera.target[2]);
    this.yaw = camera.yaw;
    this.pitch = camera.pitch;
    this.roll = camera.roll ?? 0;
    this.distance = camera.distance;
    this.camera.fov = camera.fov;
    this.camera.updateProjectionMatrix();
    this.applyOrbit();
  }

  orbit(deltaYaw: number, deltaPitch: number): void {
    this.yaw += deltaYaw;
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, this.pitch + deltaPitch));
    this.applyOrbit();
  }

  /** Barrel roll: rotate the camera around its view axis. Unclamped; wraps to ±π. */
  rollBy(delta: number): void {
    this.roll = Math.atan2(Math.sin(this.roll + delta), Math.cos(this.roll + delta));
    this.applyOrbit();
  }

  dolly(delta: number): void {
    // The lower bound is a fallback only: the DiveController re-bases the world scale
    // before the camera ever gets this close, which is what makes deep zoom possible.
    // The upper bound only needs to stop runaway scrolling; the march draw distance
    // tracks the camera distance, so far pull-backs still render the whole fractal.
    this.distance = Math.min(200, Math.max(0.2, this.distance * (1 + delta)));
    this.applyOrbit();
  }

  /** Re-base the orbit after a dive rescale: world moved into the dive transform. */
  rebase(distance: number): void {
    this.target.set(0, 0, 0);
    this.distance = distance;
    this.applyOrbit();
  }

  /**
   * Move the orbit pivot to a new point, keeping the camera position fixed: yaw, pitch,
   * and distance are rederived so the orbit stays consistent. The DiveController uses
   * this to pin the pivot onto fractal surface detail so a dive converges onto it
   * instead of sailing past into empty space.
   */
  retargetAt(point: THREE.Vector3): void {
    const cam = this.camera.position;
    const off = cam.clone().sub(point);
    const d = off.length();
    if (d < 1e-9) return;
    this.yaw = Math.atan2(off.x, off.z);
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.asin(off.y / d)));
    this.distance = d;
    // Keep the camera position fixed (this method's contract). Deriving the pivot from the
    // clamped pitch rather than copying `point` verbatim means a clamp shifts the pivot
    // slightly instead of snapping the view; with no clamp this reproduces `point` exactly
    // (cam - dir*d == point, since dir == off/d). applyOrbit places cam at target + dir*d.
    const cosPitch = Math.cos(this.pitch);
    const dir = new THREE.Vector3(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    );
    this.target.copy(cam).addScaledVector(dir, -d);
    this.applyOrbit();
  }

  /** Pin the orbit distance (DiveController stall clamp at a formula's depth floor). */
  setDistance(distance: number): void {
    this.distance = distance;
    this.applyOrbit();
  }

  /** Swing the camera around the pivot to a new (target -> camera) unit direction. */
  setHeading(dir: THREE.Vector3): void {
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.asin(dir.y)));
    this.applyOrbit();
  }

  pan(dx: number, dy: number): void {
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    const scale = this.distance * 0.0018;
    this.target.addScaledVector(right, -dx * scale);
    this.target.addScaledVector(up, -dy * scale);
    this.applyOrbit();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private applyOrbit(): void {
    const cosPitch = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    // Roll after lookAt: rotate around the local view axis so up is no longer pinned
    // to world-Y. Pan reads the rolled basis, so panning stays screen-aligned.
    if (this.roll !== 0) this.camera.rotateZ(this.roll);
    this.camera.updateMatrixWorld();
  }
}

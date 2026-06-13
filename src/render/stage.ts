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
  /**
   * The shape's natural framing distance, used as the fly-through pace once the camera
   * pushes past a surface (see dolly). Tying the pace to the shape's own scale keeps a
   * notch feeling the same whether you're crossing a small lattice cell or a large vault.
   */
  private flyReference = 5;

  constructor() {
    // Near/far bracket the full dolly range (out to MAX_ORBIT) with headroom; the raymarch
    // uses its own draw distance, so these planes only matter for any rasterized overlays.
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.02,
      3000,
    );
    this.applyOrbit();
  }

  applyPreset(camera: CameraPreset): void {
    this.target.set(camera.target[0], camera.target[1], camera.target[2]);
    this.yaw = camera.yaw;
    this.pitch = camera.pitch;
    this.roll = camera.roll ?? 0;
    this.distance = camera.distance;
    // Fly-through pace follows the shape's framing scale; floor it so a tightly-framed
    // shape still moves at a usable rate when you punch through into its interior.
    this.flyReference = Math.max(0.5, camera.distance);
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
    // delta < 0 scrolls in (toward the pivot), delta > 0 scrolls out. Multiplicative so the
    // approach feels the same at every scale. Two things differ from a plain orbit dolly:
    //  - The far cap is generous, so you can pull well clear of any shape.
    //  - There is no near *wall*: once the pivot is right in front, further scroll-in carries
    //    the pivot FORWARD along the view axis, so the camera flies through the surface into
    //    the interior (and out the far side) instead of stalling on it. With the orbit pivot
    //    sitting at a shape's centre, scrolling in already crosses the shell; the push-through
    //    is what lets you continue out the other side.
    // The deep-zoom dive (opt-in, DiveController) keeps the orbit distance pinned in its own
    // band while engaged, so the push-through branch only ever fires under manual control --
    // exactly when flying through is what you want.
    const MIN_ORBIT = 0.05;
    const MAX_ORBIT = 2000;
    const next = this.distance * (1 + delta);
    if (next >= MIN_ORBIT) {
      this.distance = Math.min(MAX_ORBIT, next);
    } else {
      // Push-through: translate the rig forward. Pace is tied to the shape's framing scale
      // (not the vanishing sub-MIN_ORBIT remainder), so motion never stalls at the surface.
      const forward = this.target.clone().sub(this.camera.position).normalize();
      this.target.addScaledVector(forward, -delta * this.flyReference * 0.5);
      this.distance = MIN_ORBIT;
    }
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

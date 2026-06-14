import * as THREE from "three/webgpu";
import type { CameraPreset } from "../fractal/types";

// Headings derived from a direction (retargetAt / setHeading) clamp just short of the
// poles to keep their asin-based yaw/pitch split stable. The orbit *drag* is exempt: it
// composes rotations about the live camera axes (see orbit), so it can sweep through and
// past vertical without a gimbal singularity.
const MIN_PITCH = -1.45;
const MAX_PITCH = 1.45;

// Shared read-only references for the orientation math (never mutated below).
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORIGIN = new THREE.Vector3(0, 0, 0);
const VIEW_AXIS = new THREE.Vector3(0, 0, 1);

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
    // Arcball drag: rotate about the camera's *current* axes, not the world ones. A
    // horizontal swipe spins about the live screen-vertical (camera up); a vertical swipe
    // about the live screen-horizontal (camera right). Because the axes track the view,
    // the drag always orbits along the dragged screen direction at any orientation -- there
    // is no world-up gimbal that degenerates into a twist near the poles, and roll falls out
    // automatically, so a rolled view stays consistent too. (At yaw=pitch=roll=0 this reduces
    // to the old yaw+=dYaw / pitch+=dPitch, keeping the equator feel unchanged.)
    const q = this.orientation(this.yaw, this.pitch, this.roll);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    // -deltaPitch about right so a positive deltaPitch still raises the heading, matching the
    // old pitch+=deltaPitch sign; deltaYaw about up matches the old yaw+=deltaYaw.
    const next = new THREE.Quaternion()
      .setFromAxisAngle(up, deltaYaw)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, -deltaPitch))
      .multiply(q);
    // Re-derive yaw/pitch/roll from the new orientation so presets, dive, and the rest of the
    // system keep their parametrization. Decompose -> reconstruct is exact (orientation() is
    // the single source of truth for both), so this never wobbles, even through vertical.
    const dir = VIEW_AXIS.clone().applyQuaternion(next); // camera +Z == target->camera dir
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pitch = Math.asin(Math.min(1, Math.max(-1, dir.y)));
    // Whatever twist remains once yaw/pitch are accounted for is the roll: the rotation about
    // the view axis that separates `next` from the no-roll orientation for this heading.
    const rel = this.orientation(this.yaw, this.pitch, 0).invert().multiply(next);
    this.roll = 2 * Math.atan2(rel.z, rel.w);
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

  /**
   * The camera orientation for a given yaw/pitch/roll: look down the spherical heading with
   * world-up, then roll about the local view axis. This is the single definition of the view
   * frame -- applyOrbit places the camera with it, and orbit() decomposes against it -- so the
   * two stay exactly consistent (the decompose <-> reconstruct round-trip is lossless).
   */
  private orientation(yaw: number, pitch: number, roll: number): THREE.Quaternion {
    const cosPitch = Math.cos(pitch);
    const dir = new THREE.Vector3(
      Math.sin(yaw) * cosPitch,
      Math.sin(pitch),
      Math.cos(yaw) * cosPitch,
    );
    // lookAt(eye, target, up): -Z faces target, so +Z == dir (the target->camera direction).
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(dir, ORIGIN, WORLD_UP),
    );
    // Roll is a local rotation about the view axis (right-multiply), so up is no longer pinned
    // to world-Y; pan reads the rolled basis, keeping panning screen-aligned.
    if (roll !== 0) q.multiply(new THREE.Quaternion().setFromAxisAngle(VIEW_AXIS, roll));
    return q;
  }

  private applyOrbit(): void {
    const cosPitch = Math.cos(this.pitch);
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * cosPitch,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(offset);
    this.camera.quaternion.copy(this.orientation(this.yaw, this.pitch, this.roll));
    this.camera.updateMatrixWorld();
  }
}

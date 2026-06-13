import * as THREE from "three/webgpu";
import { getCpuDe, latticeFoldComponent } from "../fractal/cpu-de";
import { warpCpuDe } from "../fractal/warp";
import type { CpuDe, CpuDeParams } from "../fractal/cpu-de";
import type { Stage } from "./stage";
import type { DiveFrame, FractalFormulaId, WarpSettings } from "../fractal/types";

/**
 * Infinite/deep zoom (the dive transform).
 *
 * The marcher works in CAMERA SPACE, mapped to fractal space by F(p) = offset + scale*(R*p).
 * Whenever the orbit distance leaves the [D_LO, D_HI] band, the world scale is folded into
 * `scale` and the camera re-based to D_MID, so camera-space coordinates -- and every f32
 * marching constant in the shader -- stay O(1) at any zoom depth. This alone gives clean
 * deep zoom for every formula until f32 runs out inside the DE itself (~1e5x).
 *
 * Diving is steered: before each re-base the orbit pivot is retargeted onto the fractal
 * surface under the view center (an f64 CPU march of the same DE), so the zoom converges
 * onto detail instead of sailing past it into empty space.
 *
 * For the Apollonian the zoom is genuinely unbounded: its DE iterates T(p) = k*fold(p)
 * (lattice fold + sphere inversion, k = a/|fold(p)|^2), and the rendered set is invariant
 * under T. When the visible extent (scale * distance) shrinks past E_SNAP, we re-anchor by
 * pushing F through T's local linearization at the anchor: offset <- T(offset),
 * scale <- k*scale, R <- H*R (H is the inversion's Householder reflection). The view is
 * preserved exactly at the anchor and to ~E_RESTORE error at the frustum edge, while
 * `scale` climbs back toward O(1) -- coordinates never degrade, so the dive never ends.
 *
 * All bookkeeping runs CPU-side in f64; the GPU only ever sees O(1) uniforms.
 */

const D_LO = 1.2;
const D_MID = 4.0;
const D_HI = 14.0;
/**
 * Visible fractal-space extent that triggers an Apollonian re-anchor. Set by f32
 * coordinate quantization, not by taste: the shader evaluates offset + scale*(R*p), so
 * once the pixel footprint (~7.7e-4 * extent) nears the ulp of the O(1) offset (~2e-7)
 * surfaces snap to the float lattice and the view turns into axis-aligned boxes.
 * 8e-3 keeps every pixel ~30 quanta wide at the deepest point between snaps...
 */
const E_SNAP = 8e-3;
/** ...and each snap pumps the scale back up until the extent recovers to this. */
const E_RESTORE = 0.05;
const MAX_UNFOLDS = 24;
/**
 * Quanta per pixel kept above the f32 quantization floor; below ~1 surfaces go boxy.
 * The margin covers geometry sitting closer than the pin distance (finer footprint).
 */
const FLOOR_QUANTA = 8;
/** Approximate pixel angular footprint (1080p at 45° fov); a quality floor, not exact. */
const PIXEL_ANGLE = 7.7e-4;
/** Escape-time DEs need extra iterations per octave of zoom to generate finer detail. */
const ITERS_PER_OCTAVE = 0.75;
const MAX_EXTRA_ITERS = 16;
/** Retarget march budget, in camera-space units. */
const MARCH_MAX_T = 40;
const MARCH_STEPS = 384;
/**
 * Retarget steering cone (radians): rays fanned around the view center compete for the
 * pivot, scored toward expanding regions of the map - flat facets are infinite-zoom
 * dead ends (locally planar AND non-expanding), filigree is where the detail lives.
 */
const STEER_CONE = 0.35;
const STEER_RING = 8;
/**
 * Detail probe radii as fractions of the hit distance. The score is the MINIMUM across
 * scales: surviving every scale separates the tangency curve network (detailed forever,
 * where infinite zoom thrives) from bead interiors and plane facets that look curved at
 * one scale and flatten at the next.
 */
const SCORE_SCALES = [0.3, 0.1, 0.033, 0.011];
/** Extra DE iterations for probes so the finest probe scale actually resolves. */
const PROBE_EXTRA_ITERS = 6;
/** Steering runs while actively dolly-ing in below this distance. */
const STEER_NEAR = 6.0;
/**
 * Per-frame rate for aligning the dive axis with the surface normal at the pivot.
 * Head-on approach is what makes a 3D dive read like a 2D infinite zoom: the surface
 * pattern around the pivot fills the screen, and the camera never grazes along a wall
 * that swallows the whole frame at point-blank range.
 */
const ALIGN_RATE = 0.12;
/**
 * Per-frame cap (radians) on pulling the steering axis toward the mouse cursor's ray.
 * The dive smoothly pursues the surface under the cursor instead of the view center -
 * capped so a cursor parked at the screen edge turns the dive, not snaps it.
 */
const CURSOR_PULL = 0.08;

/** The scene is invariant under even-integer translation; folding keeps offset O(1). */
function latticeFold(v: THREE.Vector3): void {
  v.x = latticeFoldComponent(v.x);
  v.y = latticeFoldComponent(v.y);
  v.z = latticeFoldComponent(v.z);
}

/** M <- (I - 2uu^T) * M, the sphere inversion's local reflection (u must be unit). */
function householderPremultiply(m: THREE.Matrix3, u: THREE.Vector3): void {
  const e = m.elements; // column-major
  for (let j = 0; j < 9; j += 3) {
    const d = 2 * (u.x * e[j]! + u.y * e[j + 1]! + u.z * e[j + 2]!);
    e[j] = e[j]! - d * u.x;
    e[j + 1] = e[j + 1]! - d * u.y;
    e[j + 2] = e[j + 2]! - d * u.z;
  }
}

/** Gram-Schmidt: products of many Householders drift; keep R orthonormal. */
function orthonormalize(m: THREE.Matrix3): void {
  const c0 = new THREE.Vector3().setFromMatrix3Column(m, 0).normalize();
  const c1 = new THREE.Vector3().setFromMatrix3Column(m, 1);
  c1.addScaledVector(c0, -c0.dot(c1)).normalize();
  const c2 = new THREE.Vector3().setFromMatrix3Column(m, 2);
  c2.addScaledVector(c0, -c0.dot(c2)).addScaledVector(c1, -c1.dot(c2)).normalize();
  m.set(c0.x, c1.x, c2.x, c0.y, c1.y, c2.y, c0.z, c1.z, c2.z);
}

/** Camera-space ray through an NDC point, matching the shader's primary-ray setup. */
function cursorRay(stage: Stage, ndc: { x: number; y: number }): THREE.Vector3 {
  const cam = stage.camera;
  cam.updateMatrixWorld();
  const e = cam.matrixWorld.elements;
  const tanHalf = Math.tan((cam.fov * Math.PI) / 180 / 2);
  const right = new THREE.Vector3(e[0], e[1], e[2]).normalize();
  const up = new THREE.Vector3(e[4], e[5], e[6]).normalize();
  const fwd = new THREE.Vector3(-e[8]!, -e[9]!, -e[10]!).normalize();
  return fwd
    .addScaledVector(right, ndc.x * cam.aspect * tanHalf)
    .addScaledVector(up, ndc.y * tanHalf)
    .normalize();
}

export class DiveController {
  readonly offset = new THREE.Vector3();
  readonly basis = new THREE.Matrix3();
  /** Scratch for deAtCam's fractal-space transform; never escapes the method. */
  private readonly dePoint = new THREE.Vector3();
  /**
   * Per-frame steering scratch. Assist steering marches 17 rays and probes the DE ~16
   * times per scored hit on every dolly-in frame; cloning a Vector3 at each site churned
   * 400-600 short-lived allocations/frame, exactly when frame pacing matters most. These
   * reused vectors keep the steering path allocation-free. None escape their method, and
   * detailScore's set (ds*) is disjoint from retarget's (rt*) so an inner DE probe never
   * clobbers the outer ray basis still in use by the enclosing loop.
   */
  private readonly rtCenter = new THREE.Vector3();
  private readonly rtUp = new THREE.Vector3();
  private readonly rtU = new THREE.Vector3();
  private readonly rtV = new THREE.Vector3();
  private readonly rtDir = new THREE.Vector3();
  private readonly rtHit = new THREE.Vector3();
  private readonly rtBest = new THREE.Vector3();
  private readonly rtCenterPt = new THREE.Vector3();
  private readonly dsUp = new THREE.Vector3();
  private readonly dsU = new THREE.Vector3();
  private readonly dsV = new THREE.Vector3();
  private readonly dsProbe = new THREE.Vector3();
  private readonly marchRo = new THREE.Vector3();
  private readonly marchRd = new THREE.Vector3();
  /**
   * Reused probe params (base iterations + PROBE_EXTRA_ITERS); see detailScore. Mutable
   * shape (no CpuDeParams annotation) so detailScore can rewrite the fields in place; it is
   * still structurally assignable to the readonly CpuDeParams the DE functions accept.
   */
  private readonly probeParams = { p0: 0, p1: 0, p2: 0, p3: 0, iterations: 0 };
  /**
   * Persistent raw-DE binding for deAtCam's warp path. warpCpuDe needs an (x,y,z)=>d
   * callback; allocating that closure per DE probe was the single largest dive allocation
   * source (~290/frame on a warped assisted dive). The closure reads the formula fn and
   * params off these fields, which deAtCam refreshes per call, so one function object
   * serves every probe. Safe because deAtCam never overlaps its own calls (single-threaded,
   * no re-entry through warpCpuDe).
   */
  private deFn: CpuDe | null = null;
  private deParams: CpuDeParams | null = null;
  private readonly rawDeBound = (x: number, y: number, z: number): number =>
    this.deFn!(x, y, z, this.deParams!);
  scale = 1;
  /**
   * Dive assist (user toggle, default off). Off: the zoom goes exactly where the camera
   * is facing - the pivot pins to the surface straight ahead and nothing ever turns the
   * view. On: the full autopilot - cone-sampled detail steering, cursor pursuit, and
   * head-on normal alignment - pilots the dive toward detail that survives depth.
   */
  assist = false;
  /**
   * Camera-space safety margin for surface growth (the GPU displaces geometry up to
   * this far beyond the formula DE, which the f64 CPU mirror knows nothing about).
   * Subtracting it keeps steering and collision conservative: rays stop early rather
   * than clip through spikes. Synced from the growth length by main.ts.
   */
  growthMargin = 0;
  /**
   * Active domain warp (ADR-0012), or null at identity. Warp displacement is O(radius),
   * far beyond what a constant margin can cover, so the f64 mirror routes every DE
   * evaluation through the same warp + Lipschitz correction the GPU applies. Synced
   * from the shape by main.ts.
   */
  warp: WarpSettings | null = null;
  /** Dive verification counters (read via the __kf dev hook; not part of the seam). */
  readonly debug = {
    steers: 0,
    sticks: 0,
    noHits: 0,
    unfoldGains: 0,
    unfoldStalls: 0,
    lastBest: 0,
    lastCenter: 0,
  };
  private lastDistance = Infinity;

  reset(): void {
    this.offset.set(0, 0, 0);
    this.basis.identity();
    this.scale = 1;
    this.lastDistance = Infinity;
  }

  /** Snapshot the transform for persistence (ADR-0010); undefined at top level. */
  frame(): DiveFrame | undefined {
    const identity = new THREE.Matrix3();
    if (this.scale === 1 && this.offset.lengthSq() === 0 && this.basis.equals(identity)) {
      return undefined;
    }
    return {
      offset: this.offset.toArray() as [number, number, number],
      basis: [...this.basis.elements] as DiveFrame["basis"],
      scale: this.scale,
    };
  }

  /** Restore a persisted transform; `undefined` resets to top level. */
  restore(frame: DiveFrame | undefined): void {
    if (!frame) {
      this.reset();
      return;
    }
    this.offset.fromArray(frame.offset as [number, number, number]);
    this.basis.fromArray([...frame.basis]);
    this.scale = frame.scale;
    // -Infinity (not Infinity, as reset uses): a restored pose must come back exactly,
    // so the first frame must not read as "diving in" and re-pin the pivot.
    this.lastDistance = -Infinity;
  }

  /**
   * Effective depth floor: only the physical f32 ceiling remains (the tuned per-formula
   * floors were removed for unlimited zoom). For formulas without a translation symmetry
   * (the offset is an absolute coordinate that cannot be folded back toward the origin),
   * the f32 quantization point scales with the offset's magnitude: one ulp of the offset
   * must stay a few times smaller than a pixel's fractal-space footprint at the pin
   * distance - past it there is no image, only the float lattice. Noise-limited formulas
   * (the power-8 bulb especially) now dissolve into orbit noise instead of stalling.
   */
  private scaleFloor(formula: FractalFormulaId): number {
    // Lattice-folded: |offset| stays O(1) and re-anchoring keeps scale O(1); no floor.
    // Under a warp re-anchoring is disabled (see update), so the generic floor applies.
    if (formula === "apollonian" && !this.warp) return 0;
    const mag = Math.max(
      1,
      Math.abs(this.offset.x),
      Math.abs(this.offset.y),
      Math.abs(this.offset.z),
    );
    const ulp = Math.pow(2, Math.floor(Math.log2(mag)) - 23);
    return (FLOOR_QUANTA * ulp) / (D_LO * PIXEL_ANGLE);
  }

  /** Iterations to add to the preset's count so detail keeps resolving while diving. */
  extraIterations(distance: number): number {
    const extent = this.scale * distance;
    if (extent >= 1) return 0;
    return Math.min(MAX_EXTRA_ITERS, Math.round(Math.log2(1 / extent) * ITERS_PER_OCTAVE));
  }

  /**
   * March step budget, grown with dive depth: deep views graze ever more fine structure,
   * the sphere-tracing steps collapse, and an exhausted budget reads as a miss - the
   * whole frame silently turns to background.
   */
  marchSteps(baseSteps: number, distance: number): number {
    const extent = this.scale * distance;
    if (extent >= 1) return baseSteps;
    return Math.min(baseSteps * 5, Math.round(baseSteps * (1 + Math.log2(1 / extent) * 0.5)));
  }

  /**
   * Draw distance in camera units, grown with dive depth. A fixed camera-space cap
   * shrinks the FRACTAL-space draw distance with the zoom, silently culling the macro
   * world around the dive pocket even though it still subtends the same screen angle.
   * Guarantee a few lattice cells of fractal-space visibility instead; rays that leave
   * the pocket cross macro structure quickly, so the extra march cost is logarithmic.
   */
  maxDistance(baseMaxDist: number): number {
    return Math.min(1e6, Math.max(baseMaxDist, 6 / this.scale));
  }

  /**
   * Run once per frame after camera input. Returns true when the transform changed
   * (the view is preserved across every change, but uniforms must be re-pushed).
   */
  update(
    stage: Stage,
    formula: FractalFormulaId,
    formulaP: THREE.Vector4,
    iters: number,
    pointerNdc: { x: number; y: number } | null = null,
  ): boolean {
    let changed = false;
    const params: CpuDeParams = {
      p0: formulaP.x,
      p1: formulaP.y,
      p2: formulaP.z,
      p3: formulaP.w,
      iterations: iters + this.extraIterations(stage.distance) + 2,
    };

    // Steering, alignment, and rescaling all act only during an active dolly-in: steering
    // must run continuously while diving (waiting for the rescale threshold lets the view
    // commit to flat dead-end facets), but a settled camera must stay untouched or
    // in-progress renders would reset every frame.
    const divingIn = stage.distance < this.lastDistance - 1e-9 && stage.distance < STEER_NEAR;
    if (divingIn) {
      changed = this.retarget(stage, formula, params, pointerNdc);
      if (this.assist) changed = this.alignToNormal(stage, formula, params) || changed;
      if (stage.distance < D_LO) {
        // The magnification each rescale folds into `scale` is capped by the formula's
        // depth floor; at the floor the rescale stops and the dive stalls gracefully,
        // pinned at D_LO so the camera cannot push on into the wall.
        const m = Math.min(D_MID / stage.distance, this.scale / this.scaleFloor(formula));
        if (m > 1) {
          this.recenter(stage, formula);
          this.scale /= m;
          stage.rebase(stage.distance * m);
          changed = true;
        }
      }
    } else if (stage.distance > D_HI && this.scale < 1) {
      // Zooming back out: unwind toward top level, never past scale 1. Without an
      // inverse of T this surfaces wherever the re-anchors landed -- for a self-similar
      // set that is a copy of the overview, which is exactly the infinite-zoom charm.
      this.recenter(stage, formula);
      const m = Math.max(D_MID / stage.distance, this.scale);
      this.scale /= m;
      stage.rebase(m * stage.distance);
      changed = true;
    }

    // Re-anchoring relies on the set's invariance under T, which a domain warp breaks
    // (the warped set is NOT invariant); warped apollonian dives just bottom out at the
    // generic f32 floor instead.
    if (formula === "apollonian" && !this.warp && this.scale * stage.distance < E_SNAP) {
      this.recenter(stage, formula);
      changed = this.unfoldApollonian(stage.distance, formulaP.x) || changed;
    }

    // Stall pin, independent of wheel activity: at the formula's depth floor rescaling
    // has stopped, so the camera must not push on into the wall (and into sub-pixel
    // quantization). Fires once, then the condition is stable.
    if (stage.distance < D_LO && this.scale <= this.scaleFloor(formula) * 1.0001) {
      stage.setDistance(D_LO);
      changed = true;
    }

    this.lastDistance = stage.distance;
    return changed;
  }

  /**
   * March a small cone of rays around the view center against the f64 CPU DE and pull
   * the orbit pivot onto the most interesting hit: for the Apollonian, the hit whose
   * folded point is deepest inside the inversion sphere (k = a/|q|^2 largest), i.e. the
   * filigree where the map expands and re-anchoring works; flat facets score ~k<=1.
   * Other formulas just prefer the hit closest to the view center. View direction moves
   * by at most STEER_CONE per rescale, so steering reads as a gentle autopilot.
   */
  private retarget(
    stage: Stage,
    formula: FractalFormulaId,
    params: CpuDeParams,
    pointerNdc: { x: number; y: number } | null,
  ): boolean {
    const cam = stage.camera.position;
    const center = this.rtCenter.copy(stage.target).sub(cam);
    if (center.lengthSq() < 1e-12) return false;
    center.normalize();

    if (!this.assist) {
      // Plain zoom: pin the pivot to the surface straight ahead (so the dive converges
      // onto it instead of sailing past) and never turn the view.
      const tCam = this.marchRay(cam, center, formula, params);
      if (tCam === null || tCam < 0.02 || tCam > 12) return false;
      stage.retargetAt(this.rtHit.copy(cam).addScaledVector(center, tCam));
      return true;
    }

    // Aim at the surface under the mouse: pull the steering axis toward the cursor's
    // ray at a capped per-frame rate, so the dive pursues where the user points.
    if (pointerNdc) {
      const cursor = cursorRay(stage, pointerNdc);
      const angle = center.angleTo(cursor);
      if (angle > 1e-4) {
        center.lerp(cursor, Math.min(1, CURSOR_PULL / angle)).normalize();
      }
    }

    const up = Math.abs(center.y) > 0.99 ? this.rtUp.set(1, 0, 0) : this.rtUp.set(0, 1, 0);
    const u = this.rtU.crossVectors(up, center).normalize();
    const v = this.rtV.crossVectors(center, u);

    let bestScore = -Infinity;
    let centerScore = -Infinity;
    const bestPoint = this.rtBest;
    const centerPoint = this.rtCenterPt;
    let found = false;
    // Two rings widen coverage; ray 0 is the view center itself.
    for (let i = 0; i <= STEER_RING * 2; i += 1) {
      const dir = this.rtDir.copy(center);
      if (i > 0) {
        const ring = i <= STEER_RING ? 1 : 0.45;
        const phi = ((i - 1) / STEER_RING) * Math.PI * 2 + (i <= STEER_RING ? 0 : Math.PI / 8);
        dir
          .addScaledVector(u, STEER_CONE * ring * Math.cos(phi))
          .addScaledVector(v, STEER_CONE * ring * Math.sin(phi))
          .normalize();
      }
      const tCam = this.marchRay(cam, dir, formula, params);
      if (tCam === null || tCam < 0.02 || tCam > 12) continue;
      const hitCam = this.rtHit.copy(cam).addScaledVector(dir, tCam);
      const score = this.detailScore(hitCam, dir, tCam, formula, params);
      if (i === 0) {
        centerScore = score;
        centerPoint.copy(hitCam);
      }
      if (score > bestScore) {
        bestScore = score;
        bestPoint.copy(hitCam);
        found = true;
      }
    }
    this.debug.lastBest = bestScore;
    this.debug.lastCenter = centerScore;
    if (!found) {
      this.debug.noHits += 1;
      return false;
    }
    // Center-stickiness: keep the current heading while it points at decent detail;
    // per-frame turns toward the absolute best hit would jitter the view.
    if (centerScore >= Math.max(0.05, 0.5 * bestScore)) {
      this.debug.sticks += 1;
      stage.retargetAt(centerPoint);
      return true;
    }
    this.debug.steers += 1;
    stage.retargetAt(bestPoint);
    return true;
  }

  /**
   * Swing the camera around the pivot toward the surface normal there, a little per
   * frame; see ALIGN_RATE. Runs only during active dolly-in, so settled views (and
   * renders) are never disturbed.
   */
  private alignToNormal(stage: Stage, formula: FractalFormulaId, params: CpuDeParams): boolean {
    const dir = stage.camera.position.clone().sub(stage.target);
    const d = dir.length();
    if (d < 1e-9) return false;
    dir.divideScalar(d);

    const h = Math.max(1e-4 * d, 1e-7);
    const n = new THREE.Vector3();
    const probe = new THREE.Vector3();
    n.x =
      this.deAtCam(probe.copy(stage.target).setX(stage.target.x + h), formula, params) -
      this.deAtCam(probe.copy(stage.target).setX(stage.target.x - h), formula, params);
    n.y =
      this.deAtCam(probe.copy(stage.target).setY(stage.target.y + h), formula, params) -
      this.deAtCam(probe.copy(stage.target).setY(stage.target.y - h), formula, params);
    n.z =
      this.deAtCam(probe.copy(stage.target).setZ(stage.target.z + h), formula, params) -
      this.deAtCam(probe.copy(stage.target).setZ(stage.target.z - h), formula, params);
    if (n.lengthSq() < 1e-18) return false;
    n.normalize();
    // Degenerate gradients (camera behind the surface) would flip the view through it.
    if (n.dot(dir) < 0.05 || n.dot(dir) > 0.995) return false;
    stage.setHeading(dir.lerp(n, ALIGN_RATE).normalize());
    return true;
  }

  /**
   * Camera-space distance to the surface at a camera-space point (f64 CPU DE).
   * The growth margin is a constant offset, so the finite-difference steering normals
   * and detailScore's second differences are unaffected by it.
   */
  private deAtCam(p: THREE.Vector3, formula: FractalFormulaId, params: CpuDeParams): number {
    // Scratch, not clone: this runs per DE probe in the per-frame steering path.
    const f = this.dePoint
      .copy(p)
      .applyMatrix3(this.basis)
      .multiplyScalar(this.scale)
      .add(this.offset);
    // Refresh the persistent binding rather than allocating a fresh warp closure per probe.
    this.deFn = getCpuDe(formula);
    this.deParams = params;
    const raw = this.warp
      ? warpCpuDe(this.rawDeBound, this.warp, f.x, f.y, f.z)
      : this.deFn(f.x, f.y, f.z, params);
    return raw / this.scale - this.growthMargin;
  }

  /**
   * Persistent surface detail at the hit: second differences of the DE probed
   * tangentially around the hit, taken at SCORE_SCALES radii, scored as the minimum
   * across scales. Planes and locally-smooth sphere faces fail at the finer scales no
   * matter their tilt; the tangency curve network -- where detail survives unlimited
   * zoom -- scores high at every scale. Re-probing each frame keeps the dive locked on.
   */
  private detailScore(
    hitCam: THREE.Vector3,
    dir: THREE.Vector3,
    tCam: number,
    formula: FractalFormulaId,
    params: CpuDeParams,
  ): number {
    const up = Math.abs(dir.y) > 0.99 ? this.dsUp.set(1, 0, 0) : this.dsUp.set(0, 1, 0);
    const u = this.dsU.crossVectors(up, dir).normalize();
    const v = this.dsV.crossVectors(dir, u);
    // Reused probe-params object (was a fresh spread per scored hit, 17/frame).
    const probeParams = this.probeParams;
    probeParams.p0 = params.p0;
    probeParams.p1 = params.p1;
    probeParams.p2 = params.p2;
    probeParams.p3 = params.p3;
    probeParams.iterations = params.iterations + PROBE_EXTRA_ITERS;
    const d0 = this.deAtCam(hitCam, formula, probeParams);
    // One reused probe point instead of a clone per probe (16 per scored hit).
    const probePoint = this.dsProbe;
    const probe = (axis: THREE.Vector3, sign: number, rho: number): number =>
      this.deAtCam(probePoint.copy(hitCam).addScaledVector(axis, sign * rho), formula, probeParams);
    let score = Infinity;
    for (const frac of SCORE_SCALES) {
      const rho = frac * tCam;
      const cu = Math.abs(probe(u, 1, rho) + probe(u, -1, rho) - 2 * d0);
      const cv = Math.abs(probe(v, 1, rho) + probe(v, -1, rho) - 2 * d0);
      score = Math.min(score, (cu + cv) / rho);
    }
    return score;
  }

  /** Sphere-trace one camera-space ray in fractal space; camera-space hit t or null. */
  private marchRay(
    cam: THREE.Vector3,
    dir: THREE.Vector3,
    formula: FractalFormulaId,
    params: CpuDeParams,
  ): number | null {
    const de = getCpuDe(formula);
    const warp = this.warp;
    // One closure per ray, not per step: the warped path used to rebuild the raw-DE
    // wrapper on every sample() call - tens of thousands of allocations per frame
    // during an assisted dive.
    const rawDe = (x: number, y: number, z: number): number => de(x, y, z, params);
    const sample = warp
      ? (x: number, y: number, z: number): number => warpCpuDe(rawDe, warp, x, y, z)
      : rawDe;
    const ro = this.marchRo
      .copy(cam)
      .applyMatrix3(this.basis)
      .multiplyScalar(this.scale)
      .add(this.offset);
    const rd = this.marchRd.copy(dir).applyMatrix3(this.basis);
    const s = this.scale;
    let t = 0;
    const maxT = MARCH_MAX_T * s;
    // Fractal-space growth margin: surface growth displaces the GPU surface outward,
    // so rays must stop that much earlier than the bare formula DE says.
    const margin = this.growthMargin * s;
    for (let i = 0; i < MARCH_STEPS && t < maxT; i += 1) {
      const d = sample(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t) - margin;
      if (!Number.isFinite(d)) return null;
      if (d < 1e-3 * t + 1e-30) return t / s;
      t += d * 0.9;
    }
    return null;
  }

  /**
   * Fold the orbit target into the offset (view-preserving): the anchor must sit at the
   * view center so the re-anchor linearization is exact where the user is looking.
   */
  private recenter(stage: Stage, formula: FractalFormulaId): void {
    if (stage.target.lengthSq() > 0) {
      const t = stage.target.clone().applyMatrix3(this.basis).multiplyScalar(this.scale);
      this.offset.add(t);
    }
    if (formula === "apollonian") latticeFold(this.offset);
    stage.rebase(stage.distance);
  }

  /**
   * Apply T to the anchor until the visible extent recovers; see the class comment.
   * Individual inversions may contract (k < 1) even on the limit set, so the loop runs
   * a full budget and lands on the most-recovered prefix -- every prefix of
   * T-applications is itself a valid view-preserving re-anchor.
   */
  private unfoldApollonian(distance: number, apolloScale: number): boolean {
    if (apolloScale <= 0) return false;
    const bestOffset = this.offset.clone();
    const bestBasis = this.basis.clone();
    const bestScale = this.scale;
    let best = { offset: bestOffset, basis: bestBasis, scale: bestScale };
    let improved = false;
    for (let i = 0; i < MAX_UNFOLDS && this.scale * distance < E_RESTORE; i += 1) {
      const q = this.offset.clone();
      latticeFold(q);
      const r2 = q.lengthSq();
      if (r2 < 1e-12) break;
      const k = apolloScale / r2;
      this.offset.copy(q).multiplyScalar(k);
      latticeFold(this.offset);
      householderPremultiply(this.basis, q.normalize());
      this.scale *= k;
      if (this.scale > best.scale) {
        best = { offset: this.offset.clone(), basis: this.basis.clone(), scale: this.scale };
        improved = true;
      }
    }
    this.offset.copy(best.offset);
    this.basis.copy(best.basis);
    this.scale = best.scale;
    if (improved) {
      this.debug.unfoldGains += 1;
      orthonormalize(this.basis);
    } else {
      this.debug.unfoldStalls += 1;
    }
    return improved;
  }
}

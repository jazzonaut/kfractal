import * as THREE from "three/webgpu";
import { getCpuDe, latticeFoldComponent } from "../fractal/cpu-de";
import { chainDe, chainStepScale } from "../fractal/chain";
import { warpCpuDe } from "../fractal/warp";
import type { CpuDeParams } from "../fractal/cpu-de";
import type { Stage } from "./stage";
import type { DiveFrame, FormulaChain, FractalFormulaId, WarpSettings } from "../fractal/types";

/**
 * Infinite/deep zoom (the dive transform).
 *
 * The marcher works in CAMERA SPACE, mapped to fractal space by F(p) = offset + scale*(R*p).
 * Whenever the orbit distance leaves the [D_LO, D_HI] band, the world scale is folded into
 * `scale` and the camera re-based to D_MID, so camera-space coordinates -- and every f32
 * marching constant in the shader -- stay O(1) at any zoom depth. This alone gives clean
 * deep zoom for every formula until f32 runs out inside the DE itself (~1e5x).
 *
 * The pivot is pinned: before each re-base the orbit pivot is retargeted onto the fractal
 * surface straight ahead under the view center (an f64 CPU march of the same DE), so the
 * zoom converges onto detail instead of sailing past it into empty space.
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
/** The dive's surface-pin + rescale run while actively dolly-ing in below this distance. */
const DIVE_NEAR = 6.0;

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

export class DiveController {
  readonly offset = new THREE.Vector3();
  readonly basis = new THREE.Matrix3();
  /**
   * Per-frame scratch for the surface-pin retarget and its ray march; reused so the
   * per-dolly-in DE march stays allocation-free. None escape their method.
   */
  private readonly rtCenter = new THREE.Vector3();
  private readonly rtHit = new THREE.Vector3();
  private readonly marchRo = new THREE.Vector3();
  private readonly marchRd = new THREE.Vector3();
  scale = 1;
  /**
   * Deep-zoom dive enabled (user toggle, default ON). On: scrolling in performs the infinite
   * zoom-into-surface-detail - the pivot pins to the surface straight ahead, the world scale
   * re-bases to keep f32 coordinates O(1), and the Apollonian re-anchors through its own
   * self-similarity so the zoom never bottoms out. Off: the dive does nothing and the wheel is
   * a pure manual push-through dolly (Stage.dolly) that flies the camera through surfaces into
   * interiors.
   */
  enabled = true;
  /**
   * Camera-space safety margin for surface growth (the GPU displaces geometry up to
   * this far beyond the formula DE, which the f64 CPU mirror knows nothing about).
   * Subtracting it keeps the surface-pin march conservative: rays stop early rather
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
  /**
   * Active hybrid formula chain (hybrid-formula-chains design), or null for the atomic
   * formula path. When set, the surface-pin march estimates distance through the chain
   * interpreter (chainDe) instead of getCpuDe - the same chain object the GPU compiles - so
   * the dive steers against the geometry the GPU actually draws. Synced from the shape.
   */
  chain: FormulaChain | null = null;
  /** Dive verification counters (read via the __kf dev hook; not part of the seam). */
  readonly debug = {
    unfoldGains: 0,
    unfoldStalls: 0,
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
    // Under a warp OR a chain re-anchoring is disabled (see update) - neither set is invariant
    // under the Apollonian T - so the generic floor applies instead.
    if (formula === "apollonian" && !this.warp && !this.chain) return 0;
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
  update(stage: Stage, formula: FractalFormulaId, formulaP: THREE.Vector4, iters: number): boolean {
    // The deep-zoom dive can be switched off (see `enabled`). Off: the camera is under pure
    // manual control - no surface-pinning, no rescale, no stall - so the wheel flies straight
    // through surfaces (Stage.dolly) into interiors. Keep lastDistance current so toggling the
    // dive back on mid-flight doesn't read the first frame as a dive-in.
    if (!this.enabled) {
      this.lastDistance = stage.distance;
      return false;
    }
    let changed = false;
    const params: CpuDeParams = {
      p0: formulaP.x,
      p1: formulaP.y,
      p2: formulaP.z,
      p3: formulaP.w,
      iterations: iters + this.extraIterations(stage.distance) + 2,
    };

    // Surface-pinning and rescaling act only during an active dolly-in: the pin must run
    // continuously while diving (waiting for the rescale threshold lets the view commit to
    // flat dead-end facets), but a settled camera must stay untouched or in-progress renders
    // would reset every frame.
    const divingIn = stage.distance < this.lastDistance - 1e-9 && stage.distance < DIVE_NEAR;
    if (divingIn) {
      changed = this.retarget(stage, formula, params);
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

    // Re-anchoring relies on the set's invariance under the Apollonian T, which a domain warp
    // OR a hybrid chain breaks (neither the warped nor the chained set is invariant); those
    // dives just bottom out at the generic f32 floor instead. A chain is reachable here because
    // "Start hybrid chain" leaves engine.shape.formula intact, so it can still be apollonian.
    if (
      formula === "apollonian" &&
      !this.warp &&
      !this.chain &&
      this.scale * stage.distance < E_SNAP
    ) {
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
   * Pin the orbit pivot onto the fractal surface straight ahead (an f64 CPU march of the
   * same DE the GPU uses), so the zoom converges onto the detail under the view center
   * instead of sailing past it into empty space. The view is never turned.
   */
  private retarget(stage: Stage, formula: FractalFormulaId, params: CpuDeParams): boolean {
    const cam = stage.camera.position;
    const center = this.rtCenter.copy(stage.target).sub(cam);
    if (center.lengthSq() < 1e-12) return false;
    center.normalize();
    const tCam = this.marchRay(cam, center, formula, params);
    if (tCam === null || tCam < 0.02 || tCam > 12) return false;
    stage.retargetAt(this.rtHit.copy(cam).addScaledVector(center, tCam));
    return true;
  }

  /** Sphere-trace one camera-space ray in fractal space; camera-space hit t or null. */
  private marchRay(
    cam: THREE.Vector3,
    dir: THREE.Vector3,
    formula: FractalFormulaId,
    params: CpuDeParams,
  ): number | null {
    const warp = this.warp;
    const chain = this.chain;
    const de = getCpuDe(formula);
    // One closure per ray, not per step: the warped path used to rebuild the raw-DE
    // wrapper on every sample() call - tens of thousands of allocations per frame
    // during a dive. A chain marches its interpreter (boosted iteration count from params,
    // exactly as the atomic path boosts gIters); otherwise the formula's f64 mirror.
    const rawDe = chain
      ? (x: number, y: number, z: number): number => chainDe(chain, x, y, z, params.iterations)
      : (x: number, y: number, z: number): number => de(x, y, z, params);
    const sample = warp
      ? (x: number, y: number, z: number): number => warpCpuDe(rawDe, warp, x, y, z)
      : rawDe;
    // Aggressive chains can raise the field's Lipschitz constant above 1; tighten the
    // over-relaxation so the march stays conservative, and grow the step budget by the same
    // factor so the smaller steps still reach a distant surface (the GPU march does the same
    // via marchSteps * chainBoost - without it the pin can exhaust its budget and no-op on
    // exactly the chains that most need it). warpStepBoost is the warp-side analogue.
    const stepScale = chain ? chainStepScale(chain) : 1;
    const relax = 0.9 / stepScale;
    const steps = Math.round(MARCH_STEPS * stepScale);
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
    for (let i = 0; i < steps && t < maxT; i += 1) {
      const d = sample(ro.x + rd.x * t, ro.y + rd.y * t, ro.z + rd.z * t) - margin;
      if (!Number.isFinite(d)) return null;
      if (d < 1e-3 * t + 1e-30) return t / s;
      t += d * relax;
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

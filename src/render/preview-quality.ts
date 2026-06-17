/** Default render-scale ladder: 1 = native preview resolution, descending to a third. */
export const DEFAULT_PREVIEW_SCALE_TIERS = [1, 0.75, 0.5, 0.33] as const;

export interface PreviewQualityOptions {
  /** Descending scale ladder; tier 0 must be the native (highest) scale. */
  readonly tiers?: readonly number[];
  /** Starting scale; snapped to the nearest tier. */
  readonly initialScale?: number;
  /** Smoothed frame time (ms) above which a tier is dropped (lower resolution). */
  readonly dropAboveMs?: number;
  /** Smoothed frame time (ms) below which a tier is regained (higher resolution). */
  readonly raiseBelowMs?: number;
  /** Active-preview frames averaged before a decision. */
  readonly window?: number;
  /** Frames ignored after a change so the resize/realloc spike doesn't re-trigger. */
  readonly dwell?: number;
}

/**
 * Dynamic resolution scaling for the live preview. The engine feeds it one frame time per
 * *active* preview frame (a frame that actually re-marched the fractal); idle and converged
 * frames are excluded by the caller, because the gated render loop makes them ~free and they
 * would otherwise read as a comfortable 60fps and wrongly pull the resolution back up.
 *
 * It averages a sliding window and steps a discrete scale ladder with a wide hysteresis gap
 * (raiseBelowMs is well under dropAboveMs) plus a post-change cooldown, so it settles on a
 * tier instead of oscillating across the realloc spike a tier change causes. Pure: no DOM, no
 * timers, no clock — the engine decides when to sample and what to do with a scale change.
 */
export class PreviewQuality {
  private readonly tiers: readonly number[];
  private readonly dropAboveMs: number;
  private readonly raiseBelowMs: number;
  private readonly window: number;
  private readonly dwell: number;
  private index: number;
  private readonly samples: number[] = [];
  private cooldown = 0;

  constructor(options: PreviewQualityOptions = {}) {
    this.tiers = options.tiers ?? DEFAULT_PREVIEW_SCALE_TIERS;
    // Thresholds are absolute frame times, so the *target* is a fixed fps band, not a fraction
    // of the panel's refresh rate (on a 120Hz display a vsync-locked frame reads ~8ms).
    //
    // This is a deliberate SHARPNESS bias: the controller climbs a tier as soon as the current
    // one clears ~55 fps (raiseBelowMs), but only drops below ~25 fps (dropAboveMs). Since the
    // climb re-measures at the higher resolution and the wide hold band keeps it there, a device
    // that manages 60 fps at 0.75 but only ~33 fps at native will settle on native - it prefers
    // a sharper image at ~30 fps over a softer one at 60. The wide gap (plus the post-change
    // dwell) is also what stops oscillation: narrowing it to force the drop-back would make the
    // resolution pump between two tiers. To favor smoothness instead, LOWER raiseBelowMs (a
    // stricter climb gate ~ predicts the next tier's cost via its pixel-count ratio); do NOT
    // narrow the gap. Bias confirmed with the product owner (favor sharpness).
    //
    // dropAboveMs MUST stay below the render loop's frame-time clamp (config MAX_FRAME_DT, 50ms):
    // the loop caps observed dt there, so a frame slower than 50ms reads as exactly 50ms. Raise
    // the clamp without re-checking this and the drop logic silently stops firing.
    this.dropAboveMs = options.dropAboveMs ?? 40; // ~25 fps floor before dropping a tier
    this.raiseBelowMs = options.raiseBelowMs ?? 18; // ~55 fps headroom before climbing a tier
    this.window = Math.max(1, options.window ?? 24);
    this.dwell = Math.max(0, options.dwell ?? 24);
    this.index = this.nearestTier(options.initialScale ?? 1);
  }

  /** The active render-scale multiplier (1 = native preview resolution). */
  get scale(): number {
    return this.tiers[this.index]!;
  }

  /**
   * Drop the rolling window and cooldown. Called on a genuine discontinuity in preview cost: a
   * display resize (whole pipeline reallocates) or an auto-quality enable/disable. NOT on the
   * per-edit/per-camera-move accumulation reset - that runs every interacting frame and would
   * wipe the window before it ever fills, so the controller would never adapt.
   */
  reset(): void {
    this.samples.length = 0;
    this.cooldown = 0;
  }

  /**
   * Feed one active-preview frame time (in seconds). Returns true when the scale changed, in
   * which case the caller should re-apply {@link scale} to the pipeline.
   */
  sample(dtSeconds: number): boolean {
    if (this.cooldown > 0) {
      this.cooldown -= 1;
      return false;
    }
    this.samples.push(dtSeconds * 1000);
    if (this.samples.length < this.window) return false;
    if (this.samples.length > this.window) this.samples.shift();
    const avg = this.samples.reduce((sum, ms) => sum + ms, 0) / this.samples.length;
    if (avg > this.dropAboveMs && this.index < this.tiers.length - 1) return this.step(1);
    if (avg < this.raiseBelowMs && this.index > 0) return this.step(-1);
    return false;
  }

  private step(delta: number): boolean {
    this.index += delta;
    this.samples.length = 0;
    this.cooldown = this.dwell;
    return true;
  }

  private nearestTier(scale: number): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < this.tiers.length; i += 1) {
      const dist = Math.abs(this.tiers[i]! - scale);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }
}

/** Touch / non-mouse pointer, used as the "this is probably a weaker device" signal. Guarded
 * for the node test environment (no `window`). */
function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * Boot-time scale guess so a weak device doesn't spend its first seconds janking before the
 * runtime loop catches up. Touch + small viewport reads as a phone; touch alone as a tablet;
 * everything else (desktop) starts native. Guarded for the node test environment.
 */
export function initialPreviewScale(): number {
  if (typeof window === "undefined") return 1;
  const coarse = isCoarsePointer();
  const minEdge = Math.min(window.innerWidth, window.innerHeight);
  if (coarse && minEdge < 700) return 0.5;
  if (coarse) return 0.75;
  return 1;
}

/**
 * Whether auto-quality defaults ON when there is no stored preference. On for everyone now: a
 * fresh visitor (any device) gets the smooth, adaptive preview out of the box, and the toggle
 * lets a desktop user with headroom opt back into pinned-native. The bias inside PreviewQuality
 * still favors sharpness, so a capable machine settles at or near native regardless.
 */
export function autoQualityDefault(): boolean {
  return true;
}

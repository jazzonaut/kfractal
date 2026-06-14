import * as THREE from "three/webgpu";
import { FPS_INTERVAL } from "../config/constants";
import { startLoop } from "../core/loop";
import { warpStepBoost } from "../fractal/warp";
import type { FractalShape } from "../fractal/types";
import type { ExportOptions, ExportResult, WorkstationState } from "../ui/controller";
import { AccumulationBuffer } from "./accumulation";
import { CameraControls } from "./camera-controls";
import { AtrousDenoiser } from "./denoise";
import { DiveController } from "./dive";
import {
  FractalPass,
  MODE_FEATURE_ALBEDO,
  MODE_FEATURE_ND,
  MODE_PATHTRACE,
  MODE_PREVIEW,
} from "./fractal-pass";
import { PostChain } from "./post";
import { Stage } from "./stage";

function makeSampleTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(width, height, {
    type: THREE.FloatType,
    depthBuffer: false,
  });
}

/** Dependencies the engine needs from the rest of the app. */
export interface RenderEngineDeps {
  /** The live renderer, already created (and wired to its device-lost handler) by the boot path. */
  readonly renderer: THREE.WebGPURenderer;
  /** The reactive workstation state; the engine reads quality settings and writes fps/sampleCount/resolution. */
  readonly state: WorkstationState;
  /** The geometry half to render first; the state bridge swaps it later via `setShape`. */
  readonly initialShape: FractalShape;
  /** Called once, when the first preview frame has been presented (retire the boot loader). */
  readonly onFirstFrame: () => void;
  /** Called when a render/shader error is caught; the loop stops and the message is surfaced. */
  readonly onFatal: (message: string) => void;
}

/**
 * Owns the render pipeline and the frame loop (ADR-0003). Everything that mutates per-frame
 * state - the accumulation counter, the dirty flags, the denoise cache, the export gate - lives
 * here so the state bridge and controller can drive it through a small, explicit API instead of
 * sharing a pile of closure locals.
 */
export class RenderEngine {
  readonly stage = new Stage();
  readonly fractal: FractalPass;
  readonly dive = new DiveController();
  readonly post: PostChain;

  private readonly renderer: THREE.WebGPURenderer;
  private readonly state: WorkstationState;
  // The active geometry half (ADR-0010). The loop reads it for march budget/formula; the state
  // bridge swaps it through `setShape` on every shape change so both stay in lockstep.
  private activeShape: FractalShape;
  private readonly onFirstFrame: () => void;
  private readonly onFatal: (message: string) => void;
  private readonly controls: CameraControls;
  private readonly sampleRT: THREE.RenderTarget;
  private readonly accumulation: AccumulationBuffer;
  private readonly denoiser: AtrousDenoiser;

  // Space reserved for docked UI (inspector, status bar); the canvas gets the rest.
  private viewportRightInset = 0;
  private viewportBottomInset = 0;
  private width: number;
  private height: number;

  // Accumulation state, owned by the loop (ADR-0003, amended: render is explicit).
  private sampleIndexValue = 0;
  // Denoised-frame cache: the à-trous chain (4 full-res passes + bloom) only needs to re-run
  // when the accumulated mean or the denoise toggle changes. Re-presents driven by animated
  // grain or post-side tweaks at a converged frame reuse the cached output and just re-grade.
  private denoiseCacheSample = -1;
  private denoiseCacheTex: THREE.Texture | undefined;
  private fpsElapsed = 0;
  private fpsFrames = 0;
  // True while exporting a still at an off-screen resolution: freezes the live update loop
  // so the pinned camera/dive state and resized buffers are not disturbed mid-capture.
  private exporting = false;
  // Set by `cancelExport` to abort an in-flight export run; the poll loop bails and the
  // `finally` restores the live pipeline, skipping the download.
  private exportCancelled = false;
  // Presentation gating: GPU work runs only when something visible changed, instead of
  // re-marching and re-grading an unchanged image at vsync forever. sceneDirty means the
  // fractal must re-march (camera/shape/look/size moved); presentDirty means only the
  // post/denoise side changed and the existing buffer just needs re-presenting.
  private sceneDirty = true;
  private presentDirty = true;

  private resizeTimer = 0;
  // Once a render/shader error is surfaced, stop driving the loop so it isn't spammed.
  private fatalError = false;
  // The boot loading screen stays up until the first preview frame has been rendered and
  // presented (the first renderTo compiles the WGSL preview pipeline); then it fades out.
  private firstFramePresented = false;
  private loop: { readonly stop: () => void } | undefined;
  private readonly onWindowResize = (): void => this.scheduleResize();

  constructor(deps: RenderEngineDeps) {
    this.renderer = deps.renderer;
    this.state = deps.state;
    this.activeShape = deps.initialShape;
    this.onFirstFrame = deps.onFirstFrame;
    this.onFatal = deps.onFatal;

    this.fractal = new FractalPass(deps.initialShape.formula);
    this.controls = new CameraControls(deps.renderer.domElement, this.stage);

    this.width = Math.max(1, window.innerWidth);
    this.height = Math.max(1, window.innerHeight);
    this.sampleRT = makeSampleTarget(this.width, this.height);
    this.accumulation = new AccumulationBuffer(this.width, this.height, this.sampleRT.texture);
    this.denoiser = new AtrousDenoiser(this.width, this.height);
    this.post = new PostChain(deps.renderer, this.accumulation.texture);
    this.fractal.resize(this.width, this.height);
  }

  /** The current accumulated sample index (read by the authoring hook and the exporter). */
  get sampleIndex(): number {
    return this.sampleIndexValue;
  }

  /** The active geometry half. The state bridge and controller read it; only `setShape` writes it. */
  get shape(): FractalShape {
    return this.activeShape;
  }

  /** Swap the geometry half being rendered. Pushing it to the GPU is the bridge's job. */
  setShape(next: FractalShape): void {
    this.activeShape = next;
  }

  /** Scale the pointer/wheel camera gestures (orbit/pan/roll/zoom, mouse and touch). */
  setControlSensitivity(value: number): void {
    this.controls.setSensitivity(value);
  }

  // Resize the whole render pipeline (canvas buffer + every target + camera aspect) in one
  // place, shared by the window resize handler and the still exporter. `updateStyle` is false
  // during export so the on-screen canvas box stays put while only its backing buffer grows.
  resize(w: number, h: number, updateStyle = true): void {
    this.renderer.setSize(w, h, updateStyle);
    this.stage.resize(w, h);
    this.fractal.resize(w, h);
    this.sampleRT.setSize(w, h);
    this.accumulation.resize(w, h);
    this.denoiser.resize(w, h);
    this.sceneDirty = true;
  }

  // Any change drops back to the live preview and discards the render in progress.
  resetAccumulation(): void {
    this.sampleIndexValue = 0;
    this.state.sampleCount = 0;
    this.state.rendering = false;
    this.sceneDirty = true;
    // A new run reuses sampleIndex 0, so a stale cache key would mask the fresh mean.
    this.denoiseCacheSample = -1;
  }

  // Post-side change: re-present the existing buffer on the next frame without re-marching.
  markPresent(): void {
    this.presentDirty = true;
  }

  // Start an explicit render run (Controller.startRender): accumulate from sample 0.
  startRender(): void {
    this.sampleIndexValue = 0;
    this.state.sampleCount = 0;
    this.state.rendering = true;
  }

  // Size the live pipeline to the window minus the reserved inset (docked UI).
  resizeLiveViewport(): void {
    // Ignore live resizes while an export owns the pipeline; it restores the buffers itself.
    if (this.exporting) return;
    this.width = Math.max(1, window.innerWidth - this.viewportRightInset);
    this.height = Math.max(1, window.innerHeight - this.viewportBottomInset);
    this.state.resolutionWidth = this.width;
    this.state.resolutionHeight = this.height;
    this.resize(this.width, this.height);
    this.resetAccumulation();
  }

  // Resize storms (window-edge drags, UI inset animations) fire roughly per frame, and each
  // resizeLiveViewport disposes and reallocates ~7 full-res float32 targets (~230 MB at
  // 1080p). Accumulation resets on every resize anyway, so intermediate sizes are pure waste:
  // coalesce to the trailing edge so only the final size pays the reallocation.
  scheduleResize(): void {
    if (this.resizeTimer !== 0) clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.resizeTimer = 0;
      this.resizeLiveViewport();
    }, 150);
  }

  setRightInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (next === this.viewportRightInset) return;
    this.viewportRightInset = next;
    this.scheduleResize();
  }

  setBottomInset(px: number): void {
    const next = Math.max(0, Math.round(px));
    if (next === this.viewportBottomInset) return;
    this.viewportBottomInset = next;
    this.scheduleResize();
  }

  cancelExport(): void {
    this.exportCancelled = true;
  }

  async exportImage(
    options: ExportOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<ExportResult> {
    if (this.exporting) return { ok: false, error: "An export is already in progress." };
    this.exporting = true;
    this.exportCancelled = false;
    // Settings the export perturbs, captured so the live view is restored verbatim. The
    // viewport size is NOT captured: it's re-derived from the window in the `finally`, so a
    // resize that happened mid-export is applied rather than swallowed.
    const live = {
      pixelRatio: this.renderer.getPixelRatio(),
      sampleCap: this.state.sampleCap,
      denoise: this.state.denoise,
    };
    try {
      // 1:1 device pixels so the captured buffer is exactly the requested resolution.
      this.renderer.setPixelRatio(1);
      this.resize(options.width, options.height, false);

      // Kick off a fresh converged run at the export settings. resetAccumulation clears
      // `rendering`, so re-arm it after; the loop accumulates one sample per frame.
      this.state.denoise = options.denoise;
      this.state.sampleCap = options.sampleCap;
      this.resetAccumulation();
      this.state.rendering = true;

      // Wait for the loop to reach the cap (or a cancel), reporting progress as it climbs.
      await new Promise<void>((resolve) => {
        const poll = (): void => {
          onProgress?.(Math.min(1, this.sampleIndexValue / options.sampleCap));
          if (this.exportCancelled || this.sampleIndexValue >= options.sampleCap) resolve();
          else requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });
      // Cancelled mid-run: abandon the capture; the `finally` restores the live view.
      if (this.exportCancelled) return { ok: false, cancelled: true };
      // One more frame so the converged branch presents the final (denoised) image
      // (presentDirty forces it; the gated loop would otherwise idle there).
      this.presentDirty = true;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      // toBlob snapshots the canvas at call time (same timing contract the old
      // toDataURL relied on) but encodes off the main thread - toDataURL froze the
      // UI for seconds on a 33 MP 8K PNG.
      const mime = options.format === "jpeg" ? "image/jpeg" : "image/png";
      const blob = await new Promise<Blob | null>((resolve) =>
        this.renderer.domElement.toBlob(resolve, mime, options.quality),
      );
      if (!blob) return { ok: false, error: "Could not encode the image." };
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.download = options.filename;
      anchor.href = url;
      anchor.click();
      // Defer revoke: a synchronous revoke can race the download fetch's blob deref.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Export failed." };
    } finally {
      this.renderer.setPixelRatio(live.pixelRatio);
      this.state.denoise = live.denoise;
      this.state.sampleCap = live.sampleCap;
      // Clear the flag before resizing so resizeLiveViewport doesn't early-return. It
      // re-derives the size from the current window (applying any swallowed mid-export
      // resize), reallocates targets to that size, and resets accumulation.
      this.exporting = false;
      this.resizeLiveViewport();
    }
  }

  /**
   * Background-warm the remaining formula pipelines after the first frame is up, so a later
   * preset/shape switch doesn't freeze the UI on a cold compile. Runs with the loop live: it
   * compiles on an isolated scene against the same sample target the loop renders to, without
   * blocking the JS frame loop (the live preview keeps ticking). Best-effort - a formula that
   * fails to compile is skipped, not fatal. `onProgress(done, total)` drives the UI indicator.
   */
  async warmShaders(onProgress: (done: number, total: number) => void): Promise<void> {
    await this.fractal.precompile(this.renderer, this.sampleRT, onProgress);
  }

  /** Begin driving frames and listening for window resizes. */
  start(): void {
    window.addEventListener("resize", this.onWindowResize);
    this.loop = startLoop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
    });
  }

  private update(dt: number): void {
    // While exporting, the camera/dive are pinned and the buffers are export-sized:
    // skip all live bookkeeping so nothing resets the accumulation mid-capture.
    if (this.exporting) return;
    const shape = this.activeShape;
    this.fpsElapsed += dt;
    this.fpsFrames += 1;
    if (this.controls.consumeChanged()) this.resetAccumulation();
    // Dive bookkeeping (infinite zoom): steer the orbit pivot onto the surface, re-base
    // the world scale when the camera leaves the orbit band, and re-anchor through the
    // Apollonian's own self-similarity map. Every change is view-preserving, but the
    // uniforms moved, so drop the accumulation.
    if (
      this.dive.update(
        this.stage,
        shape.formula,
        this.fractal.uniforms.formulaP.value,
        this.state.iterations,
      )
    ) {
      this.resetAccumulation();
    }
    this.fractal.syncDive(this.dive.offset, this.dive.basis, this.dive.scale);
    this.fractal.uniforms.iterations.value =
      this.state.iterations + this.dive.extraIterations(this.stage.distance);
    // Warp Lipschitz division shrinks every step; grow the budget to match (capped).
    const warpBoost = this.dive.warp ? warpStepBoost(this.dive.warp) : 1;
    this.fractal.uniforms.renderP.value.x = Math.round(
      this.dive.marchSteps(shape.render.maxSteps, this.stage.distance) * warpBoost,
    );
    // Floor the draw distance at the camera's own distance (plus the fractal's extent):
    // shapes tune maxDistance for close-up framing, and a far pull-back would otherwise
    // march past the budget and silently cull the whole shape.
    this.fractal.uniforms.renderP.value.y = Math.max(
      this.dive.maxDistance(shape.render.maxDistance),
      this.stage.distance + 8,
    );
    if (this.fpsElapsed >= FPS_INTERVAL) {
      this.state.fps = Math.round(this.fpsFrames / this.fpsElapsed);
      this.fpsElapsed = 0;
      this.fpsFrames = 0;
    }
  }

  private render(): void {
    if (this.fatalError) return;
    try {
      if (!this.state.rendering) {
        // Preview: one sharp analytic sample, shown directly (blend factor 1).
        // Skipped entirely while nothing changed - the canvas holds the last frame,
        // so an idle workstation costs zero GPU. Animated grain alone keeps the
        // cheap post pass ticking.
        if (this.sceneDirty) {
          // Track the live camera while interacting.
          this.fractal.syncCamera(this.stage.camera);
          this.fractal.setMode(MODE_PREVIEW);
          this.fractal.setFrame(0);
          this.fractal.renderTo(this.renderer, this.sampleRT);
          this.accumulation.accumulate(this.renderer, 0);
          this.post.setSource(this.accumulation.texture);
          this.sceneDirty = false;
          this.presentDirty = false;
          this.post.render();
          this.sampleIndexValue = 0;
          // First real pixels are up: retire the boot loading screen.
          if (!this.firstFramePresented) {
            this.firstFramePresented = true;
            this.onFirstFrame();
          }
        } else if (this.presentDirty || this.post.grainStrength.value > 0) {
          this.presentDirty = false;
          this.post.render();
        }
        return;
      }

      // Rendering (explicit action): accumulate path-traced samples up to the cap.
      const present = (): void => {
        let tex: THREE.Texture;
        if (this.state.denoise) {
          // Re-filter only when the mean advanced (or denoise was just re-enabled, which
          // resets the key to -1 below); otherwise reuse the cached denoised texture so a
          // converged frame doesn't re-run 4 à-trous passes per vsync for animated grain.
          if (this.denoiseCacheSample !== this.sampleIndexValue) {
            this.denoiseCacheTex = this.denoiser.run(
              this.renderer,
              this.accumulation.texture,
              this.sampleIndexValue,
            );
            this.denoiseCacheSample = this.sampleIndexValue;
          }
          tex = this.denoiseCacheTex!;
        } else {
          tex = this.accumulation.texture;
          this.denoiseCacheSample = -1;
        }
        this.post.setSource(tex);
        this.post.render();
        this.presentDirty = false;
        // The samples readout follows the present cadence rather than the frame
        // rate, so this reactive write stops re-rendering the status bar at 60+ Hz.
        this.state.sampleCount = this.sampleIndexValue;
      };

      if (this.sampleIndexValue >= this.state.sampleCap) {
        // Converged: idle. Re-present only when the post/denoise side changes (the
        // denoise toggle still takes effect) or animated grain needs a fresh seed -
        // not 4 bilateral passes plus the bloom chain at vsync forever.
        if (this.presentDirty || this.post.grainStrength.value > 0) present();
        return;
      }
      if (this.sampleIndexValue === 0) {
        // Pin the camera for the whole run so every sample shares one orientation,
        // and capture the denoiser's primary-hit feature buffers once per run.
        this.fractal.syncCamera(this.stage.camera);
        this.fractal.setMode(MODE_FEATURE_ND);
        this.fractal.renderTo(this.renderer, this.denoiser.featureND);
        this.fractal.setMode(MODE_FEATURE_ALBEDO);
        this.fractal.renderTo(this.renderer, this.denoiser.featureAlbedo);
      }
      this.fractal.setMode(MODE_PATHTRACE);
      this.fractal.setFrame(this.sampleIndexValue);
      this.fractal.renderTo(this.renderer, this.sampleRT);
      this.accumulation.accumulate(this.renderer, this.sampleIndexValue);
      this.sampleIndexValue += 1;
      // Present every Nth sample: the denoise + bloom + post chain can cost as much
      // as the sample itself, so presenting at ~8-15 Hz instead of every frame buys
      // back a large slice of convergence throughput. The first and final samples
      // always present, as does any post-side tweak mid-render.
      const presentEvery = this.sampleIndexValue < 64 ? 4 : 8;
      if (
        this.sampleIndexValue >= this.state.sampleCap ||
        this.sampleIndexValue === 1 ||
        this.sampleIndexValue % presentEvery === 0 ||
        this.presentDirty
      ) {
        present();
      }
    } catch (error) {
      this.fatalError = true;
      this.loop?.stop();
      this.onFatal(
        `KFractal hit a rendering error: ${error instanceof Error ? error.message : "unknown error"}. Reload the page to continue.`,
      );
      console.error(error);
    }
  }

  // Single teardown path (HMR, embedding, tests). Stops the loop, drops the resize listener,
  // and releases the GPU resources whose dispose() methods exist for exactly this purpose.
  teardown(): void {
    this.loop?.stop();
    window.removeEventListener("resize", this.onWindowResize);
    this.controls.dispose();
    this.fractal.dispose();
    this.accumulation.dispose();
    this.denoiser.dispose();
    this.post.dispose();
    this.sampleRT.dispose();
  }
}

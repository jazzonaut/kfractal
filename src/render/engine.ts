import * as THREE from "three/webgpu";
import { FPS_INTERVAL, LIVE_RENDER_SAMPLE_CAP } from "../config/constants";
import { startLoop } from "../core/loop";
import { warpStepBoost } from "../fractal/warp";
import { CHAIN_PREVIEW_ITERS, chainStepScale } from "../fractal/chain";
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
import { PreviewQuality, initialPreviewScale } from "./preview-quality";
import { Stage } from "./stage";
import { effectiveSupersample } from "./supersample";

// Export watchdog floor (see exportImage): the minimum no-progress window before a run is
// abandoned. The live threshold adapts upward from here to a multiple of the slowest sample
// actually observed, so a heavy formula at 8K - where one sample can legitimately take far
// longer than this - is never mistaken for a stall. This floor only has to cover the FIRST
// sample, before any per-sample cost has been measured; hence it is generous on its own.
const EXPORT_STALL_MS = 60000;
// Once at least one sample has completed, treat "no progress for longer than this multiple of
// the slowest sample seen" as a stall - adaptive headroom over real per-sample cost.
const EXPORT_STALL_SAMPLE_FACTOR = 4;

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
  // Display (canvas) size in CSS pixels - the box the image fills. The render targets are
  // sized separately at `width * previewScale` (see syncRenderScale): in the live preview the
  // heavy fractal march runs into a smaller buffer that the post pass upscales to the canvas;
  // the progressive render and export force the scale back to native.
  private width: number;
  private height: number;
  // Current render-target size, kept in sync with the display size and the active scale.
  private renderWidth: number;
  private renderHeight: number;
  // Live-preview render-scale (1 = native). Driven by `previewQuality` when auto-quality is on;
  // pinned at 1 otherwise, and ignored while rendering/exporting (always native there).
  private previewScale = 1;
  private autoQualityEnabled = false;
  private previewQuality = new PreviewQuality();
  // True when the previous frame actually re-marched the preview (so its frame time is a real
  // load signal). Cleared on idle/converged/rendering frames, which the gated loop makes free.
  private lastPreviewMarch = false;
  // Live render (low-res progressive preview, opt-in). When on, the live view keeps the cheap
  // analytic preview WHILE the camera moves, then accumulates a downsampled path-trace once the
  // view settles - real lighting/colour at the auto-quality scale, never touching state.rendering
  // (the explicit Render/Export stay native). `liveRenderSample` is its own accumulation counter,
  // independent of the explicit render's `sampleIndexValue`; it resets to 0 on every scene change.
  private liveRender = false;
  private liveRenderSample = 0;
  // True while the live render's full path-trace pipeline is compiling off the synchronous path
  // (see ensureLiveRenderPipeline). Guards against launching a second overlapping compile, and the
  // render loop keeps showing the analytic preview until it clears so the frame never freezes on a
  // cold compile. Surfaced to the status bar via state.preparingLiveRender.
  private liveRenderWarming = false;
  // True for the frames in which the view is being actively manipulated (camera gesture or dive
  // step), as opposed to a settings edit. In live-render mode it routes the cheap analytic
  // preview to camera motion only: a settings change skips the analytic frame and refines the
  // path-trace in place, so the image never flashes the (differently-shaded) preview look.
  private viewChanging = false;

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
    // Targets start at native; auto-quality (if enabled) seeds its scale via setAutoQuality
    // shortly after boot, before any heavy frames are rendered.
    this.renderWidth = this.width;
    this.renderHeight = this.height;
    this.sampleRT = makeSampleTarget(this.renderWidth, this.renderHeight);
    this.accumulation = new AccumulationBuffer(
      this.renderWidth,
      this.renderHeight,
      this.sampleRT.texture,
    );
    this.denoiser = new AtrousDenoiser(this.renderWidth, this.renderHeight);
    this.post = new PostChain(deps.renderer, this.accumulation.texture);
    this.fractal.resize(this.renderWidth, this.renderHeight);
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

  // Resize the canvas + camera aspect to a new display size, then re-derive the render targets
  // through the active scale. Shared by the window resize handler and the still exporter.
  // `updateStyle` is false during export so the on-screen canvas box stays put while only its
  // backing buffer grows. The camera aspect comes from the display size; the targets follow the
  // (uniformly scaled) render size, so the aspect is identical either way.
  resize(w: number, h: number, updateStyle = true): void {
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, updateStyle);
    this.stage.resize(w, h);
    // Force a re-sync: the display size changed, so the render size almost certainly did too.
    this.renderWidth = 0;
    this.syncRenderScale();
    // A display resize reallocates every target; drop the rolling window so that one-off
    // realloc spike doesn't leak into the auto-quality average as a slow "frame".
    this.previewQuality.reset();
  }

  // Resize only the render targets to match the current display size and mode scale: native
  // while rendering or exporting (the final image is always full quality), the auto-quality
  // tier in the live preview. A cheap no-op when the resulting size is unchanged, so the
  // per-edit resetAccumulation path can call it on every frame without churning GPU memory.
  private syncRenderScale(): void {
    const scale = this.exporting || this.state.rendering ? 1 : this.previewScale;
    const rw = Math.max(1, Math.round(this.width * scale));
    const rh = Math.max(1, Math.round(this.height * scale));
    if (rw === this.renderWidth && rh === this.renderHeight) return;
    this.renderWidth = rw;
    this.renderHeight = rh;
    this.fractal.resize(rw, rh);
    this.sampleRT.setSize(rw, rh);
    this.accumulation.resize(rw, rh);
    this.denoiser.resize(rw, rh);
    this.sceneDirty = true;
  }

  // Enable/disable live-preview auto-quality. Enabling seeds the scale from a device guess and
  // lets the runtime loop adapt from there; disabling snaps back to native. The progressive
  // render and export are never affected. The controller persists the choice.
  setAutoQuality(enabled: boolean): void {
    this.autoQualityEnabled = enabled;
    if (enabled) {
      this.previewScale = initialPreviewScale();
      this.previewQuality = new PreviewQuality({ initialScale: this.previewScale });
    } else {
      this.previewScale = 1;
      this.previewQuality.reset();
    }
    this.state.previewScale = this.previewScale;
    this.syncRenderScale();
  }

  // Enable/disable the live render (low-res progressive preview). Flagging dirty forces the next
  // frame to redraw the analytic preview, from which the loop either re-settles into a fresh
  // live-render accumulation (enabled) or simply holds the clean preview (disabled). No effect
  // while an explicit render/export owns the loop. The controller persists the choice.
  setLiveRender(enabled: boolean): void {
    this.liveRender = enabled;
    this.liveRenderSample = 0;
    if (!this.state.rendering) this.sceneDirty = true;
  }

  // Warm the active source's full path-trace pipeline off the synchronous render path so the live
  // render's first feature/path-trace frame is a cache hit instead of a frame-freezing cold
  // compile (the same guard startRender uses). Non-blocking: the live preview keeps running and
  // the loop holds the analytic preview until this resolves. Idempotent via liveRenderWarming;
  // re-fires per source because renderPipelineReady goes false again after a formula/chain change.
  private ensureLiveRenderPipeline(): void {
    if (this.liveRenderWarming) return;
    this.liveRenderWarming = true;
    this.state.preparingLiveRender = true;
    void this.fractal
      .ensureRenderPipeline(this.renderer, this.sampleRT)
      .catch((error) => console.error("Live render pipeline compile failed", error))
      .finally(() => {
        this.liveRenderWarming = false;
        this.state.preparingLiveRender = false;
        // Pipeline ready (or failed): nudge a frame so the live render starts, or re-checks the
        // source if it changed mid-compile (renderPipelineReady will re-trigger this if so).
        this.sceneDirty = true;
      });
  }

  // Any change drops back to the live preview and discards the render in progress.
  resetAccumulation(): void {
    this.sampleIndexValue = 0;
    // A scene change invalidates any in-flight live-render accumulation: restart it from 0 so
    // the settled view re-marches the path-trace rather than blending onto a stale mean.
    this.liveRenderSample = 0;
    this.state.sampleCount = 0;
    this.state.rendering = false;
    // Cancels an in-flight startRender compile: its post-await guard sees this and stays preview.
    this.state.preparingRender = false;
    // Back in preview: re-apply the auto-quality tier (no-op when already at preview scale, so
    // this stays free on the per-edit/per-camera-move path that calls resetAccumulation).
    this.syncRenderScale();
    this.sceneDirty = true;
    // A new run reuses sampleIndex 0, so a stale cache key would mask the fresh mean.
    this.denoiseCacheSample = -1;
  }

  // Post-side change: re-present the existing buffer on the next frame without re-marching.
  markPresent(): void {
    this.presentDirty = true;
  }

  // Start an explicit render run (Controller.startRender): accumulate from sample 0.
  async startRender(): Promise<void> {
    // Compile the full path-trace pipeline off the synchronous render path first: the sample-0
    // feature pass would otherwise compile it inside renderTo and freeze the UI for the cold
    // compile. The live preview keeps running while this resolves (usually a warm cache hit).
    this.state.preparingRender = true;
    try {
      await this.fractal.ensureRenderPipeline(this.renderer, this.sampleRT);
    } catch (error) {
      console.error("Render pipeline compile failed; starting render anyway", error);
    }
    // Stopped or edited mid-compile (resetAccumulation cleared the flag): stay in preview.
    if (!this.state.preparingRender) return;
    this.state.preparingRender = false;
    this.sampleIndexValue = 0;
    this.state.sampleCount = 0;
    this.state.rendering = true;
    // The progressive render is the final-quality pass: force native resolution regardless of
    // the live preview's auto-quality tier (the user opted into preview-only downscaling).
    this.syncRenderScale();
  }

  // Size the live pipeline to the window minus the reserved inset (docked UI).
  resizeLiveViewport(): void {
    // Ignore live resizes while an export owns the pipeline; it restores the buffers itself.
    if (this.exporting) return;
    const w = Math.max(1, window.innerWidth - this.viewportRightInset);
    const h = Math.max(1, window.innerHeight - this.viewportBottomInset);
    // The readout reports the display resolution; the auto-quality badge reports the scale.
    this.state.resolutionWidth = w;
    this.state.resolutionHeight = h;
    this.resize(w, h);
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

  /**
   * The GPU's max 2D texture dimension, the ceiling on the supersampled export buffer. Read
   * defensively through three's internal backend (renamed internals degrade to the 8192 safe
   * baseline, never throw); single cast site, surfaced to the export dialog via the controller.
   */
  get maxTextureDimension2D(): number {
    return (
      (
        this.renderer as unknown as {
          backend?: { device?: { limits?: { maxTextureDimension2D?: number } } };
        }
      ).backend?.device?.limits?.maxTextureDimension2D ?? 8192
    );
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
    // A non-positive cap (corrupt/programmatic ExportOptions) would make the progress
    // divide by zero (NaN) and satisfy `samples >= cap` at sample 0, resolving instantly
    // with a blank/preview frame reported as a successful capture. Floor at 1 real sample.
    const sampleCap = Math.max(1, Math.floor(options.sampleCap));
    // Supersampling: render larger, downsample on capture. The factor is clamped so the
    // internal buffer never exceeds the GPU texture limit (see maxTextureDimension2D); the
    // export dialog's hint computes through the same helper + limit, so they never disagree.
    const ss = effectiveSupersample(
      options.width,
      options.height,
      options.supersample,
      this.maxTextureDimension2D,
    );
    const renderW = options.width * ss;
    const renderH = options.height * ss;
    try {
      // 1:1 device pixels so the captured buffer is exactly the requested resolution.
      this.renderer.setPixelRatio(1);
      this.resize(renderW, renderH, false);

      // Kick off a fresh converged run at the export settings. resetAccumulation clears
      // `rendering`, so re-arm it after; the loop accumulates one sample per frame.
      this.state.denoise = options.denoise;
      this.state.sampleCap = sampleCap;
      this.resetAccumulation();
      this.state.rendering = true;

      // Wait for the loop to reach the cap (or a cancel), reporting progress as it climbs.
      // A watchdog guards against a run that never reaches the cap (a render error stops the
      // loop, or accumulation stalls): without it the promise never resolves, `exporting`
      // stays true, and the live viewport is frozen forever with no way back short of reload.
      let stalled = false;
      await new Promise<void>((resolve) => {
        let lastSample = -1;
        let lastProgressAt = performance.now();
        // Largest inter-sample gap seen so far; the stall budget is a multiple of this, so a
        // legitimately heavy sample raises the bar rather than tripping the watchdog.
        let slowestSampleMs = 0;
        const poll = (): void => {
          onProgress?.(Math.min(1, this.sampleIndexValue / sampleCap));
          const now = performance.now();
          if (this.sampleIndexValue !== lastSample) {
            // A sample landed: fold its duration into the running max (skip the first transition,
            // -1 -> 0, which measures nothing), then reset the no-progress clock.
            if (lastSample >= 0) slowestSampleMs = Math.max(slowestSampleMs, now - lastProgressAt);
            lastSample = this.sampleIndexValue;
            lastProgressAt = now;
          } else if (
            now - lastProgressAt >
            Math.max(EXPORT_STALL_MS, slowestSampleMs * EXPORT_STALL_SAMPLE_FACTOR)
          ) {
            stalled = true;
          }
          if (
            this.exportCancelled ||
            this.fatalError ||
            stalled ||
            this.sampleIndexValue >= sampleCap
          ) {
            resolve();
            return;
          }
          requestAnimationFrame(poll);
        };
        requestAnimationFrame(poll);
      });
      // A render error stopped the loop mid-export, or it stalled with no progress: abandon
      // the capture with a message; the `finally` restores the live view either way.
      if (this.fatalError) {
        return { ok: false, error: "The renderer stopped before the export finished." };
      }
      if (stalled) {
        return { ok: false, error: "The export stalled before reaching the sample cap." };
      }
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
      // Downsample the supersampled buffer to the output size; a 1x export encodes the WebGPU
      // canvas directly. Halving steps until within 2x of the target keep every drawImage at
      // a <=2x ratio, where the browser's filter is a reliable box-ish average - a single big
      // reduction (e.g. 4x in one step) aliases more on some browsers.
      let capture: HTMLCanvasElement = this.renderer.domElement;
      if (ss > 1) {
        let curW = renderW;
        let curH = renderH;
        let src: CanvasImageSource = this.renderer.domElement;
        while (curW > options.width * 2 || curH > options.height * 2) {
          const nextW = Math.max(options.width, Math.floor(curW / 2));
          const nextH = Math.max(options.height, Math.floor(curH / 2));
          const step = document.createElement("canvas");
          step.width = nextW;
          step.height = nextH;
          const sctx = step.getContext("2d");
          if (!sctx) return { ok: false, error: "Could not allocate the downsample canvas." };
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = "high";
          sctx.drawImage(src, 0, 0, nextW, nextH);
          src = step;
          curW = nextW;
          curH = nextH;
        }
        const out = document.createElement("canvas");
        out.width = options.width;
        out.height = options.height;
        const ctx = out.getContext("2d");
        if (!ctx) return { ok: false, error: "Could not allocate the downsample canvas." };
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(src, 0, 0, options.width, options.height);
        capture = out;
      }
      // Flatten onto an opaque surface before encoding. The WebGPU canvas carries alpha < 1 in
      // bright regions; it's invisible on screen (alphaMode 'opaque') and dropped by JPEG, but PNG
      // keeps it - and a viewer then un-premultiplies and composites those highlights out to white
      // (a blown-out export). Compositing over an opaque (alpha:false) context drops alpha the same
      // way the working JPEG path does, so PNG matches the screen.
      const flat = document.createElement("canvas");
      flat.width = options.width;
      flat.height = options.height;
      const fctx = flat.getContext("2d", { alpha: false });
      if (!fctx) return { ok: false, error: "Could not allocate the export canvas." };
      fctx.drawImage(capture, 0, 0);
      capture = flat;
      const blob = await new Promise<Blob | null>((resolve) =>
        capture.toBlob(resolve, mime, options.quality),
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
    const cameraChanged = this.controls.consumeChanged();
    if (cameraChanged) this.resetAccumulation();
    // Dive bookkeeping (infinite zoom): steer the orbit pivot onto the surface, re-base
    // the world scale when the camera leaves the orbit band, and re-anchor through the
    // Apollonian's own self-similarity map. Every change is view-preserving, but the
    // uniforms moved, so drop the accumulation.
    // Chains carry a much higher iteration cap; the live preview marches a capped count for
    // interactivity, while an explicit render/export (state.rendering) uses the full count.
    // Computed before dive.update so the dive's f64 CPU mirror pins against the SAME surface the
    // GPU draws - otherwise the preview-capped GPU surface is fatter than the full-count surface
    // the pin steers against, and the camera can penetrate the drawn geometry before it engages.
    const baseIters =
      this.dive.chain && !this.state.rendering
        ? Math.min(this.state.iterations, CHAIN_PREVIEW_ITERS)
        : this.state.iterations;
    const diveChanged = this.dive.update(
      this.stage,
      shape.formula,
      this.fractal.uniforms.formulaP.value,
      baseIters,
    );
    if (diveChanged) this.resetAccumulation();
    // A camera gesture or dive step is active view manipulation; a settings edit is not. The
    // live-render branch uses this to decide between the snappy analytic preview and refining
    // the path-trace in place (see render()).
    this.viewChanging = cameraChanged || diveChanged;
    this.fractal.syncDive(this.dive.offset, this.dive.basis, this.dive.scale);
    this.fractal.uniforms.iterations.value =
      baseIters + this.dive.extraIterations(this.stage.distance);
    // Warp Lipschitz division shrinks every step; grow the budget to match (capped). A chain
    // can raise the field's Lipschitz constant too, so its step-scale boosts the budget the
    // same way (design §3.4): more steps cover the same span the tighter march now needs.
    const warpBoost = this.dive.warp ? warpStepBoost(this.dive.warp) : 1;
    const chainBoost = this.dive.chain ? chainStepScale(this.dive.chain) : 1;
    this.fractal.uniforms.renderP.value.x = Math.round(
      this.dive.marchSteps(shape.render.maxSteps, this.stage.distance) * warpBoost * chainBoost,
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
    // Auto-quality: react to the cost of the previous *active* preview frame. Idle/converged
    // frames are skipped (lastPreviewMarch) - the gated loop makes them ~free, so sampling them
    // would read as a comfortable frame rate and wrongly pull the resolution back up.
    if (this.autoQualityEnabled && !this.state.rendering && this.lastPreviewMarch) {
      if (this.previewQuality.sample(dt)) {
        this.previewScale = this.previewQuality.scale;
        this.state.previewScale = this.previewScale;
        this.syncRenderScale();
      }
    }
  }

  // Present an accumulated mean (the path-traced buffer) through the denoise + post chain. Shared
  // by the explicit render and the live render. `sampleCount` is the count the running mean holds
  // (drives both the denoiser's converge-fade and its re-filter cache key); re-filters only when
  // that count advanced, otherwise re-grades the cached denoised texture. With denoise off it
  // presents the raw accumulation. Does not touch `state.sampleCount` (explicit-render only).
  private presentMean(sampleCount: number): void {
    let tex: THREE.Texture;
    if (this.state.denoise) {
      if (this.denoiseCacheSample !== sampleCount) {
        this.denoiseCacheTex = this.denoiser.run(
          this.renderer,
          this.accumulation.texture,
          sampleCount,
        );
        this.denoiseCacheSample = sampleCount;
      }
      tex = this.denoiseCacheTex!;
    } else {
      tex = this.accumulation.texture;
      this.denoiseCacheSample = -1;
    }
    this.post.setSource(tex);
    this.post.render();
    this.presentDirty = false;
  }

  // First real pixels are up: retire the boot loading screen (once). Called from whichever live
  // path presents first - the analytic preview, or the live render when it owns the first frame.
  private markFirstFrame(): void {
    if (this.firstFramePresented) return;
    this.firstFramePresented = true;
    this.onFirstFrame();
  }

  private render(): void {
    if (this.fatalError) return;
    // A frame whose cost auto-quality should weigh flips this back on below: the analytic
    // preview march (plain preview) or a live-render path-trace sample. Idle, present-only, and
    // explicit-render frames leave it false (rendering forces native, so auto-quality is off).
    this.lastPreviewMarch = false;
    try {
      if (!this.state.rendering) {
        // Live render needs the full path-trace pipeline. If it isn't compiled yet for the current
        // source (warm-up hasn't reached it, a shape switch, or a chain that can't be pre-warmed),
        // warm it OFF the synchronous path - otherwise the first feature/path-trace renderTo below
        // would cold-compile and freeze the whole frame. While it compiles we keep showing the
        // analytic preview, so the app stays live (and the status bar shows "Compiling render…").
        const liveBlocked = this.liveRender && !this.fractal.renderPipelineReady();
        if (liveBlocked) this.ensureLiveRenderPipeline();
        // Analytic preview: one sharp analytic sample, shown directly (blend factor 1). Skipped
        // while nothing changed - the canvas holds the last frame, so an idle workstation costs
        // zero GPU. It runs for: plain preview (always, on any change); live-render mode ONLY
        // while the view is being actively manipulated (a camera gesture / dive step) or while the
        // render pipeline is still warming; and the very first frame (a fast preview retires the
        // boot loader before the heavier path-trace pipeline compiles). A live-render SETTINGS edit
        // deliberately does NOT run it - it falls through to the live block, which refines the
        // path-trace in place so the image never flashes the differently-shaded preview look.
        const wantAnalytic =
          !this.liveRender || this.viewChanging || !this.firstFramePresented || liveBlocked;
        if (this.sceneDirty && wantAnalytic) {
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
          // Settling restarts the live render from sample 0; the analytic frame it would blend
          // onto is discarded by the first path-trace sample's blend-factor-1 overwrite.
          this.liveRenderSample = 0;
          // Auto-quality should measure the heavy path-trace samples in live-render mode, not
          // these cheap analytic frames (feeding both would pump the tier between drag and
          // settle). In plain preview the analytic frame IS the load signal, so it still feeds.
          this.lastPreviewMarch = !this.liveRender;
          this.markFirstFrame();
          return;
        }
        // Live render: accumulate the real path-traced lighting at the (auto-quality) preview
        // scale up to a low cap, then idle. Entered both on a settled view (climb to the cap)
        // and on a settings edit (sceneDirty true here means the analytic frame was deliberately
        // skipped above). Mirrors the explicit render loop below but on its own counter and
        // without flipping state.rendering (the explicit Render/Export stay native + full-cap).
        const liveCap = Math.min(this.state.sampleCap, LIVE_RENDER_SAMPLE_CAP);
        if (
          this.liveRender &&
          !liveBlocked &&
          (this.sceneDirty || this.liveRenderSample < liveCap)
        ) {
          // A run starts fresh when the scene was just dirtied (a settings edit, analytic skipped)
          // or the counter sits at 0 (the analytic preview just settled). Capture the denoiser
          // feature buffers once, then choose how the accumulation begins:
          if (this.sceneDirty || this.liveRenderSample === 0) {
            // sceneDirty here ⇒ a settings edit (the analytic frame was skipped); !sceneDirty with
            // a zeroed counter ⇒ the analytic preview just settled (only that path clears dirty
            // and leaves the counter at 0). They want opposite starts:
            //   - settled after orbit/zoom: KEEP the preview already sitting in the accumulation
            //     buffer as sample 0 and start MC sampling at index 1, so the path-trace blends in
            //     over the first samples (blend 1/2, 1/3, …) - a real cross-dissolve from the
            //     preview into the render rather than a hard cut between two different looks.
            //   - a settings edit: overwrite from sample 0, so a value reads crisply each frame
            //     while a slider is dragged (seeding would smear consecutive edits into a trail).
            const dissolveFromPreview = !this.sceneDirty;
            this.sceneDirty = false;
            // Pin the camera and capture the denoiser's primary-hit feature buffers once per run.
            this.fractal.syncCamera(this.stage.camera);
            this.fractal.setMode(MODE_FEATURE_ND);
            this.fractal.renderTo(this.renderer, this.denoiser.featureND);
            this.fractal.setMode(MODE_FEATURE_ALBEDO);
            this.fractal.renderTo(this.renderer, this.denoiser.featureAlbedo);
            // Fresh mean: drop any denoise cache from a previous run so it re-filters from the top.
            this.denoiseCacheSample = -1;
            // Index 1 keeps the buffered preview as the implicit sample 0 (it fades to ~1/liveCap
            // by convergence - imperceptible); index 0 discards it (blend factor 1 overwrites).
            this.liveRenderSample = dissolveFromPreview ? 1 : 0;
          }
          this.fractal.setMode(MODE_PATHTRACE);
          this.fractal.setFrame(this.liveRenderSample);
          this.fractal.renderTo(this.renderer, this.sampleRT);
          this.accumulation.accumulate(this.renderer, this.liveRenderSample);
          this.liveRenderSample += 1;
          // Present early samples eagerly so the lighting visibly builds, then throttle: at the
          // low live cap the denoise + bloom chain can rival a sample's own cost.
          const presentEvery = this.liveRenderSample < 8 ? 1 : 4;
          if (this.liveRenderSample >= liveCap || this.liveRenderSample % presentEvery === 0) {
            this.presentMean(this.liveRenderSample);
            this.markFirstFrame();
          }
          // These ARE the frames whose cost auto-quality should track.
          this.lastPreviewMarch = true;
          return;
        }
        // Idle / converged: re-grade the current source only when the post side changed or
        // animated grain needs a fresh seed (no re-march, no re-denoise - the mean is unchanged).
        if (this.presentDirty || this.post.grainStrength.value > 0) {
          this.presentDirty = false;
          this.post.render();
        }
        return;
      }

      // Rendering (explicit action): accumulate path-traced samples up to the cap.
      const present = (): void => {
        // Denoise (when on, re-filtering only when the mean advanced) + post, via the shared
        // helper. The samples readout follows the present cadence rather than the frame rate,
        // so this reactive write stops re-rendering the status bar at 60+ Hz.
        this.presentMean(this.sampleIndexValue);
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

  // The GPU device was lost (driver TDR, power event, adapter removal). Stop driving frames -
  // the device is gone and every subsequent renderTo would throw - and latch the fatal flag so
  // render() early-returns even if a frame is already mid-flight. The boot path surfaces the
  // reload prompt; this just stops the loop from spamming the dead device. (ADR-0003.)
  notifyDeviceLost(): void {
    this.fatalError = true;
    this.loop?.stop();
  }

  // Single teardown path (HMR, embedding, tests). Stops the loop, drops the resize listener,
  // and releases the GPU resources whose dispose() methods exist for exactly this purpose.
  teardown(): void {
    this.loop?.stop();
    window.removeEventListener("resize", this.onWindowResize);
    // A debounced resize may still be queued; drop it so it can't fire on disposed targets.
    if (this.resizeTimer !== 0) clearTimeout(this.resizeTimer);
    this.controls.dispose();
    this.fractal.dispose();
    this.accumulation.dispose();
    this.denoiser.dispose();
    this.post.dispose();
    this.sampleRT.dispose();
    // Release the renderer and explicitly destroy the GPU device. Without this, each HMR/embed/
    // test re-creation leaks a whole device + swapchain + the appended canvas, and the pending
    // `device.lost` promise keeps the device-lost closure (and the state it captures) alive for
    // the page lifetime. device.lost ignores the "destroyed" reason, so this won't trip the
    // device-lost prompt.
    const device = (this.renderer.backend as { device?: GPUDevice }).device;
    this.renderer.dispose();
    device?.destroy();
    this.renderer.domElement.remove();
  }
}

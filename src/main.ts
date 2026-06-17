import * as THREE from "three/webgpu";
import { PRESETS } from "./fractal/presets";
import {
  BOX_BULB,
  KLEIN_FOAM,
  MANDELBOX_AS_CHAIN,
  MANDELBULB_AS_CHAIN,
  MENGER_SPIRE,
  SIN_BULB,
} from "./fractal/chain-presets";
import { getCpuDe } from "./fractal/cpu-de";
import { warpCpuDe } from "./fractal/warp";
import { createStateBridge, createWorkstationState } from "./fractal/state-bridge";
import { RenderEngine } from "./render/engine";
import { createRenderer } from "./render/renderer";
import { createController } from "./ui/create-controller";
import { mountUi } from "./ui/mount-ui";
import "./styles.css";

/**
 * Register the offline service worker (public/sw.js). Production only: in dev a SW would
 * cache Vite's module graph and fight HMR. The path is base-relative so it resolves both at
 * the local root and under the GitHub Pages repo subpath, and its scope follows from that.
 */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const url = `${import.meta.env.BASE_URL}sw.js`;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).catch(() => {
      // Offline support is a progressive enhancement; a failed registration must never
      // block the renderer from starting.
    });
  });
}

/** Update the status line on the boot loading screen (#loading), if still present. */
function setLoadingStatus(message: string): void {
  const status = document.getElementById("loading-status");
  if (status) status.textContent = message;
}

/** Fade out and remove the boot loading screen. Safe to call more than once. */
function hideLoading(): void {
  const el = document.getElementById("loading");
  if (!el) return;
  el.classList.add("hide");
  // Drop it from the tree once the fade completes so it never traps pointer events.
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  // Fallback for prefers-reduced-motion (no transition fires) or a missed event.
  window.setTimeout(() => el.remove(), 600);
}

/**
 * Show / update / dismiss the small "warming shaders" indicator that runs while the
 * remaining formula pipelines compile in the background after first paint. Created lazily so
 * it never exists when there's nothing to report; removed (with a fade) once done === total.
 */
function setWarmingProgress(done: number, total: number): void {
  if (done >= total) {
    dismissWarming();
    return;
  }
  const el = document.getElementById("warming") ?? createWarmingIndicator();
  const label = el.querySelector("#warming-label");
  if (label) label.textContent = `Warming shaders ${done}/${total}`;
}

/** Fade out and remove the warming indicator if present. Safe to call when it's absent. */
function dismissWarming(): void {
  const el = document.getElementById("warming");
  if (!el) return;
  el.classList.add("hide");
  el.addEventListener("transitionend", () => el.remove(), { once: true });
  window.setTimeout(() => el.remove(), 600);
}

function createWarmingIndicator(): HTMLElement {
  const el = document.createElement("div");
  el.id = "warming";
  // Announce progress to assistive tech without stealing focus.
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  const spinner = document.createElement("span");
  spinner.className = "warming-spinner";
  const label = document.createElement("span");
  label.id = "warming-label";
  el.append(spinner, label);
  document.body.appendChild(el);
  return el;
}

/** Show the full-screen fatal banner (reuses #unsupported) with a custom message. */
function showFatal(message: string): void {
  // The fatal banner sits below the loader; drop the loader so the message is visible.
  hideLoading();
  const el = document.getElementById("unsupported");
  if (!el) return;
  const inner = el.querySelector("div");
  if (inner) inner.textContent = message;
  el.classList.add("show");
}

async function main(): Promise<void> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) {
    showFatal(
      "KFractal needs a WebGPU-capable browser. Use a recent desktop Chrome or Edge build.",
    );
    return;
  }

  const container = document.getElementById("app");
  if (!container) return;

  const initialPreset = PRESETS[0];
  if (!initialPreset) throw new Error("KFractal needs at least one preset.");

  // The device-lost callback may fire at any point after the renderer exists - including during
  // the engine's shader compile below, the likeliest moment for a TDR on a weak GPU. Until the
  // engine exists we can't stop its loop, but we must still surface the prompt; once it exists we
  // upgrade this to also stop the frame loop so it can't spam the dead device.
  let handleDeviceLost: (info: GPUDeviceLostInfo) => void = (info) => {
    showFatal(
      `The graphics device was lost${info.message ? ` (${info.message})` : ""}. Reload the page to continue.`,
    );
  };
  let renderer: THREE.WebGPURenderer;
  try {
    renderer = await createRenderer(container, (info) => handleDeviceLost(info));
  } catch (error) {
    showFatal(
      `KFractal could not start the WebGPU renderer: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
    return;
  }
  setLoadingStatus("Compiling shaders…");

  // Initial viewport size; the engine owns the live size and reserved insets from here on.
  const width = window.innerWidth;
  const height = window.innerHeight;

  // The flat reactive UI store (ADR-0006), built from the initial preset's two halves.
  const state = createWorkstationState(initialPreset, width, height);

  // The render pipeline and frame loop (ADR-0003): owns the GPU targets, accumulation counter,
  // dirty flags, the active geometry half, and the still exporter.
  const engine = new RenderEngine({
    renderer,
    state,
    initialShape: initialPreset.shape,
    onFirstFrame: () => {
      // First real pixels are up: retire the loader, then warm the other formula pipelines
      // in the background so the first switch to each preset doesn't stall on a cold compile.
      hideLoading();
      // Best-effort and fire-and-forget: precompile guards each formula itself, but a defensive
      // catch here ensures any unexpected throw still dismisses the pill rather than leaving the
      // spinner stuck, and is logged rather than surfacing as an unhandled rejection.
      void engine.warmShaders(setWarmingProgress).catch((error) => {
        console.error("Shader warm-up failed", error);
        dismissWarming();
      });
    },
    onFatal: showFatal,
  });
  // Now the engine exists: upgrade the handler so a device loss also stops its frame loop (so it
  // can't spam the dead device) before surfacing the unrecoverable-reset prompt.
  handleDeviceLost = (info): void => {
    engine.notifyDeviceLost();
    showFatal(
      `The graphics device was lost${info.message ? ` (${info.message})` : ""}. Reload the page to continue.`,
    );
  };

  const { stage, fractal, dive } = engine;
  const resetAccumulation = (): void => engine.resetAccumulation();

  // The state bridge (ADR-0010): translates the flat `state` ↔ the nested shape/look halves
  // and drives the engine on every apply/snapshot. The geometry half lives on the engine; the
  // art-direction half is held inside the bridge.
  const bridge = createStateBridge({ engine, state, initialLook: initialPreset.look });

  // The UI controller (ADR-0006): the single seam the Vue layer drives, built over the
  // engine + bridge. Every setter mutates `state` and pushes to the engine/bridge.
  const controller = createController({ engine, bridge, state });

  bridge.applyPreset(initialPreset.id);
  // Push the persisted control sensitivity into the live controls now: the slider that
  // would otherwise drive it lives in an accordion section that may be collapsed at boot.
  engine.setControlSensitivity(state.controlSensitivity);
  // Seed live-preview auto-quality from the persisted choice (default on for touch devices):
  // this picks the initial render scale before the first heavy frames, so a weak device
  // doesn't jank on boot before the runtime loop adapts.
  engine.setAutoQuality(state.autoQuality);
  mountUi(controller);

  // Begin driving frames and listening for window resizes (ADR-0003).
  engine.start();

  // Dev/authoring hook (ADR-0007): lets the settle-shots harness and preset authors drive
  // the camera and controls programmatically. Not part of the Controller seam, and gated to
  // dev builds so it (and the `teardown` handle) is tree-shaken from production instead of
  // exposing controller/camera internals and a GPU teardown on `window`. The Playwright
  // harnesses that consume `window.__kf` run against `pnpm dev`, where this is present.
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__kf = {
      controller,
      camera: () => ({
        target: stage.target.toArray(),
        yaw: stage.yaw,
        pitch: stage.pitch,
        roll: stage.roll,
        distance: stage.distance,
        fov: stage.camera.fov,
      }),
      setCamera: (cam: {
        target?: [number, number, number];
        yaw?: number;
        pitch?: number;
        roll?: number;
        distance?: number;
        fov?: number;
      }) => {
        if (cam.target) stage.target.set(cam.target[0], cam.target[1], cam.target[2]);
        stage.applyPreset({
          target: cam.target ?? (stage.target.toArray() as [number, number, number]),
          yaw: cam.yaw ?? stage.yaw,
          pitch: cam.pitch ?? stage.pitch,
          roll: cam.roll ?? stage.roll,
          distance: cam.distance ?? stage.distance,
          fov: cam.fov ?? stage.camera.fov,
        });
        dive.reset();
        resetAccumulation();
      },
      samples: () => engine.sampleIndex,
      dive: () => ({ offset: dive.offset.toArray(), scale: dive.scale, debug: { ...dive.debug } }),
      // Hybrid formula chains (hybrid-formula-chains design): attach a chain to the current
      // shape for end-to-end render/dive/tunnelling verification on a real GPU (the chain
      // editor is the user-facing path; this is the scripted harness seam).
      chainPresets: {
        BOX_BULB,
        MANDELBOX_AS_CHAIN,
        MANDELBULB_AS_CHAIN,
        MENGER_SPIRE,
        KLEIN_FOAM,
        SIN_BULB,
      },
      // Intentionally unvalidated (no clampChain) and loosely typed: a DEV-only hook fed by the
      // curated presets above / hand-authored test chains, not user input. The UI/codec paths
      // both clamp; this trusts its caller.
      applyChain: (chain: unknown): void => {
        bridge.applyShape({ ...engine.shape, chain: chain as never });
      },
      // Camera-space distance to the surface per the f64 CPU DE; diagnoses buried (≈0)
      // vs empty-space (≫ extent) cameras during dive verification. Growth-adjusted so
      // it stays truthful against the displaced GPU surface.
      deAtCamera: () => {
        const p = fractal.uniforms.formulaP.value;
        const f = stage.camera.position
          .clone()
          .applyMatrix3(dive.basis)
          .multiplyScalar(dive.scale)
          .add(dive.offset);
        const params = {
          p0: p.x,
          p1: p.y,
          p2: p.z,
          p3: p.w,
          iterations: fractal.uniforms.iterations.value,
        };
        const de = getCpuDe(engine.shape.formula);
        // Warp-adjusted (like the dive's own probes) so it stays truthful under warp.
        const raw = dive.warp
          ? warpCpuDe((x, y, z) => de(x, y, z, params), dive.warp, f.x, f.y, f.z)
          : de(f.x, f.y, f.z, params);
        return raw / dive.scale - dive.growthMargin;
      },
      // Single teardown path (HMR, embedding, tests): stops the loop, drops the resize listener,
      // and releases the GPU resources the engine owns.
      teardown: (): void => engine.teardown(),
    };
  }
}

registerServiceWorker();
void main();

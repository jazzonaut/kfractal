import { CONTROL_SENSITIVITY_KEY } from "../config/constants";
import { downloadTextFile } from "../core/download";
import {
  buildLibraryFile,
  makeUserItemId,
  parseLibraryFile,
  slugify,
  uniquifyName,
} from "../fractal/library-codec";
import { LOOKS, defaultNewLight } from "../fractal/looks";
import { PRESETS } from "../fractal/presets";
import { getFormula } from "../fractal/registry";
import { mutateFormulaSettings, rollShape } from "../fractal/shape-generator";
import { SHAPES } from "../fractal/shapes";
import { nextPaletteStopId } from "../fractal/state-bridge";
import type { StateBridge } from "../fractal/state-bridge";
import { MAX_LIGHTS, MAX_PALETTE_STOPS, sortStopsByPosition } from "../fractal/types";
import type {
  AuthoringStamps,
  FractalPreset,
  FractalShape,
  LibraryKind,
  Look,
  RampColorSpace,
  RampInterpolation,
} from "../fractal/types";
import { saveUserLibrary } from "../fractal/user-library";
import type { RenderEngine } from "../render/engine";
import type { Controller, LibraryActionResult, WorkstationState } from "./controller";

/**
 * Build the UI controller (ADR-0006): the single seam the Vue layer drives. Every setter
 * mutates the flat `state`, pushes the change to the engine/bridge, and chooses whether to
 * restart the render (`resetAccumulation`) or merely re-present (`engine.markPresent`). The
 * library/authoring methods sit on top of the generic `KIND_OPS` surface.
 */
/** Midpoint of two `#rrggbb` colours in sRGB byte space — the starting tint for a new stop. */
function midpointHex(a: string, b: string): string {
  const pa = parseInt(a.replace(/^#/, ""), 16);
  const pb = parseInt(b.replace(/^#/, ""), 16);
  const mid = (shift: number) => {
    const ca = (pa >> shift) & 0xff;
    const cb = (pb >> shift) & 0xff;
    return Math.round((ca + cb) / 2);
  };
  const hex = ((mid(16) << 16) | (mid(8) << 8) | mid(0)).toString(16).padStart(6, "0");
  return `#${hex}`;
}

export function createController(deps: {
  engine: RenderEngine;
  bridge: StateBridge;
  state: WorkstationState;
}): Controller {
  const { engine, bridge, state } = deps;
  const { stage, fractal, dive, post } = engine;
  const resetAccumulation = (): void => engine.resetAccumulation();

  // Re-bake the palette LUT from the live stop list + modes, then restart the render.
  const applyRamp = (): void => {
    fractal.setPaletteRamp({
      stops: state.paletteStops,
      interpolation: state.paletteInterpolation,
      colorSpace: state.paletteColorSpace,
    });
    resetAccumulation();
  };

  // One generic authoring surface over the three library kinds (ADR-0010).
  type LibraryItem = FractalShape | Look | FractalPreset;
  type UserItem = LibraryItem & AuthoringStamps;
  interface KindOps {
    readonly label: string;
    readonly curated: readonly LibraryItem[];
    readonly list: () => UserItem[];
    readonly snapshot: (id: string, name: string, description: string) => LibraryItem;
    readonly select: (id: string) => void;
    readonly selectedId: () => string;
    readonly apply: (id: string) => void;
  }
  const KIND_OPS: Record<LibraryKind, KindOps> = {
    shape: {
      label: "Shape",
      curated: SHAPES,
      list: () => state.userShapes,
      snapshot: bridge.snapshotShape,
      select: (id) => {
        state.selectedShapeId = id;
      },
      selectedId: () => state.selectedShapeId,
      apply: (id) => bridge.applyShapeById(id),
    },
    look: {
      label: "Look",
      curated: LOOKS,
      list: () => state.userLooks,
      snapshot: bridge.snapshotLook,
      select: (id) => {
        state.selectedLookId = id;
      },
      selectedId: () => state.selectedLookId,
      apply: (id) => bridge.applyLookById(id),
    },
    preset: {
      label: "Preset",
      curated: PRESETS,
      list: () => state.userPresets,
      snapshot: bridge.snapshotPreset,
      select: (id) => {
        state.selectedPresetId = id;
      },
      selectedId: () => state.selectedPresetId,
      apply: (id) => bridge.applyPreset(id),
    },
  };

  const takenNames = (kind: LibraryKind): Set<string> =>
    new Set([...KIND_OPS[kind].curated, ...KIND_OPS[kind].list()].map((item) => item.name));
  const takenIds = (kind: LibraryKind): Set<string> =>
    new Set([...KIND_OPS[kind].curated, ...KIND_OPS[kind].list()].map((item) => item.id));

  // The single push seam for every light edit: re-sync the uniforms and restart.
  const pushLights = (): void => {
    fractal.applyLights(state.lights, state.ambient);
    resetAccumulation();
  };

  // On failure the in-memory library is left intact, so the item stays usable
  // (and exportable) for the rest of the session.
  const persistLibrary = (): LibraryActionResult =>
    saveUserLibrary({
      shapes: state.userShapes,
      looks: state.userLooks,
      presets: state.userPresets,
    })
      ? { ok: true }
      : { ok: false, error: "Could not save to browser storage." };

  const controller: Controller = {
    state,
    startRender: () => {
      engine.startRender();
    },
    stopRender: () => {
      resetAccumulation();
    },
    setSampleCap: (value: number) => {
      // No accumulation reset: raising the cap resumes a converged render, lowering it
      // simply moves the finish line.
      state.sampleCap = value;
      engine.markPresent();
    },
    setDenoise: (value: boolean) => {
      // Post-side only: no accumulation reset, the next presented frame re-filters.
      state.denoise = value;
      engine.markPresent();
    },
    setDiveEnabled: (value: boolean) => {
      // Toggles the deep-zoom dive on/off (off = manual push-through fly). Takes effect on
      // the next wheel gesture; the current image is untouched.
      state.diveEnabled = value;
      dive.enabled = value;
    },
    setControlSensitivity: (value: number) => {
      // A pure input-feel pref: scale the gestures and remember the choice. The rendered
      // image doesn't change, so there's no accumulation reset or re-present.
      state.controlSensitivity = value;
      engine.setControlSensitivity(value);
      try {
        localStorage.setItem(CONTROL_SENSITIVITY_KEY, String(value));
      } catch {
        // Private-mode / quota failures are non-fatal: the live value still applies this
        // session, it just won't survive a reload.
      }
    },
    setViewportRightInset: (px: number) => {
      engine.setRightInset(px);
    },
    setViewportBottomInset: (px: number) => {
      engine.setBottomInset(px);
    },
    setPreset: bridge.applyPreset,
    setShape: bridge.applyShapeById,
    setLook: bridge.applyLookById,
    setFormulaParam: (key: string, value: number) => {
      const def = getFormula(engine.shape.formula);
      const param = def.params.find((item) => item.key === key);
      if (!param) return;
      // Clamp at the seam: UI widgets enforce ranges, but the __kf hook and any future
      // programmatic caller would otherwise push out-of-range values straight to the GPU
      // slot. The codec already clamps on import; live setters should match.
      const clamped = Math.min(param.max, Math.max(param.min, value));
      const live = state.formulaParams.find((item) => item.key === key);
      if (live) live.value = clamped;
      fractal.setFormulaSlot(param.slot, clamped);
      resetAccumulation();
    },
    setIterations: (value: number) => {
      const { iterations } = getFormula(engine.shape.formula);
      const clamped = Math.round(Math.min(iterations.max, Math.max(iterations.min, value)));
      state.iterations = clamped;
      fractal.uniforms.iterations.value = clamped;
      resetAccumulation();
    },
    setMaterialParam: (key, value) => {
      state[key] = value;
      const matP = fractal.uniforms.matP.value;
      if (key === "roughness") matP.x = value;
      else if (key === "specular") matP.y = value;
      else if (key === "translucency") matP.z = value;
      else if (key === "ior") matP.w = value;
      else fractal.uniforms.emissionP.value.w = value;
      resetAccumulation();
    },
    setLightParam: (index, key, value) => {
      const light = state.lights[index];
      if (!light) return;
      if (key === "intensity") light.intensity = value;
      else if (key === "size") light.size = value;
      else light.falloff = value;
      pushLights();
    },
    setLightColor: (index, hex) => {
      const light = state.lights[index];
      if (!light) return;
      light.color = hex;
      pushLights();
    },
    setLightType: (index, type) => {
      const light = state.lights[index];
      if (!light) return;
      light.type = type;
      pushLights();
    },
    setLightEnabled: (index, enabled) => {
      const light = state.lights[index];
      if (!light) return;
      light.enabled = enabled;
      pushLights();
    },
    setLightDirection: (index, dir) => {
      const light = state.lights[index];
      if (!light) return;
      light.direction = [dir[0], dir[1], dir[2]];
      pushLights();
    },
    setLightPosition: (index, pos) => {
      const light = state.lights[index];
      if (!light) return;
      light.position = [pos[0], pos[1], pos[2]];
      pushLights();
    },
    placeLightAtCamera: (index) => {
      const light = state.lights[index];
      if (!light) return;
      light.position = stage.camera.position.toArray() as [number, number, number];
      light.type = "positional";
      pushLights();
    },
    addLight: () => {
      if (state.lights.length >= MAX_LIGHTS) return null;
      state.lights.push(defaultNewLight());
      pushLights();
      return state.lights.length - 1;
    },
    removeLight: (index) => {
      if (state.lights.length <= 1 || !state.lights[index]) return;
      state.lights.splice(index, 1);
      pushLights();
    },
    setAmbient: (value) => {
      state.ambient = value;
      pushLights();
    },
    setSkyMode: (mode) => {
      state.skyMode = mode;
      fractal.applySky(bridge.liveSky());
      if (mode === "envmap") bridge.ensureEnvironment(state.envId);
      resetAccumulation();
    },
    setSkyParam: (key, value) => {
      if (key === "intensity") state.envIntensity = value;
      else if (key === "sunElevation") state.sunElevation = value;
      else if (key === "sunAzimuth") state.sunAzimuth = value;
      else if (key === "turbidity") state.turbidity = value;
      else if (key === "sunSize") state.sunSize = value;
      else state.envYaw = value;
      fractal.applySky(bridge.liveSky());
      resetAccumulation();
    },
    setEnvMap: (id: string) => {
      state.envId = id;
      fractal.applySky(bridge.liveSky());
      bridge.ensureEnvironment(id);
      resetAccumulation();
    },
    setAperture: (value: number) => {
      state.aperture = value;
      fractal.uniforms.lens.value.x = value;
      resetAccumulation();
    },
    setFocusDistance: (value: number) => {
      state.focusDistance = value;
      fractal.uniforms.lens.value.y = value;
      resetAccumulation();
    },
    // Post-side setters: no accumulation reset (like setDenoise) - the post chain
    // re-grades on the next presented frame (presentDirty), so a render in progress
    // survives the tweak.
    setExposure: (value: number) => {
      state.exposure = value;
      post.exposure.value = value;
      engine.markPresent();
    },
    setContrast: (value: number) => {
      state.contrast = value;
      post.contrast.value = value;
      engine.markPresent();
    },
    setBloomStrength: (value: number) => {
      state.bloomStrength = value;
      post.bloom.strength.value = value;
      engine.markPresent();
    },
    setChromaticAberration: (value: number) => {
      state.chromaticAberration = value;
      post.caAmount.value = value;
      engine.markPresent();
    },
    setBloomRadius: (value: number) => {
      state.bloomRadius = value;
      post.bloom.radius.value = value;
      engine.markPresent();
    },
    setBloomThreshold: (value: number) => {
      state.bloomThreshold = value;
      post.bloom.threshold.value = value;
      engine.markPresent();
    },
    setSaturation: (value: number) => {
      state.saturation = value;
      post.saturation.value = value;
      engine.markPresent();
    },
    setFogParam: (key, value) => {
      if (key === "density") state.fogDensity = value;
      else if (key === "height") state.fogHeight = value;
      else state.fogAnisotropy = value;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setFogColor: (hex: string) => {
      state.fogColor = hex;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setGlowParam: (key, value) => {
      if (key === "strength") state.glowStrength = value;
      else state.glowRadius = value;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setGlowColor: (hex: string) => {
      state.glowColor = hex;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setGlowPaletteLink: (value: boolean) => {
      state.glowUsePalette = value;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setSurfaceFxParam: (key, value) => {
      if (key === "iridescence") state.iridescence = value;
      else if (key === "filmShift") state.filmShift = value;
      else if (key === "rimStrength") state.rimStrength = value;
      else if (key === "microScale") state.microNoiseScale = value;
      else state.microNoiseRoughness = value;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setGrowthParam: (key, value) => {
      if (key === "length") {
        state.growthLength = value;
        // Keep the dive's surface-pin march conservative against the displaced GPU surface.
        dive.growthMargin = value;
      } else if (key === "density") state.growthDensity = value;
      else if (key === "sharpness") state.growthSharpness = value;
      else if (key === "coverage") state.growthCoverage = value;
      else if (key === "trapBias") state.growthTrapBias = value;
      else if (key === "colorBlend") state.growthColorBlend = value;
      else state.growthEmission = value;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setGrowthMode: (mode) => {
      state.growthMode = mode;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setGrowthColor: (hex: string) => {
      state.growthColor = hex;
      fractal.applyEffects(bridge.liveEffects());
      resetAccumulation();
    },
    setPostFxParam: (key, value) => {
      // Post-side only: no accumulation reset, the next presented frame re-grades.
      if (key === "vignetteStrength") {
        state.vignetteStrength = value;
        post.vignetteStrength.value = value;
      } else if (key === "vignetteSoftness") {
        state.vignetteSoftness = value;
        post.vignetteSoftness.value = value;
      } else if (key === "grainStrength") {
        state.grainStrength = value;
        post.grainStrength.value = value;
      } else {
        state.lensDistortion = value;
        post.distortion.value = value;
      }
      engine.markPresent();
    },
    setEmissionColor: (hex: string) => {
      state.emissionColor = hex;
      fractal.setEmissionColor(hex);
      resetAccumulation();
    },
    setPaletteStopColor: (id, hex) => {
      state.paletteStops = state.paletteStops.map((s) => (s.id === id ? { ...s, color: hex } : s));
      applyRamp();
    },
    setPaletteStopPosition: (id, position) => {
      const p = Math.min(1, Math.max(0, position));
      state.paletteStops = state.paletteStops.map((s) => (s.id === id ? { ...s, position: p } : s));
      applyRamp();
    },
    addPaletteStop: () => {
      if (state.paletteStops.length >= MAX_PALETTE_STOPS) return;
      const sorted = sortStopsByPosition(state.paletteStops);
      // Drop the new stop into the widest gap so repeated adds spread out evenly.
      let lo = sorted[0]!;
      let hi = sorted[sorted.length - 1]!;
      let widest = -1;
      for (let i = 0; i < sorted.length - 1; i += 1) {
        const gap = sorted[i + 1]!.position - sorted[i]!.position;
        if (gap > widest) {
          widest = gap;
          lo = sorted[i]!;
          hi = sorted[i + 1]!;
        }
      }
      const position = (lo.position + hi.position) / 2;
      state.paletteStops = [
        ...state.paletteStops,
        { id: nextPaletteStopId(), position, color: midpointHex(lo.color, hi.color) },
      ];
      applyRamp();
    },
    removePaletteStop: (id) => {
      if (state.paletteStops.length <= 2) return;
      state.paletteStops = state.paletteStops.filter((s) => s.id !== id);
      applyRamp();
    },
    setPaletteInterpolation: (mode: RampInterpolation) => {
      state.paletteInterpolation = mode;
      applyRamp();
    },
    setPaletteColorSpace: (mode: RampColorSpace) => {
      state.paletteColorSpace = mode;
      applyRamp();
    },
    setTrapScale: (value: number) => {
      state.trapScale = value;
      fractal.setTrapScale(value);
      resetAccumulation();
    },
    setTrapPower: (value: number) => {
      state.trapPower = value;
      fractal.setTrapPower(value);
      resetAccumulation();
    },
    setWarpParam: (key, value) => {
      if (key === "twist") state.warpTwist = value;
      else if (key === "bend") state.warpBend = value;
      else if (key === "rippleAmp") state.warpRippleAmp = value;
      else if (key === "rippleFreq") state.warpRippleFreq = value;
      else if (key === "noiseAmp") state.warpNoiseAmp = value;
      else state.warpNoiseFreq = value;
      const warp = bridge.liveWarp();
      fractal.applyWarp(warp);
      bridge.syncDiveWarp(warp);
      resetAccumulation();
    },
    setWarpAxis: (key, axis) => {
      if (key === "twistAxis") state.warpTwistAxis = axis;
      else if (key === "bendAxis") state.warpBendAxis = axis;
      else state.warpRippleAxis = axis;
      const warp = bridge.liveWarp();
      fractal.applyWarp(warp);
      bridge.syncDiveWarp(warp);
      resetAccumulation();
    },
    setCameraFov: (value: number) => {
      state.cameraFov = value;
      stage.setFov(value);
      resetAccumulation();
    },
    resetCamera: () => {
      const shape = engine.shape;
      stage.applyPreset(shape.camera);
      // Reset means "back to this shape's framing", which includes its dive frame.
      dive.restore(shape.dive);
      state.cameraFov = shape.camera.fov;
      resetAccumulation();
    },
    cancelExport: () => {
      engine.cancelExport();
    },
    exportImage: (options, onProgress) => engine.exportImage(options, onProgress),
    saveUserItem: (kind: LibraryKind, name: string, description: string) => {
      const ops = KIND_OPS[kind];
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: `${ops.label} name is required.` };
      const uniqueName = uniquifyName(trimmed, takenNames(kind));
      const id = makeUserItemId(uniqueName, takenIds(kind));
      const now = new Date().toISOString();
      ops.list().push({
        ...ops.snapshot(id, uniqueName, description.trim()),
        createdAt: now,
        updatedAt: now,
      });
      // Select without applying: the image already equals the snapshot, so an
      // in-progress render must survive the save.
      ops.select(id);
      return persistLibrary();
    },
    updateUserItem: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      const list = ops.list();
      const index = list.findIndex((item) => item.id === id);
      const existing = list[index];
      if (!existing) return { ok: false, error: `Not a saved ${kind}.` };
      list[index] = {
        ...ops.snapshot(existing.id, existing.name, existing.description),
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
      };
      return persistLibrary();
    },
    renameUserItem: (kind: LibraryKind, id: string, name: string, description: string) => {
      const ops = KIND_OPS[kind];
      const list = ops.list();
      const index = list.findIndex((item) => item.id === id);
      const existing = list[index];
      if (!existing) return { ok: false, error: `Not a saved ${kind}.` };
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: `${ops.label} name is required.` };
      const otherNames = new Set(
        [...ops.curated, ...list.filter((item) => item.id !== id)].map((item) => item.name),
      );
      list[index] = {
        ...existing,
        name: uniquifyName(trimmed, otherNames),
        description: description.trim(),
        updatedAt: new Date().toISOString(),
      };
      return persistLibrary();
    },
    duplicateUserItem: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      // Curated items clone too (ADR-0011); the push below stamps the copy fresh dates.
      const existing =
        ops.list().find((item) => item.id === id) ?? ops.curated.find((item) => item.id === id);
      if (!existing) return { ok: false, error: `No such ${kind}.` };
      const copy = JSON.parse(JSON.stringify(existing)) as LibraryItem & Partial<AuthoringStamps>;
      const uniqueName = uniquifyName(copy.name, takenNames(kind));
      const now = new Date().toISOString();
      ops.list().push({
        ...copy,
        id: makeUserItemId(uniqueName, takenIds(kind)),
        name: uniqueName,
        createdAt: now,
        updatedAt: now,
      });
      return persistLibrary();
    },
    deleteUserItem: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      const list = ops.list();
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return { ok: false, error: `Not a saved ${kind}.` };
      list.splice(index, 1);
      // The pixels on screen are still valid (the engine's active shape and the bridge's
      // active look keep working), so only the selection clears - no accumulation reset.
      if (ops.selectedId() === id) ops.select("");
      return persistLibrary();
    },
    generateShape: (options) => {
      const next = rollShape({
        formula: options.formula,
        current: bridge.snapshotShape("", "", ""),
        locks: { params: new Set(options.lockedParams), iterations: options.lockIterations },
      });
      bridge.applyShape(next);
      // Generated state is unsaved ("Custom"): a held selection would let Update
      // silently overwrite the stored item with the rolled values.
      state.selectedShapeId = "";
      state.selectedPresetId = "";
      resetAccumulation();
    },
    mutateShape: (strength, options) => {
      // The snapshot carries the live pose + dive frame, so re-applying never moves
      // the camera - only the formula settings change.
      const live = bridge.snapshotShape("", "Mutated", "");
      const formulaSettings = mutateFormulaSettings(live.formula, live.formulaSettings, strength, {
        params: new Set(options.lockedParams),
        iterations: options.lockIterations,
      });
      bridge.applyShape({ ...live, formulaSettings });
      state.selectedShapeId = "";
      state.selectedPresetId = "";
      resetAccumulation();
    },
    exportLibraryJson: (kind: LibraryKind) => {
      // Always the live state, including unsaved tweaks; named after the selection if any.
      const ops = KIND_OPS[kind];
      const selected = [...ops.curated, ...ops.list()].find((item) => item.id === ops.selectedId());
      const name = selected?.name ?? "Untitled";
      const slug = slugify(name);
      const json = buildLibraryFile(
        kind,
        ops.snapshot(`user-${slug}`, name, selected?.description ?? ""),
      );
      downloadTextFile(`kfractal-${kind}-${slug}.json`, json);
    },
    exportLibraryItemJson: (kind: LibraryKind, id: string) => {
      const ops = KIND_OPS[kind];
      const found = [...ops.curated, ...ops.list()].find((item) => item.id === id);
      if (!found) return { ok: false, error: `No such ${kind}.` };
      // Strip the authoring stamps so the file matches the live-state exports exactly.
      const {
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ...item
      } = found as LibraryItem & Partial<AuthoringStamps>;
      downloadTextFile(
        `kfractal-${kind}-${slugify(item.name)}.json`,
        buildLibraryFile(kind, item as LibraryItem),
      );
      return { ok: true };
    },
    importLibraryJson: async (file: File) => {
      const parsed = parseLibraryFile(await file.text());
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const ops = KIND_OPS[parsed.kind];
      const uniqueName = uniquifyName(parsed.item.name, takenNames(parsed.kind));
      const id = makeUserItemId(uniqueName, takenIds(parsed.kind));
      const now = new Date().toISOString();
      const list = ops.list();
      list.push({
        ...parsed.item,
        id,
        name: uniqueName,
        createdAt: now,
        updatedAt: now,
      });
      const result = persistLibrary();
      if (!result.ok) {
        // Persisting failed (e.g. storage quota). Roll the in-memory add back so the import
        // is all-or-nothing: don't switch the canvas to a half-saved item, and don't leave
        // it in the list to pile up as "name (2)/(3)" duplicates on the user's retry.
        const index = list.findIndex((item) => item.id === id);
        if (index >= 0) list.splice(index, 1);
        return result;
      }
      ops.apply(id);
      return { ...result, name: uniqueName };
    },
  };

  return controller;
}

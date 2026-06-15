import * as THREE from "three/webgpu";
import { sampler, texture, uv, uniform, wgslFn } from "three/tsl";
import { buildRenderSampleWGSL } from "./shaders/pathtrace";
import {
  ENV_H,
  ENV_W,
  GRID_H,
  GRID_W,
  makeEnvRadianceTexture,
  preethamSunColor,
} from "./environment";
import { FOG_DEFAULTS } from "../fractal/effects-defaults";
import { FORMULAS, getFormula } from "../fractal/registry";
import { MAX_LIGHTS, MAX_PALETTE_STOPS, sortStopsByPosition } from "../fractal/types";
import { defaultWarp, packWarpAxes, warpConstLipschitz } from "../fractal/warp";
import type { EnvironmentData } from "./environment";
import type {
  EffectsSettings,
  FractalFormulaId,
  FractalShape,
  LightSource,
  Look,
  PaletteSettings,
  SkySettings,
  WarpSettings,
} from "../fractal/types";

const DEG = Math.PI / 180;

/** The palette fields the ramp packing needs; `applyLook` passes the full PaletteSettings. */
type RampSpec = Pick<PaletteSettings, "stops" | "interpolation" | "colorSpace">;

const RAMP_INTERP_INDEX = { linear: 0, smooth: 1, stepped: 2 } as const;
const RAMP_SPACE_INDEX = { rgb: 0, oklab: 1 } as const;

const SKY_MODE_INDEX = { studio: 0, preetham: 1, envmap: 2 } as const;

const GROWTH_MODE_INDEX = { spikes: 0, bumps: 1, crystals: 2, fins: 3 } as const;

/* TSL/WGSL node inputs are dynamically typed; `any` is scoped to this GPU seam. */

export const MODE_PREVIEW = 0;
export const MODE_PATHTRACE = 1;
/** Denoiser feature passes: primary-hit (normal, depth) and (albedo, coverage). */
export const MODE_FEATURE_ND = 2;
export const MODE_FEATURE_ALBEDO = 3;

function linearColor(hex: string): THREE.Vector3 {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  return new THREE.Vector3(c.r, c.g, c.b);
}

function linearColor4(hex: string, w: number): THREE.Vector4 {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  return new THREE.Vector4(c.r, c.g, c.b, w);
}

export interface SampleUniforms {
  readonly resolution: any;
  readonly camPos: any;
  readonly camRight: any;
  readonly camUp: any;
  readonly camFwd: any;
  readonly tanHalfFov: any;
  readonly mode: any;
  readonly frame: any;
  /** Generic formula slots gP0..gP3, mapped through the registry schema. */
  readonly formulaP: any;
  readonly iterations: any;
  /** maxSteps, maxDistance, surfaceEpsilon, normalEpsilon. */
  readonly renderP: any;
  /** Per light i: xyz = direction toward light (directional) or position (positional); w = type. */
  readonly lightPosDir0: any;
  readonly lightPosDir1: any;
  readonly lightPosDir2: any;
  readonly lightPosDir3: any;
  /** Per light i: rgb = linear color; w = effective intensity (0 when disabled). */
  readonly lightColInt0: any;
  readonly lightColInt1: any;
  readonly lightColInt2: any;
  readonly lightColInt3: any;
  /** Per light i: x = size (cone half-angle | sphere radius), y = falloff distance. */
  readonly lightGeo0: any;
  readonly lightGeo1: any;
  readonly lightGeo2: any;
  readonly lightGeo3: any;
  /** x = light count, y = ambient. */
  readonly lightMeta: any;
  /** aperture, focusDistance. */
  readonly lens: any;
  /** roughness, specular, translucency, ior. */
  readonly matP: any;
  /** emission rgb (linear), strength. */
  readonly emissionP: any;
  /** trap scale, trap power. */
  readonly trapMap: any;
  /** Palette ramp stops as (linear rgb, position), sorted; padded with the last stop. */
  readonly paletteStop0: any;
  readonly paletteStop1: any;
  readonly paletteStop2: any;
  readonly paletteStop3: any;
  readonly paletteStop4: any;
  readonly paletteStop5: any;
  readonly paletteStop6: any;
  readonly paletteStop7: any;
  /** stop count, interpolation index (0 linear/1 smooth/2 stepped), colour-space index (0 rgb/1 oklab). */
  readonly paletteMeta: any;
  /** Environment (ADR-0009): sky mode, intensity, yaw (radians), turbidity. */
  readonly envP: any;
  /** Preetham sun direction xyz, cone half-angle in w. */
  readonly envSun: any;
  readonly sunColor: any;
  readonly envDomDir: any;
  readonly envDomColor: any;
  readonly envAvgColor: any;
  /** Dive transform (infinite zoom): offset.xyz, scale in w. */
  readonly diveP: any;
  /** Dive rotation matrix rows. */
  readonly diveRX: any;
  readonly diveRY: any;
  readonly diveRZ: any;
  /** Fog: density, height falloff, height base, HG anisotropy. Zero density = off. */
  readonly fogP: any;
  /** Fog tint rgb (linear), in-scatter gain in w. */
  readonly fogC: any;
  /** Pocket fog centre, resolved to the march frame each frame from the camera-frame
   * offset; radius in w. */
  readonly fogPocketC: any;
  /** Pocket fog: mode (0 layer / 1 pocket) in x, edge softness in y. */
  readonly fogPocketP: any;
  /** Glow: strength, proximity radius, palette-tint flag (0/1), falloff exponent. */
  readonly glowP: any;
  readonly glowColor: any;
  /** Surface fx: iridescence, film thickness 0..1, rim strength, micro-noise frequency. */
  readonly fxA: any;
  /** Surface fx: micro-noise roughness amount, micro-noise albedo amount, spares. */
  readonly fxB: any;
  /** Growth: protrusion length (0 = off), density, sharpness, coverage. */
  readonly growthP: any;
  /** Growth: mode index, color blend, emission, Lipschitz step scale. */
  readonly growthQ: any;
  /** Growth color rgb (linear), orbit-trap placement bias in w. */
  readonly growthC: any;
  /** Warp (ADR-0012): twist rad/unit, bend rad/unit, ripple amplitude, ripple frequency. */
  readonly warpP: any;
  /** Warp: noise amplitude, noise frequency, constant Lipschitz part, packed axes. */
  readonly warpQ: any;
}

/**
 * Renders ONE linear-HDR sample of the fractal to a target. Each formula compiles into its
 * own cached node material (ADR-0004) sharing one uniform set; switching formula swaps the
 * material on the fullscreen quad, so the compile cost is paid once per formula.
 */
export class FractalPass {
  readonly uniforms: SampleUniforms;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // Two pipelines per formula: a cheap preview-only material (the analytic single-march shown
  // while interacting - small enough to compile in ~1s and to persist in the browser's shader
  // cache across reloads) and the full path-trace/feature material (modes 1-3, the expensive
  // ~6-9s compile that never fit the cache). The mesh carries whichever the current mode needs,
  // so boot and live preview only ever touch the cheap one.
  private readonly previewMaterials = new Map<FractalFormulaId, THREE.MeshBasicNodeMaterial>();
  private readonly renderMaterials = new Map<FractalFormulaId, THREE.MeshBasicNodeMaterial>();
  private activeFormula: FractalFormulaId;
  // Serializes every compileAsync (warm + on-demand). three's compileAsync saves/restores shared
  // renderer state and is NOT re-entrant, so two overlapping calls - e.g. a Render click landing
  // mid-warm - would corrupt each other's state. All compiles chain through here so the entry
  // point can't matter; see compilePipeline.
  private compileChain: Promise<unknown> = Promise.resolve();
  private readonly mesh: THREE.Mesh;
  /*
   * One persistent environment atlas shared by every formula pipeline. Environments are
   * applied by updating the texel data in place (`.value` swaps do not reliably rebind
   * for textureLoad/textureDimensions access, and in-place keeps one binding layout).
   * The top region is radiance; the bottom-left region is the alias/pdf table. Keeping
   * both in one half-float atlas avoids three r184's stale separate texture path.
   */
  private readonly envRadianceTexture = makeEnvRadianceTexture();
  private readonly envTexNode: any;
  private sky: SkySettings | null = null;
  private envData: EnvironmentData | null = null;

  constructor(initialFormula: FractalFormulaId) {
    this.envTexNode = texture(this.envRadianceTexture);
    this.uniforms = {
      resolution: uniform(new THREE.Vector2(window.innerWidth, window.innerHeight)),
      camPos: uniform(new THREE.Vector3()),
      camRight: uniform(new THREE.Vector3(1, 0, 0)),
      camUp: uniform(new THREE.Vector3(0, 1, 0)),
      camFwd: uniform(new THREE.Vector3(0, 0, -1)),
      tanHalfFov: uniform(Math.tan((45 * Math.PI) / 180 / 2)),
      mode: uniform(MODE_PREVIEW),
      frame: uniform(0),
      formulaP: uniform(new THREE.Vector4(2.8, 1.0, 0.5, 0)),
      iterations: uniform(14),
      renderP: uniform(new THREE.Vector4(128, 30, 0.0004, 0.0008)),
      // Light 0 reproduces the pre-multi-light studio key; the other slots sit dark.
      lightPosDir0: uniform(new THREE.Vector4(0.48, 0.72, 0.42, 0).normalize()),
      lightPosDir1: uniform(new THREE.Vector4(0, 1, 0, 0)),
      lightPosDir2: uniform(new THREE.Vector4(0, 1, 0, 0)),
      lightPosDir3: uniform(new THREE.Vector4(0, 1, 0, 0)),
      lightColInt0: uniform(new THREE.Vector4(1, 0.98, 0.95, 1.5)),
      lightColInt1: uniform(new THREE.Vector4(1, 1, 1, 0)),
      lightColInt2: uniform(new THREE.Vector4(1, 1, 1, 0)),
      lightColInt3: uniform(new THREE.Vector4(1, 1, 1, 0)),
      lightGeo0: uniform(new THREE.Vector4(0.18, 1.5, 0, 0)),
      lightGeo1: uniform(new THREE.Vector4(0.18, 1.5, 0, 0)),
      lightGeo2: uniform(new THREE.Vector4(0.18, 1.5, 0, 0)),
      lightGeo3: uniform(new THREE.Vector4(0.18, 1.5, 0, 0)),
      lightMeta: uniform(new THREE.Vector4(1, 0.003, 0, 0)),
      lens: uniform(new THREE.Vector2(0, 5)),
      matP: uniform(new THREE.Vector4(0.55, 0.5, 0, 1.45)),
      emissionP: uniform(new THREE.Vector4(0, 0, 0, 0)),
      trapMap: uniform(new THREE.Vector2(1, 0.35)),
      // Default 3-stop ramp (matches the pre-multi-stop colA/colB/colC); applyLook overwrites it.
      paletteStop0: uniform(linearColor4("#151068", 0)),
      paletteStop1: uniform(linearColor4("#21d9ff", 0.5)),
      paletteStop2: uniform(linearColor4("#ff47f3", 1)),
      paletteStop3: uniform(linearColor4("#ff47f3", 1)),
      paletteStop4: uniform(linearColor4("#ff47f3", 1)),
      paletteStop5: uniform(linearColor4("#ff47f3", 1)),
      paletteStop6: uniform(linearColor4("#ff47f3", 1)),
      paletteStop7: uniform(linearColor4("#ff47f3", 1)),
      paletteMeta: uniform(new THREE.Vector4(3, 0, 0, 0)),
      envP: uniform(new THREE.Vector4(0, 1, 0, 3)),
      envSun: uniform(new THREE.Vector4(0, 1, 0, 0.05)),
      sunColor: uniform(new THREE.Vector3(1, 1, 1)),
      envDomDir: uniform(new THREE.Vector3(0, 1, 0)),
      envDomColor: uniform(new THREE.Vector3()),
      envAvgColor: uniform(new THREE.Vector3()),
      diveP: uniform(new THREE.Vector4(0, 0, 0, 1)),
      diveRX: uniform(new THREE.Vector3(1, 0, 0)),
      diveRY: uniform(new THREE.Vector3(0, 1, 0)),
      diveRZ: uniform(new THREE.Vector3(0, 0, 1)),
      // Effects all default off (zero strengths) so the image matches the pre-effects look.
      fogP: uniform(new THREE.Vector4(0, 1.5, 0, 0.4)),
      fogC: uniform(new THREE.Vector4(0.39, 0.55, 0.74, 1)),
      fogPocketC: uniform(
        new THREE.Vector4(
          FOG_DEFAULTS.pocketX,
          FOG_DEFAULTS.pocketY,
          FOG_DEFAULTS.pocketZ,
          FOG_DEFAULTS.pocketRadius,
        ),
      ),
      fogPocketP: uniform(new THREE.Vector4(0, FOG_DEFAULTS.pocketEdge, 0, 0)),
      glowP: uniform(new THREE.Vector4(0, 0.25, 1, 2)),
      glowColor: uniform(linearColor("#ffd9a0")),
      fxA: uniform(new THREE.Vector4(0, 0.3, 0, 12)),
      fxB: uniform(new THREE.Vector4(0, 0, 0, 0)),
      growthP: uniform(new THREE.Vector4(0, 80, 3, 1)),
      growthQ: uniform(new THREE.Vector4(0, 0.85, 0, 1)),
      growthC: uniform(linearColor4("#7be38a", 0)),
      // Warp defaults to identity (zero amounts); axes pack y/x/y (defaultWarp()).
      warpP: uniform(new THREE.Vector4(0, 0, 0, 4)),
      warpQ: uniform(new THREE.Vector4(0, 1.5, 1, packWarpAxes(defaultWarp()))),
    };

    this.activeFormula = initialFormula;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.previewMaterialFor(initialFormula),
    );
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Build a formula's material; `previewOnly` selects the cheap preview-only shader. */
  private buildMaterial(id: FractalFormulaId, previewOnly: boolean): THREE.MeshBasicNodeMaterial {
    const u = this.uniforms;
    const renderSample: any = wgslFn(buildRenderSampleWGSL(getFormula(id).de, previewOnly));
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = renderSample({
      uv: uv(),
      resolution: u.resolution,
      camPos: u.camPos,
      camRight: u.camRight,
      camUp: u.camUp,
      camFwd: u.camFwd,
      tanHalfFov: u.tanHalfFov,
      mode: u.mode,
      frame: u.frame,
      formulaP: u.formulaP,
      iterations: u.iterations,
      renderP: u.renderP,
      lightPosDir0: u.lightPosDir0,
      lightPosDir1: u.lightPosDir1,
      lightPosDir2: u.lightPosDir2,
      lightPosDir3: u.lightPosDir3,
      lightColInt0: u.lightColInt0,
      lightColInt1: u.lightColInt1,
      lightColInt2: u.lightColInt2,
      lightColInt3: u.lightColInt3,
      lightGeo0: u.lightGeo0,
      lightGeo1: u.lightGeo1,
      lightGeo2: u.lightGeo2,
      lightGeo3: u.lightGeo3,
      lightMeta: u.lightMeta,
      lens: u.lens,
      matP: u.matP,
      emissionP: u.emissionP,
      trapMap: u.trapMap,
      paletteStop0: u.paletteStop0,
      paletteStop1: u.paletteStop1,
      paletteStop2: u.paletteStop2,
      paletteStop3: u.paletteStop3,
      paletteStop4: u.paletteStop4,
      paletteStop5: u.paletteStop5,
      paletteStop6: u.paletteStop6,
      paletteStop7: u.paletteStop7,
      paletteMeta: u.paletteMeta,
      envP: u.envP,
      envSun: u.envSun,
      sunColor: u.sunColor,
      envDomDir: u.envDomDir,
      envDomColor: u.envDomColor,
      envAvgColor: u.envAvgColor,
      diveP: u.diveP,
      diveRX: u.diveRX,
      diveRY: u.diveRY,
      diveRZ: u.diveRZ,
      fogP: u.fogP,
      fogC: u.fogC,
      fogPocketC: u.fogPocketC,
      fogPocketP: u.fogPocketP,
      glowP: u.glowP,
      glowColor: u.glowColor,
      fxA: u.fxA,
      fxB: u.fxB,
      growthP: u.growthP,
      growthQ: u.growthQ,
      growthC: u.growthC,
      warpP: u.warpP,
      warpQ: u.warpQ,
      envTex: this.envTexNode,
      envTexSampler: sampler(this.envTexNode),
    });
    material.depthTest = false;
    material.depthWrite = false;
    return material;
  }

  /** The cheap preview-only pipeline (mode 0), built once and cached. */
  private previewMaterialFor(id: FractalFormulaId): THREE.MeshBasicNodeMaterial {
    const cached = this.previewMaterials.get(id);
    if (cached) return cached;
    const material = this.buildMaterial(id, true);
    this.previewMaterials.set(id, material);
    return material;
  }

  /** The full path-trace + feature pipeline (modes 1-3), built once and cached. */
  private renderMaterialFor(id: FractalFormulaId): THREE.MeshBasicNodeMaterial {
    const cached = this.renderMaterials.get(id);
    if (cached) return cached;
    const material = this.buildMaterial(id, false);
    this.renderMaterials.set(id, material);
    return material;
  }

  /** Put the pipeline the active formula + current mode need onto the mesh: the preview-only
   * material for mode 0, the full material for the path-trace/feature passes. */
  private syncMeshMaterial(): void {
    const id = this.activeFormula;
    this.mesh.material =
      this.uniforms.mode.value === MODE_PREVIEW
        ? this.previewMaterialFor(id)
        : this.renderMaterialFor(id);
  }

  setFormula(id: FractalFormulaId): void {
    this.activeFormula = id;
    this.syncMeshMaterial();
  }

  /** Map a shape's geometry side onto the uniforms and swap to its formula's pipeline. */
  applyShape(shape: FractalShape): void {
    const u = this.uniforms;
    const def = getFormula(shape.formula);

    const slots: [number, number, number, number] = [0, 0, 0, 0];
    for (const param of def.params) {
      slots[param.slot] = shape.formulaSettings.values[param.key] ?? param.defaultValue;
    }
    u.formulaP.value.set(slots[0], slots[1], slots[2], slots[3]);
    u.iterations.value = shape.formulaSettings.iterations;

    const r = shape.render;
    u.renderP.value.set(r.maxSteps, r.maxDistance, r.surfaceEpsilon, r.normalEpsilon);

    // lens = (aperture, focusDistance): aperture is look-side, focus shape-side.
    u.lens.value.y = shape.focusDistance;
    u.trapMap.value.set(shape.trap.scale, shape.trap.power);
    this.applyWarp(shape.warp);

    this.setFormula(shape.formula);
  }

  /**
   * Map the shape's domain warp (ADR-0012) onto the warp uniforms; uniforms-only, no
   * recompile. The constant Lipschitz part (ripple*noise) is precomputed here; the
   * per-point twist/bend factors are evaluated in-shader from the warped radii.
   */
  applyWarp(warp: WarpSettings | undefined): void {
    const u = this.uniforms;
    const w = warp ?? defaultWarp();
    u.warpP.value.set(w.twist, w.bend, w.rippleAmp, w.rippleFreq);
    u.warpQ.value.set(w.noiseAmp, w.noiseFreq, warpConstLipschitz(w), packWarpAxes(w));
  }

  /** Map a look's art-direction side onto the uniforms; never touches the pipeline. */
  applyLook(look: Look): void {
    const u = this.uniforms;

    this.applyLights(look.lights, look.ambient);

    u.lens.value.x = look.lens.aperture;

    const m = look.material;
    u.matP.value.set(m.roughness, m.specular, m.translucency, m.ior);
    const e = linearColor(m.emissionColor);
    u.emissionP.value.set(e.x, e.y, e.z, m.emissionStrength);

    this.setPaletteRamp(look.palette);

    this.applySky(look.sky);
    this.applyEffects(look.effects);
  }

  /**
   * Map the lights list + ambient onto the flattened light uniforms. Slots beyond the
   * list (and disabled lights) write zero effective intensity, so the shader's count
   * loop can skip them without branching on a separate flag.
   */
  applyLights(lights: readonly LightSource[], ambient: number): void {
    const u = this.uniforms;
    const slots = [
      { posDir: u.lightPosDir0, colInt: u.lightColInt0, geo: u.lightGeo0 },
      { posDir: u.lightPosDir1, colInt: u.lightColInt1, geo: u.lightGeo1 },
      { posDir: u.lightPosDir2, colInt: u.lightColInt2, geo: u.lightGeo2 },
      { posDir: u.lightPosDir3, colInt: u.lightColInt3, geo: u.lightGeo3 },
    ];
    const count = Math.min(lights.length, MAX_LIGHTS);
    for (let i = 0; i < MAX_LIGHTS; i += 1) {
      const slot = slots[i];
      if (!slot) continue;
      const light = i < count ? lights[i] : null;
      if (!light) {
        slot.colInt.value.w = 0;
        continue;
      }
      if (light.type === "positional") {
        slot.posDir.value.set(light.position[0], light.position[1], light.position[2], 1);
      } else {
        slot.posDir.value.set(light.direction[0], light.direction[1], light.direction[2], 0);
        const len = Math.hypot(slot.posDir.value.x, slot.posDir.value.y, slot.posDir.value.z);
        if (len > 1e-6) slot.posDir.value.multiplyScalar(1 / len).setW(0);
      }
      const c = linearColor(light.color);
      slot.colInt.value.set(c.x, c.y, c.z, light.enabled ? light.intensity : 0);
      slot.geo.value.set(light.size, Math.max(light.falloff, 1e-3), 0, 0);
    }
    u.lightMeta.value.set(count, ambient, 0, 0);
  }

  /**
   * Map the in-shader effects state onto the fx uniforms. Cheap enough to re-run on
   * every slider move; post-side effects (vignette/grain/distortion) live in PostChain.
   */
  applyEffects(fx: EffectsSettings): void {
    const u = this.uniforms;
    u.fogP.value.set(
      fx.fog.density,
      fx.fog.height,
      fx.fog.level ?? FOG_DEFAULTS.level,
      fx.fog.anisotropy,
    );
    const fc = linearColor(fx.fog.color);
    // In-scatter gain below 1: physically a lit haze outshines a dark subject, but
    // this app's look lives on dark negative space - keep the atmosphere translucent.
    u.fogC.value.set(fc.x, fc.y, fc.z, 0.35);
    // Pocket: stash the camera-frame offset + radius, then resolve to a march-frame
    // centre. The resolve also runs every frame in syncCamera so the pocket tracks the
    // camera ("fixed to camera"); doing it here too keeps it correct when only a slider
    // moved and the camera is still.
    this.fogPocketOffset.set(
      fx.fog.pocketX ?? FOG_DEFAULTS.pocketX,
      fx.fog.pocketY ?? FOG_DEFAULTS.pocketY,
      fx.fog.pocketZ ?? FOG_DEFAULTS.pocketZ,
    );
    this.fogPocketRadius = fx.fog.pocketRadius ?? FOG_DEFAULTS.pocketRadius;
    const shape = fx.fog.shape ?? FOG_DEFAULTS.shape;
    u.fogPocketP.value.set(
      shape === "pocket" ? 1 : 0,
      fx.fog.pocketEdge ?? FOG_DEFAULTS.pocketEdge,
      0,
      0,
    );
    this.recomputeFogPocketCenter();
    u.glowP.value.set(fx.glow.strength, fx.glow.radius, fx.glow.usePalette ? 1 : 0, 2);
    u.glowColor.value.copy(linearColor(fx.glow.color));
    const s = fx.surface;
    u.fxA.value.set(s.iridescence, s.filmShift, s.rimStrength, s.microScale);
    // Albedo mottling rides the roughness amount at half strength; one slider, one look.
    u.fxB.value.set(s.microRoughness, s.microRoughness * 0.5, 0, 0);
    const g = fx.growth;
    // Displacement raises the field's Lipschitz constant by ~length * density * slope;
    // the march multiplies in-shell distances by this to compensate (floor caps the
    // slowdown at ~3.3x; the tunneling stress test validates the constants).
    const stepScale = Math.min(
      Math.max(1 / (1 + g.length * g.density * (0.25 + 0.18 * g.sharpness)), 0.3),
      1,
    );
    u.growthP.value.set(g.length, g.density, g.sharpness, g.coverage);
    u.growthQ.value.set(GROWTH_MODE_INDEX[g.mode], g.colorBlend, g.emission, stepScale);
    const gc = linearColor(g.color);
    u.growthC.value.set(gc.x, gc.y, gc.z, g.trapBias);
  }

  /**
   * Map the full sky state onto the env uniforms (ADR-0009). Cheap enough to re-run on
   * every slider move; the environment textures arrive separately via `setEnvironmentData`.
   */
  applySky(sky: SkySettings): void {
    this.sky = { ...sky };
    const u = this.uniforms;
    u.envP.value.set(SKY_MODE_INDEX[sky.mode], sky.intensity, sky.yaw * DEG, sky.turbidity);
    const elevation = sky.sunElevation * DEG;
    const azimuth = sky.sunAzimuth * DEG;
    u.envSun.value.set(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
      sky.sunSize,
    );
    u.sunColor.value.copy(preethamSunColor(sky.sunElevation, sky.turbidity));
    this.refreshDomDir();
  }

  /** Apply a generated environment: radiance + alias texel data and preview statistics. */
  setEnvironmentData(data: EnvironmentData): void {
    this.envData = data;
    const atlas = this.envRadianceTexture.image.data as Uint16Array;
    atlas.set(data.radiance);
    for (let y = 0; y < GRID_H; y += 1) {
      const src = y * GRID_W * 4;
      const dst = (ENV_H + y) * ENV_W * 4;
      atlas.set(data.aliasTable.subarray(src, src + GRID_W * 4), dst);
    }
    this.envRadianceTexture.needsUpdate = true;
    this.uniforms.envDomColor.value.copy(data.domColor);
    this.uniforms.envAvgColor.value.copy(data.avgColor);
    this.refreshDomDir();
  }

  /** The dominant direction is stored map-space; world space follows the live yaw. */
  private refreshDomDir(): void {
    if (!this.envData || !this.sky) return;
    const theta = this.envData.domTheta;
    const phi = this.envData.domPhi + this.sky.yaw * DEG;
    this.uniforms.envDomDir.value.set(
      Math.sin(theta) * Math.cos(phi),
      Math.cos(theta),
      Math.sin(theta) * Math.sin(phi),
    );
  }

  /** Set one generic formula slot (Tier-2 control path). */
  setFormulaSlot(slot: 0 | 1 | 2 | 3, value: number): void {
    const v = this.uniforms.formulaP.value;
    if (slot === 0) v.x = value;
    else if (slot === 1) v.y = value;
    else if (slot === 2) v.z = value;
    else v.w = value;
  }

  /** Recolor emission, preserving its strength in `.w`. */
  setEmissionColor(hex: string): void {
    const e = linearColor(hex);
    const v = this.uniforms.emissionP.value;
    v.x = e.x;
    v.y = e.y;
    v.z = e.z;
  }

  /**
   * Pack the palette ramp into the stop uniforms (linear rgb + position, sorted), padding unused
   * slots with the last stop. The shader blends these analytically in `gradient()` — the same
   * uniform path the pre-multi-stop colA/colB/colC used, so linear/rgb reproduces the old look.
   */
  setPaletteRamp(palette: RampSpec): void {
    const u = this.uniforms;
    const slots = [
      u.paletteStop0,
      u.paletteStop1,
      u.paletteStop2,
      u.paletteStop3,
      u.paletteStop4,
      u.paletteStop5,
      u.paletteStop6,
      u.paletteStop7,
    ];
    const sorted = sortStopsByPosition(palette.stops);
    const count = Math.min(sorted.length, MAX_PALETTE_STOPS);
    for (let i = 0; i < slots.length; i += 1) {
      const stop = sorted[Math.min(i, count - 1)]!;
      const c = linearColor(stop.color);
      // Clamp to [0,1] to match the preview's bakeRamp (codec also rejects out-of-range imports).
      slots[i]!.value.set(c.x, c.y, c.z, Math.min(1, Math.max(0, stop.position)));
    }
    u.paletteMeta.value.set(
      count,
      RAMP_INTERP_INDEX[palette.interpolation],
      RAMP_SPACE_INDEX[palette.colorSpace],
      0,
    );
  }

  setTrapScale(value: number): void {
    this.uniforms.trapMap.value.x = value;
  }

  setTrapPower(value: number): void {
    this.uniforms.trapMap.value.y = value;
  }

  setMode(mode: number): void {
    // The path-trace loop calls this every sample; skip the redundant uniform write and
    // material reassignment when the mode is unchanged. Formula swaps go through setFormula,
    // which re-syncs the material itself, so guarding on mode alone is safe.
    if (this.uniforms.mode.value === mode) return;
    this.uniforms.mode.value = mode;
    // Preview and path-trace/feature passes ride different pipelines; swap the mesh to the
    // one this mode needs so a preview frame never touches (or compiles) the heavy material.
    this.syncMeshMaterial();
  }

  setFrame(frame: number): void {
    this.uniforms.frame.value = frame;
  }

  /**
   * Push the dive transform (camera space -> fractal space, see DiveController). The
   * rotation arrives column-major from Matrix3; the shader wants rows for dot products.
   */
  syncDive(offset: THREE.Vector3, basis: THREE.Matrix3, scale: number): void {
    const u = this.uniforms;
    u.diveP.value.set(offset.x, offset.y, offset.z, scale);
    const e = basis.elements;
    u.diveRX.value.set(e[0], e[3], e[6]);
    u.diveRY.value.set(e[1], e[4], e[7]);
    u.diveRZ.value.set(e[2], e[5], e[8]);
  }

  /** Pull camera position, basis, and FOV from the live perspective camera. */
  syncCamera(camera: THREE.PerspectiveCamera): void {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    this.uniforms.camPos.value.set(e[12], e[13], e[14]);
    this.uniforms.camRight.value.set(e[0], e[1], e[2]).normalize();
    this.uniforms.camUp.value.set(e[4], e[5], e[6]).normalize();
    // camera looks down -Z in view space
    this.uniforms.camFwd.value.set(-e[8], -e[9], -e[10]).normalize();
    this.uniforms.tanHalfFov.value = Math.tan((camera.fov * Math.PI) / 180 / 2);
    this.recomputeFogPocketCenter();
  }

  /** Camera-frame pocket offset (right, up, forward) and radius, set by applyEffects. */
  private readonly fogPocketOffset = new THREE.Vector3(
    FOG_DEFAULTS.pocketX,
    FOG_DEFAULTS.pocketY,
    FOG_DEFAULTS.pocketZ,
  );
  private fogPocketRadius = FOG_DEFAULTS.pocketRadius;

  /**
   * Resolve the camera-frame pocket offset into a march-frame centre (the same frame as
   * `ro = camPos`) using the live camera basis, so the pocket stays glued to the camera
   * and re-bases through a dive. Cheap; called per frame from syncCamera and on every
   * fog-slider change.
   */
  private recomputeFogPocketCenter(): void {
    const u = this.uniforms;
    const o = this.fogPocketOffset;
    const p = u.camPos.value;
    const r = u.camRight.value;
    const up = u.camUp.value;
    const f = u.camFwd.value;
    u.fogPocketC.value.set(
      p.x + r.x * o.x + up.x * o.y + f.x * o.z,
      p.y + r.y * o.x + up.y * o.y + f.y * o.z,
      p.z + r.z * o.x + up.z * o.y + f.z * o.z,
      this.fogPocketRadius,
    );
  }

  resize(width: number, height: number): void {
    this.uniforms.resolution.value.set(width, height);
  }

  renderTo(renderer: THREE.WebGPURenderer, target: THREE.RenderTarget): void {
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);
  }

  /**
   * Warm pipelines in the background after first paint. Two tiers: every formula's cheap
   * preview pipeline (so a preset switch shows instantly, and these are small enough to
   * persist in the browser shader cache across reloads), plus the ACTIVE formula's full
   * path-trace/feature pipeline (the ~6-9s compile) so the first render of what's on screen
   * doesn't stall. The other formulas' full pipelines compile lazily on first render - one
   * stall each, once per session, since the big blobs don't survive a reload anyway.
   * Compiles against `target` so the cached pipeline is keyed to the sample
   * target's format - the same pipeline `renderTo` later hits - and runs on an isolated
   * scene so it never swaps the material on the live mesh mid-frame. `compileAsync` builds
   * each pipeline asynchronously, so this doesn't block the JS frame loop (the live preview
   * keeps running); the driver's actual pipeline build can still contend for the GPU and
   * cause minor preview hitches, but preview is cheap and this is backgrounded. We await one
   * formula at a time to drive a progress readout. Best-effort: a formula whose compile
   * rejects is logged and skipped so the rest still warm and the loop still reaches `total`
   * (which dismisses the indicator). The formula already on screen resolves from cache.
   */
  async precompile(
    renderer: THREE.WebGPURenderer,
    target: THREE.RenderTarget,
    onProgress: (done: number, total: number) => void,
  ): Promise<void> {
    // Every formula's preview pipeline, then the active formula's full pipeline last (heaviest;
    // the formula already on screen resolves its preview from cache immediately).
    const jobs: { label: string; build: () => THREE.MeshBasicNodeMaterial }[] = [
      ...FORMULAS.map((def) => ({
        label: `${def.id}:preview`,
        build: (): THREE.MeshBasicNodeMaterial => this.previewMaterialFor(def.id),
      })),
      {
        label: `${this.activeFormula}:render`,
        build: (): THREE.MeshBasicNodeMaterial => this.renderMaterialFor(this.activeFormula),
      },
    ];
    const total = jobs.length;
    let done = 0;
    onProgress(done, total);
    try {
      // compilePipeline serializes the actual compiles (compileAsync is not re-entrant);
      // awaiting each here also keeps only one warm queued at a time and drives the readout.
      for (const job of jobs) {
        try {
          await this.compilePipeline(renderer, target, job.build());
        } catch (error) {
          // One bad shader must not abort warming the rest, nor escape as an unhandled
          // rejection: log and carry on so `done` still climbs to `total`.
          console.error(`Shader warm failed for "${job.label}"`, error);
        }
        done += 1;
        onProgress(done, total);
      }
    } finally {
      // The live loop's renderTo leaves the target null between frames, but reset explicitly
      // so a clean state is guaranteed even if no frame ran during warming.
      renderer.setRenderTarget(null);
    }
  }

  /**
   * compileAsync a single material on a throwaway scene bound to `target`, so it never swaps the
   * live mesh's material mid-frame. Every call is appended to `compileChain` so compiles run
   * strictly one at a time, however they were triggered (warm loop, Render click, double-click):
   * three's compileAsync is not re-entrant. The chain survives a rejected compile (caught) so one
   * bad shader doesn't wedge the rest. Within a single run, the target bind and the compileAsync
   * call are synchronous together (no await between) so the pipeline's color format is captured
   * before any interleaving frame can rebind the target.
   */
  private compilePipeline(
    renderer: THREE.WebGPURenderer,
    target: THREE.RenderTarget,
    material: THREE.MeshBasicNodeMaterial,
  ): Promise<void> {
    const run = async (): Promise<void> => {
      const scene = new THREE.Scene();
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
      mesh.frustumCulled = false;
      scene.add(mesh);
      renderer.setRenderTarget(target);
      const compiled = renderer.compileAsync(scene, this.camera);
      try {
        await compiled;
      } finally {
        mesh.geometry.dispose();
        scene.clear();
      }
    };
    const next = this.compileChain.then(run, run);
    // Keep the chain alive past a rejection so a single failed compile doesn't block the rest;
    // `next` itself still rejects so this call's caller sees the error.
    this.compileChain = next.catch(() => {});
    return next;
  }

  /**
   * Compile the active formula's full path-trace/feature pipeline off the synchronous render
   * path. startRender awaits this before flipping into the render loop, whose sample-0 feature
   * pass would otherwise compile it inside renderTo and freeze the UI for the cold compile.
   * A near-instant cache hit when the background warm already covered the active formula.
   */
  async ensureRenderPipeline(
    renderer: THREE.WebGPURenderer,
    target: THREE.RenderTarget,
  ): Promise<void> {
    try {
      await this.compilePipeline(renderer, target, this.renderMaterialFor(this.activeFormula));
    } finally {
      renderer.setRenderTarget(null);
    }
  }

  dispose(): void {
    for (const material of this.previewMaterials.values()) material.dispose();
    for (const material of this.renderMaterials.values()) material.dispose();
    this.previewMaterials.clear();
    this.renderMaterials.clear();
    this.mesh.geometry.dispose();
    this.envRadianceTexture.dispose();
    this.scene.clear();
  }
}

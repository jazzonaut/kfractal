import * as THREE from "three/webgpu";
import {
  dot,
  float,
  fract,
  mix,
  screenCoordinate,
  screenUV,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import type { Look } from "../fractal/types";

/* TSL post nodes are dynamically typed; `any` is scoped to this GPU seam. */

/**
 * The single post chain (ADR-0005), run once on the accumulated buffer:
 * distortion -> CA -> bloom -> exposure -> ACES -> contrast -> saturation -> vignette
 * -> grain -> sRGB (by the renderer).
 * Exposure scales linear HDR *before* the tone curve, photographic-style, so highlights
 * roll off through ACES instead of clipping. Upstream is linear HDR; grading happens here only.
 */
export class PostChain {
  private readonly post: THREE.RenderPipeline;
  private readonly source: any;

  readonly caAmount = uniform(0.008);
  readonly exposure = uniform(1.0);
  readonly contrast = uniform(1.0);
  readonly saturation = uniform(0.85);
  /** Barrel (>0) / pincushion (<0) radial lens distortion. */
  readonly distortion = uniform(0);
  readonly vignetteStrength = uniform(0);
  readonly vignetteSoftness = uniform(0.5);
  readonly grainStrength = uniform(0);
  /** Advanced once per presented frame so the grain animates. */
  private readonly grainSeed = uniform(0);
  readonly bloom: any;

  constructor(renderer: THREE.WebGPURenderer, sourceTexture: THREE.Texture) {
    this.post = new THREE.RenderPipeline(renderer);
    this.source = texture(sourceTexture);

    // Lens distortion: radial UV remap. `norm` rescales so barrel keeps the corners
    // in-frame (the source RT clamps to edge, which would otherwise smear). The bloom
    // input stays undistorted - invisible at the small amounts exposed in the UI.
    const dDir: any = screenUV.sub(0.5);
    const r2: any = dDir.dot(dDir);
    const norm: any = this.distortion.mul(0.5).add(1).max(1);
    const dUV: any = dDir.mul(r2.mul(this.distortion).add(1)).div(norm).add(0.5);

    // Chromatic aberration: per-channel radial offset sampling in distorted lens space.
    const dir: any = dUV.sub(0.5);
    const len: any = dir.length();
    const offset: any = dir.mul(this.caAmount).mul(len);
    const r: any = this.source.sample(dUV).r;
    const g: any = this.source.sample(dUV.sub(offset)).g;
    const b: any = this.source.sample(dUV.sub(offset.mul(2))).b;
    let color: any = vec3(r, g, b);

    // Bloom on the HDR base, added in.
    const bloomNode: any = bloom(this.source, 0.6, 0.4, 0.18);
    this.bloom = bloomNode;
    color = color.add(bloomNode);

    // Exposure on linear HDR, then ACES filmic tone map.
    color = color.mul(this.exposure);
    const a: any = color.mul(color.mul(2.51).add(0.03));
    const d: any = color.mul(color.mul(2.43).add(0.59)).add(0.14);
    color = a.div(d).clamp(0, 1);

    // Contrast -> saturation.
    color = color.sub(0.5).mul(this.contrast).add(0.5);
    const luma: any = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = mix(vec3(luma), color, this.saturation);

    // Vignette on the display-referred image (post-ACES) so the falloff reads
    // perceptually: 0 at center, ~1 at the corners, band width from softness.
    const vDist: any = screenUV.sub(0.5).length().mul(Math.SQRT2);
    const vMask: any = smoothstep(float(1).sub(this.vignetteSoftness), float(1), vDist);
    color = color.mul(vMask.mul(this.vignetteStrength).oneMinus());

    // Animated film grain LAST (post-denoise, post-accumulation) so it is never
    // averaged away by the accumulator or smeared by the a-trous filter.
    const gPos: any = screenCoordinate.xy.add(vec2(127.1, 311.7).mul(this.grainSeed));
    const grain: any = fract(sin(dot(gPos, vec2(12.9898, 78.233))).mul(43758.5453));
    color = color.add(grain.sub(0.5).mul(this.grainStrength));

    this.post.outputNode = color.clamp(0, 1);
  }

  /** Point the chain at the current accumulation texture (it ping-pongs each frame). */
  setSource(sourceTexture: THREE.Texture): void {
    this.source.value = sourceTexture;
  }

  /** The whole post chain is look-side (ADR-0010): lens character, grade, and post fx. */
  applyLook(look: Look): void {
    this.caAmount.value = look.lens.chromaticAberration;
    this.exposure.value = look.palette.exposure;
    this.contrast.value = look.palette.contrast;
    this.saturation.value = look.palette.saturation;
    this.bloom.strength.value = look.palette.bloomStrength;
    this.bloom.radius.value = look.palette.bloomRadius;
    this.bloom.threshold.value = look.palette.bloomThreshold;
    const fx = look.effects.post;
    this.distortion.value = fx.distortion;
    this.vignetteStrength.value = fx.vignetteStrength;
    this.vignetteSoftness.value = fx.vignetteSoftness;
    this.grainStrength.value = fx.grainStrength;
  }

  render(): void {
    this.grainSeed.value = (this.grainSeed.value + 1) % 1024;
    this.post.render();
  }

  /** Release the GPU resources held by the pipeline and the bloom node's mip RT chain. */
  dispose(): void {
    this.bloom.dispose();
    this.post.dispose();
  }
}

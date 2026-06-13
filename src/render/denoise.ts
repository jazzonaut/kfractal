import * as THREE from "three/webgpu";
import { float, mix, texture, uniform, uv, vec2 } from "three/tsl";

/* TSL node inputs are dynamically typed; `any` is scoped to this GPU seam. */

/**
 * Edge-aware à-trous (joint-bilateral) denoiser (ADR-0008).
 *
 * Runs N dilated 5x5 B3-spline passes over the accumulated linear-HDR mean, weighting each
 * tap by primary-hit feature similarity (normal, depth, albedo) so geometry and orbit-trap
 * texture edges stay sharp while low-sample Monte Carlo grain smooths out. Filter strength
 * fades with the sample count and the final pass blends back toward the raw mean, so a
 * converged render passes through untouched.
 *
 * Orientation note (see AccumulationBuffer): RT-to-RT passes store output V-flipped relative
 * to texture() sampling. The color input (accumulation output, already flip-compensated
 * upstream) and the feature targets (raw fractal-pass output) are therefore in OPPOSITE
 * orientation classes: color must be sampled at flipped V - with NEGATED y tap offsets -
 * while features are sampled at standard V. The pass output then lands back in the color
 * class, so every iteration (and the post chain downstream) composes consistently.
 */

const KERNEL_1D = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16];
const STEPS = [1, 2, 4, 8];
/** Below this sample count the filter runs at full strength… */
const FULL_STRENGTH_SAMPLES = 64;
/** …and by this count it has faded out entirely. */
const ZERO_STRENGTH_SAMPLES = 512;

function makeTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(width, height, {
    type: THREE.FloatType,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
}

export class AtrousDenoiser {
  /** Primary-hit normal (xyz) + ray depth (w; 1e9 on miss). Rendered at render start. */
  readonly featureND: THREE.RenderTarget;
  /** Primary-hit albedo (rgb) + coverage (a; 0 on miss). Rendered at render start. */
  readonly featureAlbedo: THREE.RenderTarget;

  private read: THREE.RenderTarget;
  private write: THREE.RenderTarget;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.MeshBasicNodeMaterial;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);

  private readonly srcTex: any;
  private readonly rawTex: any;
  private readonly ndTex: any;
  private readonly albTex: any;
  private readonly stepPx = uniform(1);
  private readonly blendRaw = uniform(0);
  private readonly texel: any;

  constructor(width: number, height: number) {
    this.featureND = makeTarget(width, height);
    this.featureAlbedo = makeTarget(width, height);
    this.read = makeTarget(width, height);
    this.write = makeTarget(width, height);
    this.texel = uniform(new THREE.Vector2(1 / width, 1 / height));

    this.srcTex = texture(this.read.texture);
    this.rawTex = texture(this.read.texture);
    this.ndTex = texture(this.featureND.texture);
    this.albTex = texture(this.featureAlbedo.texture);

    // Color (S-class) center: flipped V. Features (φS-class) center: standard V.
    const colorUv: any = vec2(uv().x, uv().y.oneMinus());
    const featUv: any = uv();

    const centerND: any = this.ndTex.sample(featUv);
    const n0: any = centerND.xyz;
    const d0: any = centerND.w;
    const a0: any = this.albTex.sample(featUv).xyz;

    // Center tap enters unconditioned so the weight sum can never reach zero.
    let sum: any = this.srcTex.sample(colorUv).mul(KERNEL_1D[2]! * KERNEL_1D[2]!);
    let weightSum: any = float(KERNEL_1D[2]! * KERNEL_1D[2]!);

    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const kernel = KERNEL_1D[dx + 2]! * KERNEL_1D[dy + 2]!;
        const offset: any = vec2(dx, dy).mul(this.stepPx).mul(this.texel);
        // Same logical texel: color taps mirror the y offset (orientation classes differ).
        const colorOffset: any = vec2(offset.x, offset.y.negate());
        const tapND: any = this.ndTex.sample(featUv.add(offset));
        const tapAlb: any = this.albTex.sample(featUv.add(offset)).xyz;
        const tapColor: any = this.srcTex.sample(colorUv.add(colorOffset));

        const wNormal: any = n0.dot(tapND.xyz).clamp(0, 1).pow(32);
        const relDepth: any = d0.sub(tapND.w).abs().div(d0.abs().add(0.001));
        const wDepth: any = relDepth.mul(-24).exp();
        const dAlb: any = a0.sub(tapAlb);
        const wAlbedo: any = dAlb.dot(dAlb).mul(-60).exp();
        const w: any = wNormal.mul(wDepth).mul(wAlbedo).mul(kernel);

        sum = sum.add(tapColor.mul(w));
        weightSum = weightSum.add(w);
      }
    }

    let result: any = sum.div(weightSum);
    // Final pass blends back toward the raw mean as accumulation converges.
    result = mix(result, this.rawTex.sample(colorUv), this.blendRaw);

    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.colorNode = result;
    this.material.depthTest = false;
    this.material.depthWrite = false;

    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** 1 = full filtering, 0 = bypass; eases out as the mean converges. */
  static strength(samples: number): number {
    const t = (ZERO_STRENGTH_SAMPLES - samples) / (ZERO_STRENGTH_SAMPLES - FULL_STRENGTH_SAMPLES);
    return Math.min(1, Math.max(0, t));
  }

  /**
   * Filter the accumulated mean; returns the texture the post chain should read.
   * Returns `source` untouched once the fade has reached zero.
   */
  run(renderer: THREE.WebGPURenderer, source: THREE.Texture, samples: number): THREE.Texture {
    const strength = AtrousDenoiser.strength(samples);
    if (strength <= 0.001) return source;

    let input = source;
    for (let i = 0; i < STEPS.length; i += 1) {
      this.stepPx.value = STEPS[i]!;
      this.blendRaw.value = i === STEPS.length - 1 ? 1 - strength : 0;
      this.srcTex.value = input;
      this.rawTex.value = source;

      renderer.setRenderTarget(this.write);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(null);

      input = this.write.texture;
      const swap = this.read;
      this.read = this.write;
      this.write = swap;
    }
    return input;
  }

  resize(width: number, height: number): void {
    this.featureND.setSize(width, height);
    this.featureAlbedo.setSize(width, height);
    this.read.setSize(width, height);
    this.write.setSize(width, height);
    this.texel.value.set(1 / width, 1 / height);
  }

  dispose(): void {
    this.featureND.dispose();
    this.featureAlbedo.dispose();
    this.read.dispose();
    this.write.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}

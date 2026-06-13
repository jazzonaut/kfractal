import * as THREE from "three/webgpu";
import { mix, texture, uniform, uv, vec2 } from "three/tsl";

/* TSL node inputs are dynamically typed; `any` is scoped to this GPU seam. */

function makeTarget(width: number, height: number): THREE.RenderTarget {
  // Full float32: with fp16 the 1/(n+1) correction drops below half precision after
  // ~150 samples and convergence stalls, freezing residual noise into the mean.
  // Linear filtering is load-bearing: the post chain samples this texture with sub-texel
  // interpolation (chromatic aberration, lens distortion, and the HiDPI upscale into a
  // larger canvas backbuffer), so Nearest would not be output-equivalent.
  const target = new THREE.RenderTarget(width, height, {
    type: THREE.FloatType,
    depthBuffer: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });
  return target;
}

/**
 * Progressive accumulation (ADR-0003): a ping-pong pair of half-float targets blended by
 * `mix(prev, sample, 1/(n+1))`, so successive path-trace samples converge to their mean.
 * Reset is implicit - sample 0 uses blend factor 1.0, ignoring stale history.
 */
export class AccumulationBuffer {
  private read: THREE.RenderTarget;
  private write: THREE.RenderTarget;

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.MeshBasicNodeMaterial;
  private readonly geometry = new THREE.PlaneGeometry(2, 2);
  private readonly blendFactor = uniform(1);
  private readonly prevTex: any;
  private readonly sampleTex: any;

  constructor(width: number, height: number, sampleTexture: THREE.Texture) {
    this.read = makeTarget(width, height);
    this.write = makeTarget(width, height);

    // three's WebGPU backend stores RT-to-RT pass output V-flipped relative to texture()
    // sampling. One-shot passes never notice (the screen pass compensates), but a ping-pong
    // FEEDBACK loop mirrors its own history every blend, converging to image + vertical
    // mirror (ghosting). Sampling prev with flipped V cancels the round-trip exactly.
    this.prevTex = texture(this.read.texture, vec2(uv().x, uv().y.oneMinus()));
    this.sampleTex = texture(sampleTexture);

    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.colorNode = mix(this.prevTex, this.sampleTex, this.blendFactor);
    this.material.depthTest = false;
    this.material.depthWrite = false;

    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** Texture holding the latest accumulated result; feed this to the post chain. */
  get texture(): THREE.Texture {
    return this.read.texture;
  }

  /** Blend the just-rendered sample into the running mean. `sampleIndex` starts at 0. */
  accumulate(renderer: THREE.WebGPURenderer, sampleIndex: number): void {
    this.blendFactor.value = 1 / (sampleIndex + 1);
    this.prevTex.value = this.read.texture;

    renderer.setRenderTarget(this.write);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(null);

    const swap = this.read;
    this.read = this.write;
    this.write = swap;
  }

  resize(width: number, height: number): void {
    this.read.setSize(width, height);
    this.write.setSize(width, height);
  }

  dispose(): void {
    this.read.dispose();
    this.write.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }
}

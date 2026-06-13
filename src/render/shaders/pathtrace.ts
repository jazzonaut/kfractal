import { ENV_ATLAS_H, ENV_H, GRID_H, GRID_W } from "../environment";

/**
 * WGSL render core (ADR-0002, ADR-0003, ADR-0004, ADR-0005).
 *
 * `buildRenderSampleWGSL(formulaDE)` returns the full module for ONE formula: the injected
 * DE (`fn formulaDE(c) -> vec2(distance, trap)`) is compiled in, so each formula gets its
 * own cached pipeline with zero runtime branching on formula choice.
 *
 * A single `renderSample()` entry returns ONE linear-HDR sample for a pixel:
 *   mode 0  preview        - one march + analytic AO/soft shadow, shaped to approximate
 *                            what the path tracer converges to (same sky, light, BRDF)
 *   mode 1  path trace     - multi-bounce transport: cone-sampled area key light via NEE,
 *                            fresnel-weighted specular/diffuse/transmission lobes, emission
 *   mode 2  feature pass   - primary-hit vec4(normal, depth) for the denoiser (miss: w=1e9)
 *   mode 3  feature pass   - primary-hit vec4(albedo, 1) for the denoiser (miss: 0)
 * Feature passes are deterministic (no AA jitter, no DOF), so they align with the mean image.
 *
 * The full Material struct (ADR-0005) is albedo/roughness/specular/translucency/ior/emission;
 * albedo and emission are driven by the orbit trap through the gradient.
 *
 * three's `wgslFn` parser requires the ENTRY function to be the FIRST declaration in the
 * source (it parses the leading `fn ... (...) -> type` and treats the remainder as the
 * block). WGSL resolves module-scope declarations in any order, so helpers and the injected
 * formula follow the entry.
 */

export const RENDER_SAMPLE_FN = "renderSample";

export function buildRenderSampleWGSL(formulaDE: string): string {
  return /* wgsl */ `
fn ${RENDER_SAMPLE_FN}(
  uv: vec2<f32>,
  resolution: vec2<f32>,
  camPos: vec3<f32>,
  camRight: vec3<f32>,
  camUp: vec3<f32>,
  camFwd: vec3<f32>,
  tanHalfFov: f32,
  mode: f32,
  frame: f32,
  formulaP: vec4<f32>,
  iterations: f32,
  renderP: vec4<f32>,
  lightPosDir0: vec4<f32>,
  lightPosDir1: vec4<f32>,
  lightPosDir2: vec4<f32>,
  lightPosDir3: vec4<f32>,
  lightColInt0: vec4<f32>,
  lightColInt1: vec4<f32>,
  lightColInt2: vec4<f32>,
  lightColInt3: vec4<f32>,
  lightGeo0: vec4<f32>,
  lightGeo1: vec4<f32>,
  lightGeo2: vec4<f32>,
  lightGeo3: vec4<f32>,
  lightMeta: vec4<f32>,
  lens: vec2<f32>,
  matP: vec4<f32>,
  emissionP: vec4<f32>,
  trapMap: vec2<f32>,
  colA: vec3<f32>,
  colB: vec3<f32>,
  colC: vec3<f32>,
  envP: vec4<f32>,
  envSun: vec4<f32>,
  sunColor: vec3<f32>,
  envDomDir: vec3<f32>,
  envDomColor: vec3<f32>,
  envAvgColor: vec3<f32>,
  diveP: vec4<f32>,
  diveRX: vec3<f32>,
  diveRY: vec3<f32>,
  diveRZ: vec3<f32>,
  fogP: vec4<f32>,
  fogC: vec4<f32>,
  glowP: vec4<f32>,
  glowColor: vec3<f32>,
  fxA: vec4<f32>,
  fxB: vec4<f32>,
  growthP: vec4<f32>,
  growthQ: vec4<f32>,
  growthC: vec4<f32>,
  warpP: vec4<f32>,
  warpQ: vec4<f32>,
  envTex: texture_2d<f32>,
  envTexSampler: sampler
) -> vec4<f32> {
  let px = vec2<u32>(clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)) * resolution);
  gPixelSeed = pcgHash(px.x ^ pcgHash(px.y));
  gSampleIdx = u32(frame);
  gSobolDim = 0u;

  gP0 = formulaP.x;
  gP1 = formulaP.y;
  gP2 = formulaP.z;
  gP3 = formulaP.w;
  gIters = i32(iterations);
  gMaxSteps = i32(renderP.x);
  gMaxDist = renderP.y;
  gSurfEps = renderP.z;
  gNormEps = renderP.w;
  gLightPosDir = array<vec4<f32>, 4>(lightPosDir0, lightPosDir1, lightPosDir2, lightPosDir3);
  gLightColInt = array<vec4<f32>, 4>(lightColInt0, lightColInt1, lightColInt2, lightColInt3);
  gLightGeo = array<vec4<f32>, 4>(lightGeo0, lightGeo1, lightGeo2, lightGeo3);
  gLightCount = i32(lightMeta.x);
  gAmbient = lightMeta.y;
  // Dominant light: brightest enabled, by luminance of color*intensity. Stand-in
  // consumers (rim tint, preview bounce, fog) follow it so a disabled key light
  // hands those roles to whichever light now carries the scene.
  gDomLight = -1;
  var domLum = 0.0;
  gLightWeightSum = 0.0;
  gLightLive = 0;
  for (var i = 0; i < gLightCount; i = i + 1) {
    let ci = gLightColInt[i];
    let lum = dot(ci.rgb, vec3<f32>(0.2126, 0.7152, 0.0722)) * ci.w;
    if (lum > domLum) {
      domLum = lum;
      gDomLight = i;
    }
    var wgt = 0.0;
    if (ci.w > 0.0) {
      wgt = max(lum, 1e-4);
      gLightLive = gLightLive + 1;
    }
    gLightWeight[i] = wgt;
    gLightWeightSum = gLightWeightSum + wgt;
  }
  gMatP = matP;
  gEmission = emissionP;
  gTrapMap = trapMap;
  gColA = colA;
  gColB = colB;
  gColC = colC;
  gEnvMode = i32(envP.x);
  gEnvIntensity = envP.y;
  gEnvYaw = envP.z;
  gTurbidity = envP.w;
  gSunDir = envSun.xyz;
  gSunSize = envSun.w;
  gSunColor = sunColor;
  gEnvDomDir = envDomDir;
  gEnvDomColor = envDomColor;
  gEnvAvgColor = envAvgColor;
  gDiveOff = diveP.xyz;
  gDiveScale = diveP.w;
  gDiveRX = diveRX;
  gDiveRY = diveRY;
  gDiveRZ = diveRZ;
  gFogP = fogP;
  gFogC = fogC;
  gGlowP = glowP;
  gGlowColor = glowColor;
  gFxA = fxA;
  gFxB = fxB;
  gGrowthP = growthP;
  gGrowthQ = growthQ;
  gGrowthC = growthC;
  gWarpP = warpP;
  gWarpQ = warpQ;
  let warpAxes = i32(warpQ.w + 0.5);
  gWarpAxT = warpAxes % 3;
  gWarpAxB = (warpAxes / 3) % 3;
  gWarpAxR = warpAxes / 9;
  // FXC (Chrome's D3D12 shader compiler) fully unrolls loops with provably constant
  // trip counts; the noise scans below, inlined at every de() call site by growth,
  // then cost ~9 seconds of pipeline compile at startup. resolution.y is never
  // negative, so opaqueZero is always exactly 0 - but the compiler can't prove it,
  // and the loops stay rolled.
  let opaqueZero = i32(step(resolution.y, -1.0));
  gCellScan = 27 + opaqueZero;
  gCornerScan = 8 + opaqueZero;
  gNormScan = 4 + opaqueZero;
  gAoScan = 5 + opaqueZero;
  gOctaveScan = 2 + opaqueZero;
  // Effect gates: uniform-derived, so the branches are coherent and ~free when off.
  gFogOn = fogP.x > 0.0;
  gGlowOn = glowP.x > 0.0;
  gNoiseOn = fxB.x > 0.0 || fxB.y > 0.0;
  gGrowthOn = growthP.x > 0.0;
  gWarpOn = warpP.x != 0.0 || warpP.y != 0.0 || warpP.z > 0.0 || warpQ.x > 0.0;
  gGlowArm = gGlowOn;
  gPixelEps = 2.0 * tanHalfFov / resolution.y * (gSurfEps / EPS_REF);
  gEpsFloor = gSurfEps * 0.05;
  gNormScale = gNormEps / max(gSurfEps, 1.0e-9);

  let tracing = mode > 0.5 && mode < 1.5;

  var juv = uv;
  if (tracing) {
    juv = uv + (rnd2f() - 0.5) / resolution;
  }
  var p = juv * 2.0 - 1.0;
  let aspect = resolution.x / resolution.y;
  p.x = p.x * aspect;

  var ro = camPos;
  var rd = normalize(camFwd + camRight * (p.x * tanHalfFov) + camUp * (p.y * tanHalfFov));

  if (mode > 2.5) {
    let h = march(ro, rd);
    if (h.hit < 0.5) {
      // Miss pixels under fog carry the fog tint so the denoiser's albedo weight
      // clusters heavily-fogged pixels together instead of smearing shafts.
      if (gFogOn) {
        let haze = 1.0 - fogTransmittance(ro, rd, gMaxDist);
        return vec4<f32>(gFogC.rgb * haze, 0.0);
      }
      return vec4<f32>(0.0);
    }
    var alb = surfaceMaterial(h.trap, h.pos).albedo;
    if (gFogOn) {
      alb = mix(alb, gFogC.rgb, 1.0 - fogTransmittance(ro, rd, h.t));
    }
    return vec4<f32>(alb, 1.0);
  }
  if (mode > 1.5) {
    let h = march(ro, rd);
    if (h.hit < 0.5) {
      // Unit sentinel normal (not zero) so the denoiser's normal weight is 1 between two
      // miss pixels (dot of parallel unit vectors), letting its depth+albedo weights cluster
      // background/fog taps. A zero normal would zero every neighbor weight and pass miss
      // pixels through unfiltered. Hit<->miss taps are still separated by the 1e9 depth weight.
      return vec4<f32>(0.0, 0.0, 1.0, 1.0e9);
    }
    return vec4<f32>(calcNormal(h.pos, h.t), h.t);
  }

  if (tracing && lens.x > 0.0001) {
    let focal = ro + rd * lens.y;
    let lensU = rnd2f();
    let r = sqrt(lensU.x);
    let ang = TWO_PI * lensU.y;
    let offset = (camRight * cos(ang) + camUp * sin(ang)) * r * lens.x;
    ro = ro + offset;
    rd = normalize(focal - ro);
  }

  if (tracing) {
    return vec4<f32>(pathTrace(ro, rd, envTex, envTexSampler), 1.0);
  }
  return vec4<f32>(previewShade(ro, rd, envTex, envTexSampler), 1.0);
}

struct Hit {
  t: f32,
  hit: f32,
  pos: vec3<f32>,
  trap: f32,
  // Volumetric aura accumulated along the march (primary ray only, see gGlowArm),
  // plus the orbit trap at the ray's closest approach for palette tinting.
  glow: f32,
  glowTrap: f32,
};

struct Material {
  albedo: vec3<f32>,
  roughness: f32,
  specular: f32,
  translucency: f32,
  ior: f32,
  emission: vec3<f32>,
};

// Per-pixel state, set by the entry before any marching.
var<private> gP0: f32;
var<private> gP1: f32;
var<private> gP2: f32;
var<private> gP3: f32;
var<private> gIters: i32;
var<private> gMaxSteps: i32;
var<private> gMaxDist: f32;
var<private> gSurfEps: f32;
var<private> gNormEps: f32;
// User lights (up to 4). posDir: xyz = direction toward light (w=0, directional) or
// scene-space position (w=1, positional). colInt: rgb linear color, w = effective
// intensity (0 = disabled/empty slot). geo: x = size (cone half-angle | sphere radius),
// y = falloff distance. gDomLight indexes the brightest enabled light (-1 if none).
var<private> gLightPosDir: array<vec4<f32>, 4>;
var<private> gLightColInt: array<vec4<f32>, 4>;
var<private> gLightGeo: array<vec4<f32>, 4>;
var<private> gLightCount: i32;
var<private> gDomLight: i32;
// NEE light selection (one shared shadow ray per vertex): per-light selection
// weights by luminance * intensity (0 when disabled), their sum, and the count of
// enabled lights. All uniform-derived, filled once alongside gDomLight.
var<private> gLightWeight: array<f32, 4>;
var<private> gLightWeightSum: f32;
var<private> gLightLive: i32;
var<private> gAmbient: f32;
var<private> gMatP: vec4<f32>;
var<private> gEmission: vec4<f32>;
var<private> gTrapMap: vec2<f32>;
var<private> gColA: vec3<f32>;
var<private> gColB: vec3<f32>;
var<private> gColC: vec3<f32>;
// Environment lighting (ADR-0009): 0 studio fill, 1 preetham, 2 procedural env map.
var<private> gEnvMode: i32;
var<private> gEnvIntensity: f32;
var<private> gEnvYaw: f32;
var<private> gTurbidity: f32;
var<private> gSunDir: vec3<f32>;
var<private> gSunSize: f32;
var<private> gSunColor: vec3<f32>;
var<private> gEnvDomDir: vec3<f32>;
var<private> gEnvDomColor: vec3<f32>;
var<private> gEnvAvgColor: vec3<f32>;
// Dive transform (infinite zoom): camera space -> fractal space is offset + scale*(R*p).
// The CPU-side DiveController re-bases this whenever the camera dives past a threshold,
// so camera-space coordinates (and every marching constant below) stay O(1) at any depth.
var<private> gDiveOff: vec3<f32>;
var<private> gDiveScale: f32;
var<private> gDiveRX: vec3<f32>;
var<private> gDiveRY: vec3<f32>;
var<private> gDiveRZ: vec3<f32>;
// Pixel-footprint epsilon: world size of one pixel at unit distance, times the preset's
// surfaceEpsilon expressed as a quality factor relative to EPS_REF.
var<private> gPixelEps: f32;
var<private> gEpsFloor: f32;
var<private> gNormScale: f32;
var<private> gPixelSeed: u32;
var<private> gSampleIdx: u32;
var<private> gSobolDim: u32;
// Special effects (all opt-in; zero strengths reproduce the effect-free image).
// fogP: density, height falloff, height base, HG anisotropy. fogC: tint rgb, in-scatter gain.
var<private> gFogP: vec4<f32>;
var<private> gFogC: vec4<f32>;
// glowP: strength, proximity radius, palette-tint flag, falloff exponent.
var<private> gGlowP: vec4<f32>;
var<private> gGlowColor: vec3<f32>;
// fxA: iridescence, film thickness 0..1, rim strength, micro-noise frequency.
// fxB: micro-noise roughness amount, micro-noise albedo amount.
var<private> gFxA: vec4<f32>;
var<private> gFxB: vec4<f32>;
// Surface growth, a displacement layer inside de(). growthP: protrusion length
// (camera-space; 0 = off), density, sharpness, coverage. growthQ: mode index, color
// blend, emission, Lipschitz step scale (CPU-precomputed). growthC: rgb linear color,
// orbit-trap placement bias in w (positive = crevices, negative = ridges).
var<private> gGrowthP: vec4<f32>;
var<private> gGrowthQ: vec4<f32>;
var<private> gGrowthC: vec4<f32>;
// Domain warp (ADR-0012), applied to fractal space before the formula runs.
// warpP: twist rad/unit, bend rad/unit, ripple amplitude, ripple frequency.
// warpQ: noise amplitude, noise frequency, constant Lipschitz part (CPU-precomputed
// ripple*noise product), packed canonical axes (twist + 3*bend + 9*ripple).
var<private> gWarpP: vec4<f32>;
var<private> gWarpQ: vec4<f32>;
var<private> gWarpAxT: i32;
var<private> gWarpAxB: i32;
var<private> gWarpAxR: i32;
// Twist/bend axis radii recorded by warpDomain, consumed by warpLipschitz: the
// per-point factors must be measured at the exact intermediate points the warp visited.
var<private> gWarpRT: f32;
var<private> gWarpRB: f32;
// Always exactly 27 / 8 / 4 / 5 / 2; see the entry function for why they must not be
// constants.
var<private> gCellScan: i32;
var<private> gCornerScan: i32;
var<private> gNormScan: i32;
var<private> gAoScan: i32;
var<private> gOctaveScan: i32;
var<private> gFogOn: bool;
var<private> gGlowOn: bool;
var<private> gNoiseOn: bool;
var<private> gGrowthOn: bool;
var<private> gWarpOn: bool;
// Glow accumulates on the primary march only: per-bounce accumulation would scale the
// aura with path statistics. pathTrace() disarms this after its first march.
var<private> gGlowArm: bool;

const MAX_BOUNCES: i32 = 5;
const TWO_PI: f32 = 6.28318530718;
// Firefly control: indirect (bounce > 0) contributions are clamped to this linear HDR
// ceiling. Slightly biased (dims rare caustic-like paths) but removes the bright speckle
// noise that dominates shadowed areas at workstation sample counts.
const INDIRECT_CLAMP: f32 = 6.0;

fn clampIndirect(c: vec3<f32>, bounce: i32) -> vec3<f32> {
  if (bounce == 0) {
    return c;
  }
  return min(c, vec3<f32>(INDIRECT_CLAMP));
}

// --- Sampler: shuffled, hash-based Owen-scrambled Sobol (0,2)-sequence (Burley 2020).
// Each rndf()/rnd2f() call is one padded dimension group: the accumulation sample index
// is shuffled and the Sobol coordinates Owen-scrambled with seeds hashed from
// (pixel, dimension), so every 1D/2D projection the integrator consumes is its own
// decorrelated low-discrepancy point set across the run. Stratification is exact for
// power-of-two sample caps and degrades gracefully otherwise.

fn pcgHash(vIn: u32) -> u32 {
  let state = vIn * 747796405u + 2891336453u;
  let w = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (w >> 22u) ^ w;
}

// Laine-Karras-style permutation: carries propagate upward only, so applied to a
// bit-reversed value it realizes a nested uniform (Owen) scramble.
fn lkPermute(vIn: u32, seed: u32) -> u32 {
  var v = vIn + seed;
  v = v ^ (v * 0x6c50b47cu);
  v = v ^ (v * 0xb82f1e52u);
  v = v ^ (v * 0xc7afe638u);
  v = v ^ (v * 0x8d22f6e6u);
  return v;
}

fn owenScramble(v: u32, seed: u32) -> u32 {
  return reverseBits(lkPermute(reverseBits(v), seed));
}

// Sobol dimension 1; dimension 0 is plain bit reversal.
fn sobolDim1(indexIn: u32) -> u32 {
  var index = indexIn;
  var v = 0x80000000u;
  var result = 0u;
  for (var i = 0u; i < 32u; i = i + 1u) {
    if (index == 0u) { break; }
    if ((index & 1u) != 0u) { result = result ^ v; }
    index = index >> 1u;
    v = v ^ (v >> 1u);
  }
  return result;
}

fn sobolToFloat(v: u32) -> f32 {
  return f32(v >> 8u) * (1.0 / 16777216.0);
}

fn rndf() -> f32 {
  let seed = pcgHash(gPixelSeed ^ (gSobolDim * 0x9e3779b9u));
  gSobolDim = gSobolDim + 1u;
  let shuffled = owenScramble(gSampleIdx, pcgHash(seed ^ 0x68bc21ebu));
  return sobolToFloat(owenScramble(reverseBits(shuffled), pcgHash(seed ^ 0x02e5be93u)));
}

fn rnd2f() -> vec2<f32> {
  let seed = pcgHash(gPixelSeed ^ (gSobolDim * 0x9e3779b9u));
  gSobolDim = gSobolDim + 1u;
  let shuffled = owenScramble(gSampleIdx, pcgHash(seed ^ 0x68bc21ebu));
  return vec2<f32>(
    sobolToFloat(owenScramble(reverseBits(shuffled), pcgHash(seed ^ 0x02e5be93u))),
    sobolToFloat(owenScramble(sobolDim1(shuffled), pcgHash(seed ^ 0x967a889bu))),
  );
}

// Presets store surfaceEpsilon tuned against this reference; the ratio scales the
// pixel-footprint epsilon so existing quality knobs keep their meaning.
const EPS_REF: f32 = 4.0e-4;

fn toFractalSpace(p: vec3<f32>) -> vec3<f32> {
  return gDiveOff +
    gDiveScale * vec3<f32>(dot(gDiveRX, p), dot(gDiveRY, p), dot(gDiveRZ, p));
}

// Warped base field: the formula evaluated through the domain warp (ADR-0012), with
// the distance divided down by the warp's local Lipschitz bound so sphere tracing
// stays safe. Camera-space units (R is orthonormal, so fractal-space distances divide
// straight back through gDiveScale).
fn baseDe(p: vec3<f32>) -> vec2<f32> {
  var q = toFractalSpace(p);
  if (gWarpOn) {
    q = warpDomain(q);
  }
  let r = formulaDE(q);
  var d = r.x;
  if (gWarpOn) {
    d = d / warpLipschitz(max(d, 0.0));
  }
  return vec2<f32>(d / gDiveScale, r.y);
}

fn de(p: vec3<f32>) -> vec2<f32> {
  let b = baseDe(p);
  var d = b.x;
  if (gGrowthOn) {
    let len = gGrowthP.x;
    if (d < len * 1.6) {
      // Displaced field is no longer 1-Lipschitz; gGrowthQ.w slows the march to match.
      // Growth patterns anchor in UN-warped fractal space, like micro noise.
      d = (d - len * growthField(toFractalSpace(p), b.y)) * gGrowthQ.w;
    } else {
      // The displaced surface lies within base <= len, so this bound is conservative
      // and far rays never step over a spike without paying for the pattern.
      d = d - len;
    }
  }
  return vec2<f32>(d, b.y);
}

fn hitEps(t: f32) -> f32 {
  return max(gEpsFloor, t * gPixelEps);
}

fn march(ro: vec3<f32>, rd: vec3<f32>) -> Hit {
  var t = 0.0;
  var trap = 1.0;
  var pos = ro;
  var hit = 0.0;
  var glowAcc = 0.0;
  var glowTrap = 1.0;
  var glowNear = 1.0e9;
  for (var i = 0; i < gMaxSteps; i = i + 1) {
    pos = ro + rd * t;
    let d = de(pos);
    trap = d.y;
    if (d.x < hitEps(t)) {
      hit = 1.0;
      break;
    }
    if (gGlowOn && gGlowArm) {
      // Aura: emissive energy proportional to surface proximity, integrated over the
      // step the ray is about to take. The de() value is already paid for. Normalized
      // by pi*radius so one grazing pass is ~1.0 at any radius; the clamp keeps rays
      // that crawl past many structures from blowing out.
      let prox = gGlowP.y / (d.x + gGlowP.y);
      var w = pow(prox, gGlowP.w) * d.x * 0.9 / (PI * gGlowP.y);
      if (gFogOn) {
        w = w * fogTransmittance(ro, rd, t);
      }
      glowAcc = glowAcc + w;
      if (d.x < glowNear) {
        glowNear = d.x;
        glowTrap = d.y;
      }
    }
    t = t + d.x * 0.9;
    if (t > gMaxDist) {
      break;
    }
  }
  return Hit(t, hit, pos, trap, glowAcc, glowTrap);
}

// Rolled over the six signed axis probes (opaque bound): keeps this at ONE de()
// inline copy instead of six, which matters for compile time now that de() carries
// growth.
// Tetrahedral 4-tap DE gradient: the four offsets sum to zero, so the de(p) term
// cancels and the gradient costs 4 DE evaluations instead of the 6 per-axis
// central differences used previously.
fn calcNormal(p: vec3<f32>, t: f32) -> vec3<f32> {
  let e = hitEps(t) * gNormScale;
  var n = vec3<f32>(0.0);
  for (var i = 0; i < gNormScan; i = i + 1) {
    let sz = f32(i & 1) * 2.0 - 1.0;
    let sy = f32((i >> 1) & 1) * 2.0 - 1.0;
    let s = vec3<f32>(sz * sy, sy, sz);
    n = n + s * de(p + s * e).x;
  }
  return normalize(n);
}

fn trapTone(trap: f32) -> f32 {
  return clamp(pow(max(trap, 0.0) * gTrapMap.x, gTrapMap.y), 0.0, 1.0);
}

fn gradient(tIn: f32) -> vec3<f32> {
  let x = clamp(tIn, 0.0, 1.0) * 2.0;
  if (x < 1.0) {
    return mix(gColA, gColB, x);
  }
  return mix(gColB, gColC, x - 1.0);
}

fn surfaceMaterial(trap: f32, pos: vec3<f32>) -> Material {
  let tt = trapTone(trap);
  var albedo = gradient(tt);
  var rough = gMatP.x;
  if (gNoiseOn) {
    // Micro detail sticks to the surface (fractal space) and is applied at every path
    // vertex, so secondary bounces see the same material the camera does.
    let n = microNoise(toFractalSpace(pos));
    rough = clamp(rough + gFxB.x * n, 0.02, 1.0);
    albedo = albedo * clamp(1.0 + gFxB.y * n, 0.0, 2.0);
  }
  // Emission glows out of the deep/crevice end of the trap range.
  let glow = pow(clamp(1.0 - tt, 0.0, 1.0), 3.0);
  var emission = gEmission.rgb * (gEmission.w * glow);
  if (gGrowthOn) {
    // The undisplaced base distance separates growth from base: ~hitEps on the base
    // surface, approaching the growth length out on a protrusion tip.
    let baseD = baseDe(pos).x;
    let gm = smoothstep(0.12, 0.5, baseD / gGrowthP.x);
    albedo = mix(albedo, gGrowthC.rgb, gm * gGrowthQ.y);
    emission = emission + gGrowthC.rgb * (gGrowthQ.z * gm);
  }
  return Material(albedo, rough, gMatP.y, gMatP.z, gMatP.w, emission);
}

// Near-black studio fill: the references live on dark negative space (ADR-0003 look).
fn skyFill(dir: vec3<f32>) -> vec3<f32> {
  let up = dir.y * 0.5 + 0.5;
  return gAmbient * mix(vec3<f32>(0.55, 0.65, 1.0), vec3<f32>(1.1, 1.05, 1.0), up);
}

const PI: f32 = 3.14159265359;

// ---- Environment lighting (ADR-0009) ------------------------------------------------
// One skyRadiance() feeds transport, preview, and background so all three stay aligned.

fn dirToEnvUv(dir: vec3<f32>) -> vec2<f32> {
  let u = fract((atan2(dir.z, dir.x) - gEnvYaw) / TWO_PI + 0.5);
  let v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
  return vec2<f32>(u, v);
}

fn envUvToDir(uvIn: vec2<f32>) -> vec3<f32> {
  let phi = (uvIn.x - 0.5) * TWO_PI + gEnvYaw;
  let theta = uvIn.y * PI;
  let s = sin(theta);
  return vec3<f32>(s * cos(phi), cos(theta), s * sin(phi));
}

const ENV_RADIANCE_H: f32 = ${ENV_H}.0;
const ENV_ALIAS_W: u32 = ${GRID_W}u;
const ENV_ALIAS_H: u32 = ${GRID_H}u;
const ENV_ATLAS_H: f32 = ${ENV_ATLAS_H}.0;
const ENV_ALIAS_DIMS: vec2<u32> = vec2<u32>(ENV_ALIAS_W, ENV_ALIAS_H);

fn envRadianceAtlasUv(uvE: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    uvE.x,
    (clamp(uvE.y, 0.0, 1.0) * (ENV_RADIANCE_H - 1.0) + 0.5) / ENV_ATLAS_H,
  );
}

fn envMapRadiance(dir: vec3<f32>, envTex: texture_2d<f32>, envTexSampler: sampler) -> vec3<f32> {
  let uvE = dirToEnvUv(dir);
  return textureSampleLevel(envTex, envTexSampler, envRadianceAtlasUv(uvE), 0.0).rgb *
    gEnvIntensity;
}

// Perez five-coefficient distribution, vectorized over (Y, x, y).
fn perez(cosTheta: f32, gamma: f32, cosGamma: f32, t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.1787 * t - 1.4630, -0.0193 * t - 0.2592, -0.0167 * t - 0.2608);
  let b = vec3<f32>(-0.3554 * t + 0.4275, -0.0665 * t + 0.0008, -0.0950 * t + 0.0092);
  let c = vec3<f32>(-0.0227 * t + 5.3251, -0.0004 * t + 0.2125, -0.0079 * t + 0.2102);
  let d = vec3<f32>(0.1206 * t - 2.5771, -0.0641 * t - 0.8989, -0.0441 * t - 1.6537);
  let e = vec3<f32>(-0.0670 * t + 0.3703, -0.0033 * t + 0.0452, -0.0109 * t + 0.0529);
  let ct = max(cosTheta, 0.01);
  return (vec3<f32>(1.0) + a * exp(b / ct)) *
    (vec3<f32>(1.0) + c * exp(d * gamma) + e * (cosGamma * cosGamma));
}

// Brings Preetham's kcd/m2-scale zenith luminance into the scene's ~1.0 HDR units.
const PREETHAM_SCALE: f32 = 0.06;

// Analytic Preetham daylight dome. The sun disc is NOT part of the dome - the sun is an
// NEE-only cone light (same estimator shape as the Studio key light), except on primary
// miss where skyRadiance() draws the visible disc.
fn preethamSky(dir: vec3<f32>) -> vec3<f32> {
  let t = gTurbidity;
  let cosThetaS = clamp(gSunDir.y, 0.01, 1.0);
  let thetaS = acos(cosThetaS);

  let chi = (4.0 / 9.0 - t / 120.0) * (PI - 2.0 * thetaS);
  let yz = max((4.0453 * t - 4.9710) * tan(chi) - 0.2155 * t + 2.4192, 0.0);
  let t2 = t * t;
  let s = thetaS;
  let s2 = s * s;
  let s3 = s2 * s;
  let xz = t2 * (0.00166 * s3 - 0.00375 * s2 + 0.00209 * s) +
    t * (-0.02903 * s3 + 0.06377 * s2 - 0.03202 * s + 0.00394) +
    (0.11693 * s3 - 0.21196 * s2 + 0.06052 * s + 0.25886);
  let cz = t2 * (0.00275 * s3 - 0.00610 * s2 + 0.00317 * s) +
    t * (-0.04214 * s3 + 0.08970 * s2 - 0.04153 * s + 0.00516) +
    (0.15346 * s3 - 0.26756 * s2 + 0.06670 * s + 0.26688);

  // Sample direction, clamped to the horizon; below it the dome fades to a dim ground.
  let up = max(dir.y, 0.0);
  let cosGamma = clamp(dot(normalize(vec3<f32>(dir.x, up, dir.z)), gSunDir), -1.0, 1.0);
  let gamma = acos(cosGamma);

  let zenith = vec3<f32>(yz, xz, cz);
  let num = perez(up, gamma, cosGamma, t);
  let den = perez(1.0, thetaS, cosThetaS, t);
  let lum = zenith * num / max(den, vec3<f32>(1e-4));

  // Yxy -> XYZ -> linear sRGB.
  let yy = max(lum.z, 1e-4);
  let bigX = lum.x / yy * lum.y;
  let bigZ = lum.x / yy * (1.0 - lum.y - lum.z);
  let xyz = vec3<f32>(bigX, lum.x, bigZ);
  var rgb = vec3<f32>(
    dot(vec3<f32>(3.2406, -1.5372, -0.4986), xyz),
    dot(vec3<f32>(-0.9689, 1.8758, 0.0415), xyz),
    dot(vec3<f32>(0.0557, -0.2040, 1.0570), xyz),
  );
  rgb = max(rgb, vec3<f32>(0.0)) * PREETHAM_SCALE;
  let ground = mix(0.04, 1.0, smoothstep(-0.25, 0.0, dir.y));
  return rgb * ground;
}

// Visible sun disc, flux-normalized so shrinking the sun keeps total energy roughly
// constant. Primary rays only - surface illumination comes from the NEE cone sample.
fn sunDisc(dir: vec3<f32>) -> vec3<f32> {
  let cosCone = cos(gSunSize);
  if (dot(dir, gSunDir) < cosCone) {
    return vec3<f32>(0.0);
  }
  return gSunColor * gEnvIntensity * (0.08 / max(1.0 - cosCone, 1e-4));
}

fn skyRadiance(
  dir: vec3<f32>,
  primary: bool,
  envTex: texture_2d<f32>,
  envTexSampler: sampler,
) -> vec3<f32> {
  if (gEnvMode == 1) {
    var sky = preethamSky(dir) * gEnvIntensity;
    if (primary) {
      sky = sky + sunDisc(dir);
    }
    return sky;
  }
  if (gEnvMode == 2) {
    return envMapRadiance(dir, envTex, envTexSampler);
  }
  return skyFill(dir);
}

// Solid-angle pdf of the alias-table env sampler for an arbitrary direction; the table
// stores (prob, alias x/y, pdf) per grid cell, built CPU-side from the env map's luminance.
fn loadEnvAliasCell(
  cell: u32,
  envTex: texture_2d<f32>,
) -> vec4<f32> {
  let cx = cell % ENV_ALIAS_W;
  let cy = cell / ENV_ALIAS_W;
  return textureLoad(envTex, vec2<u32>(cx, ${ENV_H}u + cy), 0);
}

fn envPdf(dir: vec3<f32>, envTex: texture_2d<f32>) -> f32 {
  let uvE = dirToEnvUv(dir);
  let cx = min(u32(uvE.x * f32(ENV_ALIAS_W)), ENV_ALIAS_W - 1u);
  let cy = min(u32(uvE.y * f32(ENV_ALIAS_H)), ENV_ALIAS_H - 1u);
  return loadEnvAliasCell(cy * ENV_ALIAS_W + cx, envTex).a;
}

fn decodeEnvAliasCell(packed: vec4<f32>, dims: vec2<u32>) -> u32 {
  let ax = min(u32(round(clamp(packed.g, 0.0, 1.0) * f32(dims.x - 1u))), dims.x - 1u);
  let ay = min(u32(round(clamp(packed.b, 0.0, 1.0) * f32(dims.y - 1u))), dims.y - 1u);
  return ay * dims.x + ax;
}

// One alias-table draw: returns (direction, pdf). A single textureLoad, no binary search.
fn sampleEnvDir(envTex: texture_2d<f32>) -> vec4<f32> {
  let dims = ENV_ALIAS_DIMS;
  let n = dims.x * dims.y;
  var cell = min(u32(rndf() * f32(n)), n - 1u);
  let probe = loadEnvAliasCell(cell, envTex);
  if (rndf() > probe.r) {
    cell = decodeEnvAliasCell(probe, dims);
  }
  let cx = cell % dims.x;
  let cy = cell / dims.x;
  let pdf = loadEnvAliasCell(cell, envTex).a;
  let cellU = rnd2f();
  let uvE = vec2<f32>(
    (f32(cx) + cellU.x) / f32(dims.x),
    (f32(cy) + cellU.y) / f32(dims.y),
  );
  return vec4<f32>(envUvToDir(uvE), pdf);
}

fn f0FromIor(ior: f32) -> f32 {
  let r = (ior - 1.0) / (ior + 1.0);
  return r * r;
}

// Normalized Blinn lobe shared by NEE and the preview, so the two modes match.
fn evalBRDF(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, m: Material) -> vec3<f32> {
  let ndl = max(dot(n, l), 0.0);
  if (ndl <= 0.0) {
    return vec3<f32>(0.0);
  }
  let h = normalize(l + v);
  let ndh = max(dot(n, h), 0.0);
  let vdh = max(dot(v, h), 0.0);
  let f0 = f0FromIor(m.ior);
  let fres = f0 + (1.0 - f0) * pow(1.0 - vdh, 5.0);
  let r2 = max(m.roughness * m.roughness, 0.001);
  let shininess = 2.0 / (r2 * r2) - 2.0;
  let spec = m.specular * fres * (shininess + 2.0) / 8.0 * pow(ndh, shininess);
  // Thin-film tints only the specular lobe; preview and NEE share this kernel so the
  // iridescent response matches across modes automatically.
  return (m.albedo + spec * thinFilmTint(vdh)) * ndl;
}

// Shadow rays for directional lights (and the sky stand-ins) march this far before
// declaring the path clear; positional lights stop at the light itself instead.
const SHADOW_MAX_T: f32 = 20.0;

// A light resolved at a shading point: direction toward it, arriving radiance (falloff
// applied), apparent angular size for cone sampling, and the occlusion march limit.
struct LightInfo {
  l: vec3<f32>,
  radiance: vec3<f32>,
  angSize: f32,
  maxT: f32,
};

// Resolve light i at point p. Directional lights are the classic cone-at-infinity key;
// positional lights are invisible sphere lights with bounded inverse-square falloff
// f^2/(f^2+d^2) - never visible to bounce rays, so NEE here is the whole estimator and
// nothing double counts. The cone estimator is softness-only (no pdf division), the
// same energy convention the single key light always had: resizing never rescales.
fn lightAt(i: i32, p: vec3<f32>) -> LightInfo {
  let pd = gLightPosDir[i];
  let ci = gLightColInt[i];
  let geo = gLightGeo[i];
  if (pd.w < 0.5) {
    return LightInfo(pd.xyz, ci.rgb * ci.w, geo.x, SHADOW_MAX_T);
  }
  let toL = pd.xyz - p;
  let dist = max(length(toL), 1.0e-4);
  let f2 = geo.y * geo.y;
  let atten = f2 / (f2 + dist * dist);
  return LightInfo(
    toL / dist,
    ci.rgb * (ci.w * atten),
    clamp(geo.x / dist, 0.0, 1.0),
    max(dist - geo.x, 0.01),
  );
}

// Uniform direction in a cone of half-angle ~radius around dir (the area key light).
fn coneSample(dir: vec3<f32>, radius: f32) -> vec3<f32> {
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(dir.y) > 0.99) {
    up = vec3<f32>(1.0, 0.0, 0.0);
  }
  let tang = normalize(cross(up, dir));
  let bitang = cross(dir, tang);
  let coneU = rnd2f();
  let r = sqrt(coneU.x) * radius;
  let ang = TWO_PI * coneU.y;
  return normalize(dir + tang * (r * cos(ang)) + bitang * (r * sin(ang)));
}

fn cosineDir(n: vec3<f32>) -> vec3<f32> {
  let cosU = rnd2f();
  let u1 = cosU.x;
  let u2 = cosU.y;
  let r = sqrt(u1);
  let phi = TWO_PI * u2;
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(n.y) > 0.99) {
    up = vec3<f32>(1.0, 0.0, 0.0);
  }
  let tang = normalize(cross(up, n));
  let bitang = cross(n, tang);
  return normalize(tang * (r * cos(phi)) + bitang * (r * sin(phi)) + n * sqrt(max(0.0, 1.0 - u1)));
}

// Binary occlusion march for NEE shadow rays; softness comes from cone sampling.
// maxT stops the march at the light for positional sources (geometry beyond it
// cannot occlude); directional callers pass SHADOW_MAX_T.
fn shadowMarch(ro: vec3<f32>, rd: vec3<f32>, maxT: f32) -> f32 {
  var t = 0.01;
  for (var i = 0; i < 64; i = i + 1) {
    let h = de(ro + rd * t).x;
    if (h < gSurfEps) {
      return 0.0;
    }
    t = t + max(h, 0.004);
    if (t > maxT) {
      break;
    }
  }
  return 1.0;
}

// Analytic penumbra shadow for the preview; light size maps to softness.
fn softShadow(ro: vec3<f32>, rd: vec3<f32>, size: f32, maxT: f32) -> f32 {
  var res = 1.0;
  var t = 0.02;
  let k = 1.5 / max(size, 0.02);
  for (var i = 0; i < 48; i = i + 1) {
    let h = de(ro + rd * t).x;
    if (h < gSurfEps) {
      return 0.0;
    }
    res = min(res, k * h / t);
    t = t + clamp(h, 0.01, 0.3);
    if (t > maxT) {
      break;
    }
  }
  return clamp(res, 0.0, 1.0);
}

fn calcAO(p: vec3<f32>, n: vec3<f32>) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  // gAoScan == 5; opaque so the loop (and its de() copy) is not unrolled five-fold.
  for (var i = 1; i <= gAoScan; i = i + 1) {
    let hr = 0.01 + 0.12 * f32(i) / 5.0;
    let d = de(p + n * hr).x;
    occ = occ + (hr - d) * sca;
    sca = sca * 0.7;
  }
  return clamp(1.0 - 1.5 * occ, 0.0, 1.0);
}

// ---- Special effects --------------------------------------------------------------
// Fog density/height and glow radius are CAMERA-SPACE quantities: the dive controller
// re-bases so camera space stays O(1) at any depth, which reads as constant apparent
// atmosphere during an infinite zoom (fractal-space density would saturate to opaque).

fn hash31(p: vec3<f32>) -> f32 {
  var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  q = q + dot(q, q.yzx + vec3<f32>(33.33));
  return fract((q.x + q.y) * q.z);
}

// Trilinear corner blend as a rolled loop (weights are exact: mix at t=0/1 is exact in
// FP). Like the Worley scans, the opaque gCornerScan bound keeps FXC from unrolling -
// growth inlines this at every de() call site, where 8 unrolled hashes per call
// multiply into seconds of pipeline compile.
fn valueNoise(p: vec3<f32>) -> f32 {
  let ip = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  var acc = 0.0;
  for (var c = 0; c < gCornerScan; c = c + 1) {
    let o = vec3<f32>(f32(c & 1), f32((c >> 1) & 1), f32((c >> 2) & 1));
    let w = mix(vec3<f32>(1.0) - u, u, o);
    acc = acc + hash31(ip + o) * (w.x * w.y * w.z);
  }
  return acc;
}

// Two-octave micro detail with a fractional-octave crossfade tied to the dive scale:
// zooming shows ever-renewing surface texture with no popping (the blend is continuous
// in log2(freq / diveScale), and dive rebases already reset accumulation).
fn microNoise(fp: vec3<f32>) -> f32 {
  let o = log2(max(gFxA.w, 1.0) / max(gDiveScale, 1.0e-30));
  let fo = floor(o);
  let f1 = exp2(fo);
  let f2 = f1 * 2.0;
  let n1 = valueNoise(fp * f1) + 0.5 * valueNoise(fp * (f1 * 3.1));
  let n2 = valueNoise(fp * f2) + 0.5 * valueNoise(fp * (f2 * 3.1));
  return mix(n1, n2, o - fo) / 1.5 - 0.5;
}

// ---- Surface growth ----------------------------------------------------------------
// Procedural protrusions displaced out of the distance field (de() subtracts
// length * growthField). Length is camera-space and the frequency dive-rescales like
// microNoise, so growth keeps constant apparent scale during an infinite zoom.

fn hash33(p: vec3<f32>) -> vec3<f32> {
  var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
  q = q + dot(q, q.yxz + vec3<f32>(33.33));
  return fract((q.xxy + q.yxx) * q.zyx);
}

// Decode a flat 0..26 index into the (-1..1)^3 neighborhood offset. The flat loop with
// the opaque gCellScan bound (see the entry function) is what keeps FXC from unrolling.
fn cellOffset(i: i32) -> vec3<f32> {
  return vec3<f32>(f32(i / 9 - 1), f32((i / 3) % 3 - 1), f32(i % 3 - 1));
}

// F1 cellular distance (euclidean), 27-cell scan.
fn worleyF1(p: vec3<f32>) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  var best = 8.0;
  for (var i = 0; i < gCellScan; i = i + 1) {
    let g = cellOffset(i);
    let r = g + hash33(ip + g) - fp;
    best = min(best, dot(r, r));
  }
  return sqrt(best);
}

// Chebyshev-metric F1: cubic cells whose level sets are planes -> crystal facets.
fn worleyF1Cheb(p: vec3<f32>) -> f32 {
  let ip = floor(p);
  let fp = fract(p);
  var best = 8.0;
  for (var i = 0; i < gCellScan; i = i + 1) {
    let g = cellOffset(i);
    let r = abs(g + hash33(ip + g) - fp);
    best = min(best, max(r.x, max(r.y, r.z)));
  }
  return best;
}

// 0..1 protrusion profile for one octave. The mode branch is uniform-driven -> coherent.
fn growthPattern(q: vec3<f32>) -> f32 {
  let mode = i32(gGrowthQ.x);
  let sharp = gGrowthP.z;
  if (mode == 0) {
    // Spikes: sharpened cones around Worley cell centers.
    return pow(clamp(1.0 - worleyF1(q) * 1.4, 0.0, 1.0), sharp);
  }
  if (mode == 1) {
    // Bumps: smooth two-octave blobs; sharpness soft-pedaled so they stay organic.
    let n = valueNoise(q) + 0.4 * valueNoise(q * 2.3);
    return pow(clamp(n * 1.3 - 0.45, 0.0, 1.0), max(sharp * 0.5, 0.7));
  }
  if (mode == 2) {
    // Crystals: linear (unsmoothed) Chebyshev profile keeps planar facets.
    return clamp((1.0 - worleyF1Cheb(q) * 1.3) * (0.4 + 0.2 * sharp), 0.0, 1.0);
  }
  // Fins: anisotropic ridge bands, noise-warped so they read organic.
  let warp = valueNoise(q * 0.7) * 3.0;
  return pow(clamp(0.5 + 0.5 * sin(q.y * 4.0 + warp), 0.0, 1.0), sharp) *
    clamp(valueNoise(q * 0.31) * 2.0, 0.0, 1.0);
}

// Dive-rescaled growth field in 0..1: fractional-octave frequency crossfade (same
// scheme as microNoise), masked by low-frequency coverage noise and the orbit-trap
// placement bias (trap is free here - formulaDE already produced it).
fn growthField(fp: vec3<f32>, trap: f32) -> f32 {
  let o = log2(max(gGrowthP.y, 1.0) / max(gDiveScale, 1.0e-30));
  let fo = floor(o);
  let f1 = exp2(fo);
  // The octave crossfade mix(p(f1), p(2*f1), o-fo) as a rolled loop: one inline copy
  // of growthPattern per de() call site instead of two (compile time, see opaqueZero).
  var g = 0.0;
  for (var i = 0; i < gOctaveScan; i = i + 1) {
    let w = select(1.0 - (o - fo), o - fo, i == 1);
    g = g + growthPattern(fp * (f1 * f32(1 + i))) * w;
  }
  let cov = gGrowthP.w;
  if (cov < 0.999) {
    g = g * smoothstep(0.85 - cov, 1.05 - cov, valueNoise(fp * (f1 * 0.13)));
  }
  let bias = gGrowthC.w;
  if (abs(bias) > 0.001) {
    // Crevices sit at the low end of the trap tone (see surfaceMaterial's emission).
    let tt = trapTone(trap);
    let w = select(tt, 1.0 - tt, bias > 0.0);
    g = g * mix(1.0, smoothstep(0.15, 0.6, w), abs(bias));
  }
  return g;
}

// ---- Domain warp (ADR-0012) ----------------------------------------------------------
// Shape-side transforms applied to fractal space before the formula runs, composed
// twist -> bend -> ripple -> noise (domain maps invert object-side, so macro transforms
// read outermost over the detailed geometry). Each is written about a canonical axis;
// the self-inverse swizzles below select the user's axis. Keep the math in lockstep
// with the f64 mirror in src/fractal/warp.ts (the dive controller marches that).

// Map axis a onto canonical y (0: x<->y, 1: identity, 2: y<->z). Self-inverse.
fn warpSwzY(p: vec3<f32>, a: i32) -> vec3<f32> {
  if (a == 0) { return p.yxz; }
  if (a == 2) { return p.xzy; }
  return p;
}

// Map axis a onto canonical x (0: identity, 1: x<->y, 2: x<->z). Self-inverse.
fn warpSwzX(p: vec3<f32>, a: i32) -> vec3<f32> {
  if (a == 1) { return p.yxz; }
  if (a == 2) { return p.zyx; }
  return p;
}

fn warpFbm(q: vec3<f32>) -> f32 {
  return valueNoise(q) + 0.5 * valueNoise(q * 2.17);
}

fn warpDomain(fp: vec3<f32>) -> vec3<f32> {
  var q = fp;
  gWarpRT = 0.0;
  gWarpRB = 0.0;
  if (gWarpP.x != 0.0) {
    // Twist: rotate about the axis by angle proportional to position along it.
    let s = warpSwzY(q, gWarpAxT);
    gWarpRT = length(s.xz);
    let ang = gWarpP.x * s.y;
    let c = cos(ang);
    let sn = sin(ang);
    q = warpSwzY(vec3<f32>(c * s.x + sn * s.z, s.y, -sn * s.x + c * s.z), gWarpAxT);
  }
  if (gWarpP.y != 0.0) {
    // Bend (IQ cheap bend): rotate the (along, next) plane by angle k * along.
    let s = warpSwzX(q, gWarpAxB);
    gWarpRB = length(s.xy);
    let ang = gWarpP.y * s.x;
    let c = cos(ang);
    let sn = sin(ang);
    q = warpSwzX(vec3<f32>(c * s.x - sn * s.y, sn * s.x + c * s.y, s.z), gWarpAxB);
  }
  if (gWarpP.z > 0.0) {
    // Ripple: sinusoidal displacement of the axis from the transverse plane.
    let s = warpSwzY(q, gWarpAxR);
    let dy = gWarpP.z * sin(gWarpP.w * s.x) * sin(gWarpP.w * s.z);
    q = warpSwzY(vec3<f32>(s.x, s.y + dy, s.z), gWarpAxR);
  }
  if (gWarpQ.x > 0.0) {
    // Noise warp: FBM domain offset, fully procedural. Offsets decorrelate components.
    let s = q * gWarpQ.y;
    let n = vec3<f32>(
      warpFbm(s),
      warpFbm(s + vec3<f32>(19.7, 7.3, 11.1)),
      warpFbm(s + vec3<f32>(5.1, 27.9, 13.7)),
    ) - vec3<f32>(0.75);
    q = q + gWarpQ.x * n;
  }
  return q;
}

// Local Lipschitz bound of the warp around the sample warpDomain just transformed:
// constant ripple*noise part (gWarpQ.z, CPU-precomputed) times the per-point twist
// (1 + |k| r) and bend (1 + |k| r) factors. Radii are inflated by the raw formula
// distance dF so the bound holds over the entire sphere-trace step (the step in
// warp-input space is at most dF, and both factors are non-decreasing in r). Both use
// the conservative triangle-inequality form; the tighter sqrt(1 + k^2 r^2) is not a true
// bound for twist's operator norm and would let the march overstep twisted thin features.
fn warpLipschitz(dF: f32) -> f32 {
  var l = gWarpQ.z;
  if (gWarpP.x != 0.0) {
    l = l * (1.0 + abs(gWarpP.x) * (gWarpRT + dF));
  }
  if (gWarpP.y != 0.0) {
    l = l * (1.0 + abs(gWarpP.y) * (gWarpRB + dF));
  }
  return l;
}

// Thin-film interference tint on the specular lobe. Film IOR is fixed at 1.4; the
// thickness slider (fxA.y in 0..1) maps to ~100..1000nm. Clamped <= 1 so interference
// never adds energy (sacrifices the physically real >1 peaks, safe with accumulation).
fn thinFilmTint(cosTheta: f32) -> vec3<f32> {
  if (gFxA.x <= 0.0) {
    return vec3<f32>(1.0);
  }
  let nf = 1.4;
  let thickness = 100.0 + 900.0 * clamp(gFxA.y, 0.0, 1.0);
  let sin2 = (1.0 - cosTheta * cosTheta) / (nf * nf);
  let cosT = sqrt(max(1.0 - sin2, 0.0));
  let opd = 2.0 * nf * thickness * cosT;
  // Phase per channel at representative wavelengths; pi shift for the denser-film face.
  let phase = vec3<f32>(opd / 650.0, opd / 550.0, opd / 440.0) * TWO_PI + vec3<f32>(PI);
  let t = vec3<f32>(0.5) + 0.5 * cos(phase);
  return mix(vec3<f32>(1.0), clamp(t, vec3<f32>(0.0), vec3<f32>(1.0)), gFxA.x);
}

// Rim light: a deterministic primary-hit stylization (identical in preview and path
// trace, converges instantly, cannot firefly). Tinted toward the active environment.
fn rimTerm(n: vec3<f32>, v: vec3<f32>) -> vec3<f32> {
  if (gFxA.z <= 0.0) {
    return vec3<f32>(0.0);
  }
  let rim = pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 3.0);
  var lightCol = vec3<f32>(1.0);
  if (gDomLight >= 0) {
    lightCol = gLightColInt[gDomLight].rgb;
  }
  var tint = lightCol;
  if (gEnvMode == 1) {
    tint = mix(lightCol, gSunColor, 0.5);
  } else if (gEnvMode == 2) {
    tint = mix(lightCol, gEnvDomColor, 0.5);
  }
  return tint * (rim * gFxA.z);
}

fn glowTint(trap: f32) -> vec3<f32> {
  if (gGlowP.z > 0.5) {
    return gradient(trapTone(trap));
  }
  return gGlowColor;
}

// Exponential height fog: sigma_t(p) = density * exp(-falloff * (p.y - base)).
// Optical depth along o + d*s has the closed form B*(1 - exp(-a*s))/a with a = k*d.y.
fn fogOpticalDepth(o: vec3<f32>, d: vec3<f32>, s: f32) -> f32 {
  let k = gFogP.y;
  let a = k * d.y;
  let b = gFogP.x * exp(clamp(-k * (o.y - gFogP.z), -30.0, 30.0));
  if (abs(a) < 1.0e-4) {
    return b * s;
  }
  // exp() may overflow to inf for long downward rays; the min() below absorbs it.
  return min(b * (1.0 - exp(-a * s)) / a, 60.0);
}

fn fogTransmittance(o: vec3<f32>, d: vec3<f32>, s: f32) -> f32 {
  return exp(-fogOpticalDepth(o, d, s));
}

// Inverse-CDF distance sample in [0, s], pdf(t) proportional to sigma_t(t) * T(t).
// Normalized to the segment so every draw lands inside it.
fn sampleFogT(o: vec3<f32>, d: vec3<f32>, s: f32, u: f32) -> f32 {
  let k = gFogP.y;
  let a = k * d.y;
  let b = max(gFogP.x * exp(clamp(-k * (o.y - gFogP.z), -30.0, 30.0)), 1.0e-7);
  let tauS = fogOpticalDepth(o, d, s);
  let tauT = -log(max(1.0 - u * (1.0 - exp(-tauS)), 1.0e-7));
  if (abs(a) < 1.0e-4) {
    return clamp(tauT / b, 0.0, s);
  }
  let x = 1.0 - a * tauT / b;
  if (x <= 1.0e-6) {
    return s;
  }
  return clamp(-log(x) / a, 0.0, s);
}

// Henyey-Greenstein phase; gFogP.w is g. Multiplied by 4*pi at the call sites so the
// isotropic case (g = 0) is exactly 1.
fn henyeyGreenstein(cosTheta: f32) -> f32 {
  let g = gFogP.w;
  let g2 = g * g;
  let denom = max(1.0 + g2 - 2.0 * g * cosTheta, 1.0e-4);
  return (1.0 - g2) / (4.0 * PI * denom * sqrt(denom));
}

// Single-scatter NEE from ONE transmittance-proportional point on the segment. The
// sigma_s/sigma_t ratio cancels against the pdf, leaving fogAlbedo * (1 - T(s)) *
// phase * vis * L - unbiased for single scattering, and the path direction never
// changes so the surface MIS bookkeeping is untouched. Known accepted bias: the
// shadow ray itself is not fog-attenuated (invisible at sane densities, half the cost).
fn fogInScatter(o: vec3<f32>, d: vec3<f32>, sIn: f32) -> vec3<f32> {
  let s = min(sIn, 100.0);
  let scatterW = 1.0 - fogTransmittance(o, d, s);
  if (scatterW < 1.0e-5) {
    return vec3<f32>(0.0);
  }

  var envDir = vec3<f32>(0.0, 1.0, 0.0);
  var envCol = vec3<f32>(0.0);
  if (gEnvMode == 1) {
    envDir = gSunDir;
    envCol = gSunColor * gEnvIntensity;
  } else if (gEnvMode == 2) {
    envDir = gEnvDomDir;
    envCol = gEnvDomColor * gEnvIntensity;
  }
  // Cost control: of the user lights only the dominant one casts shafts. Picked before
  // the distance draw so the rndf order matches the single-key-light original.
  let hasKey = gDomLight >= 0;
  let hasEnv = max(envCol.x, max(envCol.y, envCol.z)) > 0.0;
  if (!hasKey && !hasEnv) {
    return vec3<f32>(0.0);
  }
  // One shadow march per segment: pick light vs environment stand-in 50/50 (x2 weight).
  var w = 1.0;
  var pickEnv = !hasKey;
  if (hasKey && hasEnv) {
    w = 2.0;
    pickEnv = rndf() < 0.5;
  }

  let t = sampleFogT(o, d, s, rndf());
  let sp = o + d * t;
  var lDir = envDir;
  var lCol = envCol;
  var lSize = gSunSize;
  var lMaxT = SHADOW_MAX_T;
  if (!pickEnv) {
    let info = lightAt(gDomLight, sp);
    lDir = info.l;
    lCol = info.radiance;
    lSize = info.angSize;
    lMaxT = info.maxT;
  }
  let l = coneSample(lDir, lSize);
  let vis = shadowMarch(sp, l, lMaxT);
  if (vis < 0.5) {
    return vec3<f32>(0.0);
  }
  let phase = henyeyGreenstein(dot(d, l)) * 4.0 * PI;
  return gFogC.rgb * (gFogC.w * scatterW * phase * w) * lCol;
}

// Preview stand-in for fogInScatter: deterministic (no shimmer while orbiting), one
// soft shadow at the median scatter depth standing in for the whole segment. When both
// light rigs are active only the dominant one is shadowed - preview-only bias.
fn fogInScatterPreview(o: vec3<f32>, d: vec3<f32>, sIn: f32) -> vec3<f32> {
  let s = min(sIn, 100.0);
  let scatterW = 1.0 - fogTransmittance(o, d, s);
  if (scatterW < 1.0e-5) {
    return vec3<f32>(0.0);
  }
  let tMed = sampleFogT(o, d, s, 0.5);
  let sp = o + d * tMed;
  // Dominant user light resolved at the median scatter point (positional lights have
  // position-dependent direction and falloff).
  var keyDir = vec3<f32>(0.0, 1.0, 0.0);
  var keyCol = vec3<f32>(0.0);
  var keySize = 0.05;
  var keyMaxT = SHADOW_MAX_T;
  if (gDomLight >= 0) {
    let info = lightAt(gDomLight, sp);
    keyDir = info.l;
    keyCol = info.radiance;
    keySize = info.angSize;
    keyMaxT = info.maxT;
  }
  var envDir = vec3<f32>(0.0, 1.0, 0.0);
  var envCol = vec3<f32>(0.0);
  if (gEnvMode == 1) {
    envDir = gSunDir;
    envCol = gSunColor * gEnvIntensity;
  } else if (gEnvMode == 2) {
    envDir = gEnvDomDir;
    envCol = gEnvDomColor * gEnvIntensity;
  }
  let lumW = vec3<f32>(0.2126, 0.7152, 0.0722);
  let keyLum = dot(keyCol, lumW);
  let envLum = dot(envCol, lumW);
  if (keyLum + envLum < 1.0e-6) {
    return vec3<f32>(0.0);
  }
  var domDir = keyDir;
  var domSize = max(keySize, 0.05);
  var domMaxT = keyMaxT;
  if (envLum > keyLum) {
    domDir = envDir;
    domSize = max(gSunSize, 0.05);
    domMaxT = SHADOW_MAX_T;
  }
  let vis = softShadow(sp, domDir, domSize, domMaxT);
  let keyPhase = henyeyGreenstein(dot(d, keyDir)) * 4.0 * PI;
  let envPhase = henyeyGreenstein(dot(d, envDir)) * 4.0 * PI;
  var inScatter = keyCol * (keyPhase * vis) + envCol * envPhase;
  if (envLum > keyLum) {
    inScatter = keyCol * keyPhase + envCol * (envPhase * vis);
  }
  return gFogC.rgb * (gFogC.w * scatterW) * inScatter;
}

fn pathTrace(
  roIn: vec3<f32>,
  rdIn: vec3<f32>,
  envTex: texture_2d<f32>,
  envTexSampler: sampler,
) -> vec3<f32> {
  var throughput = vec3<f32>(1.0);
  var radiance = vec3<f32>(0.0);
  var o = roIn;
  var d = rdIn;
  // MIS bookkeeping (envmap mode): solid-angle pdf of the previous bounce direction.
  // Delta-ish lobes (specular, transmission) have no matching NEE strategy, so their
  // miss contribution keeps full weight.
  var prevPdf = 0.0;
  var prevDiffuse = false;
  for (var b = 0; b < MAX_BOUNCES; b = b + 1) {
    let h = march(o, d);
    if (gGlowOn && b == 0) {
      // Aura: deterministic primary-ray add (uses its own per-step fog attenuation).
      // 1-exp() soft-saturates the integral so dense regions cannot blow past the
      // strength; surface pixels are damped so the halo reads against negative space
      // (surfaces already glow via emission).
      let halo = 1.0 - exp(-h.glow);
      let gw = select(0.35, 1.0, h.hit < 0.5);
      radiance = radiance + glowTint(h.glowTrap) * (gGlowP.x * halo * gw);
      gGlowArm = false;
    }
    if (gFogOn) {
      let segLen = min(h.t, gMaxDist);
      // In-scatter on the primary and first bounce segments only; deeper segments
      // contribute noise, not light. Goes through the standard indirect clamp.
      if (gFogC.w > 0.0 && b < 2) {
        radiance = radiance + clampIndirect(throughput * fogInScatter(o, d, segLen), b);
      }
      // Attenuate BEFORE this vertex's emission/sky/NEE adds, so everything beyond
      // the segment is correctly absorbed - including the env-MIS miss term below.
      throughput = throughput * fogTransmittance(o, d, segLen);
    }
    if (h.hit < 0.5) {
      var sky = skyRadiance(d, b == 0, envTex, envTexSampler);
      if (gEnvMode == 2 && prevDiffuse) {
        // Balance heuristic against the env NEE draw that covered this hemisphere.
        sky = sky * (prevPdf / max(prevPdf + envPdf(d, envTex), 1e-6));
      }
      radiance = radiance + clampIndirect(throughput * sky, b);
      break;
    }
    let n = calcNormal(h.pos, h.t);
    let m = surfaceMaterial(h.trap, h.pos);
    radiance = radiance + clampIndirect(throughput * m.emission, b);
    if (b == 0) {
      radiance = radiance + throughput * rimTerm(n, -d);
    }

    // Direct light via NEE: one cone-sampled shadow ray shared across the user
    // lights. A single light is chosen per vertex proportional to its luminance *
    // intensity and the contribution weighted by 1/pmf - the same estimator in
    // expectation as marching every light, at one shadowMarch instead of up to
    // four. With a single enabled light no selection randomness is consumed and
    // pmf is 1, so 1-light looks consume rnd2f in the same order they always did
    // (pixel-identical legacy renders; coneSample also stays ahead of the dot
    // test for that reason). Multi-light looks trade a little extra variance for
    // up to 4x fewer shadow marches per vertex.
    if (gLightLive > 0) {
      var lr = 0.0;
      if (gLightLive > 1) {
        lr = rndf() * gLightWeightSum;
      }
      var pick = 0;
      var acc = 0.0;
      for (var li = 0; li < gLightCount; li = li + 1) {
        if (gLightWeight[li] <= 0.0) {
          continue;
        }
        acc = acc + gLightWeight[li];
        pick = li;
        if (lr < acc) {
          break;
        }
      }
      let pmf = select(1.0, gLightWeight[pick] / gLightWeightSum, gLightLive > 1);
      let info = lightAt(pick, h.pos);
      let l = coneSample(info.l, info.angSize);
      if (dot(n, l) > 0.0) {
        let vis = shadowMarch(h.pos + n * (hitEps(h.t) * 3.0), l, info.maxT);
        if (vis > 0.0) {
          let nee = throughput * info.radiance * evalBRDF(n, -d, l, m) * (1.0 / pmf);
          radiance = radiance + clampIndirect(nee, b);
        }
      }
    }

    // Environment direct light (ADR-0009).
    if (gEnvMode == 1) {
      // Preetham sun: NEE-only cone light, the same estimator shape as the key light
      // (the dome never returns the disc on bounce rays, so nothing double counts).
      let l = coneSample(gSunDir, gSunSize);
      if (dot(n, l) > 0.0) {
        let vis = shadowMarch(h.pos + n * (hitEps(h.t) * 3.0), l, SHADOW_MAX_T);
        if (vis > 0.0) {
          let nee = throughput * gSunColor * gEnvIntensity * evalBRDF(n, -d, l, m);
          radiance = radiance + clampIndirect(nee, b);
        }
      }
    } else if (gEnvMode == 2) {
      // Env map: one alias-table draw, MIS-weighted against the cosine bounce. Diffuse
      // response only - specular env response comes from bounce rays, which see the
      // map exactly (NEE'ing the spec lobe here would double count it).
      let es = sampleEnvDir(envTex);
      let l = es.xyz;
      let ndl = dot(n, l);
      if (ndl > 0.0 && es.w > 1e-6) {
        let vis = shadowMarch(h.pos + n * (hitEps(h.t) * 3.0), l, SHADOW_MAX_T);
        if (vis > 0.0) {
          let pdfCos = ndl / PI;
          let w = es.w / (es.w + pdfCos);
          let f = m.albedo * (ndl / PI);
          let nee = throughput * envMapRadiance(l, envTex, envTexSampler) * f * (w / es.w);
          radiance = radiance + clampIndirect(nee, b);
        }
      }
    }

    // Bounce: fresnel-weighted specular vs transmission vs diffuse.
    let cosV = max(dot(n, -d), 0.0);
    let f0 = f0FromIor(m.ior);
    let fres = f0 + (1.0 - f0) * pow(1.0 - cosV, 5.0);
    let pSpec = clamp(m.specular * fres, 0.0, 0.9);
    let u = rndf();
    let off = hitEps(h.t) * 3.0;
    if (u < pSpec) {
      // Dielectric reflection blurred by roughness; thin-film tints it so environment
      // reflections shift spectrally with the view angle.
      var refl = normalize(mix(reflect(d, n), cosineDir(n), m.roughness * m.roughness));
      if (dot(refl, n) <= 0.0) {
        refl = cosineDir(n);
      }
      throughput = throughput * thinFilmTint(cosV);
      d = refl;
      o = h.pos + n * off;
      prevDiffuse = false;
    } else if (u < pSpec + (1.0 - pSpec) * m.translucency) {
      // Diffuse transmission: carry tinted light through thin structure.
      throughput = throughput * m.albedo;
      d = cosineDir(-n);
      o = h.pos - n * off;
      prevDiffuse = false;
    } else {
      throughput = throughput * m.albedo;
      d = cosineDir(n);
      o = h.pos + n * off;
      prevDiffuse = true;
      prevPdf = max(dot(n, d), 0.0) / PI;
    }

    // Russian roulette, deferred to deep bounces with a high survival floor: a low floor
    // turns 1/pCont into large multipliers on dark paths - fireflies in the shadows.
    if (b >= 3) {
      let pCont = clamp(max(throughput.x, max(throughput.y, throughput.z)), 0.25, 0.95);
      if (rndf() > pCont) {
        break;
      }
      throughput = throughput / pCont;
    }
  }
  return radiance;
}

// Preview: one march shaped to approximate the converged path trace - same sky, same
// key light and BRDF as NEE, AO standing in for occlusion, a small single-bounce term
// standing in for indirect transport. Environment direct light is approximated by the
// Preetham sun or the env map's CPU-derived dominant direction through the same soft shadow.
fn previewShade(
  ro: vec3<f32>,
  rd: vec3<f32>,
  envTex: texture_2d<f32>,
  envTexSampler: sampler,
) -> vec3<f32> {
  let h = march(ro, rd);
  var glowAdd = vec3<f32>(0.0);
  if (gGlowOn) {
    // Same soft saturation + surface damping as the path tracer (exact parity).
    let halo = 1.0 - exp(-h.glow);
    let gw = select(0.35, 1.0, h.hit < 0.5);
    glowAdd = glowTint(h.glowTrap) * (gGlowP.x * halo * gw);
  }
  if (h.hit < 0.5) {
    var sky = skyRadiance(rd, true, envTex, envTexSampler);
    if (gFogOn) {
      let segLen = min(h.t, gMaxDist);
      sky = sky * fogTransmittance(ro, rd, segLen) + fogInScatterPreview(ro, rd, segLen);
    }
    return sky + glowAdd;
  }
  let n = calcNormal(h.pos, h.t);
  let m = surfaceMaterial(h.trap, h.pos);
  let ao = calcAO(h.pos, n);
  let shadowOrigin = h.pos + n * (hitEps(h.t) * 3.0);

  var direct = vec3<f32>(0.0);
  for (var li = 0; li < gLightCount; li = li + 1) {
    if (gLightColInt[li].w <= 0.0) {
      continue;
    }
    let info = lightAt(li, h.pos);
    let vis = softShadow(shadowOrigin, info.l, max(info.angSize, 0.02), info.maxT);
    direct = direct + info.radiance * vis * evalBRDF(n, -rd, info.l, m);
  }

  // Bounce stand-in for indirect transport: color bleeding happens on the LIT hemisphere
  // (light-facing crevasses glow with light bounced off neighbours), so follow the
  // dominant light and only partially attenuate by AO - fully AO-darkened bounce reads
  // too dark in pits.
  var bounce = vec3<f32>(0.0);
  if (gDomLight >= 0) {
    let dom = lightAt(gDomLight, h.pos);
    let wrap = 0.25 + 0.75 * clamp(dot(n, dom.l) * 0.5 + 0.5, 0.0, 1.0);
    bounce = dom.radiance * (0.1 * wrap) * (0.45 + 0.55 * ao);
  }

  // Environment terms: a flat-irradiance ambient (exact-ish for smooth domes, the map
  // average for env maps) plus one soft-shadowed directional stand-in for env NEE.
  var envAmbient = skyFill(n) * 2.0;
  var envDirect = vec3<f32>(0.0);
  if (gEnvMode == 1) {
    envAmbient = preethamSky(n) * gEnvIntensity;
    // No gSunDir.y > 0 gate: the path trace doesn't gate either (preethamSunColor clamps
    // elevation to 0.5deg), so gating here only would diverge if the sun ever dropped below
    // the horizon. The UI floors elevation at 2deg today, so this is parity + future-proofing.
    let sunVis = softShadow(shadowOrigin, gSunDir, gSunSize, SHADOW_MAX_T);
    envDirect = gSunColor * gEnvIntensity * sunVis * evalBRDF(n, -rd, gSunDir, m);
  } else if (gEnvMode == 2) {
    envAmbient = gEnvAvgColor * gEnvIntensity;
    let domVis = softShadow(shadowOrigin, gEnvDomDir, gSunSize, SHADOW_MAX_T);
    envDirect = gEnvDomColor * gEnvIntensity * domVis * evalBRDF(n, -rd, gEnvDomDir, m);
  }

  let indirect = m.albedo * (envAmbient * ao + bounce);
  var col = m.emission + rimTerm(n, -rd) + direct + envDirect + indirect;
  if (gFogOn) {
    col = col * fogTransmittance(ro, rd, h.t) + fogInScatterPreview(ro, rd, h.t);
  }
  return col + glowAdd;
}

${formulaDE}
`;
}

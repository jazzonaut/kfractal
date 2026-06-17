<script setup lang="ts">
import ParamSlider from "../ParamSlider.vue";
import ColorParam from "../ColorParam.vue";
import { useController } from "../../composables/use-controller";

const controller = useController();
const state = controller.state;
</script>

<template>
  <ParamSlider
    label="Roughness"
    :min="0.02"
    :max="1"
    :step="0.01"
    :model-value="state.roughness"
    description="Surface microroughness. Low is mirror-like; high is matte."
    testid="param-roughness"
    @update:model-value="controller.setMaterialParam('roughness', $event)"
  />
  <ParamSlider
    label="Specular"
    :min="0"
    :max="1"
    :step="0.01"
    :model-value="state.specular"
    description="Strength of specular (highlight) reflections."
    testid="param-specular"
    @update:model-value="controller.setMaterialParam('specular', $event)"
  />
  <ParamSlider
    label="Translucency"
    :min="0"
    :max="0.9"
    :step="0.01"
    :model-value="state.translucency"
    description="How much light passes through the surface, for a waxy, subsurface look."
    testid="param-translucency"
    @update:model-value="controller.setMaterialParam('translucency', $event)"
  />
  <ParamSlider
    label="IOR"
    :min="1"
    :max="2.5"
    :step="0.01"
    :model-value="state.ior"
    description="Index of refraction - controls Fresnel reflectivity and how strongly light bends through the surface."
    testid="param-ior"
    @update:model-value="controller.setMaterialParam('ior', $event)"
  />
  <ParamSlider
    label="Refraction"
    :min="0"
    :max="1"
    :step="0.01"
    :model-value="state.refraction"
    description="Glass transmission - light bends through the surface by the IOR instead of scattering. 0 is opaque. (Path-trace render only.)"
    testid="param-refraction"
    @update:model-value="controller.setMaterialParam('refraction', $event)"
  />
  <ParamSlider
    label="Dispersion"
    :min="0"
    :max="0.3"
    :step="0.005"
    :model-value="state.dispersion"
    description="Prismatic spread - splits refracted light into colours by bending each wavelength differently. Needs Refraction above 0."
    testid="param-dispersion"
    @update:model-value="controller.setMaterialParam('dispersion', $event)"
  />
  <ParamSlider
    label="Emission"
    :min="0"
    :max="8"
    :step="0.05"
    :model-value="state.emissionStrength"
    description="Self-illumination strength - makes the surface glow on its own."
    testid="param-emission"
    @update:model-value="controller.setMaterialParam('emissionStrength', $event)"
  />
  <ColorParam
    label="Emission color"
    :model-value="state.emissionColor"
    description="Colour of the surface's self-illumination."
    testid="param-emission-color"
    @update:model-value="controller.setEmissionColor($event)"
  />

  <div class="mt-3 border-t border-white/10 pt-3">
    <p class="pb-1 text-xs font-semibold text-muted-color">Spatial colour</p>
    <ParamSlider
      label="Triplanar"
      :min="0"
      :max="1"
      :step="0.01"
      :model-value="state.triplanarAmount"
      description="Position-driven hue variation blended into the palette, so colour reads across the structure instead of one flat band per orbit-trap value. 0 is off."
      testid="param-triplanar-amount"
      @update:model-value="controller.setMaterialParam('triplanarAmount', $event)"
    />
    <ParamSlider
      label="Triplanar scale"
      :min="0.05"
      :max="12"
      :step="0.05"
      :model-value="state.triplanarScale"
      description="Feature size of the triplanar colour variation - higher is finer."
      testid="param-triplanar-scale"
      @update:model-value="controller.setMaterialParam('triplanarScale', $event)"
    />
    <ParamSlider
      label="Cavity colour"
      :min="-1"
      :max="1"
      :step="0.01"
      :model-value="state.cavityShift"
      description="Shifts the palette in occluded recesses, so crevices read a different colour from exposed ridges. The Mandelbulber crevice/ridge split."
      testid="param-cavity-shift"
      @update:model-value="controller.setMaterialParam('cavityShift', $event)"
    />
    <ParamSlider
      label="Cavity rough"
      :min="-1"
      :max="1"
      :step="0.01"
      :model-value="state.cavityRoughness"
      description="Occlusion nudges roughness - matte recesses with glossy ridges, or the reverse."
      testid="param-cavity-roughness"
      @update:model-value="controller.setMaterialParam('cavityRoughness', $event)"
    />
  </div>

  <div class="mt-3 border-t border-white/10 pt-3">
    <p class="pb-1 text-xs font-semibold text-muted-color">Surface detail</p>
    <ParamSlider
      label="Iridescence"
      :min="0"
      :max="1"
      :step="0.01"
      :model-value="state.iridescence"
      description="Thin-film interference - soap-bubble colours that shift with the viewing angle."
      testid="param-iridescence"
      @update:model-value="controller.setSurfaceFxParam('iridescence', $event)"
    />
    <ParamSlider
      label="Film shift"
      :min="0"
      :max="1"
      :step="0.01"
      :model-value="state.filmShift"
      description="Hue offset of the iridescent thin film."
      testid="param-film-shift"
      @update:model-value="controller.setSurfaceFxParam('filmShift', $event)"
    />
    <ParamSlider
      label="Rim light"
      :min="0"
      :max="2"
      :step="0.02"
      :model-value="state.rimStrength"
      description="Brightens grazing-angle edges to separate the form from the background."
      testid="param-rim-strength"
      @update:model-value="controller.setSurfaceFxParam('rimStrength', $event)"
    />
    <ParamSlider
      label="Detail scale"
      :min="1"
      :max="60"
      :step="0.5"
      :model-value="state.microNoiseScale"
      description="Frequency of the procedural micro-surface noise - higher is finer texture."
      testid="param-micro-scale"
      @update:model-value="controller.setSurfaceFxParam('microScale', $event)"
    />
    <ParamSlider
      label="Detail rough"
      :min="0"
      :max="1"
      :step="0.01"
      :model-value="state.microNoiseRoughness"
      description="How strongly the micro-surface noise perturbs roughness."
      testid="param-micro-roughness"
      @update:model-value="controller.setSurfaceFxParam('microRoughness', $event)"
    />
    <ParamSlider
      label="Cavity AO"
      :min="0"
      :max="1"
      :step="0.01"
      :model-value="state.aoStrength"
      description="Darkens crevices for crisp, etched depth - the Mandelbulb3D look. 0 is off."
      testid="param-ao-strength"
      @update:model-value="controller.setSurfaceFxParam('aoStrength', $event)"
    />
    <ParamSlider
      label="Edge emphasis"
      :min="0"
      :max="1"
      :step="0.01"
      :model-value="state.aoEmphasis"
      description="Darkens intricate, grazing-angle silhouette detail to outline the lacework."
      testid="param-ao-emphasis"
      @update:model-value="controller.setSurfaceFxParam('aoEmphasis', $event)"
    />
  </div>
</template>

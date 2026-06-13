<script setup lang="ts">
import ParamSlider from "../ParamSlider.vue";
import { useController } from "../../composables/use-controller";

const controller = useController();
const state = controller.state;
</script>

<template>
  <ParamSlider
    label="Exposure"
    :min="0.35"
    :max="2.2"
    :step="0.01"
    :model-value="state.exposure"
    description="Overall image brightness before tone mapping."
    testid="param-exposure"
    @update:model-value="controller.setExposure($event)"
  />
  <ParamSlider
    label="Contrast"
    :min="0.6"
    :max="1.8"
    :step="0.01"
    :model-value="state.contrast"
    description="Separation between shadows and highlights."
    testid="param-contrast"
    @update:model-value="controller.setContrast($event)"
  />
  <ParamSlider
    label="Saturation"
    :min="0"
    :max="1.6"
    :step="0.01"
    :model-value="state.saturation"
    description="Colour intensity. 0 is greyscale; above 1 is punchier."
    testid="param-saturation"
    @update:model-value="controller.setSaturation($event)"
  />
  <ParamSlider
    label="Bloom"
    :min="0"
    :max="1.4"
    :step="0.01"
    :model-value="state.bloomStrength"
    description="Strength of the soft halo that bleeds from bright areas."
    testid="param-bloom-strength"
    @update:model-value="controller.setBloomStrength($event)"
  />
  <ParamSlider
    label="Bloom radius"
    :min="0"
    :max="1"
    :step="0.01"
    :model-value="state.bloomRadius"
    description="How far the bloom halo spreads from its source."
    testid="param-bloom-radius"
    @update:model-value="controller.setBloomRadius($event)"
  />
  <ParamSlider
    label="Bloom cutoff"
    :min="0"
    :max="1.5"
    :step="0.01"
    :model-value="state.bloomThreshold"
    description="Brightness threshold above which pixels start to bloom."
    testid="param-bloom-threshold"
    @update:model-value="controller.setBloomThreshold($event)"
  />
  <ParamSlider
    label="Vignette"
    :min="0"
    :max="1"
    :step="0.01"
    :model-value="state.vignetteStrength"
    description="Strength of the darkening toward the frame corners."
    testid="param-vignette"
    @update:model-value="controller.setPostFxParam('vignetteStrength', $event)"
  />
  <ParamSlider
    label="Vignette edge"
    :min="0.05"
    :max="1"
    :step="0.01"
    :model-value="state.vignetteSoftness"
    description="Softness of the vignette falloff - low is a hard edge, high fades gradually."
    testid="param-vignette-softness"
    @update:model-value="controller.setPostFxParam('vignetteSoftness', $event)"
  />
  <ParamSlider
    label="Grain"
    :min="0"
    :max="0.25"
    :step="0.005"
    :model-value="state.grainStrength"
    description="Amount of film-grain noise added to the final image."
    testid="param-grain"
    @update:model-value="controller.setPostFxParam('grainStrength', $event)"
  />
</template>

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
</template>

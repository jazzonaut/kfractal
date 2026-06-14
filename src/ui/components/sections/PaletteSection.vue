<script setup lang="ts">
import SelectButton from "primevue/selectbutton";
import ParamSlider from "../ParamSlider.vue";
import GradientStops from "../GradientStops.vue";
import { useController } from "../../composables/use-controller";
import type { RampColorSpace, RampInterpolation } from "../../../fractal/types";

const controller = useController();
const state = controller.state;

const interpolationOptions: { label: string; value: RampInterpolation }[] = [
  { label: "Linear", value: "linear" },
  { label: "Smooth", value: "smooth" },
  { label: "Stepped", value: "stepped" },
];

const colorSpaceOptions: { label: string; value: RampColorSpace }[] = [
  { label: "RGB", value: "rgb" },
  { label: "OKLab", value: "oklab" },
];
</script>

<template>
  <GradientStops />
  <div class="mt-1 flex flex-wrap items-center justify-between gap-2 py-1.5">
    <SelectButton
      v-tooltip.left="'How adjacent stops blend: Linear, eased (Smooth), or hard bands (Stepped).'"
      :model-value="state.paletteInterpolation"
      :options="interpolationOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      data-testid="param-palette-interpolation"
      @update:model-value="controller.setPaletteInterpolation($event)"
    />
    <SelectButton
      v-tooltip.left="
        'Colour space the blend runs in. OKLab keeps mid-tones vivid; RGB matches the classic look.'
      "
      :model-value="state.paletteColorSpace"
      :options="colorSpaceOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      data-testid="param-palette-color-space"
      @update:model-value="controller.setPaletteColorSpace($event)"
    />
  </div>
  <ParamSlider
    label="Trap scale"
    :min="0.2"
    :max="3"
    :step="0.01"
    :model-value="state.trapScale"
    description="Scales the orbit-trap value before colour mapping - shifts the banding frequency."
    testid="param-trap-scale"
    @update:model-value="controller.setTrapScale($event)"
  />
  <ParamSlider
    label="Trap power"
    :min="0.1"
    :max="2"
    :step="0.01"
    :model-value="state.trapPower"
    description="Exponent applied to the trap value - biases colour toward the bands or the peaks."
    testid="param-trap-power"
    @update:model-value="controller.setTrapPower($event)"
  />
</template>

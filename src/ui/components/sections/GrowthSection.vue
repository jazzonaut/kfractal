<script setup lang="ts">
import SelectButton from "primevue/selectbutton";
import ParamSlider from "../ParamSlider.vue";
import ColorParam from "../ColorParam.vue";
import { useController } from "../../composables/use-controller";
import type { GrowthMode } from "../../../fractal/types";

const controller = useController();
const state = controller.state;

const modeOptions: { label: string; value: GrowthMode }[] = [
  { label: "Spikes", value: "spikes" },
  { label: "Bumps", value: "bumps" },
  { label: "Crystals", value: "crystals" },
  { label: "Fins", value: "fins" },
];
</script>

<template>
  <div class="mb-2 flex justify-center">
    <SelectButton
      v-tooltip.left="'Procedural growth sprouting off every surface - organic or artificial.'"
      :model-value="state.growthMode"
      :options="modeOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      data-testid="param-growth-mode"
      @update:model-value="controller.setGrowthMode($event)"
    />
  </div>
  <ParamSlider
    label="Length"
    :min="0"
    :max="0.15"
    :step="0.002"
    :model-value="state.growthLength"
    description="How far the growth protrudes from the surface. Zero turns growth off."
    testid="param-growth-length"
    @update:model-value="controller.setGrowthParam('length', $event)"
  />
  <ParamSlider
    label="Density"
    :min="5"
    :max="150"
    :step="1"
    :model-value="state.growthDensity"
    description="How many growths per surface area - low for sparse large features, high for fine fur-like detail."
    testid="param-growth-density"
    @update:model-value="controller.setGrowthParam('density', $event)"
  />
  <ParamSlider
    label="Sharpness"
    :min="0.5"
    :max="8"
    :step="0.1"
    :model-value="state.growthSharpness"
    description="Profile of each growth - low for soft rounded nubs, high for needles and hard facets."
    testid="param-growth-sharpness"
    @update:model-value="controller.setGrowthParam('sharpness', $event)"
  />
  <ParamSlider
    label="Coverage"
    :min="0"
    :max="1"
    :step="0.01"
    :model-value="state.growthCoverage"
    description="Fraction of the surface carrying growth - lower values leave bare patches."
    testid="param-growth-coverage"
    @update:model-value="controller.setGrowthParam('coverage', $event)"
  />
  <ParamSlider
    label="Placement"
    :min="-1"
    :max="1"
    :step="0.02"
    :model-value="state.growthTrapBias"
    description="Where growth takes hold: positive favors deep crevices, negative favors exposed ridges, zero grows everywhere."
    testid="param-growth-trap-bias"
    @update:model-value="controller.setGrowthParam('trapBias', $event)"
  />
  <ColorParam
    label="Color"
    :model-value="state.growthColor"
    description="Growth colour, blended over the surface palette."
    testid="param-growth-color"
    @update:model-value="controller.setGrowthColor($event)"
  />
  <ParamSlider
    label="Color blend"
    :min="0"
    :max="1"
    :step="0.01"
    :model-value="state.growthColorBlend"
    description="How strongly growth takes its own colour - zero keeps the surface palette."
    testid="param-growth-color-blend"
    @update:model-value="controller.setGrowthParam('colorBlend', $event)"
  />
  <ParamSlider
    label="Emission"
    :min="0"
    :max="4"
    :step="0.01"
    :model-value="state.growthEmission"
    description="Makes the growth tips glow with the growth colour."
    testid="param-growth-emission"
    @update:model-value="controller.setGrowthParam('emission', $event)"
  />
</template>

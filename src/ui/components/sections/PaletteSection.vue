<script setup lang="ts">
import ParamSlider from "../ParamSlider.vue";
import ColorParam from "../ColorParam.vue";
import { useController } from "../../composables/use-controller";

const controller = useController();
const state = controller.state;
</script>

<template>
  <ColorParam
    label="Base A"
    :model-value="state.paletteBaseA"
    description="First base colour of the orbit-trap palette."
    testid="param-palette-base-a"
    @update:model-value="controller.setPaletteColor('baseA', $event)"
  />
  <ColorParam
    label="Base B"
    :model-value="state.paletteBaseB"
    description="Second base colour, blended against Base A across the trap value."
    testid="param-palette-base-b"
    @update:model-value="controller.setPaletteColor('baseB', $event)"
  />
  <ColorParam
    label="Accent"
    :model-value="state.paletteAccent"
    description="Highlight colour applied to the palette peaks."
    testid="param-palette-accent"
    @update:model-value="controller.setPaletteColor('accent', $event)"
  />
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

<script setup lang="ts">
import ToggleSwitch from "primevue/toggleswitch";
import {
  CONTROL_SENSITIVITY_MAX,
  CONTROL_SENSITIVITY_MIN,
  CONTROL_SENSITIVITY_STEP,
} from "../../../config/constants";
import ParamSlider from "../ParamSlider.vue";
import { useController } from "../../composables/use-controller";

const controller = useController();
const state = controller.state;
</script>

<template>
  <ParamSlider
    label="Sensitivity"
    :min="CONTROL_SENSITIVITY_MIN"
    :max="CONTROL_SENSITIVITY_MAX"
    :step="CONTROL_SENSITIVITY_STEP"
    :model-value="state.controlSensitivity"
    description="How far the camera responds to a drag, wheel, or pinch - scales orbit, pan, roll, and zoom together, for both mouse and touch. 1 is the default feel."
    testid="param-control-sensitivity"
    @update:model-value="controller.setControlSensitivity($event)"
  />
  <label class="flex cursor-pointer items-center justify-between pt-1 text-muted-color">
    <span>
      Deep-zoom dive
      <span class="block text-xs">Infinite zoom into surface detail (off: fly through it)</span>
    </span>
    <ToggleSwitch
      :model-value="state.diveEnabled"
      data-testid="dive-enabled-toggle"
      @update:model-value="controller.setDiveEnabled($event)"
    />
  </label>
</template>

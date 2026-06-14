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
    label="FOV"
    :min="20"
    :max="100"
    :step="1"
    :model-value="state.cameraFov"
    description="Camera field of view in degrees. Lower is more telephoto; higher is wider and more dramatic."
    testid="param-fov"
    @update:model-value="controller.setCameraFov($event)"
  />
  <ParamSlider
    label="Aperture"
    :min="0"
    :max="0.14"
    :step="0.001"
    :model-value="state.aperture"
    description="Lens opening size. Larger values throw out-of-focus areas more strongly out of focus (depth of field)."
    testid="param-aperture"
    @update:model-value="controller.setAperture($event)"
  />
  <ParamSlider
    label="Focus"
    :min="1"
    :max="12"
    :step="0.05"
    :model-value="state.focusDistance"
    description="Distance from the camera that stays sharp. Nearer and farther areas blur with aperture."
    testid="param-focus"
    @update:model-value="controller.setFocusDistance($event)"
  />
  <ParamSlider
    label="Fringe"
    :min="0"
    :max="0.025"
    :step="0.0005"
    :model-value="state.chromaticAberration"
    description="Chromatic aberration - splits colour toward the frame edges like a real lens."
    testid="param-fringe"
    @update:model-value="controller.setChromaticAberration($event)"
  />
  <ParamSlider
    label="Distortion"
    :min="-1"
    :max="1"
    :step="0.005"
    :model-value="state.lensDistortion"
    description="Lens warping: barrel (negative) bulges outward, pincushion (positive) pinches inward."
    testid="param-distortion"
    @update:model-value="controller.setPostFxParam('distortion', $event)"
  />
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

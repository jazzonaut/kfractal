<script setup lang="ts">
import ToggleSwitch from "primevue/toggleswitch";
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
  <label class="flex cursor-pointer items-center justify-between pt-1 text-muted-color">
    <span>
      Dive assist
      <span class="block text-xs">Steer deep zooms toward detail and the cursor</span>
    </span>
    <ToggleSwitch
      :model-value="state.diveAssist"
      data-testid="dive-assist-toggle"
      @update:model-value="controller.setDiveAssist($event)"
    />
  </label>
  <p class="pt-1 text-xs text-muted-color">
    Drag orbit · Shift/right drag pan · Middle drag roll · Wheel zoom
  </p>
</template>

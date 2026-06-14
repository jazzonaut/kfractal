<script setup lang="ts">
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
  <div class="mt-3 border-t border-white/10 pt-3">
    <p class="pb-1 text-xs font-semibold text-muted-color">Lens FX</p>
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
  </div>
</template>

<script setup lang="ts">
import SelectButton from "primevue/selectbutton";
import ParamSlider from "../ParamSlider.vue";
import { useController } from "../../composables/use-controller";
import { WARP_RANGES } from "../../../fractal/warp";
import type { WarpAxis } from "../../../fractal/types";

const controller = useController();
const state = controller.state;

const axisOptions: { label: string; value: WarpAxis }[] = [
  { label: "X", value: "x" },
  { label: "Y", value: "y" },
  { label: "Z", value: "z" },
];
const r = WARP_RANGES;
</script>

<template>
  <ParamSlider
    label="Twist"
    :min="r.twist.min"
    :max="r.twist.max"
    :step="r.twist.step"
    :model-value="state.warpTwist"
    description="Corkscrews the whole structure around the axis - rotation grows with position along it. Zero is off."
    testid="param-warp-twist"
    @update:model-value="controller.setWarpParam('twist', $event)"
  />
  <div class="mb-2 flex justify-center">
    <SelectButton
      v-tooltip.left="'Axis the twist corkscrews around.'"
      :model-value="state.warpTwistAxis"
      :options="axisOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      data-testid="param-warp-twist-axis"
      @update:model-value="controller.setWarpAxis('twistAxis', $event)"
    />
  </div>
  <ParamSlider
    label="Bend"
    :min="r.bend.min"
    :max="r.bend.max"
    :step="r.bend.step"
    :model-value="state.warpBend"
    description="Curves the structure along the axis, like bending a bar. Zero is off."
    testid="param-warp-bend"
    @update:model-value="controller.setWarpParam('bend', $event)"
  />
  <div class="mb-2 flex justify-center">
    <SelectButton
      v-tooltip.left="'Axis the bend curves along.'"
      :model-value="state.warpBendAxis"
      :options="axisOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      data-testid="param-warp-bend-axis"
      @update:model-value="controller.setWarpAxis('bendAxis', $event)"
    />
  </div>
  <ParamSlider
    label="Ripple"
    :min="r.rippleAmp.min"
    :max="r.rippleAmp.max"
    :step="r.rippleAmp.step"
    :model-value="state.warpRippleAmp"
    description="Wave-like undulation across the structure. Zero is off."
    testid="param-warp-ripple-amp"
    @update:model-value="controller.setWarpParam('rippleAmp', $event)"
  />
  <ParamSlider
    label="Ripple frequency"
    :min="r.rippleFreq.min"
    :max="r.rippleFreq.max"
    :step="r.rippleFreq.step"
    :model-value="state.warpRippleFreq"
    description="How tightly the ripple waves repeat - low for broad swells, high for fine corrugation."
    testid="param-warp-ripple-freq"
    @update:model-value="controller.setWarpParam('rippleFreq', $event)"
  />
  <div class="mb-2 flex justify-center">
    <SelectButton
      v-tooltip.left="'Axis the ripple displaces.'"
      :model-value="state.warpRippleAxis"
      :options="axisOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      size="small"
      data-testid="param-warp-ripple-axis"
      @update:model-value="controller.setWarpAxis('rippleAxis', $event)"
    />
  </div>
  <ParamSlider
    label="Noise warp"
    :min="r.noiseAmp.min"
    :max="r.noiseAmp.max"
    :step="r.noiseAmp.step"
    :model-value="state.warpNoiseAmp"
    description="Organic, flowing distortion of the whole structure - melts hard edges. Zero is off."
    testid="param-warp-noise-amp"
    @update:model-value="controller.setWarpParam('noiseAmp', $event)"
  />
  <ParamSlider
    label="Noise frequency"
    :min="r.noiseFreq.min"
    :max="r.noiseFreq.max"
    :step="r.noiseFreq.step"
    :model-value="state.warpNoiseFreq"
    description="Scale of the noise distortion - low for slow large-scale flow, high for turbulent detail."
    testid="param-warp-noise-freq"
    @update:model-value="controller.setWarpParam('noiseFreq', $event)"
  />
</template>

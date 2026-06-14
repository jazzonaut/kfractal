<script setup lang="ts">
import ToggleSwitch from "primevue/toggleswitch";
import ParamSlider from "../ParamSlider.vue";
import ColorParam from "../ColorParam.vue";
import { useController } from "../../composables/use-controller";

const controller = useController();
const state = controller.state;
</script>

<template>
  <p class="pb-1 text-xs font-semibold text-muted-color">Fog</p>
  <ParamSlider
    label="Density"
    :min="0"
    :max="0.15"
    :step="0.0005"
    :model-value="state.fogDensity"
    description="How quickly fog thickens with distance."
    testid="param-fog-density"
    @update:model-value="controller.setFogParam('density', $event)"
  />
  <ParamSlider
    label="Height"
    :min="0.1"
    :max="6"
    :step="0.05"
    :model-value="state.fogHeight"
    description="Top of the fog layer. Fog is densest near the ground and thins out above this height."
    testid="param-fog-height"
    @update:model-value="controller.setFogParam('height', $event)"
  />
  <ParamSlider
    label="Scatter"
    :min="-0.9"
    :max="0.9"
    :step="0.01"
    :model-value="state.fogAnisotropy"
    description="Fog directionality. Negative scatters light back toward the camera; positive scatters it forward through the light."
    testid="param-fog-anisotropy"
    @update:model-value="controller.setFogParam('anisotropy', $event)"
  />
  <ColorParam
    label="Color"
    :model-value="state.fogColor"
    description="Fog tint."
    testid="param-fog-color"
    @update:model-value="controller.setFogColor($event)"
  />

  <div class="mt-3 border-t border-white/10 pt-3">
    <p class="pb-1 text-xs font-semibold text-muted-color">Glow</p>
    <ParamSlider
      label="Strength"
      :min="0"
      :max="2"
      :step="0.02"
      :model-value="state.glowStrength"
      description="Intensity of the volumetric glow surrounding bright structure."
      testid="param-glow-strength"
      @update:model-value="controller.setGlowParam('strength', $event)"
    />
    <ParamSlider
      label="Radius"
      :min="0.02"
      :max="1"
      :step="0.01"
      :model-value="state.glowRadius"
      description="Spread of the glow falloff - larger bleeds the glow further out."
      testid="param-glow-radius"
      @update:model-value="controller.setGlowParam('radius', $event)"
    />
    <label
      v-tooltip.left="'Tint the glow with the active palette instead of a single fixed colour.'"
      class="flex cursor-pointer items-center justify-between py-1.5 text-xs text-muted-color"
    >
      <span>Palette colors</span>
      <ToggleSwitch
        :model-value="state.glowUsePalette"
        data-testid="param-glow-palette-link"
        @update:model-value="controller.setGlowPaletteLink($event)"
      />
    </label>
    <ColorParam
      v-if="!state.glowUsePalette"
      label="Color"
      :model-value="state.glowColor"
      description="Fixed glow colour, used when palette tint is off."
      testid="param-glow-color"
      @update:model-value="controller.setGlowColor($event)"
    />
  </div>

  <div class="mt-3 border-t border-white/10 pt-3">
    <p class="pb-1 text-xs font-semibold text-muted-color">Bloom</p>
    <ParamSlider
      label="Strength"
      :min="0"
      :max="1.4"
      :step="0.01"
      :model-value="state.bloomStrength"
      description="Strength of the soft halo that bleeds from bright areas."
      testid="param-bloom-strength"
      @update:model-value="controller.setBloomStrength($event)"
    />
    <ParamSlider
      label="Radius"
      :min="0"
      :max="1"
      :step="0.01"
      :model-value="state.bloomRadius"
      description="How far the bloom halo spreads from its source."
      testid="param-bloom-radius"
      @update:model-value="controller.setBloomRadius($event)"
    />
    <ParamSlider
      label="Cutoff"
      :min="0"
      :max="1.5"
      :step="0.01"
      :model-value="state.bloomThreshold"
      description="Brightness threshold above which pixels start to bloom."
      testid="param-bloom-threshold"
      @update:model-value="controller.setBloomThreshold($event)"
    />
  </div>
</template>

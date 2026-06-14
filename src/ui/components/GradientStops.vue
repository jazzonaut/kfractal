<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import Button from "primevue/button";
import Slider from "primevue/slider";
import ColorSwatch from "./ColorSwatch.vue";
import { useController } from "../composables/use-controller";
import { MAX_PALETTE_STOPS, sortStopsByPosition } from "../../fractal/types";
import { RAMP_SIZE, bakeRamp } from "../../render/ramp";

const controller = useController();
const state = controller.state;

// State holds stops in insertion order; show them left-to-right by position to match the
// gradient. Keyed by stable id (not index), so removing/reordering never rebinds a picker.
const sortedStops = computed(() => sortStopsByPosition(state.paletteStops));

// CSS preview of the live ramp: bake it (so interpolation + colour space show faithfully),
// then convert a handful of linear-RGB samples back to sRGB for a `linear-gradient`.
const PREVIEW_SAMPLES = 24;
function toSrgb(c: number): number {
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
}
const gradientCss = computed(() => {
  const ramp = bakeRamp(state.paletteStops, state.paletteInterpolation, state.paletteColorSpace);
  const parts: string[] = [];
  for (let i = 0; i < PREVIEW_SAMPLES; i += 1) {
    const t = i / (PREVIEW_SAMPLES - 1);
    const o = Math.round(t * (RAMP_SIZE - 1)) * 4;
    parts.push(
      `rgb(${toSrgb(ramp[o]!)},${toSrgb(ramp[o + 1]!)},${toSrgb(ramp[o + 2]!)}) ${(t * 100).toFixed(1)}%`,
    );
  }
  return `linear-gradient(to right, ${parts.join(", ")})`;
});

// Coalesce position-drag emits to one per frame (same rationale as ParamSlider): each emit
// re-bakes the ramp and resets accumulation.
let rafId = 0;
let pendingId = "";
let pendingValue = 0;
function flushSlide(): void {
  rafId = 0;
  controller.setPaletteStopPosition(pendingId, pendingValue);
}
function onSlide(id: string, value: number): void {
  pendingId = id;
  pendingValue = value;
  if (rafId === 0) rafId = requestAnimationFrame(flushSlide);
}
onBeforeUnmount(() => {
  if (rafId !== 0) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div class="flex flex-col gap-2 py-1.5" data-testid="gradient-stops">
    <div
      class="h-6 w-full rounded border border-white/10"
      :style="{ background: gradientCss }"
      data-testid="gradient-preview"
    />
    <div
      v-for="(stop, index) in sortedStops"
      :key="stop.id"
      class="grid grid-cols-[auto_1fr_2.75rem_auto] items-center gap-2"
      :data-testid="`gradient-stop-${index}`"
    >
      <ColorSwatch
        :model-value="stop.color"
        @update:model-value="controller.setPaletteStopColor(stop.id, $event)"
      />
      <Slider
        :model-value="stop.position"
        :min="0"
        :max="1"
        :step="0.01"
        class="w-full"
        @update:model-value="onSlide(stop.id, $event as number)"
      />
      <span class="text-right text-xs tabular-nums text-muted-color">
        {{ Math.round(stop.position * 100) }}%
      </span>
      <Button
        v-tooltip.left="'Remove this stop'"
        icon="pi pi-times"
        text
        rounded
        size="small"
        severity="secondary"
        :disabled="state.paletteStops.length <= 2"
        :data-testid="`gradient-stop-remove-${index}`"
        @click="controller.removePaletteStop(stop.id)"
      />
    </div>
    <Button
      label="Add stop"
      icon="pi pi-plus"
      text
      size="small"
      class="self-start"
      :disabled="state.paletteStops.length >= MAX_PALETTE_STOPS"
      data-testid="gradient-stop-add"
      @click="controller.addPaletteStop()"
    />
  </div>
</template>

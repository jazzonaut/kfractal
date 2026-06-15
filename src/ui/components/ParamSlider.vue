<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import Slider from "primevue/slider";

const props = defineProps<{
  label: string;
  min: number;
  max: number;
  step: number;
  modelValue: number;
  testid?: string;
  description?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

// Slider drags emit on every pointermove (120-1000 Hz), each one re-rendering the section,
// rebuilding nested effect/sky settings, repacking uniform groups, and resetting
// accumulation. Only the last value before the next frame matters, so coalesce drag emits
// to one per rAF; the number input (commitNumber) is discrete and emits straight through.
let rafId = 0;
let pending = 0;

function flushSlide(): void {
  rafId = 0;
  emit("update:modelValue", pending);
}

function onSlide(value: number): void {
  pending = value;
  if (rafId === 0) rafId = requestAnimationFrame(flushSlide);
}

onBeforeUnmount(() => {
  if (rafId !== 0) cancelAnimationFrame(rafId);
});

// Clamp to range and snap to the step grid (relative to min, matching the slider), killing
// the float noise the multiply leaves behind (step can be as fine as 0.0005).
function normalize(value: number): number {
  const clamped = Math.min(props.max, Math.max(props.min, value));
  if (props.step <= 0) return clamped;
  const snapped = Math.round((clamped - props.min) / props.step) * props.step + props.min;
  const cleaned = Math.round(snapped * 1e6) / 1e6;
  return Math.min(props.max, Math.max(props.min, cleaned));
}

function commitNumber(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  // Non-finite (or whatever the field holds): restore the canonical text and bail.
  if (!Number.isFinite(value)) {
    input.value = String(props.modelValue);
    return;
  }
  const next = normalize(value);
  // Drop any drag emit still queued for this frame: it carries the pre-edit slider value and
  // would fire after this commit, reverting the typed entry.
  if (rafId !== 0) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  // Re-sync the DOM to the canonical value first: when `next === modelValue` (e.g. typing
  // 999 into a field already at max) Vue patches nothing, so the input would otherwise keep
  // the raw typed text while state holds the old value.
  input.value = String(next);
  emit("update:modelValue", next);
}
</script>

<template>
  <div class="grid grid-cols-[5.5rem_1fr_3.75rem] items-center gap-3 py-1.5" :data-testid="testid">
    <label
      v-tooltip.left="{ value: description, disabled: !description, showDelay: 250 }"
      class="truncate text-xs text-muted-color"
      :class="{ 'cursor-help': description }"
      >{{ label }}</label
    >
    <Slider
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      class="w-full"
      @update:model-value="onSlide($event as number)"
    />
    <input
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      class="w-full rounded border border-white/10 bg-white/5 px-1 py-0.5 text-right text-xs tabular-nums text-surface-100 outline-none focus:border-primary-400"
      @change="commitNumber"
    />
  </div>
</template>

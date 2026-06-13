<script setup lang="ts">
const props = defineProps<{
  label: string;
  modelValue: readonly [number, number, number];
  min: number;
  max: number;
  step: number;
  testid?: string;
  description?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: [number, number, number]] }>();

const AXES = ["x", "y", "z"] as const;

/** Display rounding for the input fields (matches the :value binding). */
function display(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

// Clamp to range and snap to the step grid (relative to min), cleaning float noise.
function normalize(value: number): number {
  const clamped = Math.min(props.max, Math.max(props.min, value));
  if (props.step <= 0) return clamped;
  const snapped = Math.round((clamped - props.min) / props.step) * props.step + props.min;
  const cleaned = Math.round(snapped * 1e6) / 1e6;
  return Math.min(props.max, Math.max(props.min, cleaned));
}

function commitAxis(axis: 0 | 1 | 2, event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (!Number.isFinite(value)) {
    input.value = display(props.modelValue[axis] ?? 0);
    return;
  }
  const nextVal = normalize(value);
  const next = [...props.modelValue] as [number, number, number];
  next[axis] = nextVal;
  // Re-sync the DOM first: a clamp-to-unchanged emit patches nothing, leaving stale text.
  input.value = display(nextVal);
  emit("update:modelValue", next);
}
</script>

<template>
  <div class="grid grid-cols-[5.5rem_1fr_1fr_1fr] items-center gap-2 py-1.5" :data-testid="testid">
    <label
      v-tooltip.left="{ value: description, disabled: !description, showDelay: 250 }"
      class="truncate text-xs text-muted-color"
      :class="{ 'cursor-help': description }"
      >{{ label }}</label
    >
    <input
      v-for="(axis, i) in AXES"
      :key="axis"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      :value="Math.round((modelValue[i] ?? 0) * 1000) / 1000"
      class="w-full rounded border border-white/10 bg-white/5 px-1 py-0.5 text-right text-xs tabular-nums text-surface-100 outline-none focus:border-primary-400"
      :data-testid="testid ? `${testid}-${axis}` : undefined"
      @change="commitAxis(i as 0 | 1 | 2, $event)"
    />
  </div>
</template>

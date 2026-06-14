<script setup lang="ts">
import ColorPicker from "primevue/colorpicker";

// One picker + a manual hex field beneath it. State speaks `#rrggbb`; PrimeVue's ColorPicker
// speaks bare `rrggbb`, so the conversion is centralized here (was duplicated at each call site).
const props = defineProps<{
  modelValue: string;
  testid?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

// Accepts `#abc`, `abc`, `#aabbcc`, `aabbcc` (any case). Returns a normalized `#rrggbb`, or
// null when the field doesn't hold a complete 3- or 6-digit hex.
function parseHex(raw: string): string | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw.trim());
  if (!m) return null;
  let hex = m[1]!.toLowerCase();
  if (hex.length === 3) hex = hex.replace(/./g, (c) => c + c);
  return `#${hex}`;
}

// Commit on blur/Enter (the field's `change` event), not per keystroke: a half-typed value
// would otherwise churn the ramp re-bake. Invalid input restores the canonical text.
function commitHex(event: Event): void {
  const input = event.target as HTMLInputElement;
  const next = parseHex(input.value);
  if (next === null) {
    input.value = props.modelValue;
    return;
  }
  // Re-sync the DOM to canonical first: when `next === modelValue` Vue patches nothing, so the
  // field would otherwise keep the raw typed text (e.g. uppercase / 3-digit) while state holds
  // the same colour.
  input.value = next;
  emit("update:modelValue", next);
}
</script>

<template>
  <div class="flex items-center gap-2" :data-testid="testid">
    <ColorPicker
      :model-value="modelValue.replace(/^#/, '')"
      format="hex"
      @update:model-value="emit('update:modelValue', `#${$event}`)"
    />
    <input
      type="text"
      :value="modelValue"
      maxlength="7"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      class="w-[4.5rem] rounded border border-white/10 bg-white/5 px-1 py-0.5 text-center text-xs lowercase tabular-nums text-surface-100 outline-none focus:border-primary-400"
      @change="commitHex"
    />
  </div>
</template>

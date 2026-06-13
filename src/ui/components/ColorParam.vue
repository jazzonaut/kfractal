<script setup lang="ts">
import ColorPicker from "primevue/colorpicker";

// State carries `#rrggbb`; PrimeVue ColorPicker speaks bare `rrggbb` - normalized here.
defineProps<{
  label: string;
  modelValue: string;
  testid?: string;
  description?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <div class="grid grid-cols-[5.5rem_auto_1fr] items-center gap-3 py-1.5" :data-testid="testid">
    <label
      v-tooltip.left="{ value: description, disabled: !description, showDelay: 250 }"
      class="truncate text-xs text-muted-color"
      :class="{ 'cursor-help': description }"
      >{{ label }}</label
    >
    <ColorPicker
      :model-value="modelValue.replace(/^#/, '')"
      format="hex"
      @update:model-value="emit('update:modelValue', `#${$event}`)"
    />
    <span class="text-xs uppercase tabular-nums text-muted-color">{{ modelValue }}</span>
  </div>
</template>

<script setup lang="ts">
import ColorSwatch from "./ColorSwatch.vue";

// State carries `#rrggbb`; ColorSwatch handles the swatch + manual hex entry.
defineProps<{
  label: string;
  modelValue: string;
  testid?: string;
  description?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <div class="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-1.5" :data-testid="testid">
    <label
      v-tooltip.left="{ value: description, disabled: !description, showDelay: 250 }"
      class="truncate text-xs text-muted-color"
      :class="{ 'cursor-help': description }"
      >{{ label }}</label
    >
    <ColorSwatch
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

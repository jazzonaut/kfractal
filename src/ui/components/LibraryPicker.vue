<script setup lang="ts">
import { computed } from "vue";
import Select from "primevue/select";
import { useController } from "../composables/use-controller";
import { getFormula } from "../../fractal/registry";
import type { FractalFormulaId, LibraryKind } from "../../fractal/types";

/**
 * One grouped dropdown per library axis (ADR-0010): preset pairings, shapes, looks.
 * Shows "Custom" when the live state no longer matches any library item on that axis.
 */
const props = withDefaults(
  defineProps<{
    kind: LibraryKind;
    /** Show the selected item's description under the dropdown (preset picker only). */
    showDescription?: boolean;
  }>(),
  { showDescription: false },
);

const controller = useController();
const state = controller.state;

const config = computed(() => {
  switch (props.kind) {
    case "shape":
      return {
        curated: state.shapes,
        user: state.userShapes,
        selectedId: state.selectedShapeId,
        userLabel: "My shapes",
        select: controller.setShape,
      };
    case "look":
      return {
        curated: state.looks,
        user: state.userLooks,
        selectedId: state.selectedLookId,
        userLabel: "My looks",
        select: controller.setLook,
      };
    default:
      return {
        curated: state.presets,
        user: state.userPresets,
        selectedId: state.selectedPresetId,
        userLabel: "My presets",
        select: controller.setPreset,
      };
  }
});

// User items lead: the saves you made are what you reach for most.
const groups = computed(() => {
  const list = [];
  if (config.value.user.length) {
    list.push({ label: config.value.userLabel, items: [...config.value.user] });
  }
  list.push({ label: "Built-in", items: [...config.value.curated] });
  return list;
});

const selected = computed(() =>
  [...config.value.curated, ...config.value.user].find(
    (item) => item.id === config.value.selectedId,
  ),
);

// Shape rows annotate which formula they drive, e.g. "Foam Orb (Sphere Foam)".
const formulaName = (formula: FractalFormulaId): string => getFormula(formula).name;
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <Select
      :model-value="config.selectedId"
      :options="groups"
      option-label="name"
      option-value="id"
      option-group-label="label"
      option-group-children="items"
      placeholder="Custom"
      filter
      :filter-fields="['name', 'description']"
      scroll-height="20rem"
      class="w-full"
      :data-testid="`${kind}-select`"
      @update:model-value="config.select($event)"
    >
      <template #option="{ option }">
        <div class="flex max-w-64 flex-col gap-0.5">
          <span class="text-sm">
            {{ option.name }}
            <span v-if="kind === 'shape' && option.formula" class="text-muted-color">
              ({{ formulaName(option.formula) }})
            </span>
          </span>
          <span class="truncate text-xs text-muted-color">{{ option.description }}</span>
        </div>
      </template>
    </Select>
    <p v-if="showDescription" class="text-xs leading-snug text-muted-color">
      {{ selected?.description }}
    </p>
  </div>
</template>

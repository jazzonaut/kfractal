<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import { useToast } from "primevue/usetoast";
import ManagePresetsDialog from "./ManagePresetsDialog.vue";
import SavePresetDialog from "./SavePresetDialog.vue";
import ShapeGeneratorDialog from "./ShapeGeneratorDialog.vue";
import { useController } from "../composables/use-controller";
import type { LibraryActionResult } from "../controller";
import type { LibraryKind } from "../../fractal/types";

const controller = useController();
const state = controller.state;
const toast = useToast();

const saveOpen = ref(false);
const manageOpen = ref(false);
const generatorOpen = ref(false);

const KIND_LABEL: Record<LibraryKind, string> = {
  preset: "Preset",
  shape: "Shape",
  look: "Look",
};

// Update overwrites the user-owned items currently selected on each axis: a selected
// user preset, user shape, and/or user look (curated selections are read-only).
const updatables = computed((): { kind: LibraryKind; id: string }[] => {
  const out: { kind: LibraryKind; id: string }[] = [];
  if (state.userPresets.some((p) => p.id === state.selectedPresetId)) {
    out.push({ kind: "preset", id: state.selectedPresetId });
  }
  if (state.userShapes.some((s) => s.id === state.selectedShapeId)) {
    out.push({ kind: "shape", id: state.selectedShapeId });
  }
  if (state.userLooks.some((l) => l.id === state.selectedLookId)) {
    out.push({ kind: "look", id: state.selectedLookId });
  }
  return out;
});

function notify(result: LibraryActionResult, summary: string): void {
  if (result.ok) toast.add({ severity: "success", summary, life: 2500 });
  else {
    toast.add({ severity: "error", summary: result.error ?? "Something went wrong.", life: 4000 });
  }
}

function onSave(name: string, description: string, kind: LibraryKind): void {
  notify(controller.saveUserItem(kind, name, description), `${KIND_LABEL[kind]} saved`);
}

function onUpdate(): void {
  for (const target of updatables.value) {
    notify(controller.updateUserItem(target.kind, target.id), `${KIND_LABEL[target.kind]} updated`);
  }
}
</script>

<template>
  <div class="flex flex-wrap pt-1">
    <Button
      label="Save"
      icon="pi pi-save"
      size="small"
      severity="secondary"
      text
      class="!px-2"
      data-testid="preset-save-button"
      @click="saveOpen = true"
    />
    <Button
      label="Update"
      icon="pi pi-sync"
      size="small"
      severity="secondary"
      text
      class="!px-2"
      :disabled="!updatables.length"
      data-testid="preset-update-button"
      @click="onUpdate"
    />
    <Button
      label="Manage"
      icon="pi pi-folder-open"
      size="small"
      severity="secondary"
      text
      class="!px-2"
      data-testid="preset-manage-button"
      @click="manageOpen = true"
    />
  </div>

  <SavePresetDialog v-model:visible="saveOpen" mode="save" @confirm="onSave" />
  <ManagePresetsDialog v-model:visible="manageOpen" @open-generator="generatorOpen = true" />
  <ShapeGeneratorDialog v-model:visible="generatorOpen" />
</template>

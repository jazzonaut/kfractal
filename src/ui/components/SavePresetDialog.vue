<script setup lang="ts">
import { ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import SelectButton from "primevue/selectbutton";
import Textarea from "primevue/textarea";
import type { LibraryKind } from "../../fractal/types";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    mode?: "save" | "rename";
    initialName?: string;
    initialDescription?: string;
    /** Pin the save kind and hide the selector (e.g. the shape generator saves shapes). */
    lockKind?: LibraryKind;
  }>(),
  { mode: "save", initialName: "", initialDescription: "" },
);

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  /** `kind` is only meaningful in save mode; rename callers already know their kind. */
  (e: "confirm", name: string, description: string, kind: LibraryKind): void;
}>();

const name = ref("");
const description = ref("");
const kind = ref<LibraryKind>("preset");

const KIND_OPTIONS: { label: string; value: LibraryKind; hint: string }[] = [
  { label: "Preset", value: "preset", hint: "Everything: the shape and the look together." },
  { label: "Shape", value: "shape", hint: "Geometry only: formula, parameters, framing." },
  { label: "Look", value: "look", hint: "Art direction only: light, surface, color, effects." },
];

// Re-seed the fields each time the dialog opens (rename reuses one instance).
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      name.value = props.initialName;
      description.value = props.initialDescription;
      kind.value = props.lockKind ?? "preset";
    }
  },
);

function confirm(): void {
  if (!name.value.trim()) return;
  emit("confirm", name.value, description.value, kind.value);
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="mode === 'save' ? 'Save to library' : 'Rename'"
    :draggable="false"
    class="w-80"
    data-testid="preset-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-3">
      <div v-if="mode === 'save' && !lockKind" class="flex flex-col gap-1 text-xs text-muted-color">
        Save as
        <SelectButton
          v-model="kind"
          :options="KIND_OPTIONS"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          data-testid="save-kind-select"
        />
        <p class="text-xs text-muted-color">
          {{ KIND_OPTIONS.find((option) => option.value === kind)?.hint }}
        </p>
      </div>
      <label class="flex flex-col gap-1 text-xs text-muted-color">
        Name
        <InputText
          v-model="name"
          maxlength="60"
          autofocus
          data-testid="preset-name-input"
          @keydown.enter="confirm"
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-muted-color">
        Description
        <Textarea
          v-model="description"
          rows="2"
          auto-resize
          data-testid="preset-description-input"
        />
      </label>
    </div>
    <template #footer>
      <Button
        label="Cancel"
        icon="pi pi-times"
        size="small"
        severity="secondary"
        text
        data-testid="preset-dialog-cancel"
        @click="emit('update:visible', false)"
      />
      <Button
        :label="mode === 'save' ? 'Save' : 'Rename'"
        icon="pi pi-check"
        size="small"
        :disabled="!name.trim()"
        data-testid="preset-dialog-confirm"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>

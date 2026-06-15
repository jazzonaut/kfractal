<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import { useToast } from "primevue/usetoast";
import SavePresetDialog from "./SavePresetDialog.vue";
import { useController } from "../composables/use-controller";
import type { LibraryKind } from "../../fractal/types";

defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "open-generator"): void;
}>();

const controller = useController();
const state = controller.state;
const toast = useToast();

const renameOpen = ref(false);
const renameTarget = ref<{
  kind: LibraryKind;
  id: string;
  name: string;
  description: string;
} | null>(null);
const importInput = ref<HTMLInputElement>();

// One section per library kind (ADR-0010), user and curated alike (ADR-0011).
// Curated rows are read-only: clone/export only, no rename/delete, no date line.
interface LibraryRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly updatedAt?: string | undefined;
}
const rows = (
  items: readonly { id: string; name: string; description: string; updatedAt?: string }[],
): LibraryRow[] =>
  items.map(({ id, name, description, updatedAt }) => ({ id, name, description, updatedAt }));
const sections = computed(() => [
  { kind: "preset" as const, title: "My presets", items: rows(state.userPresets), readonly: false },
  { kind: "shape" as const, title: "My shapes", items: rows(state.userShapes), readonly: false },
  { kind: "look" as const, title: "My looks", items: rows(state.userLooks), readonly: false },
  {
    kind: "preset" as const,
    title: "Built-in presets",
    items: rows(state.presets),
    readonly: true,
  },
  { kind: "shape" as const, title: "Built-in shapes", items: rows(state.shapes), readonly: true },
  { kind: "look" as const, title: "Built-in looks", items: rows(state.looks), readonly: true },
]);
const empty = computed(() =>
  sections.value.every((section) => section.readonly || !section.items.length),
);

// Two-click inline delete confirm: the label swaps to "Confirm?" and reverts after 3 s.
const confirmDeleteKey = ref("");
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

// The confirm timer can still be pending when the dialog's owner is torn down; clear it so
// it doesn't fire on an unmounted instance.
onBeforeUnmount(() => clearTimeout(confirmTimer));

function fail(result: { ok: boolean; error?: string }): void {
  if (!result.ok) {
    toast.add({ severity: "error", summary: result.error ?? "Something went wrong.", life: 4000 });
  }
}

function openRename(kind: LibraryKind, id: string, name: string, description: string): void {
  renameTarget.value = { kind, id, name, description };
  renameOpen.value = true;
}

function onRename(name: string, description: string): void {
  const target = renameTarget.value;
  if (target) fail(controller.renameUserItem(target.kind, target.id, name, description));
}

function remove(kind: LibraryKind, id: string): void {
  const key = `${kind}:${id}`;
  if (confirmDeleteKey.value !== key) {
    confirmDeleteKey.value = key;
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(() => {
      confirmDeleteKey.value = "";
    }, 3000);
    return;
  }
  clearTimeout(confirmTimer);
  confirmDeleteKey.value = "";
  fail(controller.deleteUserItem(kind, id));
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  // Clear immediately so re-importing the same file fires another change event.
  input.value = "";
  if (!file) return;
  const result = await controller.importLibraryJson(file);
  if (result.ok) {
    toast.add({ severity: "success", summary: `Imported "${result.name}"`, life: 2500 });
    // The import was applied to the canvas - get the dialog out of the way.
    emit("update:visible", false);
  } else {
    toast.add({ severity: "error", summary: result.error ?? "Something went wrong.", life: 4000 });
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="My library"
    :draggable="false"
    class="w-[42rem] max-w-[calc(100vw-2rem)]"
    data-testid="preset-manage-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <p v-if="empty" class="py-2 text-sm text-muted-color">
      Nothing saved yet. Save the current state as a preset, shape, or look.
    </p>
    <div class="max-h-[60vh] overflow-y-auto pr-1">
      <template v-for="section in sections" :key="section.title">
        <template v-if="section.items.length">
          <p class="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-color">
            {{ section.title }}
          </p>
          <ul class="flex flex-col">
            <li
              v-for="item in section.items"
              :key="item.id"
              class="flex items-center gap-2 border-b border-white/5 py-1.5 last:border-b-0"
              :data-testid="`manage-${section.kind}-row-${item.id}`"
            >
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm text-surface-100">{{ item.name }}</p>
                <p class="truncate text-xs text-muted-color">
                  <template v-if="item.updatedAt"
                    >{{ formatDate(item.updatedAt)
                    }}<span v-if="item.description"> · </span></template
                  >{{ item.description }}
                </p>
              </div>
              <Button
                v-if="!section.readonly"
                label="Rename"
                icon="pi pi-pencil"
                size="small"
                severity="secondary"
                text
                :data-testid="`manage-${section.kind}-rename-${item.id}`"
                @click="openRename(section.kind, item.id, item.name, item.description)"
              />
              <Button
                :label="section.readonly ? 'Clone' : 'Copy'"
                icon="pi pi-clone"
                size="small"
                severity="secondary"
                text
                :data-testid="`manage-${section.kind}-duplicate-${item.id}`"
                @click="fail(controller.duplicateUserItem(section.kind, item.id))"
              />
              <Button
                label="Export"
                icon="pi pi-download"
                size="small"
                severity="secondary"
                text
                :data-testid="`manage-${section.kind}-export-${item.id}`"
                @click="fail(controller.exportLibraryItemJson(section.kind, item.id))"
              />
              <Button
                v-if="!section.readonly"
                :label="confirmDeleteKey === `${section.kind}:${item.id}` ? 'Confirm?' : 'Delete'"
                icon="pi pi-trash"
                size="small"
                severity="danger"
                text
                :data-testid="`manage-${section.kind}-delete-${item.id}`"
                @click="remove(section.kind, item.id)"
              />
            </li>
          </ul>
        </template>
      </template>
    </div>
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between">
        <Button
          label="Shape generator"
          icon="pi pi-sparkles"
          size="small"
          severity="secondary"
          text
          data-testid="shape-generator-open-button"
          @click="
            emit('open-generator');
            emit('update:visible', false);
          "
        />
        <div class="flex flex-wrap justify-end">
          <Button
            label="Import file"
            icon="pi pi-upload"
            size="small"
            severity="secondary"
            text
            data-testid="preset-import-button"
            @click="importInput?.click()"
          />
          <Button
            label="Export preset"
            icon="pi pi-download"
            size="small"
            severity="secondary"
            text
            data-testid="preset-export-button"
            @click="controller.exportLibraryJson('preset')"
          />
          <Button
            label="Export shape"
            icon="pi pi-download"
            size="small"
            severity="secondary"
            text
            data-testid="shape-export-button"
            @click="controller.exportLibraryJson('shape')"
          />
          <Button
            label="Export look"
            icon="pi pi-download"
            size="small"
            severity="secondary"
            text
            data-testid="look-export-button"
            @click="controller.exportLibraryJson('look')"
          />
          <input
            ref="importInput"
            type="file"
            accept=".json,application/json"
            class="hidden"
            data-testid="preset-import-input"
            @change="onImportFile"
          />
        </div>
      </div>
    </template>
  </Dialog>

  <SavePresetDialog
    v-model:visible="renameOpen"
    mode="rename"
    :initial-name="renameTarget?.name ?? ''"
    :initial-description="renameTarget?.description ?? ''"
    @confirm="onRename"
  />
</template>

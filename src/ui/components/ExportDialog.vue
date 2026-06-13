<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import ProgressBar from "primevue/progressbar";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Slider from "primevue/slider";
import ToggleSwitch from "primevue/toggleswitch";
import { useToast } from "primevue/usetoast";
import {
  DEFAULT_EXPORT_SAMPLE_CAP,
  DEFAULT_JPEG_QUALITY,
  DEFAULT_RESOLUTION_PRESET_ID,
  EXPORT_SAMPLE_CAP_CHOICES,
  RESOLUTION_PRESETS,
} from "../../config/constants";
import { useController } from "../composables/use-controller";
import type { ExportFormat } from "../controller";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "update:visible", value: boolean): void }>();

const controller = useController();
const state = controller.state;
const toast = useToast();

const presetId = ref(DEFAULT_RESOLUTION_PRESET_ID);
const portrait = ref(false);
const customWidth = ref(1920);
const customHeight = ref(1080);
const sampleCap = ref(DEFAULT_EXPORT_SAMPLE_CAP);
const denoise = ref(true);
const format = ref<ExportFormat>("png");
const quality = ref(DEFAULT_JPEG_QUALITY);
const filename = ref("kfractal");

const exporting = ref(false);
const progress = ref(0);

const FORMAT_OPTIONS = [
  { label: "PNG", value: "png" as const },
  { label: "JPEG", value: "jpeg" as const },
];

// Presets, plus the live viewport and a free-form custom entry.
const resolutionOptions = computed(() => [
  ...RESOLUTION_PRESETS.map((p) => ({ label: p.label, value: p.id })),
  {
    label: `Viewport · ${state.resolutionWidth}×${state.resolutionHeight}`,
    value: "viewport",
  },
  { label: "Custom…", value: "custom" },
]);

const baseDims = computed(() => {
  if (presetId.value === "custom") {
    return { width: customWidth.value || 0, height: customHeight.value || 0 };
  }
  if (presetId.value === "viewport") {
    return { width: state.resolutionWidth, height: state.resolutionHeight };
  }
  const preset = RESOLUTION_PRESETS.find((p) => p.id === presetId.value);
  return preset ? { width: preset.width, height: preset.height } : { width: 1920, height: 1080 };
});

// Portrait simply swaps the axes; the camera re-frames to whatever aspect results.
const finalDims = computed(() =>
  portrait.value
    ? { width: baseDims.value.height, height: baseDims.value.width }
    : { width: baseDims.value.width, height: baseDims.value.height },
);

const aspectLabel = computed(() => {
  const { width, height } = finalDims.value;
  if (!width || !height) return "-";
  return (width / height).toFixed(2) + ":1";
});

const megapixels = computed(() => {
  const { width, height } = finalDims.value;
  return ((width * height) / 1_000_000).toFixed(1);
});

const valid = computed(() => finalDims.value.width >= 16 && finalDims.value.height >= 16);

// Re-seed mutable defaults each open: filename from the active item, denoise from the live view.
watch(
  () => props.visible,
  (open) => {
    if (!open) return;
    denoise.value = state.denoise;
    filename.value = `kfractal-${state.selectedPresetId || state.selectedShapeId || "still"}`;
  },
);

async function runExport(): Promise<void> {
  if (!valid.value || exporting.value) return;
  const { width, height } = finalDims.value;
  const ext = format.value === "jpeg" ? "jpg" : "png";
  const base = filename.value.trim() || "kfractal";
  exporting.value = true;
  progress.value = 0;
  const result = await controller.exportImage(
    {
      width,
      height,
      sampleCap: sampleCap.value,
      denoise: denoise.value,
      format: format.value,
      quality: quality.value,
      filename: `${base}.${ext}`,
    },
    (fraction) => {
      progress.value = Math.round(fraction * 100);
    },
  );
  exporting.value = false;
  if (result.ok) {
    toast.add({ severity: "success", summary: `Exported ${base}.${ext}`, life: 2500 });
    emit("update:visible", false);
  } else if (result.cancelled) {
    // Aborted by the user; the live view is already restored. Just close.
    emit("update:visible", false);
  } else {
    toast.add({ severity: "error", summary: result.error ?? "Export failed.", life: 4000 });
  }
}

// Cancel aborts an in-flight render (the awaited export then resolves and closes us);
// otherwise it simply dismisses the dialog.
function onCancel(): void {
  if (exporting.value) controller.cancelExport();
  else emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Export"
    :draggable="false"
    :closable="!exporting"
    :close-on-escape="!exporting"
    class="w-[24rem]"
    data-testid="export-dialog"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-3">
      <label class="flex flex-col gap-1 text-xs text-muted-color">
        Resolution
        <Select
          v-model="presetId"
          :options="resolutionOptions"
          option-label="label"
          option-value="value"
          :disabled="exporting"
          size="small"
          data-testid="export-resolution-select"
        />
      </label>

      <div v-if="presetId === 'custom'" class="flex gap-2">
        <label class="flex flex-1 flex-col gap-1 text-xs text-muted-color">
          Width
          <InputNumber
            v-model="customWidth"
            :min="16"
            :max="8192"
            :disabled="exporting"
            show-buttons
            size="small"
            data-testid="export-custom-width"
          />
        </label>
        <label class="flex flex-1 flex-col gap-1 text-xs text-muted-color">
          Height
          <InputNumber
            v-model="customHeight"
            :min="16"
            :max="8192"
            :disabled="exporting"
            show-buttons
            size="small"
            data-testid="export-custom-height"
          />
        </label>
      </div>

      <div class="flex items-center justify-between text-xs text-muted-color">
        <label class="flex cursor-pointer items-center gap-2">
          Portrait
          <ToggleSwitch
            v-model="portrait"
            :disabled="exporting"
            data-testid="export-portrait-toggle"
          />
        </label>
        <span class="tabular-nums" data-testid="export-dimensions">
          {{ finalDims.width }}×{{ finalDims.height }} · {{ aspectLabel }} · {{ megapixels }} MP
        </span>
      </div>

      <label class="flex flex-col gap-1 text-xs text-muted-color">
        Quality (samples)
        <Select
          v-model="sampleCap"
          :options="[...EXPORT_SAMPLE_CAP_CHOICES]"
          :disabled="exporting"
          size="small"
          data-testid="export-samples-select"
        />
      </label>

      <label class="flex cursor-pointer items-center justify-between text-xs text-muted-color">
        Denoise
        <ToggleSwitch v-model="denoise" :disabled="exporting" data-testid="export-denoise-toggle" />
      </label>

      <label class="flex flex-col gap-1 text-xs text-muted-color">
        Format
        <SelectButton
          v-model="format"
          :options="FORMAT_OPTIONS"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          :disabled="exporting"
          size="small"
          data-testid="export-format-select"
        />
      </label>

      <label v-if="format === 'jpeg'" class="flex flex-col gap-1 text-xs text-muted-color">
        JPEG quality · {{ Math.round(quality * 100) }}%
        <Slider
          v-model="quality"
          :min="0.1"
          :max="1"
          :step="0.01"
          :disabled="exporting"
          data-testid="export-quality-slider"
        />
      </label>

      <label class="flex flex-col gap-1 text-xs text-muted-color">
        Filename
        <InputText
          v-model="filename"
          maxlength="80"
          :disabled="exporting"
          data-testid="export-filename-input"
        />
      </label>

      <div v-if="exporting" class="flex flex-col gap-1">
        <ProgressBar :value="progress" data-testid="export-progress" />
        <span class="text-xs text-muted-color">Rendering {{ sampleCap }} samples…</span>
      </div>
    </div>

    <template #footer>
      <Button
        :label="exporting ? 'Stop' : 'Cancel'"
        :icon="exporting ? 'pi pi-stop' : 'pi pi-times'"
        size="small"
        :severity="exporting ? 'danger' : 'secondary'"
        text
        data-testid="export-cancel"
        @click="onCancel"
      />
      <Button
        :label="exporting ? 'Rendering…' : 'Render & download'"
        icon="pi pi-download"
        size="small"
        :loading="exporting"
        :disabled="exporting || !valid"
        data-testid="export-confirm"
        @click="runExport"
      />
    </template>
  </Dialog>
</template>

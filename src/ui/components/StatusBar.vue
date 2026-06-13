<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import ProgressBar from "primevue/progressbar";
import Select from "primevue/select";
import ToggleSwitch from "primevue/toggleswitch";
import { SAMPLE_CAP_CHOICES } from "../../config/constants";
import { useController } from "../composables/use-controller";
import ExportDialog from "./ExportDialog.vue";

const controller = useController();
const state = controller.state;

const exportOpen = ref(false);
const bar = ref<HTMLElement>();

// Stable array identity: a [...spread] in the template would hand Select a fresh
// options prop on every re-render, forcing its subtree to re-render with it.
const sampleCapOptions = [...SAMPLE_CAP_CHOICES];

// Keep the canvas above the bar: reserve its measured height (it never collapses).
onMounted(() => controller.setViewportBottomInset(bar.value?.offsetHeight ?? 0));

// A finished render keeps presenting (rendering stays true); only offer Stop while
// samples are still accumulating.
const accumulating = computed(() => state.rendering && state.sampleCount < state.sampleCap);
const progress = computed(() =>
  Math.min(100, Math.round((state.sampleCount / state.sampleCap) * 100)),
);
</script>

<template>
  <footer
    ref="bar"
    class="pointer-events-auto fixed inset-x-0 bottom-0 flex h-12 items-center gap-4 border-t border-white/10 bg-surface-950/70 px-4 text-xs tabular-nums backdrop-blur-xl"
    data-testid="status-bar"
  >
    <span class="text-muted-color" data-testid="fps-readout">{{ state.fps }} fps</span>
    <span class="text-muted-color" data-testid="samples-readout">
      {{ state.sampleCount }}/{{ state.sampleCap }}
    </span>
    <ProgressBar
      v-if="state.rendering"
      :value="progress"
      :show-value="false"
      class="h-1.5 w-40"
      data-testid="render-progress"
    />
    <span class="text-muted-color" data-testid="resolution-readout">
      {{ state.resolutionWidth }}×{{ state.resolutionHeight }}
    </span>
    <span class="flex-1" />
    <label class="flex cursor-pointer items-center gap-2 text-muted-color">
      Denoise
      <ToggleSwitch
        :model-value="state.denoise"
        data-testid="denoise-toggle"
        @update:model-value="controller.setDenoise($event)"
      />
    </label>
    <Button
      label="Reset"
      icon="pi pi-undo"
      size="small"
      severity="secondary"
      text
      data-testid="reset-camera-button"
      @click="controller.resetCamera"
    />
    <Button
      label="Export"
      icon="pi pi-image"
      size="small"
      severity="secondary"
      outlined
      data-testid="export-button"
      @click="exportOpen = true"
    />
    <label class="flex items-center gap-2 text-muted-color">
      Samples
      <Select
        :model-value="state.sampleCap"
        :options="sampleCapOptions"
        size="small"
        class="w-28"
        data-testid="sample-cap-select"
        @update:model-value="controller.setSampleCap($event)"
      />
    </label>
    <Button
      v-if="accumulating"
      label="Stop"
      icon="pi pi-stop"
      size="small"
      severity="danger"
      data-testid="stop-button"
      @click="controller.stopRender"
    />
    <Button
      v-else
      label="Render"
      icon="pi pi-play"
      size="small"
      data-testid="render-button"
      @click="controller.startRender"
    />
  </footer>

  <ExportDialog v-model:visible="exportOpen" />
</template>

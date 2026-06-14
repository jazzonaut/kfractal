<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useMediaQuery } from "@vueuse/core";
import Button from "primevue/button";
import Popover from "primevue/popover";
import ProgressBar from "primevue/progressbar";
import { useController } from "../composables/use-controller";
import ExportDialog from "./ExportDialog.vue";
import StatusControls from "./StatusControls.vue";

const controller = useController();
const state = controller.state;

// Below Tailwind's `sm` breakpoint (mobile portrait / narrow windows) the secondary controls
// can't fit inline, so they collapse behind a hamburger popover. 639px (not 640) keeps the
// `sm`-and-up bar inline and leaves the smoke harness's 640px-wide pages in the wide layout.
const isCompact = useMediaQuery("(max-width: 639px)");

const exportOpen = ref(false);
const menu = ref<InstanceType<typeof Popover>>();
const bar = ref<HTMLElement>();

// Keep the canvas above the bar: reserve its measured height (it never collapses).
onMounted(() => controller.setViewportBottomInset(bar.value?.offsetHeight ?? 0));

// A finished render keeps presenting (rendering stays true); only offer Stop while
// samples are still accumulating.
const accumulating = computed(() => state.rendering && state.sampleCount < state.sampleCap);
const progress = computed(() =>
  Math.min(100, Math.round((state.sampleCount / state.sampleCap) * 100)),
);

// Shared by the inline and popover Export buttons: dismiss the popover (a no-op when it
// isn't open) so the dialog isn't left layered under a stale overlay.
function onExport(): void {
  menu.value?.hide();
  exportOpen.value = true;
}
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
      v-if="state.rendering && !isCompact"
      :value="progress"
      :show-value="false"
      class="h-1.5 w-40"
      data-testid="render-progress"
    />
    <span v-if="!isCompact" class="text-muted-color" data-testid="resolution-readout">
      {{ state.resolutionWidth }}×{{ state.resolutionHeight }}
    </span>
    <span class="flex-1" />

    <!-- Wide: the secondary controls sit inline. Narrow: they collapse behind a hamburger. -->
    <StatusControls v-if="!isCompact" @export="onExport" />
    <template v-else>
      <Button
        v-tooltip.top="'Controls'"
        icon="pi pi-bars"
        size="small"
        severity="secondary"
        text
        aria-label="Controls"
        data-testid="controls-menu-button"
        @click="menu?.toggle($event)"
      />
      <Popover ref="menu" data-testid="controls-menu">
        <StatusControls stacked @export="onExport" />
      </Popover>
    </template>

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

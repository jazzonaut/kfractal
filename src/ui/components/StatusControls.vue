<script setup lang="ts">
import { computed } from "vue";
import { useFullscreen, useMediaQuery } from "@vueuse/core";
import Button from "primevue/button";
import Select from "primevue/select";
import ToggleSwitch from "primevue/toggleswitch";
import { LIVE_RENDER_SCALE_CAP_CHOICES, SAMPLE_CAP_CHOICES } from "../../config/constants";
import { useController } from "../composables/use-controller";

// The secondary status-bar controls, shared by two arrangements: laid out inline in the bar
// on wide screens, or stacked inside the hamburger popover on narrow (mobile-portrait) ones.
// `stacked` switches the layout; Export is delegated up so the dialog stays owned by the bar.
const { stacked = false } = defineProps<{ stacked?: boolean }>();
const emit = defineEmits<{ export: [] }>();

const controller = useController();
const state = controller.state;

// Stable array identity: a [...spread] in the template would hand Select a fresh options
// prop on every re-render, forcing its subtree to re-render with it.
const sampleCapOptions = [...SAMPLE_CAP_CHOICES];
const liveRenderScaleOptions = LIVE_RENDER_SCALE_CAP_CHOICES.map((value) => ({
  label: `${Math.round(value * 100)}%`,
  value,
}));

// Whole-document fullscreen (no target = documentElement): hides the browser chrome so the
// render fills the screen. `isSupported` is false where the Fullscreen API isn't available
// (notably iPhone Safari), so the button hides rather than dead-clicking there.
const {
  isFullscreen,
  isSupported: fullscreenSupported,
  toggle: toggleFullscreen,
} = useFullscreen();
// Touch-only: desktop users have F11 / the OS chrome, so the button is just clutter there.
// Show it only on coarse-pointer devices, where there's no keyboard fullscreen shortcut.
const isTouch = useMediaQuery("(pointer: coarse)");
const showFullscreen = computed(() => fullscreenSupported.value && isTouch.value);
</script>

<template>
  <div :class="stacked ? 'flex flex-col items-stretch gap-3' : 'flex items-center gap-4'">
    <Button
      label="Reset"
      icon="pi pi-undo"
      size="small"
      severity="secondary"
      text
      :class="stacked ? 'justify-start' : ''"
      data-testid="reset-camera-button"
      @click="controller.resetCamera"
    />
    <label
      v-tooltip.top="
        'Deep-zoom dive: scrolling performs an infinite zoom into surface detail. Off makes the wheel fly the camera through surfaces instead.'
      "
      :class="
        stacked
          ? 'flex cursor-pointer items-center justify-between gap-2 text-muted-color'
          : 'flex cursor-pointer items-center gap-2 text-muted-color'
      "
    >
      Dive
      <ToggleSwitch
        :model-value="state.diveEnabled"
        data-testid="dive-enabled-toggle"
        @update:model-value="controller.setDiveEnabled($event)"
      />
    </label>
    <label
      v-tooltip.top="
        'Lower the live preview resolution when the device cannot keep up. Render and export stay full quality.'
      "
      :class="
        stacked
          ? 'flex cursor-pointer items-center justify-between gap-2 text-muted-color'
          : 'flex cursor-pointer items-center gap-2 text-muted-color'
      "
    >
      Auto quality
      <ToggleSwitch
        :model-value="state.autoQuality"
        data-testid="auto-quality-toggle"
        @update:model-value="controller.setAutoQuality($event)"
      />
    </label>
    <label
      v-tooltip.top="
        'Show the real path-traced lighting and colour in the live view (a downsampled render that settles once the camera stops) instead of the fast preview. The full Render and Export are unaffected.'
      "
      :class="
        stacked
          ? 'flex cursor-pointer items-center justify-between gap-2 text-muted-color'
          : 'flex cursor-pointer items-center gap-2 text-muted-color'
      "
    >
      Live render
      <ToggleSwitch
        :model-value="state.liveRender"
        data-testid="live-render-toggle"
        @update:model-value="controller.setLiveRender($event)"
      />
    </label>
    <label
      v-if="state.liveRender"
      v-tooltip.top="
        'Maximum internal resolution for the live path-traced preview. Render and export stay full quality.'
      "
      :class="
        stacked
          ? 'flex items-center justify-between gap-2 text-muted-color'
          : 'flex items-center gap-2 text-muted-color'
      "
    >
      Live scale
      <Select
        :model-value="state.liveRenderScaleCap"
        :options="liveRenderScaleOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="w-26"
        data-testid="live-render-scale-select"
        @update:model-value="controller.setLiveRenderScaleCap($event)"
      />
    </label>
    <label
      :class="
        stacked
          ? 'flex cursor-pointer items-center justify-between gap-2 text-muted-color'
          : 'flex cursor-pointer items-center gap-2 text-muted-color'
      "
    >
      Denoise
      <ToggleSwitch
        :model-value="state.denoise"
        data-testid="denoise-toggle"
        @update:model-value="controller.setDenoise($event)"
      />
    </label>
    <label
      :class="
        stacked
          ? 'flex items-center justify-between gap-2 text-muted-color'
          : 'flex items-center gap-2 text-muted-color'
      "
    >
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
      v-if="showFullscreen"
      v-tooltip.top="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
      :icon="isFullscreen ? 'pi pi-window-minimize' : 'pi pi-window-maximize'"
      :label="stacked ? (isFullscreen ? 'Exit fullscreen' : 'Fullscreen') : undefined"
      size="small"
      severity="secondary"
      text
      :class="stacked ? 'justify-start' : ''"
      :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
      data-testid="fullscreen-button"
      @click="toggleFullscreen"
    />
    <Button
      label="Export"
      icon="pi pi-image"
      size="small"
      severity="secondary"
      outlined
      :class="stacked ? 'justify-start' : ''"
      data-testid="export-button"
      @click="emit('export')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import Accordion from "primevue/accordion";
import AccordionContent from "primevue/accordioncontent";
import AccordionHeader from "primevue/accordionheader";
import AccordionPanel from "primevue/accordionpanel";
import Button from "primevue/button";
import LibraryPicker from "./LibraryPicker.vue";
import PresetActions from "./PresetActions.vue";
import CameraLensSection from "./sections/CameraLensSection.vue";
import NavigationSection from "./sections/NavigationSection.vue";
import EffectsSection from "./sections/EffectsSection.vue";
import GrowthSection from "./sections/GrowthSection.vue";
import LightingSection from "./sections/LightingSection.vue";
import GradeSection from "./sections/GradeSection.vue";
import FormulaSection from "./sections/FormulaSection.vue";
import ChainSection from "./sections/ChainSection.vue";
import WarpSection from "./sections/WarpSection.vue";
import MaterialSection from "./sections/MaterialSection.vue";
import PaletteSection from "./sections/PaletteSection.vue";
import { useController } from "../composables/use-controller";
import { useInspectorPrefs } from "../composables/use-inspector-prefs";

const controller = useController();
const state = controller.state;
const { collapsed, openFor, setOpen } = useInspectorPrefs();

// Keep the canvas out from under the panel: reserve the panel's width while open.
const PANEL_WIDTH = 380;
watch(collapsed, (value) => controller.setViewportRightInset(value ? 0 : PANEL_WIDTH), {
  immediate: true,
});

// Section registry: a future effect is one entry here plus its section component.
const sections = computed(() => [
  { id: "camera", title: "Camera & Lens", component: CameraLensSection },
  { id: "navigation", title: "Navigation", component: NavigationSection },
  { id: "palette", title: "Palette", component: PaletteSection },
  { id: "lighting", title: "Lighting", component: LightingSection },
  { id: "grade", title: "Grade", component: GradeSection },
  { id: "effects", title: "Effects", component: EffectsSection },
  { id: "material", title: "Material", component: MaterialSection },
  {
    id: "formula",
    title: state.chainActive ? "Hybrid chain" : state.formulaName,
    component: state.chainActive ? ChainSection : FormulaSection,
  },
  { id: "warp", title: "Warp", component: WarpSection },
  { id: "growth", title: "Growth", component: GrowthSection },
]);

const sectionIds = computed(() => sections.value.map((s) => s.id));
</script>

<template>
  <button
    v-if="collapsed"
    type="button"
    class="pointer-events-auto fixed right-0 top-1/2 -translate-y-1/2 rounded-l-lg border border-r-0 border-white/10 bg-surface-950/70 px-1.5 py-4 text-xs tracking-widest text-muted-color backdrop-blur-xl transition-colors [writing-mode:vertical-rl] hover:text-surface-100"
    data-testid="inspector-toggle"
    @click="collapsed = false"
  >
    Controls
  </button>

  <aside
    v-else
    class="pointer-events-auto fixed bottom-12 right-0 top-0 flex flex-col border-l border-white/10 bg-surface-950/70 backdrop-blur-xl"
    :style="{ width: `${PANEL_WIDTH}px` }"
    data-testid="inspector"
  >
    <header class="flex items-center justify-between px-4 pb-2 pt-3">
      <h1 class="text-sm font-semibold tracking-wide text-surface-100">Controls</h1>
      <Button
        label="Hide"
        icon="pi pi-chevron-right"
        size="small"
        severity="secondary"
        text
        data-testid="inspector-collapse"
        @click="collapsed = true"
      />
    </header>

    <div class="flex-1 overflow-y-auto px-4 pb-4">
      <LibraryPicker kind="preset" show-description />
      <div class="grid grid-cols-2 gap-2 pt-2">
        <div class="flex flex-col gap-1">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-color">Shape</p>
          <LibraryPicker kind="shape" />
        </div>
        <div class="flex flex-col gap-1">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-color">Look</p>
          <LibraryPicker kind="look" />
        </div>
      </div>
      <PresetActions />

      <Accordion
        class="mt-3"
        :value="openFor(sectionIds)"
        multiple
        @update:value="setOpen(sectionIds, $event)"
      >
        <AccordionPanel v-for="section in sections" :key="section.id" :value="section.id">
          <AccordionHeader>{{ section.title }}</AccordionHeader>
          <AccordionContent>
            <component :is="section.component" />
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
    </div>
  </aside>
</template>

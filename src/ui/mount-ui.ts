import { createApp } from "vue";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import Tooltip from "primevue/tooltip";
import Aura from "@primeuix/themes/aura";
import { definePreset } from "@primeuix/themes";
import AppUi from "./AppUi.vue";
import { CONTROLLER_KEY } from "./composables/use-controller";
import type { Controller } from "./controller";

// Aura tuned to the KFractal look: blue-tinted near-black surfaces, cyan primary.
// Accordion headers/content stay transparent so the inspector's glass panel shows
// through; hairline panel borders give each section its visual separation.
const KfPreset = definePreset(Aura, {
  semantic: {
    primary: {
      50: "{sky.50}",
      100: "{sky.100}",
      200: "{sky.200}",
      300: "{sky.300}",
      400: "{sky.400}",
      500: "{sky.500}",
      600: "{sky.600}",
      700: "{sky.700}",
      800: "{sky.800}",
      900: "{sky.900}",
      950: "{sky.950}",
    },
    colorScheme: {
      dark: {
        surface: {
          0: "#ffffff",
          50: "#eef1fb",
          100: "#dce6ff",
          200: "#b9c8ec",
          300: "#94a6d2",
          400: "#6f84b3",
          500: "#506292",
          600: "#3b4a74",
          700: "#2a3658",
          800: "#1a2340",
          900: "#0b1228",
          950: "#04060f",
        },
      },
    },
  },
  components: {
    accordion: {
      // Near-zero horizontal padding: the inspector's own gutter is the main inset,
      // so headers and section content span almost the full panel width.
      header: { padding: "0.875rem 3px" },
      content: { padding: "0 3px 1rem 3px" },
      colorScheme: {
        dark: {
          // Hairline rule between sections, matching the in-section border-white/10 dividers.
          panel: { borderColor: "rgba(255,255,255,0.08)" },
          header: {
            background: "transparent",
            hoverBackground: "transparent",
            activeBackground: "transparent",
            activeHoverBackground: "transparent",
          },
          content: { background: "transparent" },
        },
      },
    },
  },
});

export function mountUi(controller: Controller): void {
  const container = document.getElementById("ui");
  if (!container) return;
  const app = createApp(AppUi);
  app.use(PrimeVue, {
    theme: {
      preset: KfPreset,
      options: {
        darkModeSelector: ".dark",
        cssLayer: {
          name: "primevue",
          order: "theme, base, primevue, components, utilities",
        },
      },
    },
  });
  app.use(ToastService);
  app.directive("tooltip", Tooltip);
  app.provide(CONTROLLER_KEY, controller);
  app.mount(container);
}

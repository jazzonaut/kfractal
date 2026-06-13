import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// WebGPU-only workstation; no SSR. Keep `/` until a deploy target exists.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: { open: false },
});

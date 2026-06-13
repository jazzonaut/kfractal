import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// WebGPU-only workstation; no SSR. Local dev/preview serve from `/`; the GitHub Pages
// deploy (jazzonaut.github.io/kfractal/) sets GITHUB_PAGES=true so emitted asset URLs
// resolve under the repo subpath.
export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/kfractal/" : "/",
  plugins: [vue(), tailwindcss()],
  server: { open: false },
});

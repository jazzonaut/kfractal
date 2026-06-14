import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

/**
 * Bakes a per-build version into the offline service worker (public/sw.js).
 *
 * public/ files are copied verbatim and never transformed by Vite, so the SW can't read
 * `import.meta.env`. This plugin instead computes a hash of the emitted bundle (whose
 * filenames already embed content hashes) and rewrites the `__SW_VERSION__` placeholder in
 * the copied `dist/sw.js`. Because the SW's bytes then change on every content-changing
 * deploy, the browser reinstalls it -> the cached shell tracks the latest deploy and the
 * `activate` handler prunes stale caches instead of letting them accumulate forever.
 */
function swVersion(): Plugin {
  let outDir = "dist";
  let version = "dev";
  return {
    name: "sw-version",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      // Hash the sorted emitted filenames; each embeds a content hash, so any code/style
      // change rolls the version. (Public-dir assets aren't in the bundle, so a bare
      // favicon/manifest swap won't bump it — bump manually if that ever matters.)
      const names = Object.keys(bundle).toSorted().join("\n");
      version = createHash("sha256").update(names).digest("hex").slice(0, 12);
    },
    closeBundle() {
      // closeBundle runs after Vite has copied public/ into outDir, so dist/sw.js exists.
      const swPath = resolve(outDir, "sw.js");
      const src = readFileSync(swPath, "utf8");
      writeFileSync(swPath, src.replaceAll("__SW_VERSION__", version));
    },
  };
}

// WebGPU-only workstation; no SSR. Local dev/preview serve from `/`; the GitHub Pages
// deploy (jazzonaut.github.io/kfractal/) sets GITHUB_PAGES=true so emitted asset URLs
// resolve under the repo subpath.
export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/kfractal/" : "/",
  plugins: [vue(), tailwindcss(), swVersion()],
  server: { open: false },
});

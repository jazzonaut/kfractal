/*
 * KFractal offline service worker (hand-rolled; no build plugin).
 *
 * Why not a precache manifest of the hashed bundle? Vite renames JS/CSS on every build
 * (index-<hash>.js), so a static list would rot. Instead we precache only the stable shell
 * (the URLs whose names never change) and let runtime caching pick up the hashed assets the
 * first time they're fetched. Because a hashed name is immutable, cache-first is always safe
 * for them; a new deploy simply requests new names that get cached on first online load.
 *
 * The SW is served as a static file from the deploy root, so it is NOT processed by Vite and
 * never sees `import.meta.env.BASE_URL`. We recover the base path from the SW's own location
 * (".../kfractal/sw.js" -> base "/kfractal/", ".../sw.js" -> base "/") so the same file works
 * both at the local root and under the GitHub Pages repo subpath.
 */

const BASE = new URL("./", self.location.href).pathname;
// Injected at build time by the `sw-version` plugin in vite.config.ts: a hash of the emitted
// bundle, so it changes on every content-changing deploy. That makes this file's bytes change
// too, which forces the browser to reinstall the SW -> `install` re-precaches the CURRENT
// shell and `activate` prunes every non-current cache. Without that, a fixed version would
// freeze the precached shell at first install and let RUNTIME_CACHE grow unbounded (cache-first
// + no eviction) across deploys. In dev the placeholder is left literal, but the SW is only
// ever registered in production, so it never runs with the unsubstituted value.
const VERSION = "__SW_VERSION__";
const SHELL_CACHE = `kfractal-shell-${VERSION}`;
const RUNTIME_CACHE = `kfractal-runtime-${VERSION}`;

// Stable-named entries that make up the bootable app shell. The hashed JS/CSS the shell
// pulls in are cached on demand by the fetch handler below.
const SHELL_URLS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}favicon.svg`,
  `${BASE}icon-192.png`,
  `${BASE}icon-512.png`,
  `${BASE}apple-touch-icon.png`,
];

self.addEventListener("install", (event) => {
  // Take over as soon as installed rather than waiting for every old tab to close.
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // Tolerate a missing optional asset (e.g. an icon renamed later) so one 404 can't
      // abort the whole install and leave the app uncacheable.
      Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only same-origin GETs are cacheable; let everything else (POSTs, cross-origin, etc.)
  // hit the network untouched.
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigations: network-first so a fresh deploy is picked up while online, falling back to
  // the cached shell so the app still boots offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        () =>
          caches.match(request).then((hit) => hit ?? caches.match(`${BASE}index.html`)),
      ),
    );
    return;
  }

  // Assets (hashed JS/CSS, icons, fonts): cache-first, populating the runtime cache on miss.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        // Only cache complete, basic (same-origin) responses; opaque/partial responses
        // would poison the cache with unusable bodies.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});

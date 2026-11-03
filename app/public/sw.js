// El service worker del escáner del voluntario. Se registra solo desde /scan, con ese alcance, y
// guarda en caché lo que la página necesita para abrir sin red: el HTML, los scripts, los estilos
// y las fuentes. Va a la red primero y, si no hay, sirve lo guardado. Lo de /api no pasa por acá:
// la cola local se encarga de reintentar.
const CACHE = "rumbo-escaner-v2";
const NAVIGATE_TIMEOUT_MS = 20000;
const ASSET_TIMEOUT_MS = 15000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("rumbo-escaner-") && key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// La página, al cargar, manda las URL que ya usó para que queden guardadas aunque la primera carga
// haya ocurrido antes de que este worker tomara el control.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "warm" || !Array.isArray(data.urls)) return;
  event.waitUntil(warm(data.urls));
});

async function warm(urls) {
  const cache = await caches.open(CACHE);
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (await cache.match(url, { ignoreVary: true })) return;
        const response = await fetch(url, { credentials: "same-origin" });
        if (response.ok || response.type === "opaque") await cache.put(url, response);
      } catch {
        /* sin red o sin ese archivo: queda para la próxima */
      }
    }),
  );
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("la red no contestó a tiempo")), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isCacheable(request, url) {
  if (request.method !== "GET") return false;
  if (url.origin === self.location.origin) return !url.pathname.startsWith("/api/");
  return url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const navigating = request.mode === "navigate";
  // Los archivos de /_next/static llevan el hash en el nombre; en desarrollo Next les agrega además
  // ?v=<momento de cada render>, así que se buscan sin la consulta.
  const ignoreSearch = navigating || new URL(request.url).pathname.startsWith("/_next/static/");
  try {
    const response = await fetchWithTimeout(request, navigating ? NAVIGATE_TIMEOUT_MS : ASSET_TIMEOUT_MS);
    if (response && (response.ok || response.type === "opaque")) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch, ignoreVary: true });
    if (hit) return hit;
    if (navigating) {
      const shell = await cache.match("/scan", { ignoreSearch: true, ignoreVary: true });
      if (shell) return shell;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!isCacheable(event.request, url)) return;
  event.respondWith(networkFirst(event.request));
});

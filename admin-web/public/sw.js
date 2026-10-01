/* GIVOVA Coleta service worker: lets /coleta reopen offline. Scans live in IndexedDB, not here. */
importScripts("/sw-policy.js");

var CACHE = "givova-coleta-v1";
var PRECACHE = ["/coleta", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // Best effort: a missing asset must not block installation.
      return Promise.all(PRECACHE.map(function (u) { return cache.add(u).catch(function () {}); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function cacheable(response) {
  return response && response.ok && response.type === "basic";
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  var policy = self.GivovaSwPolicy.cachePolicy(req.url, req.method, req.mode, self.location.origin);
  if (policy === "bypass") return; // browser handles it normally (no caching)

  if (policy === "cache-first") {
    event.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          if (cacheable(res)) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // network-first-shell: fresh page when online, cached /coleta when offline
  event.respondWith(
    fetch(req).then(function (res) {
      if (cacheable(res)) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put("/coleta", copy); });
      }
      return res;
    }).catch(function () {
      return caches.match("/coleta").then(function (hit) {
        return hit || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      });
    })
  );
});

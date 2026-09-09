// CacheStorage is shared by every application on this origin. Scope both
// lookup and cleanup to this installation, including GitHub Pages subpaths.
var CACHE_PREFIX = "kalidoface-psx:" + self.registration.scope + ":";
var CACHE = CACHE_PREFIX + "v2";

self.addEventListener("install", function (event) {
  // The first page and its scripts loaded before this worker controlled it.
  // Cache the shell explicitly or that first visit cannot reopen offline.
  event.waitUntil(cacheShell().then(function () { return self.skipWaiting(); }));
});

function cacheShell() {
  var scope = self.registration.scope;
  var index = new URL("index.html", scope).href;
  var css = new URL("global.css", scope).href;
  return Promise.all([
    fetch(index, { cache: "reload" }).then(shellText),
    fetch(css, { cache: "reload" }).then(shellText)
  ]).then(function (texts) {
    var urls = [scope, index, css];
    function add(rel) {
      var url = new URL(rel, scope).href;
      if (url.indexOf(scope) === 0 && urls.indexOf(url) < 0) urls.push(url);
    }
    var m, links = /(?:src|href)=["'](\.\/[^"']+)["']/g;
    while ((m = links.exec(texts[0]))) add(m[1]);
    var fonts = /url\(["']?(\.\/[^"')]+)["']?\)/g;
    while ((m = fonts.exec(texts[1]))) add(m[1]);
    return caches.open(CACHE).then(function (c) { return c.addAll(urls); });
  });
}

function shellText(res) {
  if (!res.ok) throw new Error("Cannot cache the app shell: " + res.status);
  return res.text();
}

// Take over the pages that are already open, so a fix does not wait for every
// tab to be closed before it can be served. Only older versions belonging to
// this scope are removed. Legacy unscoped caches are left alone because their
// name does not prove which application owns them.
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (n) {
            return n !== CACHE && n.indexOf(CACHE_PREFIX) === 0 ? caches.delete(n) : null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// Network first, falling back to the cache, and every successful response is
// written back.
//
// This was cache first, and a cache written by an earlier version of this
// worker outlives it - so a cache-first worker served that forever. The app is
// a patched bundle plus psx.js, both at paths that never change name, so
// "forever" meant a deploy could not reach anyone who had already opened the
// site once. That is not a stale asset, it is a fix that never ships. Network
// first has no such failure: the network wins whenever it answers.
//
// It also used to write nothing at all, which left the fallback permanently
// empty - the worker claimed to work offline and did not. It matters here
// because docs/vendor/ now holds ~55 MB of Mediapipe wasm and tflite that used
// to come from a CDN: on the second load that is served from disk instead of
// fetched, which on a Raspberry Pi is the difference between a slow start and
// a start that does not need the network at all.
self.addEventListener("fetch", function (event) {
  var req = event.request;

  // Only our own GETs. A cross-origin request intercepted here turns a blocked
  // third-party into an uncaught TypeError in this worker, and a POST has no
  // business in a cache.
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.href.indexOf(self.registration.scope) !== 0) return;
  if (req.headers.has("range")) return;

  var write = Promise.resolve();
  var response = fetch(req)
      .then(function (res) {
        // Only complete, ordinary responses. A 404 or a range response (the
        // browser asks for those on media) is not a copy of the file.
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          // Extend the worker lifetime without delaying the response. Large
          // wasm files otherwise lose their cache write when the worker exits.
          write = caches
            .open(CACHE)
            .then(function (c) {
              return c.put(req, copy);
            })
            .catch(function () {});
        }
        if (res.status >= 500) {
          return caches.open(CACHE).then(function (c) {
            return c.match(req);
          }).then(function (hit) { return hit || res; }).catch(function () { return res; });
        }
        return res;
      })
      .catch(function () {
        return caches.open(CACHE).then(function (c) {
          return c.match(req).then(function (hit) {
            if (hit || req.mode !== "navigate") return hit;
            return c.match(new URL("index.html", self.registration.scope).href);
          });
        }).then(function (hit) {
          if (hit) return hit;
          // Nothing cached and no network: let it fail as it would have without
          // a worker in the way, rather than resolving to undefined.
          throw new Error("offline and not cached: " + req.url);
        });
      });
  event.respondWith(response);
  event.waitUntil(response.then(function () { return write; }).catch(function () {}));
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { once } from 'node:events';
import { createSiteServer } from './serve.mjs';
import { runtime } from './test-support.mjs';

const cal = { browRest: 0, browDown: -0.1, browUp: 0.1, smileRest: 0, smileMax: 1 };
const r = runtime({ cal });
const original = r.cfg.cal;
r.setRun();
const report = r.psx.importSettings({ pixelRatio: 0.5, cal: { broken: true } });
assert.equal(r.cfg.cal, original, 'a rejected import preserves the working calibration');
assert.equal(r.cfg.pixelRatio, 0.5, 'valid fields of the same import still apply');
assert.equal(r.getRun(), null, 'an old wizard must not overwrite imported settings later');
assert.ok(report.includes('unusable'));
const poisoned = runtime(JSON.parse('{"__proto__":{"polluted":true},"constructor":null,"fingers":"all"}'));
assert.equal(poisoned.cfg.polluted, undefined, 'saved settings cannot replace the configuration prototype');
assert.equal(typeof poisoned.cfg.constructor, 'function');
r.frame([], [], { Right: [{}] });
r.psx.hands({ Right: null, Left: null }, null);
assert.equal(r.getPose(), null, 'loss of the image pose clears stale arm tracking');
let disposed = 0;
const model = { dispose() { disposed++; return 7; } };
r.psx.onModel(model, { parser: { json: {} } });
assert.equal(r.modelCount(), 1);
assert.equal(model.dispose(), 7, 'the original dispose method still runs and returns its result');
assert.equal(disposed, 1);
assert.equal(r.modelCount(), 0, 'disposed models must leave the PSX registry');
assert.equal(model.__psxGltf, null, 'the retained glTF document is released');
const incomplete = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
incomplete[23] = null;
r.psx.pose(incomplete, null, null);
assert.equal(r.getPose(), null, 'an incomplete torso is rejected before bone math runs');
assert.equal(r.cfg.armIK, true, 'a bad tracking packet must not disable the retarget');

const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const stubSource = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map(m => m[1]).find(s => s.includes('window.PSX ='));
const stubWindow = {};
vm.runInNewContext(stubSource, { window: stubWindow });
const bundleName = html.match(/type="module"[^>]+src="\.\/([^\"]+)"/)[1];
const bundle = fs.readFileSync(new URL('../docs/' + bundleName, import.meta.url), 'utf8');
for (const [hook, count] of Object.entries(r.expected)) {
  assert.equal(typeof stubWindow.PSX[hook], 'function', `fallback stub covers ${hook}`);
  assert.equal(typeof r.psx[hook], 'function', `live API covers ${hook}`);
  assert.equal((bundle.match(new RegExp('window\\.PSX\\.' + hook + '\\b', 'g')) || []).length,
    count, `bundle call-site count for ${hook}`);
}

const workerSource = fs.readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8');
const scope = 'https://example.test/kalidoface/';
const prefix = 'kalidoface-psx:' + scope + ':';
const current = prefix + 'v2';
const stored = new Map(), deleted = [], handlers = {}, shellFiles = [];
let online = true, responseStatus = 200, writeFinished = false;
let completeWrite;
const cache = {
  addAll: async urls => { shellFiles.push(...urls); },
  match: async req => stored.get(req.url),
  put: async (req, res) => {
    await new Promise(resolve => { completeWrite = resolve; });
    stored.set(req.url, res); writeFinished = true;
  }
};
vm.runInNewContext(workerSource, {
  URL, console,
  self: { registration: { scope }, location: { origin: 'https://example.test' },
    addEventListener: (name, fn) => { handlers[name] = fn; },
    skipWaiting() {}, clients: { claim: async () => {} } },
  caches: {
    keys: async () => [prefix + 'v1', current, 'unrelated-app', 'psx-v1'],
    delete: async name => { deleted.push(name); },
    open: async name => { assert.equal(name, current); return cache; }
  },
  fetch: async url => {
    if (!online) throw new Error('offline');
    return { ok: responseStatus === 200, status: responseStatus, type: 'basic',
      text: async () => String(url).endsWith('global.css') ? 'src:url("./vendor/font/font.woff")'
        : '<script src="./psx.js"></script><script src="./assets/index.hash.js"></script><img src="https://external.test/x.png">',
      clone() { return { cached: true }; } };
  }
});
let installation;
handlers.install({ waitUntil: p => { installation = p; } });
await installation;
assert.ok(shellFiles.includes(scope + 'assets/index.hash.js'));
assert.ok(shellFiles.includes(scope + 'vendor/font/font.woff'));
assert.ok(shellFiles.every(url => url.startsWith(scope)), 'first-visit precache stays inside this installation');
let activation;
handlers.activate({ waitUntil: p => { activation = p; } });
await activation;
assert.deepEqual(deleted, [prefix + 'v1'], 'activation must not delete another app cache');
function event(url, range = false) {
  return { request: { url, method: 'GET', headers: { has: () => range } },
    respondWith(p) { this.response = p; }, waitUntil(p) { this.lifetime = p; } };
}
for (const url of ['https://example.test.evil/kalidoface/a', 'https://example.test/another-app/a']) {
  const e = event(url); handlers.fetch(e); assert.equal(e.response, undefined);
}
const range = event(scope + 'video.mp4', true); handlers.fetch(range);
assert.equal(range.response, undefined, 'range requests are not stored as complete files');
const request = event(scope + 'psx.js'); handlers.fetch(request);
assert.equal((await request.response).status, 200);
assert.equal(writeFinished, false, 'network response must not wait for the disk');
assert.ok(request.lifetime, 'cache writes must extend the worker lifetime');
completeWrite(); await request.lifetime;
assert.equal(writeFinished, true);
online = false;
const offline = event(scope + 'psx.js'); handlers.fetch(offline);
assert.equal((await offline.response).cached, true);
await offline.lifetime;
online = true; responseStatus = 503;
const unavailable = event(scope + 'psx.js'); handlers.fetch(unavailable);
assert.equal((await unavailable.response).cached, true, 'a temporary server error can use the saved app');
await unavailable.lifetime;

const server = createSiteServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes('./psx.js'));
  const script = await fetch(base + '/psx.js', { method: 'HEAD' });
  assert.equal(script.status, 200); assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal(await script.text(), '');
  const wasm = await fetch(base + '/vendor/mediapipe/holistic/holistic_solution_wasm_bin.wasm', { method: 'HEAD' });
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e%5cpackage.json')).status, 400);
  assert.equal((await fetch(base + '/%00')).status, 400);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log('System regressions passed: import preservation, wizard cancellation, settings isolation, tracking loss, offline cache, static HTTP server.');

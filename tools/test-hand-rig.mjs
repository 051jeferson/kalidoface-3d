import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { createSiteServer } from './serve.mjs';

const { chromium } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : 'playwright');
const server = createSiteServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  const source = await readFile(new URL('../docs/psx.js', import.meta.url), 'utf8');
  await page.addScriptTag({ content: source.replace(/\}\)\(\);\s*$/, `
    window.rigTest = { armCache, aimBone, applyPalmRoll, palmAcross, twistAngle, restQuat,
      worldPos, vnorm, vsub, vdot };
  })();`) });
  const results = await page.evaluate(async () => {
    const { ae: Group } = await import('./assets/vendor.832d142e.js');
    const t = window.rigTest;
    const results = [];
    for (const side of ['Right', 'Left'])
      for (const bind of [false, true])
      for (const roll of [0, 45, 90, 170])
      for (const flex of [0, 30, 60, 85]) {
        const root = new Group(), bones = {};
        const sign = side === 'Right' ? -1 : 1;
        function bone(name, parent, x, y, z) {
          const b = new Group(); b.position.set(x, y, z); parent.add(b); bones[name] = b;
          return b;
        }
        const hips = bone('hips', root, 0, 0, 0);
        const upper = bone(side.toLowerCase() + 'UpperArm', hips, sign * 0.2, 1, 0);
        bone(side === 'Right' ? 'leftUpperArm' : 'rightUpperArm', hips, -sign * 0.2, 1, 0);
        const lower = bone(side.toLowerCase() + 'LowerArm', upper, sign * 0.3, 0, 0);
        const hand = bone(side.toLowerCase() + 'Hand', lower, sign * 0.25, 0, 0);
        const middle = bone(side.toLowerCase() + 'MiddleProximal', hand, sign * 0.08, 0, 0);
        bone(side.toLowerCase() + 'IndexProximal', hand, sign * 0.07, 0, 0.03);
        bone(side.toLowerCase() + 'LittleProximal', hand, sign * 0.07, 0, -0.03);
        const vrm = { humanoid: { getBoneNode: name => bones[name] } };
        if (bind) {
          lower.rotation.set(0.2, -0.3, 0.1);
          hand.rotation.set(-0.3, 0.15, 0.2);
        }
        t.restQuat(upper); t.restQuat(lower); t.restQuat(hand);
        const c = t.armCache(vrm);
        const rad = flex * Math.PI / 180;
        const forward = { x: sign * Math.cos(rad), y: Math.sin(rad), z: 0 };
        const turn = roll * Math.PI / 180;
        const across = { x: -sign * Math.sin(rad) * Math.cos(turn), y: Math.cos(rad) * Math.cos(turn), z: Math.sin(turn) };
        const axis = t.vnorm(t.vsub(t.worldPos(hand), t.worldPos(lower)));
        t.aimBone(c, hand, middle, forward);
        const angle = t.twistAngle(t.palmAcross(vrm, side, false), across, forward);
        t.applyPalmRoll(c, lower, hand, axis, angle, forward);
        const actual = t.palmAcross(vrm, side, false);
        const aim = t.vnorm(t.vsub(t.worldPos(middle), t.worldPos(hand)));
        results.push({ side, bind, roll, flex,
          aimError: Math.acos(Math.max(-1, Math.min(1, t.vdot(aim, forward)))) * 180 / Math.PI,
          error: Math.acos(Math.max(-1, Math.min(1, t.vdot(actual, across)))) * 180 / Math.PI });
      }
    return results;
  });
  console.log('Palm orientation:', JSON.stringify({ cases: results.length,
    maxError: Math.max(...results.map(r => r.error)), maxAimError: Math.max(...results.map(r => r.aimError)) }));
  assert.ok(results.every(r => r.error < 1), 'wrist flexion must preserve the tracked palm orientation');
  assert.ok(results.every(r => r.aimError < 1), 'palm roll must preserve the direction of the fingers');
} finally {
  if (browser) await browser.close();
  server.close();
}

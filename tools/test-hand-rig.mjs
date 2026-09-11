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
      worldPos, vnorm, vsub, vdot, palmRollAngle, palmReference, handWant,
      observe: function (image, hands) { poseImg = image; poseHand = hands; imgSeq++; }
    };
  })();`) });
  const results = await page.evaluate(async () => {
    const { ae: Group } = await import('./assets/vendor.832d142e.js');
    const t = window.rigTest;
    const results = [];
    for (const side of ['Right', 'Left'])
      for (const basis of ['knuckles', 'thumb'])
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
        if (basis === 'knuckles') {
          bone(side.toLowerCase() + 'IndexProximal', hand, sign * 0.07, 0, 0.03);
          bone(side.toLowerCase() + 'LittleProximal', hand, sign * 0.07, 0, -0.03);
        } else {
          bone(side.toLowerCase() + 'ThumbProximal', hand, sign * 0.08, 0, 0.06);
        }
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
        // Enter through the detector's image-space landmarks, not just an
        // already-correct target vector handed to the rotation helper.
        const p = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
        const image = Array.from({ length: 33 }, () => p(0.5, 0.5));
        image[11] = p(0.3, 0.3); image[12] = p(0.7, 0.3);
        image[23] = p(0.3, 0.8); image[24] = p(0.7, 0.8);
        image[0] = p(0.5, 0.1, -0.1);
        const landmarks = Array.from({ length: 21 }, () => p(0.5, 0.5));
        landmarks[9] = p(0.5 + forward.x * 0.1, 0.5 - forward.y * 0.1, -forward.z * 0.1);
        landmarks[5] = p(0.5 + across.x * 0.05, 0.5 - across.y * 0.05, -across.z * 0.05);
        landmarks[17] = p(0.5 - across.x * 0.05, 0.5 + across.y * 0.05, across.z * 0.05);
        landmarks[1] = p(landmarks[9].x + across.x * 0.05,
          landmarks[9].y - across.y * 0.05, landmarks[9].z - across.z * 0.05);
        t.observe(image, { [side]: landmarks });
        const reference = t.palmReference(vrm, side, false);
        const detected = t.handWant(side, { x: p(1, 0), y: p(0, 1), z: p(0, 0, 1) }, 1, { x: 1, y: 1, z: 1 }, reference);
        const axis = t.vnorm(t.vsub(t.worldPos(hand), t.worldPos(lower)));
        t.aimBone(c, hand, middle, detected.fwd);
        const angle = t.twistAngle(t.palmAcross(vrm, side, false), detected.across, detected.fwd);
        t.applyPalmRoll(c, lower, hand, axis, angle, forward);
        const actual = t.palmAcross(vrm, side, false);
        const aim = t.vnorm(t.vsub(t.worldPos(middle), t.worldPos(hand)));
        results.push({ side, basis, reference: reference.name, bind, roll, flex,
          aimError: Math.acos(Math.max(-1, Math.min(1, t.vdot(aim, forward)))) * 180 / Math.PI,
          error: Math.acos(Math.max(-1, Math.min(1, t.vdot(actual, across)))) * 180 / Math.PI });
        // Move the forearm's zero while keeping the same observed palm.
        // Low-pass filtering the old scalar instead would rotate this palm.
        lower.quaternion.copy(lower.__psxRest);
        lower.rotateX(0.7);
        t.aimBone(c, hand, middle, detected.fwd);
        const newAxis = t.vnorm(t.vsub(t.worldPos(hand), t.worldPos(lower)));
        const compensated = t.palmRollAngle(t.palmAcross(vrm, side, false), detected.across, detected.fwd, actual, 0.1);
        t.applyPalmRoll(c, lower, hand, newAxis, compensated, detected.fwd);
        const moved = t.palmAcross(vrm, side, false);
        results.at(-1).movingError = Math.acos(Math.max(-1, Math.min(1, t.vdot(moved, across)))) * 180 / Math.PI;
      }
    return results;
  });
  console.log('Palm orientation:', JSON.stringify({ cases: results.length,
    maxError: Math.max(...results.map(r => r.error)), maxAimError: Math.max(...results.map(r => r.aimError)),
    maxMovingError: Math.max(...results.map(r => r.movingError)) }));
  assert.ok(results.every(r => r.error < 1), 'wrist flexion must preserve the tracked palm orientation');
  assert.ok(results.every(r => r.aimError < 1), 'palm roll must preserve the direction of the fingers');
  assert.ok(results.every(r => r.movingError < 1), 'moving the forearm must not turn a stationary palm');
  assert.ok(results.every(r => r.reference === (r.basis === 'thumb' ? 'thumb-middle' : 'index-little')),
    'simplified models use the thumb base on both model and detector');
} finally {
  if (browser) await browser.close();
  server.close();
}

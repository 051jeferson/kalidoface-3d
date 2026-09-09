import assert from 'node:assert/strict';
import { runtime } from './test-support.mjs';

// Exercise the shipped classic script, without loading the UI or a webcam.
const r = runtime();
const rad = d => d * Math.PI / 180;
const p = (x, y, z = 0) => ({ x, y, z, visibility: 1 });
const idx = { shoulder: 11, elbow: 13, wrist: 15, hip: 23 };
function pose() {
  const a = Array.from({ length: 33 }, () => p(0.5, 0.5));
  a[11] = p(0.3, 0.3); a[12] = p(0.7, 0.3);
  a[23] = p(0.35, 0.8); a[24] = p(0.65, 0.8);
  a[7] = p(0.45, 0.15); a[8] = p(0.55, 0.15);
  a[0] = p(0.5, 0.15, -0.05);
  a[15] = p(0.35, 0.71);
  return a;
}

assert.ok(Math.abs(r.followRoll(rad(179), rad(-179), 0.5) - Math.PI) < 1e-10,
  'the palm must cross the seam by 2 degrees, not unwind by 358');
assert.ok(Math.abs(r.followRoll(rad(-179), rad(179), 0.5) + Math.PI) < 1e-10);
assert.equal(r.followRoll(undefined, 1, 0.5), 1);

// Tiny opposite perturbations near the forearm axis used to request opposite
// palms. A well-conditioned quarter turn must still be measurable.
assert.equal(r.twistAngle(p(1, 0), p(0.001, 0, 1), p(0, 0, 1)), null);
assert.equal(r.twistAngle(p(1, 0), p(-0.001, 0, 1), p(0, 0, 1)), null);
assert.equal(r.twistAngle(p(0.001, 0, 1), p(1, 0), p(0, 0, 1)), null);
assert.ok(Math.abs(r.twistAngle(p(1, 0), p(0, 1), p(0, 0, 1)) - Math.PI / 2) < 1e-10);
const reading = { seq: -1, angle: null, pending: null, count: 0 };
assert.equal(r.stableRoll(reading, 0, 0), 0);
for (let i = 0; i < 144; i++) assert.equal(r.stableRoll(reading, rad(170), 1), null);
assert.equal(reading.count, 1, 'render retries cannot confirm a detector flip');
assert.equal(r.stableRoll(reading, rad(5), 2), rad(5), 'one bad sample does not disturb a held palm');
assert.equal(r.stableRoll(reading, rad(170), 3), null);
assert.equal(r.stableRoll(reading, rad(175), 4), null);
assert.equal(r.stableRoll(reading, rad(178), 5), rad(178), 'a consistent new pose recovers');
assert.equal(r.stableRoll(reading, rad(-179), 6), rad(-179), 'the angular seam is not a flip');
assert.equal(r.stableRoll(reading, null, 7), null);
assert.equal(r.stableRoll(reading, 0, 8), null);
assert.equal(r.stableRoll(reading, null, 9), null);
assert.equal(r.stableRoll(reading, 0, 10), null);
assert.equal(reading.count, 1, 'missing readings break confirmation');
const continuous = { seq: -1, angle: null, pending: null, count: 0 };
for (let d = -180; d <= 540; d += 10) {
  const angle = Math.atan2(Math.sin(rad(d)), Math.cos(rad(d)));
  assert.equal(r.stableRoll(continuous, angle, d), angle,
    'continuous rotation across multiple seams must not be delayed');
}

for (let sample = 0; sample < 30; sample++) {
  r.frame(null, null, null);
  for (let render = 0; render < 7; render++) assert.equal(r.armLenOk('Right', 1), true);
}
assert.equal(r.armLenSeen.Right.n, 30, 'warmup counts inferences, not rendered frames');
r.frame(null, null, null);
for (let render = 0; render < 144; render++) assert.equal(r.armLenOk('Right', 2), false);
assert.equal(r.armLenSeen.Right.bad, 1, 'one rejected inference cannot exhaust all retries');
for (let sample = 0; sample < 20; sample++) { r.frame(null, null, null); r.armLenOk('Right', 2); }
assert.equal(r.armLenOk('Right', 2), true, 'a real change can still recover');
r.frame(null, null, null);
assert.equal(r.armLenOk('Right', 0.4), true, 'foreshortened arms remain usable');

let world = pose(), image = pose();
assert.equal(r.waistContact(world, image, idx), 1);
image[15] = p(0.1, 0.3);
assert.equal(r.waistContact(world, image, idx), 0, 'a raised/free arm is not waist contact');
image = pose(); world[15].z = -1;
assert.equal(r.waistContact(world, image, idx), 0, 'pointing at the lens is not waist contact');
world = pose(); image[23].y = 1.2;
assert.equal(r.waistContact(world, image, idx), 0, 'offscreen hips cannot anchor a hand');

image = pose();
r.frame(world, image, { Right: [p(0.49, 0.2)] });
const offset = r.faceWristOffset('Right', world, p(-0.15, 0.56, -0.2));
assert.ok(Math.abs(offset.x + 0.01) < 1e-10);
assert.ok(Math.abs(offset.y - 0.05) < 1e-10, 'the detected hand, not the pose wrist on the chest, locates the gesture');
assert.equal(offset.z, -0.2, 'hand-local depth must not replace pose-world depth');
const basis = r.imageBasis();
const tilted = pose(); tilted[12].y = 0.4;
r.image(tilted);
assert.notEqual(r.imageBasis().x.y, basis.x.y, 'new images invalidate the basis even without new world landmarks');
assert.equal(r.psx.fingers().length, 5, 'new profiles can articulate the index finger');
assert.equal(runtime({ fingers: 'thumb' }).psx.fingers().length, 1, 'explicit saved finger settings survive');
console.log('Motion regressions passed: palm seam, degenerate palms, flip confirmation, inference gates, waist contact, face wrist, image cache, finger settings.');

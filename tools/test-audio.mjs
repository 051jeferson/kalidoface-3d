import assert from 'node:assert/strict';
import { runtime } from './test-support.mjs';

let time = 0, amplitude = 0, bias = 0, requested = 0, reads = 0;
let created = 0, closed = 0, stopped = 0, disconnected = 0;
let resolvePermission, rejectPermission, ended;
const buffers = new Set(), events = {};
const track = { readyState: 'live', muted: false,
  stop() { stopped++; }, addEventListener(name, fn) { ended = fn; } };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
class AudioContext {
  constructor() { created++; this.state = 'running'; }
  resume() { return Promise.resolve(); }
  close() { closed++; this.state = 'closed'; return Promise.resolve(); }
  createAnalyser() { return { getFloatTimeDomainData(buffer) {
    reads++; buffers.add(buffer);
    for (let i = 0; i < buffer.length; i++) buffer[i] = bias + (i % 2 ? amplitude : -amplitude);
  } }; }
  createMediaStreamSource() { return {
    connect() {}, disconnect() { disconnected++; }
  }; }
}
const r = runtime(null, {
  window: { AudioContext, performance: { now: () => time },
    addEventListener: (name, fn) => { events[name] = fn; } },
  navigator: { mediaDevices: { getUserMedia(constraints) {
    requested++;
    assert.equal(constraints.video, false);
    assert.equal(constraints.audio.noiseSuppression, false);
    return new Promise((resolve, reject) => { resolvePermission = resolve; rejectPermission = reject; });
  } } }
});
assert.equal(created, 0, 'startup creates no audio graph');
assert.equal(requested, 0, 'startup does not ask for microphone access');
for (let i = 0; i < 1000; i++) r.micLevel();
assert.equal(reads, 0, 'disabled mode performs no audio reads');

const cancelled = r.startMic();
r.stopMic();
resolvePermission(stream); await cancelled;
assert.equal(stopped, 1, 'a late permission grant releases its stream');
assert.equal(closed, 1);
assert.equal(r.psx.mic().state, 'off');

const denied = r.startMic();
rejectPermission({ name: 'NotAllowedError' }); await denied;
assert.equal(r.psx.mic().state, 'denied');
assert.equal(closed, 2, 'permission denial releases the audio context');

const enabled = r.startMic();
resolvePermission(stream); await enabled;
assert.equal(r.psx.mic().state, 'active');
amplitude = 0.1;
for (time = 0; time < 1000; time++) r.micLevel();
assert.equal(reads, 20, '1000 render calls perform only 20 audio reads per second');
assert.equal(buffers.size, 1, 'the sample buffer is reused');
assert.equal([...buffers][0].length, 512);
assert.ok(r.micLevel() > 0.9);
track.muted = true;
assert.equal(r.micLevel(), 0, 'a muted device cannot retain an open mouth');
track.muted = false;
amplitude = 0; bias = 0.2; time += 50;
assert.equal(r.micLevel(), 0, 'DC offset is not speech');
bias = 0;

const values = {};
const vrm = { blendShapeProxy: { setValue: (k, v) => { values[k] = v; } } };
const rig = { mouth: { x: 0, y: 0, shape: {} } };
amplitude = 0.1; time += 50;
r.driveVisemes(vrm, rig);
assert.equal(values.a, 0, 'sound must not overwrite a visible resting mouth');
r.setOccluded(true); time += 50;
r.driveVisemes(vrm, rig);
assert.ok(values.a > 0.5, 'audio animates an occluded mouth');
assert.equal(Object.values(values).filter(v => v > 0).length, 1, 'audio selects one vowel only');
amplitude = 0;
for (let i = 0; i < 8; i++) { time += 50; r.driveVisemes(vrm, rig); }
assert.equal(values.a, 0, 'silence closes the occlusion fallback');
amplitude = 0.1; r.setRun(); time += 50;
const beforeCalibration = reads;
r.driveVisemes(vrm, rig);
assert.equal(reads, beforeCalibration, 'calibration bypasses audio');
ended();
assert.equal(r.psx.mic().state, 'unavailable');
assert.equal(disconnected, 1);
assert.equal(r.mic.buffer, null);

const again = r.startMic(); resolvePermission(stream); await again;
events.pagehide();
assert.equal(r.psx.mic().state, 'off', 'leaving the page releases capture');
assert.equal(created, closed, 'every acquired audio context is closed');
console.log('Audio regressions passed: opt-in, permission races, cleanup, 20 Hz cap, fixed buffer, silence, camera priority and calibration bypass.');

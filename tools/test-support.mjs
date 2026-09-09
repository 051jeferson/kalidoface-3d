import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../docs/psx.js', import.meta.url), 'utf8');
export function runtime(saved = null, overrides = {}) {
  const noop = () => {};
  const document = {
    readyState: 'loading', addEventListener: noop,
    getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], documentElement: { style: {} }
  };
  const window = { addEventListener: noop, requestAnimationFrame: noop,
    cancelAnimationFrame: noop, performance: { now: () => 1000 } };
  Object.assign(window, overrides.window);
  const context = vm.createContext({ window, document, console,
    navigator: overrides.navigator || { languages: ['en'] }, performance: window.performance,
    localStorage: { getItem: () => saved && JSON.stringify(saved), setItem: noop },
    setTimeout: noop, clearTimeout: noop, setInterval: noop });
  const expose = `window.motion = { followRoll, stableRoll, twistAngle, armLenOk, waistContact,
    faceWristOffset, imageBasis, contactReading, cfg, armLenSeen,
    startMic, stopMic, micLevel, mic, driveVisemes,
    setOccluded: function (value) { faceOcc = value; },
    modelCount: function () { return models.length; }, expected: EXPECTED_HOOKS,
    frame: function (world, image, hand) {
      poseLm = world; poseImg = image; poseHand = hand; poseSeq++; imgSeq++;
    }, image: function (image) { poseImg = image; imgSeq++; },
    getPose: function () { return poseLm; },
    setRun: function () { calRun = { kind: 'face', phase: 'wait' }; },
    getRun: function () { return calRun; }
  };`;
  vm.runInContext(source.replace('  injectAppCss();\n  applyDocLang();', '')
    .replace(/\}\)\(\);\s*$/, `${expose}\n})();`), context);
  return { ...window.motion, psx: window.PSX };
}

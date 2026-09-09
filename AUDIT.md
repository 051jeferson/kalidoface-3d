# Project audit — September 9, 2026

The audit covers the static application in `docs/`, its PSX compatibility
layer, settings, model lifecycle, service worker and local tooling. It also
includes the arm fixes prompted by the recorded webcam session.

## Corrections

- Palm rotation follows the shortest angular path across ±180°, avoiding a
  full turn at the angle seam. Elbow direction is smoothed near straight arms.
- Waist contact uses torso proportions; head contact can recover an occluded
  pose wrist from directly detected hand landmarks while retaining world depth.
  Prediction fades during contact. New profiles animate all fingers; explicit
  settings in older profiles remain intact.
- Arm-length rejection counts each inference once, rather than each rendered
  frame. Image caches use the image sequence. Missing or malformed tracking
  packets cannot leave invalid coordinates driving the rig.
- Model registration captures bone rest rotations before animation. Disposal
  releases the PSX model registry, glTF and retarget references.
- Invalid imported calibrations preserve the current recording. Import/reset
  cancels an active wizard. Saved settings cannot replace the configuration
  prototype, and persistence failures produce a console warning.
- Expression controls refresh when preset names change, including replacements
  with the same preset count. Language refresh releases stale voice UI references.
- Background colours are keyboard-operable buttons with selection labels and
  preserved focus. Sliders expose readable values; injected controls have visible
  focus. Browser zoom and reduced-motion preferences are respected.
- Service-worker cache lookup and cleanup are scoped to this installation.
  Cache writes extend worker lifetime, range responses are excluded, and cached
  resources can cover temporary server errors. Installation caches the app shell
  so it can reopen offline after the first successful installation.
- `npm run dev` serves `docs/` without dependencies. `npm test`, `check` and
  `build` verify the committed application without rebuilding its bundle.

## Validation

Repeated successfully after resuming the session:

```sh
node tools/check.mjs
node tools/browser-smoke.mjs <installed-playwright-package>/index.mjs
```

The checks cover syntax, all bundle patches, hook/stub parity, 28 vendored
files, motion regressions, settings import, model disposal, tracking loss,
cache isolation/lifetime and HTTP serving. Browser checks use the bundled
Three.js with a synthetic rig and verify waist/head targets, recovered wrists,
language switching, keyboard colour selection, reduced motion, narrow layouts
and first-visit offline/PWA shell loading. No startup JavaScript errors occurred.

## Remaining validation and limits

- Repeat the recorded gestures with a real webcam and the user's VRM: hand on
  waist, one/two hands on head, finger to lips, hand crossings and tracking loss.
  Synthetic targets establish regression coverage, not real-camera accuracy.
- Measure inference rate, rendered frame rate and long-session memory on the
  target Raspberry Pi. Desktop synthetic timings are not a Pi benchmark.
- Offline shell loading does not establish offline first-time tracking or avatar
  downloads. Tracking assets need to have been cached, and a VRM needs to have
  been loaded/uploaded previously. Upstream sample avatars and some gallery
  images still reference remote services; browser checks block these requests.
- Older calibrations and explicit thumb-only settings are preserved. Select
  all fingers for pointing gestures; recalibrate when changing the brow scalar.

No dependency upgrades or upstream bundle rebuild were performed.

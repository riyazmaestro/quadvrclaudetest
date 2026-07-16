# Quad Flight XR — Project Context Log

Live progress log, updated regularly throughout development. Read this first if resuming work.

## Goal
A WebXR web app to fly a simulated quadcopter drone in the user's living room on Meta Quest,
using AR passthrough (see the real room) with proper rigid-body flight dynamics (not arcade
physics) controlled via Touch controllers in Mode-2 RC transmitter layout. No headset is attached
to this dev machine, so verification relies on: (a) a headless physics unit-test suite, (b) a
headless-browser smoke test of the desktop-preview fallback, (c) static/type analysis, and
(d) an independent code-review subagent pass — real in-headset testing is the user's job, this
project optimizes for "should just work" on first try.

## Stack decisions
- Vite + TypeScript (strict, `erasableSyntaxOnly` + `verbatimModuleSyntax` on) + three.js ^0.185.
- No physics engine dependency (no cannon-es/rapier) — quadcopter dynamics are hand-rolled
  first-principles rigid body sim (see src/physics/) for full control over "proper" flight feel.
- Custom AR session bootstrap in `src/xr/XRSessionManager.ts` (NOT three.js's `ARButton` helper) —
  needed full control over reference-space fallback and dom-overlay wiring that ARButton doesn't
  expose cleanly.
- **`dom-overlay` HUD approach was abandoned.** Deep research confirmed real Quest Browser
  hardware does NOT render `dom-overlay` content in immersive-ar (works only in the desktop
  "Immersive Web Emulator", not on-device) as of ~March 2025 reports. The HUD is instead an
  in-scene `THREE.Sprite` with a `CanvasTexture`, repositioned in world-space every frame to sit
  in front of the XR camera (`src/ui/Hud.ts`, added to `scene` directly, NOT parented to the
  camera — it computes its own world-space position from the camera pose each frame). `dom-overlay`
  is still requested as an optional session feature (harmless no-op if ungranted) but nothing
  depends on it rendering.
- **`bounded-floor` guardian polygon is sanity-checked, not trusted.** Research found
  `boundsGeometry` in immersive-ar sessions is frequently a degenerate tiny square on current
  Horizon OS. `RoomBoundary.setPolygon()` rejects any polygon whose min half-span is under 0.9m
  as an implausible SHAPE, but still uses that polygon's size as a conservative hint — the
  fallback circle's *effective* radius shrinks to `min(configuredRadius, hintedHalfSpan)` rather
  than blindly using the larger configured default, so a real small room can't be mistaken for a
  safe-sized one. The `bounded-floor` reference space is requested independently of three.js's
  own internal `local-floor` rendering reference space (three's `WebXRManager.setSession()` has NO
  try/catch fallback between reference-space types — confirmed by reading its source — so it must
  never be pointed at an unsupported type).
- Gamepad mapping confirmed via the WebXR Gamepads Module spec: Touch controller primary
  thumbstick is `axes[2]/axes[3]` (not `[0]/[1]`, a legacy touchpad placeholder always 0 on
  Touch). Buttons: `[0]` trigger, `[1]` squeeze/grip, `[4]`/`[5]` face buttons (A/B right, X/Y
  left).
- Safety features taken seriously since this flies a virtual object around a real living room:
  squeezing both triggers at once is an immediate hard kill-switch (force-disarm); a boundary
  proximity value drives a pulsing red vignette on the HUD; reset always leaves the drone
  disarmed (no accidental instant re-arm after a crash); wall/boundary impacts above
  `WALL_CRASH_SPEED_THRESHOLD` now crash-and-disarm just like hard floor impacts do (this needed
  its OWN, lower threshold than the floor's — see Known limitations below, it's a real physics
  finding, not an arbitrary number).
- **PowerShell tool calls do not persist PATH/env vars or shell state between calls** — every
  command that needs node/npm/git must start with:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`
  (Bash tool calls don't have this problem and are preferred when available.)

## Project location
`C:\Users\riyaz\OneDrive\Desktop\claude run\quad-flight-xr\`
Git repo initialized locally (no remote). Commit after each working milestone.

## Architecture map
```
src/physics/    QuadcopterPhysics (rigid body sim), Mixer (motor allocation matrix), PID,
                constants (all tunable flight-feel numbers live here)
src/xr/         XRSessionManager (AR session lifecycle + boundary fetch), RoomBoundary
                (guardian-polygon-or-circle wall collision + proximity query, reports impact speed)
src/input/      types (FrameInput/InputSource contracts), ControllerInput (Quest Touch via
                XRInputSource/Gamepad), KeyboardInput (desktop fallback + test-drivable),
                stickShaping (deadzone/expo)
src/render/     SceneSetup (renderer/camera/lights/boundary-line viz), DroneModel (procedural
                low-poly quad mesh, spinning props)
src/ui/         Hud (in-scene CanvasTexture sprite HUD, head-locked, scene-level not camera-child)
src/audio/      MotorAudio (WebAudio synthesized motor whine, no assets)
src/main.ts     Wires everything: fixed-timestep (240Hz) physics accumulator loop, input source
                switch (XR controllers vs keyboard) based on `xrSessionManager.isPresenting`,
                dev-only `window.__quadDebug` hook for headless test assertions.
scripts/simTest.ts    Headless physics sanity/regression suite (34 checks), run: `npm run test:physics`
scripts/smokeTest.ts  Headless-Chromium desktop-preview smoke test via Playwright (boots app,
                      drives keyboard input, asserts telemetry + zero console/page errors),
                      run: `npm run test:smoke`
```

## Progress log
- **T+0:05 → T+0:20 (prior session)** Researched WebXR APIs, scaffolded Vite+TS+three.js project,
  installed Node/Git via winget (user approved), set up module folders.
- **(prior session end)** Core quadcopter physics complete: motor mixer (first-principles
  allocation matrix + inverse), cascaded rate/angle PID loops, motor spin-up lag, ground effect,
  floor collision + crash detection, ACRO/ANGLE flight modes. 30/30 headless sim tests passing.
  Committed (`9caa0dc`).
- **New session, resumed from this file.** Verified prior physics tests still pass. Dispatched a
  background research subagent (Quest WebXR AR capability facts) and proceeded with
  implementation in parallel rather than blocking on it — this paid off directly, see below.
- Built `XRSessionManager` + `RoomBoundary`, `ControllerInput` + `KeyboardInput` (shared
  `InputSource`/`FrameInput` contract), `DroneModel` + `SceneSetup`, and `main.ts` wiring it all
  together with a fixed-timestep accumulator loop and a desktop-preview fallback (OrbitControls +
  keyboard) for headset-less development. Dispatched two parallel subagents for isolated modules
  under a strict file-scope contract: HUD (`src/ui/Hud.ts`) and motor audio (`src/audio/MotorAudio.ts`).
- Research subagent returned mid-build and **surfaced two real design problems before they
  shipped**: dom-overlay doesn't render on real Quest hardware; boundsGeometry is unreliable in
  AR. Immediately corrected: redirected the in-flight HUD subagent (it had built a dom-overlay DOM
  version; redid it correctly as an in-scene CanvasTexture sprite) and patched `RoomBoundary` with
  a plausible-size sanity filter. Lesson reinforced: researching in parallel with building, not
  sequentially, catches problems post-hoc instead of blocking, at the cost of one redirect message.
- Integrated both subagents' output. Found and fixed one real integration bug myself before it
  ever ran: `hud.object` was parented to the camera in main.ts, but the HUD subagent's `update()`
  computes its own world-space position from the camera pose (assuming a scene-level object) —
  would have double-transformed it. Fixed by adding it to `scene` directly. Also refactored
  `RoomBoundary.resolve()` to share geometry math with a non-mutating `proximity()` query instead
  of an initial hacky "call resolve() again with a throwaway Vector3" approach.
- Full-project `tsc --noEmit` + `vite build` clean after integration (fixed one pre-existing
  `erasableSyntaxOnly` violation in `PID.ts`).
- Installed Playwright + Chromium, wrote `scripts/smokeTest.ts` with a dev-only `__quadDebug`
  hook in `main.ts` (dead-code-eliminated from prod via `import.meta.env.DEV`). First run had 4
  failures, all test-harness timing bugs (instant keydown+keyup faster than one animation frame
  never registers; reading telemetry ~200ms after a disarmed reset lets real free-fall physics
  move the drone before the assertion runs) — fixed the test, not the app. All assertions passed.
- Dispatched a background code-review subagent (correctness-only pass across all of `src/`) in
  parallel with the smoke-test work; it was interrupted once by a host-process restart mid-run,
  resumed via SendMessage from its saved transcript with no lost progress, then returned **7 real
  findings**, ranked by severity:
  1. Fallback boundary could be less safe than a genuinely small real room (implausible-polygon
     rejection threw away a usable size signal). **Fixed**: reject the polygon's *shape* but keep
     its size as a `min(configured, hinted)` conservative cap on the fallback circle.
  2. Wall/boundary impacts never triggered `crashed` (only floor impacts did) — asymmetric safety
     behavior for an app whose whole point is preventing wall clips. **Fixed**: `RoomBoundary.resolve()`
     now returns impact speed; `QuadcopterPhysics.triggerCrash()` added; main.ts crashes on a hard
     wall hit same as a hard floor hit. Added a deterministic regression test
     (`scripts/simTest.ts` Test 15) — which then surfaced a **second-order finding of its own**:
     empirically, full-deflection flight from the center of a 1.75m arena only reaches ~2.2-2.9
     m/s by first wall contact (not enough room to reach the floor's 3.0 m/s threshold), so
     reusing `CRASH_SPEED_THRESHOLD` for walls would almost never fire. Added a separate, lower
     `WALL_CRASH_SPEED_THRESHOLD = 2.0`, calibrated from that measurement.
  3. A session-start failure after `requestSession()` succeeded (e.g. `setSession` or boundary
     fetch throwing) left a dangling open `XRSession`, blocking any retry of "Enter AR" until
     page reload. **Fixed**: `XRSessionManager.start()` now cleans up (removes listener, ends the
     session) on any failure after acquiring it, before rethrowing.
  4. Re-entering AR after a previous session called `MotorAudio.stop()` (suspend-only) left audio
     silent forever, since `start()` no-op'd whenever `ctx` already existed. **Fixed**: `start()`
     now resumes the existing context instead of no-op'ing.
  5. HUD flight-timer had a dead reset branch (`flightStartTime === 0` could never be true) so a
     mid-flight disarm+rearm didn't restart the on-screen timer. **Fixed**: track the armed
     rising-edge explicitly (`wasArmed`) instead.
  6. `INERTIA` constants' axis-label comments contradicted their actual pitch/roll usage
     elsewhere (harmless today since the frame is square, but latent for future asymmetric
     tuning). **Fixed**: corrected comments.
  7. Simultaneous both-grips arm-toggle in the same frame could cancel out to a no-op. **Fixed**:
     accumulate "any grip just pressed" across both hands, toggle `armed` once after the loop.
  All fixes verified: `tsc --noEmit` clean, 34/34 physics tests, full smoke test, and
  production build all pass after every fix above.

## Known limitations / accepted tradeoffs (not bugs)
- Guardian boundary polygon is best-effort only; safe default is a 1.75m fallback circle
  (shrunk further if a small-but-plausible-ish polygon hints the real room is smaller — see
  finding #1 above). No depth/mesh-API furniture awareness (plane/mesh-detection is still fairly
  early per the research pass; noted as a possible future enhancement, not attempted).
- ACRO mode's throttle is still spring-stick-centered (Quest thumbsticks have no ratchet), which
  happens to equal exactly hover thrust at center by design (`THRUST_TO_WEIGHT_MAX = 2.0` makes
  `ACRO_HOVER_THROTTLE = 0.5`) — intentional, documented in `constants.ts`.
- Wall-crash threshold (`WALL_CRASH_SPEED_THRESHOLD = 2.0`) is calibrated for the *default*
  1.75m arena; if `RoomBoundary` shrinks the effective radius further (small real room detected),
  first-contact speeds will be even lower — a very small room may almost never trigger a wall
  crash, just gentle bounces. Considered acceptable (better to under-trigger a safety stop near a
  wall the user is watching than over-trigger one during normal close-quarters flying), but worth
  revisiting if real-world testing says otherwise.
- Headless-Chromium `requestAnimationFrame` throttling makes wall-clock-timed Playwright
  assertions unreliable for anything speed/timing-sensitive (discovered while testing the wall-crash
  fix) — such cases belong in `scripts/simTest.ts`'s deterministic fixed-step loop instead, not
  `scripts/smokeTest.ts`.

## Progress log (continued)
- Committed the full-app milestone (`d361200`) after the correctness review fixes above.
- Added real HTTPS to the dev server: `vite.config.ts` with `@vitejs/plugin-basic-ssl` +
  `server.host: true` (WebXR requires a secure context; a Quest can't open a plain `http://` LAN
  page and start an AR session). Updated `scripts/smokeTest.ts` to hit `https://` with
  `ignoreHTTPSErrors` since it boots the same configured dev server. Verified end-to-end: dev
  server prints a real LAN `Network:` URL, smoke test passes against it.
- Wrote `README.md`: setup/run instructions, the actual controls table, a safety section, dev
  scripts, and a troubleshooting section — including calling out Windows Firewall as the most
  likely reason a Quest can't reach the dev server over LAN (very much worth stating explicitly,
  it's the kind of thing that silently blocks the whole "fly it on Quest" flow with no error
  message on either device).
- Final iteration pass caught two more real things while giving the whole tree a fresh read:
  1. Two methods were written but never called anywhere (`ControllerInput.forceDisarm()`,
     `RoomBoundary.hasGuardianPolygon()`) — dead code, but each pointed at a real missing feature
     rather than being pure cruft. **Wired both in**: `XRSessionManager` now listens for the
     WebXR `visibilitychange` event and calls a new `onVisibilityChange` callback; `main.ts` uses
     it to force-disarm when the user lifts/removes the headset mid-flight (they can't see the
     drone or the boundary warning at that point, so treat it as a safety pause). Replaced
     `hasGuardianPolygon()` with a richer `getVisualBoundary()` that also fixed a real
     visual/physics mismatch (next item).
  2. The boundary line drawn in the scene was built from the **raw, pre-sanity-check**
     `xrSessionManager.boundaryPolygon`, not what `RoomBoundary` actually decided to collide
     against after its plausibility filter — so if a polygon got rejected as an implausible
     guardian reading, the drawn line could show a shape nothing was actually enforcing anymore.
     **Fixed**: `RoomBoundary.getVisualBoundary()` returns what's actually in effect (polygon or
     effective fallback radius) plus an `isGuardianPolygon` flag; `SceneSetup.setBoundaryVisual()`
     now takes that directly and colors the line cyan (real guardian data) vs. amber (safe
     default circle) so it's visually honest about which one the user is looking at.
  3. HUD panel was re-measured: at its original 0.52m width / 0.6m distance it subtended ~47deg
     of horizontal FOV — nearly half a headset's view, contradicting the "modest, corner HUD,
     don't block the room" brief the subagent was given. Shrunk to 0.34m width / 0.7m distance
     (~27deg) and moved lower, so it reads as a glanced-at dashboard instead of a screen sitting
     over the drone.
- Full regression after all of the above: `tsc --noEmit` clean, 34/34 physics tests, full smoke
  test (now over HTTPS), production build all pass.
- Dispatched a second independent review subagent — reuse/simplification/efficiency lens this
  time (the first pass was correctness-only) — running in the background; see next entry once it
  reports back and any findings are triaged.

## Next steps (keep this section current)
- [ ] Read back the simplification/efficiency review subagent's findings once it completes;
      triage and apply anything worth fixing, same as the correctness pass
- [ ] Final full regression + commit after that triage
- [ ] Optional stretch, only if time remains: try `session.updateTargetFrameRate()` for
      90/120Hz on supported headsets (research pass flagged this as available and cheap)

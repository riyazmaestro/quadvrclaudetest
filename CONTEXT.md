# Quad Flight XR — Project Context Log

Live progress log, updated regularly throughout development. Read this first if resuming work.

## Goal
A WebXR web app to fly a simulated quadcopter drone in the user's living room on Meta Quest,
using AR passthrough (see the real room) with proper rigid-body flight dynamics (not arcade
physics) controlled via Touch controllers in Mode-2 RC transmitter layout. No headset is attached
to this dev machine, so verification relies on: (a) a headless physics unit-test suite, (b) a
headless-browser smoke test of the desktop-preview fallback, (c) static/type analysis, and
(d) independent code-review subagent passes — real in-headset testing is the user's job, this
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
  `WALL_CRASH_SPEED_THRESHOLD` crash-and-disarm just like hard floor impacts do (needed its OWN,
  lower threshold than the floor's — see Known limitations); lifting/removing the headset
  mid-flight (WebXR `visibilitychange`) force-disarms too.
- Performance: `getTelemetry()`, `mixMotors()`, and `ControllerInput`'s per-hand button reads all
  use persistent mutated-in-place scratch objects/arrays rather than per-frame allocations — this
  matters more than in a typical web app since the physics substep runs at 240Hz and the whole
  loop needs to hold up on Quest's mobile GPU/CPU. Session also requests the highest supported XR
  frame rate (90/120Hz) as a best-effort extra.
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
src/xr/         XRSessionManager (AR session lifecycle + boundary fetch + frame-rate request),
                RoomBoundary (guardian-polygon-or-circle wall collision + proximity query)
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
vite.config.ts        HTTPS dev server (@vitejs/plugin-basic-ssl) + LAN host binding — required,
                      WebXR needs a secure context and the Quest can't reach plain http://.
scripts/simTest.ts    Headless physics sanity/regression suite (34 checks), run: `npm run test:physics`
scripts/smokeTest.ts  Headless-Chromium desktop-preview smoke test via Playwright (boots the same
                      HTTPS dev server, drives keyboard input, asserts telemetry + zero
                      console/page errors), run: `npm run test:smoke`
README.md             User-facing setup/controls/safety/troubleshooting docs.
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
- Dispatched a background **correctness** review subagent across all of `src/`; it was interrupted
  once by a host-process restart mid-run, resumed via SendMessage from its saved transcript with no
  lost progress, then returned 7 findings, ranked by severity (all fixed):
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
  Full regression after all 7 fixes: `tsc --noEmit` clean, 34/34 physics tests, full smoke test,
  production build all pass. Committed as the full-app milestone (`d361200`).
- Added real HTTPS to the dev server (`vite.config.ts`, `@vitejs/plugin-basic-ssl` +
  `server.host: true` — WebXR requires a secure context, a Quest can't reach plain `http://` over
  LAN). Updated `scripts/smokeTest.ts` to match (`https://`, `ignoreHTTPSErrors`). Verified
  end-to-end: dev server prints a real LAN `Network:` URL, smoke test passes against it.
- Wrote `README.md`: setup/run instructions, controls table, safety section, dev scripts, and a
  troubleshooting section — including calling out Windows Firewall as the most likely reason a
  Quest can't reach the dev server over LAN (worth stating explicitly; it silently blocks the
  whole flow with no error message on either device).
- Final fresh-eyes iteration pass over the whole tree caught two more real things:
  1. Two methods were written but never called anywhere (`ControllerInput.forceDisarm()`,
     `RoomBoundary.hasGuardianPolygon()`) — each pointed at a real missing feature rather than
     being pure cruft. **Wired both in**: `XRSessionManager` now listens for the WebXR
     `visibilitychange` event (`onVisibilityChange` callback) — `main.ts` force-disarms if the
     user lifts/removes the headset mid-flight (can't see the drone or boundary warning at that
     point, so treat it as a safety pause). Replaced `hasGuardianPolygon()` with a richer
     `getVisualBoundary()` that also fixed a real visual/physics mismatch (next item).
  2. The boundary line drawn in the scene used the **raw, pre-sanity-check**
     `xrSessionManager.boundaryPolygon` instead of what `RoomBoundary` actually collides against —
     so a rejected-as-implausible polygon could still be drawn, showing a shape nothing was
     actually enforcing. **Fixed**: `getVisualBoundary()` returns what's really in effect (polygon
     or effective fallback radius) + an `isGuardianPolygon` flag; the line is now colored cyan
     (real guardian data) vs. amber (safe default circle).
  3. HUD panel re-measured: at 0.52m width / 0.6m distance it subtended ~47deg of horizontal FOV —
     nearly half a headset's view, against the "modest, don't block the room" brief. Shrunk to
     0.34m / 0.7m (~27deg) and moved lower, reading as a glanced-at dashboard instead.
  Added a best-effort `session.updateTargetFrameRate()` request (90/120Hz where supported, per
  the research pass's tip), wrapped so a rejection can never fail session start. Committed
  (`b97b192`, `7e363a8`).
- Dispatched a second independent review subagent — **reuse/simplification/efficiency** lens this
  time — and applied every finding:
  1. **`QuadcopterPhysics.getTelemetry()`**, called every rAF frame, was the single largest
     per-frame GC source in the app (4 cloned Vector3/Quaternion + a spread + a mapped array,
     built fresh every call). Converted to a persistent, mutated-in-place `telemetry` object
     returned by reference (documented on both the interface and method: callers must read it
     before the next call, not retain it across frames — verified safe, nothing in the codebase
     does the latter).
  2. **`Mixer.mixMotors()`**, the true 240Hz hot-path allocator, now writes into a caller-supplied
     `out` array (`QuadcopterPhysics.step()` passes `this.motorThrustCommand` directly) instead of
     returning a new one every substep; `reset()`/`setArmed()` switched from reassigning fresh
     arrays to `.fill(0)` on the same persistent arrays.
  3. **`ControllerInput.readButtons()`** allocated a new object per hand per XR frame; now reads
     into persistent per-hand scratch objects.
  4. Smaller wins: `main.ts`'s per-frame `HudData` literal is now a reused scratch object;
     `MotorAudio.computeRms()`'s closure-allocating `.reduce()` became a plain loop;
     `RoomBoundary`'s duplicated `polygon ? ... : ...` dispatch (in both `resolve()` and
     `proximity()`) factored into one shared `signedDistance()` helper; `KeyboardInput.poll()`'s
     per-poll `Set` clone replaced with three plain booleans (only 3 keys ever need edge-detection).
  5. Dead code removed (verified via grep first): `Mixer.computeNetFromMotorThrusts()` and the
     `PROP_RADIUS` constant (unused, and its own doc comment was too vague to be worth force-wiring
     at the cost of a visual-size change). Wired `ARM_LENGTH` into `DroneModel.ts` instead — it was
     recomputing the identical value via `Math.hypot` once per motor at construction.
  Full regression after every fix: `tsc --noEmit` clean, 34/34 physics tests (unchanged pass count
  — confirms the hot-path refactors preserved exact behavior, not just "still compiles"), full
  smoke test, production build all pass.

## Known limitations / accepted tradeoffs (not bugs)
- Guardian boundary polygon is best-effort only; safe default is a 1.75m fallback circle (shrunk
  further if a small-but-plausible-ish polygon hints the real room is smaller). No depth/mesh-API
  furniture awareness (plane/mesh-detection is still fairly early per the research pass; noted as
  a possible future enhancement, not attempted).
- ACRO mode's throttle is still spring-stick-centered (Quest thumbsticks have no ratchet), which
  happens to equal exactly hover thrust at center by design (`THRUST_TO_WEIGHT_MAX = 2.0` makes
  `ACRO_HOVER_THROTTLE = 0.5`) — intentional, documented in `constants.ts`.
- Wall-crash threshold (`WALL_CRASH_SPEED_THRESHOLD = 2.0`) is calibrated for the *default* 1.75m
  arena; if `RoomBoundary` shrinks the effective radius further (small real room detected),
  first-contact speeds will be even lower — a very small room may almost never trigger a wall
  crash, just gentle bounces. Considered acceptable (better to under-trigger a safety stop near a
  wall the user is watching than over-trigger one during normal close-quarters flying), but worth
  revisiting if real-world testing says otherwise.
- Headless-Chromium `requestAnimationFrame` throttling makes wall-clock-timed Playwright
  assertions unreliable for anything speed/timing-sensitive (discovered while testing the
  wall-crash fix) — such cases belong in `scripts/simTest.ts`'s deterministic fixed-step loop
  instead, `scripts/smokeTest.ts` should stick to logic/state assertions, not timing-derived ones.

## Next steps (keep this section current)
The app is feature-complete and has been through two independent review passes (correctness, then
efficiency/simplification) with every finding fixed and re-verified. Nothing is currently blocking.
Remaining items are all optional polish, only worth picking up if there's still time/appetite:
- [ ] Real in-headset testing pass (the one thing that genuinely can't be done from this
      machine) — flight feel (PID gains, drag, max angles/rates in `constants.ts`) is
      headless-sim-validated for physical plausibility but never felt by a human in AR.
- [ ] Consider plane/mesh-detection as an opt-in enhancement to the boundary system if a future
      research check finds it's matured beyond "fairly early" — explicitly deferred, not started.
- [ ] Everything else is genuinely done: physics, XR session + boundary, input (controller +
      keyboard), render, HUD, audio, HTTPS dev server, README, two independent review passes,
      34/34 physics tests + full smoke test + clean build.

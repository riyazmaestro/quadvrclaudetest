# Quad Flight XR

Fly a physically-simulated quadcopter around your living room in AR passthrough on Meta Quest.
No arcade physics — a hand-rolled rigid-body sim with a real motor mixer, cascaded rate/angle PID
loops, motor spin-up lag, ground effect, and drag, controlled like an actual RC transmitter
(Mode 2) via your Touch controllers.

## Requirements

- A Meta Quest (2/3/Pro) headset, on the **same Wi-Fi network** as this computer.
- Node.js 18+ and npm installed on this computer.
- A bit of clear floor space — see [Safety & the room boundary](#safety--the-room-boundary) below.

## Running it

```
npm install
npm run dev
```

This prints two URLs — a `Local` one and a `Network` one, e.g.:

```
➜  Local:   https://localhost:5173/
➜  Network: https://192.168.0.13:5173/
```

On your **Quest**, open the Quest Browser and type in the **Network** URL (the one with your
computer's LAN IP, not `localhost`). Then:

1. Your browser will warn the certificate isn't trusted (**"Your connection is not private"** or
   similar) — this is expected. The dev server uses a locally self-signed HTTPS certificate
   (WebXR requires a secure context; a plain `http://` page cannot start an AR session on real
   hardware). Click through it (usually **Advanced → Proceed**).
2. You'll land on the app's start screen. Tap **Enter AR** and grant camera/spatial-data
   permission when prompted.
3. Stand roughly in the middle of your clear floor space, put the headset on properly, and fly.

If the Quest can't reach the Network URL at all (page just times out), see
[Troubleshooting](#troubleshooting) — it's almost always the host computer's firewall.

## Playing over the internet (GitHub Pages)

You don't need this computer running once the site is deployed — a `git push` to `master`
auto-builds and publishes it via the included GitHub Actions workflow
(`.github/workflows/deploy-pages.yml`).

**One-time setup:** in the GitHub repo, go to **Settings → Pages → Build and deployment → Source**
and select **GitHub Actions** (it's not enabled by default — just having the workflow file present
isn't enough). Then push to `master`; the "Deploy to GitHub Pages" workflow run shows the live URL
when it finishes (**Actions** tab), which will be `https://<your-github-username>.github.io/quadvrclaudetest/`.

Open that URL directly in the Quest Browser — GitHub Pages is already HTTPS, so no
certificate-warning step like the LAN dev server has.

**Do not** open `index.html` (or anything in `dist/`) directly as a local `file://` page — WebXR
only works in a secure context (`https://` or `localhost`), and the app's module script won't even
load under `file://`. This is also why opening the raw project `index.html` looks identical and
equally broken in a normal desktop browser (stuck on "Checking WebXR support…"): the page never
gets a chance to run.

## Controls (Mode 2 RC layout)

| Input | Action |
|---|---|
| **Left stick**, vertical | Throttle (ANGLE mode: climb/descend rate, spring-centered = hold altitude) |
| **Left stick**, horizontal | Yaw (rotate left/right) |
| **Right stick**, vertical | Pitch (tilt forward/back to move forward/back) |
| **Right stick**, horizontal | Roll (tilt left/right to strafe left/right) |
| **Grip** (either hand) | Arm / disarm the motors |
| **A** (right controller) | Toggle ACRO ↔ ANGLE flight mode |
| **Y** (left controller) | Reset the drone to your feet (always leaves it disarmed) |
| **Both triggers together** | Emergency kill switch — instantly cuts power, from any state |

**ANGLE mode** (default) is self-leveling with altitude hold — release the sticks and the drone
holds its attitude and height. This is the one to fly indoors. **ACRO mode** is direct rate
control with no self-leveling (real acro/freestyle pilots' mode) — much easier to crash, meant for
players who already know what they're doing.

## Safety & the room boundary

This flies a virtual object around your *real* living room, so a few things are deliberately
conservative:

- The app tries to read your headset's Guardian/boundary data to know your room's real shape, but
  that data has been found to be unreliable in AR passthrough mode on current headset software
  (see `CONTEXT.md` for details) — so by default it constrains flight to a **1.75m-radius circle**
  around wherever you started, shrinking further if the headset's own boundary hints at a smaller
  space. It does **not** know where your couch, TV, or walls actually are beyond that. Pick a spot
  with clear space in all directions before arming.
- A pulsing red glow appears on the in-headset HUD as the drone nears the boundary edge.
- Squeeze both triggers at any time to instantly cut power if the drone is headed somewhere bad.
- Hitting the floor or the boundary wall just bounces the drone physically (with some restitution
  and friction) — it stays armed and flyable. Tap **Y** any time to reset it back to your feet.

## Development

```
npm run test:physics   # headless flight-dynamics regression suite (no browser needed)
npm run test:smoke     # headless-Chromium smoke test of the desktop-preview fallback
npm run build          # typecheck + production build
```

No Quest is required for any of the above — `test:physics` runs the rigid-body sim standalone,
and `test:smoke` drives the app's desktop keyboard-fallback controls (WASD-ish, see
`src/input/KeyboardInput.ts`) in a headless browser to catch integration/render bugs before ever
touching a headset. `CONTEXT.md` has the full architecture map and running project history.

## Troubleshooting

**Quest can't reach the Network URL / page just times out.**
Almost always Windows Firewall blocking inbound connections to Node/Vite on this computer. When
you first run `npm run dev`, Windows should prompt to allow Node.js through the firewall for
Private networks — click **Allow**. If you missed that prompt or it didn't appear, open **Windows
Defender Firewall → Allow an app through firewall** and make sure Node.js is allowed on **Private**
networks (both computer and Quest need to be on the same network, and it should be set to
"Private", not "Public", in Windows' network settings).

**"Enter AR" button stays disabled / says "AR not supported here".**
You're not in the Quest Browser (desktop browsers don't support `immersive-ar`), or you're on a
very old Horizon OS version. Update the Quest Browser app and Horizon OS.

**Drone flight feels twitchy or floaty.**
All flight-feel constants (PID gains, drag, thrust, max angles/rates) live in one place:
`src/physics/constants.ts`. Adjust and re-run `npm run test:physics` to make sure nothing broke.

**No sound.**
Audio only starts after you tap Enter AR (browser autoplay policy requires a user gesture) — it
should start immediately once the session begins. If a previous session's audio seems stuck
silent, that's the bug fixed in `MotorAudio.start()`'s resume-on-reentry path; make sure you're on
the latest code.

# Quad Flight XR — Project Context Log

Live progress log, updated regularly throughout development. Read this first if resuming work.

## Goal
A WebXR web app to fly a simulated quadcopter drone in the user's living room on Meta Quest,
using AR passthrough (see the real room) with proper rigid-body flight dynamics (not arcade
physics) controlled via Touch controllers in Mode-2 RC transmitter layout.

## Stack decisions
- Vite + TypeScript + three.js (installed via npm — Node.js/npm/Git were not present on this
  machine; installed via `winget install OpenJS.NodeJS.LTS` and `winget install Git.Git` with
  user's explicit approval).
- No physics engine dependency (no cannon-es/rapier) — quadcopter dynamics are simple enough
  (single rigid body, 4 point force/torque contributions) to hand-roll for full control over
  "proper" flight feel, matching real flight-controller mixing math (Betaflight/ArduPilot style).
- three.js `ARButton` + `immersive-ar` session, transparent background (passthrough visible).
- Reference space: try `bounded-floor` first (gives guardian boundary geometry), fall back to
  `local-floor`.
- Note: **PowerShell tool calls do not persist PATH/env vars or shell state between calls** —
  every command that needs node/npm/git must start with:
  `$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")`

## Project location
`C:\Users\riyaz\OneDrive\Desktop\claude run\quad-flight-xr\`
Git repo initialized locally (no remote). Commit after each working milestone.

## Progress log
- **T+0:05** Researched WebXR immersive-ar passthrough APIs, reference spaces, Touch controller
  gamepad axis conventions (x: -1 left/+1 right, y: -1 up/+1 down), three.js ARButton pattern.
- **T+0:15** Installed Node LTS + Git via winget (user approved). Scaffolded Vite vanilla-ts
  project `quad-flight-xr`, installed `three` + `@types/three`, git init.
- **T+0:20** Set up module folder structure: physics/, xr/, input/, render/, ui/, audio/, utils/.
  Starting on physics core next.

## Next steps (keep this section current)
- [ ] Core physics module (QuadcopterPhysics.ts)
- [ ] XR session manager + boundary
- [ ] Controller input mapping (Mode 2)
- [ ] Drone visual model + camera rig
- [ ] HUD
- [ ] Motor audio
- [ ] Wire everything in main.ts
- [ ] Subagent review: physics correctness
- [ ] Subagent review: WebXR correctness
- [ ] Iterate/fix bugs
- [ ] README with Quest deployment instructions

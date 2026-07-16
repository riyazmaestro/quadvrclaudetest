/**
 * Headless desktop smoke test. No WebXR headset is attached to this dev machine, so this can't
 * exercise the real immersive-ar path — instead it boots the app in a normal headless Chromium
 * (where `navigator.xr` support detection correctly reports "unsupported"), drives the desktop
 * keyboard-fallback control scheme, and asserts the render/physics loop runs without console
 * errors and produces sane (non-NaN, physically plausible) telemetry via the dev-only
 * `window.__quadDebug` hook exposed from main.ts. Run with: npx tsx scripts/smokeTest.ts
 */
import { createServer, type ViteDevServer } from 'vite';
import { chromium, type ConsoleMessage, type Page } from 'playwright';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

interface QuadDebug {
  telemetry: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    armed: boolean;
    crashed: boolean;
    altitudeM: number;
    speedMs: number;
  };
  frameInput: { armed: boolean; flightMode: string };
  isPresenting: boolean;
}

async function readDebug(page: Page): Promise<QuadDebug | null> {
  return page.evaluate(() => (window as unknown as { __quadDebug?: QuadDebug }).__quadDebug ?? null);
}

// A real button press (physical grip toggle, or a human tapping a key) holds for far longer than
// one animation frame (~11-16ms at 90-60Hz); an instant down+up in the same microtask can land
// entirely between two poll() calls and never be observed as "pressed" at all. Tests must simulate
// a realistic hold duration, matching how a real Quest controller trigger/grip press behaves.
async function pressKey(page: Page, code: string, holdMs = 80): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout(holdMs);
  await page.keyboard.up(code);
  await page.waitForTimeout(50); // let one more frame observe the release
}

async function main(): Promise<void> {
  let server: ViteDevServer | undefined;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  try {
    server = await createServer({ server: { port: 5183, strictPort: true }, logLevel: 'error' });
    await server.listen();
    // The project's vite.config.ts always serves HTTPS (self-signed cert) since WebXR requires a
    // secure context on a real device — this dev server inherits that config, so Playwright must
    // be told to accept the untrusted cert or every request will fail.
    const url = `https://localhost:5183/`;

    const browser = await chromium.launch();
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err: Error) => pageErrors.push(err.message));

    console.log('\n=== Loading app in headless Chromium (no WebXR device -> desktop preview path) ===');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);

    const initialDebug = await readDebug(page);
    check('app boots and exposes __quadDebug hook', initialDebug !== null);
    check('desktop preview correctly detects no XR support', initialDebug?.isPresenting === false);

    console.log('\n=== Reset (R) then arm (Space) ===');
    await pressKey(page, 'KeyR');
    await pressKey(page, 'Space');
    const armedDebug = await readDebug(page);
    check('Space arms the drone', armedDebug?.frameInput.armed === true, JSON.stringify(armedDebug?.frameInput));

    console.log('\n=== Holding throttle up for 2s right after arming (expect climb) ===');
    const beforeClimb = await readDebug(page);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(2000);
    await page.keyboard.up('ArrowUp');
    await page.waitForTimeout(50);
    const afterClimb = await readDebug(page);

    check(
      'holding throttle up increases altitude',
      !!(afterClimb && beforeClimb && afterClimb.telemetry.altitudeM > beforeClimb.telemetry.altitudeM + 0.2),
      `before=${beforeClimb?.telemetry.altitudeM.toFixed(3)} after=${afterClimb?.telemetry.altitudeM.toFixed(3)}`
    );
    check(
      'telemetry stays finite under sustained flight',
      !!afterClimb && Number.isFinite(afterClimb.telemetry.position.x) && Number.isFinite(afterClimb.telemetry.velocity.y),
      JSON.stringify(afterClimb?.telemetry.position)
    );
    check('still armed and not crashed mid-flight', afterClimb?.telemetry.armed === true && afterClimb?.telemetry.crashed === false);

    console.log('\n=== Forward pitch (W) for 1s ===');
    const beforePitch = await readDebug(page);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1000);
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(50);
    const afterPitch = await readDebug(page);
    check(
      'forward pitch moves the drone toward -Z',
      !!(afterPitch && beforePitch && afterPitch.telemetry.position.z < beforePitch.telemetry.position.z - 0.05),
      `before=${beforePitch?.telemetry.position.z.toFixed(3)} after=${afterPitch?.telemetry.position.z.toFixed(3)}`
    );

    console.log('\n=== Kill switch (X) immediately disarms ===');
    await pressKey(page, 'KeyX');
    const killedDebug = await readDebug(page);
    check('kill switch (X) disarms', killedDebug?.frameInput.armed === false, JSON.stringify(killedDebug?.frameInput));

    console.log('\n=== Reset (R) respawns the drone ===');
    await page.keyboard.down('KeyR');
    await page.waitForTimeout(20); // just enough for one rAF frame to process the edge-triggered reset
    const rightAfterResetPress = await readDebug(page); // read promptly, before further free-fall accrues
    await page.keyboard.up('KeyR');
    check(
      'reset respawns exactly at the spawn point',
      !!rightAfterResetPress &&
        Math.abs(rightAfterResetPress.telemetry.position.z - -1) < 0.05 &&
        Math.abs(rightAfterResetPress.telemetry.position.y - 1) < 0.05,
      JSON.stringify(rightAfterResetPress?.telemetry.position)
    );
    check('reset leaves the drone disarmed', rightAfterResetPress?.frameInput.armed === false);

    await page.waitForTimeout(300);
    check('no console.error output during the whole run', consoleErrors.length === 0, consoleErrors.join(' | '));
    check('no uncaught page errors during the whole run', pageErrors.length === 0, pageErrors.join(' | '));

    await browser.close();
  } finally {
    await server?.close();
  }

  console.log(`\n=== SMOKE TEST RESULT: ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`} ===\n`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});

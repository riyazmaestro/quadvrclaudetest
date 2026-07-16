const DEADZONE = 0.08;
const EXPO = 0.35; // 0 = linear, 1 = very soft near center / aggressive near full deflection

/** Applies a center deadzone plus a cubic expo curve, matching typical RC transmitter feel. */
export function shapeAxis(raw: number): number {
  const sign = raw < 0 ? -1 : 1;
  const mag = Math.abs(raw);
  if (mag < DEADZONE) return 0;
  const scaled = (mag - DEADZONE) / (1 - DEADZONE);
  const shaped = EXPO * scaled ** 3 + (1 - EXPO) * scaled;
  return sign * Math.min(1, shaped);
}

/** Maps a centered -1..1 shaped axis to the 0..1 throttle convention (0.5 = center/hover-ish). */
export function throttleFromAxis(rawY: number): number {
  const up = -rawY; // stick pushed up/forward commonly reads as a negative Y axis value
  return clamp01((up + 1) / 2);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

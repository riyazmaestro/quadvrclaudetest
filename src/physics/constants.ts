// Physical parameters for a small indoor "living room safe" quadcopter
// (roughly a 3"-4" class camera/freestyle micro-quad). Tuned for controllable,
// non-twitchy indoor flight rather than racing-drone aggression.

export const PHYSICS_HZ = 240; // fixed-timestep substep rate
export const FIXED_DT = 1 / PHYSICS_HZ;

export const GRAVITY = 9.81; // m/s^2

// --- Airframe ---
export const MASS = 0.6; // kg
// Motor positions in body frame, X = right, Y = up, Z = forward is -Z (three.js/WebXR convention)
export const HALF_X = 0.11; // m, half-span left/right
export const HALF_Z = 0.11; // m, half-span front/back
export const ARM_LENGTH = Math.hypot(HALF_X, HALF_Z); // center-to-motor distance, ~0.1556 m

// Diagonal moment of inertia tensor (kg*m^2), body frame, approximated for a small X-frame quad.
// Axis-to-motion mapping matches Mixer.ts's derivation: rotation about X = pitch, about Z = roll,
// about Y = yaw (both xx/zz are equal here since the frame is square, so this never mattered in
// practice, but keep it right — an asymmetric frame would silently swap pitch/roll feel otherwise).
export const INERTIA = {
  xx: 0.0016, // pitch axis
  yy: 0.0030, // yaw axis (usually largest, mass further from axis on avg)
  zz: 0.0016, // roll axis
};

// --- Motors / propellers ---
// Total max thrust expressed as thrust-to-weight ratio (typical hobby quad: 1.8 - 2.5)
export const THRUST_TO_WEIGHT_MAX = 2.0;
export const MAX_THRUST_TOTAL = THRUST_TO_WEIGHT_MAX * MASS * GRAVITY; // N
export const MAX_THRUST_PER_MOTOR = MAX_THRUST_TOTAL / 4; // N

// Motor spin-up/down lag, modeled as first-order lag filter (electric motor + prop inertia).
export const MOTOR_TAU = 0.035; // seconds

// Reaction (drag) torque per unit thrust from each spinning prop, about the yaw (Y) axis.
// Real props: torque roughly proportional to thrust for a given prop, small quads ~0.011-0.02 Nm per N.
export const YAW_TORQUE_PER_THRUST = 0.018; // Nm per N

// --- Aerodynamic drag (simplified isotropic quadratic + linear model) ---
export const LINEAR_DRAG = 0.22; // N per (m/s)
export const QUADRATIC_DRAG = 0.30; // N per (m/s)^2
export const ANGULAR_LINEAR_DRAG = 0.010; // Nm per (rad/s)
export const ANGULAR_QUADRATIC_DRAG = 0.004; // Nm per (rad/s)^2

// --- Ground effect: extra lift multiplier when close to floor ---
export const GROUND_EFFECT_HEIGHT = 0.35; // m, effect fades out by this height
export const GROUND_EFFECT_MAX_BOOST = 0.18; // fraction of thrust boost at height ~0

// --- Flight envelope ---
export const MAX_ANGLE_DEG = 35; // self-level (ANGLE mode) max commanded tilt
export const MAX_RATE_DEG_S = 220; // ACRO mode max commanded roll/pitch rate
export const MAX_YAW_RATE_DEG_S = 180; // max commanded yaw rate (both modes)

// --- Rate-loop PID gains (inner loop, torque output in Nm per rad/s error) ---
// Tuned iteratively via the headless simulation harness (scripts/simTest.ts).
export const RATE_PID = {
  roll: { kP: 0.045, kI: 0.03, kD: 0.0022, iMax: 3.0 },
  pitch: { kP: 0.045, kI: 0.03, kD: 0.0022, iMax: 3.0 },
  yaw: { kP: 0.09, kI: 0.045, kD: 0.0, iMax: 3.0 },
};

// --- Angle-loop P gain (outer loop, ANGLE mode: angle error -> target rate in deg/s per deg) ---
export const ANGLE_P_GAIN = 8.0;

// --- Altitude-hold throttle (ANGLE/beginner mode only) ---
// Quest Touch thumbsticks are spring-centered (unlike a real transmitter's throttle stick, which
// has no spring return), so mapping the stick directly to absolute thrust means the drone
// free-falls the instant the stick is released. Instead, in ANGLE mode the throttle axis commands
// a target vertical climb rate (stick centered = hold altitude), tracked by a velocity PID whose
// output is added to a feedforward hover-thrust estimate. ACRO mode keeps true manual/direct
// throttle, matching how real acro pilots fly (constant active stick management).
export const MAX_CLIMB_RATE = 1.4; // m/s, indoor-safe vertical speed limit for alt-hold
export const ALT_HOLD_PID = { kP: 3.2, kI: 1.6, kD: 0.6, iMax: MASS * GRAVITY * 0.6 };

// --- Crash / collision ---
export const FLOOR_RESTITUTION = 0.15; // bounce fraction on hard floor contact
export const FLOOR_FRICTION = 0.6; // horizontal velocity damping factor on floor contact
export const CRASH_SPEED_THRESHOLD = 3.0; // m/s impact speed that triggers auto-disarm "crashed" state
// Wall/boundary impacts need their OWN (lower) threshold: floor crashes are typically from a
// fall (gravity has room to build vertical speed), but a lateral hit into the arena boundary is
// capped by how much distance is available to accelerate over inside a small living room — full
// stick deflection from the center of a 1.75m-radius arena only reaches ~2.2-2.9 m/s by the time
// the drone first touches the wall (measured empirically, see scripts/simTest.ts Test 15), so
// reusing CRASH_SPEED_THRESHOLD here would almost never fire.
export const WALL_CRASH_SPEED_THRESHOLD = 2.0; // m/s outward impact speed that crashes on a wall/boundary hit
export const BODY_RADIUS = 0.16; // m, approx bounding sphere radius for simple collisions

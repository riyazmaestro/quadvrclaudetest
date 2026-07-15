export interface PIDGains {
  kP: number;
  kI: number;
  kD: number;
  iMax: number;
}

export class PIDController {
  private integral = 0;
  private prevError = 0;
  private hasPrev = false;

  constructor(private gains: PIDGains) {}

  reset(): void {
    this.integral = 0;
    this.hasPrev = false;
  }

  /** error = target - actual. dt in seconds. Returns control output. */
  update(error: number, dt: number): number {
    this.integral += error * dt;
    const { iMax } = this.gains;
    if (this.integral > iMax) this.integral = iMax;
    else if (this.integral < -iMax) this.integral = -iMax;

    const derivative = this.hasPrev ? (error - this.prevError) / dt : 0;
    this.prevError = error;
    this.hasPrev = true;

    return this.gains.kP * error + this.gains.kI * this.integral + this.gains.kD * derivative;
  }
}

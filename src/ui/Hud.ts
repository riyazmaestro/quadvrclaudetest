import * as THREE from 'three';

export interface HudData {
  armed: boolean;
  flightMode: 'ACRO' | 'ANGLE';
  altitudeM: number;
  speedMs: number;
  boundaryProximity: number; // 0 = safe, 1 = at/past the wall boundary
  flightTimeS: number; // seconds since last arm
}

const BOUNDARY_WARN_THRESHOLD = 0.6;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 512;
const REDRAW_INTERVAL_S = 1 / 15;

// Distance/offset the panel sits at relative to the camera, in meters, in the camera's local
// space (+x right, +y up, -z forward). Tuned so the panel subtends ~27deg of horizontal FOV
// (was ~47deg at the first pass's 0.52m/0.6m — nearly half a headset's view, which fails the
// "modest, don't block the room" brief) and sits low enough to read as a glanced-at dashboard
// rather than a screen sitting in the middle of where the user is looking at their drone.
const PANEL_OFFSET = new THREE.Vector3(0, -0.22, -0.7);
const PANEL_WIDTH_M = 0.34;
const PANEL_HEIGHT_M = (PANEL_WIDTH_M * CANVAS_HEIGHT) / CANVAS_WIDTH;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Hud {
  readonly object: THREE.Object3D;

  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly sprite: THREE.Sprite;

  private redrawAccumulator = REDRAW_INTERVAL_S;
  private pulsePhase = 0;
  private readonly tmpOffset = new THREE.Vector3();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Hud: failed to acquire 2D canvas context');
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.sprite = new THREE.Sprite(material);
    this.sprite.scale.set(PANEL_WIDTH_M, PANEL_HEIGHT_M, 1);
    this.sprite.renderOrder = 999999;
    this.object = this.sprite;

    this.drawFrame({
      armed: false,
      flightMode: 'ACRO',
      altitudeM: 0,
      speedMs: 0,
      boundaryProximity: 0,
      flightTimeS: 0,
    });
    this.texture.needsUpdate = true;
  }

  update(data: HudData, camera: THREE.PerspectiveCamera, dt: number): void {
    this.tmpOffset.copy(PANEL_OFFSET).applyQuaternion(camera.quaternion);
    this.sprite.position.copy(camera.position).add(this.tmpOffset);

    const proximity = Math.min(1, Math.max(0, data.boundaryProximity));
    const isWarning = proximity > BOUNDARY_WARN_THRESHOLD;
    if (isWarning) {
      this.pulsePhase += dt;
    } else {
      this.pulsePhase = 0;
    }

    this.redrawAccumulator += dt;
    if (this.redrawAccumulator >= REDRAW_INTERVAL_S) {
      this.redrawAccumulator = 0;
      this.drawFrame(data);
      this.texture.needsUpdate = true;
    }
  }

  private drawFrame(data: HudData): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    this.drawBoundaryVignette(data.boundaryProximity);

    const armedColor = data.armed ? '#2ee06b' : '#e0392e';
    this.drawPlate(24, 24, 210, 56);
    ctx.fillStyle = armedColor;
    ctx.beginPath();
    ctx.arc(52, 52, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eafff2';
    ctx.font = '700 26px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.armed ? 'ARMED' : 'DISARMED', 74, 53);

    this.drawPlate(244, 24, 130, 56);
    ctx.fillStyle = '#eafff2';
    ctx.font = '700 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(data.flightMode, 244 + 65, 53);
    ctx.textAlign = 'left';

    if (!data.armed) {
      ctx.fillStyle = '#ffd76a';
      ctx.font = '600 20px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pull right trigger to engage', CANVAS_WIDTH / 2, CANVAS_HEIGHT - 140);
      ctx.textAlign = 'left';
    }

    this.drawReadout(CANVAS_WIDTH - 234, 24, 210, 'ALT', data.altitudeM.toFixed(1), 'm');
    this.drawReadout(CANVAS_WIDTH - 234, 92, 210, 'SPD', data.speedMs.toFixed(1), 'm/s');

    const totalSeconds = Math.max(0, Math.floor(data.flightTimeS));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timerText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const timerWidth = 140;
    this.drawPlate((CANVAS_WIDTH - timerWidth) / 2, CANVAS_HEIGHT - 76, timerWidth, 48);
    ctx.fillStyle = '#eafff2';
    ctx.font = '700 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(timerText, CANVAS_WIDTH / 2, CANVAS_HEIGHT - 52);
    ctx.textAlign = 'left';
  }

  private drawPlate(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(8, 14, 12, 0.55)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
  }

  private drawReadout(x: number, y: number, w: number, label: string, value: string, unit: string): void {
    const ctx = this.ctx;
    const h = 56;
    this.drawPlate(x, y, w, h);
    ctx.fillStyle = 'rgba(234, 255, 242, 0.65)';
    ctx.font = '600 12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 14, y + 16);

    ctx.fillStyle = '#eafff2';
    ctx.font = '700 26px sans-serif';
    ctx.textAlign = 'right';
    const unitWidth = ctx.measureText(unit).width;
    ctx.font = '500 14px sans-serif';
    ctx.fillText(unit, x + w - 14, y + 38);
    ctx.font = '700 26px sans-serif';
    ctx.fillText(value, x + w - 14 - unitWidth - 6, y + 38);
    ctx.textAlign = 'left';
  }

  private drawBoundaryVignette(rawProximity: number): void {
    const proximity = Math.min(1, Math.max(0, rawProximity));
    if (proximity <= BOUNDARY_WARN_THRESHOLD) {
      return;
    }
    const base = (proximity - BOUNDARY_WARN_THRESHOLD) / (1 - BOUNDARY_WARN_THRESHOLD);
    const pulse = 0.75 + 0.25 * Math.sin(this.pulsePhase * (Math.PI * 2) / 0.9);
    const alpha = Math.min(1, base) * pulse;

    const ctx = this.ctx;
    const cx = CANVAS_WIDTH / 2;
    const cy = CANVAS_HEIGHT / 2;
    const outerRadius = Math.hypot(cx, cy);
    const gradient = ctx.createRadialGradient(cx, cy, outerRadius * 0.55, cx, cy, outerRadius);
    gradient.addColorStop(0, 'rgba(255, 30, 20, 0)');
    gradient.addColorStop(1, `rgba(255, 30, 20, ${(0.65 * alpha).toFixed(3)})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }
}

import {
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { BoundaryPoint } from '../xr/XRSessionManager';

const BOUNDARY_Y = 0.01;
const SCANNED_BOUNDARY_COLOR = 0x4fd1c5; // cyan: a real (sanity-checked) room-scan reading
const FALLBACK_BOUNDARY_COLOR = 0xd9a441; // amber: safe-default circle, not the real room shape
const CIRCLE_SEGMENTS = 48;

export class SceneSetup {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.02, 100);
  readonly renderer: WebGLRenderer;
  private boundaryLine: Line | null = null;

  constructor() {
    this.scene.background = null; // transparent so passthrough camera feed shows through

    const ambient = new AmbientLight(0xffffff, 0.9);
    const sun = new DirectionalLight(0xffffff, 1.1);
    sun.position.set(1, 2, 1);
    this.scene.add(ambient, sun);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    document.body.appendChild(this.renderer.domElement);

    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /** Draws a glowing line loop on the floor marking the safe-fly boundary (scanned room polygon or fallback circle). */
  setBoundaryVisual(boundary: { polygon: BoundaryPoint[] | null; radius: number; isScannedPolygon: boolean }): void {
    if (this.boundaryLine) {
      this.scene.remove(this.boundaryLine);
      this.boundaryLine.geometry.dispose();
      (this.boundaryLine.material as LineBasicMaterial).dispose();
      this.boundaryLine = null;
    }

    const points = boundary.polygon ?? circlePoints(boundary.radius);
    const positions: number[] = [];
    for (const p of points) positions.push(p.x, BOUNDARY_Y, p.z);
    const first = points[0];
    positions.push(first.x, BOUNDARY_Y, first.z); // close the loop

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const color = boundary.isScannedPolygon ? SCANNED_BOUNDARY_COLOR : FALLBACK_BOUNDARY_COLOR;
    const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
    this.boundaryLine = new Line(geometry, material);
    this.scene.add(this.boundaryLine);
  }
}

function circlePoints(radius: number): BoundaryPoint[] {
  const points: BoundaryPoint[] = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
    const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
    points.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  }
  return points;
}

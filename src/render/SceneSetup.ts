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
const BOUNDARY_COLOR = 0x4fd1c5;
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

  /** Draws a glowing line loop on the floor marking the safe-fly boundary (Guardian polygon or fallback circle). */
  setBoundaryVisual(polygon: BoundaryPoint[] | null, fallbackRadius: number): void {
    if (this.boundaryLine) {
      this.scene.remove(this.boundaryLine);
      this.boundaryLine.geometry.dispose();
      (this.boundaryLine.material as LineBasicMaterial).dispose();
      this.boundaryLine = null;
    }

    const points = polygon ?? circlePoints(fallbackRadius);
    const positions: number[] = [];
    for (const p of points) positions.push(p.x, BOUNDARY_Y, p.z);
    const first = points[0];
    positions.push(first.x, BOUNDARY_Y, first.z); // close the loop

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({ color: BOUNDARY_COLOR, transparent: true, opacity: 0.55 });
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

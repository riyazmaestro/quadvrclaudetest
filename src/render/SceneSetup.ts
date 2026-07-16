import {
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import type { BoundaryPoint } from '../xr/XRSessionManager';

const BOUNDARY_Y = 0.01;
const BOUNDARY_COLOR = 0x4fd1c5; // cyan: the pilot's own marked room boundary
const CALIBRATION_COLOR = 0xe8ecf1; // near-white: in-progress calibration markers/pointer, distinct from the final boundary color

export class SceneSetup {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.02, 100);
  readonly renderer: WebGLRenderer;
  private boundaryLine: Line | null = null;
  private calibrationPointer: Mesh | null = null;
  private calibrationMarkers: Mesh[] = [];
  private calibrationLine: Line | null = null;

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

  /** Draws a glowing closed line loop on the floor marking the pilot's marked room boundary. No-ops (clearing any existing line) if the polygon isn't ready yet (pre-calibration). */
  setBoundaryVisual(polygon: BoundaryPoint[]): void {
    if (this.boundaryLine) {
      this.scene.remove(this.boundaryLine);
      this.boundaryLine.geometry.dispose();
      (this.boundaryLine.material as LineBasicMaterial).dispose();
      this.boundaryLine = null;
    }
    if (polygon.length < 3) return;

    const positions: number[] = [];
    for (const p of polygon) positions.push(p.x, BOUNDARY_Y, p.z);
    const first = polygon[0];
    positions.push(first.x, BOUNDARY_Y, first.z); // close the loop

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new LineBasicMaterial({ color: BOUNDARY_COLOR, transparent: true, opacity: 0.55 });
    this.boundaryLine = new Line(geometry, material);
    this.scene.add(this.boundaryLine);
  }

  /**
   * Shows/moves a "aim here" ghost ring at the calibration pointer's current floor position
   * (right controller, see ControllerInput.pollCalibration), or hides it when null. Called every
   * animation frame during calibration, so the ring is created once and just repositioned/toggled
   * rather than disposed and recreated each call.
   */
  setCalibrationPointer(position: BoundaryPoint | null): void {
    if (!this.calibrationPointer) {
      const geometry = new RingGeometry(0.05, 0.07, 24);
      geometry.rotateX(-Math.PI / 2); // flat on the floor plane, matching the boundary line's orientation
      const material = new MeshBasicMaterial({ color: CALIBRATION_COLOR, transparent: true, opacity: 0.85, side: DoubleSide });
      this.calibrationPointer = new Mesh(geometry, material);
      this.scene.add(this.calibrationPointer);
    }
    this.calibrationPointer.visible = position !== null;
    if (position) this.calibrationPointer.position.set(position.x, BOUNDARY_Y, position.z);
  }

  /**
   * Draws the corners placed so far (small markers) and an open connecting line — deliberately
   * NOT closed into a loop, unlike setBoundaryVisual(), since calibration isn't a room shape yet
   * until the pilot confirms it. Only called on place/undo (infrequent), so dispose+recreate is
   * fine here, unlike the ghost pointer above.
   */
  setCalibrationPoints(points: BoundaryPoint[]): void {
    for (const marker of this.calibrationMarkers) {
      this.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as MeshBasicMaterial).dispose();
    }
    this.calibrationMarkers = points.map((p) => {
      const marker = new Mesh(new SphereGeometry(0.04, 12, 8), new MeshBasicMaterial({ color: CALIBRATION_COLOR }));
      marker.position.set(p.x, BOUNDARY_Y, p.z);
      this.scene.add(marker);
      return marker;
    });

    if (this.calibrationLine) {
      this.scene.remove(this.calibrationLine);
      this.calibrationLine.geometry.dispose();
      (this.calibrationLine.material as LineBasicMaterial).dispose();
      this.calibrationLine = null;
    }
    if (points.length >= 2) {
      const positions: number[] = [];
      for (const p of points) positions.push(p.x, BOUNDARY_Y, p.z);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const material = new LineBasicMaterial({ color: CALIBRATION_COLOR, transparent: true, opacity: 0.7 });
      this.calibrationLine = new Line(geometry, material);
      this.scene.add(this.calibrationLine);
    }
  }

  /** Hides the ghost pointer and clears placed-corner markers/line — call once calibration ends. */
  clearCalibrationVisuals(): void {
    this.setCalibrationPointer(null);
    this.setCalibrationPoints([]);
  }
}

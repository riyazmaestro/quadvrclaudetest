// The WebXR Plane Detection module (https://immersive-web.github.io/real-world-geometry/plane-detection.html)
// is a separate incubating spec not yet folded into TypeScript's lib.dom.d.ts, so its types are
// declared here by hand. `semanticLabel` is a Meta Quest Browser extension, not in the spec itself.
export {};

declare global {
  interface XRPlane {
    readonly orientation: 'horizontal' | 'vertical';
    readonly polygon: DOMPointReadOnly[];
    readonly planeSpace: XRSpace;
    readonly lastChangedTime: number;
    readonly semanticLabel?: string;
  }

  type XRPlaneSet = ReadonlySet<XRPlane>;

  interface XRFrame {
    readonly detectedPlanes?: XRPlaneSet;
  }
}

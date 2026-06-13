import * as THREE from "three/webgpu";

export async function createRenderer(
  container: HTMLElement,
  onDeviceLost?: (info: GPUDeviceLostInfo) => void,
): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x02030a, 1);
  // The shader emits linear HDR; all grading lives in the single post chain (ADR-0005).
  renderer.toneMapping = THREE.NoToneMapping;
  container.append(renderer.domElement);
  await renderer.init();
  // Surface an unrecoverable GPU reset (driver TDR, power event, adapter removal) instead of
  // leaving a frozen black canvas. `device.lost` resolves at most once and never rejects;
  // reason "destroyed" is our own teardown calling device.destroy(), so don't report that.
  const device = (renderer.backend as { device?: GPUDevice }).device;
  if (device && onDeviceLost) {
    void device.lost.then((info) => {
      if (info.reason !== "destroyed") onDeviceLost(info);
    });
  }
  return renderer;
}

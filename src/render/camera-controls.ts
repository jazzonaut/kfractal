import type { Stage } from "./stage";

type Mode = "idle" | "orbit" | "pan" | "roll" | "pinch";

export class CameraControls {
  // Every active pointer (mouse button or finger) currently down on the element, keyed by
  // pointerId. A mouse drag holds one entry; touch can hold two (or more) for a pinch.
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: Mode = "idle";
  // Baseline for the single-pointer drag (orbit/pan/roll): the last sample of the one
  // pointer that owns the gesture, so each move measures a frame-to-frame delta.
  private lastX = 0;
  private lastY = 0;
  // Baseline for the two-finger transform: finger spread, twist angle, and centroid at the
  // previous sample. Pinch maps spread->dolly, centroid->pan, twist->roll, all at once.
  private pinchDist = 1;
  private pinchAngle = 0;
  private pinchCx = 0;
  private pinchCy = 0;
  private changed = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly stage: Stage,
  ) {
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointercancel", this.onPointerUp);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("contextmenu", this.onContextMenu);
  }

  consumeChanged(): boolean {
    const value = this.changed;
    this.changed = false;
    return value;
  }

  dispose(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointercancel", this.onPointerUp);
    this.element.removeEventListener("wheel", this.onWheel);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Back/forward mouse buttons may navigate history away mid-render; don't orbit on them.
    if (event.button > 2) return;
    // Middle button would otherwise start the browser's autoscroll mode.
    if (event.button === 1) event.preventDefault();
    const touch = event.pointerType === "touch" || event.pointerType === "pen";
    // A mouse drag is single-pointer: ignore extra buttons pressed mid-drag so a second
    // button can't reinterpret the gesture. (Touch is allowed a second finger -> pinch.)
    if (!touch && this.pointers.size > 0) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.element.setPointerCapture(event.pointerId);
    if (touch) {
      // The button-less touch gesture is chosen by finger count (1 = orbit, 2 = pinch).
      this.syncTouchGesture();
    } else {
      this.mode =
        event.button === 1 ? "roll" : event.button === 2 || event.shiftKey ? "pan" : "orbit";
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    // Not a pointer we own (e.g. a hover with no button, or one we declined on down).
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    if (this.mode === "pinch") {
      this.handlePinch();
      return;
    }
    // Single-pointer drag: mouse button drag, or a one-finger touch orbit.
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (this.mode === "roll") this.stage.rollBy(dx * 0.005);
    else if (this.mode === "pan") this.stage.pan(dx, dy);
    else this.stage.orbit(-dx * 0.004, -dy * 0.004);
    this.changed = true;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    // A pointer we never owned lifting (e.g. the declined second mouse button) is a no-op.
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.delete(event.pointerId);
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
    // Re-derive the gesture from whatever fingers remain so a pinch degrades cleanly back to
    // a one-finger orbit (re-baselining off the survivor) instead of jumping.
    this.syncTouchGesture();
  };

  /** Pick the touch gesture (and re-baseline it) from the set of fingers currently down. */
  private syncTouchGesture(): void {
    const pts = [...this.pointers.values()];
    if (pts.length >= 2) {
      this.mode = "pinch";
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x);
      this.pinchCx = (a.x + b.x) / 2;
      this.pinchCy = (a.y + b.y) / 2;
    } else if (pts.length === 1) {
      this.mode = "orbit";
      this.lastX = pts[0]!.x;
      this.lastY = pts[0]!.y;
    } else {
      this.mode = "idle";
    }
  }

  /** The two-finger transform: spread -> dolly, centroid travel -> pan, twist -> roll. */
  private handlePinch(): void {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    const dist = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    // dolly(delta) scales distance by (1 + delta); pinchDist/dist - 1 is negative when the
    // fingers spread (dist grows), so spreading zooms in and pinching zooms out.
    this.stage.dolly(this.pinchDist / dist - 1);
    // Centroid translation pans, matching the mouse pan's raw screen-pixel deltas.
    this.stage.pan(cx - this.pinchCx, cy - this.pinchCy);
    // Twist between the fingers rolls; wrap the delta so crossing ±π doesn't fling the roll.
    const dAngle = angle - this.pinchAngle;
    this.stage.rollBy(Math.atan2(Math.sin(dAngle), Math.cos(dAngle)));
    this.pinchDist = dist;
    this.pinchAngle = angle;
    this.pinchCx = cx;
    this.pinchCy = cy;
    this.changed = true;
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    // Normalize deltaMode to pixels: Firefox commonly reports LINE (deltaY ~ ±3) where
    // Chrome reports PIXEL (~ ±100), which would make the dolly/dive ~30x slower per notch.
    let deltaPx = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) deltaPx *= 16;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      deltaPx *= this.element.clientHeight || window.innerHeight;
    }
    this.stage.dolly(deltaPx * 0.001);
    this.changed = true;
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}

import type { Stage } from "./stage";

export class CameraControls {
  private dragging = false;
  private panning = false;
  private rolling = false;
  // The single pointer that owns the current drag. A second touch is ignored so two
  // interleaved pointermove streams can't make each dx/dy measure finger-to-finger distance
  // and fling the camera (and so the other finger lifting doesn't end the drag prematurely).
  private activePointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private changed = false;
  private ndcX: number | null = null;
  private ndcY: number | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly stage: Stage,
  ) {
    element.addEventListener("pointerdown", this.onPointerDown);
    element.addEventListener("pointermove", this.onPointerMove);
    element.addEventListener("pointerup", this.onPointerUp);
    element.addEventListener("pointercancel", this.onPointerUp);
    element.addEventListener("pointerleave", this.onPointerLeave);
    element.addEventListener("wheel", this.onWheel, { passive: false });
    element.addEventListener("contextmenu", this.onContextMenu);
  }

  consumeChanged(): boolean {
    const value = this.changed;
    this.changed = false;
    return value;
  }

  /**
   * Last pointer position in NDC (x right, y up), or null when the pointer is off the
   * canvas. The DiveController aims the zoom at the surface under this point.
   */
  pointerNdc(): { x: number; y: number } | null {
    if (this.ndcX === null || this.ndcY === null) return null;
    return { x: this.ndcX, y: this.ndcY };
  }

  private trackPointer(event: { clientX: number; clientY: number }): void {
    const rect = this.element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    this.ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  }

  dispose(): void {
    this.element.removeEventListener("pointerdown", this.onPointerDown);
    this.element.removeEventListener("pointermove", this.onPointerMove);
    this.element.removeEventListener("pointerup", this.onPointerUp);
    this.element.removeEventListener("pointercancel", this.onPointerUp);
    this.element.removeEventListener("pointerleave", this.onPointerLeave);
    this.element.removeEventListener("wheel", this.onWheel);
    this.element.removeEventListener("contextmenu", this.onContextMenu);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // A drag is already in progress under another pointer; ignore the second touch.
    if (this.activePointerId !== null) return;
    // Back/forward mouse buttons may navigate history away mid-render; don't orbit on them.
    if (event.button > 2) return;
    // Middle button would otherwise start the browser's autoscroll mode.
    if (event.button === 1) event.preventDefault();
    this.activePointerId = event.pointerId;
    this.dragging = true;
    this.rolling = event.button === 1;
    this.panning = !this.rolling && (event.button === 2 || event.shiftKey);
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.element.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.trackPointer(event);
    if (!this.dragging || event.pointerId !== this.activePointerId) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (this.rolling) this.stage.rollBy(dx * 0.005);
    else if (this.panning) this.stage.pan(dx, dy);
    else this.stage.orbit(-dx * 0.004, -dy * 0.004);
    this.changed = true;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    // Only the pointer that owns the drag ends it; another finger lifting is a no-op.
    if (this.activePointerId !== null && event.pointerId !== this.activePointerId) return;
    this.activePointerId = null;
    this.dragging = false;
    this.panning = false;
    this.rolling = false;
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.ndcX = null;
    this.ndcY = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.trackPointer(event);
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

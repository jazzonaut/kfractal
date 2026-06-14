import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraControls } from "../../src/render/camera-controls";
import type { Stage } from "../../src/render/stage";

// Pure event-handling logic: a mock element captures the listeners CameraControls registers,
// and a spy stage records the camera calls. No jsdom needed - the handlers only read plain
// fields off the event objects we feed them. WheelEvent's deltaMode constants are stubbed
// because the wheel handler references them statically.

type Handler = (event: Record<string, unknown>) => void;

function mockElement() {
  const listeners: Record<string, Handler> = {};
  const element = {
    listeners,
    addEventListener: (type: string, fn: Handler) => {
      listeners[type] = fn;
    },
    removeEventListener: () => {},
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    clientHeight: 100,
  };
  return element;
}

function spyStage() {
  return {
    orbit: vi.fn(),
    dolly: vi.fn(),
    pan: vi.fn(),
    rollBy: vi.fn(),
  };
}

const ev = (over: Record<string, unknown>): Record<string, unknown> => ({
  pointerId: 1,
  pointerType: "mouse",
  button: 0,
  clientX: 50,
  clientY: 50,
  shiftKey: false,
  deltaY: 0,
  deltaMode: 0,
  preventDefault: () => {},
  ...over,
});

let el: ReturnType<typeof mockElement>;
let stage: ReturnType<typeof spyStage>;

beforeEach(() => {
  vi.stubGlobal("WheelEvent", { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });
  el = mockElement();
  stage = spyStage();
  new CameraControls(el as unknown as HTMLElement, stage as unknown as Stage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("orbit drag", () => {
  it("left-button drag orbits the stage", () => {
    el.listeners.pointerdown!(ev({ button: 0, clientX: 50, clientY: 50 }));
    el.listeners.pointermove!(ev({ clientX: 60, clientY: 50 }));
    expect(stage.orbit).toHaveBeenCalledTimes(1);
    expect(stage.dolly).not.toHaveBeenCalled();
  });
});

describe("two-finger touch transform", () => {
  it("spreading two fingers dollies in (negative delta), pinching dollies out", () => {
    // Two fingers down 40px apart, centred at (50,50).
    el.listeners.pointerdown!(ev({ pointerType: "touch", pointerId: 1, clientX: 30, clientY: 50 }));
    el.listeners.pointerdown!(ev({ pointerType: "touch", pointerId: 2, clientX: 70, clientY: 50 }));
    expect(stage.orbit).not.toHaveBeenCalled(); // a second finger does not orbit
    // Spread to 80px apart -> zoom in -> dolly with delta < 0.
    el.listeners.pointermove!(ev({ pointerType: "touch", pointerId: 2, clientX: 90, clientY: 50 }));
    expect(stage.dolly).toHaveBeenCalledTimes(1);
    expect(stage.dolly.mock.calls[0]![0] as number).toBeLessThan(0);
  });

  it("translating both fingers together pans without dollying", () => {
    el.listeners.pointerdown!(ev({ pointerType: "touch", pointerId: 1, clientX: 30, clientY: 50 }));
    el.listeners.pointerdown!(ev({ pointerType: "touch", pointerId: 2, clientX: 70, clientY: 50 }));
    // Move both fingers +10x, keeping their spread constant -> pure pan, no zoom.
    el.listeners.pointermove!(ev({ pointerType: "touch", pointerId: 1, clientX: 40, clientY: 50 }));
    el.listeners.pointermove!(ev({ pointerType: "touch", pointerId: 2, clientX: 80, clientY: 50 }));
    expect(stage.pan).toHaveBeenCalled();
    // The centroid shifted right by 10px total across the two updates.
    const totalDx = stage.pan.mock.calls.reduce((sum, call) => sum + (call[0] as number), 0);
    expect(totalDx).toBeCloseTo(10, 6);
  });

  it("degrades from pinch back to a one-finger orbit when a finger lifts", () => {
    el.listeners.pointerdown!(ev({ pointerType: "touch", pointerId: 1, clientX: 30, clientY: 50 }));
    el.listeners.pointerdown!(ev({ pointerType: "touch", pointerId: 2, clientX: 70, clientY: 50 }));
    el.listeners.pointerup!(ev({ pointerType: "touch", pointerId: 2 }));
    // The surviving finger now orbits, re-baselined off its last position (no jump/fling).
    el.listeners.pointermove!(ev({ pointerType: "touch", pointerId: 1, clientX: 40, clientY: 50 }));
    expect(stage.orbit).toHaveBeenCalledTimes(1);
  });
});

describe("M4: mouse drag stays single-pointer", () => {
  it("ignores move/up events from a second pointer during a drag", () => {
    el.listeners.pointerdown!(ev({ pointerId: 1, clientX: 50 }));
    // A second finger's move must not orbit (would otherwise measure finger-to-finger distance).
    el.listeners.pointermove!(ev({ pointerId: 2, clientX: 200 }));
    expect(stage.orbit).not.toHaveBeenCalled();
    // The owning pointer still drives the camera.
    el.listeners.pointermove!(ev({ pointerId: 1, clientX: 60 }));
    expect(stage.orbit).toHaveBeenCalledTimes(1);
    // The non-owning pointer lifting does not end the drag.
    el.listeners.pointerup!(ev({ pointerId: 2 }));
    el.listeners.pointermove!(ev({ pointerId: 1, clientX: 70 }));
    expect(stage.orbit).toHaveBeenCalledTimes(2);
  });

  it("ignores a second pointerdown while a drag is active", () => {
    el.listeners.pointerdown!(ev({ pointerId: 1 }));
    el.listeners.pointerdown!(ev({ pointerId: 2 }));
    // Only pointer 1 owns the drag; a move from pointer 2 is still ignored.
    el.listeners.pointermove!(ev({ pointerId: 2, clientX: 90 }));
    expect(stage.orbit).not.toHaveBeenCalled();
  });
});

describe("L10: back/forward mouse buttons do not start a drag", () => {
  it("button > 2 is ignored", () => {
    el.listeners.pointerdown!(ev({ button: 3, pointerId: 1 }));
    el.listeners.pointermove!(ev({ pointerId: 1, clientX: 90 }));
    expect(stage.orbit).not.toHaveBeenCalled();
  });
});

describe("M5: wheel deltaMode normalization", () => {
  it("a LINE-mode notch dollies 16x a PIXEL-mode notch of the same deltaY", () => {
    el.listeners.wheel!(ev({ deltaY: 3, deltaMode: 0 })); // pixel
    el.listeners.wheel!(ev({ deltaY: 3, deltaMode: 1 })); // line (Firefox)
    expect(stage.dolly).toHaveBeenCalledTimes(2);
    const pixelArg = stage.dolly.mock.calls[0]![0] as number;
    const lineArg = stage.dolly.mock.calls[1]![0] as number;
    expect(pixelArg).toBeCloseTo(3 * 0.001, 12);
    expect(lineArg).toBeCloseTo(3 * 16 * 0.001, 12);
    expect(lineArg / pixelArg).toBeCloseTo(16, 12);
  });

  it("a PAGE-mode notch scales by the element height", () => {
    el.listeners.wheel!(ev({ deltaY: 1, deltaMode: 2 }));
    expect(stage.dolly.mock.calls[0]![0] as number).toBeCloseTo(100 * 0.001, 12);
  });
});

describe("control sensitivity", () => {
  it("scales every gesture's response by the multiplier", () => {
    const controls = new CameraControls(el as unknown as HTMLElement, stage as unknown as Stage);
    controls.setSensitivity(2);
    // Orbit: dx = 10 -> orbit(-10 * 0.004 * 2) = -0.08 (double the default -0.04).
    el.listeners.pointerdown!(ev({ button: 0, clientX: 50, clientY: 50 }));
    el.listeners.pointermove!(ev({ clientX: 60, clientY: 50 }));
    expect(stage.orbit.mock.calls[0]![0] as number).toBeCloseTo(-0.08, 12);
    // Wheel dolly is scaled by the same multiplier.
    el.listeners.wheel!(ev({ deltaY: 3, deltaMode: 0 }));
    expect(stage.dolly.mock.calls[0]![0] as number).toBeCloseTo(3 * 0.001 * 2, 12);
  });

  it("clamps a non-positive or non-finite multiplier back to 1 (the default feel)", () => {
    const controls = new CameraControls(el as unknown as HTMLElement, stage as unknown as Stage);
    controls.setSensitivity(0);
    el.listeners.pointerdown!(ev({ button: 0, clientX: 50, clientY: 50 }));
    el.listeners.pointermove!(ev({ clientX: 60, clientY: 50 }));
    expect(stage.orbit.mock.calls[0]![0] as number).toBeCloseTo(-0.04, 12);
  });
});

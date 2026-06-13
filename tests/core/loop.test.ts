import { afterEach, describe, expect, it, vi } from "vitest";
import { startLoop } from "../../src/core/loop";

/** Hand-driven requestAnimationFrame: queue callbacks and flush them one frame at a time. */
function harness() {
  let now = 0;
  const queue: Array<(t: number) => void> = [];
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    queue.push(cb);
    return queue.length;
  });
  return {
    step(t: number) {
      now = t;
      const cb = queue.shift();
      cb?.(t);
    },
    pending: () => queue.length,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startLoop", () => {
  it("invokes update then render every frame and reschedules", () => {
    const h = harness();
    const calls: string[] = [];
    startLoop({
      update: () => calls.push("update"),
      render: () => calls.push("render"),
    });
    expect(h.pending()).toBe(1); // initial schedule
    h.step(16);
    expect(calls).toEqual(["update", "render"]);
    expect(h.pending()).toBe(1); // rescheduled itself
    h.step(32);
    expect(calls).toEqual(["update", "render", "update", "render"]);
  });

  it("passes dt in seconds and clamps a long stall to 0.05s", () => {
    const h = harness();
    const dts: number[] = [];
    startLoop({ update: (dt) => dts.push(dt), render: () => {} });
    h.step(16); // ~16ms since start
    expect(dts[0]).toBeCloseTo(0.016, 6);
    h.step(2016); // 2s gap -> clamped
    expect(dts[1]).toBe(0.05);
  });

  it("stop() halts the loop and stops rescheduling", () => {
    const h = harness();
    let frames = 0;
    const loop = startLoop({ update: () => (frames += 1), render: () => {} });
    h.step(16);
    expect(frames).toBe(1);
    loop.stop();
    h.step(32); // the already-queued frame runs but should early-return
    expect(frames).toBe(1);
    expect(h.pending()).toBe(0); // nothing rescheduled
  });
});

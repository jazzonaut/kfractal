export interface LoopCallbacks {
  readonly update: (dt: number, elapsed: number) => void;
  readonly render: (dt: number, elapsed: number) => void;
}

export interface RunningLoop {
  readonly stop: () => void;
}

export function startLoop(callbacks: LoopCallbacks): RunningLoop {
  let active = true;
  let previous = performance.now();

  const frame = (now: number): void => {
    if (!active) return;
    const dt = Math.min((now - previous) / 1000, 0.05);
    previous = now;
    const elapsed = now / 1000;
    callbacks.update(dt, elapsed);
    callbacks.render(dt, elapsed);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
  return {
    stop: () => {
      active = false;
    },
  };
}

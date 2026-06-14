import { MAX_FRAME_DT } from "../config/constants";

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
    // Clamp long stalls; this also bounds the auto-quality signal (see MAX_FRAME_DT).
    const dt = Math.min((now - previous) / 1000, MAX_FRAME_DT);
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

import { describe, expect, it } from "vitest";
import { effectiveSupersample } from "../../src/render/supersample";

describe("effectiveSupersample", () => {
  it("passes the requested factor through when it fits the limit", () => {
    expect(effectiveSupersample(1920, 1080, 2, 8192)).toBe(2);
    expect(effectiveSupersample(1000, 1000, 4, 16384)).toBe(4);
  });

  it("never supersamples below 1 (off)", () => {
    expect(effectiveSupersample(1920, 1080, 1, 8192)).toBe(1);
    expect(effectiveSupersample(1920, 1080, 0, 8192)).toBe(1);
  });

  it("clamps so the long side never exceeds the texture limit", () => {
    // 8K @ 2x would be 16384 > 8192 -> reduced to 1x.
    expect(effectiveSupersample(7680, 4320, 2, 8192)).toBe(1);
    // 4K @ 4x would be 15360 > 8192 -> reduced to 2x (floor(8192/3840) = 2).
    expect(effectiveSupersample(3840, 2160, 4, 8192)).toBe(2);
  });

  it("uses the long side, not the area", () => {
    // Portrait: height is the long side and drives the clamp.
    expect(effectiveSupersample(2160, 3840, 4, 8192)).toBe(2);
  });

  it("honours a larger live limit", () => {
    // 4K @ 4x fits under a 16384 limit -> stays 4x.
    expect(effectiveSupersample(3840, 2160, 4, 16384)).toBe(4);
  });
});

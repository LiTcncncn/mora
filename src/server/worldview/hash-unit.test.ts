import { describe, expect, it } from "vitest";
import { fnv1aUnit } from "./hash-unit";

describe("fnv1aUnit", () => {
  it("固定输入产出固定 unit", () => {
    expect(fnv1aUnit("seed-abc:0:credit-v1")).toBeCloseTo(0.012_452_443_1, 5);
  });

  it("映射到 0..1", () => {
    expect(fnv1aUnit("test")).toBeGreaterThanOrEqual(0);
    expect(fnv1aUnit("test")).toBeLessThanOrEqual(1);
  });
});

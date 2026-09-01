import { describe, expect, it } from "vitest";
import { pickOrganicWorldviewMode } from "./energy-modes";

describe("pickOrganicWorldviewMode", () => {
  it("E2 COMPANION 且种子允许 W1/W2 时取 W2 以提高显性", () => {
    expect(
      pickOrganicWorldviewMode(["W1", "W2"], {
        energy: "E2",
        responseMode: "COMPANION",
      }),
    ).toBe("W2");
  });

  it("E1 COMPANION 仍取 W1，避免短回复被挤占", () => {
    expect(
      pickOrganicWorldviewMode(["W1", "W2"], {
        energy: "E1",
        responseMode: "COMPANION",
      }),
    ).toBe("W1");
  });

  it("DIRECT_ANSWER 只有 W1 时取 W1", () => {
    expect(
      pickOrganicWorldviewMode(["W1"], {
        energy: "E3",
        responseMode: "DIRECT_ANSWER",
      }),
    ).toBe("W1");
  });
});

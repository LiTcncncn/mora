import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { runsDataSchema } from "@/domain/run";

describe("runs.json data file", () => {
  it("validates against current schema", () => {
    const raw = JSON.parse(fs.readFileSync("data/runs.json", "utf8"));
    const result = runsDataSchema.safeParse(raw.data);
    if (!result.success) {
      const sample = result.error.issues.slice(0, 20).map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      console.log(JSON.stringify(sample, null, 2));
      console.log("total issues:", result.error.issues.length);
    }
    expect(result.success).toBe(true);
  });
});

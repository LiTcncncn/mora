import { describe, expect, it } from "vitest";
import {
  addCivilDays,
  formatCivilDate,
  inferOccurredOnFromText,
  memoryOverlapsTimeWindow,
  parseRelativeTimeWindow,
} from "./time-window";

describe("memory time-window", () => {
  // 2026-09-09 是周三（上海）
  const now = new Date("2026-09-09T12:00:00+08:00");

  it("解析前天/昨天/今天", () => {
    expect(parseRelativeTimeWindow("聊聊前天的事", now)).toEqual({
      startOn: "2026-09-07",
      endOn: "2026-09-07",
      label: "前天",
    });
    expect(parseRelativeTimeWindow("昨天好累", now)?.label).toBe("昨天");
    expect(parseRelativeTimeWindow("今天怎样", now)?.endOn).toBe("2026-09-09");
  });

  it("解析上周为上一个周一到周日", () => {
    const window = parseRelativeTimeWindow("聊聊上周的事", now);
    expect(window).toEqual({
      startOn: "2026-08-31",
      endOn: "2026-09-06",
      label: "上周",
    });
  });

  it("无相对时间返回 null", () => {
    expect(parseRelativeTimeWindow("我有点累", now)).toBeNull();
  });

  it("区间相交判定", () => {
    const window = {
      startOn: "2026-08-31",
      endOn: "2026-09-06",
      label: "上周",
    };
    expect(memoryOverlapsTimeWindow("2026-09-02", null, window)).toBe(true);
    expect(memoryOverlapsTimeWindow("2026-09-07", null, window)).toBe(false);
    expect(memoryOverlapsTimeWindow(null, null, window)).toBe(false);
    expect(
      memoryOverlapsTimeWindow("2026-08-30", "2026-09-01", window),
    ).toBe(true);
  });

  it("从文本推断事发日", () => {
    expect(inferOccurredOnFromText("前天答辩完了", now)).toEqual({
      occurredOn: "2026-09-07",
      occurredPrecision: "day",
    });
  });

  it("民事日加减与格式化", () => {
    expect(formatCivilDate(now)).toBe("2026-09-09");
    expect(addCivilDays("2026-09-09", -2)).toBe("2026-09-07");
  });
});

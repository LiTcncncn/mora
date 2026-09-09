import { describe, expect, it } from "vitest";
import { sanitizeForSpeech } from "./sanitize-for-speech";

describe("sanitizeForSpeech", () => {
  it("去掉舞台动作括号", () => {
    const { text, stripped } = sanitizeForSpeech(
      "（慢悠悠地晃了晃）今天早上我盯着天花板看了很久。",
    );
    expect(text).toBe("今天早上我盯着天花板看了很久。");
    expect(stripped).toBe(true);
  });

  it("去掉内部分析括号与计划复述", () => {
    const { text } = sanitizeForSpeech(
      [
        "心疼你。这会儿是心里堵着，还是身上也没力气？",
        "（用户说\"很难受\"，情绪很重但信息很少。先直接承接情绪。）",
        "（本轮必须问一个轻、具体、好答的问题，不可省略）",
      ].join("\n"),
    );
    expect(text).toBe("心疼你。这会儿是心里堵着，还是身上也没力气？");
    expect(text).not.toContain("用户说");
    expect(text).not.toContain("不可省略");
  });

  it("去掉半角括号动作", () => {
    const { text } = sanitizeForSpeech("(轻轻挪近一点)怎么突然就哭了。");
    expect(text).toBe("怎么突然就哭了。");
  });
});

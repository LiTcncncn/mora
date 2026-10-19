import { describe, expect, it } from "vitest";
import { SentenceSegmenter } from "./sentence-segmenter";

function run(deltas: string[]): string[] {
  const segmenter = new SentenceSegmenter();
  return [...deltas.flatMap((delta) => segmenter.push(delta)), ...segmenter.flush()];
}

describe("SentenceSegmenter", () => {
  it("按句号、问号切分流式文本", () => {
    expect(run(["今天就慢一点。", "你还", "好吗？没关系"])).toEqual([
      "今天就慢一点。",
      "你还好吗？",
      "没关系",
    ]);
  });

  it("首句在较短的逗号处提前切出", () => {
    const [first] = run(["我在这里陪着你，不着急说什么都可以。"]);
    expect(first).toBe("我在这里陪着你，");
  });

  it("括号未闭合时不切分", () => {
    expect(run(["（慢慢挪近。", "一点）嗯。"])).toEqual(["（慢慢挪近。一点）嗯。"]);
  });

  it("引号跟随句末标点", () => {
    expect(run(["他说“好的。”然后呢"])).toEqual(["他说“好的。”", "然后呢"]);
  });
});

import { describe, expect, it } from "vitest";
import {
  contextSectionIdSchema,
  DEFAULT_SECTION_ORDER,
  renderTemplate,
  validateTemplate,
} from "./prompt";

const values = {
  "persona.name": "ZHAKA",
  "persona.corePrompt": "核心",
  "persona.renderedTraits": "特质",
  "energy.level": "E1",
  "energy.policy": "策略",
  "memory.rendered": "记忆",
  "history.rendered": "历史",
  "user.message": "消息",
} as const;

describe("validateTemplate", () => {
  it("接受白名单变量", () => {
    expect(validateTemplate("{{persona.name}} {{energy.level}}").ok).toBe(true);
  });

  it("拒绝白名单之外的变量", () => {
    const result = validateTemplate("{{process.env.OPENAI_API_KEY}}");
    expect(result.ok).toBe(false);
    expect(result.unknownVariables).toContain("process.env.OPENAI_API_KEY");
  });

  it("few-shot 注入已移除，fewshot.rendered 不再是合法变量", () => {
    const result = validateTemplate("{{fewshot.rendered}}");
    expect(result.ok).toBe(false);
    expect(result.unknownVariables).toContain("fewshot.rendered");
  });
});

describe("contextSectionIdSchema", () => {
  it("few_shot 分区已移除", () => {
    expect(contextSectionIdSchema.safeParse("few_shot").success).toBe(false);
    expect(DEFAULT_SECTION_ORDER).not.toContain("few_shot");
  });
});

describe("renderTemplate", () => {
  it("只做字符串替换", () => {
    expect(renderTemplate("你好 {{persona.name}}", values)).toBe("你好 ZHAKA");
  });

  it("遇到未知变量直接抛错，不做静默替换", () => {
    expect(() => renderTemplate("{{unknown}}", values)).toThrowError(/未知变量/);
  });

  it("不会执行模板中的表达式", () => {
    const rendered = renderTemplate("{{ persona.name }}", values);
    expect(rendered).toBe("ZHAKA");
  });
});

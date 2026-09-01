import { describe, expect, it } from "vitest";
import { seedSettings } from "@/test/fixtures";
import { settingsDataSchema } from "./settings";

interface LegacyShape {
  providers: Record<string, Record<string, unknown>>;
  energy: { policies: Record<string, Record<string, unknown>> };
  context: Record<string, unknown>;
  logging: Record<string, unknown>;
}

/**
 * 成本估算、可关闭的日志快照、few-shot 检索注入三块已整体移除。这里锁两件事：
 * 字段确实不在 schema 里了，以及本机已有的旧 settings.json 仍然读得出来，
 * 不需要用户手动改文件。
 */
describe("已移除模块的字段", () => {
  it("当前 schema 不再产出这些字段", () => {
    const parsed = settingsDataSchema.parse(seedSettings());

    expect(parsed.providers.kimi).not.toHaveProperty("pricing");
    expect(parsed.providers.deepseek).not.toHaveProperty("pricing");
    expect(parsed.energy.policies.E2).not.toHaveProperty("validationWeight");
    expect(parsed.energy.policies.E2).not.toHaveProperty("actionWeight");
    expect(parsed.context).not.toHaveProperty("fewShot");
    expect(parsed.context.sectionOrder).not.toContain("few_shot");
    expect(Object.keys(parsed.logging)).toEqual(["maxRuns"]);
  });

  it("旧配置里的多余键被剥离，few_shot 分区则必须靠迁移脚本清掉", () => {
    const legacy = JSON.parse(JSON.stringify(seedSettings())) as unknown;
    const raw = legacy as LegacyShape;

    raw.providers.kimi!.pricing = {
      currency: "USD",
      inputPerMillion: null,
      outputPerMillion: null,
      label: "未配置",
    };
    raw.energy.policies.E2!.validationWeight = 0.6;
    raw.energy.policies.E2!.actionWeight = 0.4;
    raw.context.fewShot = { enabled: true, maxChars: 1500 };
    raw.logging.saveRawProviderResponse = false;
    raw.logging.saveContextSnapshot = true;
    raw.context.sectionOrder = [
      "safety_baseline",
      "persona",
      "few_shot",
      "energy_policy",
      "history",
    ];

    // few_shot 是从枚举里删掉的成员，剥离救不了它，必须整条数组被清理过。
    expect(settingsDataSchema.safeParse(legacy).success).toBe(false);

    raw.context.sectionOrder = (raw.context.sectionOrder as string[]).filter(
      (id) => id !== "few_shot",
    );
    const parsed = settingsDataSchema.parse(legacy);

    expect(parsed.providers.kimi).not.toHaveProperty("pricing");
    expect(parsed.energy.policies.E2).not.toHaveProperty("validationWeight");
    expect(parsed.context).not.toHaveProperty("fewShot");
    expect(Object.keys(parsed.logging)).toEqual(["maxRuns"]);
  });
});

"use client";

import type {
  BehaviorExampleCard,
  ExampleReviewStatus,
} from "@/domain/behavior-example";
import type { SafetyRule, SafetySettings } from "@/domain/behavior-config";
import type { EnergyLevel } from "@/domain/common";
import type { ResponseMode, SafetyLevel } from "@/domain/behavior-taxonomy";
import type {
  WorldviewCanonFact,
  WorldviewSeed,
} from "@/domain/worldview-v2";
import { Collapsible, Field, Notice } from "@/components/ui/primitives";

export function CanonFactsEditor({
  facts,
  onChange,
}: {
  facts: WorldviewCanonFact[];
  onChange: (next: WorldviewCanonFact[]) => void;
}) {
  const update = (index: number, patch: Partial<WorldviewCanonFact>): void => {
    onChange(
      facts.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const add = (): void => {
    onChange([
      ...facts,
      {
        id: `canon-${crypto.randomUUID()}`,
        category: "identity",
        content: "",
        aliases: [],
        enabled: true,
        version: 1,
      },
    ]);
  };

  const remove = (index: number): void => {
    onChange(facts.filter((_, position) => position !== index));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted)]">
        W3 直接追问时检索的事实库。保存时会跑 canon lint，命中禁词会拒绝或自动禁用。
      </p>
      {facts.map((fact, index) => (
        <div key={fact.id} className="card space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">{fact.id}</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={fact.enabled}
                onChange={(event) =>
                  update(index, { enabled: event.target.checked })
                }
              />
              启用
            </label>
          </div>
          <Field label="类别">
            <select
              className="field"
              value={fact.category}
              onChange={(event) =>
                update(index, {
                  category: event.target.value as WorldviewCanonFact["category"],
                })
              }
            >
              {(
                [
                  "identity",
                  "origin",
                  "relationship",
                  "preference",
                  "experience",
                  "boundary",
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="内容">
            <textarea
              className="field min-h-16"
              value={fact.content}
              onChange={(event) => update(index, { content: event.target.value })}
            />
          </Field>
          <Field label="别名（逗号分隔）">
            <input
              className="field"
              value={fact.aliases.join("，")}
              onChange={(event) =>
                update(index, {
                  aliases: event.target.value
                    .split(/[,，]/)
                    .map((part) => part.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <button type="button" className="btn" onClick={() => remove(index)}>
            删除
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-primary" onClick={add}>
        新增事实
      </button>
    </div>
  );
}

export function SeedsEditor({
  seeds,
  onChange,
}: {
  seeds: WorldviewSeed[];
  onChange: (next: WorldviewSeed[]) => void;
}) {
  const update = (index: number, patch: Partial<WorldviewSeed>): void => {
    onChange(
      seeds.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const add = (): void => {
    onChange([
      ...seeds,
      {
        id: `seed-${crypto.randomUUID()}`,
        title: "新种子",
        tags: [],
        triggerDescription: "",
        memory: "",
        attitude: "",
        allowedResponseModes: ["COMPANION"],
        energyFit: ["E1", "E2", "E3"],
        allowedModes: ["W1"],
        blockedMajorEventTypes: [],
        avoidClaims: [],
        cooldownGroup: "ordinary",
        canonFactIds: [],
        enabled: false,
        version: 1,
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted)]">
        自然世界观（W1/W2）用的情景种子。默认新建为停用，填完再启用。
      </p>
      {seeds.map((seed, index) => (
        <Collapsible
          key={seed.id}
          title={`${seed.enabled ? "✓" : "○"} ${seed.title}（${seed.id}）`}
        >
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={seed.enabled}
                onChange={(event) =>
                  update(index, { enabled: event.target.checked })
                }
              />
              启用
            </label>
            <Field label="标题">
              <input
                className="field"
                value={seed.title}
                onChange={(event) => update(index, { title: event.target.value })}
              />
            </Field>
            <Field label="触发描述">
              <textarea
                className="field min-h-12"
                value={seed.triggerDescription}
                onChange={(event) =>
                  update(index, { triggerDescription: event.target.value })
                }
              />
            </Field>
            <Field label="记忆（memory）">
              <textarea
                className="field min-h-16"
                value={seed.memory}
                onChange={(event) => update(index, { memory: event.target.value })}
              />
            </Field>
            <Field label="态度（attitude）">
              <textarea
                className="field min-h-12"
                value={seed.attitude}
                onChange={(event) =>
                  update(index, { attitude: event.target.value })
                }
              />
            </Field>
            <Field label="冷却组">
              <input
                className="field"
                value={seed.cooldownGroup}
                onChange={(event) =>
                  update(index, { cooldownGroup: event.target.value })
                }
              />
            </Field>
            <button
              type="button"
              className="btn"
              onClick={() =>
                onChange(seeds.filter((_, position) => position !== index))
              }
            >
              删除
            </button>
          </div>
        </Collapsible>
      ))}
      <button type="button" className="btn btn-primary" onClick={add}>
        新增种子
      </button>
    </div>
  );
}

export function ExampleCardsEditor({
  cards,
  onChange,
}: {
  cards: BehaviorExampleCard[];
  onChange: (next: BehaviorExampleCard[]) => void;
}) {
  const update = (index: number, patch: Partial<BehaviorExampleCard>): void => {
    onChange(
      cards.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  };

  const add = (): void => {
    onChange([
      ...cards,
      {
        id: `ex-${crypto.randomUUID()}`,
        name: "新示例卡",
        responseMode: "COMPANION",
        energyRange: ["E1", "E2", "E3"],
        questionPreferences: ["neutral"],
        majorEventCompatible: true,
        majorEventTypes: [],
        topicTags: [],
        user: "",
        idealReply: "",
        demonstrates: [],
        evaluatorWarnings: [],
        reviewStatus: "pending" as ExampleReviewStatus,
        enabled: false,
        version: 1,
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted)]">
        只有 reviewStatus=approved 且 enabled 的卡片会进入检索。默认新建为 pending。
      </p>
      {cards.map((card, index) => (
        <Collapsible
          key={card.id}
          title={`${card.reviewStatus} · ${card.name}（${card.id}）`}
        >
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Response Mode">
                <select
                  className="field"
                  value={card.responseMode}
                  onChange={(event) =>
                    update(index, {
                      responseMode: event.target.value as ResponseMode,
                    })
                  }
                >
                  {(
                    [
                      "COMPANION",
                      "ASK_LIGHT",
                      "DIRECT_ANSWER",
                      "ONE_STEP_HELP",
                      "CONFIRM_CHOICE",
                      "CELEBRATE",
                      "REPAIR",
                      "CLOSE",
                    ] as ResponseMode[]
                  ).map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="审核状态">
                <select
                  className="field"
                  value={card.reviewStatus}
                  onChange={(event) =>
                    update(index, {
                      reviewStatus: event.target.value as ExampleReviewStatus,
                    })
                  }
                >
                  <option value="pending">pending 待审核</option>
                  <option value="approved">approved 已通过</option>
                  <option value="rejected">rejected 已拒绝</option>
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={card.enabled}
                onChange={(event) =>
                  update(index, { enabled: event.target.checked })
                }
              />
              启用
            </label>
            <Field label="用户原话">
              <textarea
                className="field min-h-12"
                value={card.user}
                onChange={(event) => update(index, { user: event.target.value })}
              />
            </Field>
            <Field label="理想回复">
              <textarea
                className="field min-h-20"
                value={card.idealReply}
                onChange={(event) =>
                  update(index, { idealReply: event.target.value })
                }
              />
            </Field>
            <button
              type="button"
              className="btn"
              onClick={() =>
                onChange(cards.filter((_, position) => position !== index))
              }
            >
              删除
            </button>
          </div>
        </Collapsible>
      ))}
      <button type="button" className="btn btn-primary" onClick={add}>
        新增示例卡
      </button>
    </div>
  );
}

export function ReadonlyJson({
  value,
}: {
  value: unknown;
}) {
  return (
    <pre className="overflow-x-auto rounded border bg-[var(--color-canvas)] p-2 text-xs whitespace-pre-wrap">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function EnergyBudgetGrid({
  budgets,
  onChange,
}: {
  budgets: Record<EnergyLevel, import("@/domain/behavior-config").EnergyBudget>;
  onChange: (
    level: EnergyLevel,
    patch: Partial<import("@/domain/behavior-config").EnergyBudget>,
  ) => void;
}) {
  const levels: EnergyLevel[] = ["E0", "E1", "E2", "E3"];

  return (
    <div className="space-y-4">
      {levels.map((level) => {
        const budget = budgets[level];
        return (
          <Collapsible key={level} title={`${level} · ${budget.label}`}>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  ["targetMinChars", "目标最小字符"],
                  ["targetMaxChars", "目标最大字符"],
                  ["hardMaxChars", "硬上限字符"],
                  ["maxSentences", "最大句数"],
                  ["defaultMaxActions", "默认最多动作"],
                  ["providerMaxOutputTokens", "Provider 输出 token 上限"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    className="field"
                    value={budget[key]}
                    onChange={(event) =>
                      onChange(level, {
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}

const SAFETY_LEVELS: SafetyLevel[] = ["none", "concern", "urgent"];

function linesToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** §13.5：类别与 id 只读；关键词、否定词、级别与启用状态可改。 */
export function SafetyRulesEditor({
  safety,
  onChange,
}: {
  safety: SafetySettings;
  onChange: (next: SafetySettings) => void;
}) {
  const updateRule = (index: number, patch: Partial<SafetyRule>): void => {
    onChange({
      ...safety,
      rules: safety.rules.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--color-muted)]">
        规则表关键词与级别可调；类别枚举不可删改。urgent 占位回复开关为只读生产默认值（§13.5）。
      </p>

      <dl className="card grid gap-2 p-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--color-muted)]">urgent 占位回复</dt>
          <dd>{safety.urgentPlaceholderEnabled ? "启用" : "关闭"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[var(--color-muted)]">占位文案（只读）</dt>
          <dd className="mt-1 whitespace-pre-wrap">{safety.urgentPlaceholderText}</dd>
        </div>
      </dl>

      {safety.rules.length === 0 ? (
        <Notice>当前无 Safety 规则条目，urgent 检测不会生效。</Notice>
      ) : null}

      {safety.rules.map((rule, index) => (
        <div key={rule.id} className="card space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-sm font-medium">{rule.category}</span>
              <span className="ml-2 text-xs text-[var(--color-muted)] mono">
                {rule.id}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rule.enabled}
                onChange={(event) =>
                  updateRule(index, { enabled: event.target.checked })
                }
              />
              启用
            </label>
          </div>
          <Field label="级别">
            <select
              className="field"
              value={rule.level}
              onChange={(event) =>
                updateRule(index, {
                  level: event.target.value as SafetyLevel,
                })
              }
            >
              {SAFETY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </Field>
          <Field label="关键词（每行一个）">
            <textarea
              className="field min-h-20"
              value={rule.keywords.join("\n")}
              onChange={(event) =>
                updateRule(index, { keywords: linesToList(event.target.value) })
              }
            />
          </Field>
          <Field label="否定排除（每行一个，命中时不算匹配）">
            <textarea
              className="field min-h-16"
              value={rule.negations.join("\n")}
              onChange={(event) =>
                updateRule(index, { negations: linesToList(event.target.value) })
              }
            />
          </Field>
        </div>
      ))}
    </div>
  );
}

export function ValidationNotice({
  blocking,
  warnings,
}: {
  blocking: string[];
  warnings: string[];
}) {
  if (blocking.length === 0 && warnings.length === 0) return null;
  return (
    <div className="space-y-2">
      {blocking.length > 0 ? (
        <Notice tone="error">保存被阻止：{blocking.join("；")}</Notice>
      ) : null}
      {warnings.length > 0 ? (
        <Notice tone="warning">{warnings.join("；")}</Notice>
      ) : null}
    </div>
  );
}

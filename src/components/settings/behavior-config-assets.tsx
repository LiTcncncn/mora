"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
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
import { worldviewSeedSchema } from "@/domain/worldview-v2";
import { Collapsible, Field, Notice } from "@/components/ui/primitives";
import { ENERGY_LEVEL_LABELS, labelOf, RESPONSE_MODE_LABELS } from "@/lib/labels";

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

const worldviewSeedsJsonSchema = z.array(worldviewSeedSchema).max(2000);

function formatSeedsJson(seeds: WorldviewSeed[]): string {
  return JSON.stringify(seeds, null, 2);
}

function formatZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "格式不符合种子结构";
  const path = issue.path.length > 0 ? issue.path.join(".") : "根";
  return `${path}：${issue.message}`;
}

export function SeedsEditor({
  seeds,
  onChange,
}: {
  seeds: WorldviewSeed[];
  onChange: (next: WorldviewSeed[]) => void;
}) {
  const [text, setText] = useState(() => formatSeedsJson(seeds));
  const [error, setError] = useState<string | null>(null);
  const syncedJsonRef = useRef(formatSeedsJson(seeds));

  useEffect(() => {
    const next = formatSeedsJson(seeds);
    if (next === syncedJsonRef.current) return;
    syncedJsonRef.current = next;
    setText(next);
    setError(null);
  }, [seeds]);

  const tryApply = (raw: string): void => {
    setText(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setError("JSON 无法解析");
      return;
    }

    const result = worldviewSeedsJsonSchema.safeParse(parsed);
    if (!result.success) {
      setError(formatZodIssue(result.error));
      return;
    }

    setError(null);
    const normalized = formatSeedsJson(result.data);
    syncedJsonRef.current = normalized;
    if (JSON.stringify(result.data) !== JSON.stringify(seeds)) {
      onChange(result.data);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--color-muted)]">
        自然世界观（W1/W2）情景种子整表 JSON，共 {seeds.length}{" "}
        条。直接改文案即可；结构需保持数组对象格式，保存行为配置时仍会再校验。
      </p>
      <textarea
        className="field min-h-[28rem] font-mono text-xs leading-5"
        spellCheck={false}
        value={text}
        onChange={(event) => tryApply(event.target.value)}
        onBlur={() => {
          if (error) return;
          setText(syncedJsonRef.current);
        }}
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
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
        只有「已通过」且勾选启用的卡片会进入检索。新建默认是待审核。
      </p>
      {cards.map((card, index) => (
        <Collapsible
          key={card.id}
          title={`${card.name} · ${
            card.reviewStatus === "approved"
              ? "已通过"
              : card.reviewStatus === "rejected"
                ? "已拒绝"
                : "待审核"
          }${card.enabled ? "" : " · 未启用"}`}
        >
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="适用意图">
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
                      {labelOf(RESPONSE_MODE_LABELS, mode)}
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
                  <option value="pending">待审核</option>
                  <option value="approved">已通过</option>
                  <option value="rejected">已拒绝</option>
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
          <Collapsible key={level} title={labelOf(ENERGY_LEVEL_LABELS, level)}>
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
  /** 保存后不可启用的单条资产（§13.6.6）。 */
  blocking: Array<{ kind: string; id: string }>;
  /** 软约束 / 死种子等警告，不阻塞整份保存。 */
  warnings: Array<{ code: string; message: string }>;
}) {
  if (blocking.length === 0 && warnings.length === 0) return null;

  const kindLabel: Record<string, string> = {
    seed: "情景种子",
    example: "示例卡",
    fact: "世界观事实",
    canonFact: "世界观事实",
  };

  const blockingLabels = blocking.map((item) => {
    const kind = kindLabel[item.kind] ?? item.kind;
    return `${kind}「${item.id}」暂时无法启用`;
  });

  const humanize = (issue: { code: string; message: string }): string => {
    if (issue.code === "example.below_threshold") {
      const modeMatch = issue.message.match(/^(\w+) 只有/);
      const mode = modeMatch?.[1];
      const modeZh =
        mode && mode in RESPONSE_MODE_LABELS
          ? RESPONSE_MODE_LABELS[mode]
          : mode;
      if (issue.message.includes("高频")) {
        return `${modeZh}：可用示例偏少。日常若很少走到这个意图，可先不补；要稳住口吻再补到约 5 条。`;
      }
      return `${modeZh}：可用示例偏少。不影响聊天，想加强这类口吻时再补到约 3 条。`;
    }
    if (issue.code === "example.energy_spread_low") {
      return "有的示例卡能量档覆盖太窄，建议同一意图下至少覆盖两个能量档。";
    }
    if (issue.code === "example.avoid_below_threshold") {
      return "「避免提问」类示例还不够。想减少追问感时，可多写几张 avoid 示例。";
    }
    if (issue.code.startsWith("worldview.") && issue.message.includes("rollingEligibleWindow")) {
      return "世界观频率参数不太匹配：统计窗口偏短，长期占比可能飘。可把「统计窗口」调到「最大间隔」的两倍以上，或先忽略（仍可正常聊天）。";
    }
    if (issue.message.includes("禁词") || issue.message.includes("废弃")) {
      return `内容里可能还有旧设定词：${issue.message}`;
    }
    return issue.message;
  };

  return (
    <div className="space-y-2">
      {blocking.length > 0 ? (
        <Notice tone="error">
          下面这些条目校验未通过，保存后会保持停用：{blockingLabels.join("；")}
        </Notice>
      ) : null}
      {warnings.length > 0 ? (
        <Notice>
          <p className="mb-1 font-medium">内容建议（不挡保存，也不挡聊天）</p>
          <ul className="list-disc space-y-1 pl-4">
            {warnings.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{humanize(issue)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}


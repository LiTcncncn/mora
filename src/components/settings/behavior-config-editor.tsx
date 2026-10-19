"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { BehaviorConfigV2 } from "@/domain/behavior-config";
import type { ProviderId } from "@/domain/common";
import { RESPONSE_MODES } from "@/domain/behavior-taxonomy";
import {
  formatNeutralMustAskPercent,
  normalizeQuestionPolicyForSave,
  parseNeutralMustAskPercent,
  type QuestionPolicySettings,
} from "@/domain/question-policy";
import { STRATEGY_RULE_TEXTS } from "@/domain/strategy-policy";
import {
  Collapsible,
  Field,
  Notice,
  SectionTitle,
} from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import {
  labelOf,
  NEUTRAL_QUESTION_MODE_LABELS,
  PROVIDER_LABELS,
  RESPONSE_MODE_LABELS,
} from "@/lib/labels";
import {
  CanonFactsEditor,
  EnergyBudgetGrid,
  ExampleCardsEditor,
  ReadonlyJson,
  SafetyRulesEditor,
  SeedsEditor,
  ValidationNotice,
} from "./behavior-config-assets";

function PlannerHint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-[var(--color-muted)]">{children}</p>;
}

interface BehaviorConfigResponse {
  config: BehaviorConfigV2;
  warnings: Array<{ code: string; message: string }>;
  blockedFromEnabling: Array<{ kind: string; id: string }>;
  persisted: boolean;
}

const PROVIDERS: ProviderId[] = ["kimi", "deepseek"];

function QuestionPolicyEditor({
  questionPolicy,
  onChange,
  commitRef,
}: {
  questionPolicy: QuestionPolicySettings;
  onChange: (policy: QuestionPolicySettings) => void;
  commitRef: RefObject<(() => QuestionPolicySettings) | null>;
}) {
  const [mustAskPercentDraft, setMustAskPercentDraft] = useState(() =>
    formatNeutralMustAskPercent(questionPolicy.neutralMustAskProbability),
  );

  useEffect(() => {
    setMustAskPercentDraft(
      formatNeutralMustAskPercent(questionPolicy.neutralMustAskProbability),
    );
  }, [questionPolicy.neutralMustAskProbability, questionPolicy.neutralMode]);

  const commitMustAskPercent = useCallback((): QuestionPolicySettings => {
    if (questionPolicy.neutralMode !== "probabilistic") {
      return questionPolicy;
    }
    const probability = parseNeutralMustAskPercent(
      mustAskPercentDraft,
      Math.round(questionPolicy.neutralMustAskProbability * 100),
    );
    const next = normalizeQuestionPolicyForSave({
      ...questionPolicy,
      neutralMustAskProbability: probability,
    });
    setMustAskPercentDraft(
      formatNeutralMustAskPercent(next.neutralMustAskProbability),
    );
    onChange(next);
    return next;
  }, [mustAskPercentDraft, onChange, questionPolicy]);

  useEffect(() => {
    commitRef.current = commitMustAskPercent;
    return () => {
      commitRef.current = null;
    };
  }, [commitMustAskPercent, commitRef]);

  const mustAskPercent = parseNeutralMustAskPercent(mustAskPercentDraft, 50);
  const noAskPercent = 1 - mustAskPercent;

  return (
    <div className="space-y-3">
      <PlannerHint>
        控制「中性场景」要不要追问。上一轮已经问过时，建议打开下方开关避免连问。
      </PlannerHint>
      <Field label="中性场景怎么处理提问">
        <select
          className="field"
          value={questionPolicy.neutralMode}
          onChange={(event) =>
            onChange({
              ...questionPolicy,
              neutralMode: event.target
                .value as QuestionPolicySettings["neutralMode"],
            })
          }
        >
          <option value="never">
            {labelOf(NEUTRAL_QUESTION_MODE_LABELS, "never")}
          </option>
          <option value="must_ask">
            {labelOf(NEUTRAL_QUESTION_MODE_LABELS, "must_ask")}
          </option>
          <option value="probabilistic">
            {labelOf(NEUTRAL_QUESTION_MODE_LABELS, "probabilistic")}
          </option>
        </select>
      </Field>
      {questionPolicy.neutralMode === "probabilistic" ? (
        <Field label="必问概率（%）">
          <input
            className="field"
            type="number"
            min={0}
            max={100}
            step={1}
            inputMode="numeric"
            value={mustAskPercentDraft}
            onChange={(event) => {
              const raw = event.target.value;
              setMustAskPercentDraft(raw);
              onChange(
                normalizeQuestionPolicyForSave({
                  ...questionPolicy,
                  neutralMustAskProbability: parseNeutralMustAskPercent(
                    raw,
                    Math.round(questionPolicy.neutralMustAskProbability * 100),
                  ),
                }),
              );
            }}
            onBlur={() => {
              void commitMustAskPercent();
            }}
          />
          <div className="text-sm text-[var(--color-muted)]">
            约 {Math.round(mustAskPercent * 100)}% 会问一句 ·{" "}
            {Math.round(noAskPercent * 100)}% 不问
          </div>
        </Field>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={questionPolicy.suppressIfLastAssistantAsked}
          onChange={(event) =>
            onChange({
              ...questionPolicy,
              suppressIfLastAssistantAsked: event.target.checked,
            })
          }
        />
        上一轮已经问过，本轮中性场景就不要再问
      </label>
    </div>
  );
}

export interface BehaviorConfigEditorHandle {
  isDirty: () => boolean;
  save: () => Promise<void>;
  reload: () => Promise<void>;
  getQuestionPolicySummary: () => string | null;
}

/**
 * Behavior Config 的 Lab 编辑入口。
 * 保存由 Settings 页统一触发（ref.save）。
 */
export const BehaviorConfigEditor = forwardRef<
  BehaviorConfigEditorHandle,
  {
    profileId: string;
    onDirtyChange?: (dirty: boolean) => void;
  }
>(function BehaviorConfigEditor({ profileId, onDirtyChange }, ref) {
  const [config, setConfig] = useState<BehaviorConfigV2 | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [warnings, setWarnings] = useState<
    BehaviorConfigResponse["warnings"]
  >([]);
  const [blocked, setBlocked] = useState<
    BehaviorConfigResponse["blockedFromEnabling"]
  >([]);
  const [persisted, setPersisted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const questionPolicyCommitRef = useRef<(() => QuestionPolicySettings) | null>(
    null,
  );
  const configRef = useRef<BehaviorConfigV2 | null>(null);
  configRef.current = config;
  const savedSnapshotRef = useRef(savedSnapshot);
  savedSnapshotRef.current = savedSnapshot;

  const buildSavePayload = useCallback((): BehaviorConfigV2 | null => {
    const current = configRef.current;
    if (!current) return null;
    const committedQuestionPolicy =
      questionPolicyCommitRef.current?.() ?? current.questionPolicy;
    return {
      ...current,
      questionPolicy: normalizeQuestionPolicyForSave(committedQuestionPolicy),
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await api.get<BehaviorConfigResponse>(
        `/api/behavior-config?profileId=${encodeURIComponent(profileId)}`,
      );
      setConfig(data.config);
      setSavedSnapshot(JSON.stringify(data.config));
      setWarnings(data.warnings);
      setBlocked(data.blockedFromEnabling);
      setPersisted(data.persisted);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [profileId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (): Promise<void> => {
    const payload = buildSavePayload();
    if (!payload) return;
    setError(null);
    setConfig(payload);
    const data = await api.put<BehaviorConfigResponse>("/api/behavior-config", {
      profileId,
      config: payload,
    });
    setConfig(data.config);
    setSavedSnapshot(JSON.stringify(data.config));
    setWarnings(data.warnings);
    setBlocked(data.blockedFromEnabling);
    setPersisted(data.persisted);
  }, [buildSavePayload, profileId]);

  const isDirty = useCallback((): boolean => {
    const current = configRef.current;
    if (!current) return false;
    return JSON.stringify(current) !== savedSnapshotRef.current;
  }, []);

  useEffect(() => {
    onDirtyChange?.(isDirty());
  }, [config, savedSnapshot, onDirtyChange, isDirty]);

  const getQuestionPolicySummary = useCallback((): string | null => {
    const policy = configRef.current?.questionPolicy;
    if (!policy) return null;
    const normalized = normalizeQuestionPolicyForSave(policy);
    const modeLabel = labelOf(NEUTRAL_QUESTION_MODE_LABELS, normalized.neutralMode);
    if (normalized.neutralMode === "probabilistic") {
      const percent = formatNeutralMustAskPercent(
        normalized.neutralMustAskProbability,
      );
      return `提问 ${modeLabel} · 必问 ${percent}% · 上轮抑制 ${normalized.suppressIfLastAssistantAsked ? "开" : "关"}`;
    }
    return `提问 ${modeLabel} · 上轮抑制 ${normalized.suppressIfLastAssistantAsked ? "开" : "关"}`;
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      isDirty,
      save,
      reload: load,
      getQuestionPolicySummary,
    }),
    [isDirty, save, load, getQuestionPolicySummary],
  );

  const patch = (updater: (current: BehaviorConfigV2) => BehaviorConfigV2): void => {
    setConfig((current) => (current ? updater(current) : current));
  };

  if (error && !config) return <Notice tone="error">{error}</Notice>;
  if (!config) return <p className="text-sm">加载中…</p>;

  const approvedExamples = config.exampleCards.filter(
    (card) => card.enabled && card.reviewStatus === "approved",
  ).length;
  const enabledSeeds = config.worldviewSeeds.filter((seed) => seed.enabled).length;

  return (
    <div className="space-y-4">
      <Notice>
        这里决定 ZHAKA「像谁、说多长、要不要聊雨林、要不要追问」。改完用页面底部「保存」。
        日常优先改：人设口径、回复篇幅、世界观素材、示例口吻；底下「进阶」一般不用动。
      </Notice>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <ValidationNotice blocking={blocked} warnings={warnings} />

      <p className="text-xs text-[var(--color-muted)]">
        当前素材：事实 {config.canonFacts.length} · 启用种子 {enabledSeeds}/
        {config.worldviewSeeds.length} · 可用示例 {approvedExamples}/
        {config.exampleCards.length}
        {persisted ? "" : " · 尚未保存过（仍是默认起步包）"}
      </p>

      <Collapsible title="1. 人设口径（出生地、来历、可用物种）">
        <div className="space-y-3">
          <PlannerHint>
            写给模型的「官方说法」。用户追问出身/朋友时优先对齐这里，也用于禁旧设定。
          </PlannerHint>
          <Field label="出生地怎么说">
            <input
              className="field"
              value={config.brandCanon.originStatement}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  brandCanon: {
                    ...current.brandCanon,
                    originStatement: event.target.value,
                  },
                }))
              }
            />
          </Field>
          <Field label="为什么住在用户这里">
            <input
              className="field"
              value={config.brandCanon.arrivalStatement}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  brandCanon: {
                    ...current.brandCanon,
                    arrivalStatement: event.target.value,
                  },
                }))
              }
            />
          </Field>
          <Field label="允许提到的物种（每行一个）">
            <textarea
              className="field min-h-24"
              value={config.brandCanon.approvedSpecies.join("\n")}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  brandCanon: {
                    ...current.brandCanon,
                    approvedSpecies: event.target.value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
                  },
                }))
              }
            />
          </Field>
        </div>
      </Collapsible>

      <Collapsible title={`2. 世界观事实库（${config.canonFacts.length}）`}>
        <PlannerHint>
          稳定事实：出身、朋友关系等。用户直接问设定时用来回答，避免临场编造。
        </PlannerHint>
        <CanonFactsEditor
          facts={config.canonFacts}
          onChange={(canonFacts) =>
            patch((current) => ({ ...current, canonFacts }))
          }
        />
      </Collapsible>

      <Collapsible
        title={`3. 情景种子（${enabledSeeds}/${config.worldviewSeeds.length} 启用）`}
      >
        <PlannerHint>
          适合「自然带出」雨林联想的小片段。系统会按频率挑选，不是每句都用。
          下方是整表 JSON，直接改即可；已有约四十条时优先改文案质量。
        </PlannerHint>
        <SeedsEditor
          seeds={config.worldviewSeeds}
          onChange={(worldviewSeeds) =>
            patch((current) => ({ ...current, worldviewSeeds }))
          }
        />
      </Collapsible>

      <Collapsible
        title={`4. 口吻示例卡（${approvedExamples}/${config.exampleCards.length} 可用）`}
      >
        <PlannerHint>
          给模型看「这种场景可以怎么说」。只有审核通过且启用的卡会进检索；回复模式要对得上才会用到。
          日常聊天多在「陪伴」，先把陪伴类示例写好最有用。带出世界观种子的那一轮不会同时塞示例卡。
        </PlannerHint>
        <ExampleCardsEditor
          cards={config.exampleCards}
          onChange={(exampleCards) =>
            patch((current) => ({ ...current, exampleCards }))
          }
        />
        <div className="mt-4 space-y-3 border-t pt-3">
          <p className="text-sm font-medium">示例卡检索开关</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={config.exampleRetrieval.enabled}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  exampleRetrieval: {
                    ...current.exampleRetrieval,
                    enabled: event.target.checked,
                  },
                }))
              }
            />
            开启示例检索（关闭后完全不参考示例卡）
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="最低匹配分（越高越挑）">
              <input
                type="number"
                step="0.05"
                className="field"
                value={config.exampleRetrieval.minScore}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    exampleRetrieval: {
                      ...current.exampleRetrieval,
                      minScore: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="示例最多占用字符">
              <input
                type="number"
                className="field"
                value={config.exampleRetrieval.maxChars}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    exampleRetrieval: {
                      ...current.exampleRetrieval,
                      maxChars: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="5. 回复篇幅（四档能量）">
        <div className="space-y-3">
          <PlannerHint>
            用户越累，回复应越短。这里管目标字数与硬上限；聊天页还可手动覆盖本轮档位。
          </PlannerHint>
          <Field label="允许略超硬上限的比例（如 0.2 = 超 20% 仍发出但记警告）">
            <input
              type="number"
              step="0.05"
              className="field"
              value={config.energy.hardMaxToleranceRatio}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  energy: {
                    ...current.energy,
                    hardMaxToleranceRatio: Number(event.target.value),
                  },
                }))
              }
            />
          </Field>
          <EnergyBudgetGrid
            budgets={config.energy.budgets}
            onChange={(level, budgetPatch) =>
              patch((current) => ({
                ...current,
                energy: {
                  ...current.energy,
                  budgets: {
                    ...current.energy.budgets,
                    [level]: { ...current.energy.budgets[level], ...budgetPatch },
                  },
                },
              }))
            }
          />
        </div>
      </Collapsible>

      <Collapsible title="6. 要不要追问">
        <QuestionPolicyEditor
          questionPolicy={config.questionPolicy}
          commitRef={questionPolicyCommitRef}
          onChange={(questionPolicy) =>
            patch((current) => ({ ...current, questionPolicy }))
          }
        />
      </Collapsible>

      <Collapsible title="7. 各回复模式的策略数值">
        <div className="space-y-4">
          <PlannerHint>
            每种聊天意图可单独调：动作多少、篇幅倍率、是否允许带世界观。目标说明是只读文案。
          </PlannerHint>
          {RESPONSE_MODES.map((mode) => {
            const policy = config.strategies[mode];
            const rules = STRATEGY_RULE_TEXTS[mode];
            return (
              <div key={mode} className="card space-y-2 p-3">
                <SectionTitle>{labelOf(RESPONSE_MODE_LABELS, mode)}</SectionTitle>
                <p className="text-xs text-[var(--color-muted)]">{rules.goal}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="默认最多动作数">
                    <input
                      type="number"
                      className="field"
                      value={policy.defaultMaxActions}
                      onChange={(event) =>
                        patch((current) => ({
                          ...current,
                          strategies: {
                            ...current.strategies,
                            [mode]: {
                              ...current.strategies[mode],
                              defaultMaxActions: Number(event.target.value),
                            },
                          },
                        }))
                      }
                    />
                  </Field>
                  <Field label="篇幅倍率（相对能量档）">
                    <input
                      type="number"
                      step={0.05}
                      className="field"
                      value={policy.lengthMultiplier}
                      onChange={(event) =>
                        patch((current) => ({
                          ...current,
                          strategies: {
                            ...current.strategies,
                            [mode]: {
                              ...current.strategies[mode],
                              lengthMultiplier: Number(event.target.value),
                            },
                          },
                        }))
                      }
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={policy.allowWorldview}
                      onChange={(event) =>
                        patch((current) => ({
                          ...current,
                          strategies: {
                            ...current.strategies,
                            [mode]: {
                              ...current.strategies[mode],
                              allowWorldview: event.target.checked,
                            },
                          },
                        }))
                      }
                    />
                    允许自然带出世界观
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Collapsible>

      <Collapsible title="8. 世界观出现频率">
        <div className="space-y-3">
          <PlannerHint>
            控制「多久自然提一次雨林」。目标占比大约 25% 合格轮次；间隔与冷却避免连讲或重复同一段。
          </PlannerHint>
          <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["organicTargetRate", "自然提及目标占比（0–1）", 0.01],
              ["rollingEligibleWindow", "统计窗口（最近多少合格轮）", 1],
              ["minEligibleTurnsBetweenOrganic", "两次自然提及最少间隔", 1],
              ["maxEligibleTurnsBetweenOrganic", "两次自然提及最大间隔", 1],
              ["minAssistantTurnsBetweenAnyWorldview", "任意世界观之间最少回复间隔", 1],
              ["seedCooldownTurns", "同一颗种子冷却轮次", 1],
              ["seedGroupCooldownTurns", "同一主题组冷却轮次", 1],
              ["seedSelectTopK", "选种抖动窗口（前K名）", 1],
              ["maxWorldviewShare", "世界观最多占回复篇幅比例", 0.05],
            ] as const
          ).map(([key, label, step]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                step={step}
                className="field"
                value={config.worldview[key]}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    worldview: {
                      ...current.worldview,
                      [key]: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
          ))}
          <Field label="选种抖动方式">
            <select
              className="field"
              value={config.worldview.seedSelectJitter}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  worldview: {
                    ...current.worldview,
                    seedSelectJitter: event.target.value as
                      | "off"
                      | "weighted"
                      | "uniform",
                  },
                }))
              }
            >
              <option value="weighted">按相关分加权（推荐）</option>
              <option value="uniform">前K名均匀随机</option>
              <option value="off">始终最高分（旧行为）</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="禁止出现的旧设定词（每行一个）">
              <textarea
                className="field min-h-32"
                value={config.worldview.canonLint.forbiddenLegacyTerms.join("\n")}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    worldview: {
                      ...current.worldview,
                      canonLint: {
                        forbiddenLegacyTerms: event.target.value
                          .split("\n")
                          .map((line) => line.trim())
                          .filter(Boolean),
                      },
                    },
                  }))
                }
              />
            </Field>
          </div>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="9. 重大事件（丧失等）">
        <div className="space-y-3">
          <PlannerHint>
            用户第一次提到重大负面事件时，压短回复、避免急着给建议。指纹用来避免重复当「第一次」。
          </PlannerHint>
          <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={config.majorEvent.enabled}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  majorEvent: {
                    ...current.majorEvent,
                    enabled: event.target.checked,
                  },
                }))
              }
            />
            启用重大事件处理
          </label>
          {(
            [
              ["fingerprintSimilarityThreshold", "判定「同一件事」的相似度", 0.05],
              ["fingerprintRetentionMonths", "指纹保留月数", 1],
              ["firstMentionHardMaxChars", "首次提及时回复硬上限（字）", 1],
              ["firstMentionMaxSentences", "首次提及时最多几句", 1],
            ] as const
          ).map(([key, label, step]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                step={step}
                className="field"
                value={config.majorEvent[key]}
                onChange={(event) =>
                  patch((current) => ({
                    ...current,
                    majorEvent: {
                      ...current.majorEvent,
                      [key]: Number(event.target.value),
                    },
                  }))
                }
              />
            </Field>
          ))}
          </div>
        </div>
      </Collapsible>

      <Collapsible title="10. 安全规则">
        <PlannerHint>
          命中紧急规则时不走正常聊天，直接用占位回复。改关键词请谨慎。
        </PlannerHint>
        <SafetyRulesEditor
          safety={config.safety}
          onChange={(safety) => patch((current) => ({ ...current, safety }))}
        />
      </Collapsible>

      <Collapsible title="进阶：本轮意图识别（一般不用改）">
        <div className="space-y-3">
          <PlannerHint>
            用轻量模型判断本轮是陪伴、直接回答还是结束等。不确定时保持默认即可。
          </PlannerHint>
          <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={config.router.enabled}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  router: { ...current.router, enabled: event.target.checked },
                }))
              }
            />
            启用意图识别
          </label>
          <Field label="识别方式">
            <select
              className="field"
              value={config.router.mode}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  router: {
                    ...current.router,
                    mode: event.target.value as typeof config.router.mode,
                  },
                }))
              }
            >
              <option value="llm">用小模型判断（推荐）</option>
              <option value="rules">只用规则</option>
              <option value="fixed">固定默认意图</option>
            </select>
          </Field>
          <Field label="供应商">
            <select
              className="field"
              value={config.router.provider}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  router: {
                    ...current.router,
                    provider: event.target.value as ProviderId,
                  },
                }))
              }
            >
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {labelOf(PROVIDER_LABELS, provider)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="模型 ID">
            <input
              className="field"
              value={config.router.modelId}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  router: { ...current.router, modelId: event.target.value },
                }))
              }
            />
          </Field>
          <Field label="最低置信度（低于则回退规则）">
            <input
              type="number"
              step="0.05"
              className="field"
              value={config.router.minOverallConfidence}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  router: {
                    ...current.router,
                    minOverallConfidence: Number(event.target.value),
                  },
                }))
              }
            />
          </Field>
          <Field label="超时（毫秒）">
            <input
              type="number"
              className="field"
              value={config.router.timeoutMs}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  router: {
                    ...current.router,
                    timeoutMs: Number(event.target.value),
                  },
                }))
              }
            />
          </Field>
          </div>
        </div>
      </Collapsible>

      <Collapsible title="进阶：技术信息（只读）">
        <div className="space-y-3">
          <PlannerHint>
            给开发对照版本用。导出配置时文件名会带指纹前几位。策划日常可忽略。
          </PlannerHint>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div>
              <dt className="text-[var(--color-muted)]">配置指纹</dt>
              <dd className="mono break-all">{config.configHash}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-muted)]">是否已保存到服务器</dt>
              <dd>{persisted ? "是" : "否（默认起步包）"}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-muted)]">分类体系版本</dt>
              <dd>{config.taxonomyVersion}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-muted)]">世界观内容版本</dt>
              <dd>{config.worldviewVersion}</dd>
            </div>
          </dl>
          <p className="text-sm font-medium">请求标志（只读）</p>
          <ReadonlyJson value={config.requestFlags} />
          <p className="text-sm font-medium">输出格式合同（只读）</p>
          <ReadonlyJson value={config.responseContract} />
        </div>
      </Collapsible>
    </div>
  );
});

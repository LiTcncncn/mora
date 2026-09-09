"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
import { labelOf, NEUTRAL_QUESTION_MODE_LABELS, PROVIDER_LABELS } from "@/lib/labels";
import {
  CanonFactsEditor,
  EnergyBudgetGrid,
  ExampleCardsEditor,
  ReadonlyJson,
  SafetyRulesEditor,
  SeedsEditor,
  ValidationNotice,
} from "./behavior-config-assets";

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
      <Field label="neutral 模式">
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
        <Field label="neutral 必问概率（%）">
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
            必问 {Math.round(mustAskPercent * 100)}% · 不许问{" "}
            {Math.round(noAskPercent * 100)}%
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
        上一轮 assistant 已含问句时，neutral 强制 0 问（避免连续追问）
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
 * §16.2：Behavior Config v2 的 Lab 编辑入口。
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
  if (!config) return <p className="text-sm">加载行为配置…</p>;

  return (
    <div className="space-y-4">
      <Notice>
        行为配置 v2 是 Compare 与预览的运行时引擎：Router、Energy 预算、策略、Turn Plan 与输出约束均由此读取。
        与下方模型槽位、Memory、Context 等一并使用页面底部「保存」写入磁盘。
      </Notice>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <ValidationNotice blocking={blocked} warnings={warnings} />

      <dl className="card grid grid-cols-2 gap-x-4 gap-y-1 p-3 text-xs">
        <div>
          <dt className="text-[var(--color-muted)]">configHash</dt>
          <dd className="mono break-all">{config.configHash}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">已持久化</dt>
          <dd>{persisted ? "是" : "否（当前为默认值）"}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">taxonomyVersion</dt>
          <dd>{config.taxonomyVersion}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-muted)]">worldviewVersion</dt>
          <dd>{config.worldviewVersion}</dd>
        </div>
      </dl>

      <Collapsible title="Brand Canon 品牌与世界观口径" defaultOpen>
        <div className="space-y-3">
          <Field label="出生地表述">
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
          <Field label="来人类家表述">
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
          <Field label="已批准物种（每行一个）">
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

      <Collapsible title="Turn Router 轻量路由">
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
            启用 Router（Shadow 模式仍记录结果）
          </label>
          <Field label="模式">
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
              <option value="llm">llm</option>
              <option value="rules">rules</option>
              <option value="fixed">fixed</option>
            </select>
          </Field>
          <Field label="Provider">
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
          <Field label="modelId">
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
          <Field label="minOverallConfidence">
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
          <Field label="timeoutMs">
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
      </Collapsible>

      <Collapsible title="Question Policy 提问策略" defaultOpen>
        <QuestionPolicyEditor
          questionPolicy={config.questionPolicy}
          commitRef={questionPolicyCommitRef}
          onChange={(questionPolicy) =>
            patch((current) => ({ ...current, questionPolicy }))
          }
        />
      </Collapsible>

      <Collapsible title="Request Flags 请求标志（只读）">
        <ReadonlyJson value={config.requestFlags} />
      </Collapsible>

      <Collapsible title="Energy v2 四档预算" defaultOpen>
        <div className="space-y-3">
          <Field label="hardMaxToleranceRatio">
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

      <Collapsible title="Major Event 重大事件">
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
            启用重大事件检测
          </label>
          {(
            [
              ["fingerprintSimilarityThreshold", "指纹相似度阈值", 0.05],
              ["fingerprintRetentionMonths", "指纹保留月数", 1],
              ["firstMentionHardMaxChars", "首轮硬上限字符", 1],
              ["firstMentionMaxSentences", "首轮最大句数", 1],
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
      </Collapsible>

      <Collapsible title="Response Strategies 策略数值">
        <div className="space-y-4">
          {RESPONSE_MODES.map((mode) => {
            const policy = config.strategies[mode];
            const rules = STRATEGY_RULE_TEXTS[mode];
            return (
              <div key={mode} className="card space-y-2 p-3">
                <SectionTitle>{mode}</SectionTitle>
                <p className="text-xs text-[var(--color-muted)]">{rules.goal}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["defaultMaxActions", "defaultMaxActions"],
                      ["lengthMultiplier", "lengthMultiplier"],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        type="number"
                        step={key === "lengthMultiplier" ? 0.05 : 1}
                        className="field"
                        value={policy[key]}
                        onChange={(event) =>
                          patch((current) => ({
                            ...current,
                            strategies: {
                              ...current.strategies,
                              [mode]: {
                                ...current.strategies[mode],
                                [key]: Number(event.target.value),
                              },
                            },
                          }))
                        }
                      />
                    </Field>
                  ))}
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
                    allowWorldview
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </Collapsible>

      <Collapsible title="Worldview Scheduler 世界观调度">
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["organicTargetRate", "目标自然世界观占比", 0.01],
              ["rollingEligibleWindow", "滚动合格窗口", 1],
              ["minEligibleTurnsBetweenOrganic", "最小合格间隔", 1],
              ["maxEligibleTurnsBetweenOrganic", "最大合格间隔", 1],
              ["minAssistantTurnsBetweenAnyWorldview", "任意世界观最小 assistant 间隔", 1],
              ["seedCooldownTurns", "种子冷却轮次", 1],
              ["maxWorldviewShare", "W2 篇幅占比上限", 0.05],
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
          <div className="sm:col-span-2">
            <Field label="禁词表（每行一个）">
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
      </Collapsible>

      <Collapsible title={`Worldview Canon 事实库（${config.canonFacts.length}）`}>
        <CanonFactsEditor
          facts={config.canonFacts}
          onChange={(canonFacts) =>
            patch((current) => ({ ...current, canonFacts }))
          }
        />
      </Collapsible>

      <Collapsible title={`Worldview Seeds 种子库（${config.worldviewSeeds.length}）`}>
        <SeedsEditor
          seeds={config.worldviewSeeds}
          onChange={(worldviewSeeds) =>
            patch((current) => ({ ...current, worldviewSeeds }))
          }
        />
      </Collapsible>

      <Collapsible title={`Behavior Examples 示例卡（${config.exampleCards.length}）`}>
        <ExampleCardsEditor
          cards={config.exampleCards}
          onChange={(exampleCards) =>
            patch((current) => ({ ...current, exampleCards }))
          }
        />
      </Collapsible>

      <Collapsible title="Example Retrieval 示例检索">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
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
            启用示例检索
          </label>
          <Field label="minScore">
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
          <Field label="maxChars">
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
      </Collapsible>

      <Collapsible title="Safety Rules 安全规则">
        <SafetyRulesEditor
          safety={config.safety}
          onChange={(safety) => patch((current) => ({ ...current, safety }))}
        />
      </Collapsible>

      <Collapsible title="Response Contract（只读）">
        <ReadonlyJson value={config.responseContract} />
      </Collapsible>
    </div>
  );
});

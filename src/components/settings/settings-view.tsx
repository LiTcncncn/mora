"use client";

import { useEffect, useState } from "react";
import { ENERGY_LEVELS, type EnergyLevel, type ProviderId } from "@/domain/common";
import { MEMORY_TYPES } from "@/domain/memory";
import { DEFAULT_SECTION_ORDER } from "@/domain/prompt";
import type { GenerationSettings, ModelSlot, SettingsData } from "@/domain/settings";
import { useProfiles } from "@/components/app-shell/profile-context";
import {
  Collapsible,
  ConfirmButton,
  Field,
  Notice,
  SectionTitle,
} from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import {
  ENERGY_LEVEL_LABELS,
  labelOf,
  MEMORY_TYPE_LABELS,
  MEMORY_WEIGHT_LABELS,
  PROVIDER_LABELS,
  REASONING_EFFORT_LABELS,
  CONTEXT_SECTION_LABELS,
} from "@/lib/labels";
import { ProfileManager } from "./profile-manager";
import { BehaviorConfigEditor } from "./behavior-config-editor";
import { ConfigTransfer } from "./config-transfer";

const PROVIDERS: ProviderId[] = ["kimi", "deepseek"];

export function SettingsView() {
  const { activeProfileId, providerStatus } = useProfiles();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async (profileId: string): Promise<void> => {
    try {
      setSettings(
        await api.get<SettingsData>(
          `/api/settings?profileId=${encodeURIComponent(profileId)}`,
        ),
      );
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  useEffect(() => {
    if (!activeProfileId) return;
    setStatus(null);
    void load(activeProfileId);
  }, [activeProfileId]);

  const save = async (): Promise<void> => {
    if (!activeProfileId || !settings) return;
    setSaving(true);
    setStatus(null);
    try {
      await api.put("/api/settings", { profileId: activeProfileId, settings });
      setStatus("已保存到本机 data/settings.json");
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const patch = (updater: (current: SettingsData) => SettingsData): void => {
    setSettings((current) => (current ? updater(current) : current));
  };

  if (!activeProfileId) return <p className="text-sm">正在加载档案…</p>;
  if (error && !settings) return <Notice tone="error">{error}</Notice>;
  if (!settings) return <p className="text-sm">加载中…</p>;

  return (
    <div className="space-y-4 pb-24">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {status ? <Notice>{status}</Notice> : null}

      <ProfileManager />

      <Notice>
        Compare 与预览已接入行为配置 v2：每轮会先跑 Safety → Router → Turn Plan，再组装提示词。
        下方 v1 Settings 仍管模型槽位、供应商、Memory 检索与 Context 预算；Energy 档位判定来自 v2 Router（可用手动 override）。
      </Notice>

      <Collapsible title="行为配置 v2（Router / Energy / 世界观 / 示例卡）" defaultOpen>
        <BehaviorConfigEditor
          profileId={activeProfileId}
          onSaved={() => void load(activeProfileId)}
        />
      </Collapsible>

      <ConfigTransfer
        profileId={activeProfileId}
        onImported={() => void load(activeProfileId)}
      />

      <Collapsible title="模型槽位（决定每轮参与比较的模型）" defaultOpen>
        <ModelSlotEditor
          settings={settings}
          onChange={(slots) =>
            patch((current) => ({
              ...current,
              compare: { ...current.compare, modelSlots: slots },
            }))
          }
        />
      </Collapsible>

      <Collapsible title="供应商与生成参数">
        <div className="space-y-6">
          {PROVIDERS.map((provider) => (
            <ProviderEditor
              key={provider}
              provider={provider}
              settings={settings}
              configured={providerStatus?.[provider].configured ?? false}
              onChange={patch}
            />
          ))}
        </div>
      </Collapsible>

      <Collapsible title="Energy 手动 override（Compare 可选覆盖 Router 档位）">
        <Notice>
          四档字数与策略编译读 v2「Energy v2 四档预算」。此处仅保留手动 override 开关与 v1 分类器设置（供对照/回滚）。
        </Notice>
        <EnergyEditor settings={settings} onChange={patch} />
      </Collapsible>

      <Collapsible title="Memory 记忆选择与自动提取">
        <MemoryEditor settings={settings} onChange={patch} />
      </Collapsible>

      <Collapsible title="Context 上下文预算">
        <ContextEditor settings={settings} onChange={patch} />
      </Collapsible>

      <Collapsible title="日志与容量">
        <div className="space-y-3">
          <Notice>
            上下文快照、设置快照与标准化响应一律无条件保存，没有开关：Lab
            的调试能力建立在每轮都能回看当时发生了什么之上。
          </Notice>
          <Field
            label="每个档案保留的 run 运行记录上限"
            hint="超限时删除该档案最旧的记录。"
          >
            <input
              type="number"
              className="field"
              value={settings.logging.maxRuns}
              onChange={(event) =>
                patch((current) => ({
                  ...current,
                  logging: {
                    ...current.logging,
                    maxRuns: Number(event.target.value),
                  },
                }))
              }
            />
          </Field>
        </div>
      </Collapsible>

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-white px-1 py-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存设置"}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void load(activeProfileId)}
        >
          放弃修改
        </button>
      </div>
    </div>
  );
}

function ModelSlotEditor({
  settings,
  onChange,
}: {
  settings: SettingsData;
  onChange: (slots: ModelSlot[]) => void;
}) {
  const slots = settings.compare.modelSlots;

  const updateSlot = (index: number, next: Partial<ModelSlot>): void => {
    onChange(
      slots.map((slot, position) =>
        position === index ? { ...slot, ...next } : slot,
      ),
    );
  };

  return (
    <div className="space-y-3">
      <Notice>
        修改某个槽位的模型会让它此前的对话历史与新模型不一致。建议改模型时新建对话，或复制一个新槽位。
      </Notice>

      {slots.map((slot, index) => (
        <div key={slot.id} className="card space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={slot.enabled}
                onChange={(event) =>
                  updateSlot(index, { enabled: event.target.checked })
                }
              />
              启用
            </label>
            <span className="mono text-[var(--color-muted)]">{slot.id}</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="显示名称">
              <input
                className="field"
                value={slot.label}
                onChange={(event) => updateSlot(index, { label: event.target.value })}
              />
            </Field>
            <Field label="供应商">
              <select
                className="field"
                value={slot.provider}
                onChange={(event) =>
                  updateSlot(index, { provider: event.target.value as ProviderId })
                }
              >
                {PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {labelOf(PROVIDER_LABELS, provider)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="模型 ID"
              hint="请按你账号实际可用的模型填写，可先用侧边栏的模型测试确认。"
            >
              <input
                className="field"
                value={slot.modelId}
                onChange={(event) =>
                  updateSlot(index, { modelId: event.target.value })
                }
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={() =>
                onChange([
                  ...slots,
                  {
                    ...slot,
                    id: `slot-${Date.now()}`,
                    label: `${slot.label} 副本`,
                  },
                ])
              }
            >
              复制槽位
            </button>
            {slots.length > 1 ? (
              <ConfirmButton
                label="删除槽位"
                confirmLabel="确认删除"
                onConfirm={() =>
                  onChange(slots.filter((_, position) => position !== index))
                }
              />
            ) : null}
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn"
        onClick={() =>
          onChange([
            ...slots,
            {
              id: `slot-${Date.now()}`,
              label: `槽位 ${slots.length + 1}`,
              enabled: false,
              provider: "kimi",
              modelId: settings.providers.kimi.modelId,
              generationOverrides: {},
            },
          ])
        }
      >
        新增槽位
      </button>
    </div>
  );
}

function ProviderEditor({
  provider,
  settings,
  configured,
  onChange,
}: {
  provider: ProviderId;
  settings: SettingsData;
  configured: boolean;
  onChange: (updater: (current: SettingsData) => SettingsData) => void;
}) {
  const config = settings.providers[provider];
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const setGeneration = (next: Partial<GenerationSettings>): void => {
    onChange((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider]: {
          ...current.providers[provider],
          generation: { ...current.providers[provider].generation, ...next },
        },
      },
    }));
  };

  const numberOrNull = (value: string): number | null =>
    value.trim() === "" ? null : Number(value);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SectionTitle>{labelOf(PROVIDER_LABELS, provider)}</SectionTitle>
        <span className="text-xs text-[var(--color-muted)]">
          API Key 接口密钥 {configured ? "已配置" : "未配置"}（只在服务端读取）
        </span>
        <button
          type="button"
          className="btn"
          disabled={testing || !configured}
          onClick={async () => {
            setTesting(true);
            setTestResult(null);
            try {
              const result = await api.post<{ ok: boolean; message: string }>(
                "/api/providers/test",
                { provider, modelId: config.modelId },
              );
              setTestResult(result.message);
            } catch (caught) {
              setTestResult(errorMessage(caught));
            } finally {
              setTesting(false);
            }
          }}
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
        <span className="text-xs text-[var(--color-muted)]">
          测试会真实调用一次，产生极少量费用。
        </span>
      </div>
      {testResult ? <Notice>{testResult}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="默认模型 ID">
          <input
            className="field"
            value={config.modelId}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                providers: {
                  ...current.providers,
                  [provider]: {
                    ...current.providers[provider],
                    modelId: event.target.value,
                  },
                },
              }))
            }
          />
        </Field>
        <Field label="max output tokens 最大输出长度">
          <input
            type="number"
            className="field"
            value={config.generation.maxOutputTokens}
            onChange={(event) =>
              setGeneration({ maxOutputTokens: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="temperature 随机度" hint="留空表示不发送该参数。">
          <input
            className="field"
            value={config.generation.temperature ?? ""}
            onChange={(event) =>
              setGeneration({ temperature: numberOrNull(event.target.value) })
            }
          />
        </Field>
        <Field label="top_p 核采样" hint="留空表示不发送该参数。">
          <input
            className="field"
            value={config.generation.topP ?? ""}
            onChange={(event) =>
              setGeneration({ topP: numberOrNull(event.target.value) })
            }
          />
        </Field>
        <Field label="reasoning effort 推理强度">
          <select
            className="field"
            value={config.generation.reasoningEffort ?? ""}
            onChange={(event) =>
              setGeneration({
                reasoningEffort:
                  event.target.value === ""
                    ? null
                    : (event.target
                        .value as GenerationSettings["reasoningEffort"]),
              })
            }
          >
            <option value="">不发送</option>
            {["none", "minimal", "low", "medium", "high", "xhigh", "max"].map(
              (value) => (
                <option key={value} value={value}>
                  {labelOf(REASONING_EFFORT_LABELS, value)}
                </option>
              ),
            )}
          </select>
        </Field>
        <Field label="thinking mode 思考模式">
          <select
            className="field"
            value={config.generation.thinkingMode ?? ""}
            onChange={(event) =>
              setGeneration({
                thinkingMode:
                  event.target.value === ""
                    ? null
                    : (event.target.value as "enabled" | "disabled"),
              })
            }
          >
            <option value="">不发送</option>
            <option value="disabled">disabled 关闭</option>
            <option value="enabled">enabled 开启</option>
          </select>
        </Field>
        <Field label="超时（毫秒）">
          <input
            type="number"
            className="field"
            value={config.transport.timeoutMs}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                providers: {
                  ...current.providers,
                  [provider]: {
                    ...current.providers[provider],
                    transport: {
                      ...current.providers[provider].transport,
                      timeoutMs: Number(event.target.value),
                    },
                  },
                },
              }))
            }
          />
        </Field>
        <Field label="最大重试次数" hint="重试耗尽后直接显示调用失败。">
          <input
            type="number"
            className="field"
            value={config.transport.maxRetries}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                providers: {
                  ...current.providers,
                  [provider]: {
                    ...current.providers[provider],
                    transport: {
                      ...current.providers[provider].transport,
                      maxRetries: Number(event.target.value),
                    },
                  },
                },
              }))
            }
          />
        </Field>
      </div>
    </div>
  );
}

function EnergyEditor({
  settings,
  onChange,
}: {
  settings: SettingsData;
  onChange: (updater: (current: SettingsData) => SettingsData) => void;
}) {
  const energy = settings.energy;

  const setPolicy = (
    level: EnergyLevel,
    next: Partial<SettingsData["energy"]["policies"][EnergyLevel]>,
  ): void => {
    onChange((current) => {
      const policy = current.energy.policies[level];
      if (!policy) return current;
      return {
        ...current,
        energy: {
          ...current.energy,
          policies: {
            ...current.energy.policies,
            [level]: { ...policy, ...next },
          },
        },
      };
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="判定模式">
          <select
            className="field"
            value={energy.mode}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                energy: {
                  ...current.energy,
                  mode: event.target.value as SettingsData["energy"]["mode"],
                },
              }))
            }
          >
            <option value="manual">manual 固定档位：始终使用基准档位</option>
            <option value="rule_based">rule_based 规则判定：仅按关键词和字数</option>
            <option value="hybrid">
              hybrid 规则判定：本轮手动指定优先，否则走规则
            </option>
            <option value="llm">
              llm 模型判定：语义分类，规则只作草稿；失败则回退规则
            </option>
          </select>
        </Field>
        <Field label="基准档位">
          <select
            className="field"
            value={energy.manualLevel}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                energy: {
                  ...current.energy,
                  manualLevel: event.target.value as EnergyLevel,
                },
              }))
            }
          >
            {ENERGY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {labelOf(ENERGY_LEVEL_LABELS, level)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="短消息阈值（字符）">
          <input
            type="number"
            className="field"
            value={energy.ruleBased.shortMessageThreshold}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                energy: {
                  ...current.energy,
                  ruleBased: {
                    ...current.energy.ruleBased,
                    shortMessageThreshold: Number(event.target.value),
                  },
                },
              }))
            }
          />
        </Field>
        <Field
          label="疲惫标点权重"
          hint="省略号、句末缺标点这类信号往低档推的力度，0 到 1。"
        >
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            className="field"
            value={energy.ruleBased.exhaustionPunctuationWeight}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                energy: {
                  ...current.energy,
                  ruleBased: {
                    ...current.energy.ruleBased,
                    exhaustionPunctuationWeight: Number(event.target.value),
                  },
                },
              }))
            }
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={energy.allowPerMessageOverride}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              energy: {
                ...current.energy,
                allowPerMessageOverride: event.target.checked,
              },
            }))
          }
        />
        允许在 Compare 页为单轮手动指定档位
      </label>

      {energy.mode === "llm" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="档位判定供应商">
            <select
              className="field"
              value={energy.llmClassifier.provider}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  energy: {
                    ...current.energy,
                    llmClassifier: {
                      ...current.energy.llmClassifier,
                      provider: event.target.value as ProviderId,
                    },
                  },
                }))
              }
            >
              <option value="kimi">Kimi</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </Field>
          <Field label="档位判定模型 ID" hint="建议用低延迟小模型，例如 deepseek-v4-flash。">
            <input
              className="field"
              value={energy.llmClassifier.modelId}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  energy: {
                    ...current.energy,
                    llmClassifier: {
                      ...current.energy.llmClassifier,
                      modelId: event.target.value,
                    },
                  },
                }))
              }
            />
          </Field>
        </div>
      ) : null}

      <Field label="低能量关键词" hint="用逗号分隔。命中会把档位向低推。llm 模式下只作为草稿。">
        <input
          className="field"
          value={energy.ruleBased.lowEnergyKeywords.join("，")}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              energy: {
                ...current.energy,
                ruleBased: {
                  ...current.energy.ruleBased,
                  lowEnergyKeywords: event.target.value
                    .split(/[,，]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                },
              },
            }))
          }
        />
      </Field>

      <Field label="高能量关键词" hint="用逗号分隔。">
        <input
          className="field"
          value={energy.ruleBased.highEnergyKeywords.join("，")}
          onChange={(event) =>
            onChange((current) => ({
              ...current,
              energy: {
                ...current.energy,
                ruleBased: {
                  ...current.energy.ruleBased,
                  highEnergyKeywords: event.target.value
                    .split(/[,，]/)
                    .map((item) => item.trim())
                    .filter(Boolean),
                },
              },
            }))
          }
        />
      </Field>

      {ENERGY_LEVELS.map((level) => {
        const policy = energy.policies[level];
        if (!policy) return null;
        return (
          <div key={level} className="card space-y-3 p-3">
            <SectionTitle>{labelOf(ENERGY_LEVEL_LABELS, level)}</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="目标最大字符">
                <input
                  type="number"
                  className="field"
                  value={policy.targetMaxChars}
                  onChange={(event) =>
                    setPolicy(level, { targetMaxChars: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="目标最大句数">
                <input
                  type="number"
                  className="field"
                  value={policy.targetMaxSentences}
                  onChange={(event) =>
                    setPolicy(level, {
                      targetMaxSentences: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="最多建议动作数">
                <input
                  type="number"
                  className="field"
                  value={policy.maxSuggestedActions}
                  onChange={(event) =>
                    setPolicy(level, {
                      maxSuggestedActions: Number(event.target.value),
                    })
                  }
                />
              </Field>
            </div>
            <Field label="语气指令">
              <textarea
                className="field min-h-16"
                value={policy.toneInstruction}
                onChange={(event) =>
                  setPolicy(level, { toneInstruction: event.target.value })
                }
              />
            </Field>
            <Field label="回复指令">
              <textarea
                className="field min-h-20"
                value={policy.responseInstruction}
                onChange={(event) =>
                  setPolicy(level, { responseInstruction: event.target.value })
                }
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={policy.allowAdvice}
                onChange={(event) =>
                  setPolicy(level, { allowAdvice: event.target.checked })
                }
              />
              允许提出行动建议
            </label>
          </div>
        );
      })}
    </div>
  );
}

function MemoryEditor({
  settings,
  onChange,
}: {
  settings: SettingsData;
  onChange: (updater: (current: SettingsData) => SettingsData) => void;
}) {
  const memory = settings.memory;

  const setMemory = (next: Partial<SettingsData["memory"]>): void => {
    onChange((current) => ({
      ...current,
      memory: { ...current.memory, ...next },
    }));
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={memory.enabled}
          onChange={(event) => setMemory({ enabled: event.target.checked })}
        />
        向模型注入 Memory 记忆
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="topK 最多注入条数">
          <input
            type="number"
            className="field"
            value={memory.topK}
            onChange={(event) => setMemory({ topK: Number(event.target.value) })}
          />
        </Field>
        <Field label="maxChars 最大字符预算">
          <input
            type="number"
            className="field"
            value={memory.maxChars}
            onChange={(event) => setMemory({ maxChars: Number(event.target.value) })}
          />
        </Field>
        <Field label="最低重要度" hint="pinned 置顶的条目可绕过该阈值。">
          <input
            className="field"
            value={memory.minImportance}
            onChange={(event) =>
              setMemory({ minImportance: Number(event.target.value) })
            }
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {(["pinned", "importance", "recency", "keywordRelevance"] as const).map(
          (key) => (
            <Field key={key} label={`权重 · ${labelOf(MEMORY_WEIGHT_LABELS, key)}`}>
              <input
                className="field"
                value={memory.weights[key]}
                onChange={(event) =>
                  setMemory({
                    weights: {
                      ...memory.weights,
                      [key]: Number(event.target.value),
                    },
                  })
                }
              />
            </Field>
          ),
        )}
      </div>

      <Field label="参与选择的记忆类型">
        <div className="flex flex-wrap gap-3">
          {MEMORY_TYPES.map((type) => (
            <label key={type} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={memory.includedTypes.includes(type)}
                onChange={(event) =>
                  setMemory({
                    includedTypes: event.target.checked
                      ? [...memory.includedTypes, type]
                      : memory.includedTypes.filter((item) => item !== type),
                  })
                }
              />
              {labelOf(MEMORY_TYPE_LABELS, type)}
            </label>
          ))}
        </div>
      </Field>

      <div className="card space-y-3 p-3">
        <SectionTitle>自动提取与写入</SectionTitle>
        <Notice>
          开启后，每轮用户消息保存成功会额外调用一次模型，由系统判断是否记住。默认直接写入正式记忆，下一轮起可进入上下文。不确定的内容应由抽取模型直接舍弃。
        </Notice>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={memory.autoCandidateExtraction.enabled}
            onChange={(event) =>
              setMemory({
                autoCandidateExtraction: {
                  ...memory.autoCandidateExtraction,
                  enabled: event.target.checked,
                },
              })
            }
          />
          启用自动提取
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={memory.autoCandidateExtraction.requireManualApproval}
            onChange={(event) =>
              setMemory({
                autoCandidateExtraction: {
                  ...memory.autoCandidateExtraction,
                  requireManualApproval: event.target.checked,
                },
              })
            }
          />
          写入前需人工确认（关闭后抽取结果直接生效）
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="提取用供应商">
            <select
              className="field"
              value={memory.autoCandidateExtraction.provider}
              onChange={(event) =>
                setMemory({
                  autoCandidateExtraction: {
                    ...memory.autoCandidateExtraction,
                    provider: event.target.value as ProviderId,
                  },
                })
              }
            >
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {labelOf(PROVIDER_LABELS, provider)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="提取用模型 ID">
            <input
              className="field"
              value={memory.autoCandidateExtraction.modelId}
              onChange={(event) =>
                setMemory({
                  autoCandidateExtraction: {
                    ...memory.autoCandidateExtraction,
                    modelId: event.target.value,
                  },
                })
              }
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

function ContextEditor({
  settings,
  onChange,
}: {
  settings: SettingsData;
  onChange: (updater: (current: SettingsData) => SettingsData) => void;
}) {
  const context = settings.context;

  const setContext = (next: Partial<SettingsData["context"]>): void => {
    onChange((current) => ({
      ...current,
      context: { ...current.context, ...next },
    }));
  };

  // safety_baseline 由服务端强制置顶，不参与排序。未出现在已存顺序里的分区
  // 会被 builder 追加到末尾，这里补齐成全集，免得它们在界面上无法调整。
  const orderable = [
    ...new Set([...context.sectionOrder, ...DEFAULT_SECTION_ORDER]),
  ].filter((id) => id !== "safety_baseline");

  const moveSection = (index: number, delta: number): void => {
    const target = index + delta;
    if (target < 0 || target >= orderable.length) return;
    const next = [...orderable];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    setContext({ sectionOrder: ["safety_baseline", ...next] });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="历史轮数">
          <input
            type="number"
            className="field"
            value={context.historyTurns}
            onChange={(event) =>
              setContext({ historyTurns: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="历史最大字符">
          <input
            type="number"
            className="field"
            value={context.maxHistoryChars}
            onChange={(event) =>
              setContext({ maxHistoryChars: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="上下文总字符预算" hint="超预算时按规则裁剪，仍超出则直接报错。">
          <input
            type="number"
            className="field"
            value={context.maxTotalChars}
            onChange={(event) =>
              setContext({ maxTotalChars: Number(event.target.value) })
            }
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={context.includeTimestamps}
            onChange={(event) =>
              setContext({ includeTimestamps: event.target.checked })
            }
          />
          历史中包含时间戳
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={context.includeEnergyReason}
            onChange={(event) =>
              setContext({ includeEnergyReason: event.target.checked })
            }
          />
          向模型说明 Energy 能量档位的判定依据
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={context.includeMemoryMetadata}
            onChange={(event) =>
              setContext({ includeMemoryMetadata: event.target.checked })
            }
          />
          Memory 记忆附带类型与重要度
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={context.customExperimentBlockEnabled}
            onChange={(event) =>
              setContext({ customExperimentBlockEnabled: event.target.checked })
            }
          />
          启用自定义实验分区
        </label>
      </div>

      {context.customExperimentBlockEnabled ? (
        <Notice>
          这个开关只是允许注入。分区本身还要在 Studio 的 Prompt
          预设里启用并写好内容，两处都打开才会真正进入上下文。
        </Notice>
      ) : null}

      <div className="space-y-2 border-t pt-3">
        <SectionTitle>分区顺序</SectionTitle>
        <p className="text-xs text-[var(--color-muted)]">
          决定各分区在 instructions 里的先后。安全底线永远置顶，不参与排序；
          history 由 input 承载，排到哪里都在最后。
        </p>
        <ol className="space-y-1">
          {orderable.map((id, index) => (
            <li key={id} className="flex items-center gap-2 text-sm">
              <span className="w-6 text-[var(--color-muted)]">{index + 1}</span>
              <span className="mono flex-1">
                {labelOf(CONTEXT_SECTION_LABELS, id)}
              </span>
              <button
                type="button"
                className="btn"
                disabled={index === 0}
                onClick={() => moveSection(index, -1)}
              >
                上移
              </button>
              <button
                type="button"
                className="btn"
                disabled={index === orderable.length - 1}
                onClick={() => moveSection(index, 1)}
              >
                下移
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

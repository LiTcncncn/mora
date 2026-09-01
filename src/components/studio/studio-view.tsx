"use client";

import { useCallback, useEffect, useState } from "react";
import type { Persona } from "@/domain/persona";
import {
  TEMPLATE_VARIABLE_WHITELIST,
  validateTemplate,
  type ContextSectionId,
  type PromptPreset,
  type PromptSectionTemplate,
} from "@/domain/prompt";
import type { SettingsData } from "@/domain/settings";
import { useProfiles } from "@/components/app-shell/profile-context";
import { Collapsible, Field, Notice, SectionTitle } from "@/components/ui/primitives";
import { api, errorMessage } from "@/lib/api-client";
import { labelOf, PERSONA_TRAIT_LABELS } from "@/lib/labels";
import {
  SAFETY_BASELINE,
  SAFETY_BASELINE_UI_LABEL,
} from "@/domain/safety";
import { ActiveSelector } from "./active-selector";
import { PromptPreview } from "./prompt-preview";

/**
 * 变量清单直接决定策划能写出什么，光给变量名不够用。这里说明每个变量注入什么，
 * 并且点出 user.message 的坑：构建器总会在最后追加「用户当前这句话」，
 * 在分区里再用一次会让用户原话出现两遍。
 */
const VARIABLE_NOTES: Record<(typeof TEMPLATE_VARIABLE_WHITELIST)[number], string> =
  {
    "persona.name": "人格名称",
    "persona.corePrompt": "人格的核心 Prompt 原文",
    "persona.renderedTraits":
      "由五个性格滑杆、风格选项、倾向/避免的表达、关系定位、边界渲染成的一段文字",
    "energy.level": "本轮能量档位，如 E1",
    "energy.policy": "该档位的语气与回复指令（含字数目标；提问数由 Turn Plan 决定）",
    "memory.rendered": "本轮选中的长期记忆条目",
    "history.rendered": "裁剪后的对话历史",
    "user.message":
      "用户当前这句话。注意：系统已经无条件把它追加在提示词最后，分区里再用会重复一次",
  };

export function StudioView() {
  const { activeProfileId } = useProfiles();
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [presets, setPresets] = useState<PromptPreset[]>([]);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [preset, setPreset] = useState<PromptPreset | null>(null);
  // 已保存内容的快照，用来判断有没有未保存的改动。
  const [saved, setSaved] = useState<{ persona: string; preset: string }>({
    persona: "",
    preset: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(async (profileId: string): Promise<void> => {
    try {
      const query = `profileId=${encodeURIComponent(profileId)}`;
      const loadedSettings = await api.get<SettingsData>(`/api/settings?${query}`);
      const [loadedPersonas, loadedPresets, loadedPersona, loadedPreset] =
        await Promise.all([
          api.get<Persona[]>(`/api/personas?${query}`),
          api.get<PromptPreset[]>(`/api/prompt-presets?${query}`),
          api.get<Persona>(
            `/api/personas/${loadedSettings.activePersonaId}?${query}`,
          ),
          api.get<PromptPreset>(
            `/api/prompt-presets/${loadedSettings.activePromptPresetId}?${query}`,
          ),
        ]);
      setSettings(loadedSettings);
      setPersonas(loadedPersonas);
      setPresets(loadedPresets);
      setPersona(loadedPersona);
      setPreset(loadedPreset);
      setSaved({
        persona: JSON.stringify(loadedPersona),
        preset: JSON.stringify(loadedPreset),
      });
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    if (!activeProfileId) return;
    setStatus(null);
    void load(activeProfileId);
  }, [activeProfileId, load]);

  const savePersona = async (): Promise<void> => {
    if (!activeProfileId || !persona) return;
    try {
      await api.put(`/api/personas/${persona.id}`, {
        profileId: activeProfileId,
        persona,
      });
      setStatus("Persona 人格已保存");
      setError(null);
      await load(activeProfileId);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const savePreset = async (): Promise<void> => {
    if (!activeProfileId || !preset) return;
    try {
      const updated = await api.put<PromptPreset>(
        `/api/prompt-presets/${preset.id}`,
        { profileId: activeProfileId, preset },
      );
      setStatus(`Prompt Preset 提示词预设已保存，版本 ${updated.version}`);
      setError(null);
      await load(activeProfileId);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  if (!activeProfileId) return <p className="text-sm">正在加载档案…</p>;
  if (error && !persona) return <Notice tone="error">{error}</Notice>;
  if (!persona || !preset || !settings) return <p className="text-sm">加载中…</p>;

  const personaDirty = JSON.stringify(persona) !== saved.persona;
  const presetDirty = JSON.stringify(preset) !== saved.preset;
  const dirty = personaDirty || presetDirty;

  return (
    <div className="space-y-4 pb-10">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {status ? <Notice>{status}</Notice> : null}

      <ActiveSelector
        profileId={activeProfileId}
        personas={personas}
        presets={presets}
        settings={settings}
        dirty={dirty}
        onReload={() => void load(activeProfileId)}
      />

      <Collapsible title="Persona 人格" defaultOpen>
        <PersonaEditor
          persona={persona}
          dirty={personaDirty}
          onChange={setPersona}
          onSave={savePersona}
        />
      </Collapsible>

      <Collapsible
        title={`Prompt 提示词分区（版本 ${preset.version}）`}
        defaultOpen
      >
        <PresetEditor
          preset={preset}
          settings={settings}
          dirty={presetDirty}
          onChange={setPreset}
          onSave={savePreset}
        />
      </Collapsible>

      <Collapsible title="组装结果预览（只读，不写入任何数据）" defaultOpen>
        <PromptPreview
          profileId={activeProfileId}
          settings={settings}
          dirty={dirty}
        />
      </Collapsible>
    </div>
  );
}

function PersonaEditor({
  persona,
  dirty,
  onChange,
  onSave,
}: {
  persona: Persona;
  dirty: boolean;
  onChange: (next: Persona) => void;
  onSave: () => void;
}) {
  const setStyle = (next: Partial<Persona["style"]>): void => {
    onChange({ ...persona, style: { ...persona.style, ...next } });
  };

  const linesToArray = (value: string): string[] =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  return (
    <div className="space-y-3">
      <Field label="名称">
        <input
          className="field"
          value={persona.name}
          onChange={(event) => onChange({ ...persona, name: event.target.value })}
        />
      </Field>

      <Field
        label="备注"
        hint="只给人看，不进提示词。用来记这版人格想验证什么。"
      >
        <textarea
          className="field min-h-16"
          value={persona.description}
          onChange={(event) =>
            onChange({ ...persona, description: event.target.value })
          }
        />
      </Field>

      <Field label="核心 Prompt 提示词">
        <textarea
          className="field min-h-60"
          value={persona.corePrompt}
          onChange={(event) =>
            onChange({ ...persona, corePrompt: event.target.value })
          }
        />
      </Field>

      <Notice>
        下面这些性格与风格设置不会把裸数值发给模型，而是先渲染成一段文字，通过{" "}
        <code>{"{{persona.renderedTraits}}"}</code>{" "}
        注入。如果「语气与风格」分区被停用，这一整块都不会生效。
      </Notice>

      <div className="grid gap-3 sm:grid-cols-5">
        {(
          ["warmth", "humor", "initiative", "directness", "playfulness"] as const
        ).map((trait) => (
          <Field
            key={trait}
            label={`${labelOf(PERSONA_TRAIT_LABELS, trait)}：${persona.traits[trait]}`}
          >
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              className="w-full"
              value={persona.traits[trait]}
              onChange={(event) =>
                onChange({
                  ...persona,
                  traits: {
                    ...persona.traits,
                    [trait]: Number(event.target.value),
                  },
                })
              }
            />
          </Field>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="默认回复长度">
          <select
            className="field"
            value={persona.style.defaultReplyLength}
            onChange={(event) =>
              setStyle({
                defaultReplyLength: event.target
                  .value as Persona["style"]["defaultReplyLength"],
              })
            }
          >
            <option value="very_short">very_short 极短</option>
            <option value="short">short 短</option>
            <option value="medium">medium 中等</option>
            <option value="long">long 长</option>
          </select>
        </Field>
        <Field label="emoji 表情符号">
          <select
            className="field"
            value={persona.style.emojiMode}
            onChange={(event) =>
              setStyle({
                emojiMode: event.target.value as Persona["style"]["emojiMode"],
              })
            }
          >
            <option value="none">none 不使用</option>
            <option value="rare">rare 极少</option>
            <option value="light">light 少量</option>
          </select>
        </Field>
      </div>

      <Field label="关系定位" hint="建议弱化排他与依赖性表达。">
        <textarea
          className="field min-h-16"
          value={persona.relationshipFraming}
          onChange={(event) =>
            onChange({ ...persona, relationshipFraming: event.target.value })
          }
        />
      </Field>

      <Field
        label={`倾向的说话方式（${persona.style.preferredPatterns.length} 条）`}
        hint="每行一条，会以「倾向的说话方式」注入提示词。这里是正面示范，对模型的影响最直接。"
      >
        <textarea
          className="field min-h-40"
          value={persona.style.preferredPatterns.join("\n")}
          onChange={(event) =>
            setStyle({ preferredPatterns: linesToArray(event.target.value) })
          }
        />
      </Field>

      <Field
        label={`避免的表达（${persona.style.avoidPatterns.length} 条）`}
        hint="每行一条，会以「避免这些表达」注入提示词。"
      >
        <textarea
          className="field min-h-40"
          value={persona.style.avoidPatterns.join("\n")}
          onChange={(event) =>
            setStyle({ avoidPatterns: linesToArray(event.target.value) })
          }
        />
      </Field>

      <Field label="边界" hint="每行一条。">
        <textarea
          className="field min-h-24"
          value={persona.boundaries.join("\n")}
          onChange={(event) =>
            onChange({ ...persona, boundaries: linesToArray(event.target.value) })
          }
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={onSave}>
          保存 Persona 人格
        </button>
        {dirty ? (
          <span className="text-xs text-[var(--color-warning)]">有未保存的改动</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 分区按实际生效顺序展示。顺序由 settings.context.sectionOrder 决定，
 * 不是 preset.sections 的数组序：照数组序编号会让策划看到错的组装顺序。
 * 安全底线不来自预设，由服务端无条件置顶注入，这里也不从预设里取。
 */
function effectiveOrder(
  preset: PromptPreset,
  settings: SettingsData,
): PromptSectionTemplate[] {
  const byId = new Map(
    preset.sections
      .filter((section) => section.id !== "safety_baseline")
      .map((section) => [section.id, section]),
  );
  const configured = settings.context.sectionOrder.filter((id) => byId.has(id));
  const missing = [...byId.keys()].filter((id) => !configured.includes(id));

  return [...configured, ...missing]
    .map((id) => byId.get(id))
    .filter((section): section is PromptSectionTemplate => section !== undefined);
}

/** 说明这个分区本轮到底会不会进提示词，界面上看不出来就等于没生效。 */
function skipReason(
  section: PromptSectionTemplate,
  settings: SettingsData,
): string | null {
  if (!section.enabled) return "已停用，不会进入提示词";
  if (!section.template.trim()) return "模板为空，整块会被跳过";
  if (
    section.id === "custom_experiment" &&
    !settings.context.customExperimentBlockEnabled
  ) {
    return "设置页的「启用自定义实验分区」是关闭的，本分区不会注入";
  }
  if (section.id === "memory" && !settings.memory.enabled) {
    return "设置页关闭了记忆注入，没有命中的记忆时整块会被跳过";
  }
  return null;
}

function PresetEditor({
  preset,
  settings,
  dirty,
  onChange,
  onSave,
}: {
  preset: PromptPreset;
  settings: SettingsData;
  dirty: boolean;
  onChange: (next: PromptPreset) => void;
  onSave: () => void;
}) {
  const ordered = effectiveOrder(preset, settings);

  const invalid = preset.sections.filter(
    (section) => section.editable && !validateTemplate(section.template).ok,
  );

  const updateSection = (
    id: ContextSectionId,
    next: Partial<PromptSectionTemplate>,
  ): void => {
    onChange({
      ...preset,
      sections: preset.sections.map((item) =>
        item.id === id ? { ...item, ...next } : item,
      ),
    });
  };

  return (
    <div className="space-y-3">
      <Notice>
        下面按<strong>实际组装顺序</strong>排列，与发给模型的先后一致。安全底线永远置顶；
        对话历史由 input 承载，始终排在最后。要改顺序请到设置页的「Context
        上下文预算 · 分区顺序」。
      </Notice>

      <details className="card p-3 text-xs">
        <summary className="cursor-pointer text-sm">
          可用变量（{TEMPLATE_VARIABLE_WHITELIST.length} 个，只做字符串替换，不执行表达式）
        </summary>
        <dl className="mt-2 space-y-1">
          {TEMPLATE_VARIABLE_WHITELIST.map((variable) => (
            <div key={variable} className="flex flex-wrap gap-2">
              <dt className="mono">{`{{${variable}}}`}</dt>
              <dd className="text-[var(--color-muted)]">
                {VARIABLE_NOTES[variable]}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      <div
        data-testid="prompt-section"
        data-section-id="safety_baseline"
        className="card space-y-2 p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>1. {SAFETY_BASELINE_UI_LABEL}</SectionTitle>
          <span className="text-xs text-[var(--color-muted)]">
            由程序无条件注入，不来自预设，无法编辑、停用或被导入的配置覆盖
          </span>
        </div>
        <pre className="overflow-x-auto rounded border bg-[var(--color-canvas)] p-2 text-xs whitespace-pre-wrap">
          {SAFETY_BASELINE}
        </pre>
      </div>

      {ordered.map((section, index) => {
        const validation = validateTemplate(section.template);
        const skipped = skipReason(section, settings);

        return (
          <div
            key={section.id}
            data-testid="prompt-section"
            data-section-id={section.id}
            className="card space-y-2 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>
                {index + 2}. {section.title}
              </SectionTitle>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={section.enabled}
                  onChange={(event) =>
                    updateSection(section.id, { enabled: event.target.checked })
                  }
                />
                启用
              </label>
            </div>

            {skipped ? <Notice tone="warning">{skipped}</Notice> : null}

            <Field
              label="标题"
              hint="会原样变成提示词里的 ## 标题，模型看得到，别写内部备注。"
            >
              <input
                className="field"
                value={section.title}
                onChange={(event) =>
                  updateSection(section.id, { title: event.target.value })
                }
              />
            </Field>
            <textarea
              className="field min-h-28"
              value={section.template}
              onChange={(event) =>
                updateSection(section.id, { template: event.target.value })
              }
            />
            {!validation.ok ? (
              <Notice tone="error">
                未知变量：{validation.unknownVariables.join("、")}
              </Notice>
            ) : null}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={invalid.length > 0}
          onClick={onSave}
        >
          保存 Prompt Preset 提示词预设
        </button>
        {invalid.length > 0 ? (
          <span className="text-xs text-[var(--color-danger)]">
            有 {invalid.length} 个分区含未知变量，先修好才能保存。
          </span>
        ) : dirty ? (
          <span className="text-xs text-[var(--color-warning)]">有未保存的改动</span>
        ) : null}
      </div>
    </div>
  );
}

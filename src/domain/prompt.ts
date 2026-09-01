import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common";

export const contextSectionIdSchema = z.enum([
  "safety_baseline",
  "persona",
  "style",
  "turn_plan",
  "energy_policy",
  "memory",
  "history",
  "response_contract",
  "custom_experiment",
]);
export type ContextSectionId = z.infer<typeof contextSectionIdSchema>;

/** 安全底线永远第一，history 永远在 instructions 之后由 input 承载。 */
export const DEFAULT_SECTION_ORDER: readonly ContextSectionId[] = [
  "safety_baseline",
  "persona",
  "style",
  "turn_plan",
  "memory",
  "response_contract",
  "custom_experiment",
  "history",
];

export const promptSectionTemplateSchema = z.object({
  id: contextSectionIdSchema,
  enabled: z.boolean(),
  title: z.string().min(1).max(80),
  template: z.string().max(20_000),
  editable: z.boolean(),
});
export type PromptSectionTemplate = z.infer<typeof promptSectionTemplateSchema>;

export const promptPresetSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  sections: z.array(promptSectionTemplateSchema),
  version: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type PromptPreset = z.infer<typeof promptPresetSchema>;

export const promptPresetsDataSchema = z.object({
  items: z.array(promptPresetSchema),
});
export type PromptPresetsData = z.infer<typeof promptPresetsDataSchema>;

/** 模板变量白名单。未在此列表中的变量必须报错，禁止表达式求值。 */
export const TEMPLATE_VARIABLE_WHITELIST = [
  "persona.name",
  "persona.corePrompt",
  "persona.renderedTraits",
  "energy.level",
  "energy.policy",
  "memory.rendered",
  "history.rendered",
  "user.message",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLE_WHITELIST)[number];

const VARIABLE_PATTERN = /\{\{\s*([^}]*?)\s*\}\}/g;

export interface TemplateValidationResult {
  ok: boolean;
  unknownVariables: string[];
  usedVariables: string[];
}

export function validateTemplate(template: string): TemplateValidationResult {
  const used = new Set<string>();
  const unknown = new Set<string>();
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const name = (match[1] ?? "").trim();
    if ((TEMPLATE_VARIABLE_WHITELIST as readonly string[]).includes(name)) {
      used.add(name);
    } else {
      unknown.add(name);
    }
  }
  return {
    ok: unknown.size === 0,
    unknownVariables: [...unknown].sort(),
    usedVariables: [...used].sort(),
  };
}

/** 纯字符串替换，绝不执行任何表达式或代码。 */
export function renderTemplate(
  template: string,
  values: Record<TemplateVariable, string>,
): string {
  const validation = validateTemplate(template);
  if (!validation.ok) {
    throw new Error(
      `模板包含未知变量：${validation.unknownVariables.join(", ")}`,
    );
  }
  return template.replace(VARIABLE_PATTERN, (_full, rawName: string) => {
    const name = rawName.trim() as TemplateVariable;
    return values[name] ?? "";
  });
}

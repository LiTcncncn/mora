import {
  type FewShotEnergyScope,
  type FewShotSample,
  type FewShotWorldview,
  fewShotEnergyScopeSchema,
  fewShotWorldviewSchema,
} from "./fewshot";

/**
 * 批量编辑用的纯文本格式。策划在一个输入框里维护整份语料，不用逐条点开表单。
 *
 * 记录之间用单独一行 `---` 分隔，每条形如：
 *
 *   [fs-0004]
 *   场景: 休息时内疚
 *   档位: E1
 *   世界观: L2
 *   启用: 是
 *   关键词: 不配休息, 浪费时间
 *   用户: 我今天什么都没干。
 *   回复: 干完活才配休息，这规矩是谁定的啊。
 *   备注: 只给人看，不进提示词
 *
 * 方括号里是样本 id，用于把这段文本认回原来那条样本（保留创建时间）。新增记录
 * 不写这一行即可。值可以换行续写，直到下一个字段名或记录结束。
 */

export const FEW_SHOT_TEXT_SEPARATOR = "---";

const FIELD_KEYS = [
  "场景",
  "档位",
  "世界观",
  "启用",
  "关键词",
  "用户",
  "回复",
  "备注",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

const ID_LINE = /^\[(.*)\]$/;
const FIELD_LINE = new RegExp(`^(${FIELD_KEYS.join("|")})\\s*[:：]\\s*(.*)$`);
/** 方括号里写这些词表示「这是新条目」，等同于不写 id。 */
const BLANK_ID_WORDS = new Set(["", "新建", "新增", "new"]);

export interface FewShotTextRecord {
  /** null 表示新建。 */
  id: string | null;
  scene: string;
  energy: FewShotEnergyScope;
  worldview: FewShotWorldview;
  enabled: boolean;
  keywords: string[];
  user: string;
  reply: string;
  note: string;
}

export interface FewShotTextIssue {
  /** 整份文本里的行号，从 1 开始，用于把错误指回原位。 */
  line: number;
  message: string;
}

export interface FewShotTextParseResult {
  records: FewShotTextRecord[];
  issues: FewShotTextIssue[];
}

export function serializeFewShotSamples(samples: FewShotSample[]): string {
  return samples
    .map((sample) =>
      [
        `[${sample.id}]`,
        `场景: ${sample.scene}`,
        `档位: ${sample.energy}`,
        `世界观: ${sample.worldview}`,
        `启用: ${sample.enabled ? "是" : "否"}`,
        `关键词: ${sample.keywords.join(", ")}`,
        `用户: ${sample.user}`,
        `回复: ${sample.reply}`,
        `备注: ${sample.note}`,
      ].join("\n"),
    )
    .join(`\n\n${FEW_SHOT_TEXT_SEPARATOR}\n\n`);
}

function parseEnergy(raw: string): FewShotEnergyScope | null {
  const value = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (value === "" || value === "通用" || value === "any") return "any";
  const upper = value.toUpperCase();
  const parsed = fewShotEnergyScopeSchema.safeParse(upper);
  return parsed.success ? parsed.data : null;
}

function parseWorldview(raw: string): FewShotWorldview | null {
  const value = raw.trim().split(/\s+/)[0] ?? "";
  if (value === "" || value === "无" || value.toLowerCase() === "none") {
    return "none";
  }
  const parsed = fewShotWorldviewSchema.safeParse(value.toUpperCase());
  return parsed.success ? parsed.data : null;
}

function parseEnabled(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (value === "" || ["是", "y", "yes", "true", "1", "启用"].includes(value)) {
    return true;
  }
  if (["否", "n", "no", "false", "0", "停用"].includes(value)) return false;
  return null;
}

interface RawBlock {
  startLine: number;
  lines: { line: number; text: string }[];
}

function splitBlocks(text: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  let current: RawBlock = { startLine: 1, lines: [] };
  const lines = text.split(/\r?\n/);
  lines.forEach((text_, index) => {
    const lineNumber = index + 1;
    if (text_.trim() === FEW_SHOT_TEXT_SEPARATOR) {
      blocks.push(current);
      current = { startLine: lineNumber + 1, lines: [] };
      return;
    }
    current.lines.push({ line: lineNumber, text: text_ });
  });
  blocks.push(current);
  return blocks.filter((block) =>
    block.lines.some((entry) => entry.text.trim() !== ""),
  );
}

export function parseFewShotText(text: string): FewShotTextParseResult {
  const records: FewShotTextRecord[] = [];
  const issues: FewShotTextIssue[] = [];
  const seenIds = new Map<string, number>();

  for (const block of splitBlocks(text)) {
    const values = new Map<FieldKey, string>();
    const fieldLines = new Map<FieldKey, number>();
    let id: string | null = null;
    let currentKey: FieldKey | null = null;
    let sawContent = false;

    for (const { line, text: raw } of block.lines) {
      const trimmed = raw.trim();

      const idMatch = ID_LINE.exec(trimmed);
      if (idMatch && !sawContent) {
        const inner = idMatch[1]!.trim();
        id = BLANK_ID_WORDS.has(inner.toLowerCase()) ? null : inner;
        sawContent = true;
        continue;
      }

      const fieldMatch = FIELD_LINE.exec(trimmed);
      if (fieldMatch) {
        const key = fieldMatch[1] as FieldKey;
        if (values.has(key)) {
          issues.push({ line, message: `字段「${key}」重复，后一个会覆盖前一个` });
        }
        values.set(key, fieldMatch[2]!);
        fieldLines.set(key, line);
        currentKey = key;
        sawContent = true;
        continue;
      }

      if (trimmed === "") {
        // 空行只在字段值内部保留，值末尾的空行随后会被裁掉。
        if (currentKey) values.set(currentKey, `${values.get(currentKey)!}\n`);
        continue;
      }

      if (!currentKey) {
        issues.push({
          line,
          message: `这一行不属于任何字段：${trimmed.slice(0, 20)}`,
        });
        continue;
      }
      values.set(currentKey, `${values.get(currentKey)!}\n${raw}`);
      sawContent = true;
    }

    const lineOf = (key: FieldKey): number =>
      fieldLines.get(key) ?? block.startLine;
    const read = (key: FieldKey): string =>
      (values.get(key) ?? "").replace(/\s+$/, "");

    const scene = read("场景").trim();
    const user = read("用户");
    const reply = read("回复");
    const missing: string[] = [];
    if (!scene) missing.push("场景");
    if (!user) missing.push("用户");
    if (!reply) missing.push("回复");
    if (missing.length > 0) {
      issues.push({
        line: block.startLine,
        message: `缺少必填字段：${missing.join("、")}`,
      });
      continue;
    }

    const energy = parseEnergy(read("档位"));
    if (energy === null) {
      issues.push({
        line: lineOf("档位"),
        message: `档位只能是 any、E0、E1、E2、E3，当前是「${read("档位").trim()}」`,
      });
      continue;
    }
    const worldview = parseWorldview(read("世界观"));
    if (worldview === null) {
      issues.push({
        line: lineOf("世界观"),
        message: `世界观只能是 none、L1、L2，当前是「${read("世界观").trim()}」`,
      });
      continue;
    }
    const enabled = parseEnabled(read("启用"));
    if (enabled === null) {
      issues.push({
        line: lineOf("启用"),
        message: `启用只能填是或否，当前是「${read("启用").trim()}」`,
      });
      continue;
    }

    if (id !== null) {
      const previous = seenIds.get(id);
      if (previous !== undefined) {
        issues.push({
          line: block.startLine,
          message: `id ${id} 和第 ${previous} 行那条重复`,
        });
        continue;
      }
      seenIds.set(id, block.startLine);
    }

    records.push({
      id,
      scene,
      energy,
      worldview,
      enabled,
      keywords: read("关键词")
        .split(/[,，]/)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
      user,
      reply,
      note: read("备注"),
    });
  }

  return { records, issues };
}

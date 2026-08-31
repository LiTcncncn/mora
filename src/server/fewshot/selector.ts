import type { EnergyLevel } from "@/domain/common";
import type { FewShotSample, FewShotSelectionTrace } from "@/domain/fewshot";
import type { FewShotSettings } from "@/domain/settings";
import { tokenize } from "../memory/selector";

/** 场景标签权重高于关键词：它是人工标的，比自动分词更可信。 */
const SCENE_WEIGHT = 1.5;
const KEYWORD_WEIGHT = 1;
const USER_TEXT_WEIGHT = 0.5;
/**
 * 上面三项都是「占用户输入 token 数的比例」，输入越长单个关键词越不值钱：
 * 「我爸上个月走了，我到现在缓不过来」里命中「走了」只得 0.077 分。关键词是人工
 * 标的，整条原样出现在输入里就是强信号，与输入长度无关，这里单独给一份加分。
 */
const PHRASE_HIT_WEIGHT = 0.6;
/** 关键词列表长的样本不该只靠堆词取胜，加分封顶两条。 */
const MAX_SCORED_PHRASE_HITS = 2;

/**
 * 与记忆检索共用的 tokenize 同时产出单字和 bigram。短输入下单字权重过高：
 * 「我很难过」只因一个「过」字就能和「面试过了」拿到 0.5 分，把报喜的示例
 * 塞进难过的场景。这里丢掉单字，让中文重合必须落在两个连续的字上。
 */
function fewShotTokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(text)) {
    if (/^[a-z0-9]+$/.test(token) || [...token].length >= 2) tokens.add(token);
  }
  return tokens;
}

function overlapRatio(query: Set<string>, text: string): number {
  if (query.size === 0) return 0;
  const tokens = fewShotTokenize(text);
  if (tokens.size === 0) return 0;
  let overlap = 0;
  for (const token of query) {
    if (tokens.has(token)) overlap += 1;
  }
  return overlap / query.size;
}

const LEVEL_ORDER: readonly EnergyLevel[] = ["E0", "E1", "E2", "E3"];

/**
 * 样本标注的档位表示它的回复长度对应哪一档。精确匹配会把最贴切的样本挡在外面，
 * 所以允许跨一档，但只能向上：低档样本短，进到高档轮次会和「通常三到五句」的
 * 指令打架，而 few-shot 的示范力压得过抽象指令，模型会照着示例给两句。反过来
 * 高档样本进低档轮次只是偏长，能量策略里的字数上限会把它压回去。
 */
function energyApplicable(
  sample: FewShotSample,
  energyLevel: EnergyLevel,
): boolean {
  if (sample.energy === "any") return true;
  const sampleIndex = LEVEL_ORDER.indexOf(sample.energy);
  const currentIndex = LEVEL_ORDER.indexOf(energyLevel);
  const distance = sampleIndex - currentIndex;
  return distance >= 0 && distance <= 1;
}

function phraseHitScore(userMessage: string, sample: FewShotSample): number {
  const text = userMessage.toLowerCase();
  let hits = 0;
  for (const keyword of sample.keywords) {
    const phrase = keyword.trim().toLowerCase();
    // 单字关键词太容易撞，只认两个字以上的整条命中。
    if ([...phrase].length >= 2 && text.includes(phrase)) hits += 1;
  }
  return Math.min(hits, MAX_SCORED_PHRASE_HITS) * PHRASE_HIT_WEIGHT;
}

function scoreSample(
  query: Set<string>,
  userMessage: string,
  sample: FewShotSample,
): number {
  const scene = overlapRatio(query, sample.scene) * SCENE_WEIGHT;
  const keywords =
    sample.keywords.length > 0
      ? overlapRatio(query, sample.keywords.join(" ")) * KEYWORD_WEIGHT
      : 0;
  const userText = overlapRatio(query, sample.user) * USER_TEXT_WEIGHT;
  return scene + keywords + userText + phraseHitScore(userMessage, sample);
}

export interface FewShotSelectionResult {
  selected: FewShotSample[];
  trace: FewShotSelectionTrace[];
}

export function selectFewShotSamples(input: {
  samples: FewShotSample[];
  userMessage: string;
  energyLevel: EnergyLevel;
  settings: FewShotSettings;
}): FewShotSelectionResult {
  const { samples, userMessage, energyLevel, settings } = input;

  if (!settings.enabled) {
    return {
      selected: [],
      trace: samples.map((sample) => ({
        sampleId: sample.id,
        scene: sample.scene,
        worldview: sample.worldview,
        selected: false,
        score: 0,
        reason: "Few-shot 注入已在设置中关闭",
      })),
    };
  }

  const limit = settings.maxPerLevel[energyLevel];
  const query = fewShotTokenize(userMessage);

  const scored = samples.map((sample) => {
    const score = scoreSample(query, userMessage, sample);
    let ineligibleReason: string | null = null;
    if (!sample.enabled) ineligibleReason = "该样本已停用";
    else if (!energyApplicable(sample, energyLevel)) {
      ineligibleReason = `标注为 ${sample.energy} 档，回复长度不适合当前 ${energyLevel}`;
    } else if (score < settings.minScore) {
      ineligibleReason = `相关度 ${score.toFixed(3)} 低于阈值 ${settings.minScore}`;
    }
    return { sample, score, ineligibleReason };
  });

  const eligible = scored
    .filter((entry) => entry.ineligibleReason === null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // 同分时优先正好标注为当前档位的样本，再按 id 保证结果稳定。
      const aExact = a.sample.energy === energyLevel ? 1 : 0;
      const bExact = b.sample.energy === energyLevel ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return a.sample.id.localeCompare(b.sample.id);
    });

  const selected: FewShotSample[] = [];
  const selectionReason = new Map<string, string>();
  let usedChars = 0;
  let worldviewUsed = 0;

  for (const entry of eligible) {
    const { sample } = entry;
    if (selected.length >= limit) {
      selectionReason.set(
        sample.id,
        `超出 ${energyLevel} 档注入条数上限 ${limit}`,
      );
      continue;
    }
    const isWorldview = sample.worldview !== "none";
    if (isWorldview && worldviewUsed >= settings.maxWorldviewPerTurn) {
      selectionReason.set(
        sample.id,
        `本轮带世界观的示例已达上限 ${settings.maxWorldviewPerTurn}`,
      );
      continue;
    }
    const length = [...sample.user].length + [...sample.reply].length;
    if (usedChars + length > settings.maxChars) {
      selectionReason.set(
        sample.id,
        `超出字符预算 maxChars=${settings.maxChars}`,
      );
      continue;
    }

    usedChars += length;
    if (isWorldview) worldviewUsed += 1;
    selected.push(sample);
    selectionReason.set(sample.id, `入选，相关度 ${entry.score.toFixed(3)}`);
  }

  const selectedIds = new Set(selected.map((sample) => sample.id));
  const trace: FewShotSelectionTrace[] = scored.map((entry) => ({
    sampleId: entry.sample.id,
    scene: entry.sample.scene,
    worldview: entry.sample.worldview,
    selected: selectedIds.has(entry.sample.id),
    score: entry.score,
    reason:
      entry.ineligibleReason ?? selectionReason.get(entry.sample.id) ?? "未入选",
  }));

  trace.sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.sampleId.localeCompare(b.sampleId);
  });

  return { selected, trace };
}

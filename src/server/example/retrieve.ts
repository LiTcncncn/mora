import type { ExampleRetrievalTrace } from "@/domain/behavior-trace";
import type { ExampleRetrievalSettings } from "@/domain/behavior-example";
import {
  isRetrievable,
  type BehaviorExampleCard,
} from "@/domain/behavior-example";
import type { EnergyLevel } from "@/domain/common";
import type { QuestionPreference, ResponseMode } from "@/domain/behavior-taxonomy";

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,，。！？!?、；;：:""''（）()【】\[\]]+/)
    .filter((token) => token.length >= 2);
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let hits = 0;
  for (const token of a) {
    if (setB.has(token)) hits += 1;
  }
  return hits / Math.max(a.length, b.length);
}

function scoreExample(
  card: BehaviorExampleCard,
  input: {
    userMessage: string;
    responseMode: ResponseMode;
    energy: EnergyLevel;
    questionPreference: QuestionPreference;
    majorEventMatched: boolean;
  },
  settings: ExampleRetrievalSettings,
): number {
  const weights = settings.weights;
  const modeScore = card.responseMode === input.responseMode ? 1 : 0;
  const energyScore = card.energyRange.includes(input.energy) ? 1 : 0;
  const questionScore = card.questionPreferences.includes(
    input.questionPreference,
  )
    ? 1
    : 0;
  const majorScore =
    !input.majorEventMatched || card.majorEventCompatible ? 1 : 0;
  const textScore = overlapScore(
    tokenize(input.userMessage),
    [...tokenize(card.user), ...card.topicTags.flatMap((tag) => tokenize(tag))],
  );

  return (
    modeScore * weights.responseMode +
    energyScore * weights.energy +
    questionScore * weights.questionPreference +
    majorScore * weights.majorEvent +
    textScore * weights.textRelevance
  );
}

function hardFilterReason(
  card: BehaviorExampleCard,
  input: {
    responseMode: ResponseMode;
    energy: EnergyLevel;
    questionPreference: QuestionPreference;
    majorEventMatched: boolean;
  },
): string | null {
  if (!isRetrievable(card)) return "未 approved 或未启用";
  if (card.responseMode !== input.responseMode) return "responseMode 不匹配";
  if (!card.energyRange.includes(input.energy)) return "energy 不在范围内";
  if (!card.questionPreferences.includes(input.questionPreference)) {
    return "questionPreference 不匹配";
  }
  if (input.majorEventMatched && !card.majorEventCompatible) {
    return "重大事件不兼容";
  }
  return null;
}

/** §11.3 / §14 第 15 步：检索一张行为示例卡。 */
export function retrieveBehaviorExample(input: {
  cards: BehaviorExampleCard[];
  settings: ExampleRetrievalSettings;
  userMessage: string;
  responseMode: ResponseMode;
  energy: EnergyLevel;
  questionPreference: QuestionPreference;
  majorEventMatched: boolean;
}): { exampleId: string | null; trace: ExampleRetrievalTrace } {
  const { settings } = input;
  if (!settings.enabled) {
    return {
      exampleId: null,
      trace: {
        enabled: false,
        candidateCount: 0,
        selectedExampleId: null,
        selectedExampleName: null,
        topScore: null,
        minScore: settings.minScore,
        rejectReason: "检索已关闭",
        candidates: [],
      },
    };
  }

  const candidates = input.cards.map((card) => {
    const filterReason = hardFilterReason(card, input);
    const score = filterReason ? 0 : scoreExample(card, input, settings);
    return {
      id: card.id,
      name: card.name,
      score,
      filtered: filterReason !== null,
      filterReason,
    };
  });

  const viable = candidates
    .filter((entry) => !entry.filtered)
    .sort((left, right) => right.score - left.score);

  const top = viable[0];
  if (!top || top.score < settings.minScore) {
    return {
      exampleId: null,
      trace: {
        enabled: true,
        candidateCount: viable.length,
        selectedExampleId: null,
        selectedExampleName: null,
        topScore: top?.score ?? null,
        minScore: settings.minScore,
        rejectReason: top
          ? `最高分 ${top.score.toFixed(2)} 低于阈值 ${settings.minScore}`
          : "无通过硬过滤的候选",
        candidates: candidates.slice(0, 10),
      },
    };
  }

  return {
    exampleId: top.id,
    trace: {
      enabled: true,
      candidateCount: viable.length,
      selectedExampleId: top.id,
      selectedExampleName: top.name,
      topScore: top.score,
      minScore: settings.minScore,
      rejectReason: null,
      candidates: candidates.slice(0, 10),
    },
  };
}

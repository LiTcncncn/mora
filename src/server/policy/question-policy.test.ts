import { describe, expect, it } from "vitest";
import { buildDefaultQuestionPolicy } from "@/domain/question-policy";
import {
  compileMaxQuestions,
  HARD_MAX_QUESTIONS_PER_TURN,
  INVITE_QUESTION_MUST_DO,
  NEUTRAL_QUESTION_MUST_DO,
  resolveNeutralMaxQuestions,
} from "./question-policy";

const defaultPolicy = buildDefaultQuestionPolicy();

describe("compileMaxQuestions", () => {
  it("avoid → 0 问", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "avoid",
        questionPolicy: defaultPolicy,
        lastAssistantAskedQuestion: false,
      }),
    ).toBe(0);
  });

  it("invite → 1 问（不受 questionPolicy 影响）", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "invite",
        questionPolicy: {
          neutralMode: "never",
          neutralMustAskProbability: 0.5,
          suppressIfLastAssistantAsked: true,
        },
        lastAssistantAskedQuestion: true,
      }),
    ).toBe(HARD_MAX_QUESTIONS_PER_TURN);
  });

  it("neutral + must_ask → 1 问", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "neutral",
        questionPolicy: {
          neutralMode: "must_ask",
          neutralMustAskProbability: 0.5,
          suppressIfLastAssistantAsked: false,
        },
        lastAssistantAskedQuestion: false,
      }),
    ).toBe(HARD_MAX_QUESTIONS_PER_TURN);
  });

  it("neutral + never → 0 问", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "neutral",
        questionPolicy: {
          neutralMode: "never",
          neutralMustAskProbability: 0.5,
          suppressIfLastAssistantAsked: false,
        },
        lastAssistantAskedQuestion: false,
      }),
    ).toBe(0);
  });

  it("neutral + probabilistic + roll 命中 → 1 问", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "neutral",
        questionPolicy: defaultPolicy,
        lastAssistantAskedQuestion: false,
        roll: () => 0.2,
      }),
    ).toBe(HARD_MAX_QUESTIONS_PER_TURN);
  });

  it("neutral + probabilistic + roll 未命中 → 0 问", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "neutral",
        questionPolicy: defaultPolicy,
        lastAssistantAskedQuestion: false,
        roll: () => 0.8,
      }),
    ).toBe(0);
  });

  it("neutral + must_ask + 上轮已问 → 0 问（抑制）", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "neutral",
        questionPolicy: {
          neutralMode: "must_ask",
          neutralMustAskProbability: 0.5,
          suppressIfLastAssistantAsked: true,
        },
        lastAssistantAskedQuestion: true,
      }),
    ).toBe(0);
  });

  it("neutral + must_ask + 上轮已问但关闭抑制 → 1 问", () => {
    expect(
      compileMaxQuestions({
        questionPreference: "neutral",
        questionPolicy: {
          neutralMode: "must_ask",
          neutralMustAskProbability: 0.5,
          suppressIfLastAssistantAsked: false,
        },
        lastAssistantAskedQuestion: true,
      }),
    ).toBe(HARD_MAX_QUESTIONS_PER_TURN);
  });
});

describe("resolveNeutralMaxQuestions", () => {
  it("70% 概率 roll=0.6 命中必问", () => {
    expect(
      resolveNeutralMaxQuestions(
        {
          neutralMode: "probabilistic",
          neutralMustAskProbability: 0.7,
          suppressIfLastAssistantAsked: true,
        },
        () => 0.6,
      ),
    ).toBe(1);
  });

  it("70% 概率 roll=0.8 命中不许问", () => {
    expect(
      resolveNeutralMaxQuestions(
        {
          neutralMode: "probabilistic",
          neutralMustAskProbability: 0.7,
          suppressIfLastAssistantAsked: true,
        },
        () => 0.8,
      ),
    ).toBe(0);
  });
});

describe("question must-do copy", () => {
  it("invite 文案强调 Router invite 必须提问", () => {
    expect(INVITE_QUESTION_MUST_DO).toContain("invite");
    expect(INVITE_QUESTION_MUST_DO).toContain("必须");
  });

  it("neutral 文案强调必须提问", () => {
    expect(NEUTRAL_QUESTION_MUST_DO).toContain("neutral");
    expect(NEUTRAL_QUESTION_MUST_DO).toContain("必须");
  });
});

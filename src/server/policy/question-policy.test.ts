import { describe, expect, it } from "vitest";
import {
  compileMaxQuestions,
  HARD_MAX_QUESTIONS_PER_TURN,
  INVITE_QUESTION_MUST_DO,
} from "./question-policy";

const companionPolicy = {
  defaultMaxQuestions: 0,
  allowInviteOverride: true,
} as const;

const askLightPolicy = {
  defaultMaxQuestions: 1,
  allowInviteOverride: true,
} as const;

const closePolicy = {
  defaultMaxQuestions: 0,
  allowInviteOverride: false,
} as const;

describe("compileMaxQuestions", () => {
  it("avoid → 0 问", () => {
    expect(compileMaxQuestions("avoid", askLightPolicy)).toBe(0);
  });

  it("invite + allowInviteOverride → 1 问", () => {
    expect(compileMaxQuestions("invite", companionPolicy)).toBe(
      HARD_MAX_QUESTIONS_PER_TURN,
    );
  });

  it("invite 但策略禁止 override → 0 问", () => {
    expect(compileMaxQuestions("invite", closePolicy)).toBe(0);
  });

  it("neutral + COMPANION（defaultMaxQuestions=0）→ 0 问", () => {
    expect(compileMaxQuestions("neutral", companionPolicy)).toBe(0);
  });

  it("neutral + ASK_LIGHT（defaultMaxQuestions>0）→ 1 问", () => {
    expect(compileMaxQuestions("neutral", askLightPolicy)).toBe(
      HARD_MAX_QUESTIONS_PER_TURN,
    );
  });
});

describe("INVITE_QUESTION_MUST_DO", () => {
  it("文案强调 Router invite 必须提问", () => {
    expect(INVITE_QUESTION_MUST_DO).toContain("invite");
    expect(INVITE_QUESTION_MUST_DO).toContain("必须");
  });
});

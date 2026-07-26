import { describe, expect, it } from "vitest";
import { findBestApplicationAnswer } from "./answerMatcher";
import type { DetectedField, SavedAnswer } from "../shared/types";

function field(label: string, category: DetectedField["category"]): DetectedField {
  return {
    fieldId: "field-1",
    platform: "ashby",
    label,
    normalizedLabel: label.toLowerCase(),
    fieldType: "textarea",
    required: false,
    isVisible: true,
    isDisabled: false,
    selectorHint: "#field-1",
    category
  };
}

function answer(
  originalQuestion: string,
  category: SavedAnswer["category"],
  value = "At Zokyo I build customer-facing AI systems and own the path from scoping to production."
): SavedAnswer {
  return {
    id: crypto.randomUUID(),
    title: originalQuestion,
    category,
    originalQuestion,
    normalizedQuestion: originalQuestion.toLowerCase(),
    answer: value,
    tags: [],
    roleTypes: [],
    companiesUsedFor: [],
    source: "manual",
    timesUsed: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

describe("semantic application answer reuse", () => {
  it("reuses a curated answer for an equivalent about-me intent", () => {
    const result = findBestApplicationAnswer(
      field("Please introduce yourself", "about_me"),
      [answer("Tell us about yourself", "about_me")]
    );
    expect(result?.confidence).toBeGreaterThanOrEqual(0.86);
  });

  it("does not reuse company-specific answers across employers", () => {
    const result = findBestApplicationAnswer(
      field("Why do you want to join Acme?", "why_company"),
      [answer("Why do you want to join Example Corp?", "why_company")]
    );
    expect(result).toBeUndefined();
  });
});

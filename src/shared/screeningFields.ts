import { isProfileLinkField } from "./profileLinkFields";
import { EXPERIENCE_QUESTION_CATEGORIES, SCREENING_QUESTION_CATEGORIES } from "./constants";
import type { DetectedField, FieldCategory } from "./types";

/** Labels that should always auto-save / auto-fill even when classified as custom or manual. */
export const AUTO_SAVE_LABEL_PATTERNS: RegExp[] = [
  /\b(preferred )?pronouns?\b/i,
  /\b(gender identity|what is your gender)\b/i,
  /\b(sexual orientation)\b/i,
  /\b(race|ethnicity|ethnic background)\b/i,
  /\b(veteran|military service)\b/i,
  /\b(disability|disabled)\b/i,
  /\b(transgender)\b/i,
  /\b(voluntary self identification|self identification)\b/i
];

export function looksLikeApplicationQuestion(label: string): boolean {
  const normalized = label.toLowerCase();
  if (normalized.length < 8) return false;
  return (
    normalized.includes("?") ||
    /\b(why|what|how|when|where|which|who|describe|tell us|explain|share|list|provide|reason|looking for|experience|years of|please|motivation|interested|eligible|currently|anything else|additional|comments|great at|ideal role|strengths)\b/.test(
      normalized
    )
  );
}

const LABEL_TO_CATEGORY: Array<[FieldCategory, RegExp]> = [
  ["pronouns", /\b(preferred )?pronouns?\b/i],
  ["sexual_orientation", /\bsexual orientation\b/i],
  ["gender", /\b(gender identity|what is your gender)\b/i],
  ["race_ethnicity", /\b(race|ethnicity|ethnic background)\b/i],
  ["veteran_status", /\b(veteran|military service)\b/i],
  ["disability", /\b(disability|disabled)\b/i],
  ["transgender", /\b(transgender)\b/i],
  ["voluntary_disclosure", /\b(voluntary self identification|self identification)\b/i]
];

export function inferScreeningCategory(label: string): FieldCategory | undefined {
  for (const [category, pattern] of LABEL_TO_CATEGORY) {
    if (pattern.test(label)) return category;
  }
  return undefined;
}

export function isAutoSavableField(field: DetectedField): boolean {
  if (isProfileLinkField(field)) return false;
  if (field.category && SCREENING_QUESTION_CATEGORIES.includes(field.category)) return true;
  if (field.category && EXPERIENCE_QUESTION_CATEGORIES.includes(field.category)) return true;
  if (
    (field.fieldType === "textarea" ||
      field.fieldType === "text" ||
      field.fieldType === "number" ||
      field.fieldType === "unknown") &&
    looksLikeApplicationQuestion(field.label)
  ) {
    return true;
  }
  return AUTO_SAVE_LABEL_PATTERNS.some((pattern) => pattern.test(field.label));
}

export function withEffectiveCategory(field: DetectedField): DetectedField {
  if (field.category && !["manual_review", "custom_question", "screening_question"].includes(field.category)) {
    return field;
  }
  const inferred = inferScreeningCategory(field.label);
  if (!inferred) return field;
  return { ...field, category: inferred };
}

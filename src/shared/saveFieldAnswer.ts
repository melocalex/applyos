import { db } from "../db";
import { hasCloseAnswerMatch, hasExactSavedAnswer } from "../matching/answerMatcher";
import { normalizeText } from "../matching/normalize";
import { sanitizeSavedQuestion, shouldRemoveSavedAnswer } from "./answerBankQuestions";
import { isAutoSavableField } from "./screeningFields";
import { DEFAULT_SETTINGS, type DetectedField, type SavedAnswer } from "./types";
import { SAFE_PROFILE_CATEGORIES, SENSITIVE_CATEGORIES } from "./constants";

import { isUnsafeShortAnswer } from "./answerQuality";
import { isProfileLinkField } from "./profileLinkFields";

function answerCategory(category?: DetectedField["category"]): SavedAnswer["category"] {
  if (category === "work_authorization" || category === "legal_authorization") return "work_auth";
  if (category === "visa_sponsorship") return "visa_sponsorship";
  if (category === "salary") return "salary";
  if (category === "relocation") return "relocation";
  if (
    category &&
    ["why_company", "why_role", "about_me", "hard_problem", "leadership", "conflict", "portfolio"].includes(
      category
    )
  ) {
    return category as SavedAnswer["category"];
  }
  return "custom";
}

export async function saveFieldAnswer(
  field: DetectedField,
  value: string,
  company?: string,
  options?: { source?: SavedAnswer["source"] }
): Promise<"saved" | "updated" | "skipped"> {
  const settings = { ...DEFAULT_SETTINGS, ...(await db.settings.get("default")) };
  if (!settings.autoSaveNewAnswers) return "skipped";
  if (
    field.category &&
    SENSITIVE_CATEGORIES.includes(field.category) &&
    !settings.autoSaveSensitiveAnswers
  ) {
    return "skipped";
  }
  if (field.category && SAFE_PROFILE_CATEGORIES.includes(field.category)) return "skipped";
  if (isProfileLinkField(field)) return "skipped";
  if (!isAutoSavableField(field)) return "skipped";

  const trimmed = value.trim();
  if (!trimmed) return "skipped";
  if (isUnsafeShortAnswer(field, trimmed)) return "skipped";

  const question = sanitizeSavedQuestion(field.label);
  if (shouldRemoveSavedAnswer(question, trimmed)) return "skipped";

  // Keep the read-check-write atomic so repeated DOM events cannot create
  // duplicate answer-bank rows.
  return db.transaction("rw", db.savedAnswers, async () => {
    const existing = await db.savedAnswers.toArray();
    const normalizedQuestion = normalizeText(question);

    if (hasExactSavedAnswer(existing, question, trimmed)) return "skipped";

    const sameQuestion = existing.find((answer) => answer.normalizedQuestion === normalizedQuestion);
    const timestamp = new Date().toISOString();

    if (sameQuestion) {
      if (sameQuestion.answer.trim().toLowerCase() === trimmed.toLowerCase()) return "skipped";
      // Raw page captures must not overwrite curated answers. (tags may be
      // missing on rows imported from external JSON — treat those as curated.)
      if (!(sameQuestion.tags ?? []).includes("auto_saved")) return "skipped";
      await db.savedAnswers.put({
        ...sameQuestion,
        answer: trimmed,
        updatedAt: timestamp
      });
      return "updated";
    }

    if (hasCloseAnswerMatch(field, existing, 0.9)) return "skipped";

    await db.savedAnswers.put({
      id: crypto.randomUUID(),
      title: question.slice(0, 80),
      category: answerCategory(field.category),
      originalQuestion: question,
      normalizedQuestion,
      answer: trimmed,
      tags: ["auto_saved", ...(field.category ? [field.category] : [])],
      roleTypes: [],
      companiesUsedFor: company ? [company] : [],
      source: options?.source ?? "manual",
      timesUsed: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    return "saved";
  });
}

/** @deprecated Use saveFieldAnswer */
export const saveScreeningFieldAnswer = saveFieldAnswer;

import {
  findBestApplicationAnswer,
  findBestScreeningAnswer,
  findAnswerMatches
} from "../matching/answerMatcher";
import { isUnsafeShortAnswer } from "../shared/answerQuality";
import { isApplicationQuestionField } from "../shared/applicationFields";
import { isProfileLinkField, labelRequestsProfileLink } from "../shared/profileLinkFields";
import { SCREENING_QUESTION_CATEGORIES, DOCUMENT_CATEGORIES, SAFE_PROFILE_CATEGORIES } from "../shared/constants";
import { withEffectiveCategory } from "../shared/screeningFields";
import type { AnswerSuggestion, DetectedField, SavedAnswer, UserProfile } from "../shared/types";
import { insertFieldsBatch, insertIntoField, profileValueForField, sendToActiveTab } from "./lib";

export interface AutoInsertResult {
  inserted: number;
  skipped: number;
  failures: Array<{ label: string; error: string }>;
}

const SKIP_CATEGORIES = new Set<string>([...DOCUMENT_CATEGORIES, "manual_review"]);

const FAST_WIDGETS = new Set(["default", "location_text"]);

function needsForceReinsert(platform?: string): boolean {
  return platform === "ashby" || platform === "gem";
}

function isSlowInsertField(field: DetectedField): boolean {
  if (field.widget && !FAST_WIDGETS.has(field.widget)) return true;
  if (field.fieldType === "radio" || field.fieldType === "select") return true;
  if (field.category === "country" || field.category === "state") return true;
  return false;
}

function isFastProfileField(field: DetectedField): boolean {
  if (field.isDisabled || !field.isVisible || field.fieldType === "file") return false;
  if (isSlowInsertField(field)) return false;
  return Boolean(field.category && SAFE_PROFILE_CATEGORIES.includes(field.category));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sortFieldsForInsert(fields: DetectedField[]): DetectedField[] {
  function depth(field: DetectedField): number {
    if (!field.dependsOn?.length) return 0;
    return (
      1 +
      Math.max(
        ...field.dependsOn.map((category) => {
          const parent = fields.find((candidate) => candidate.category === category);
          return parent ? depth(parent) : 0;
        })
      )
    );
  }

  return [...fields].sort((left, right) => depth(left) - depth(right));
}

function shouldAutoInsertField(field: DetectedField): boolean {
  if (field.isDisabled || !field.isVisible) return false;
  if (field.fieldType === "file") return false;
  if (field.category && SKIP_CATEGORIES.has(field.category)) return false;
  return true;
}

function normalizeOption(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Strips filler adverbs and normalizes apostrophes so the negation patterns
 * below match phrasings like "do not currently require" or "don’t need".
 */
function normalizeAssertionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\b(currently|presently|ever|at this time|at the moment|now or in the future|in the future)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// No "g" flag: global regexes are stateful with .test(). The reduce below
// builds fresh global copies for clause removal. The lazy [^.;]*? keeps each
// match to one clause, so "do not require X, but will require Y" doesn't get
// swallowed whole and hide the positive second clause.
const NEGATED_NEED_PATTERNS = [
  /\b(do(es)? not|don't|will not|won't|would not|wouldn't|shall not|no longer|never|not)\s+(require|need)\b[^.;]*?sponsor\w*/,
  /\b(require|need)s?\s+no\s+(visa\s+|employer\s+)?sponsorship\b/,
  /\bno\s+(visa\s+|employer\s+)?sponsorship\s+(is\s+)?(required|needed)\b/
];

/** Whether the answer says the person needs sponsorship: true/false, or undefined if it doesn't say. */
function answerNeedsSponsorship(answer: string): boolean | undefined {
  const text = normalizeAssertionText(answer);

  // "without sponsorship" asserts no need only when it isn't itself negated
  // ("I cannot work without sponsorship" means the opposite).
  const withoutSponsorship =
    /\bwithout\s+(the\s+need\s+for\s+|needing\s+)?(visa\s+|employer\s+)?sponsorship\b/.test(text) &&
    !/\b(cannot|can't|unable|not able|not eligible|not authorized|not allowed)\b[^.;]*\bwithout\b/.test(text);

  const negated = withoutSponsorship || NEGATED_NEED_PATTERNS.some((pattern) => pattern.test(text));
  // Test the positive assertion on the text with negated clauses removed, so
  // "I do not require sponsorship" doesn't also count as a positive, while
  // "I do not require sponsorship now, but will later" still does.
  const remainder = NEGATED_NEED_PATTERNS.reduce(
    (acc, pattern) => acc.replace(new RegExp(pattern.source, "g"), " "),
    text
  );
  const positive =
    /\b(require|requires|need|needs)\b(?!\s+no\b)[^.;]*sponsor/.test(remainder) ||
    /\bsponsorship\s+(is\s+)?(required|needed)\b/.test(remainder) ||
    // "cannot work without sponsorship" asserts the need positively.
    /\b(cannot|can't|unable|not able|not eligible|not authorized|not allowed)\b[^.;]*\bwithout\b[^.;]*sponsor/.test(text);

  // Contradictory assertions: refuse to guess.
  if (negated && positive) return undefined;
  if (negated) return false;
  if (positive) return true;
  return undefined;
}

/** Whether the answer says the person is authorized/eligible to work: true/false, or undefined. */
function answerIsAuthorized(answer: string): boolean | undefined {
  const text = normalizeAssertionText(answer);
  if (/\b(not|no longer|am not|i'm not|isn't|is not|aren't)\s+(legally\s+|fully\s+)?(authorized|eligible)\b/.test(text)) {
    return false;
  }
  if (
    /\b(am|are|is|i'm|fully|legally)\s+(legally\s+|fully\s+)?authorized\b/.test(text) ||
    /^authorized\b/.test(text) ||
    /\beligible to work\b/.test(text) ||
    /\bright to work\b/.test(text)
  ) {
    return true;
  }
  return undefined;
}

export function normalizeYesNoAnswer(value: string, options?: string[], questionLabel = ""): string {
  if (!options?.length) return value;
  // Prefix matching is only safe when there is exactly one yes-variant and one
  // no-variant; Workday-style selects offer several "Yes, ..." options and
  // snapping to the first would pick an arbitrary one.
  const yesOptions = options.filter((option) => /^yes\b/i.test(option.trim()));
  const noOptions = options.filter((option) => /^no\b/i.test(option.trim()));
  const yesOption =
    yesOptions.length === 1 ? yesOptions[0] : yesOptions.find((option) => /^yes$/i.test(option.trim()));
  const noOption =
    noOptions.length === 1 ? noOptions[0] : noOptions.find((option) => /^no$/i.test(option.trim()));
  if (!yesOption || !noOption) return value;

  const answer = value.trim().toLowerCase();
  const question = questionLabel.trim().toLowerCase();

  // Sponsorship and authorization questions: map from what the answer asserts,
  // honoring the question's polarity. A saved answer may have been written for
  // the opposite phrasing ("are you authorized...?" vs "do you require...?"),
  // so its leading yes/no cannot be trusted here.
  const needs = answerNeedsSponsorship(answer);
  const authorized = answerIsAuthorized(answer);
  const asksWithoutSponsorship = /\bwithout\b[^?]*sponsor/.test(question);
  const asksSponsorship = /sponsor/.test(question) && !asksWithoutSponsorship;
  const asksAuthorization = /\b(authorized|authorization|eligible|legally|right to work)\b/.test(question);

  if (asksSponsorship) {
    if (needs === true) return yesOption;
    if (needs === false) return noOption;
  } else if (asksWithoutSponsorship) {
    // A sponsorship need outranks an authorization claim here: "authorized via
    // OPT but will require sponsorship" answers "No" to "authorized WITHOUT
    // sponsorship?" even though both facts are asserted.
    if (needs === true) return noOption;
    if (needs === false) return yesOption;
    if (authorized === true) return yesOption;
    if (authorized === false) return noOption;
  } else if (asksAuthorization) {
    if (authorized === true) return yesOption;
    if (authorized === false) return noOption;
    if (needs === false) return yesOption;
    if (needs === true) return noOption;
  }

  const normalizedAnswer = normalizeAssertionText(answer);
  if (/^(yes|y|true)\b/.test(normalizedAnswer)) return yesOption;
  if (/^(no|n|false)\b/.test(normalizedAnswer)) return noOption;
  // Polarity-blind shortcut — unsafe for sponsorship/authorization questions,
  // where the fact-based branches above already declined to answer.
  if (
    !asksSponsorship &&
    !asksWithoutSponsorship &&
    !asksAuthorization &&
    /\b(cannot|can't|unable)\b/.test(normalizedAnswer)
  ) {
    return noOption;
  }
  return value;
}

export function formatAnswerForField(field: DetectedField, value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "NO_FIT") return trimmed;

  if (field.options?.length && (field.fieldType === "radio" || field.fieldType === "select")) {
    const normalized = normalizeYesNoAnswer(trimmed, field.options, field.label);
    if (normalized !== trimmed) return normalized;
  }

  if (field.fieldType === "number" || /\bhow many\b/i.test(field.label)) {
    const match = trimmed.match(/\b(\d{1,3})\b/);
    if (match) return match[1];
  }

  return trimmed;
}

function valueMatchesFieldOptions(field: DetectedField, value: string): boolean {
  if (!field.options?.length) return true;
  const formatted = formatAnswerForField(field, value);
  if (field.fieldType !== "radio" && field.fieldType !== "select") return true;
  const normalized = normalizeOption(formatted);
  return field.options.some((option) => {
    const candidate = normalizeOption(option);
    if (candidate === normalized) return true;
    if (normalized.length > 12 && candidate.length > 12) {
      return candidate.includes(normalized) || normalized.includes(candidate);
    }
    return false;
  });
}

async function fieldIsEmpty(field: DetectedField): Promise<boolean> {
  if (isFastProfileField(field) && !field.value?.trim()) return true;

  const result = await sendToActiveTab<{ ok: boolean; value?: string }>({
    type: "GET_FIELD_VALUE",
    fieldId: field.fieldId,
    selectorHint: field.selectorHint,
    frameId: field.frameId
  });
  const value = result.value?.trim() ?? "";
  if (!value) return true;
  if (needsForceReinsert(field.platform)) return true;
  return false;
}

function resolveInsertValue(
  field: DetectedField,
  userProfile: UserProfile | undefined,
  savedAnswers: SavedAnswer[],
  suggestions: Record<string, AnswerSuggestion> | undefined,
  answerBankMinConfidence: number
): { value: string; savedAnswerId?: string } | undefined {
  const resolvedField = withEffectiveCategory(field);
  const suggestion = suggestions?.[field.fieldId];
  if (suggestion?.answer && suggestion.answer !== "NO_FIT" && !suggestion.requiresEditBeforeInsert) {
    return { value: formatAnswerForField(field, suggestion.answer) };
  }

  const profileValue = profileValueForField(resolvedField, userProfile);
  if (profileValue && !isUnsafeShortAnswer(resolvedField, profileValue)) {
    return { value: formatAnswerForField(field, profileValue) };
  }

  if (isProfileLinkField(resolvedField) || labelRequestsProfileLink(resolvedField.label, resolvedField.fieldType)) {
    return undefined;
  }

  if (isApplicationQuestionField(resolvedField)) {
    const reusable = findBestApplicationAnswer(resolvedField, savedAnswers);
    if (reusable) {
      return {
        value: formatAnswerForField(field, reusable.answer.answer),
        savedAnswerId: reusable.answer.id
      };
    }
    return undefined;
  }

  const isScreeningField =
    Boolean(resolvedField.category && SCREENING_QUESTION_CATEGORIES.includes(resolvedField.category)) ||
    resolvedField.fieldType === "radio" ||
    resolvedField.fieldType === "select";

  if (isScreeningField) {
    const screeningMatch = findBestScreeningAnswer(resolvedField, savedAnswers, 0.72);
    if (screeningMatch && !isUnsafeShortAnswer(resolvedField, screeningMatch.answer.answer)) {
      return {
        value: formatAnswerForField(field, screeningMatch.answer.answer),
        savedAnswerId: screeningMatch.answer.id
      };
    }
  }

  if (resolvedField.category && SAFE_PROFILE_CATEGORIES.includes(resolvedField.category)) {
    return undefined;
  }

  const matches = findAnswerMatches(resolvedField, savedAnswers, 1);
  const best = matches[0];
  if (
    best &&
    best.confidence >= answerBankMinConfidence &&
    !isUnsafeShortAnswer(resolvedField, best.answer.answer)
  ) {
    return { value: formatAnswerForField(field, best.answer.answer), savedAnswerId: best.answer.id };
  }

  return undefined;
}

export async function autoInsertFields(
  fields: DetectedField[],
  options: {
    userProfile?: UserProfile;
    savedAnswers: SavedAnswer[];
    suggestions?: Record<string, AnswerSuggestion>;
    answerBankMinConfidence?: number;
    skipIfFilled?: boolean;
    onSavedAnswerUsed?: (savedAnswerId: string) => Promise<void>;
  }
): Promise<AutoInsertResult> {
  const minConfidence = options.answerBankMinConfidence ?? 0.82;
  const result: AutoInsertResult = { inserted: 0, skipped: 0, failures: [] };

  const fastBatch: Array<{ field: DetectedField; value: string; savedAnswerId?: string }> = [];
  const slowFields: Array<{ field: DetectedField; value: string; savedAnswerId?: string }> = [];

  for (const field of sortFieldsForInsert(fields)) {
    if (!shouldAutoInsertField(field)) {
      result.skipped += 1;
      continue;
    }

    if (options.skipIfFilled !== false && !isFastProfileField(field)) {
      try {
        if (!(await fieldIsEmpty(field))) {
          result.skipped += 1;
          continue;
        }
      } catch {
        result.skipped += 1;
        continue;
      }
    }

    const resolved = resolveInsertValue(
      field,
      options.userProfile,
      options.savedAnswers,
      options.suggestions,
      minConfidence
    );
    if (!resolved?.value.trim() || isUnsafeShortAnswer(field, resolved.value)) {
      result.skipped += 1;
      continue;
    }
    if (!valueMatchesFieldOptions(field, resolved.value)) {
      result.skipped += 1;
      continue;
    }

    if (options.skipIfFilled !== false && isFastProfileField(field) && field.value?.trim()) {
      result.skipped += 1;
      continue;
    }

    const entry = { field, value: resolved.value, savedAnswerId: resolved.savedAnswerId };
    if (isFastProfileField(field)) {
      fastBatch.push(entry);
    } else {
      slowFields.push(entry);
    }
  }

  if (fastBatch.length) {
    try {
      const batchResults = await insertFieldsBatch(
        fastBatch.map(({ field, value }) => ({ field, value }))
      );
      const resultById = new Map(batchResults.map((item) => [item.fieldId, item]));
      for (const entry of fastBatch) {
        const batchResult = resultById.get(entry.field.fieldId);
        if (batchResult?.ok) {
          result.inserted += 1;
          if (entry.savedAnswerId && options.onSavedAnswerUsed) {
            await options.onSavedAnswerUsed(entry.savedAnswerId);
          }
        } else if (batchResult) {
          result.failures.push({
            label: entry.field.label,
            error: batchResult.error || "Insertion failed."
          });
        } else {
          result.failures.push({ label: entry.field.label, error: "Insertion failed." });
        }
      }
    } catch (error) {
      for (const entry of fastBatch) {
        result.failures.push({
          label: entry.field.label,
          error: error instanceof Error ? error.message : "Batch insertion failed."
        });
      }
    }
  }

  for (const entry of slowFields) {
    const { field, value, savedAnswerId } = entry;
    if (options.skipIfFilled !== false) {
      try {
        if (!(await fieldIsEmpty(field))) {
          result.skipped += 1;
          continue;
        }
      } catch {
        result.skipped += 1;
        continue;
      }
    }

    try {
      const insertResult = await insertIntoField(field, value);
      if (!insertResult.ok) {
        result.failures.push({ label: field.label, error: insertResult.error || "Insertion failed." });
        continue;
      }
      result.inserted += 1;
      if (savedAnswerId && options.onSavedAnswerUsed) {
        await options.onSavedAnswerUsed(savedAnswerId);
      }
      if (field.category === "country" || field.category === "state") {
        await delay(350);
      } else if (
        field.widget === "location_autocomplete" ||
        field.widget === "country_dropdown" ||
        field.widget === "combobox"
      ) {
        await delay(500);
      } else if (field.fieldType === "radio" && field.options?.some((option) => /^yes$/i.test(option))) {
        await delay(250);
      }
    } catch (error) {
      result.failures.push({
        label: field.label,
        error: error instanceof Error ? error.message : "Insertion failed."
      });
    }
  }

  return result;
}

export function autoInsertSummary(result: AutoInsertResult): string | undefined {
  if (!result.inserted && !result.failures.length) return undefined;
  const parts: string[] = [];
  if (result.inserted) {
    parts.push(`Auto-inserted ${result.inserted} field${result.inserted === 1 ? "" : "s"}`);
  }
  if (result.failures.length) {
    parts.push(`${result.failures.length} could not be filled`);
  }
  return parts.join(" · ");
}

export async function findUnfilledSuggestedFields(
  fields: DetectedField[],
  suggestions: Record<string, AnswerSuggestion>
): Promise<DetectedField[]> {
  const unfilled: DetectedField[] = [];

  for (const field of fields) {
    const suggestion = suggestions[field.fieldId];
    if (!suggestion?.answer || suggestion.answer === "NO_FIT") continue;
    // Flagged suggestions are intentionally not auto-inserted; don't report
    // them as fill failures or retry them with skipIfFilled disabled.
    if (suggestion.requiresEditBeforeInsert) continue;

    try {
      if (await fieldIsEmpty(field)) unfilled.push(field);
    } catch {
      unfilled.push(field);
    }
  }

  return unfilled;
}

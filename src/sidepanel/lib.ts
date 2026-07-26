import { profileValueForFieldWithWidget } from "../shared/profileFieldValue";
import type {
  ContentMessage,
  DetectedField,
  InsertResult,
  UserProfile
} from "../shared/types";
import { isAiRequestAborted } from "../ai/aiRequest";

export async function sendToActiveTab<T>(message: ContentMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage({
    type: "APPLYOS_RELAY_TO_TAB",
    payload: message
  })) as T | { error?: string };

  if (response && typeof response === "object" && "error" in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}

export async function sendToTab<T>(tabId: number, message: ContentMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage({
    type: "APPLYOS_RELAY_TO_TAB",
    payload: message,
    tabId
  })) as T | { error?: string };

  if (response && typeof response === "object" && "error" in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}

export async function ensureAllTabsConnected(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: "APPLYOS_ENSURE_ALL_TABS" })) as {
    ok?: boolean;
    error?: string;
  };
  if (response?.error) throw new Error(response.error);
}

export function profileValueForField(
  field: DetectedField,
  profile?: UserProfile
): string | undefined {
  return profileValueForFieldWithWidget(field, profile);
}

export async function insertIntoField(field: DetectedField, value: string): Promise<InsertResult> {
  return sendToActiveTab<InsertResult>({
    type: "INSERT_FIELD",
    fieldId: field.fieldId,
    selectorHint: field.selectorHint,
    value,
    frameId: field.frameId,
    widget: field.widget
  });
}

export async function focusField(field: DetectedField): Promise<InsertResult> {
  return sendToActiveTab<InsertResult>({
    type: "FOCUS_FIELD",
    fieldId: field.fieldId,
    selectorHint: field.selectorHint,
    frameId: field.frameId
  });
}

export async function insertFieldsBatch(
  items: Array<{ field: DetectedField; value: string }>
): Promise<Array<{ fieldId: string; ok: boolean; error?: string }>> {
  if (!items.length) return [];

  const byFrame = new Map<number | undefined, Array<{ field: DetectedField; value: string }>>();
  for (const item of items) {
    const frameId = item.field.frameId;
    const group = byFrame.get(frameId) ?? [];
    group.push(item);
    byFrame.set(frameId, group);
  }

  const allResults: Array<{ fieldId: string; ok: boolean; error?: string }> = [];
  for (const [frameId, group] of byFrame) {
    const response = await sendToActiveTab<{
      ok: boolean;
      results?: Array<{ fieldId: string; ok: boolean; error?: string }>;
      error?: string;
    }>({
      type: "INSERT_FIELDS_BATCH",
      frameId,
      fields: group.map(({ field, value }) => ({
        fieldId: field.fieldId,
        selectorHint: field.selectorHint,
        value,
        frameId: field.frameId,
        widget: field.widget,
        category: field.category,
        fieldType: field.fieldType
      }))
    });
    allResults.push(...(response.results ?? []));
  }
  return allResults;
}

export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), "application/json");
}

export function downloadText(filename: string, data: string, type = "text/plain"): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readJsonFile(file: File): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await file.text()) as Record<string, unknown>;
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
}

export function getErrorMessage(error: unknown): string {
  if (isAiRequestAborted(error)) return "AI request cancelled.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function recommendationLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

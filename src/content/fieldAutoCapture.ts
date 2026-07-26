import { isAutoSavableField, withEffectiveCategory } from "../shared/screeningFields";
import type { DetectedField } from "../shared/types";
import {
  isComboboxInput,
  isComboboxOptionElement,
  isIncompleteLocationValue,
  isVisibleComboboxOption,
  readComboboxDisplayValue,
  shouldDeferComboboxCapture
} from "./combobox";
import {
  elementBelongsToChoiceField,
  isChoiceCaptureTarget,
  resolveChoiceGroupRoot
} from "./choiceGroups";
import { extractDetectedFields, readFieldValue } from "./fieldDetection";

let platform = "generic";
let company: string | undefined;
let debounceTimer: number | undefined;
let pendingElement: HTMLElement | undefined;
const lastCaptured = new Map<string, string>();

const TEXT_DEBOUNCE_MS = 700;
const COMBOBOX_DEBOUNCE_MS = 1200;

export function startFieldAutoCapture(currentPlatform: string, currentCompany?: string): () => void {
  platform = currentPlatform;
  company = currentCompany?.trim() || undefined;
  const handler = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!isCaptureTarget(target, event.type)) return;

    if (event.type === "input" && isComboboxInput(target)) {
      return;
    }

    // Moving to a different element must not cancel the previous element's
    // pending capture — flush it now so answers typed at normal tabbing speed
    // still get saved.
    if (pendingElement && pendingElement !== target) {
      window.clearTimeout(debounceTimer);
      const flushElement = pendingElement;
      pendingElement = undefined;
      captureFromElement(flushElement);
    }

    window.clearTimeout(debounceTimer);
    const delay =
      event.type === "blur" && isComboboxInput(target)
        ? 500
        : isComboboxInput(target) || isComboboxOptionElement(target)
          ? COMBOBOX_DEBOUNCE_MS
          : TEXT_DEBOUNCE_MS;
    pendingElement = target;
    debounceTimer = window.setTimeout(() => {
      pendingElement = undefined;
      captureFromElement(target);
    }, delay);
  };

  document.addEventListener("change", handler, true);
  document.addEventListener("input", handler, true);
  document.addEventListener("blur", handler, true);
  document.addEventListener("click", handler, true);
  return () => {
    document.removeEventListener("change", handler, true);
    document.removeEventListener("input", handler, true);
    document.removeEventListener("blur", handler, true);
    document.removeEventListener("click", handler, true);
    window.clearTimeout(debounceTimer);
    pendingElement = undefined;
  };
}

function isCaptureTarget(element: HTMLElement, eventType: string): boolean {
  if (isChoiceCaptureTarget(element)) return true;
  if (isVisibleComboboxOption(element)) return eventType === "click";
  if (isComboboxInput(element)) return eventType !== "input";
  if (element instanceof HTMLInputElement) {
    return !["hidden", "password", "submit", "button", "reset", "file"].includes(element.type);
  }
  if (element.getAttribute("role") === "option" || element.getAttribute("role") === "listbox") {
    return eventType === "click";
  }
  return element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable;
}

function captureFromElement(element: HTMLElement): void {
  const fields = extractDetectedFields(platform);
  const field = fields.find((candidate) => elementMatchesField(element, candidate));
  if (!field || !isAutoSavableField(field)) return;

  const savableField = withEffectiveCategory(field);

  const target =
    resolveChoiceGroupRoot(element) ||
    document.querySelector<HTMLElement>(`[data-applyos-field-id="${CSS.escape(field.fieldId)}"]`) ||
    element;

  let value = readFieldValue(target);
  if (isComboboxInput(element) || isComboboxOptionElement(element)) {
    const display = readComboboxDisplayValue(element);
    if (display) value = display;
  }

  if (!value.trim()) return;
  if (shouldDeferComboboxCapture(element, savableField.label, value)) return;
  if (isIncompleteLocationValue(savableField.label, value)) return;

  const captureKey = `${savableField.normalizedLabel}:${value}`;
  if (lastCaptured.get(savableField.fieldId) === captureKey) return;
  lastCaptured.set(savableField.fieldId, captureKey);

  chrome.runtime
    .sendMessage({
      type: "APPLYOS_FIELD_ANSWERED",
      field: savableField,
      value,
      company
    })
    .catch(() => {
      // Side panel may be closed.
    });
}

function elementMatchesField(element: HTMLElement, field: DetectedField): boolean {
  if (
    field.selectorHint.includes("data-field-path") ||
    field.selectorHint.includes("data-automation-id") ||
    field.selectorHint.startsWith("#")
  ) {
    try {
      const entry = document.querySelector<HTMLElement>(field.selectorHint);
      if (entry && (entry === element || entry.contains(element))) return true;
    } catch {
      // Ignore invalid selector hints.
    }
  }

  if (elementBelongsToChoiceField(element, field)) return true;
  if (element.dataset.applyosFieldId === field.fieldId) return true;
  if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
    const groupId = document.querySelector<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(element.name)}"]`
    )?.dataset.applyosFieldId;
    return groupId === field.fieldId;
  }
  return false;
}

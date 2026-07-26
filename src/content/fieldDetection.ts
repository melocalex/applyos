import {
  extractQuestionLabel,
  extractStackedFieldLabel,
  findFieldContainer,
  findNearbyHeading,
  hashString,
  isManagedChoiceInput,
  resolveFieldContainerFromHint,
  FIELD_CONTAINER_SELECTORS,
  findNativeRadioGroupScope,
  extractRadioGroupQuestionLabel
} from "./formSemantics";
import { dedupeDetectedFields } from "../shared/dedupeFields";
import { ashbySystemFieldCategory } from "../shared/ashbyFields";
import type { DetectedField, FieldCategory, FieldType, InsertResult } from "../shared/types";
import type { FieldWidget } from "../shared/profileFieldValue";
import { normalizeText, optionMatches, optionMatchesCountry, uniqueStrings } from "./text";
import { isElementVisible } from "./pageContext";
import { classifyField } from "./fieldClassifier";
import {
  extractButtonChoiceGroups,
  insertChoiceGroupValue,
  insertNativeRadioGroupValue,
  readChoiceGroupValue,
  resolveChoiceGroupRoot
} from "./choiceGroups";
import { isComboboxInput, readComboboxDisplayValue } from "./combobox";
import { elementNeedsComboboxInsert, insertComboboxValue } from "./comboboxInsert";
import {
  insertPhoneFieldValue,
  isCompositePhoneInput,
  isPhoneWidgetChrome,
  readPhoneFieldValue
} from "./phoneInput";
import {
  extractLinkedInEasyApplyFields,
  findLinkedInEasyApplyRoot
} from "./linkedinForm";
import { setControlledInputValue, readCommittedInputValue } from "./controlledInput";
import { setControlledInputValueInPageWorld } from "./pageWorldInput";
import { isReactControlledFormHost } from "../shared/reactFormHosts";
import { resolveFieldWidget } from "./fieldWidgets";

const FIELD_SELECTOR =
  "textarea, input[type='text'], input[type='email'], input[type='url'], input[type='tel'], input[type='number'], input[type='date'], input[type='datetime-local'], input[type='month'], input[type='week'], input[type='time'], input[type='search'], input[type='checkbox'], input[type='radio'], input[type='file'], input:not([type]), select, [contenteditable='true']";

const knownFieldIds = new Set<string>();
let dependencyParents: FieldCategory[] = [];

function clearCollidingApplyosFieldIds(root: ParentNode): void {
  const seen = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>("[data-applyos-field-id]").forEach((element) => {
    const id = element.dataset.applyosFieldId;
    if (!id) return;
    const previous = seen.get(id);
    if (previous) {
      delete previous.dataset.applyosFieldId;
      delete element.dataset.applyosFieldId;
      return;
    }
    seen.set(id, element);
  });
}

export function extractDetectedFields(platform: string, scopeRoot?: ParentNode | null): DetectedField[] {
  const root = scopeRoot ?? document;
  if (/jobs\.gem\.com/i.test(window.location.hostname) || platform === "gem") {
    clearCollidingApplyosFieldIds(root);
  }
  const linkedInRoot = !scopeRoot && /linkedin\.com/i.test(window.location.hostname)
    ? findLinkedInEasyApplyRoot()
    : null;
  const queryRoot = linkedInRoot ?? root;

  // Run the LinkedIn-specific pass FIRST so it tags each native control with its
  // `applyos-li-*` id before the generic loop sees them. The generic loop then
  // reuses those ids (via getOrCreateFieldId), so dedupeDetectedFields collapses
  // the two passes instead of emitting every Easy Apply field twice.
  const linkedInFields = linkedInRoot ? extractLinkedInEasyApplyFields(platform) : [];

  const fields = Array.from(queryRoot.querySelectorAll<HTMLElement>(FIELD_SELECTOR));
  const seen = new Set<string>();
  const processedRadioGroups = new Set<string>();
  const result: DetectedField[] = [];

  for (const element of fields) {
    if (shouldIgnoreField(element)) continue;

    if (element instanceof HTMLInputElement && element.type === "radio") {
      const groupKey = getRadioGroupKey(element);
      if (!groupKey || processedRadioGroups.has(groupKey)) continue;
      processedRadioGroups.add(groupKey);
    }

    const fieldId = getOrCreateFieldId(element);
    const selectorHint = createSelectorHint(element, fieldId);
    const label =
      element instanceof HTMLInputElement && element.type === "radio"
        ? extractRadioGroupLabel(element)
        : extractFieldLabel(element);
    const fieldType = getFieldType(element);
    const normalizedLabel = normalizeText(label);
    const category = ashbySystemFieldCategory(element) ?? classifyField(label, fieldType);
    const widget = resolveFieldWidget(element, label || "");
    const duplicateKey =
      element instanceof HTMLInputElement && element.type === "radio"
        ? `radio:${getRadioGroupKey(element) || element.name || fieldId}`
        : `${selectorHint}:${fieldId}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);

    const isDynamic = knownFieldIds.size > 0 && !knownFieldIds.has(fieldId);
    const dependsOn = inferDependencies(category, isDynamic);
    result.push({
      fieldId,
      platform,
      label: label || "Unlabeled field",
      normalizedLabel,
      fieldType,
      options: extractOptions(element, queryRoot),
      required: isRequired(element),
      value: getFieldValue(element),
      isVisible: isElementVisible(element),
      isDisabled: isDisabled(element),
      selectorHint,
      category,
      widget,
      dependsOn,
      isDynamic
    });
    knownFieldIds.add(fieldId);
  }

  extractButtonChoiceGroups(platform, seen, result, queryRoot);
  result.forEach((field) => knownFieldIds.add(field.fieldId));

  if (linkedInRoot) {
    return dedupeDetectedFields([...linkedInFields, ...result]);
  }

  return dedupeDetectedFields(result);
}

export function attachDependencyListeners(): () => void {
  const handler = (event: Event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) return;
    const category = classifyField(extractFieldLabel(select), "select");
    if (category === "country") dependencyParents = ["country"];
    else if (category === "state") {
      dependencyParents = uniqueStrings([...dependencyParents, "state"]) as FieldCategory[];
    } else dependencyParents = [category];
  };
  document.addEventListener("change", handler, true);
  return () => document.removeEventListener("change", handler, true);
}

function inferDependencies(category: FieldCategory, isDynamic: boolean): string[] | undefined {
  if (!isDynamic) return undefined;
  if (category === "state" && dependencyParents.includes("country")) return ["country"];
  if (category === "city") {
    const dependencies = ["country", "state"].filter((item) =>
      dependencyParents.includes(item as FieldCategory)
    );
    return dependencies.length ? dependencies : undefined;
  }
  return dependencyParents.length ? dependencyParents : undefined;
}

function shouldIgnoreField(element: HTMLElement): boolean {
  if (isPhoneWidgetChrome(element)) return true;
  if (isManagedChoiceInput(element)) return true;

  if (element instanceof HTMLInputElement && element.type === "radio") {
    if (!isRadioFieldAccessible(element)) return true;
  } else if (!isElementVisible(element)) {
    return true;
  }
  if (element.getAttribute("aria-hidden") === "true") return true;
  if (element instanceof HTMLInputElement && ["hidden", "password", "submit", "button", "reset"].includes(element.type)) {
    return true;
  }
  const rect = element.getBoundingClientRect();
  const label = extractFieldLabel(element);
  return rect.width < 3 || rect.height < 3 || (!label && rect.left < -500);
}

function isRadioFieldAccessible(radio: HTMLInputElement): boolean {
  if (isElementVisible(radio)) return true;
  if (radio.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(radio.id)}"]`);
    if (label && isElementVisible(label)) return true;
  }
  const parentLabel = radio.closest("label");
  if (parentLabel && isElementVisible(parentLabel)) return true;
  const group = radio.closest('[role="radiogroup"], fieldset, [class*="question"], [class*="field"]');
  if (group instanceof HTMLElement && isElementVisible(group)) {
    const rect = group.getBoundingClientRect();
    return rect.width > 20 && rect.height > 20;
  }
  return false;
}

function buildAnonymousFieldIdentity(element: HTMLElement): string {
  const label = extractStackedFieldLabel(element) || extractFieldLabel(element);
  return [
    element.tagName,
    element.getAttribute("type") || "",
    String(domIndex(element)),
    hashString(normalizeText(label).slice(0, 200) || `idx-${domIndex(element)}`)
  ].join("|");
}

function getOrCreateFieldId(element: HTMLElement): string {
  if (element instanceof HTMLInputElement && element.type === "radio") {
    if (element.dataset.applyosFieldId && (element.name || element.dataset.applyosRadioGroup)) {
      return element.dataset.applyosFieldId;
    }
    const groupKey = element.name || getRadioGroupKey(element);
    if (groupKey) {
      const selector = element.name
        ? `input[type="radio"][name="${CSS.escape(element.name)}"][data-applyos-field-id]`
        : `input[type="radio"][data-applyos-radio-group="${CSS.escape(groupKey)}"][data-applyos-field-id]`;
      const existing = document.querySelector<HTMLInputElement>(selector);
      if (existing?.dataset.applyosFieldId) return existing.dataset.applyosFieldId;
      const fieldId = element.name
        ? `applyos-radio-${hashString(element.name)}`
        : `applyos-radio-${hashString(groupKey)}`;
      const scope = element.name
        ? document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(element.name)}"]`)
        : findNativeRadioGroupScope(element)?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ??
          [element];
      scope.forEach((radio) => {
        radio.dataset.applyosFieldId = fieldId;
        if (!element.name) radio.dataset.applyosRadioGroup = groupKey;
      });
      return fieldId;
    }
  }

  const existing = element.dataset.applyosFieldId;
  if (existing) {
    const tagged = document.querySelectorAll<HTMLElement>(`[data-applyos-field-id="${CSS.escape(existing)}"]`);
    if (tagged.length === 1 && tagged[0] === element) return existing;
    delete element.dataset.applyosFieldId;
  }

  const hasStableIdentity = Boolean(element.id || element.getAttribute("name"));
  const base = hasStableIdentity
    ? [
        element.tagName,
        element.getAttribute("type"),
        element.id,
        element.getAttribute("name"),
        element.getAttribute("aria-label"),
        element.getAttribute("placeholder")
      ]
        .filter(Boolean)
        .join("|")
    : buildAnonymousFieldIdentity(element);

  const fieldId = `applyos-${hashString(base)}`;
  element.dataset.applyosFieldId = fieldId;
  return fieldId;
}

function domIndex(element: Element): number {
  return Array.from(document.querySelectorAll(FIELD_SELECTOR)).indexOf(element);
}

function createSelectorHint(element: HTMLElement, fieldId: string): string {
  const container = findFieldContainer(element);
  if (container) {
    const fieldPath = container.getAttribute("data-field-path");
    if (fieldPath) return `[data-field-path="${CSS.escape(fieldPath)}"]`;
    const automationId = container.getAttribute("data-automation-id");
    if (automationId) return `[data-automation-id="${CSS.escape(automationId)}"]`;
  }
  if (element.id) return `#${CSS.escape(element.id)}`;
  const name = element.getAttribute("name");
  if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  return `[data-applyos-field-id="${fieldId}"]`;
}

function getRadioGroupKey(radio: HTMLInputElement): string {
  if (radio.name) return radio.name;
  // A previously tagged group keeps its key: hashing outerHTML again would
  // produce a new key because tagging itself mutates the markup.
  const tagged = radio.dataset.applyosRadioGroup;
  if (tagged) return tagged;
  const scope = findNativeRadioGroupScope(radio);
  if (scope) {
    const ids = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .map((item) => item.id || stableRadioIdentity(item))
      .sort()
      .join("|");
    return `unnamed:${hashString(ids)}`;
  }
  return radio.id ? `unnamed:${radio.id}` : "";
}

function stableRadioIdentity(radio: HTMLInputElement): string {
  const clone = radio.cloneNode(false) as HTMLInputElement;
  delete clone.dataset.applyosFieldId;
  delete clone.dataset.applyosRadioGroup;
  return clone.outerHTML;
}

function extractRadioGroupLabel(radio: HTMLInputElement): string {
  const gemLabel = extractRadioGroupQuestionLabel(radio);
  if (gemLabel.length >= 8) return gemLabel;

  const container = findFieldContainer(radio) ?? radio.closest("fieldset, [role='radiogroup'], [role='group']");
  if (container instanceof HTMLElement) {
    const label = extractQuestionLabel(container, radio);
    if (label.length > 8) return label;
  }

  return extractFieldLabel(radio);
}

function extractFieldLabel(element: HTMLElement): string {
  const container = findFieldContainer(element);
  if (container) {
    const label = extractQuestionLabel(container, element);
    if (label) return label;
  }

  const candidates: string[] = [];
  if (element.id) {
    const explicit = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`);
    if (explicit?.innerText) candidates.push(explicit.innerText);
  }
  const parentLabel = element.closest("label");
  if (parentLabel?.innerText) candidates.push(parentLabel.innerText);
  candidates.push(
    element.getAttribute("aria-label") || "",
    element.getAttribute("placeholder") || "",
    element.getAttribute("name") || ""
  );

  const heading = findNearbyHeading(element);
  if (heading) candidates.push(heading);
  return uniqueStrings(candidates)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function getFieldType(element: HTMLElement): FieldType {
  if (isComboboxInput(element)) return "select";
  if (element instanceof HTMLTextAreaElement) return "textarea";
  if (element instanceof HTMLSelectElement) return "select";
  if (element.isContentEditable) return "textarea";
  if (element instanceof HTMLInputElement) {
    const type = element.type || "text";
    if (
      [
        "email",
        "url",
        "tel",
        "number",
        "date",
        "datetime-local",
        "month",
        "week",
        "time",
        "search",
        "checkbox",
        "radio",
        "file"
      ].includes(type)
    ) {
      return type as FieldType;
    }
    return "text";
  }
  return "unknown";
}

function extractOptions(element: HTMLElement, scopeRoot: ParentNode = document): string[] | undefined {
  if (element instanceof HTMLSelectElement) {
    return uniqueStrings(
      Array.from(element.options)
        .map((option) => option.textContent?.trim() || option.value)
        .filter(Boolean)
    );
  }
  if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
    return uniqueStrings(
      Array.from(
        scopeRoot.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(element.name)}"]`)
      )
        .map((radio) => getRadioOptionLabel(radio) || radio.value)
        .filter(Boolean)
    );
  }
  return undefined;
}

function isRequired(element: HTMLElement): boolean {
  return (
    element.hasAttribute("required") ||
    element.getAttribute("aria-required") === "true" ||
    /\*/.test(extractFieldLabel(element))
  );
}

function isDisabled(element: HTMLElement): boolean {
  return (
    element.getAttribute("aria-disabled") === "true" ||
    (element instanceof HTMLInputElement && element.disabled) ||
    (element instanceof HTMLTextAreaElement && element.disabled) ||
    (element instanceof HTMLSelectElement && element.disabled)
  );
}

function getFieldValue(element: HTMLElement): string {
  return readFieldValue(element);
}

export function readFieldValue(element: HTMLElement | null): string {
  if (!element) return "";

  const choiceValue = readChoiceGroupValue(element);
  if (choiceValue) return choiceValue;
  if (resolveChoiceGroupRoot(element)) return "";

  if (element instanceof HTMLInputElement && element.type === "radio" && element.name) {
    const selected = document.querySelector<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(element.name)}"]:checked`
    );
    if (!selected) return "";
    return getRadioOptionLabel(selected) || selected.value;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") return element.checked ? getRadioOptionLabel(element) || element.value || "Yes" : "";
    if (element.type === "file") return "";
    if (isComboboxInput(element)) {
      const display = readComboboxDisplayValue(element);
      if (display) return display;
    }
    if (isCompositePhoneInput(element)) return readPhoneFieldValue(element);
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    if (element instanceof HTMLSelectElement && element.selectedOptions[0]) {
      return element.selectedOptions[0].textContent?.trim() || element.value;
    }
    return element.value;
  }
  if (element.isContentEditable) return element.innerText;
  return "";
}

function getRadioOptionLabel(input: HTMLInputElement): string {
  if (input.id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(input.id)}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  const parentLabel = input.closest("label");
  if (parentLabel?.textContent?.trim()) {
    return parentLabel.textContent.replace(/\s+/g, " ").trim();
  }
  return input.getAttribute("aria-label") || "";
}

export function findField(fieldId: string, selectorHint: string): HTMLElement | null {
  let target: HTMLElement | null = null;

  if (!selectorHint.includes("data-applyos-field-id")) {
    target = resolveFieldContainerFromHint(selectorHint);
  }

  if (!target) {
    const hinted = safeQuery(selectorHint);
    target = hinted ? findFieldContainer(hinted) ?? hinted : null;
  }

  if (!target) {
    const nodes = document.querySelectorAll<HTMLElement>(`[data-applyos-field-id="${CSS.escape(fieldId)}"]`);
    for (const node of nodes) {
      try {
        if (node.matches(FIELD_CONTAINER_SELECTORS)) {
          target = node;
          break;
        }
      } catch {
        // Ignore invalid selector matches.
      }
    }
    if (!target) {
      for (const node of nodes) {
        if (node.dataset.applyosChoiceGroup) {
          target = node;
          break;
        }
      }
    }
    if (!target) {
      for (const node of nodes) {
        if (node instanceof HTMLInputElement && node.type === "radio") {
          target = node.closest<HTMLElement>("fieldset, [role='radiogroup'], [role='group']");
          if (target) break;
        }
      }
    }
    if (!target && nodes.length) target = nodes[0] ?? null;
  }

  return target ? resolveInsertTarget(target) : null;
}

function resolveInsertTarget(element: HTMLElement): HTMLElement {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    element.isContentEditable
  ) {
    return element;
  }

  const input = element.querySelector<HTMLElement>(
    'textarea, select, input:not([type="hidden"]):not([type="submit"]):not([type="button"]), [contenteditable="true"]'
  );
  if (input && isElementVisible(input)) return input;
  return element;
}

function safeQuery(selector: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
}

export function insertFieldValue(
  fieldId: string,
  selectorHint: string,
  value: string,
  widgetHint?: FieldWidget
): InsertResult {
  return insertFieldValueSync(fieldId, selectorHint, value, widgetHint);
}

export async function insertFieldValueAsync(
  fieldId: string,
  selectorHint: string,
  value: string,
  widgetHint?: FieldWidget
): Promise<InsertResult> {
  const element = findField(fieldId, selectorHint);
  if (!element) return { ok: false, error: "The field could not be found. Rescan the page and try again." };
  if (isDisabled(element)) return { ok: false, error: "This field is disabled and needs manual review." };
  if (element instanceof HTMLInputElement && element.type === "file") {
    return { ok: false, error: "File uploads require manual user action." };
  }

  const choiceResult = insertChoiceGroupValue(element, value);
  if (choiceResult) return choiceResult;

  const nativeRadioResult = insertNativeRadioGroupValue(element, value);
  if (nativeRadioResult) return nativeRadioResult;

  if (element instanceof HTMLInputElement && element.type === "radio") {
    return { ok: false, error: `No confident radio option match for "${value}".` };
  }

  if (element instanceof HTMLInputElement && isCompositePhoneInput(element)) {
    return insertPhoneFieldValue(element, value);
  }

  const widget =
    widgetHint ??
    (element instanceof HTMLElement ? resolveFieldWidget(element, extractFieldLabel(element)) : "default");

  if (element instanceof HTMLInputElement && elementNeedsComboboxInsert(element)) {
    return insertComboboxValue(element, value, widget);
  }

  const insertTarget =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
      ? element
      : resolveInsertTarget(element);

  if (insertTarget instanceof HTMLInputElement || insertTarget instanceof HTMLTextAreaElement) {
    const syncResult = insertFieldValueSync(fieldId, selectorHint, value, widget);
    if (syncResult.ok) {
      const committed = readCommittedInputValue(insertTarget);
      if (committed.trim() === value.trim()) {
        return syncResult;
      }
    }
  }

  if (
    (insertTarget instanceof HTMLInputElement || insertTarget instanceof HTMLTextAreaElement) &&
    isReactControlledFormHost(undefined, window.location.hostname)
  ) {
    try {
      await setControlledInputValueInPageWorld(insertTarget, value);
      return { ok: true };
    } catch {
      // Fall back to isolated-world insert.
    }
  }

  return insertFieldValueSync(fieldId, selectorHint, value, widget);
}

function needsDelayAfterInsert(item: {
  widget?: FieldWidget;
  category?: string;
  fieldType?: string;
}): boolean {
  if (item.category === "country" || item.category === "state") return true;
  if (item.widget === "location_autocomplete" || item.widget === "country_dropdown" || item.widget === "combobox") {
    return true;
  }
  if (item.fieldType === "radio" || item.fieldType === "select") return true;
  return false;
}

export async function insertFieldsBatchAsync(
  items: Array<{
    fieldId: string;
    selectorHint: string;
    value: string;
    widget?: FieldWidget;
    category?: string;
    fieldType?: string;
  }>
): Promise<Array<{ fieldId: string; ok: boolean; error?: string }>> {
  const results: Array<{ fieldId: string; ok: boolean; error?: string }> = [];
  for (const item of items) {
    const result = await insertFieldValueAsync(
      item.fieldId,
      item.selectorHint,
      item.value,
      item.widget
    );
    results.push({ fieldId: item.fieldId, ok: result.ok, error: result.error });
    if (result.ok && needsDelayAfterInsert(item)) {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    }
  }
  return results;
}

function insertFieldValueSync(
  fieldId: string,
  selectorHint: string,
  value: string,
  _widgetHint?: FieldWidget
): InsertResult {
  const element = findField(fieldId, selectorHint);
  if (!element) return { ok: false, error: "The field could not be found. Rescan the page and try again." };
  if (isDisabled(element)) return { ok: false, error: "This field is disabled and needs manual review." };
  if (element instanceof HTMLInputElement && element.type === "file") {
    return { ok: false, error: "File uploads require manual user action." };
  }

  const choiceResult = insertChoiceGroupValue(element, value);
  if (choiceResult) return choiceResult;

  const nativeRadioResult = insertNativeRadioGroupValue(element, value);
  if (nativeRadioResult) return nativeRadioResult;

  if (element instanceof HTMLInputElement && element.type === "radio") {
    return { ok: false, error: `No confident radio option match for "${value}".` };
  }

  if (element instanceof HTMLInputElement && isCompositePhoneInput(element)) {
    return insertPhoneFieldValue(element, value);
  }

  element.focus();
  if (element instanceof HTMLSelectElement) {
    const option = findSelectOption(element, value, _widgetHint);
    if (!option) return { ok: false, error: `No confident dropdown option match for "${value}".` };
    setNativeValue(element, option.value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  } else if (element instanceof HTMLInputElement && element.type === "checkbox") {
    const shouldCheck = /^(true|yes|1|checked)$/i.test(value);
    if (element.checked !== shouldCheck) element.click();
    return { ok: true };
  } else if (element.isContentEditable) {
    element.innerText = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setControlledInputValue(element, value);
    return { ok: true };
  } else {
    return { ok: false, error: "This field type is not supported for insertion." };
  }

  return { ok: true };
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string
): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLSelectElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
}

function findSelectOption(
  select: HTMLSelectElement,
  value: string,
  widget?: FieldWidget
): HTMLOptionElement | undefined {
  const options = Array.from(select.options);
  const matches = widget === "country_dropdown" ? optionMatchesCountry : optionMatches;
  return (
    options.find((option) => option.value === value || option.textContent?.trim() === value) ||
    options.find(
      (option) =>
        option.value.toLowerCase() === value.toLowerCase() ||
        option.textContent?.trim().toLowerCase() === value.toLowerCase()
    ) ||
    options.find(
      (option) => matches(option.value, value) || matches(option.textContent?.trim() || "", value)
    )
  );
}

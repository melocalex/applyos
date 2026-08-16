import type { FieldWidget } from "../shared/profileFieldValue";
import type { InsertResult } from "../shared/types";
import { setControlledInputValue } from "./controlledInput";
import { optionMatches, optionMatchesCountry, optionMatchesLocation } from "./text";
import {
  findComboboxRoot,
  isComboboxInput,
  readComboboxDisplayValue
} from "./combobox";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setNativeInputValue(element: HTMLInputElement, value: string): void {
  setControlledInputValue(element, value);
}

/**
 * The clickable react-select control that toggles the menu. The input usually
 * IS the combobox root (role="combobox"), so findComboboxRoot/closest returns
 * the input itself — but react-select attaches its open handler to the
 * `.select__control` wrapper, so a mousedown on the input alone never opens the
 * menu. Prefer the control wrapper, fall back to the generic root, then self.
 */
function comboboxControl(element: HTMLInputElement): HTMLElement {
  return (
    element.closest<HTMLElement>('[class*="select__control"]') ??
    findComboboxRoot(element) ??
    element
  );
}

function openCombobox(element: HTMLInputElement): void {
  element.focus();
  const control = comboboxControl(element);
  const toggle = control.querySelector<HTMLButtonElement>(
    'button[aria-label*="flyout" i], button[aria-label*="Toggle" i], button[aria-label*="toggle" i]'
  );
  toggle?.click();
  // react-select opens on the control's mousedown (primary button), not on the
  // inner input. Fire the full press sequence so its handler runs.
  for (const type of ["pointerdown", "mousedown", "mouseup"] as const) {
    control.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 })
    );
  }
}

/**
 * React-select mounts its menu a tick after the opening mousedown. Poll for
 * THIS combobox's options (scoped via aria-controls) so the caller neither
 * misses them nor grabs a stale listbox from another widget.
 */
async function waitForComboboxOptions(
  element: HTMLInputElement,
  timeoutMs = 700
): Promise<HTMLElement[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const options = collectListboxOptions(resolveActiveListbox(element));
    if (options.length) return options;
    await sleep(75);
  }
  return collectListboxOptions(resolveActiveListbox(element));
}

/**
 * Resolve the listbox that belongs to THIS combobox. React-select and ARIA
 * comboboxes link the input to their menu via aria-controls/aria-owns, which
 * holds even when the menu is portaled to <body>. Returns null when no link can
 * be established (the caller then has to fall back to a document-wide scan).
 */
function resolveActiveListbox(element: HTMLInputElement): HTMLElement | null {
  const root = findComboboxRoot(element) ?? element;
  const combobox =
    root instanceof HTMLElement && root.matches('[role="combobox"]')
      ? root
      : root.querySelector<HTMLElement>('[role="combobox"]');
  for (const owner of [element, combobox]) {
    const id = owner?.getAttribute("aria-controls") || owner?.getAttribute("aria-owns");
    const target = id ? document.getElementById(id) : null;
    if (target) {
      return target.matches('[role="listbox"]')
        ? target
        : target.querySelector<HTMLElement>('[role="listbox"]') ?? target;
    }
  }
  // Menus rendered inside the combobox root (not portaled).
  return root instanceof HTMLElement ? root.querySelector<HTMLElement>('[role="listbox"]') : null;
}

function collectListboxOptions(scope?: HTMLElement | null): HTMLElement[] {
  const container: ParentNode = scope ?? document;
  const options = [
    ...container.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'),
    ...container.querySelectorAll<HTMLElement>('[role="option"]')
  ];
  const seen = new Set<HTMLElement>();
  return options.filter((option) => {
    if (seen.has(option)) return false;
    seen.add(option);
    const text = option.textContent?.replace(/\s+/g, " ").trim();
    return Boolean(text && text.length > 1);
  });
}

function optionMatcherForWidget(widget: FieldWidget | undefined) {
  if (widget === "country_dropdown") return optionMatchesCountry;
  if (widget === "location_autocomplete") return optionMatchesLocation;
  return optionMatches;
}

function findMatchingOption(
  options: HTMLElement[],
  value: string,
  widget: FieldWidget | undefined
): HTMLElement | undefined {
  const match = optionMatcherForWidget(widget);
  return options.find((option) => match(option.textContent?.replace(/\s+/g, " ").trim() || "", value));
}

function clickOption(option: HTMLElement): void {
  const label = option.querySelector<HTMLElement>("label");
  (label ?? option).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  (label ?? option).click();
}

function pickTypeaheadSeed(value: string, widget: FieldWidget | undefined): string {
  const trimmed = value.trim();
  if (widget === "location_autocomplete") {
    const city = trimmed.split(",")[0]?.trim();
    return city && city.length >= 3 ? city : trimmed;
  }
  return trimmed;
}

function looksLikeProfileUrl(value: string): boolean {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) || /\.\w{2,}\//.test(trimmed) || /linkedin\.com|github\.com/i.test(trimmed);
}

export async function insertComboboxValue(
  element: HTMLInputElement,
  value: string,
  widget: FieldWidget = "combobox"
): Promise<InsertResult> {
  if (!value.trim()) return { ok: false, error: "Value is empty." };

  openCombobox(element);

  // Click-to-select first (no typing): react-select renders its menu a tick
  // after the open mousedown, so wait for THIS combobox's options before
  // matching. This is the whole flow for short enum selects (Yes/No) and any
  // non-searchable control where typing a seed does nothing.
  const opened = await waitForComboboxOptions(element);
  const earlyTarget = findMatchingOption(opened, value, widget);
  if (earlyTarget) {
    clickOption(earlyTarget);
    await sleep(150);
    if (readComboboxDisplayValue(element)) return { ok: true };
  }

  const seed = pickTypeaheadSeed(value, widget);
  setNativeInputValue(element, seed);
  await sleep(650);

  let options = collectListboxOptions(resolveActiveListbox(element));
  let target = findMatchingOption(options, value, widget);
  if (!target && widget === "location_autocomplete") {
    target = findMatchingOption(options, seed, widget);
  }
  if (!target && options.length === 1 && !looksLikeProfileUrl(value)) {
    target = options[0];
  }

  if (!target) {
    return { ok: false, error: `No dropdown option matched "${value}". Pick the option manually once — ApplyOS can save it.` };
  }

  clickOption(target);
  await sleep(200);

  const display = readComboboxDisplayValue(element);
  const stuck = element.value.trim() || display;
  if (!stuck) {
    return { ok: false, error: "Combobox value did not stick after selecting an option." };
  }

  return { ok: true };
}

export function elementNeedsComboboxInsert(element: HTMLElement): boolean {
  return isComboboxInput(element);
}

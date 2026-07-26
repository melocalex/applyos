import type { InsertResult } from "../shared/types";
import { parsePhoneNumber, type ParsedPhone } from "../shared/phoneFormat";
import { optionMatches, optionMatchesCountry } from "./text";
import { setControlledInputValue } from "./controlledInput";
import { setControlledInputValueInPageWorld } from "./pageWorldInput";

const PHONE_INPUT_SELECTOR =
  'input[type="tel"], input[autocomplete^="tel" i], input[name*="phone" i]';
const COUNTRY_CONTROL_SELECTOR = [
  'input[role="combobox"]',
  'input[aria-autocomplete="list"]',
  "select",
  'button[aria-haspopup="listbox"]',
  'button[aria-label*="country" i]'
].join(",");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function findPhoneGroup(element: HTMLElement): HTMLElement | null {
  const known = element.closest<HTMLElement>("fieldset.phone-input, .phone-input, .iti");
  if (known) return known;

  let current: HTMLElement | null = element.parentElement;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (["FORM", "MAIN", "BODY"].includes(current.tagName)) break;
    const phoneInputs = current.querySelectorAll<HTMLInputElement>(PHONE_INPUT_SELECTOR);
    const countryControls = current.querySelectorAll<HTMLElement>(COUNTRY_CONTROL_SELECTOR);
    if (
      phoneInputs.length === 1 &&
      [...countryControls].some(looksLikeCountryControl)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function findPhoneInput(root: ParentNode): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>(PHONE_INPUT_SELECTOR);
}

interface PhoneInputLocator {
  id?: string;
  name?: string;
  autocomplete?: string;
  fieldPath?: string;
}

function capturePhoneInputLocator(element: HTMLInputElement): PhoneInputLocator {
  return {
    id: element.id || undefined,
    name: element.name || undefined,
    autocomplete: element.autocomplete || undefined,
    fieldPath:
      element.closest<HTMLElement>("[data-field-path]")?.dataset.fieldPath ||
      undefined
  };
}

function findLivePhoneInput(locator: PhoneInputLocator): HTMLInputElement | null {
  if (locator.id) {
    const byId = document.getElementById(locator.id);
    if (byId instanceof HTMLInputElement && byId.matches(PHONE_INPUT_SELECTOR)) {
      return byId;
    }
  }

  if (locator.fieldPath) {
    const fieldRoot = [...document.querySelectorAll<HTMLElement>("[data-field-path]")]
      .find((candidate) => candidate.dataset.fieldPath === locator.fieldPath);
    const input = fieldRoot ? findPhoneInput(fieldRoot) : null;
    if (input) return input;
  }

  const candidates = [...document.querySelectorAll<HTMLInputElement>(PHONE_INPUT_SELECTOR)];
  if (locator.name) {
    const byName = candidates.find((candidate) => candidate.name === locator.name);
    if (byName) return byName;
  }
  if (locator.autocomplete) {
    const byAutocomplete = candidates.find(
      (candidate) => candidate.autocomplete === locator.autocomplete
    );
    if (byAutocomplete) return byAutocomplete;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function findCountryControl(root: ParentNode): HTMLElement | null {
  const controls = [...root.querySelectorAll<HTMLElement>(COUNTRY_CONTROL_SELECTOR)];
  return (
    controls.find(looksLikeCountryControl) ??
    controls.find((control) => !(control instanceof HTMLInputElement && control.matches(PHONE_INPUT_SELECTOR))) ??
    null
  );
}

function looksLikeCountryControl(control: HTMLElement): boolean {
  const descriptor = [
    control.getAttribute("aria-label"),
    control.getAttribute("placeholder"),
    control.getAttribute("name"),
    control.id,
    control.closest("label")?.textContent,
    control.parentElement?.textContent
  ]
    .filter(Boolean)
    .join(" ");
  return /\bcountry\b/i.test(descriptor);
}

export function isCompositePhoneInput(element: HTMLElement): boolean {
  return (
    element instanceof HTMLInputElement &&
    (element.classList.contains("iti__tel-input") ||
      Boolean(element.closest("fieldset.phone-input, .phone-input, .iti")) ||
      Boolean(findPhoneGroup(element)))
  );
}

export function isPhoneWidgetChrome(element: HTMLElement): boolean {
  if (
    element.closest(".phone-input__country, .iti__dropdown-content, .iti__country-list") ||
    element.classList.contains("iti__search-input") ||
    (element.id === "country" && element.closest(".phone-input"))
  ) {
    return true;
  }

  const group = findPhoneGroup(element);
  if (!group) return false;
  const phoneInput = findPhoneInput(group);
  if (element === phoneInput || element.contains(phoneInput)) return false;
  return Boolean(element.matches(COUNTRY_CONTROL_SELECTOR) || element.closest(COUNTRY_CONTROL_SELECTOR));
}

function dialCodesFromOptions(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')]
    .map((option) => option.textContent?.match(/\+(\d{1,4})\s*$/)?.[1])
    .filter((value): value is string => Boolean(value));
}

function reparsedPhone(raw: string, countryHint?: string): ParsedPhone {
  const parsed = parsePhoneNumber(raw, countryHint);
  if (parsed.dialCode) return parsed;
  const digits = raw.replace(/[^\d+]/g, "").replace(/^\+/, "");
  const split = dialCodesFromOptions()
    .sort((left, right) => right.length - left.length)
    .find((code) => digits.startsWith(code) && digits.length > code.length + 4);
  if (split) {
    return {
      dialCode: split,
      national: digits.slice(split.length),
      countryName: parsed.countryName,
      e164: `+${split}${digits.slice(split.length)}`
    };
  }
  return parsed;
}

function openReactSelect(combobox: HTMLInputElement): void {
  combobox.focus();
  const toggle = combobox
    .closest(".select-shell, .select")
    ?.querySelector<HTMLButtonElement>('button[aria-label*="flyout" i], button[aria-label*="Toggle" i]');
  toggle?.click();
  combobox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
}

function selectReactSelectOption(combobox: HTMLInputElement, parsed: ParsedPhone): boolean {
  openReactSelect(combobox);

  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
  const match = options.find((option) => phoneOptionMatches(option.textContent || "", parsed));
  if (!match) return false;

  match.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  match.click();
  combobox.blur();
  return true;
}

export function phoneOptionMatches(optionText: string, parsed: ParsedPhone): boolean {
  const normalized = optionText.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.toLowerCase() === "select...") return false;
  const optionDial = normalized.match(/\+(\d{1,4})(?:\D|$)/)?.[1];
  if (parsed.dialCode && optionDial === parsed.dialCode) return true;
  if (parsed.countryName && optionMatchesCountry(normalized, parsed.countryName)) return true;
  if (parsed.countryName && optionMatches(normalized, parsed.countryName)) return true;
  return false;
}

function listboxForControl(control: HTMLElement): ParentNode {
  const listboxId =
    control.getAttribute("aria-controls") || control.getAttribute("aria-owns");
  if (listboxId) {
    const listbox = document.getElementById(listboxId);
    if (listbox) return listbox;
  }
  return document;
}

async function waitForPhoneOptions(
  control: HTMLElement,
  parsed: ParsedPhone,
  timeoutMs = 1_800
): Promise<HTMLElement | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const scope = listboxForControl(control);
    const options = [...scope.querySelectorAll<HTMLElement>('[role="option"]')];
    const match = options.find((option) =>
      phoneOptionMatches(option.textContent || "", parsed)
    );
    if (match) return match;
    await sleep(75);
  }
  return undefined;
}

async function selectPhoneCountryAsync(
  root: HTMLElement,
  parsed: ParsedPhone
): Promise<boolean> {
  const control = findCountryControl(root);
  if (!control) return selectItiCountry(findPhoneInput(root)!, parsed);

  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((candidate) =>
      phoneOptionMatches(candidate.textContent || candidate.value, parsed)
    );
    if (!option) return false;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )?.set;
    setter?.call(control, option.value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  control.focus();
  control.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  control.click();
  const option = await waitForPhoneOptions(control, parsed);
  if (!option) return false;
  option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  option.click();
  await sleep(200);
  return true;
}

function selectItiCountry(phoneInput: HTMLInputElement, parsed: ParsedPhone): boolean {
  const container = phoneInput.closest(".iti");
  if (!container) return false;

  container.querySelector<HTMLButtonElement>(".iti__selected-country")?.click();

  const listItem =
    (parsed.dialCode &&
      container.querySelector<HTMLElement>(`.iti__country[data-dial-code="${parsed.dialCode}"]`)) ||
    [...container.querySelectorAll<HTMLElement>(".iti__country")].find((item) =>
      parsed.countryName ? optionMatches(item.textContent || "", parsed.countryName) : false
    );

  if (!listItem) {
    container.querySelector<HTMLButtonElement>(".iti__selected-country")?.click();
    return false;
  }

  listItem.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  listItem.click();
  return true;
}

function setNationalPhoneNumber(phoneInput: HTMLInputElement, national: string): void {
  setControlledInputValue(phoneInput, national);
}

export function insertPhoneFieldValue(
  element: HTMLInputElement,
  rawValue: string,
  countryHint?: string
): InsertResult {
  const parsed = reparsedPhone(rawValue, countryHint);
  if (!parsed.national && !parsed.dialCode) {
    return { ok: false, error: "Phone number is empty." };
  }

  const fieldset = element.closest("fieldset.phone-input, .phone-input");
  const combobox = fieldset?.querySelector<HTMLInputElement>(
    '.phone-input__country input[role="combobox"], #country.select__input'
  );

  if (parsed.dialCode || parsed.countryName) {
    if (combobox) selectReactSelectOption(combobox, parsed);
    selectItiCountry(element, parsed);
  }

  setNationalPhoneNumber(element, parsed.national || rawValue.replace(/[^\d]/g, ""));

  const digits = (parsed.national || rawValue).replace(/\D/g, "");
  if (digits && !element.value.replace(/\D/g, "").includes(digits)) {
    return { ok: false, error: "Phone number did not stick after country selection." };
  }

  return { ok: true };
}

export async function insertPhoneFieldValueAsync(
  element: HTMLInputElement,
  rawValue: string,
  countryHint?: string
): Promise<InsertResult> {
  const parsed = reparsedPhone(rawValue, countryHint);
  if (!parsed.national && !parsed.dialCode) {
    return { ok: false, error: "Phone number is empty." };
  }

  const group = findPhoneGroup(element);
  if (!group) return insertPhoneFieldValue(element, rawValue, countryHint);
  const locator = capturePhoneInputLocator(element);

  if (parsed.dialCode || parsed.countryName) {
    const countrySelected = await selectPhoneCountryAsync(group, parsed);
    if (!countrySelected) {
      return {
        ok: false,
        error: `Could not select the phone country code${parsed.dialCode ? ` +${parsed.dialCode}` : ""}. Choose it manually, then retry the phone field.`
      };
    }
  }

  // Ashby may replace the input after the country changes. Reacquire the live
  // element from the group before committing the national number.
  await sleep(150);
  const liveGroup = group.isConnected ? group : null;
  const liveInput =
    (liveGroup ? findPhoneInput(liveGroup) : null) ??
    (element.isConnected ? element : null) ??
    findLivePhoneInput(locator);
  if (!liveInput) {
    return {
      ok: false,
      error: "The phone input was replaced after selecting the country code. Rescan and retry."
    };
  }

  const national = parsed.national || rawValue.replace(/\D/g, "");
  setNationalPhoneNumber(liveInput, national);
  await sleep(100);
  if (!liveInput.value.replace(/\D/g, "").includes(national.replace(/\D/g, ""))) {
    try {
      await setControlledInputValueInPageWorld(liveInput, national);
    } catch {
      // The verification below provides the actionable error.
    }
  }

  const insertedDigits = liveInput.value.replace(/\D/g, "");
  const expectedDigits = national.replace(/\D/g, "");
  if (!expectedDigits || !insertedDigits.includes(expectedDigits)) {
    return {
      ok: false,
      error: "Phone country was selected, but the phone number did not stick. Rescan and retry."
    };
  }
  return { ok: true };
}

export function readPhoneFieldValue(element: HTMLInputElement): string {
  const national = element.value.trim();
  const fieldset = element.closest("fieldset.phone-input, .phone-input");
  const selected =
    fieldset?.querySelector<HTMLElement>('[class*="single-value"], [class*="select__single-value"]')
      ?.textContent || "";
  const dial = selected.match(/\+(\d{1,4})/)?.[1];
  if (dial && national) return `+${dial}${national.replace(/\D/g, "")}`;
  return national;
}

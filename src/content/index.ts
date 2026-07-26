import { extractJobFromPage } from "../adapters/extractJob";
import type { ContentMessage, ScanResult } from "../shared/types";
import { buildPageContext } from "./pageContext";
import {
  attachDependencyListeners,
  extractDetectedFields,
  findField,
  insertFieldValue,
  insertFieldValueAsync,
  insertFieldsBatchAsync,
  readFieldValue
} from "./fieldDetection";
import { startFieldAutoCapture } from "./fieldAutoCapture";
import { findLinkedInEasyApplyRoot } from "./linkedinForm";
import {
  clickLinkedInExternalApply,
  collectLinkedInSearchJobs,
  waitForLinkedInApplyTarget
} from "./linkedinExternalJobs";
import { selectAdapter } from "../adapters";

declare global {
  interface Window {
    __applyosContentLoaded?: boolean;
  }
}

let observer: MutationObserver | undefined;
let observerTimeout: number | undefined;
let observerDebounce: number | undefined;
let removeDependencyListeners: (() => void) | undefined;
let stopFieldAutoCapture: (() => void) | undefined;
let currentPlatform = "generic";
let lastFieldSignature = "";

if (!window.__applyosContentLoaded) {
  window.__applyosContentLoaded = true;

  chrome.runtime.onMessage.addListener(
    (message: ContentMessage, _sender, sendResponse: (response: unknown) => void) => {
      if (message.type === "SCAN_PAGE") {
        scanPage(message.watchDynamicFields)
          .then(sendResponse)
          .catch((error) => sendResponse({ error: getErrorMessage(error) }));
        return true;
      }
      if (message.type === "EXTRACT_JOB_INFO") {
        extractJobOnly()
          .then(sendResponse)
          .catch((error) => sendResponse({ error: getErrorMessage(error) }));
        return true;
      }
      if (message.type === "COLLECT_LINKEDIN_SEARCH_JOBS") {
        try {
          sendResponse(collectLinkedInSearchJobs(message.limit));
        } catch (error) {
          sendResponse({ error: getErrorMessage(error) });
        }
        return false;
      }
      if (message.type === "GET_LINKEDIN_APPLY_TARGET") {
        waitForLinkedInApplyTarget()
          .then(sendResponse)
          .catch((error) => sendResponse({ error: getErrorMessage(error) }));
        return true;
      }
      if (message.type === "CLICK_LINKEDIN_EXTERNAL_APPLY") {
        sendResponse(clickLinkedInExternalApply());
        return false;
      }
      if (message.type === "SET_DYNAMIC_WATCH") {
        if (message.enabled) startObserver();
        else stopObserver();
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "INSERT_FIELDS_BATCH") {
        insertFieldsBatchAsync(message.fields)
          .then((results) => sendResponse({ ok: true, results }))
          .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
      }
      if (message.type === "INSERT_FIELD") {
        insertFieldValueAsync(
          message.fieldId,
          message.selectorHint,
          message.value,
          message.widget
        )
          .then(sendResponse)
          .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
        return true;
      }
      if (message.type === "GET_FIELD_VALUE") {
        const element = findField(message.fieldId, message.selectorHint);
        sendResponse({ ok: Boolean(element), value: readFieldValue(element) });
        return false;
      }
      if (message.type === "FOCUS_FIELD") {
        const element = findField(message.fieldId, message.selectorHint);
        if (!element) {
          sendResponse({ ok: false, error: "The field could not be found. Rescan and try again." });
          return false;
        }
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.focus({ preventScroll: true });
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "PING") {
        sendResponse({ ok: true });
        return false;
      }
      return false;
    }
  );

  stopFieldAutoCapture = startFieldAutoCapture("generic");
}

async function extractJobOnly() {
  const context = buildPageContext();
  return extractJobFromPage(context);
}

async function scanPage(watchDynamicFields: boolean): Promise<ScanResult> {
  const context = buildPageContext();
  const adapter = selectAdapter(context);
  currentPlatform = adapter.id;
  const pageType = adapter.classify(context);
  const fields = await adapter.extractFields(context);
  const extracted = await extractJobFromPage(context);
  const jobInfo = extracted.jobInfo;
  lastFieldSignature = fieldSignature(fields);

  if (watchDynamicFields) startObserver();
  else stopObserver();

  stopFieldAutoCapture?.();
  stopFieldAutoCapture = startFieldAutoCapture(adapter.id, jobInfo.company);

  const hasApplyButton = context.buttons.some((button) => /\bapply\b/i.test(button));
  const hasJobOnPage = (context.jobPostingText?.trim().length ?? 0) >= 200;
  const listingNote = extracted.jobInfoFromListing
    ? " Stored job requirements were merged for this role."
    : hasJobOnPage && fields.length > 0
      ? " Job description was read from this page."
      : "";
  const linkedInHint =
    adapter.id === "linkedin" && fields.length === 0
      ? " Open the Easy Apply modal on this job, then scan again."
      : "";
  const message =
    pageType === "job_listing_page" && fields.length === 0 && hasApplyButton
      ? `Job listing detected. Use Extract Job Info, click Apply manually, then Scan Page for form fields.${listingNote}`
      : fields.length === 0
        ? `No application fields were found.${linkedInHint}${extracted.jobInfoFromListing ? listingNote : " Extract job info first if this is a listing page."}`
        : extracted.jobInfoFromListing
          ? `Application form detected.${listingNote}`
          : undefined;

  return {
    context,
    pageType,
    platform: adapter.id,
    adapterName: adapter.name,
    jobInfo,
    fields,
    message,
    watching: Boolean(observer),
    jobInfoFromListing: extracted.jobInfoFromListing
  };
}

function startObserver(): void {
  stopObserver();
  removeDependencyListeners = attachDependencyListeners();
  observer = new MutationObserver(() => {
    // Coalesce bursts of DOM mutations (spinners, focus rings, class/style
    // churn) into one re-scan. extractDetectedFields is a full-subtree query, so
    // running it on every mutation tick is wasteful.
    if (observerDebounce) return;
    observerDebounce = window.setTimeout(() => {
      observerDebounce = undefined;
      const scope =
        currentPlatform === "linkedin" ? findLinkedInEasyApplyRoot() : null;
      const fields = extractDetectedFields(currentPlatform, scope);
      const signature = fieldSignature(fields);
      if (signature !== lastFieldSignature) {
        lastFieldSignature = signature;
        notifyExtension({
          type: "APPLYOS_FIELDS_CHANGED",
          fields,
          status: "Fields changed"
        });
      }
    }, 300);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden", "style", "class"]
  });
  observerTimeout = window.setTimeout(() => {
    stopObserver();
    notifyExtension({ type: "APPLYOS_WATCH_STOPPED", status: "Stopped after 15 seconds" });
  }, 15_000);
}

function stopObserver(): void {
  observer?.disconnect();
  observer = undefined;
  removeDependencyListeners?.();
  removeDependencyListeners = undefined;
  if (observerTimeout) window.clearTimeout(observerTimeout);
  observerTimeout = undefined;
  if (observerDebounce) window.clearTimeout(observerDebounce);
  observerDebounce = undefined;
}

function fieldSignature(fields: ReturnType<typeof extractDetectedFields>): string {
  return fields
    .map((field) => `${field.fieldId}:${field.options?.join("|")}:${field.isVisible}:${field.isDisabled}`)
    .join(";");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown content script error";
}

function notifyExtension(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // The side panel may have been closed while a short dynamic watch was active.
  });
}

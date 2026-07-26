import type { ExtractedJobPayload } from "../adapters/extractJob";
import { mergeFrameScanResults, mergeFrameScanSnapshot, looksLikeEmbeddedAtsPage, looksLikeInlineApplicationFormPage, looksLikeNativeAtsPage, type FrameScanResult } from "./scanFrames";
import type { ContentMessage, ScanResult } from "./types";

export const CONTENT_SCRIPT_FILE = "assets/content.js";

export const INJECTABLE_URL_PATTERNS = ["http://*/*", "https://*/*"] as const;

export function isInjectableTabUrl(url?: string): boolean {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

export function isRestrictedTabUrl(url?: string): boolean {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:")
  );
}

export function isMissingContentScriptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

export async function getFrameIds(tabId: number): Promise<number[]> {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    const frameIds = frames?.map((frame) => frame.frameId) ?? [0];
    return frameIds.length ? frameIds : [0];
  } catch {
    return [0];
  }
}

async function pingFrame(tabId: number, frameId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" }, { frameId });
    return true;
  } catch {
    return false;
  }
}

export async function ensureContentScript(tabId: number): Promise<void> {
  const frameIds = await getFrameIds(tabId);
  const alive = await Promise.all(frameIds.map((frameId) => pingFrame(tabId, frameId)));
  const missingFrameIds = frameIds.filter((_, index) => !alive[index]);
  if (!missingFrameIds.length) return;

  await chrome.scripting.executeScript({
    target:
      missingFrameIds.length === frameIds.length
        ? { tabId, allFrames: true }
        : { tabId, frameIds: missingFrameIds },
    files: [CONTENT_SCRIPT_FILE]
  });

  const afterInject = await Promise.all(missingFrameIds.map((frameId) => pingFrame(tabId, frameId)));
  if (!alive.some(Boolean) && !afterInject.some(Boolean)) {
    throw new Error("Content script failed to attach to this tab.");
  }
}

function fieldMessageFailed(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  if ("ok" in response && response.ok === false) {
    const error = "error" in response ? String(response.error) : "";
    return /could not be found|not supported|disabled/i.test(error);
  }
  if ("value" in response && typeof (response as { value?: string }).value === "string") {
    return !(response as { value?: string }).value?.trim();
  }
  return false;
}

async function routeFieldMessage<T>(tabId: number, message: ContentMessage): Promise<T> {
  await ensureContentScript(tabId);

  const frameId = "frameId" in message ? message.frameId : undefined;
  if (typeof frameId === "number") {
    const response = await sendMessageToFrame<T>(tabId, frameId, message);
    if (response !== undefined) return response;
    throw new Error("ApplyOS could not reach the field frame on this page.");
  }

  const frameIds = await getFrameIds(tabId);
  const ordered = [...frameIds.filter((id) => id !== 0), ...frameIds.filter((id) => id === 0)];

  for (const candidateFrameId of ordered) {
    const response = await sendMessageToFrame<T>(tabId, candidateFrameId, message);
    if (response === undefined) continue;
    if (fieldMessageFailed(response)) continue;
    return response;
  }

  throw new Error("ApplyOS could not reach the active tab frame.");
}

async function sendMessageToFrame<T>(
  tabId: number,
  frameId: number,
  message: ContentMessage
): Promise<T | undefined> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message, { frameId })) as T;
  } catch {
    return undefined;
  }
}

async function scanAllFrames(tabId: number, message: Extract<ContentMessage, { type: "SCAN_PAGE" }>): Promise<ScanResult> {
  await ensureContentScript(tabId);
  const tab = await chrome.tabs.get(tabId);
  const tabUrl = tab.url ?? "";

  const collect = async (): Promise<FrameScanResult[]> => {
    const frameIds = await getFrameIds(tabId);
    const results: FrameScanResult[] = [];
    for (const frameId of frameIds) {
      const response = await sendMessageToFrame<ScanResult | { error?: string }>(tabId, frameId, message);
      if (!response || !("fields" in response)) continue;
      results.push({ ...response, frameId });
    }
    return results;
  };

  const frameSnapshots = new Map<number, FrameScanResult>();
  let previousTotalFields = -1;
  let stablePolls = 0;

  const firstPass = await collect();
  const topFrame = firstPass.find((result) => result.frameId === 0);
  const frameCount = (await getFrameIds(tabId)).length;
  const embeddedAts = looksLikeEmbeddedAtsPage(tabUrl, topFrame?.context.bodyText, topFrame?.context);
  const nativeAts = looksLikeNativeAtsPage(tabUrl);
  const inlineForm = looksLikeInlineApplicationFormPage(tabUrl);
  const pollDelays = embeddedAts
    ? [0, 600, 1200, 2000, 2800]
    : inlineForm
      ? [0, 250]
      : nativeAts
        ? [0, 400, 900]
        : frameCount > 1
          ? [0, 500, 1200]
          : [0, 400];
  const stablePollsNeeded = embeddedAts ? 2 : 1;

  for (const delay of pollDelays) {
    if (delay > 0) {
      await ensureContentScript(tabId);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const batch = delay === 0 && firstPass.length ? firstPass : await collect();
    for (const result of batch) {
      frameSnapshots.set(result.frameId, mergeFrameScanSnapshot(frameSnapshots.get(result.frameId), result));
    }

    const totalFields = [...frameSnapshots.values()].reduce((sum, result) => sum + result.fields.length, 0);
    if (totalFields > 0 && totalFields === previousTotalFields) {
      stablePolls += 1;
      if (stablePolls >= stablePollsNeeded && totalFields >= 4) break;
      if (stablePolls >= stablePollsNeeded && inlineForm && totalFields >= 1) break;
    } else {
      stablePolls = 0;
    }
    previousTotalFields = totalFields;
  }

  const results = [...frameSnapshots.values()];
  if (!results.length) {
    results.push(...(await collect()));
  }

  return mergeFrameScanResults(results, tabUrl);
}

async function extractJobFromAllFrames(tabId: number): Promise<ExtractedJobPayload> {
  await ensureContentScript(tabId);
  const tab = await chrome.tabs.get(tabId);
  const tabUrl = tab.url ?? "";
  const frameIds = await getFrameIds(tabId);
  const payloads: Array<ExtractedJobPayload & { frameId: number }> = [];

  for (const frameId of frameIds) {
    const response = await sendMessageToFrame<ExtractedJobPayload | { error?: string }>(tabId, frameId, {
      type: "EXTRACT_JOB_INFO"
    });
    if (!response || !("jobInfo" in response)) continue;
    payloads.push({ ...response, frameId });
  }

  if (!payloads.length) {
    throw new Error("ApplyOS could not extract job info from this page.");
  }

  const scanLike: FrameScanResult[] = payloads.map((payload) => ({
    context: payload.context,
    pageType: payload.pageType,
    platform: payload.platform,
    adapterName: payload.adapterName,
    jobInfo: payload.jobInfo,
    fields: [],
    watching: false,
    jobInfoFromListing: payload.jobInfoFromListing,
    frameId: payload.frameId
  }));

  const merged = mergeFrameScanResults(scanLike, tabUrl);
  const primary = payloads.find((payload) => payload.frameId === 0) ?? payloads[0];

  return {
    ...primary,
    context: merged.context,
    pageType: merged.pageType,
    platform: merged.platform,
    adapterName: merged.adapterName,
    jobInfo: merged.jobInfo,
    jobInfoFromListing: merged.jobInfoFromListing ?? primary.jobInfoFromListing
  };
}

async function broadcastMessage<T>(tabId: number, message: ContentMessage): Promise<T | undefined> {
  await ensureContentScript(tabId);
  const frameIds = await getFrameIds(tabId);
  let lastResult: T | undefined;

  for (const frameId of frameIds) {
    const response = await sendMessageToFrame<T>(tabId, frameId, message);
    if (response !== undefined) lastResult = response;
  }

  return lastResult;
}

export async function sendMessageToTab<T>(tabId: number, message: ContentMessage): Promise<T> {
  if (message.type === "SCAN_PAGE") {
    return (await scanAllFrames(tabId, message)) as T;
  }

  if (message.type === "EXTRACT_JOB_INFO") {
    return (await extractJobFromAllFrames(tabId)) as T;
  }

  if (message.type === "SET_DYNAMIC_WATCH") {
    return (await broadcastMessage<T>(tabId, message)) as T;
  }

  if (
    message.type === "INSERT_FIELD" ||
    message.type === "INSERT_FIELDS_BATCH" ||
    message.type === "GET_FIELD_VALUE" ||
    message.type === "FOCUS_FIELD"
  ) {
    return routeFieldMessage<T>(tabId, message);
  }

  await ensureContentScript(tabId);

  const frameId = "frameId" in message ? message.frameId : undefined;
  if (typeof frameId === "number") {
    const response = await sendMessageToFrame<T>(tabId, frameId, message);
    if (response !== undefined) return response;
    throw new Error("ApplyOS could not reach the field frame on this page.");
  }

  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch (error) {
    if (!isMissingContentScriptError(error)) throw error;
  }

  const frameIds = await getFrameIds(tabId);
  for (const candidateFrameId of frameIds) {
    if (candidateFrameId === 0) continue;
    const response = await sendMessageToFrame<T>(tabId, candidateFrameId, message);
    if (response !== undefined) return response;
  }

  throw new Error("ApplyOS could not reach the active tab frame.");
}

export async function resolveTargetTabId(preferredTabId?: number): Promise<number> {
  if (preferredTabId) {
    const tab = await chrome.tabs.get(preferredTabId);
    if (!isInjectableTabUrl(tab.url)) {
      throw new Error("ApplyOS cannot run on this page type. Open a normal http(s) job or careers page.");
    }
    return preferredTabId;
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    throw new Error("No active browser tab found. Click the job page tab, then try again.");
  }
  if (isRestrictedTabUrl(tab.url) || !isInjectableTabUrl(tab.url)) {
    throw new Error(
      "ApplyOS cannot run on this page type. Click the job or careers tab in your browser window, then try again."
    );
  }
  return tab.id;
}

export async function injectIntoAllOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id && isInjectableTabUrl(tab.url))
      .map((tab) => ensureContentScript(tab.id!).catch(() => undefined))
  );
}

export type BackgroundMessage =
  | { type: "APPLYOS_RELAY_TO_TAB"; payload: ContentMessage; tabId?: number }
  | { type: "APPLYOS_ENSURE_ALL_TABS" };

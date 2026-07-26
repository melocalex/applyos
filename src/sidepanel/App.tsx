import React from "react";
import {
  BriefcaseBusiness,
  Database,
  FileQuestion,
  ListChecks,
  ScanSearch,
  Settings as SettingsIcon,
  UserRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { buildOptimizedExperienceDatabase } from "../ai/buildExperienceDatabase";
import { isAiRequestAborted } from "../ai/aiRequest";
import { summarizeCvWithOpenRouter } from "../ai/cvSummarizer";
import {
  improveJobExtraction,
  parseCvWithOpenRouter,
  smartMatchAnswer,
  suggestAllAnswersFromExperience
} from "../ai/openrouter";
import { recommendCvWithOpenRouter } from "../ai/recommendCvOpenRouter";
import {
  clearAllData,
  db,
  exportAllData,
  importAllData,
  initializeDatabase,
  pruneScanHistory
} from "../db";
import { mergeWithStoredJobInfo, saveJobListingCache } from "../db/jobListingCache";
import type { ExtractedJobPayload } from "../adapters/extractJob";
import { isThinJobInfo, jobListingCacheKey } from "../adapters/listingResolver";
import { findRelevantExperience } from "../matching/experienceEvidence";
import { getApplicationQuestionFields, hasApplicationQuestionsForAi } from "../shared/applicationFields";
import {
  applicationFieldsNeedingAi,
  countAnsweredApplicationQuestions,
  mergeScanSuggestions,
  uniqueApplicationQuestionFields
} from "../shared/scanSuggestions";
import { mergeFieldsFromFrame } from "../shared/dedupeFields";
import { cleanupStoredAnswerBank } from "../shared/answerBankCleanup";
import { sanitizeSavedQuestion, shouldRemoveSavedAnswer } from "../shared/answerBankQuestions";
import { saveFieldAnswer } from "../shared/saveFieldAnswer";
import { enrichCvSourceFromCatalog, heuristicCvSummary, recommendCvLocally } from "../matching/recommendCv";
import type { CvRecommendation } from "../matching/recommendCv";
import { normalizeText } from "../matching/normalize";
import { calculateJobFit } from "../scoring/jobFit";
import {
  createQueuedJobUrl,
  normalizeJobUrl,
  parseUrlsFromText,
  queueToCsv
} from "../queue/urlQueue";
import { EXPERIENCE_QUESTION_CATEGORIES } from "../shared/constants";
import {
  DEFAULT_SETTINGS,
  EMPTY_EXPERIENCE_PROFILE,
  type AnswerSuggestion,
  type CvSource,
  type DetectedField,
  type ExperienceDatabase,
  type ExperienceProfile,
  type JobFitScore,
  type LinkedInApplyTarget,
  type LinkedInSearchJob,
  type LinkedInSearchJobsResponse,
  type QueuedJobUrl,
  type QueueStatus,
  type SavedAnswer,
  type ScanResult,
  type Settings,
  type TrackedJob,
  type UserProfile
} from "../shared/types";
import { Notice, LoadingPanel } from "./components/UI";
import {
  downloadJson,
  downloadText,
  focusField,
  getErrorMessage,
  insertIntoField,
  readJsonFile,
  sendToActiveTab,
  sendToTab
} from "./lib";
import { autoInsertFields, autoInsertSummary, findUnfilledSuggestedFields } from "./autoInsert";
import { AnswerBankTab } from "./tabs/AnswerBankTab";
import { DetectedFieldsTab } from "./tabs/DetectedFieldsTab";
import { ExperienceProfileTab } from "./tabs/ExperienceProfileTab";
import { JobsTab } from "./tabs/JobsTab";
import { JobQueueTab } from "./tabs/JobQueueTab";
import { ProfileTab } from "./tabs/ProfileTab";
import { SettingsTab } from "./tabs/SettingsTab";

type TabId = "detected" | "queue" | "answers" | "experience" | "profile" | "jobs" | "settings";

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: "detected", label: "Detected Fields", icon: ScanSearch },
  { id: "queue", label: "Job Queue", icon: ListChecks },
  { id: "answers", label: "Answer Bank", icon: FileQuestion },
  { id: "experience", label: "Experience", icon: Database },
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "jobs", label: "Jobs", icon: BriefcaseBusiness },
  { id: "settings", label: "Settings", icon: SettingsIcon }
];

async function extractTextFromResumeFile(file: File) {
  const { extractTextFromFile } = await import("../parsers/resume");
  return extractTextFromFile(file);
}

async function parseExperienceFromText(
  rawText: string,
  sourceType: ExperienceProfile["sourceType"]
): Promise<ExperienceProfile> {
  const { parseExperienceLocally } = await import("../parsers/resume");
  return parseExperienceLocally(rawText, sourceType);
}

export function App() {
  const [activeTab, setActiveTab] = React.useState<TabId>("detected");
  const [experience, setExperience] = React.useState<ExperienceProfile>();
  const [experienceDatabase, setExperienceDatabase] = React.useState<ExperienceDatabase>();
  const [cvSources, setCvSources] = React.useState<CvSource[]>([]);
  const [userProfile, setUserProfile] = React.useState<UserProfile>();
  const [answers, setAnswers] = React.useState<SavedAnswer[]>([]);
  const [settings, setSettings] = React.useState<Settings>(DEFAULT_SETTINGS);
  const [jobs, setJobs] = React.useState<TrackedJob[]>([]);
  const [queue, setQueue] = React.useState<QueuedJobUrl[]>([]);
  const [currentQueueId, setCurrentQueueId] = React.useState<string>();
  const [scan, setScan] = React.useState<ScanResult>();
  const [scanStale, setScanStale] = React.useState(false);
  const [fit, setFit] = React.useState<JobFitScore>();
  const [cvRecommendation, setCvRecommendation] = React.useState<CvRecommendation>();
  const [suggestions, setSuggestions] = React.useState<Record<string, AnswerSuggestion>>({});
  const [watchDynamic, setWatchDynamic] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [linkedinBulkOpening, setLinkedinBulkOpening] = React.useState(false);
  const [aiGenerating, setAiGenerating] = React.useState(false);
  const [aiGeneratingLabel, setAiGeneratingLabel] = React.useState<string>();
  const aiAbortRef = React.useRef<AbortController | null>(null);
  const [notice, setNotice] = React.useState<{ tone: "info" | "success" | "warning" | "danger"; text: string }>();

  const beginAiRequest = React.useCallback((label: string): AbortSignal => {
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiGenerating(true);
    setAiGeneratingLabel(label);
    return controller.signal;
  }, []);

  const finishAiRequest = React.useCallback(() => {
    aiAbortRef.current = null;
    setAiGenerating(false);
    setAiGeneratingLabel(undefined);
  }, []);

  const cancelAiRequest = React.useCallback(() => {
    aiAbortRef.current?.abort();
  }, []);

  function handleAiError(error: unknown, fallback?: string): void {
    if (isAiRequestAborted(error)) {
      setNotice({ tone: "info", text: "AI request cancelled." });
      return;
    }
    setNotice({ tone: "danger", text: fallback ?? getErrorMessage(error) });
  }

  const settingsRef = React.useRef(settings);
  const userProfileRef = React.useRef(userProfile);
  const answersRef = React.useRef(answers);
  const suggestionsRef = React.useRef(suggestions);
  const scanRef = React.useRef(scan);

  React.useEffect(() => {
    scanRef.current = scan;
  }, [scan]);
  // Scan results describe one page; flag them when the active tab moves on so
  // stale fields, fit score, and Insert buttons aren't mistaken for live ones.
  React.useEffect(() => {
    setScanStale(false);
    if (!scan?.context.url) return;
    const scanUrl = scan.context.url.split("#")[0];
    const check = async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.url) setScanStale(tab.url.split("#")[0] !== scanUrl);
      } catch {
        // Tab may not be accessible; leave the flag as is.
      }
    };
    const onUpdated = (_tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (info.url && tab.active) void check();
    };
    const onActivated = () => void check();
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    void check();
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [scan]);

  React.useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  React.useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);
  React.useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  React.useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  const refresh = React.useCallback(async () => {
    await initializeDatabase();
    const [nextExperience, nextDatabase, nextCvSources, nextUserProfile, nextAnswers, nextSettings, nextJobs, nextQueue] =
      await Promise.all([
      db.experienceProfile.get("default"),
      db.experienceDatabase.get("default"),
      db.cvSources.orderBy("importedAt").toArray(),
      db.userProfile.get("default"),
      db.savedAnswers.orderBy("updatedAt").reverse().toArray(),
      db.settings.get("default"),
      db.trackedJobs.orderBy("updatedAt").reverse().toArray(),
      db.queuedJobUrls.orderBy("createdAt").toArray()
    ]);
    setExperience(nextExperience);
    setExperienceDatabase(nextDatabase);
    setCvSources(nextCvSources);
    setUserProfile(nextUserProfile);
    setAnswers(nextAnswers);
    setSettings({ ...DEFAULT_SETTINGS, ...nextSettings });
    setJobs(nextJobs);
    setQueue(nextQueue);
  }, []);

  const markSavedAnswerUsed = React.useCallback(async (savedAnswerId: string) => {
    const answer = await db.savedAnswers.get(savedAnswerId);
    if (!answer) return;
    await db.savedAnswers.put({
      ...answer,
      timesUsed: answer.timesUsed + 1,
      updatedAt: new Date().toISOString()
    });
    await refresh();
  }, [refresh]);

  const runAutoInsert = React.useCallback(
    async (fields: DetectedField[], nextSuggestions?: Record<string, AnswerSuggestion>) => {
      if (!settingsRef.current.autoInsertFields || !fields.length) return undefined;

      await initializeDatabase();
      const [latestProfile, latestAnswers] = await Promise.all([
        db.userProfile.get("default"),
        db.savedAnswers.toArray()
      ]);

      const firstPass = await autoInsertFields(fields, {
        userProfile: latestProfile,
        savedAnswers: latestAnswers,
        suggestions: nextSuggestions ?? suggestionsRef.current,
        onSavedAnswerUsed: markSavedAnswerUsed
      });

      const choiceFields = fields.filter(
        (field) =>
          (field.fieldType === "radio" || field.fieldType === "select") &&
          firstPass.failures.some((failure) => failure.label === field.label)
      );
      if (!choiceFields.length) return firstPass;

      await new Promise((resolve) => window.setTimeout(resolve, 600));

      const retryPass = await autoInsertFields(choiceFields, {
        userProfile: latestProfile,
        savedAnswers: latestAnswers,
        suggestions: nextSuggestions ?? suggestionsRef.current,
        onSavedAnswerUsed: markSavedAnswerUsed
      });

      return {
        inserted: firstPass.inserted + retryPass.inserted,
        skipped: firstPass.skipped,
        failures: retryPass.failures
      };
    },
    [markSavedAnswerUsed]
  );

  React.useEffect(() => {
    refresh().catch((error) => setNotice({ tone: "danger", text: `Local database error: ${getErrorMessage(error)}` }));
  }, [refresh]);

  React.useEffect(() => {
    const runtime = typeof chrome !== "undefined" ? chrome.runtime : undefined;
    if (!runtime?.onMessage) return;
    const listener = (
      message: {
        type?: string;
        fields?: DetectedField[];
        status?: string;
        field?: DetectedField;
        value?: string;
        result?: "saved" | "updated";
      },
      sender: chrome.runtime.MessageSender
    ) => {
      if (message.type === "APPLYOS_FIELDS_CHANGED" && message.fields) {
        const frameId = sender.frameId ?? 0;
        const current = scanRef.current;
        if (current) {
          const mergedFields = mergeFieldsFromFrame(current.fields, message.fields, frameId);
          setScan({ ...current, fields: mergedFields, watching: true });
          // Rekey AI suggestions by label so generated answers survive the
          // field-id churn a dynamic re-render can cause (mirrors handleScan).
          setSuggestions((prev) => mergeScanSuggestions(prev, current.fields, mergedFields));
        }
        const dynamicFields = message.fields.map((field) => ({
          ...field,
          frameId: field.frameId ?? frameId
        }));
        const dynamicFieldsToInsert = dynamicFields.filter((field) => field.isDynamic);
        if (dynamicFieldsToInsert.length && settingsRef.current.autoInsertFields) {
          runAutoInsert(dynamicFieldsToInsert)
            .then((insertResult) => {
              const summary = insertResult ? autoInsertSummary(insertResult) : undefined;
              setNotice({
                tone: "info",
                text: summary
                  ? `Dynamic fields changed. ${summary}.`
                  : "Dynamic fields changed. The detected field list has been updated."
              });
            })
            .catch((error) => setNotice({ tone: "danger", text: getErrorMessage(error) }));
        } else {
          setNotice({ tone: "info", text: "Dynamic fields changed. The detected field list has been updated." });
        }
      }
      if (message.type === "APPLYOS_WATCH_STOPPED") {
        setScan((current) => current ? { ...current, watching: false } : current);
        setNotice({ tone: "info", text: message.status || "Dynamic field watch stopped." });
      }
      if (
        message.type === "APPLYOS_ANSWER_SAVED" &&
        message.field &&
        message.value &&
        message.result
      ) {
        refresh()
          .then(() =>
            setNotice({
              tone: "success",
              text:
                message.result === "updated"
                  ? `Updated saved answer for “${message.field!.label}”.`
                  : `Saved “${message.value}” for “${message.field!.label}” to your Answer Bank.`
            })
          )
          .catch((error) => setNotice({ tone: "danger", text: getErrorMessage(error) }));
      }
    };
    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
  }, [runAutoInsert]);

  React.useEffect(() => {
    if (scan) setFit(calculateJobFit(scan.jobInfo, experience));
  }, [scan, experience]);

  React.useEffect(() => {
    if (scan?.jobInfo && cvSources.length) {
      setCvRecommendation(recommendCvLocally(scan.jobInfo, cvSources));
    } else {
      setCvRecommendation(undefined);
    }
  }, [scan?.jobInfo, cvSources]);

  async function handleScan() {
    await scanPage();
  }

  async function scanPage(targetTabId?: number) {
    setLoading(true);
    setNotice(undefined);
    const currentSettings = { ...DEFAULT_SETTINGS, ...(await db.settings.get("default")) };
    const aiConfigured =
      !currentSettings.localOnlyMode && Boolean(currentSettings.openRouterApiKey?.trim());
    try {
      const message = {
        type: "SCAN_PAGE" as const,
        watchDynamicFields: watchDynamic
      };
      const result = targetTabId === undefined
        ? await sendToActiveTab<ScanResult | { error: string }>(message)
        : await sendToTab<ScanResult | { error: string }>(targetTabId, message);
      if ("error" in result) throw new Error(result.error);

      const listingKey = jobListingCacheKey(result.context.url);
      const merged = await mergeWithStoredJobInfo(listingKey, result.jobInfo);
      const nextResult: ScanResult = {
        ...result,
        jobInfo: merged.jobInfo,
        jobInfoExtracted: merged.fromStored || result.jobInfoExtracted,
        jobInfoFromListing: merged.fromStored || result.jobInfoFromListing
      };

      if (!isThinJobInfo(nextResult.jobInfo)) {
        await saveJobListingCache({
          listingKey,
          listingUrl: merged.fromStored
            ? merged.jobInfo.listingSourceUrl ?? listingKey
            : listingKey,
          extractedFromUrl: nextResult.context.url,
          jobInfo: nextResult.jobInfo,
          platform: nextResult.platform,
          pageType: nextResult.pageType
        });
        nextResult.jobInfoExtracted = true;
      }

      const nextFit = calculateJobFit(nextResult.jobInfo, experience);
      const preservedSuggestions = mergeScanSuggestions(suggestions, scan?.fields, nextResult.fields);
      setScan(nextResult);
      setFit(nextFit);
      setSuggestions(preservedSuggestions);
      await db.scanHistory.put({
        id: crypto.randomUUID(),
        url: nextResult.context.url,
        pageType: nextResult.pageType,
        platform: nextResult.platform,
        fieldCount: nextResult.fields.length,
        jobTitle: nextResult.jobInfo.title,
        scannedAt: new Date().toISOString()
      });
      await pruneScanHistory();
      await updateQueueFromScan(nextResult, nextFit);
      const extractedNote = nextResult.jobInfoExtracted ? " Stored job info is attached for the model." : "";
      let noticeText = `Scanned ${nextResult.fields.length} fields with the ${nextResult.adapterName} adapter.${extractedNote}`;
      if (currentSettings.autoInsertFields && nextResult.fields.length) {
        const insertResult = await runAutoInsert(nextResult.fields);
        const insertSummary = insertResult ? autoInsertSummary(insertResult) : undefined;
        if (insertSummary) noticeText += ` ${insertSummary}.`;
      }

      const applicationQuestionCount = uniqueApplicationQuestionFields(nextResult.fields).length;
      const fieldsNeedingAi = applicationFieldsNeedingAi(nextResult.fields, preservedSuggestions);
      const alreadyAnsweredCount = countAnsweredApplicationQuestions(nextResult.fields, preservedSuggestions);
      const shouldRunAi =
        currentSettings.autoGenerateAnswersOnScan && aiConfigured && fieldsNeedingAi.length > 0;

      if (shouldRunAi) {
        const signal = beginAiRequest(
          `Drafting answers for ${fieldsNeedingAi.length} question${fieldsNeedingAi.length === 1 ? "" : "s"}…`
        );
        try {
          const generatedNote = await generateApplicationAnswers(nextResult, nextFit, {
            interactive: false,
            existingSuggestions: preservedSuggestions,
            fieldsToAnswer: fieldsNeedingAi,
            signal
          });
          if (generatedNote) {
            noticeText += ` ${generatedNote}`;
          }
        } catch (error) {
          if (isAiRequestAborted(error)) {
            noticeText += " AI request cancelled.";
          } else {
            noticeText += ` AI answer generation failed: ${getErrorMessage(error)}`;
          }
        }
      } else if (
        currentSettings.autoGenerateAnswersOnScan &&
        aiConfigured &&
        applicationQuestionCount > 0 &&
        alreadyAnsweredCount > 0
      ) {
        noticeText += ` ${alreadyAnsweredCount} application question${alreadyAnsweredCount === 1 ? "" : "s"} already have AI answers — skipped a duplicate OpenRouter call.`;
      } else if (
        !currentSettings.autoGenerateAnswersOnScan &&
        aiConfigured &&
        applicationQuestionCount > 0
      ) {
        noticeText += " Enable Auto-generate AI answers on scan in Settings, or click Generate All Answers.";
      }
      setNotice({
        tone: noticeText.includes("AI skipped") || noticeText.includes("failed") ? "warning" : "success",
        text: noticeText
      });
    } catch (error) {
      await markCurrentQueueError(getErrorMessage(error));
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    } finally {
      setLoading(false);
      finishAiRequest();
    }
  }

  async function handleExtractJobInfo() {
    setLoading(true);
    setNotice(undefined);
    try {
      const payload = await sendToActiveTab<ExtractedJobPayload | { error: string }>({
        type: "EXTRACT_JOB_INFO"
      });
      if ("error" in payload) throw new Error(payload.error);
      if (isThinJobInfo(payload.jobInfo)) {
        throw new Error("No job description was found on this page. Open the listing or careers page first.");
      }

      await saveJobListingCache({
        listingKey: payload.listingKey,
        listingUrl: payload.listingUrl,
        extractedFromUrl: payload.context.url,
        jobInfo: payload.jobInfo,
        platform: payload.platform,
        pageType: payload.pageType
      });

      const nextScan: ScanResult = {
        context: payload.context,
        pageType: payload.pageType,
        platform: payload.platform,
        adapterName: payload.adapterName,
        jobInfo: payload.jobInfo,
        fields: scan?.fields ?? [],
        watching: scan?.watching ?? false,
        jobInfoExtracted: true,
        jobInfoFromListing: payload.jobInfoFromListing,
        message:
          "Job info extracted. Click Apply on the page, then Scan Page to detect form fields. The model will receive both."
      };
      setScan(nextScan);
      setFit(calculateJobFit(payload.jobInfo, experience));
      setNotice({
        tone: "success",
        text: `Extracted ${payload.jobInfo.requirements.length} requirements and ${payload.jobInfo.responsibilities.length} responsibilities. Status: extracted.`
      });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  async function handleWatchDynamic(value: boolean) {
    setWatchDynamic(value);
    try {
      await sendToActiveTab({ type: "SET_DYNAMIC_WATCH", enabled: value });
      setScan((current) => current ? { ...current, watching: value } : current);
    } catch (error) {
      // The page never accepted the change — revert the toggle so it doesn't lie.
      setWatchDynamic(!value);
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function handleInsert(field: DetectedField, value: string, savedAnswerId?: string) {
    try {
      const result = await insertIntoField(field, value);
      if (!result.ok) throw new Error(result.error || "Insertion failed.");
      if (savedAnswerId) {
        const answer = await db.savedAnswers.get(savedAnswerId);
        if (answer) await db.savedAnswers.put({ ...answer, timesUsed: answer.timesUsed + 1, updatedAt: new Date().toISOString() });
        await refresh();
      }
      setNotice({ tone: "success", text: `Inserted a value into “${field.label}”. Review it in the page before continuing.` });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function handleFocusField(field: DetectedField) {
    try {
      const result = await focusField(field);
      if (!result.ok) throw new Error(result.error || "The field could not be focused.");
      setNotice({
        tone: "info",
        text: `Moved the page to “${field.label}”. Choose the recommended file manually.`
      });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function handleAutofillSafe(fields: DetectedField[]) {
    const result = await autoInsertFields(fields, {
      userProfile,
      savedAnswers: answers,
      onSavedAnswerUsed: markSavedAnswerUsed
    });
    const summary = autoInsertSummary(result);
    setNotice({
      tone: result.inserted ? "success" : "warning",
      text: summary ?? "No safe profile values could be inserted."
    });
  }

  async function handleParseExperience(rawText: string, sourceType: ExperienceProfile["sourceType"]) {
    setLoading(true);
    try {
      let profile = await parseExperienceFromText(rawText, sourceType);
      if (!settings.localOnlyMode && settings.openRouterApiKey && settings.allowRawCvForExtraction) {
        if (!confirmData("CV text will be sent to OpenRouter for structured extraction.", rawText.slice(0, 2000))) return;
        const signal = beginAiRequest("Extracting experience profile with AI…");
        try {
          const parsed = await parseCvWithOpenRouter(rawText, settings, signal);
          profile = { ...profile, ...parsed, id: "default", rawText, sourceType, parsedAt: new Date().toISOString() };
        } catch (error) {
          handleAiError(error);
          return;
        } finally {
          finishAiRequest();
        }
      }
      await db.experienceProfile.put(profile);
      await refresh();
      setNotice({ tone: "success", text: "Experience Profile created. Review and edit the structured data before using it." });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  async function handleSmartMatch(field: DetectedField, candidates: SavedAnswer[]) {
    try {
      if (!confirmData("Only the question and five local answer previews will be sent to OpenRouter.", JSON.stringify({ question: field.label, candidates: candidates.map((item) => ({ id: item.id, title: item.title, preview: item.answer.slice(0, 280) })) }, null, 2))) return;
      const signal = beginAiRequest("Matching saved answers with AI…");
      try {
        const result = await smartMatchAnswer(field.label, candidates, settings, signal);
        const answer = candidates.find((candidate) => candidate.id === result.bestMatchId);
        setSuggestions((current) => ({
          ...current,
          [field.fieldId]: {
            questionFieldId: field.fieldId,
            source: answer && result.shouldUseSavedAnswer ? "answer_bank" : "manual",
            answer: answer?.answer,
            savedAnswerId: answer?.id,
            confidence: result.confidence,
            reason: result.reason,
            requiresEditBeforeInsert: result.confidence < 0.7
          }
        }));
      } finally {
        finishAiRequest();
      }
    } catch (error) {
      handleAiError(error);
    }
  }

  async function generateApplicationAnswers(
    scanResult: ScanResult,
    fitScore: JobFitScore,
    options: {
      interactive: boolean;
      existingSuggestions?: Record<string, AnswerSuggestion>;
      fieldsToAnswer?: DetectedField[];
      signal?: AbortSignal;
    }
  ): Promise<string | undefined> {
    const applicationFields = options.fieldsToAnswer ?? applicationFieldsNeedingAi(
      scanResult.fields,
      options.existingSuggestions ?? {}
    );

    if (!applicationFields.length) {
      if (options.interactive) {
        setNotice({
          tone: "info",
          text: hasApplicationQuestionsForAi(scanResult.fields)
            ? "All application questions already have AI answers for this scan."
            : "This form only has basic profile fields — no custom questions need AI answers."
        });
      }
      return undefined;
    }

    const currentSettings = { ...DEFAULT_SETTINGS, ...(await db.settings.get("default")) };

    if (currentSettings.localOnlyMode || !currentSettings.openRouterApiKey?.trim()) {
      if (options.interactive) {
        setNotice({
          tone: "warning",
          text: "Turn off Local-only mode and add an OpenRouter API key in Settings, then click Save Settings."
        });
      }
      return "AI skipped: turn off Local-only mode and save your OpenRouter API key in Settings.";
    }

    const usingDatabase =
      currentSettings.useOptimizedExperienceDatabase &&
      Boolean(experienceDatabase?.markdown?.trim());
    if (!usingDatabase && !experience) {
      if (options.interactive) {
        setNotice({
          tone: "warning",
          text: "Add an Experience Profile or import CVs and build the optimized database in Experience."
        });
      }
      return "AI skipped: add experience data in the Experience tab (CV library or optimized database).";
    }

    const questions = applicationFields.map((field) => ({
      fieldId: field.fieldId,
      label: field.label,
      category: field.category,
      relevantExperience: experience
        ? findRelevantExperience(field.label, experience, scanResult.jobInfo).snippets
        : []
    }));

    if (
      // "Show data before sending" applies to every LLM call path, including
      // auto-generate-on-scan — the panel is open and focused during scans,
      // so the preview dialog is always feasible.
      currentSettings.showDataBeforeSending &&
      !confirmData(
        usingDatabase
          ? "All application questions, the full optimized multi-CV database, job description, and humanizer prompt will be sent to OpenRouter in one request."
          : "All application questions, relevant experience snippets, and job summary will be sent to OpenRouter in one request.",
        JSON.stringify(
          {
            questionCount: questions.length,
            usingOptimizedDatabase: usingDatabase,
            questions: questions.map((question) => question.label),
            job: { title: scanResult.jobInfo.title, company: scanResult.jobInfo.company },
            fitScore: fitScore.overallScore,
            fitThreshold: currentSettings.jobFitThreshold
          },
          null,
          2
        )
      )
    ) {
      return undefined;
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const results = await suggestAllAnswersFromExperience(
      questions,
      experience ?? EMPTY_EXPERIENCE_PROFILE,
      scanResult.jobInfo,
      currentSettings,
      usingDatabase ? experienceDatabase!.markdown : undefined,
      options.signal
    );

    const nextSuggestions: Record<string, AnswerSuggestion> = {};
    const saveTasks: Promise<unknown>[] = [];
    let heldForReview = 0;
    for (const result of results) {
      const isNoFit = result.answer === "NO_FIT";
      // Low-confidence answers require a manual edit before insert; saving them
      // to the Answer Bank would re-insert them via exact-question match anyway,
      // so flagged answers are neither auto-inserted nor persisted.
      const requiresEdit = (result.confidence ?? 0) < 0.7;
      nextSuggestions[result.fieldId] = {
        questionFieldId: result.fieldId,
        source: isNoFit ? "no_fit" : "experience_profile",
        answer: result.answer,
        sourceExperience: result.sourceExperience,
        confidence: result.confidence,
        reason: result.reason,
        requiresEditBeforeInsert: requiresEdit
      };

      if (!isNoFit && result.answer?.trim()) {
        if (requiresEdit) {
          heldForReview += 1;
        } else {
          const field = applicationFields.find((item) => item.fieldId === result.fieldId);
          if (field) {
            saveTasks.push(
              saveFieldAnswer(field, result.answer, scanResult.jobInfo.company, {
                source: "generated_from_cv"
              })
            );
          }
        }
      }
    }
    if (saveTasks.length) await Promise.all(saveTasks);

    await refresh();
    const mergedSuggestions = { ...(options.existingSuggestions ?? {}), ...nextSuggestions };
    setSuggestions(mergedSuggestions);

    let noticeText = `Generated ${results.length} AI answer${results.length === 1 ? "" : "s"} for ${applicationFields.length} question${applicationFields.length === 1 ? "" : "s"}; ${saveTasks.length} saved to your Answer Bank.`;
    if (heldForReview) {
      noticeText += ` ${heldForReview} low-confidence answer${heldForReview === 1 ? " was" : "s were"} held for review — check the flagged fields below before inserting.`;
    }
    if (fitScore.overallScore < currentSettings.jobFitThreshold) {
      noticeText += ` (Job fit is ${fitScore.overallScore}% — below your ${currentSettings.jobFitThreshold}% threshold, but answers were still generated.)`;
    }
    if (currentSettings.autoInsertFields) {
      const fieldsWithSuggestions = scanResult.fields.filter(
        (field) =>
          mergedSuggestions[field.fieldId]?.answer &&
          mergedSuggestions[field.fieldId]?.answer !== "NO_FIT"
      );
      const insertTargets = [
        ...new Map(
          [...applicationFields, ...fieldsWithSuggestions].map((field) => [field.fieldId, field])
        ).values()
      ];
      const insertResult = await runAutoInsert(insertTargets, mergedSuggestions);
      const insertSummary = insertResult ? autoInsertSummary(insertResult) : undefined;
      if (insertSummary) noticeText += ` ${insertSummary}.`;

      const stillEmpty = await findUnfilledSuggestedFields(insertTargets, mergedSuggestions);
      if (stillEmpty.length) {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        const retryResult = await autoInsertFields(stillEmpty, {
          userProfile: await db.userProfile.get("default"),
          savedAnswers: await db.savedAnswers.toArray(),
          suggestions: mergedSuggestions,
          skipIfFilled: false,
          onSavedAnswerUsed: markSavedAnswerUsed
        });
        const retrySummary = autoInsertSummary(retryResult);
        if (retrySummary) noticeText += ` Retry: ${retrySummary}.`;
        if (retryResult.failures.length) {
          noticeText += ` Could not fill: ${retryResult.failures.map((failure) => failure.label).join("; ")}.`;
        }
      }
    }

    if (options.interactive) {
      setNotice({ tone: "success", text: noticeText });
    }
    return noticeText;
  }

  async function handleSuggestAllAnswers() {
    if (!scan || !fit) return;
    const fieldsNeedingAi = applicationFieldsNeedingAi(scan.fields, suggestions);
    const signal = beginAiRequest(
      `Drafting answers for ${fieldsNeedingAi.length} question${fieldsNeedingAi.length === 1 ? "" : "s"}…`
    );
    setLoading(true);
    try {
      await generateApplicationAnswers(scan, fit, {
        interactive: true,
        existingSuggestions: suggestions,
        fieldsToAnswer: fieldsNeedingAi,
        signal
      });
    } catch (error) {
      handleAiError(error);
    } finally {
      setLoading(false);
      finishAiRequest();
    }
  }

  async function importCvSources(files: FileList) {
    setLoading(true);
    try {
      const timestamp = new Date().toISOString();
      const existing = await db.cvSources.toArray();
      const items: CvSource[] = [];

      for (const file of Array.from(files)) {
        const extracted = await extractTextFromResumeFile(file);
        const fileName = file.name;
        const catalogFields = enrichCvSourceFromCatalog(fileName);
        const heuristicFields = heuristicCvSummary(extracted.text, fileName);
        const prior = existing.find((source) => source.fileName.toLowerCase() === fileName.toLowerCase());

        items.push({
          id: prior?.id ?? crypto.randomUUID(),
          fileName,
          rawText: extracted.text,
          sourceType: extracted.sourceType,
          importedAt: prior?.importedAt ?? timestamp,
          localPathHint: prior?.localPathHint,
          ...heuristicFields,
          ...catalogFields
        });
      }

      await db.cvSources.bulkPut(items);
      await refresh();
      setNotice({ tone: "success", text: `Imported ${items.length} CV source file(s) with summaries.` });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  async function saveCvSource(cv: CvSource) {
    await db.cvSources.put(cv);
    await refresh();
    setNotice({ tone: "success", text: `Saved summary for ${cv.fileName}.` });
  }

  async function summarizeCvSource(cv: CvSource) {
    if (!cv.rawText.trim()) throw new Error("This CV has no extracted text to summarize.");
    if (
      !confirmData(
        `OpenRouter will summarize ${cv.fileName} to update the CV library entry.`,
        cv.rawText.slice(0, 2000)
      )
    ) {
      return;
    }
    setLoading(true);
    const signal = beginAiRequest(`Summarizing ${cv.fileName}…`);
    try {
      const summary = await summarizeCvWithOpenRouter(cv.fileName, cv.rawText, settings, signal);
      await db.cvSources.put({ ...cv, ...summary });
      await refresh();
      setNotice({ tone: "success", text: `Regenerated summary for ${cv.fileName}.` });
    } catch (error) {
      handleAiError(error);
    } finally {
      setLoading(false);
      finishAiRequest();
    }
  }

  async function handleRecommendCvWithAi() {
    if (!scan?.jobInfo || !cvSources.length) return;
    if (
      !confirmData(
        "OpenRouter will compare this job against your CV library summaries.",
        JSON.stringify(
          {
            jobTitle: scan.jobInfo.title,
            cvFiles: cvSources.map((cv) => cv.fileName)
          },
          null,
          2
        )
      )
    ) {
      return;
    }
    setLoading(true);
    const signal = beginAiRequest("Recommending CV with AI…");
    try {
      const recommendation = await recommendCvWithOpenRouter(scan.jobInfo, cvSources, settings, signal);
      setCvRecommendation(recommendation);
      setNotice({ tone: "success", text: `Recommended CV: ${recommendation.recommendedFileName}` });
    } catch (error) {
      handleAiError(error);
    } finally {
      setLoading(false);
      finishAiRequest();
    }
  }

  async function rebuildExperienceDatabase() {
    if (!cvSources.length) return;
    if (
      !confirmData(
        "All stored CV texts will be sent to OpenRouter to rebuild the optimized markdown database.",
        JSON.stringify(
          {
            sourceFiles: cvSources.map((source) => source.fileName),
            totalCharacters: cvSources.reduce((sum, source) => sum + source.rawText.length, 0)
          },
          null,
          2
        )
      )
    ) {
      return;
    }
    setLoading(true);
    const signal = beginAiRequest("Rebuilding experience database with AI…");
    try {
      const markdown = await buildOptimizedExperienceDatabase(
        cvSources.map((source) => ({ fileName: source.fileName, text: source.rawText })),
        settings,
        signal
      );
      await db.experienceDatabase.put({
        id: "default",
        markdown,
        sourceFiles: cvSources.map((source) => source.fileName),
        updatedAt: new Date().toISOString(),
        generatedWithOpenRouter: true
      });
      await refresh();
      setNotice({ tone: "success", text: "Optimized CV database rebuilt. Review the markdown before generating answers." });
    } catch (error) {
      handleAiError(error);
    } finally {
      setLoading(false);
      finishAiRequest();
    }
  }

  async function saveExperienceDatabaseMarkdown(markdown: string) {
    await db.experienceDatabase.put({
      id: "default",
      markdown,
      sourceFiles: experienceDatabase?.sourceFiles ?? cvSources.map((source) => source.fileName),
      updatedAt: new Date().toISOString(),
      generatedWithOpenRouter: experienceDatabase?.generatedWithOpenRouter ?? false
    });
    await refresh();
    setNotice({ tone: "success", text: "Optimized CV database saved locally." });
  }

  async function importExperienceDatabaseMarkdown(file: File) {
    try {
      const markdown = await file.text();
      await saveExperienceDatabaseMarkdown(markdown);
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  function exportExperienceDatabaseMarkdown() {
    if (!experienceDatabase?.markdown?.trim()) return;
    downloadText("applyos-experience-database.md", experienceDatabase.markdown, "text/markdown");
  }

  async function clearCvSources() {
    if (!window.confirm("Clear all imported CV source files? The markdown database will be kept.")) return;
    await db.cvSources.clear();
    await refresh();
    setNotice({ tone: "info", text: "CV source files cleared." });
  }

  async function handleImproveJob() {
    if (!scan?.jobInfo.description) return;
    try {
      if (!confirmData("Only the visible job description will be sent to OpenRouter.", scan.jobInfo.description.slice(0, 2500))) return;
      const signal = beginAiRequest("Improving job extraction with AI…");
      try {
        const improved = await improveJobExtraction(scan.jobInfo.description, settings, signal);
        setScan({ ...scan, jobInfo: { ...scan.jobInfo, ...improved } });
        setNotice({ tone: "success", text: "Job extraction improved. Review the extracted requirements before relying on the fit score." });
      } finally {
        finishAiRequest();
      }
    } catch (error) {
      handleAiError(error);
    }
  }

  async function handleSaveCurrentValue(field: DetectedField) {
    try {
      const result = await sendToActiveTab<{ ok: boolean; value?: string }>({
        type: "GET_FIELD_VALUE",
        fieldId: field.fieldId,
        selectorHint: field.selectorHint,
        frameId: field.frameId
      });
      if (!result.value?.trim()) throw new Error("The field is empty. Enter an answer in the page first.");
      const question = sanitizeSavedQuestion(field.label);
      if (shouldRemoveSavedAnswer(question, result.value)) {
        throw new Error("This field should not be saved to the Answer Bank (profile or factual field).");
      }
      const timestamp = new Date().toISOString();
      await db.savedAnswers.put({
        id: crypto.randomUUID(),
        title: question.slice(0, 80),
        category: answerCategory(field.category),
        originalQuestion: question,
        normalizedQuestion: normalizeText(question),
        answer: result.value,
        tags: [],
        roleTypes: [],
        companiesUsedFor: scan?.jobInfo.company ? [scan.jobInfo.company] : [],
        source: "manual",
        timesUsed: 0,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      await refresh();
      setNotice({ tone: "success", text: "Saved the current field value to your local Answer Bank." });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function handleSaveSuggestion(field: DetectedField, suggestion: AnswerSuggestion) {
    if (!suggestion.answer || suggestion.answer === "NO_FIT") return;
    const edited = window.prompt("Review the answer before saving it", suggestion.answer);
    if (!edited?.trim()) return;
    const question = sanitizeSavedQuestion(field.label);
    if (shouldRemoveSavedAnswer(question, edited)) return;
    const timestamp = new Date().toISOString();
    await db.savedAnswers.put({
      id: crypto.randomUUID(),
      title: question.slice(0, 80),
      category: answerCategory(field.category),
      originalQuestion: question,
      normalizedQuestion: normalizeText(question),
      answer: edited,
      tags: [],
      roleTypes: [],
      companiesUsedFor: scan?.jobInfo.company ? [scan.jobInfo.company] : [],
      source: "generated_from_cv",
      derivedFromRole: suggestion.sourceExperience,
      timesUsed: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    });
    await refresh();
    setNotice({ tone: "success", text: "Approved suggestion saved to your local Answer Bank." });
  }

  function handleSkip(field: DetectedField) {
    setSuggestions((current) => ({
      ...current,
      [field.fieldId]: {
        questionFieldId: field.fieldId,
        source: "manual",
        confidence: 1,
        reason: "Skipped by user",
        requiresEditBeforeInsert: false
      }
    }));
  }

  async function saveTrackedJob(status: TrackedJob["status"]) {
    if (!scan) return;
    const existing = jobs.find((job) => sameJobUrl(job.sourceUrl, scan.jobInfo.sourceUrl));
    const timestamp = new Date().toISOString();
    await db.trackedJobs.put({
      id: existing?.id ?? crypto.randomUUID(),
      title: scan.jobInfo.title,
      company: scan.jobInfo.company,
      location: scan.jobInfo.location,
      sourceUrl: scan.jobInfo.sourceUrl,
      platform: scan.jobInfo.platform,
      status,
      fitScore: fit,
      notes: existing?.notes,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
    await updateMatchingQueueStatus(
      scan.jobInfo.sourceUrl,
      status === "saved" ? "saved" : status === "applied" ? "applied" : "skipped"
    );
    await refresh();
    setNotice({ tone: "success", text: `Job marked ${status.replace(/_/g, " ")}.` });
  }

  function confirmData(summary: string, data: string): boolean {
    if (!settings.showDataBeforeSending) return true;
    return window.confirm(`${summary}\n\nPreview:\n${data.slice(0, 3500)}`);
  }

  async function importExperience(file: File) {
    try {
      const data = await readJsonFile(file);
      await db.experienceProfile.put({ ...EMPTY_EXPERIENCE_PROFILE, ...data, id: "default" } as ExperienceProfile);
      await refresh();
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function importAnswers(file: File) {
    try {
      const data = await readJsonFile(file);
      const values = Array.isArray(data) ? data : data.savedAnswers;
      if (!Array.isArray(values)) throw new Error("The file does not contain an answer bank.");
      await db.savedAnswers.bulkPut(values as SavedAnswer[]);
      const cleanup = await cleanupStoredAnswerBank(
        () => db.savedAnswers.toArray(),
        async (cleaned) => {
          await db.transaction("rw", db.savedAnswers, async () => {
            await db.savedAnswers.clear();
            if (cleaned.length) await db.savedAnswers.bulkPut(cleaned);
          });
        }
      );
      await refresh();
      setNotice({
        tone: "success",
        text:
          cleanup.removed.length || cleanup.fixed.length
            ? cleanup.summary
            : `Imported ${values.length} answer${values.length === 1 ? "" : "s"} into your Answer Bank.`
      });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function clearAllAnswers() {
    await db.savedAnswers.clear();
    await refresh();
    setNotice({ tone: "success", text: "Answer Bank cleared. Scan a form to regenerate answers with AI." });
  }

  async function cleanupAnswers() {
    const result = await cleanupStoredAnswerBank(
      () => db.savedAnswers.toArray(),
      async (cleaned) => {
        await db.transaction("rw", db.savedAnswers, async () => {
          await db.savedAnswers.clear();
          if (cleaned.length) await db.savedAnswers.bulkPut(cleaned);
        });
      }
    );
    await refresh();
    setNotice({ tone: result.removed.length || result.fixed.length ? "success" : "info", text: result.summary });
  }

  function exportAnswerBank() {
    downloadJson("applyos-answer-bank.json", {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: answers.length,
      savedAnswers: answers
    });
  }

  async function importAll(file: File) {
    try {
      await importAllData(await readJsonFile(file));
      await refresh();
      setNotice({ tone: "success", text: "Local ApplyOS data imported." });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function importQueueText(input: string) {
    const urls = parseUrlsFromText(input, settings.queueDevMode);
    if (!urls.length) {
      setNotice({ tone: "warning", text: "No valid HTTP or HTTPS job URLs were found." });
      return;
    }
    const existing = new Set(queue.map((item) => item.normalizedUrl));
    const timestamp = new Date().toISOString();
    const newItems = urls
      .filter((url) => !existing.has(url))
      .map((url, index) => createQueuedJobUrl(url, new Date(Date.parse(timestamp) + index).toISOString()));
    if (!newItems.length) {
      setNotice({ tone: "info", text: "All detected URLs are already in the queue." });
      return;
    }
    await db.queuedJobUrls.bulkPut(newItems);
    await refresh();
    setNotice({ tone: "success", text: `Imported ${newItems.length} unique job URLs. ${urls.length - newItems.length} duplicates were skipped.` });
  }

  async function updateLinkedInPreScreen(enabled: boolean) {
    const nextSettings = {
      ...settings,
      id: "default" as const,
      linkedinPreScreenEnabled: enabled
    };
    await db.settings.put(nextSettings);
    setSettings(nextSettings);
    setNotice({
      tone: "info",
      text: enabled
        ? `LinkedIn pre-screening enabled. Roles below ${nextSettings.jobFitThreshold}% will not open an application tab.`
        : "LinkedIn pre-screening disabled. All external roles will be opened after duplicate and Easy Apply checks."
    });
  }

  async function openLinkedInExternalRoles() {
    if (linkedinBulkOpening) return;
    try {
      const [sourceTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!sourceTab?.id || !isLinkedInJobsUrl(sourceTab.url)) {
        throw new Error("Open a LinkedIn Jobs search results tab, then try again.");
      }

      const collected = await sendToTab<LinkedInSearchJobsResponse>(sourceTab.id, {
        type: "COLLECT_LINKEDIN_SEARCH_JOBS",
        limit: 20
      });
      if (!collected.jobs.length) {
        throw new Error(
          "No loaded LinkedIn job cards were found. Scroll the results list to load roles, then try again."
        );
      }

      const knownLinkedInJobIds = new Set(
        queue
          .map(
            (item) =>
              (item.sourcePlatform === "linkedin" ? item.sourceJobId : undefined) ??
              item.notes?.match(/LinkedIn job (\d+)/i)?.[1]
          )
          .filter((jobId): jobId is string => Boolean(jobId))
      );
      const jobsToInspect = collected.jobs.filter(
        (job) => !knownLinkedInJobIds.has(job.jobId)
      );
      const duplicateCount = collected.jobs.length - jobsToInspect.length;
      if (!jobsToInspect.length) {
        setNotice({
          tone: "info",
          text: `All ${collected.jobs.length} loaded LinkedIn roles are already in your queue. No tabs were opened.`
        });
        return;
      }

      if (settings.linkedinPreScreenEnabled && !experience) {
        throw new Error(
          "LinkedIn fit filtering needs an Experience Profile. Add one in Experience, or turn off the fit-filter checkbox."
        );
      }

      const limitedNote =
        collected.totalFound > collected.jobs.length
          ? ` ApplyOS will use the first ${collected.jobs.length} of ${collected.totalFound} loaded roles.`
          : "";
      const duplicateNote = duplicateCount
        ? ` ${duplicateCount} role${duplicateCount === 1 ? " is" : "s are"} already in your queue and will be skipped.`
        : "";
      const fitNote = settings.linkedinPreScreenEnabled
        ? ` Roles below your ${settings.jobFitThreshold}% fit threshold will be filtered before an application tab is opened.`
        : "";
      const confirmed = window.confirm(
        `Inspect ${jobsToInspect.length} new LinkedIn role${jobsToInspect.length === 1 ? "" : "s"} and open their external application pages?${limitedNote}${duplicateNote}${fitNote}\n\nEasy Apply roles will be skipped. ApplyOS will not submit any application.`
      );
      if (!confirmed) return;

      setLinkedinBulkOpening(true);
      setNotice({
        tone: "info",
        text: `Inspecting ${jobsToInspect.length} LinkedIn roles. External application pages will open in background tabs.`
      });

      const outcomes: LinkedInOpenOutcome[] = [];
      let nextIndex = 0;
      let completed = 0;
      const workerCount = Math.min(3, jobsToInspect.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < jobsToInspect.length) {
          const index = nextIndex;
          nextIndex += 1;
          const outcome = await inspectLinkedInJob(jobsToInspect[index], {
            experience: settings.linkedinPreScreenEnabled ? experience : undefined,
            minimumFit: settings.linkedinPreScreenEnabled
              ? settings.jobFitThreshold
              : undefined
          });
          outcomes.push(outcome);
          completed += 1;
          setNotice({
            tone: "info",
            text: `Checked ${completed} of ${jobsToInspect.length} LinkedIn roles…`
          });
        }
      });
      await Promise.all(workers);

      const opened = outcomes.filter(
        (outcome): outcome is Extract<LinkedInOpenOutcome, { kind: "opened" }> =>
          outcome.kind === "opened"
      );
      const existing = new Set(queue.map((item) => item.normalizedUrl));
      const now = Date.now();
      const newQueueItems: QueuedJobUrl[] = [];
      const keptOpened: Array<Extract<LinkedInOpenOutcome, { kind: "opened" }>> = [];
      let duplicateExternalUrls = 0;
      for (const outcome of opened) {
        const normalizedUrl = safeNormalizeUrl(outcome.url);
        if (!normalizedUrl || existing.has(normalizedUrl)) {
          duplicateExternalUrls += 1;
          await closeTab(outcome.tabId);
          continue;
        }
        const createdAt = new Date(now + newQueueItems.length).toISOString();
        const base = createQueuedJobUrl(normalizedUrl, createdAt);
        newQueueItems.push({
          ...base,
          status: "opened",
          title: outcome.job.title,
          company: outcome.job.company,
          location: outcome.job.location,
          notes: `Opened from LinkedIn job ${outcome.job.jobId}.`,
          openedAt: createdAt,
          sourcePlatform: "linkedin",
          sourceJobId: outcome.job.jobId,
          sourceUrl: outcome.job.detailsUrl,
          fitScore: outcome.fit?.overallScore,
          fitRecommendation: outcome.fit?.recommendation
        });
        existing.add(normalizedUrl);
        keptOpened.push(outcome);
      }
      if (newQueueItems.length) await db.queuedJobUrls.bulkPut(newQueueItems);
      const sessionTabIds = [
        ...keptOpened.map((outcome) => outcome.tabId),
        ...outcomes
        .filter(
          (
            outcome
          ): outcome is Extract<
            LinkedInOpenOutcome,
            { kind: "manual_fallback" }
          > =>
            outcome.kind === "manual_fallback"
        )
        .map((outcome) => outcome.tabId)
      ];
      await groupApplySessionTabs(sessionTabIds);
      await refresh();

      const easyApply = countOutcome(outcomes, "easy_apply");
      const filtered = countOutcome(outcomes, "filtered");
      const fallbacks = countOutcome(outcomes, "manual_fallback");
      const unavailable = countOutcome(outcomes, "unavailable");
      const failures = countOutcome(outcomes, "error");
      const details = [
        `${keptOpened.length} external page${keptOpened.length === 1 ? "" : "s"} opened`,
        `${newQueueItems.length} new queue URL${newQueueItems.length === 1 ? "" : "s"}`,
        duplicateCount ? `${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"} skipped` : "",
        duplicateExternalUrls
          ? `${duplicateExternalUrls} duplicate application URL${duplicateExternalUrls === 1 ? "" : "s"} closed`
          : "",
        filtered ? `${filtered} below fit threshold` : "",
        easyApply ? `${easyApply} Easy Apply skipped` : "",
        fallbacks ? `${fallbacks} LinkedIn fallback tab${fallbacks === 1 ? "" : "s"} left open` : "",
        unavailable ? `${unavailable} unavailable` : "",
        failures ? `${failures} failed` : ""
      ].filter(Boolean);
      setNotice({
        tone: fallbacks || unavailable || failures ? "warning" : "success",
        text: `${details.join(" · ")}.${sessionTabIds.length ? " Opened tabs were grouped as “ApplyOS Session”." : ""} No applications were submitted.`
      });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    } finally {
      setLinkedinBulkOpening(false);
    }
  }

  async function openQueueItem(item: QueuedJobUrl) {
    try {
      const timestamp = new Date().toISOString();
      const behavior = settings.queueOpenBehavior;
      let openedTabId: number | undefined;
      if (behavior === "current_tab") {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("No active tab is available.");
        const updated = await chrome.tabs.update(tab.id, { url: item.url });
        openedTabId = updated.id;
      } else {
        const created = await chrome.tabs.create({ url: item.url, active: behavior === "new_tab" });
        openedTabId = created.id;
      }
      const status = ["new", "error"].includes(item.status) ? "opened" : item.status;
      await db.queuedJobUrls.put({ ...item, status, openedAt: timestamp, updatedAt: timestamp, error: undefined });
      setCurrentQueueId(item.id);
      await refresh();
      if (settings.queueAutoScanAfterOpening && openedTabId !== undefined) {
        await waitForTabComplete(openedTabId);
      }
      setNotice({
        tone: "info",
        text: settings.queueAutoScanAfterOpening
          ? "Page opened. Wait for it to load, then click Scan Page. ApplyOS will not scan silently."
          : "Page opened. Click Scan Page when you are ready."
      });
    } catch (error) {
      const message = getErrorMessage(error);
      await db.queuedJobUrls.put({ ...item, status: "error", error: message, updatedAt: new Date().toISOString() });
      await refresh();
      setNotice({ tone: "danger", text: message });
    }
  }

  async function startApplySession(item: QueuedJobUrl) {
    setLoading(true);
    setNotice({
      tone: "info",
      text: "Starting Apply Session: opening the role, waiting for the form, then scanning and filling safe fields."
    });
    try {
      let targetTab = await findExistingTabForUrl(item.normalizedUrl);
      if (targetTab?.id !== undefined) {
        await chrome.tabs.update(targetTab.id, { active: true });
        if (targetTab.windowId !== undefined) {
          await chrome.windows.update(targetTab.windowId, { focused: true });
        }
      } else {
        targetTab = await chrome.tabs.create({ url: item.url, active: true });
      }
      if (targetTab.id === undefined) {
        throw new Error("Chrome did not provide a tab for this application.");
      }

      const timestamp = new Date().toISOString();
      await db.queuedJobUrls.put({
        ...item,
        status: ["new", "error"].includes(item.status) ? "opened" : item.status,
        openedAt: timestamp,
        updatedAt: timestamp,
        error: undefined
      });
      setCurrentQueueId(item.id);
      setActiveTab("detected");
      await refresh();
      await waitForTabComplete(targetTab.id);
      await scanPage(targetTab.id);
    } catch (error) {
      const message = getErrorMessage(error);
      await db.queuedJobUrls.put({
        ...item,
        status: "error",
        error: message,
        updatedAt: new Date().toISOString()
      });
      await refresh();
      setNotice({ tone: "danger", text: message });
    } finally {
      setLoading(false);
    }
  }

  async function updateQueueStatus(item: QueuedJobUrl, status: QueueStatus) {
    const timestamp = new Date().toISOString();
    await db.queuedJobUrls.put({ ...item, status, updatedAt: timestamp, error: undefined });
    if (status === "saved" || status === "applied") {
      const existing = jobs.find((job) => sameJobUrl(job.sourceUrl, item.normalizedUrl));
      await db.trackedJobs.put({
        id: existing?.id ?? crypto.randomUUID(),
        title: item.title,
        company: item.company,
        location: item.location,
        sourceUrl: item.url,
        platform: item.platform,
        status,
        fitScore: scan && sameJobUrl(scan.jobInfo.sourceUrl, item.normalizedUrl) ? fit : existing?.fitScore,
        notes: item.notes || existing?.notes,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      });
    }
    await refresh();
    setNotice({ tone: "success", text: `Queue item marked ${status.replace(/_/g, " ")}.` });
  }

  async function updateQueueNotes(item: QueuedJobUrl, notes: string) {
    await db.queuedJobUrls.put({ ...item, notes, updatedAt: new Date().toISOString() });
    await refresh();
  }

  async function startQueueReview() {
    const item = queue.find((entry) => ["new", "manual_review"].includes(entry.status)) ?? queue.find(isQueueEligible);
    if (!item) {
      setNotice({ tone: "info", text: "There are no queue items left to review." });
      return;
    }
    setCurrentQueueId(item.id);
    await openQueueItem(item);
  }

  async function moveQueue(direction: 1 | -1) {
    if (!queue.length) return;
    const currentIndex = Math.max(0, queue.findIndex((item) => item.id === currentQueueId));
    let next: QueuedJobUrl | undefined;
    for (let index = currentIndex + direction; index >= 0 && index < queue.length; index += direction) {
      if (isQueueEligible(queue[index])) {
        next = queue[index];
        break;
      }
    }
    if (!next) {
      setNotice({ tone: "info", text: direction > 0 ? "You reached the end of the review queue." : "You reached the beginning of the review queue." });
      return;
    }
    setCurrentQueueId(next.id);
    await openQueueItem(next);
  }

  async function importQueueJson(file: File) {
    try {
      const data = await readJsonFile(file);
      const values = Array.isArray(data) ? data : data.queuedJobUrls;
      if (!Array.isArray(values)) throw new Error("The file does not contain a job URL queue.");
      const existing = new Set(queue.map((item) => item.normalizedUrl));
      const items: QueuedJobUrl[] = [];
      for (const value of values) {
        if (!value || typeof value !== "object" || !("url" in value) || typeof value.url !== "string") continue;
        const normalizedUrl = normalizeJobUrl(value.url, settings.queueDevMode);
        if (existing.has(normalizedUrl)) continue;
        const base = createQueuedJobUrl(normalizedUrl);
        items.push({ ...base, ...(value as Partial<QueuedJobUrl>), id: base.id, url: normalizedUrl, normalizedUrl, hostname: new URL(normalizedUrl).hostname });
        existing.add(normalizedUrl);
      }
      await db.queuedJobUrls.bulkPut(items);
      await refresh();
      setNotice({ tone: "success", text: `Imported ${items.length} queue items.` });
    } catch (error) {
      setNotice({ tone: "danger", text: getErrorMessage(error) });
    }
  }

  async function updateQueueFromScan(result: ScanResult, nextFit: JobFitScore) {
    const normalized = safeNormalizeUrl(result.context.url);
    if (!normalized) return;
    const item = await db.queuedJobUrls.where("normalizedUrl").equals(normalized).first();
    if (!item) return;
    const timestamp = new Date().toISOString();
    await db.queuedJobUrls.put({
      ...item,
      pageType: result.pageType,
      platform: queuePlatformFromScan(result.platform, item.platform),
      status: "scanned",
      title: result.jobInfo.title,
      company: result.jobInfo.company,
      location: result.jobInfo.location,
      fitScore: nextFit.overallScore,
      fitRecommendation: nextFit.recommendation,
      scannedAt: timestamp,
      updatedAt: timestamp,
      error: undefined
    });
    setCurrentQueueId(item.id);
    await refresh();
  }

  async function markCurrentQueueError(message: string) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;
      const normalized = safeNormalizeUrl(tab.url);
      if (!normalized) return;
      const item = await db.queuedJobUrls.where("normalizedUrl").equals(normalized).first();
      if (!item) return;
      await db.queuedJobUrls.put({ ...item, status: "error", error: message, updatedAt: new Date().toISOString() });
      await refresh();
    } catch {
      // A scan error should remain the primary message.
    }
  }

  async function updateMatchingQueueStatus(url: string, status: QueueStatus) {
    const normalized = safeNormalizeUrl(url);
    if (!normalized) return;
    const item = await db.queuedJobUrls.where("normalizedUrl").equals(normalized).first();
    if (!item) return;
    await db.queuedJobUrls.put({ ...item, status, updatedAt: new Date().toISOString(), error: undefined });
  }

  const tabContent = {
    detected: (
      <DetectedFieldsTab
        scan={scan}
        scanStale={scanStale}
        fit={fit}
        cvSources={cvSources}
        cvRecommendation={cvRecommendation}
        answers={answers}
        userProfile={userProfile}
        settings={settings}
        suggestions={suggestions}
        loading={loading || aiGenerating}
        aiGenerating={aiGenerating}
        watchDynamic={watchDynamic}
        onWatchDynamic={handleWatchDynamic}
        onScan={handleScan}
        onExtractJobInfo={handleExtractJobInfo}
        onInsert={handleInsert}
        onFocusField={handleFocusField}
        onAutofillSafe={handleAutofillSafe}
        onSaveJob={saveTrackedJob}
        onSmartMatch={handleSmartMatch}
        onSuggestAllAnswers={handleSuggestAllAnswers}
        onSaveCurrentValue={handleSaveCurrentValue}
        onSaveSuggestion={handleSaveSuggestion}
        onSkip={handleSkip}
        onImproveJob={handleImproveJob}
        onRecommendCvWithAi={handleRecommendCvWithAi}
      />
    ),
    queue: (
      <JobQueueTab
        items={queue}
        settings={settings}
        currentQueueId={currentQueueId}
        linkedinBulkOpening={linkedinBulkOpening}
        onOpenLinkedInExternal={openLinkedInExternalRoles}
        onLinkedInPreScreenChange={updateLinkedInPreScreen}
        onImportText={importQueueText}
        onOpen={openQueueItem}
        onStartApplySession={startApplySession}
        onScan={handleScan}
        onStatus={updateQueueStatus}
        onRemove={async (id) => {
          await db.queuedJobUrls.delete(id);
          if (currentQueueId === id) setCurrentQueueId(undefined);
          await refresh();
        }}
        onUpdateNotes={updateQueueNotes}
        onStartReview={startQueueReview}
        onNext={() => moveQueue(1)}
        onPrevious={() => moveQueue(-1)}
        onClearCompleted={async () => {
          if (window.confirm("Clear completed queue items?")) {
            await db.queuedJobUrls
              .where("status")
              .anyOf(["saved", "applied", "skipped", "not_relevant"])
              .delete();
            await refresh();
          }
        }}
        onClearQueue={async () => {
          if (window.confirm("Clear the entire job URL queue?")) {
            await db.queuedJobUrls.clear();
            setCurrentQueueId(undefined);
            await refresh();
          }
        }}
        onExportJson={() => downloadJson("applyos-job-queue.json", queue)}
        onExportCsv={() =>
          downloadText("applyos-job-queue.csv", queueToCsv(queue), "text/csv")
        }
        onImportJson={importQueueJson}
      />
    ),
    answers: (
      <AnswerBankTab
        answers={answers}
        onSave={async (answer) => {
          await db.savedAnswers.put(answer);
          await refresh();
        }}
        onDelete={async (id) => {
          if (window.confirm("Delete this saved answer?")) {
            await db.savedAnswers.delete(id);
            await refresh();
          }
        }}
        onClearAll={clearAllAnswers}
        onCleanup={cleanupAnswers}
        onExport={exportAnswerBank}
        onImport={importAnswers}
      />
    ),
    experience: (
      <ExperienceProfileTab
        profile={experience}
        database={experienceDatabase}
        cvSources={cvSources}
        settings={settings}
        loading={loading}
        onExtractFile={extractTextFromResumeFile}
        onParse={handleParseExperience}
        onSave={async (profile) => {
          await db.experienceProfile.put(profile);
          await refresh();
        }}
        onDelete={async () => {
          if (window.confirm("Delete your Experience Profile?")) {
            await db.experienceProfile.delete("default");
            await refresh();
          }
        }}
        onExport={() => downloadJson("applyos-experience-profile.json", experience ?? EMPTY_EXPERIENCE_PROFILE)}
        onImport={importExperience}
        onImportCvs={importCvSources}
        onBuildDatabase={rebuildExperienceDatabase}
        onSaveDatabaseMarkdown={saveExperienceDatabaseMarkdown}
        onImportDatabaseMarkdown={importExperienceDatabaseMarkdown}
        onExportDatabaseMarkdown={exportExperienceDatabaseMarkdown}
        onClearCvSources={clearCvSources}
        onSaveCv={saveCvSource}
        onSummarizeCv={summarizeCvSource}
      />
    ),
    profile: <ProfileTab profile={userProfile} onSave={async (profile) => { await db.userProfile.put({ ...profile, id: "default" }); await refresh(); setNotice({ tone: "success", text: "Profile saved locally." }); }} />,
    jobs: <JobsTab jobs={jobs} onSave={async (job) => { await db.trackedJobs.put(job); await refresh(); }} onDelete={async (id) => { if (window.confirm("Delete this tracked job?")) { await db.trackedJobs.delete(id); await refresh(); } }} />,
    settings: <SettingsTab settings={settings} onSave={async (value) => { await db.settings.put({ ...value, id: "default" }); await refresh(); setNotice({ tone: "success", text: "Settings saved locally." }); }} onExportAll={async () => downloadJson("applyos-local-backup.json", await exportAllData())} onImportAll={importAll} onClear={async () => { if (window.confirm("Clear all local ApplyOS data? This cannot be undone.")) { await clearAllData(); setScan(undefined); setFit(undefined); setSuggestions({}); await refresh(); } }} />
  }[activeTab];

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark">A</div>
        <div><strong>ApplyOS</strong><span>Filter first. Assistant second.</span></div>
        <div
          className={`privacy-dot ${settings.localOnlyMode ? "is-local" : "is-ai"}`}
          role="status"
          aria-label={settings.localOnlyMode ? "Local-only mode enabled" : "OpenRouter available"}
          title={settings.localOnlyMode ? "Local-only mode" : "OpenRouter available"}
        />
      </header>
      <nav className="tabs tabs-seven" aria-label="ApplyOS sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            className={activeTab === id ? "active" : ""}
            aria-current={activeTab === id ? "page" : undefined}
            onClick={() => setActiveTab(id)}
            title={label}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <main>
        {aiGenerating ? (
          <LoadingPanel
            label={aiGeneratingLabel ?? "AI is thinking…"}
            detail="OpenRouter is drafting answers from your experience. This usually takes 10–30 seconds."
            onCancel={cancelAiRequest}
          />
        ) : null}
        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
        {tabContent}
      </main>
    </div>
  );
}

type LinkedInOpenOutcome =
  | {
      kind: "opened";
      job: LinkedInSearchJob;
      url: string;
      tabId: number;
      fit?: JobFitScore;
    }
  | { kind: "easy_apply"; job: LinkedInSearchJob }
  | { kind: "filtered"; job: LinkedInSearchJob; fit: JobFitScore }
  | { kind: "manual_fallback"; job: LinkedInSearchJob; tabId: number }
  | { kind: "unavailable"; job: LinkedInSearchJob; reason: string }
  | { kind: "error"; job: LinkedInSearchJob; reason: string };

async function inspectLinkedInJob(
  job: LinkedInSearchJob,
  options: {
    experience?: ExperienceProfile;
    minimumFit?: number;
  } = {}
): Promise<LinkedInOpenOutcome> {
  let detailsTabId: number | undefined;
  let fit: JobFitScore | undefined;
  try {
    const detailsTab = await chrome.tabs.create({ url: job.detailsUrl, active: false });
    if (detailsTab.id === undefined) throw new Error("Chrome did not create the LinkedIn role tab.");
    detailsTabId = detailsTab.id;
    await waitForTabComplete(detailsTabId);

    if (options.experience && options.minimumFit !== undefined) {
      const extracted = await sendToTab<ExtractedJobPayload>(detailsTabId, {
        type: "EXTRACT_JOB_INFO"
      });
      if (isThinJobInfo(extracted.jobInfo)) {
        await closeTab(detailsTabId);
        return {
          kind: "unavailable",
          job,
          reason: "The LinkedIn description was too limited to calculate a reliable fit score."
        };
      }
      fit = calculateJobFit(extracted.jobInfo, options.experience);
      if (fit.overallScore < options.minimumFit) {
        await closeTab(detailsTabId);
        return { kind: "filtered", job, fit };
      }
    }

    const target = await sendToTab<LinkedInApplyTarget>(detailsTabId, {
      type: "GET_LINKEDIN_APPLY_TARGET"
    });
    if (target.kind === "easy_apply") {
      await closeTab(detailsTabId);
      return { kind: "easy_apply", job };
    }
    if (target.kind === "unavailable") {
      await closeTab(detailsTabId);
      return { kind: "unavailable", job, reason: target.reason };
    }
    if (target.kind === "external_url") {
      await chrome.tabs.update(detailsTabId, { url: target.url, active: false });
      return { kind: "opened", job, url: target.url, tabId: detailsTabId, fit };
    }

    const navigation = watchForApplyNavigation(detailsTabId, job.detailsUrl);
    const clickResult = await sendToTab<{ clicked: boolean; reason?: string }>(detailsTabId, {
      type: "CLICK_LINKEDIN_EXTERNAL_APPLY"
    });
    if (!clickResult.clicked) {
      navigation.cancel();
      await closeTab(detailsTabId);
      return {
        kind: "unavailable",
        job,
        reason: clickResult.reason ?? "LinkedIn did not open the external application."
      };
    }

    const navigatedTabId = await navigation.promise;
    if (navigatedTabId === undefined) {
      // Some LinkedIn button handlers reject synthetic clicks. Leaving this
      // detail page open still removes the need to find/click its list card.
      return { kind: "manual_fallback", job, tabId: detailsTabId };
    }

    const navigatedUrl = await waitForExternalTabDestination(navigatedTabId);
    if (navigatedUrl && isExternalToLinkedIn(navigatedUrl)) {
      if (navigatedTabId !== detailsTabId) await closeTab(detailsTabId);
      return { kind: "opened", job, url: navigatedUrl, tabId: navigatedTabId, fit };
    }

    if (navigatedTabId !== detailsTabId) await closeTab(navigatedTabId);
    return { kind: "manual_fallback", job, tabId: detailsTabId };
  } catch (error) {
    if (detailsTabId !== undefined) await closeTab(detailsTabId);
    return { kind: "error", job, reason: getErrorMessage(error) };
  }
}

function watchForApplyNavigation(
  sourceTabId: number,
  sourceUrl: string
): { promise: Promise<number | undefined>; cancel: () => void } {
  let finish: (tabId?: number) => void = () => undefined;
  const promise = new Promise<number | undefined>((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => done(), 4_000);
    const onCreated = (tab: chrome.tabs.Tab) => {
      if (tab.openerTabId === sourceTabId && tab.id !== undefined) done(tab.id);
    };
    const onUpdated = (
      tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (
        tabId === sourceTabId &&
        changeInfo.url &&
        !samePageUrl(changeInfo.url, sourceUrl)
      ) {
        done(tabId);
      }
    };
    function done(tabId?: number) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tabId);
    }
    finish = done;
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  return { promise, cancel: () => finish() };
}

async function closeTab(tabId: number): Promise<void> {
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

async function waitForExternalTabDestination(
  tabId: number,
  timeoutMs = 10_000
): Promise<string | undefined> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab) return undefined;
    const candidates = [tab.pendingUrl, tab.url].filter(
      (value): value is string => Boolean(value)
    );
    const external = candidates.find(isExternalToLinkedIn);
    if (external) return external;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return undefined;
}

async function findExistingTabForUrl(
  normalizedUrl: string
): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => {
    const candidate = tab.url ?? tab.pendingUrl;
    return candidate ? sameJobUrl(candidate, normalizedUrl) : false;
  });
}

async function groupApplySessionTabs(tabIds: number[]): Promise<void> {
  const uniqueIds = [...new Set(tabIds)];
  if (!uniqueIds.length) return;

  const tabs = (
    await Promise.all(
      uniqueIds.map((tabId) => chrome.tabs.get(tabId).catch(() => undefined))
    )
  ).filter((tab): tab is chrome.tabs.Tab => Boolean(tab?.id));
  const tabsByWindow = new Map<number, number[]>();
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const current = tabsByWindow.get(tab.windowId) ?? [];
    current.push(tab.id);
    tabsByWindow.set(tab.windowId, current);
  }

  await Promise.all(
    [...tabsByWindow.values()].map(async (windowTabIds) => {
      try {
        const groupId = await chrome.tabs.group({ tabIds: windowTabIds });
        await chrome.tabGroups.update(groupId, {
          title: "ApplyOS Session",
          color: "orange",
          collapsed: false
        });
      } catch {
        // Tab grouping is a convenience. Keep the opened tabs if Chrome cannot
        // group them (for example, in a window type that does not support groups).
      }
    })
  );
}

function countOutcome(outcomes: LinkedInOpenOutcome[], kind: LinkedInOpenOutcome["kind"]): number {
  return outcomes.filter((outcome) => outcome.kind === kind).length;
}

function isLinkedInJobsUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      /(^|\.)linkedin\.com$/i.test(url.hostname) &&
      url.pathname.startsWith("/jobs")
    );
  } catch {
    return false;
  }
}

function isExternalToLinkedIn(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !/(^|\.)linkedin\.com$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function samePageUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = "";
    rightUrl.hash = "";
    return leftUrl.toString() === rightUrl.toString();
  } catch {
    return left === right;
  }
}

function safeNormalizeUrl(url: string): string | undefined {
  try {
    return normalizeJobUrl(url, true);
  } catch {
    return undefined;
  }
}

function sameJobUrl(left: string, right: string): boolean {
  return safeNormalizeUrl(left) === safeNormalizeUrl(right);
}

function isQueueEligible(item: QueuedJobUrl): boolean {
  return !["saved", "applied", "skipped", "not_relevant"].includes(item.status);
}

function queuePlatformFromScan(
  platform: string,
  fallback: QueuedJobUrl["platform"]
): QueuedJobUrl["platform"] {
  const supported: QueuedJobUrl["platform"][] = [
    "ashby",
    "greenhouse",
    "lever",
    "workable",
    "workday",
    "smartrecruiters",
    "bamboohr",
    "recruitee",
    "teamtailor",
    "icims",
    "custom_careers",
    "unknown"
  ];
  return supported.includes(platform as QueuedJobUrl["platform"])
    ? (platform as QueuedJobUrl["platform"])
    : fallback === "unknown"
      ? "unknown"
      : fallback;
}

async function waitForTabComplete(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(done, 15_000);
    function done() {
      window.clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") done();
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function answerCategory(category?: DetectedField["category"]): SavedAnswer["category"] {
  if (category === "work_authorization" || category === "legal_authorization") return "work_auth";
  if (category === "visa_sponsorship") return "visa_sponsorship";
  if (category === "salary") return "salary";
  if (category === "relocation") return "relocation";
  if (
    category &&
    ["why_company", "why_role", "about_me", "hard_problem", "leadership", "conflict", "portfolio"].includes(category)
  ) {
    return category as SavedAnswer["category"];
  }
  return "custom";
}

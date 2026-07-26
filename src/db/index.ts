import Dexie, { type Table } from "dexie";
import starterExperienceDatabase from "./starterExperienceDatabase.md?raw";
import { DEFAULT_JOB_SEARCH_CONTEXT } from "../shared/defaultJobSearchContext";
import {
  DEFAULT_SETTINGS,
  EMPTY_EXPERIENCE_DATABASE,
  type CvSource,
  type JobListingCache,
  type ExperienceDatabase,
  type ExperienceProfile,
  type QueuedJobUrl,
  type SavedAnswer,
  type ScanHistory,
  type Settings,
  type TrackedJob,
  type UserProfile
} from "../shared/types";
import { normalizeText } from "../matching/normalize";
import { cleanupStoredAnswerBank } from "../shared/answerBankCleanup";
import { ensureCvLibrarySeeded } from "./seedCvLibrary";

class ApplyOSDatabase extends Dexie {
  experienceProfile!: Table<ExperienceProfile, string>;
  experienceDatabase!: Table<ExperienceDatabase, string>;
  cvSources!: Table<CvSource, string>;
  userProfile!: Table<UserProfile & { id: "default" }, string>;
  savedAnswers!: Table<SavedAnswer, string>;
  settings!: Table<Settings & { id: "default" }, string>;
  trackedJobs!: Table<TrackedJob, string>;
  scanHistory!: Table<ScanHistory, string>;
  queuedJobUrls!: Table<QueuedJobUrl, string>;
  jobListingCache!: Table<JobListingCache, string>;

  constructor() {
    super("applyos");
    this.version(1).stores({
      experienceProfile: "id, parsedAt",
      userProfile: "id",
      savedAnswers: "id, category, source, updatedAt, *tags",
      settings: "id",
      trackedJobs: "id, status, company, title, updatedAt",
      scanHistory: "id, url, pageType, platform, scannedAt"
    });
    this.version(2).stores({
      experienceProfile: "id, parsedAt",
      userProfile: "id",
      savedAnswers: "id, category, source, updatedAt, *tags",
      settings: "id",
      trackedJobs: "id, status, company, title, updatedAt",
      scanHistory: "id, url, pageType, platform, scannedAt",
      queuedJobUrls: "id, &normalizedUrl, status, platform, company, fitScore, createdAt, updatedAt"
    });
    this.version(3).stores({
      experienceProfile: "id, parsedAt",
      experienceDatabase: "id, updatedAt",
      cvSources: "id, fileName, importedAt",
      userProfile: "id",
      savedAnswers: "id, category, source, updatedAt, *tags",
      settings: "id",
      trackedJobs: "id, status, company, title, updatedAt",
      scanHistory: "id, url, pageType, platform, scannedAt",
      queuedJobUrls: "id, &normalizedUrl, status, platform, company, fitScore, createdAt, updatedAt"
    });
    this.version(4).stores({
      experienceProfile: "id, parsedAt",
      experienceDatabase: "id, updatedAt",
      cvSources: "id, fileName, importedAt",
      userProfile: "id",
      savedAnswers: "id, category, source, updatedAt, *tags",
      settings: "id",
      trackedJobs: "id, status, company, title, updatedAt",
      scanHistory: "id, url, pageType, platform, scannedAt",
      queuedJobUrls: "id, &normalizedUrl, status, platform, company, fitScore, createdAt, updatedAt",
      jobListingCache: "id, listingUrl, extractedAt, platform"
    });
  }
}

export const db = new ApplyOSDatabase();

const now = () => new Date().toISOString();
const MAX_SCAN_HISTORY_ROWS = 250;

const SAMPLE_ANSWERS: SavedAnswer[] = [
  {
    id: "sample-why-role",
    title: "Why this role",
    category: "why_role",
    originalQuestion: "Why are you interested in this role?",
    normalizedQuestion: normalizeText("Why are you interested in this role?"),
    answer:
      "Replace this sample with your own documented reason for pursuing a role before inserting it into an application.",
    tags: ["motivation", "role"],
    roleTypes: [],
    companiesUsedFor: [],
    source: "manual",
    timesUsed: 0,
    createdAt: now(),
    updatedAt: now()
  },
  {
    id: "sample-about-me",
    title: "Short professional summary",
    category: "about_me",
    originalQuestion: "Tell us about yourself.",
    normalizedQuestion: normalizeText("Tell us about yourself."),
    answer:
      "Use this entry as a template only. Replace it with a concise summary grounded in your Experience Profile before inserting it into an application.",
    tags: ["summary", "introduction"],
    roleTypes: [],
    companiesUsedFor: [],
    source: "manual",
    timesUsed: 0,
    createdAt: now(),
    updatedAt: now()
  }
];

export async function initializeDatabase(): Promise<void> {
  await db.open();
  const settings = await db.settings.get("default");
  const isNewDatabase = !settings;
  if (!settings) {
    await db.settings.put({ ...DEFAULT_SETTINGS, id: "default" });
  } else {
    const merged = { ...DEFAULT_SETTINGS, ...settings, id: "default" as const };
    if (!merged.jobSearchContext?.trim()) {
      merged.jobSearchContext = DEFAULT_JOB_SEARCH_CONTEXT;
    }
    await db.settings.put(merged);
  }
  const savedAnswerCount = await db.savedAnswers.count();
  if (isNewDatabase && savedAnswerCount === 0) {
    await db.savedAnswers.bulkPut(SAMPLE_ANSWERS);
  } else if (savedAnswerCount > 0) {
    await cleanupStoredAnswerBank(
      () => db.savedAnswers.toArray(),
      async (answers) => {
        await db.transaction("rw", db.savedAnswers, async () => {
          await db.savedAnswers.clear();
          if (answers.length) await db.savedAnswers.bulkPut(answers);
        });
      }
    );
  }
  const experienceDatabase = await db.experienceDatabase.get("default");
  if (!experienceDatabase?.markdown?.trim()) {
    await db.experienceDatabase.put({
      ...EMPTY_EXPERIENCE_DATABASE,
      markdown: starterExperienceDatabase.trim(),
      sourceFiles: [],
      updatedAt: now(),
      generatedWithOpenRouter: false
    });
  }

  await ensureCvLibrarySeeded(
    () => db.cvSources.toArray(),
    async (source) => {
      await db.cvSources.put(source);
    }
  );
}

export async function exportAllData(): Promise<Record<string, unknown>> {
  const settings = (await db.settings.toArray()).map(({ openRouterApiKey: _secret, ...value }) => value);
  return {
    exportedAt: now(),
    version: 4,
    secretsOmitted: ["settings.openRouterApiKey"],
    experienceProfile: await db.experienceProfile.toArray(),
    experienceDatabase: await db.experienceDatabase.toArray(),
    cvSources: await db.cvSources.toArray(),
    jobListingCache: await db.jobListingCache.toArray(),
    userProfile: await db.userProfile.toArray(),
    savedAnswers: await db.savedAnswers.toArray(),
    settings,
    trackedJobs: await db.trackedJobs.toArray(),
    scanHistory: await db.scanHistory.toArray(),
    queuedJobUrls: await db.queuedJobUrls.toArray()
  };
}

export async function importAllData(data: Record<string, unknown>): Promise<void> {
  const currentSettings = await db.settings.get("default");
  const importedSettings = Array.isArray(data.settings)
    ? data.settings.map((value) => {
        if (!value || typeof value !== "object") return value;
        const record = value as Record<string, unknown>;
        if ("openRouterApiKey" in record || !currentSettings?.openRouterApiKey) return record;
        return { ...record, openRouterApiKey: currentSettings.openRouterApiKey };
      })
    : data.settings;

  await db.transaction(
    "rw",
    [
      db.experienceProfile,
      db.experienceDatabase,
      db.cvSources,
      db.userProfile,
      db.savedAnswers,
      db.settings,
      db.trackedJobs,
      db.scanHistory,
      db.queuedJobUrls,
      db.jobListingCache
    ],
    async () => {
      const mappings: Array<[Table<unknown, string>, unknown]> = [
        [db.experienceProfile as Table<unknown, string>, data.experienceProfile],
        [db.experienceDatabase as Table<unknown, string>, data.experienceDatabase],
        [db.cvSources as Table<unknown, string>, data.cvSources],
        [db.jobListingCache as Table<unknown, string>, data.jobListingCache],
        [db.userProfile as Table<unknown, string>, data.userProfile],
        [db.savedAnswers as Table<unknown, string>, data.savedAnswers],
        [db.settings as Table<unknown, string>, importedSettings],
        [db.trackedJobs as Table<unknown, string>, data.trackedJobs],
        [db.scanHistory as Table<unknown, string>, data.scanHistory],
        [db.queuedJobUrls as Table<unknown, string>, data.queuedJobUrls]
      ];

      for (const [table, value] of mappings) {
        if (Array.isArray(value)) {
          await table.clear();
          await table.bulkPut(value);
        }
      }
    }
  );
}

export async function clearAllData(): Promise<void> {
  await db.delete();
  await initializeDatabase();
}

export async function pruneScanHistory(): Promise<void> {
  const staleIds = await db.scanHistory
    .orderBy("scannedAt")
    .reverse()
    .offset(MAX_SCAN_HISTORY_ROWS)
    .primaryKeys();
  if (staleIds.length) await db.scanHistory.bulkDelete(staleIds);
}

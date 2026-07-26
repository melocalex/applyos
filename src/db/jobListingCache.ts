import type { JobInfo, JobListingCache, PageType } from "../shared/types";
import { isThinJobInfo, mergeJobInfo } from "../adapters/listingResolver";
import { db } from "./index";

const MAX_JOB_LISTING_CACHE_ROWS = 150;

export async function saveJobListingCache(entry: {
  listingKey: string;
  listingUrl: string;
  extractedFromUrl: string;
  jobInfo: JobInfo;
  platform: string;
  pageType: PageType;
}): Promise<JobListingCache> {
  const record: JobListingCache = {
    id: entry.listingKey,
    listingUrl: entry.listingUrl,
    extractedFromUrl: entry.extractedFromUrl,
    jobInfo: entry.jobInfo,
    platform: entry.platform,
    pageType: entry.pageType,
    extractedAt: new Date().toISOString()
  };
  await db.jobListingCache.put(record);
  const staleIds = await db.jobListingCache
    .orderBy("extractedAt")
    .reverse()
    .offset(MAX_JOB_LISTING_CACHE_ROWS)
    .primaryKeys();
  if (staleIds.length) await db.jobListingCache.bulkDelete(staleIds);
  return record;
}

export async function loadJobListingCache(listingKey: string): Promise<JobListingCache | undefined> {
  return db.jobListingCache.get(listingKey);
}

export async function mergeWithStoredJobInfo(
  listingKey: string,
  jobInfo: JobInfo
): Promise<{ jobInfo: JobInfo; fromStored: boolean }> {
  const stored = await loadJobListingCache(listingKey);
  if (!stored || isThinJobInfo(stored.jobInfo)) {
    return { jobInfo, fromStored: false };
  }
  return {
    jobInfo: mergeJobInfo(stored.jobInfo, {
      ...jobInfo,
      listingSourceUrl: stored.listingUrl
    }),
    fromStored: true
  };
}

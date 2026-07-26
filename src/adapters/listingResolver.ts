import type { JobInfo, PageContext } from "../shared/types";

const LISTING_SUFFIXES = ["/application", "/apply", "/form"];
const WORKDAY_FLOW_SUFFIXES = [/\/apply\/applymanually\/?$/i, /\/login\/?$/i];

function stripKnownFlowSuffix(url: URL): boolean {
  for (const suffix of LISTING_SUFFIXES) {
    if (url.pathname.toLowerCase().endsWith(suffix)) {
      url.pathname = url.pathname.slice(0, -suffix.length) || "/";
      return true;
    }
  }
  if (/myworkdayjobs\.com$|myworkdaysite\.com$/i.test(url.hostname)) {
    for (const pattern of WORKDAY_FLOW_SUFFIXES) {
      if (!pattern.test(url.pathname)) continue;
      url.pathname = url.pathname.replace(pattern, "") || "/";
      return true;
    }
  }
  return false;
}

export function resolveListingUrl(context: PageContext): string | undefined {
  try {
    const url = new URL(context.url);
    if (stripKnownFlowSuffix(url)) {
      url.hash = "";
      return url.toString();
    }
    if (context.hostname.includes("ashbyhq.com")) {
      if (/\/application\/?$/i.test(context.pathname)) {
        return context.url.replace(/\/application\/?(?:[?#].*)?$/i, "");
      }
    }
    if (context.hostname.includes("lever.co") && /\/apply\/?$/i.test(context.pathname)) {
      return context.url.replace(/\/apply\/?(?:[?#].*)?$/i, "");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function jobListingCacheKey(url: string): string {
  try {
    const parsed = new URL(url);
    stripKnownFlowSuffix(parsed);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("#")[0].replace(/\/application\/?$/i, "").replace(/\/apply\/?$/i, "");
  }
}

export function isThinJobInfo(job: JobInfo): boolean {
  const descriptionLength = job.description?.trim().length ?? 0;
  const structured =
    job.requirements.length + job.responsibilities.length + job.niceToHave.length;
  return structured < 2 && descriptionLength < 400;
}

export function mergeJobInfo(primary: JobInfo, secondary: JobInfo): JobInfo {
  const pickText = (left?: string, right?: string) =>
    (left && left.trim().length > (right?.trim().length ?? 0) ? left : right) || left || right;

  const pickList = (left: string[], right: string[]) =>
    left.length >= right.length ? left : right;

  return {
    ...secondary,
    ...primary,
    title: pickText(primary.title, secondary.title),
    company: pickText(primary.company, secondary.company),
    location: pickText(primary.location, secondary.location),
    department: pickText(primary.department, secondary.department),
    employmentType: pickText(primary.employmentType, secondary.employmentType),
    description: pickText(primary.description, secondary.description),
    requirements: pickList(primary.requirements, secondary.requirements),
    responsibilities: pickList(primary.responsibilities, secondary.responsibilities),
    niceToHave: pickList(primary.niceToHave, secondary.niceToHave),
    benefits: pickList(primary.benefits ?? [], secondary.benefits ?? []),
    salaryRange: pickText(primary.salaryRange, secondary.salaryRange),
    sourceUrl: primary.sourceUrl,
    listingSourceUrl: primary.listingSourceUrl ?? secondary.listingSourceUrl,
    platform: primary.platform,
    detectedAt: primary.detectedAt
  };
}

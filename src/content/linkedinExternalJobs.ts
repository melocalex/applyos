import type {
  LinkedInApplyTarget,
  LinkedInSearchJob,
  LinkedInSearchJobsResponse
} from "../shared/types";

const LINKEDIN_HOST_PATTERN = /(^|\.)linkedin\.com$/i;
const JOB_ID_PATH_PATTERN =
  /\/jobs\/view\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/i;
const APPLY_CONTROL_SELECTOR = [
  ".jobs-apply-button--top-card",
  ".jobs-apply-button",
  "[data-live-test-job-apply-button]",
  "a[href*='/jobs/view/'][aria-label*='apply' i]",
  "button[aria-label*='apply' i]"
].join(",");

export function collectLinkedInSearchJobs(
  limit = 20,
  root: ParentNode = document
): LinkedInSearchJobsResponse {
  assertLinkedInJobsPage();
  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit) || 20));
  const listRoot =
    root.querySelector<HTMLElement>(".jobs-search-results-list") ??
    root.querySelector<HTMLElement>(".jobs-search-results__list") ??
    root.querySelector<HTMLElement>(".scaffold-layout__list") ??
    root.querySelector<HTMLElement>("[aria-label*='job search results' i]") ??
    root;
  const cards = Array.from(
    listRoot.querySelectorAll<HTMLElement>(
      "li[data-occludable-job-id], li[data-job-id], .jobs-search-results__list-item, .job-card-container"
    )
  );
  const jobsById = new Map<string, LinkedInSearchJob>();

  for (const card of cards) {
    const anchor = card.querySelector<HTMLAnchorElement>(
      "a.job-card-list__title--link, a.job-card-container__link, a[href*='/jobs/view/']"
    );
    const jobId = firstJobId(
      card.dataset.occludableJobId,
      card.dataset.jobId,
      anchor?.href,
      card.querySelector<HTMLElement>("[data-job-id]")?.dataset.jobId
    );
    if (!jobId || jobsById.has(jobId)) continue;

    jobsById.set(jobId, {
      jobId,
      detailsUrl: new URL(`/jobs/view/${jobId}/`, window.location.origin).toString(),
      title: readText(
        card,
        ".job-card-list__title--link, .job-card-list__title, .job-card-container__link, a[href*='/jobs/view/']"
      ),
      company: readText(
        card,
        ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-list__company-name"
      ),
      location: readText(
        card,
        ".job-card-container__metadata-item, .artdeco-entity-lockup__caption"
      )
    });
  }

  // LinkedIn occasionally changes the card wrapper while keeping stable job
  // links. This fallback stays scoped to the search-results column.
  if (!jobsById.size) {
    const anchors = listRoot.querySelectorAll<HTMLAnchorElement>("a[href*='/jobs/view/']");
    for (const anchor of anchors) {
      const jobId = firstJobId(anchor.href);
      if (!jobId || jobsById.has(jobId)) continue;
      const card =
        anchor.closest<HTMLElement>("li, .job-card-container, [data-job-id]") ?? anchor;
      jobsById.set(jobId, {
        jobId,
        detailsUrl: new URL(`/jobs/view/${jobId}/`, window.location.origin).toString(),
        title: cleanText(anchor.textContent),
        company: readText(
          card,
          ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-list__company-name"
        ),
        location: readText(
          card,
          ".job-card-container__metadata-item, .artdeco-entity-lockup__caption"
        )
      });
    }
  }

  const allJobs = [...jobsById.values()];
  return {
    jobs: allJobs.slice(0, safeLimit),
    totalFound: allJobs.length,
    limit: safeLimit
  };
}

export async function waitForLinkedInApplyTarget(
  timeoutMs = 8_000
): Promise<LinkedInApplyTarget> {
  assertLinkedInJobsPage();
  const startedAt = Date.now();
  let lastResult: LinkedInApplyTarget = {
    kind: "unavailable",
    reason: "No Apply control was found for this LinkedIn role."
  };

  while (Date.now() - startedAt < timeoutMs) {
    lastResult = findLinkedInApplyTarget();
    if (lastResult.kind !== "unavailable") return lastResult;
    await delay(300);
  }
  return lastResult;
}

export function findLinkedInApplyTarget(root: ParentNode = document): LinkedInApplyTarget {
  const scope =
    root.querySelector<HTMLElement>(".jobs-details") ??
    root.querySelector<HTMLElement>(".job-view-layout") ??
    root.querySelector<HTMLElement>("main") ??
    root;
  const controls = Array.from(scope.querySelectorAll<HTMLElement>(APPLY_CONTROL_SELECTOR));

  for (const control of controls) {
    if (!isVisible(control)) continue;
    const label = controlDescriptor(control);
    const classification = classifyLinkedInApplyDescriptor(label);
    if (classification === "easy_apply") return { kind: "easy_apply", label };
    if (classification !== "external") continue;

    const rawUrl = readControlUrl(control);
    const externalUrl = rawUrl ? unwrapLinkedInExternalUrl(rawUrl) : undefined;
    return externalUrl
      ? { kind: "external_url", url: externalUrl, label }
      : { kind: "external_button", label };
  }

  return {
    kind: "unavailable",
    reason: "No external Apply control was found for this LinkedIn role."
  };
}

export function clickLinkedInExternalApply(
  root: ParentNode = document
): { clicked: boolean; reason?: string } {
  const target = findLinkedInApplyTarget(root);
  if (target.kind === "easy_apply") {
    return { clicked: false, reason: "Easy Apply is intentionally skipped." };
  }
  if (target.kind !== "external_button") {
    return {
      clicked: false,
      reason:
        target.kind === "external_url"
          ? "This Apply control already exposes its destination URL."
          : target.reason
    };
  }

  const scope =
    root.querySelector<HTMLElement>(".jobs-details") ??
    root.querySelector<HTMLElement>(".job-view-layout") ??
    root.querySelector<HTMLElement>("main") ??
    root;
  const control = Array.from(
    scope.querySelectorAll<HTMLElement>(APPLY_CONTROL_SELECTOR)
  ).find((candidate) => {
    if (!isVisible(candidate)) return false;
    return classifyLinkedInApplyDescriptor(controlDescriptor(candidate)) === "external";
  });
  if (!control) return { clicked: false, reason: "The external Apply control disappeared." };

  control.click();
  return { clicked: true };
}

export function extractLinkedInJobId(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const urnMatch = trimmed.match(/(?:^|:)(\d+)$/);
  if (urnMatch?.[1]) return urnMatch[1];
  const pathMatch = trimmed.match(JOB_ID_PATH_PATTERN);
  if (pathMatch?.[1]) return pathMatch[1];
  try {
    const parsed = new URL(trimmed, "https://www.linkedin.com");
    const currentJobId = parsed.searchParams.get("currentJobId");
    return currentJobId && /^\d+$/.test(currentJobId) ? currentJobId : undefined;
  } catch {
    return undefined;
  }
}

export function classifyLinkedInApplyDescriptor(
  value: string
): "easy_apply" | "external" | "unknown" {
  const normalized = cleanText(value)?.toLowerCase() ?? "";
  if (!normalized.includes("apply")) return "unknown";
  if (normalized.includes("easy apply")) return "easy_apply";
  if (
    normalized.includes("company website") ||
    normalized.includes("external") ||
    /^apply(?:\s|$)/.test(normalized)
  ) {
    return "external";
  }
  return "unknown";
}

export function unwrapLinkedInExternalUrl(value: string): string | undefined {
  let parsed: URL;
  try {
    const baseUrl =
      typeof window === "undefined"
        ? "https://www.linkedin.com/jobs/"
        : window.location.href;
    parsed = new URL(value, baseUrl);
  } catch {
    return undefined;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
  if (!LINKEDIN_HOST_PATTERN.test(parsed.hostname)) return parsed.toString();

  const redirectKeys = [
    "url",
    "target",
    "redirect",
    "redirectUrl",
    "destination",
    "externalUrl"
  ];
  for (const key of redirectKeys) {
    const candidate = parsed.searchParams.get(key);
    if (!candidate) continue;
    try {
      const decoded = decodeURIComponent(candidate);
      const destination = new URL(decoded, parsed);
      if (
        ["http:", "https:"].includes(destination.protocol) &&
        !LINKEDIN_HOST_PATTERN.test(destination.hostname)
      ) {
        return destination.toString();
      }
    } catch {
      // Keep trying other known redirect parameters.
    }
  }
  return undefined;
}

function assertLinkedInJobsPage(): void {
  if (!LINKEDIN_HOST_PATTERN.test(window.location.hostname) || !window.location.pathname.startsWith("/jobs")) {
    throw new Error("Open a LinkedIn Jobs search results page, then try again.");
  }
}

function firstJobId(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const jobId = extractLinkedInJobId(value);
    if (jobId) return jobId;
  }
  return undefined;
}

function readText(root: ParentNode, selector: string): string | undefined {
  return cleanText(root.querySelector(selector)?.textContent);
}

function cleanText(value?: string | null): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function controlDescriptor(control: HTMLElement): string {
  return [
    control.getAttribute("aria-label"),
    control.getAttribute("title"),
    control.textContent
  ]
    .filter(Boolean)
    .join(" ");
}

function readControlUrl(control: HTMLElement): string | undefined {
  const anchor =
    (control instanceof HTMLAnchorElement ? control : undefined) ??
    control.closest<HTMLAnchorElement>("a[href]") ??
    control.querySelector<HTMLAnchorElement>("a[href]");
  return (
    anchor?.href ??
    control.dataset.url ??
    control.dataset.applyUrl ??
    control.dataset.companyApplyUrl ??
    undefined
  );
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getAttribute("aria-hidden") !== "true"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

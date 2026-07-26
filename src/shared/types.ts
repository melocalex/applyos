import type { FieldWidget } from "./profileFieldValue";
import { DEFAULT_JOB_SEARCH_CONTEXT } from "./defaultJobSearchContext";

export type PageType =
  | "job_listing_page"
  | "job_application_form"
  | "company_careers_page"
  | "job_search_results_page"
  | "unknown_page";

export interface PageContext {
  url: string;
  hostname: string;
  pathname: string;
  title: string;
  bodyText: string;
  /** Job listing text with application-form regions removed when both appear on one page. */
  jobPostingText: string;
  hasForms: boolean;
  buttons: string[];
  links: string[];
  /** iframe[src] values from the top document — used to detect embedded ATS forms. */
  iframeSources?: string[];
  meta: Record<string, string>;
  jsonLd: unknown[];
}

export interface JobInfo {
  id?: string;
  title?: string;
  company?: string;
  location?: string;
  department?: string;
  description?: string;
  employmentType?: string;
  requirements: string[];
  responsibilities: string[];
  niceToHave: string[];
  benefits?: string[];
  salaryRange?: string;
  sourceUrl: string;
  listingSourceUrl?: string;
  platform: string;
  detectedAt: string;
}

export type FieldType =
  | "text"
  | "textarea"
  | "email"
  | "url"
  | "tel"
  | "number"
  | "date"
  | "datetime-local"
  | "month"
  | "week"
  | "time"
  | "search"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "unknown";

export type FieldCategory =
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "country"
  | "state"
  | "city"
  | "current_company"
  | "linkedin"
  | "github"
  | "social_profile"
  | "portfolio"
  | "website"
  | "resume"
  | "cover_letter"
  | "additional_file"
  | "why_company"
  | "why_role"
  | "about_me"
  | "hard_problem"
  | "leadership"
  | "conflict"
  | "salary"
  | "relocation"
  | "work_authorization"
  | "visa_sponsorship"
  | "start_date"
  | "custom_question"
  | "gender"
  | "sexual_orientation"
  | "pronouns"
  | "race_ethnicity"
  | "disability"
  | "veteran_status"
  | "age"
  | "legal_authorization"
  | "manual_review"
  | "screening_question"
  | "timezone"
  | "location_eligibility"
  | "previous_employment"
  | "transgender"
  | "voluntary_disclosure";

export interface DetectedField {
  fieldId: string;
  platform: string;
  label: string;
  normalizedLabel: string;
  fieldType: FieldType;
  options?: string[];
  required: boolean;
  value?: string;
  isVisible: boolean;
  isDisabled: boolean;
  selectorHint: string;
  category?: FieldCategory;
  dependsOn?: string[];
  isDynamic?: boolean;
  /** Frame that owns this field when the ATS form is embedded in an iframe. */
  frameId?: number;
  /** How the control behaves for profile/autofill (country picker vs location typeahead, etc.). */
  widget?: FieldWidget;
}

export interface ExperienceRole {
  title: string;
  company: string;
  duration?: string;
  location?: string;
  highlights: string[];
  technologies: string[];
}

export interface ExperienceProject {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
  highlights?: string[];
}

export interface ExperienceProfile {
  id: "default";
  rawText: string;
  sourceType: "pasted_text" | "txt" | "pdf" | "docx";
  parsedAt: string;
  skills: string[];
  companies: string[];
  roles: ExperienceRole[];
  projects: ExperienceProject[];
  education: {
    degree?: string;
    institution: string;
    year?: string;
    details?: string[];
  }[];
  certifications: string[];
  languages: string[];
  links: string[];
}

export interface JobFitScore {
  overallScore: number;
  breakdown: {
    requiredSkills: number;
    experienceLevel: number;
    domainFit: number;
    roleFit: number;
  };
  missingRequirements: string[];
  matchingHighlights: string[];
  recommendation:
    | "strong_fit"
    | "good_fit"
    | "partial_fit"
    | "low_fit"
    | "no_fit";
  reason: string;
}

export interface UserProfile {
  id?: "default";
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  country?: string;
  state?: string;
  city?: string;
  /** Full location line for free-text fields (e.g. "Florianópolis, Brazil" or "Remote"). */
  location?: string;
  /** Current / most recent employer for "Current company" application fields. */
  currentCompany?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  websiteUrl?: string;
  workAuthorization?: string;
  visaSponsorship?: string;
  salaryExpectation?: string;
  startDate?: string;
  /** School / university for "Where did you go for college?" style questions. */
  education?: string;
  /** Default for "How did you hear about us?" (e.g. LinkedIn). */
  referralSource?: string;
  /** Default Yes/No for in-office / on-site preference questions. */
  inOfficePreference?: string;
}

export type AnswerCategory =
  | "why_company"
  | "why_role"
  | "about_me"
  | "hard_problem"
  | "leadership"
  | "conflict"
  | "salary"
  | "relocation"
  | "work_auth"
  | "visa_sponsorship"
  | "portfolio"
  | "custom";

export interface SavedAnswer {
  id: string;
  title: string;
  category: AnswerCategory;
  originalQuestion: string;
  normalizedQuestion: string;
  answer: string;
  tags: string[];
  roleTypes: string[];
  companiesUsedFor: string[];
  source: "manual" | "generated_from_cv" | "imported";
  derivedFromRole?: string;
  derivedFromProject?: string;
  isNoFit?: boolean;
  timesUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnswerSuggestion {
  questionFieldId: string;
  source: "answer_bank" | "experience_profile" | "no_fit" | "manual";
  answer?: string;
  savedAnswerId?: string;
  sourceExperience?: string;
  confidence: number;
  reason?: string;
  requiresEditBeforeInsert: boolean;
}

export interface TrackedJob {
  id: string;
  title?: string;
  company?: string;
  location?: string;
  sourceUrl: string;
  platform: string;
  status:
    | "saved"
    | "scanned"
    | "applied"
    | "reached_out"
    | "interviewing"
    | "rejected"
    | "offer"
    | "skipped";
  fitScore?: JobFitScore;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type QueuePlatform =
  | "ashby"
  | "greenhouse"
  | "lever"
  | "workable"
  | "workday"
  | "smartrecruiters"
  | "bamboohr"
  | "recruitee"
  | "teamtailor"
  | "icims"
  | "custom_careers"
  | "unknown";

export type QueueStatus =
  | "new"
  | "opened"
  | "scanned"
  | "saved"
  | "applied"
  | "skipped"
  | "not_relevant"
  | "manual_review"
  | "error";

export interface QueuedJobUrl {
  id: string;
  url: string;
  normalizedUrl: string;
  hostname: string;
  platform: QueuePlatform;
  pageType?: PageType;
  status: QueueStatus;
  title?: string;
  company?: string;
  location?: string;
  fitScore?: number;
  fitRecommendation?: JobFitScore["recommendation"];
  notes?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  openedAt?: string;
  scannedAt?: string;
  sourcePlatform?: string;
  sourceJobId?: string;
  sourceUrl?: string;
}

export interface LinkedInSearchJob {
  jobId: string;
  detailsUrl: string;
  title?: string;
  company?: string;
  location?: string;
}

export interface LinkedInSearchJobsResponse {
  jobs: LinkedInSearchJob[];
  totalFound: number;
  limit: number;
}

export type LinkedInApplyTarget =
  | { kind: "external_url"; url: string; label?: string }
  | { kind: "external_button"; label?: string }
  | { kind: "easy_apply"; label?: string }
  | { kind: "unavailable"; reason: string };

export interface JobListingCache {
  id: string;
  listingUrl: string;
  extractedFromUrl: string;
  jobInfo: JobInfo;
  platform: string;
  pageType: PageType;
  extractedAt: string;
}

export interface ExperienceDatabase {
  id: "default";
  markdown: string;
  sourceFiles: string[];
  updatedAt: string;
  generatedWithOpenRouter: boolean;
}

export interface CvSource {
  id: string;
  fileName: string;
  rawText: string;
  sourceType: ExperienceProfile["sourceType"];
  importedAt: string;
  positioningLabel?: string;
  summary?: string;
  targetRoles?: string[];
  keyStrengths?: string[];
  whenToUse?: string;
  keywords?: string[];
  localPathHint?: string;
}

export interface Settings {
  id?: "default";
  openRouterApiKey?: string;
  openRouterModel?: string;
  smartMatchEnabled: boolean;
  jobFitThreshold: number;
  showDataBeforeSending: boolean;
  allowRawCvForExtraction: boolean;
  localOnlyMode: boolean;
  queueOpenBehavior: "current_tab" | "new_tab" | "background_tab";
  queueAutoScanAfterOpening: boolean;
  queueDevMode: boolean;
  linkedinPreScreenEnabled: boolean;
  useOptimizedExperienceDatabase: boolean;
  autoSaveNewAnswers: boolean;
  /** Sensitive EEO/self-identification answers require a separate explicit opt-in. */
  autoSaveSensitiveAnswers: boolean;
  autoInsertFields: boolean;
  autoGenerateAnswersOnScan: boolean;
  /** Free-text context for open-ended questions (reason for leaving, motivation, etc.). */
  jobSearchContext?: string;
  promptOverrides?: Partial<Record<import("../ai/prompts").PromptKey, string>>;
}

export interface ScanHistory {
  id: string;
  url: string;
  pageType: PageType;
  platform: string;
  fieldCount: number;
  jobTitle?: string;
  scannedAt: string;
}

export interface ScanResult {
  context: PageContext;
  pageType: PageType;
  platform: string;
  adapterName: string;
  jobInfo: JobInfo;
  fields: DetectedField[];
  message?: string;
  watching: boolean;
  jobInfoFromListing?: boolean;
  jobInfoExtracted?: boolean;
}

export interface InsertResult {
  ok: boolean;
  error?: string;
}

export type ContentMessage =
  | { type: "SCAN_PAGE"; watchDynamicFields: boolean }
  | { type: "EXTRACT_JOB_INFO" }
  | { type: "COLLECT_LINKEDIN_SEARCH_JOBS"; limit: number }
  | { type: "GET_LINKEDIN_APPLY_TARGET" }
  | { type: "CLICK_LINKEDIN_EXTERNAL_APPLY" }
  | { type: "FOCUS_FIELD"; fieldId: string; selectorHint: string; frameId?: number }
  | { type: "SET_DYNAMIC_WATCH"; enabled: boolean }
  | {
      type: "INSERT_FIELDS_BATCH";
      fields: Array<{
        fieldId: string;
        selectorHint: string;
        value: string;
        frameId?: number;
        widget?: FieldWidget;
        fieldType?: string;
        category?: string;
      }>;
      frameId?: number;
    }
  | {
      type: "INSERT_FIELD";
      fieldId: string;
      selectorHint: string;
      value: string;
      frameId?: number;
      widget?: FieldWidget;
    }
  | { type: "GET_FIELD_VALUE"; fieldId: string; selectorHint: string; frameId?: number }
  | { type: "PING" };

export const DEFAULT_SETTINGS: Settings = {
  id: "default",
  openRouterModel: "google/gemini-2.0-flash-lite-001",
  smartMatchEnabled: false,
  jobFitThreshold: 70,
  showDataBeforeSending: true,
  allowRawCvForExtraction: false,
  localOnlyMode: true,
  queueOpenBehavior: "current_tab",
  queueAutoScanAfterOpening: false,
  queueDevMode: false,
  linkedinPreScreenEnabled: false,
  useOptimizedExperienceDatabase: true,
  autoSaveNewAnswers: true,
  autoSaveSensitiveAnswers: false,
  autoInsertFields: true,
  autoGenerateAnswersOnScan: true,
  jobSearchContext: DEFAULT_JOB_SEARCH_CONTEXT
};

export const EMPTY_EXPERIENCE_DATABASE: ExperienceDatabase = {
  id: "default",
  markdown: "",
  sourceFiles: [],
  updatedAt: "",
  generatedWithOpenRouter: false
};

export const EMPTY_EXPERIENCE_PROFILE: ExperienceProfile = {
  id: "default",
  rawText: "",
  sourceType: "pasted_text",
  parsedAt: "",
  skills: [],
  companies: [],
  roles: [],
  projects: [],
  education: [],
  certifications: [],
  languages: [],
  links: []
};

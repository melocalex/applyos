import type { DetectedField, UserProfile } from "./types";
import { SAFE_PROFILE_CATEGORIES } from "./constants";
import { formatPhoneForProfile } from "./phoneFormat";
import { isProfileLinkField, labelRequestsProfileLink } from "./profileLinkFields";

export type FieldWidget =
  | "default"
  | "country_dropdown"
  | "location_autocomplete"
  | "location_text"
  | "combobox";

const COUNTRY_LABEL = /\b(country|nationality|country of residence|citizenship)\b/i;
const LOCATION_AUTOCOMPLETE_LABEL =
  /\b(current location|your location|where are you located|location\s*\(|^location$)\b/i;
const LOCATION_TEXT_LABEL = /\b(location|address|where do you live)\b/i;
const JOB_LOCATION_LABEL = /\b(job location|work location|office location|role location)\b/i;

export function inferFieldWidget(label: string, elementHint?: string): FieldWidget {
  const normalized = label.trim();
  const hint = elementHint ?? "";

  if (labelRequestsProfileLink(normalized)) return "default";

  if (/phone-input__country/i.test(hint) || /#country\.select__input/i.test(hint)) {
    return "country_dropdown";
  }
  if (COUNTRY_LABEL.test(normalized)) return "country_dropdown";
  if (/_systemfield_location|data-field-path.*location/i.test(hint)) {
    return "location_autocomplete";
  }
  if (LOCATION_AUTOCOMPLETE_LABEL.test(normalized) && !JOB_LOCATION_LABEL.test(normalized)) {
    return "location_autocomplete";
  }
  if (LOCATION_TEXT_LABEL.test(normalized) && !JOB_LOCATION_LABEL.test(normalized) && !COUNTRY_LABEL.test(normalized)) {
    return "location_text";
  }
  if (/\brole=combobox\b/i.test(hint) || /\bcombobox\b/i.test(hint)) {
    return "combobox";
  }
  return "default";
}

export function formatCompositeLocation(profile: UserProfile): string | undefined {
  const parts = [profile.city, profile.state, profile.country].map((part) => part?.trim()).filter(Boolean);
  if (!parts.length) return profile.location?.trim() || undefined;
  return parts.join(", ");
}

function resolveFullName(profile: UserProfile): string | undefined {
  if (profile.fullName?.trim()) return profile.fullName.trim();
  const parts = [profile.firstName, profile.lastName].map((part) => part?.trim()).filter(Boolean);
  if (parts.length) return parts.join(" ");
  return undefined;
}

function resolveRecurringQuestionValue(field: DetectedField, profile: UserProfile): string | undefined {
  if (field.category && SAFE_PROFILE_CATEGORIES.includes(field.category)) return undefined;

  const label = field.label.trim();
  if (!label) return undefined;

  if (/\bhow did you hear\b/i.test(label)) return pickProfileString(profile.referralSource);
  if (/\b(where did you go for college|college|university|school you attended)\b/i.test(label)) {
    return pickProfileString(profile.education);
  }
  if (/\b(in[- ]office|on[- ]site|days a week)\b/i.test(label)) {
    return pickProfileString(profile.inOfficePreference);
  }
  return undefined;
}

export function profileValueForFieldWithWidget(
  field: DetectedField,
  profile?: UserProfile
): string | undefined {
  if (!profile) return undefined;

  const profileLinkValue = resolveProfileLinkValue(field, profile);
  if (profileLinkValue !== undefined) return profileLinkValue;
  if (labelRequestsProfileLink(field.label, field.fieldType)) return undefined;

  const recurring = resolveRecurringQuestionValue(field, profile);
  if (recurring) return recurring;

  const widget = field.widget ?? inferFieldWidget(field.label, field.selectorHint);

  if (field.category === "phone") {
    return formatPhoneForProfile(profile.phone, profile.country);
  }

  switch (widget) {
    case "country_dropdown":
      return pickProfileString(profile.country);
    case "location_autocomplete":
      return pickProfileString(profile.city, profile.location);
    case "location_text":
      return pickProfileString(profile.location, formatCompositeLocation(profile), profile.city);
    case "combobox":
      if (COUNTRY_LABEL.test(field.label)) return pickProfileString(profile.country);
      if (LOCATION_AUTOCOMPLETE_LABEL.test(field.label)) {
        return pickProfileString(profile.city, profile.location);
      }
      break;
    default:
      break;
  }

  const map: Partial<Record<string, keyof UserProfile>> = {
    first_name: "firstName",
    last_name: "lastName",
    full_name: "fullName",
    email: "email",
    phone: "phone",
    country: "country",
    state: "state",
    city: "city",
    current_company: "currentCompany",
    linkedin: "linkedinUrl",
    github: "githubUrl",
    portfolio: "portfolioUrl",
    website: "websiteUrl",
    work_authorization: "workAuthorization",
    visa_sponsorship: "visaSponsorship",
    legal_authorization: "workAuthorization",
    salary: "salaryExpectation",
    start_date: "startDate"
  };

  const key = field.category ? map[field.category] : undefined;
  if (key === "phone") return formatPhoneForProfile(profile.phone, profile.country);
  if (key === "fullName") return resolveFullName(profile);
  if (key === "city") return pickProfileString(profile.city, profile.location, formatCompositeLocation(profile));
  const value = key ? profile[key] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickProfileString(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

const PROFILE_LINK_BY_CATEGORY: Partial<Record<string, keyof UserProfile>> = {
  linkedin: "linkedinUrl",
  github: "githubUrl",
  portfolio: "portfolioUrl",
  website: "websiteUrl"
};

function resolveProfileLinkValue(field: DetectedField, profile: UserProfile): string | undefined {
  const fromCategory = field.category ? PROFILE_LINK_BY_CATEGORY[field.category] : undefined;
  if (fromCategory) {
    const value = profile[fromCategory];
    if (typeof value === "string" && value.trim()) return value.trim();
    return undefined;
  }

  if (!labelRequestsProfileLink(field.label, field.fieldType)) {
    return undefined;
  }

  const label = field.label;
  if (/\blinkedin\b/i.test(label)) return pickProfileString(profile.linkedinUrl);
  if (/\b(github|gitlab)\b/i.test(label)) return pickProfileString(profile.githubUrl);
  if (/\btwitter\b/i.test(label) || /\bx\.com\b/i.test(label) || /\bx (?:url|handle|profile)\b/i.test(label)) {
    return pickProfileString(profile.twitterUrl);
  }
  if (/\bportfolio\b/i.test(label)) return pickProfileString(profile.portfolioUrl);
  if (/\b(personal website|website|web site)\b/i.test(label)) return pickProfileString(profile.websiteUrl);
  return undefined;
}

import type { FieldCategory } from "../shared/types";
import { PROFILE_LINK_PLATFORM_PATTERN } from "../shared/profileLinkFields";
import { normalizeText } from "./text";

const RULES: Array<[FieldCategory, RegExp]> = [
  ["first_name", /\b(first name|given name|forename)\b/],
  ["last_name", /\b(last name|family name|surname)\b/],
  ["full_name", /\b(full name|your name)\b|^name$/],
  ["email", /\b(e[\s-]?mail)\b/],
  ["linkedin", /\blinkedin\b/],
  ["github", /\b(github|gitlab)\b/],
  ["portfolio", /\b(portfolio|work samples?)\b/],
  ["website", /\b(personal website|website|web site)\b/],
  [
    "social_profile",
    /\b(discord|telegram|whatsapp|youtube|twitter|instagram|facebook|threads|tiktok|snapchat|twitch|reddit|stackoverflow|medium|substack|behance|dribbble|signal|wechat|mastodon|bluesky|bsky|claude|anthropic|chatgpt|chat gpt|openai|open ai|deepseek|openrouter|open router|gemini|google ai|bard|copilot|github copilot|perplexity|grok|xai|mistral|llama|meta ai|hugging face|huggingface|character ai|cohere|together ai|fireworks ai|replicate|midjourney|stable diffusion|dall-?e|cursor|groq|pi ai|inflection|ollama|poe|replit|phind|kimi|qwen|runway|elevenlabs)\b/
  ],
  ["phone", /\b(phone|mobile|telephone)\b/],
  ["country", /\b(country|nation|where do you currently live|country of residence|nationality)\b/],
  ["state", /\b(state|province|region)\b/],
  ["city", /\b(city|town|current location|your location|where are you located|where are you based|^location$)\b/],
  ["current_company", /\b(current company|present employer|current employer|employer name)\b/],
  ["resume", /\b(resume|cv|curriculum vitae)\b/],
  ["cover_letter", /\b(cover letter)\b/],
  ["additional_file", /\b(additional file|attachment|supporting document)\b/],
  ["why_company", /\b(why.*(company|us|join)|interest.*company|what excites you about)\b/],
  [
    "why_role",
    /\b(why.*(role|position|job)|interest.*(role|position)|looking for a change|reason you are looking|whats reason|what s reason|why.*change|reason.*change|good fit for this role|most important thing)\b/
  ],
  ["about_me", /\b(tell us about yourself|about you|professional summary|introduce yourself|tell us what you|what you re great|great at|ideal role)\b/],
  ["hard_problem", /\b(hard|difficult|complex|challenging).*(problem|project|situation)\b/],
  ["leadership", /\b(leadership|led a team|manage a team|mentored)\b/],
  ["conflict", /\b(conflict|disagreement|difficult colleague)\b/],
  ["salary", /\b(salary|compensation|pay expectation|desired pay)\b/],
  ["relocation", /\b(relocat|willing to move)\b/],
  ["legal_authorization", /\b(legally authorized|legal authorization)\b/],
  ["work_authorization", /\b(work authorization|authorized to work|right to work|work for any employer)\b/],
  [
    "custom_question",
    /\b(what visa|which visa|visa are you currently|visa type|how many global markets|global markets.*experience)\b/
  ],
  [
    "visa_sponsorship",
    /\b(require sponsorship|need sponsorship|visa sponsorship|sponsor your visa|sponsorship to work|will you require sponsorship)\b/
  ],
  ["start_date", /\b(start date|available to start|notice period|availability)\b/],
  ["timezone", /\b(time zone|timezone|current time zone)\b/],
  [
    "location_eligibility",
    /\b(reside in|currently reside|eligible for hire in|located in one of these|confirm if you currently reside)\b/
  ],
  [
    "previous_employment",
    /\b(previously employed|former employee|previously worked|employed by.*as an intern|employed by.*employee|employed by.*contractor)\b/
  ],
  ["transgender", /\b(identify as transgender|transgender)\b/],
  ["pronouns", /\b(preferred pronouns?|pronouns?|what are your pronouns)\b/],
  ["sexual_orientation", /\bsexual orientation\b/],
  ["gender", /\b(gender identity|gender|sex)\b/],
  ["race_ethnicity", /\b(race|ethnicity|ethnic|voluntary identification)\b/],
  ["disability", /\b(disability|disabled)\b/],
  ["veteran_status", /\b(veteran|military service)\b/],
  ["age", /\b(age|date of birth|birth date)\b/],
  ["voluntary_disclosure", /\b(voluntary|self identification|self-identification|federal contractor)\b/]
];

export function classifyField(label: string, fieldType: string): FieldCategory {
  const normalized = normalizeText(label);

  if (
    fieldType === "textarea" &&
    /\blinkedin\b/i.test(normalized) &&
    !/\b(url|link)\b/i.test(label)
  ) {
    return "custom_question";
  }

  if (
    PROFILE_LINK_PLATFORM_PATTERN.test(normalized) &&
    (label.includes("?") || /\b(reason|change|how many|visa|global markets)\b/i.test(label))
  ) {
    for (const [category, pattern] of RULES) {
      if (["why_role", "custom_question", "why_company", "about_me"].includes(category) && pattern.test(normalized)) {
        return category;
      }
    }
    return "custom_question";
  }

  for (const [category, pattern] of RULES) {
    if (pattern.test(normalized)) return category;
  }
  if (fieldType === "file") return "additional_file";
  if (fieldType === "radio" || fieldType === "select") return "screening_question";
  if (fieldType === "number" && /\b(how many|years|months|number of)\b/.test(normalized)) {
    return "custom_question";
  }
  if (/\b(how many years).*(experience|with)\b/i.test(normalized)) {
    return "custom_question";
  }
  if (
    fieldType === "textarea" ||
    fieldType === "text" ||
    normalized.includes("?") ||
    /\b(why|what|how|when|where|which|describe|tell us|explain|reason|looking for|experience|please|motivation|interested|eligible|currently|great at|ideal role|strengths)\b/.test(
      normalized
    )
  ) {
    return "custom_question";
  }
  return "manual_review";
}

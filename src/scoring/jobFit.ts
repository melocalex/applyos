import type { ExperienceProfile, JobFitScore, JobInfo } from "../shared/types";
import { normalizeText, tokenize, uniqueStrings } from "../matching/normalize";

const SENIORITY: Record<string, number> = {
  intern: 0,
  junior: 1,
  jr: 1,
  associate: 1,
  mid: 2,
  senior: 3,
  sr: 3,
  staff: 4,
  principal: 5,
  lead: 4,
  manager: 4,
  director: 5,
  head: 5
};

function detectSeniority(text: string): number {
  // Match whole words only. Substring matching (`includes`) would let "lead"
  // match "leading", "head" match "headcount", "sr"/"jr"/"mid" match countless
  // unrelated words, all inflating the detected seniority.
  const words = new Set(normalizeText(text).split(/[^a-z0-9+#]+/).filter(Boolean));
  const matched = Object.entries(SENIORITY)
    .filter(([label]) => words.has(label))
    .map(([, value]) => value);
  // No seniority keyword present -> treat as mid-level (neutral default). When a
  // keyword *is* present, honor it even if it's below mid (e.g. intern/junior),
  // instead of flooring every role to mid.
  return matched.length ? Math.max(...matched) : 2;
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateJobFit(
  job: JobInfo,
  profile?: ExperienceProfile
): JobFitScore {
  if (!profile || (!profile.rawText && profile.roles.length === 0 && profile.skills.length === 0)) {
    return {
      overallScore: 0,
      breakdown: { requiredSkills: 0, experienceLevel: 0, domainFit: 0, roleFit: 0 },
      missingRequirements: job.requirements.slice(0, 8),
      matchingHighlights: [],
      recommendation: "no_fit",
      reason: "Create an Experience Profile before evaluating job fit."
    };
  }

  const profileText = normalizeText(
    [
      profile.rawText,
      ...profile.skills,
      ...profile.companies,
      ...profile.roles.flatMap((role) => [
        role.title,
        role.company,
        ...(role.highlights ?? []),
        ...(role.technologies ?? [])
      ]),
      ...profile.projects.flatMap((project) => [
        project.name,
        project.description,
        ...(project.technologies ?? []),
        ...(project.highlights ?? [])
      ])
    ].join(" ")
  );

  const requirements =
    job.requirements.length > 0
      ? job.requirements
      : uniqueStrings(tokenize(job.description ?? "").slice(0, 20));

  const requirementMatches = requirements.filter((requirement) => {
    const tokens = tokenize(requirement).filter((token) => token.length > 3);
    return tokens.length > 0 && tokens.some((token) => profileText.includes(token));
  });
  const missingRequirements = requirements
    .filter((requirement) => !requirementMatches.includes(requirement))
    .slice(0, 10);
  const requiredSkills = percent(
    requirements.length ? (requirementMatches.length / requirements.length) * 100 : 50
  );

  const jobSeniority = detectSeniority(job.title ?? job.description ?? "");
  const profileSeniority = Math.max(
    1,
    ...profile.roles.map((role) => detectSeniority(role.title))
  );
  const experienceLevel = percent(
    profileSeniority >= jobSeniority ? 100 : 100 - (jobSeniority - profileSeniority) * 30
  );

  const jobDomainTokens = tokenize(
    [
      job.department,
      job.title,
      ...job.requirements,
      ...job.responsibilities,
      ...job.niceToHave
    ]
      .filter(Boolean)
      .join(" ")
  );
  const domainMatches = uniqueStrings(
    jobDomainTokens.filter((token) => profileText.includes(token))
  );
  const domainFit = percent(
    jobDomainTokens.length ? (domainMatches.length / Math.min(jobDomainTokens.length, 30)) * 100 : 50
  );

  const jobRoleTokens = tokenize(job.title ?? "");
  const roleText = normalizeText(
    [...profile.roles.map((role) => role.title), ...profile.projects.map((project) => project.name)].join(
      " "
    )
  );
  const roleMatches = jobRoleTokens.filter((token) => roleText.includes(token));
  const roleFit = percent(
    jobRoleTokens.length ? (roleMatches.length / jobRoleTokens.length) * 100 : 40
  );

  const overallScore = percent(
    requiredSkills * 0.45 + experienceLevel * 0.2 + domainFit * 0.2 + roleFit * 0.15
  );
  const recommendation =
    overallScore >= 80
      ? "strong_fit"
      : overallScore >= 70
        ? "good_fit"
        : overallScore >= 40
          ? "partial_fit"
          : overallScore >= 20
            ? "low_fit"
            : "no_fit";

  const matchingHighlights = uniqueStrings([
    ...requirementMatches.slice(0, 6),
    ...domainMatches.slice(0, 6)
  ]);

  return {
    overallScore,
    breakdown: { requiredSkills, experienceLevel, domainFit, roleFit },
    missingRequirements,
    matchingHighlights,
    recommendation,
    reason:
      recommendation === "strong_fit" || recommendation === "good_fit"
        ? "The documented profile has meaningful overlap with this role."
        : recommendation === "partial_fit"
          ? "There is some overlap, but review missing requirements carefully."
          : "The documented profile has limited overlap. Consider skipping this application."
  };
}

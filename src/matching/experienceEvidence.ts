import type { ExperienceProfile, JobInfo } from "../shared/types";
import { normalizeText, tokenize, uniqueStrings } from "./normalize";

export interface ExperienceEvidence {
  snippets: string[];
  confidence: number;
}

export function findRelevantExperience(
  question: string,
  profile: ExperienceProfile,
  job?: JobInfo
): ExperienceEvidence {
  const queryTokens = new Set(
    tokenize(
      [
        question,
        job?.title,
        ...(job?.requirements ?? []),
        ...(job?.responsibilities ?? [])
      ]
        .filter(Boolean)
        .join(" ")
    )
  );

  const candidates = [
    ...profile.roles.flatMap((role) => [
      `${role.title} at ${role.company}`,
      ...(role.highlights ?? []).map(
        (highlight) =>
          `${role.title} at ${role.company}: ${highlight}${
            role.technologies?.length ? ` Technologies: ${role.technologies.join(", ")}` : ""
          }`
      )
    ]),
    ...profile.projects.flatMap((project) => [
      `${project.name}: ${project.description}`,
      ...(project.highlights ?? []).map(
        (highlight) =>
          `${project.name}: ${highlight}${
            project.technologies?.length ? ` Technologies: ${project.technologies.join(", ")}` : ""
          }`
      )
    ]),
    profile.skills.length ? `Documented skills: ${profile.skills.join(", ")}` : ""
  ].filter(Boolean);

  const scored = candidates
    .map((snippet) => {
      const tokens = tokenize(snippet);
      const overlap = tokens.filter((token) => queryTokens.has(token)).length;
      const score = overlap / Math.max(4, queryTokens.size);
      return { snippet, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const snippets = uniqueStrings(scored.slice(0, 6).map((item) => item.snippet));
  const strongest = scored[0]?.score ?? 0;
  const directQuestionMatch = profile.rawText
    ? tokenize(question).some((token) => normalizeText(profile.rawText).includes(token))
    : false;

  return {
    snippets,
    confidence: Math.min(1, strongest + (directQuestionMatch ? 0.2 : 0))
  };
}

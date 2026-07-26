import {
  EMPTY_EXPERIENCE_PROFILE,
  type ExperienceProfile
} from "../shared/types";
import { uniqueStrings } from "../matching/normalize";

const SECTION_NAMES = {
  skills: ["skills", "technical skills", "technologies", "tools"],
  experience: ["experience", "work experience", "professional experience", "employment"],
  projects: ["projects", "selected projects"],
  education: ["education", "academic background"],
  certifications: ["certifications", "certificates"],
  languages: ["languages"]
};

export async function extractTextFromFile(file: File): Promise<{
  text: string;
  sourceType: ExperienceProfile["sourceType"];
}> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "txt" || file.type === "text/plain") {
    return { text: await file.text(), sourceType: "txt" };
  }
  if (extension === "pdf" || file.type === "application/pdf") {
    return { text: await extractPdfText(file), sourceType: "pdf" };
  }
  if (
    extension === "docx" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return { text: await extractDocxText(file), sourceType: "docx" };
  }
  throw new Error("Unsupported file type. Use TXT, PDF, or DOCX.");
}

async function extractPdfText(file: File): Promise<string> {
  try {
    const [pdfjsLib, workerModule] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ]);
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages: string[] = [];
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      pages.push(
        content.items
          // hasEOL preserves line structure; without it a whole page collapses
          // to one line and section/heading parsing finds nothing.
          .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
          .join("")
          .replace(/[ \t]+\n/g, "\n")
          .trim()
      );
    }
    return pages.join("\n\n");
  } catch (error) {
    throw new Error(`PDF extraction failed: ${getErrorMessage(error)}`);
  }
}

async function extractDocxText(file: File): Promise<string> {
  try {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  } catch (error) {
    throw new Error(`DOCX extraction failed: ${getErrorMessage(error)}`);
  }
}

export function parseExperienceLocally(
  rawText: string,
  sourceType: ExperienceProfile["sourceType"]
): ExperienceProfile {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const sections = splitSections(lines);
  const urls = rawText.match(/https?:\/\/[^\s)]+/g) ?? [];
  const skillLines = sections.skills.length ? sections.skills : lines.filter((line) => /skills?/i.test(line));
  const skills = uniqueStrings(
    skillLines
      .flatMap((line) => line.replace(/^[^:]+:/, "").split(/[,|•;]/))
      .map((item) => item.trim())
      .filter((item) => item.length > 1 && item.length < 60)
  );

  const companies = uniqueStrings(
    lines
      .filter((line) => /\b(at|@)\b/i.test(line) || /\b(inc|llc|ltd|corp|company)\b/i.test(line))
      .map((line) => line.split(/\b(at|@)\b/i).pop()?.trim() ?? "")
      .filter((item) => item.length > 1 && item.length < 80)
  );

  return {
    ...EMPTY_EXPERIENCE_PROFILE,
    id: "default",
    rawText,
    sourceType,
    parsedAt: new Date().toISOString(),
    skills,
    companies,
    certifications: uniqueStrings(sections.certifications),
    languages: uniqueStrings(
      sections.languages
        .filter((line) => !/https?:\/\//i.test(line))
        .flatMap((line) => line.split(/[,|•;]/).map((item) => item.trim()))
    ),
    links: uniqueStrings(urls),
    education: sections.education.map((line) => ({ institution: line }))
  };
}

function splitSections(lines: string[]): Record<keyof typeof SECTION_NAMES, string[]> {
  const result: Record<keyof typeof SECTION_NAMES, string[]> = {
    skills: [],
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    languages: []
  };
  let current: keyof typeof SECTION_NAMES | undefined;

  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/[:\-]/g, "").trim();
    const matched = (Object.entries(SECTION_NAMES) as Array<
      [keyof typeof SECTION_NAMES, string[]]
    >).find(([, names]) => names.includes(normalized));
    if (matched) {
      current = matched[0];
      continue;
    }
    if (current) result[current].push(line);
  }
  return result;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

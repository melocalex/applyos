import { describe, expect, it } from "vitest";
import type { PageContext } from "../shared/types";
import { classifyPage, findJobPosting } from "./classifier";

function context(overrides: Partial<PageContext> = {}): PageContext {
  return {
    url: "https://example.com/contact",
    hostname: "example.com",
    pathname: "/contact",
    title: "Contact",
    bodyText: "",
    jobPostingText: "",
    hasForms: false,
    buttons: [],
    links: [],
    meta: {},
    jsonLd: [],
    ...overrides
  };
}

describe("classifyPage", () => {
  it("does not treat an ordinary email form as a job application", () => {
    expect(
      classifyPage(
        context({
          bodyText: "Get product updates by email.",
          hasForms: true,
          buttons: ["Subscribe"]
        })
      )
    ).toBe("unknown_page");
  });

  it("recognizes an explicit resume upload form", () => {
    expect(
      classifyPage(
        context({
          bodyText: "Upload your resume and submit application",
          hasForms: true
        })
      )
    ).toBe("job_application_form");
  });
});

describe("findJobPosting", () => {
  it("recognizes JSON-LD records whose @type is an array", () => {
    const posting = { "@type": ["Thing", "JobPosting"], title: "Engineer" };
    expect(findJobPosting([{ "@graph": [posting] }])).toBe(posting);
  });
});

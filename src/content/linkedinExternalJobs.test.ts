import { describe, expect, it } from "vitest";
import {
  classifyLinkedInApplyDescriptor,
  extractLinkedInJobId,
  unwrapLinkedInExternalUrl
} from "./linkedinExternalJobs";

describe("LinkedIn external job helpers", () => {
  it("extracts job ids from detail links and search URLs", () => {
    expect(
      extractLinkedInJobId("https://www.linkedin.com/jobs/view/4270012345/?trackingId=x")
    ).toBe("4270012345");
    expect(
      extractLinkedInJobId(
        "https://www.linkedin.com/jobs/view/forward-deployed-engineer-at-acme-4270012346/"
      )
    ).toBe("4270012346");
    expect(extractLinkedInJobId("urn:li:jobPosting:4270012347")).toBe(
      "4270012347"
    );
    expect(
      extractLinkedInJobId(
        "https://www.linkedin.com/jobs/search/?currentJobId=4270098765"
      )
    ).toBe("4270098765");
  });

  it("distinguishes external Apply from Easy Apply", () => {
    expect(
      classifyLinkedInApplyDescriptor("Apply to Acme on company website")
    ).toBe("external");
    expect(classifyLinkedInApplyDescriptor("Easy Apply")).toBe("easy_apply");
    expect(classifyLinkedInApplyDescriptor("Save")).toBe("unknown");
  });

  it("keeps external URLs and unwraps LinkedIn redirect URLs", () => {
    expect(unwrapLinkedInExternalUrl("https://jobs.acme.com/apply/42")).toBe(
      "https://jobs.acme.com/apply/42"
    );
    expect(
      unwrapLinkedInExternalUrl(
        "https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fboards.greenhouse.io%2Facme%2Fjobs%2F42"
      )
    ).toBe("https://boards.greenhouse.io/acme/jobs/42");
  });

  it("does not mistake an internal LinkedIn job URL for an external target", () => {
    expect(
      unwrapLinkedInExternalUrl("https://www.linkedin.com/jobs/view/4270012345/")
    ).toBeUndefined();
  });
});

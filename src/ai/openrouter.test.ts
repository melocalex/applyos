import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EXPERIENCE_PROFILE, DEFAULT_SETTINGS, type JobInfo } from "../shared/types";
import { callOpenRouterJson, suggestAllAnswersFromExperience } from "./openrouter";

const settings = {
  ...DEFAULT_SETTINGS,
  localOnlyMode: false,
  openRouterApiKey: "test-key"
};

function responseWithContent(content: unknown, init: ResponseInit = {}): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }]
    }),
    { status: 200, ...init }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callOpenRouterJson", () => {
  it("retries a transient rate-limit response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "0" }
      }))
      .mockResolvedValueOnce(responseWithContent({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callOpenRouterJson(settings, "system", "user")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("batch answer reconciliation", () => {
  it("does not positionally assign answers carrying unknown field IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        responseWithContent({
          answers: [
            {
              fieldId: "unknown-a",
              answer: "Answer intended for some other field",
              confidence: 0.9,
              reason: "Generated"
            },
            {
              fieldId: "unknown-b",
              answer: "Another unrelated answer",
              confidence: 0.9,
              reason: "Generated"
            }
          ]
        })
      )
    );
    const job: JobInfo = {
      title: "Engineer",
      company: "Acme",
      sourceUrl: "https://example.com/jobs/1",
      platform: "generic",
      detectedAt: new Date().toISOString(),
      requirements: [],
      responsibilities: [],
      niceToHave: []
    };

    const result = await suggestAllAnswersFromExperience(
      [
        { fieldId: "field-a", label: "Why this role?", relevantExperience: [] },
        { fieldId: "field-b", label: "Tell us about yourself", relevantExperience: [] }
      ],
      EMPTY_EXPERIENCE_PROFILE,
      job,
      settings
    );

    expect(result.map((entry) => entry.answer)).toEqual(["NO_FIT", "NO_FIT"]);
  });
});

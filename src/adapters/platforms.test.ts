import { describe, expect, it } from "vitest";
import type { PageContext } from "../shared/types";
import { bambooHrAdapter } from "./bamboohr";
import { jobListingCacheKey, resolveListingUrl } from "./listingResolver";

function context(url: string): PageContext {
  const parsed = new URL(url);
  return {
    url,
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    title: "",
    bodyText: "",
    jobPostingText: "",
    hasForms: false,
    buttons: [],
    links: [],
    meta: {},
    jsonLd: []
  };
}

describe("BambooHR adapter", () => {
  it("matches modern careers URLs", () => {
    expect(bambooHrAdapter.matches(context("https://acme.bamboohr.com/careers/42"))).toBe(true);
  });
});

describe("Workday listing URL resolution", () => {
  const listing = "https://acme.wd5.myworkdayjobs.com/en-US/jobs/job/Sao-Paulo/Engineer_R123";

  it("strips the applyManually flow", () => {
    const application = `${listing}/apply/applyManually`;
    expect(resolveListingUrl(context(application))).toBe(listing);
    expect(jobListingCacheKey(application)).toBe(listing);
  });

  it("strips the login flow", () => {
    const login = `${listing}/login`;
    expect(resolveListingUrl(context(login))).toBe(listing);
    expect(jobListingCacheKey(login)).toBe(listing);
  });
});

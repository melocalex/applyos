import { describe, expect, it } from "vitest";
import {
  formatPhoneForProfile,
  parsePhoneNumber
} from "./phoneFormat";
import { phoneOptionMatches } from "../content/phoneInput";

describe("phone formatting", () => {
  it("adds the country dial code to a national Brazilian number", () => {
    expect(formatPhoneForProfile("(48) 99999-1234", "Brazil")).toBe(
      "+5548999991234"
    );
  });

  it("does not duplicate a dial code saved without a plus sign", () => {
    expect(formatPhoneForProfile("5548999991234", "Brazil")).toBe(
      "+5548999991234"
    );
  });

  it("splits an E.164 Brazilian number into dial code and national number", () => {
    expect(parsePhoneNumber("+55 48 99999-1234", "Brazil")).toMatchObject({
      dialCode: "55",
      national: "48999991234",
      countryName: "Brazil",
      e164: "+5548999991234"
    });
  });

  it("matches the exact Ashby dial code option", () => {
    const parsed = parsePhoneNumber("+55 48 99999-1234", "Brazil");
    expect(phoneOptionMatches("🇧🇷 Brazil +55", parsed)).toBe(true);
    expect(phoneOptionMatches("🇺🇸 United States +1", parsed)).toBe(false);
  });
});

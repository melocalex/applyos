import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("ignores sentence-ending periods for exact question matching", () => {
    expect(normalizeText("Tell us about yourself.")).toBe(
      normalizeText("Tell us about yourself")
    );
  });

  it("preserves periods inside technology names", () => {
    expect(normalizeText(".NET and Node.js")).toBe(".net and node.js");
  });
});

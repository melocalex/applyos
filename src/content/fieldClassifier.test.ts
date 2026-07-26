import { describe, expect, it } from "vitest";
import { classifyField } from "./fieldClassifier";

describe("classifyField", () => {
  it("recognizes labels normalized from E-mail", () => {
    expect(classifyField("E-mail address", "email")).toBe("email");
  });
});

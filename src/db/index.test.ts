import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type DetectedField } from "../shared/types";
import { saveFieldAnswer } from "../shared/saveFieldAnswer";
import { db, exportAllData, importAllData, initializeDatabase } from "./index";

beforeEach(async () => {
  await db.delete();
});

afterEach(async () => {
  await db.delete();
});

describe("local data lifecycle", () => {
  it("does not reseed sample answers after the user clears the Answer Bank", async () => {
    await initializeDatabase();
    expect(await db.savedAnswers.count()).toBeGreaterThan(0);

    await db.savedAnswers.clear();
    await initializeDatabase();

    expect(await db.savedAnswers.count()).toBe(0);
  });

  it("omits the OpenRouter API key from exports", async () => {
    await initializeDatabase();
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      id: "default",
      openRouterApiKey: "test-secret-key"
    });

    const backup = await exportAllData();

    expect(JSON.stringify(backup)).not.toContain("test-secret-key");
    expect(backup.secretsOmitted).toEqual(["settings.openRouterApiKey"]);
  });

  it("preserves the current device key when importing a sanitized backup", async () => {
    await initializeDatabase();
    await db.settings.put({
      ...DEFAULT_SETTINGS,
      id: "default",
      openRouterApiKey: "device-only-key"
    });
    const { openRouterApiKey: _omitted, ...sanitizedSettings } = DEFAULT_SETTINGS;

    await importAllData({ settings: [sanitizedSettings] });

    expect((await db.settings.get("default"))?.openRouterApiKey).toBe("device-only-key");
  });
});

describe("sensitive answer capture", () => {
  const field: DetectedField = {
    fieldId: "gender",
    platform: "generic",
    label: "What is your gender?",
    normalizedLabel: "what is your gender",
    fieldType: "select",
    options: ["Woman", "Man", "Prefer not to say"],
    required: false,
    isVisible: true,
    isDisabled: false,
    selectorHint: "#gender",
    category: "gender"
  };

  it("requires a separate opt-in before saving self-identification answers", async () => {
    await initializeDatabase();
    expect(await saveFieldAnswer(field, "Prefer not to say")).toBe("skipped");

    await db.settings.update("default", { autoSaveSensitiveAnswers: true });
    expect(await saveFieldAnswer(field, "Prefer not to say")).toBe("saved");
  });
});

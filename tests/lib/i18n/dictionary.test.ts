import { describe, expect, test } from "vitest";
import { AREAS, DICTIONARY, en, translate, type MessageKey } from "@/lib/i18n/dictionary";

const placeholders = (message: string) => [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = Object.keys(en) as MessageKey[];

describe("dictionary", () => {
  test("has strings", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  test("every English key has a Spanish string, and Spanish has no extra keys", () => {
    const missing = keys.filter((key) => !DICTIONARY.es[key]?.trim());
    expect(missing, `ES is missing or empty for: ${missing.join(", ")}`).toEqual([]);
    expect(Object.keys(DICTIONARY.es).sort()).toEqual([...keys].sort());
  });

  test("the Spanish keeps the English placeholders", () => {
    const mismatched = keys.filter((key) => placeholders(en[key]).join() !== placeholders(DICTIONARY.es[key]).join());
    expect(mismatched).toEqual([]);
  });

  test("each area's keys start with its name, so areas can't collide", () => {
    for (const [area, messages] of Object.entries(AREAS)) {
      const stray = Object.keys(messages.en).filter((key) => !key.startsWith(`${area}.`));
      expect(stray, `${area} has keys outside its prefix`).toEqual([]);
      expect(Object.keys(messages.es).sort()).toEqual(Object.keys(messages.en).sort());
    }
    // Spreading would silently drop a key that two areas share.
    const total = Object.values(AREAS).reduce((sum, messages) => sum + Object.keys(messages.en).length, 0);
    expect(keys.length).toBe(total);
  });

  test("translate fills placeholders and leaves unknown ones", () => {
    expect(translate("en", "common.dayOther", { count: 3 })).toBe("3 days");
    expect(translate("es", "common.dayOther", { count: 3 })).toBe("3 días");
    expect(translate("es", "common.dayOther")).toBe("{count} días");
    expect(translate("en", "common.dayOne")).toBe("1 day");
  });
});

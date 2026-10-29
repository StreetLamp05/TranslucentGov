import { describe, expect, test } from "vitest";
import { en } from "@/lib/i18n/dictionary";
import { CITY_ONLY, tooFarMessage } from "@/server/lib/fixRules";
import { CLIP_TOO_BIG } from "@/server/lib/postLimits";

// The client shows its own copy of these server messages so they can be translated (US48).
// The English copies have to say what the server says.
describe("dictionary copies of server messages", () => {
  test("clip too big", () => {
    expect(en["post.clipTooBig"]).toBe(CLIP_TOO_BIG);
    expect(en["fix.capture.clipTooBig"]).toBe(CLIP_TOO_BIG);
  });

  test("city crews only", () => {
    expect(en["confirm.cityOnly"]).toBe(CITY_ONLY);
  });

  test("too far from the report", () => {
    const filled = en["fix.capture.tooFar"].replace("{radius}", "50").replace("{meters}", "73");
    expect(filled).toBe(tooFarMessage(73, 50));
  });
});

import { en, type MessageKey } from "@/lib/i18n/dictionary";
import type { TFunction } from "@/lib/i18n/I18nProvider";

// The recorder hook and lib/media hand back camera and clip errors as English sentences. The
// English text of each one lives in the dictionary (post.capture.err.*), so a message that
// matches is shown in the chosen language; anything else (a browser's own error text) is shown as it is.
const ERROR_KEYS = (Object.keys(en) as MessageKey[]).filter((key) => key.startsWith("post.capture.err."));

export function translateRecorderMessage(message: string, t: TFunction): string {
  const key = ERROR_KEYS.find((candidate) => en[candidate] === message);
  return key ? t(key) : message;
}

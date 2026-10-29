import type { Locale } from "./locale";
import * as common from "./messages/common";
import * as confirm from "./messages/confirm";
import * as feed from "./messages/feed";
import * as fix from "./messages/fix";
import * as gov from "./messages/gov";
import * as map from "./messages/map";
import * as me from "./messages/me";
import * as post from "./messages/post";

// Every user-facing string, by area (US48). Keys are "<area>.<name>"; a value may hold `{name}`
// placeholders. The ES side of each area is typed to have exactly the EN keys, and
// tests/lib/i18n/dictionary.test.ts checks the values too.
export const AREAS = { common, confirm, feed, fix, gov, map, me, post } as const;

export const en = {
  ...common.en,
  ...confirm.en,
  ...feed.en,
  ...fix.en,
  ...gov.en,
  ...map.en,
  ...me.en,
  ...post.en,
};
export type MessageKey = keyof typeof en;

const es: Record<MessageKey, string> = {
  ...common.es,
  ...confirm.es,
  ...feed.es,
  ...fix.es,
  ...gov.es,
  ...map.es,
  ...me.es,
  ...post.es,
};

export const DICTIONARY: Record<Locale, Record<MessageKey, string>> = { en, es };

export type Vars = Record<string, string | number>;

/** The string for `key` in `locale`, with `{name}` placeholders filled from `vars`. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const message = DICTIONARY[locale][key] ?? en[key];
  return vars ? message.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : message;
}

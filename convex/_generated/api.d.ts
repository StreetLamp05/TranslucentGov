/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as feed from "../feed.js";
import type * as files from "../files.js";
import type * as fixVerification from "../fixVerification.js";
import type * as fixVerificationDb from "../fixVerificationDb.js";
import type * as fixers from "../fixers.js";
import type * as fixes from "../fixes.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_city from "../lib/city.js";
import type * as lib_clipLimit from "../lib/clipLimit.js";
import type * as lib_fixPrompt from "../lib/fixPrompt.js";
import type * as lib_fixRules from "../lib/fixRules.js";
import type * as lib_gemini from "../lib/gemini.js";
import type * as lib_geo from "../lib/geo.js";
import type * as lib_postLimits from "../lib/postLimits.js";
import type * as lib_postMedia from "../lib/postMedia.js";
import type * as lib_publicReport from "../lib/publicReport.js";
import type * as lib_routing from "../lib/routing.js";
import type * as lib_screenPrompt from "../lib/screenPrompt.js";
import type * as lib_screening from "../lib/screening.js";
import type * as lib_transcribe from "../lib/transcribe.js";
import type * as lib_videoIntakeValidation from "../lib/videoIntakeValidation.js";
import type * as map from "../map.js";
import type * as me from "../me.js";
import type * as meToos from "../meToos.js";
import type * as nearby from "../nearby.js";
import type * as placeholder from "../placeholder.js";
import type * as posts from "../posts.js";
import type * as purge from "../purge.js";
import type * as relation from "../relation.js";
import type * as retake from "../retake.js";
import type * as reveal from "../reveal.js";
import type * as screening from "../screening.js";
import type * as screeningDb from "../screeningDb.js";
import type * as seed from "../seed.js";
import type * as stats from "../stats.js";
import type * as videoIntake from "../videoIntake.js";
import type * as videoIntakeAuth from "../videoIntakeAuth.js";
import type * as videoIntakeDb from "../videoIntakeDb.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  feed: typeof feed;
  files: typeof files;
  fixVerification: typeof fixVerification;
  fixVerificationDb: typeof fixVerificationDb;
  fixers: typeof fixers;
  fixes: typeof fixes;
  "lib/auth": typeof lib_auth;
  "lib/city": typeof lib_city;
  "lib/clipLimit": typeof lib_clipLimit;
  "lib/fixPrompt": typeof lib_fixPrompt;
  "lib/fixRules": typeof lib_fixRules;
  "lib/gemini": typeof lib_gemini;
  "lib/geo": typeof lib_geo;
  "lib/postLimits": typeof lib_postLimits;
  "lib/postMedia": typeof lib_postMedia;
  "lib/publicReport": typeof lib_publicReport;
  "lib/routing": typeof lib_routing;
  "lib/screenPrompt": typeof lib_screenPrompt;
  "lib/screening": typeof lib_screening;
  "lib/transcribe": typeof lib_transcribe;
  "lib/videoIntakeValidation": typeof lib_videoIntakeValidation;
  map: typeof map;
  me: typeof me;
  meToos: typeof meToos;
  nearby: typeof nearby;
  placeholder: typeof placeholder;
  posts: typeof posts;
  purge: typeof purge;
  relation: typeof relation;
  retake: typeof retake;
  reveal: typeof reveal;
  screening: typeof screening;
  screeningDb: typeof screeningDb;
  seed: typeof seed;
  stats: typeof stats;
  videoIntake: typeof videoIntake;
  videoIntakeAuth: typeof videoIntakeAuth;
  videoIntakeDb: typeof videoIntakeDb;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

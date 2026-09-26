/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as auth from "../auth.js";
import type * as core from "../core.js";
import type * as data from "../data.js";
import type * as http from "../http.js";
import type * as telegramCleanup from "../telegramCleanup.js";
import type * as telegramInbox from "../telegramInbox.js";
import type * as telegramLinks from "../telegramLinks.js";
import type * as telegramMessages from "../telegramMessages.js";
import type * as telegramOperations from "../telegramOperations.js";
import type * as telegramSend from "../telegramSend.js";
import type * as telegramSetup from "../telegramSetup.js";
import type * as telegramUpdate from "../telegramUpdate.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  core: typeof core;
  data: typeof data;
  http: typeof http;
  telegramCleanup: typeof telegramCleanup;
  telegramInbox: typeof telegramInbox;
  telegramLinks: typeof telegramLinks;
  telegramMessages: typeof telegramMessages;
  telegramOperations: typeof telegramOperations;
  telegramSend: typeof telegramSend;
  telegramSetup: typeof telegramSetup;
  telegramUpdate: typeof telegramUpdate;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

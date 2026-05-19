/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminAuth from "../adminAuth.js";
import type * as adminAuthNode from "../adminAuthNode.js";
import type * as assets from "../assets.js";
import type * as chats from "../chats.js";
import type * as documents from "../documents.js";
import type * as embeddingBatches from "../embeddingBatches.js";
import type * as evaluations from "../evaluations.js";
import type * as http from "../http.js";
import type * as ingestion from "../ingestion.js";
import type * as ingestionNode from "../ingestionNode.js";
import type * as lib_adminSession from "../lib/adminSession.js";
import type * as lib_answerPacket from "../lib/answerPacket.js";
import type * as lib_diagnosticQuery from "../lib/diagnosticQuery.js";
import type * as lib_documentReadiness from "../lib/documentReadiness.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_evaluationSeed from "../lib/evaluationSeed.js";
import type * as lib_exactTerms from "../lib/exactTerms.js";
import type * as lib_hybridRetrieval from "../lib/hybridRetrieval.js";
import type * as lib_inception from "../lib/inception.js";
import type * as lib_ingestDocument from "../lib/ingestDocument.js";
import type * as lib_ingestionState from "../lib/ingestionState.js";
import type * as lib_jina from "../lib/jina.js";
import type * as lib_mineru from "../lib/mineru.js";
import type * as lib_mineruCallback from "../lib/mineruCallback.js";
import type * as lib_mineruResult from "../lib/mineruResult.js";
import type * as lib_mineruTypes from "../lib/mineruTypes.js";
import type * as lib_normalize from "../lib/normalize.js";
import type * as lib_parsedPage from "../lib/parsedPage.js";
import type * as lib_providerErrors from "../lib/providerErrors.js";
import type * as lib_providerKeys from "../lib/providerKeys.js";
import type * as lib_providerRetry from "../lib/providerRetry.js";
import type * as lib_questionLanguage from "../lib/questionLanguage.js";
import type * as lib_validators from "../lib/validators.js";
import type * as providerRateLimits from "../providerRateLimits.js";
import type * as search from "../search.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminAuth: typeof adminAuth;
  adminAuthNode: typeof adminAuthNode;
  assets: typeof assets;
  chats: typeof chats;
  documents: typeof documents;
  embeddingBatches: typeof embeddingBatches;
  evaluations: typeof evaluations;
  http: typeof http;
  ingestion: typeof ingestion;
  ingestionNode: typeof ingestionNode;
  "lib/adminSession": typeof lib_adminSession;
  "lib/answerPacket": typeof lib_answerPacket;
  "lib/diagnosticQuery": typeof lib_diagnosticQuery;
  "lib/documentReadiness": typeof lib_documentReadiness;
  "lib/env": typeof lib_env;
  "lib/evaluationSeed": typeof lib_evaluationSeed;
  "lib/exactTerms": typeof lib_exactTerms;
  "lib/hybridRetrieval": typeof lib_hybridRetrieval;
  "lib/inception": typeof lib_inception;
  "lib/ingestDocument": typeof lib_ingestDocument;
  "lib/ingestionState": typeof lib_ingestionState;
  "lib/jina": typeof lib_jina;
  "lib/mineru": typeof lib_mineru;
  "lib/mineruCallback": typeof lib_mineruCallback;
  "lib/mineruResult": typeof lib_mineruResult;
  "lib/mineruTypes": typeof lib_mineruTypes;
  "lib/normalize": typeof lib_normalize;
  "lib/parsedPage": typeof lib_parsedPage;
  "lib/providerErrors": typeof lib_providerErrors;
  "lib/providerKeys": typeof lib_providerKeys;
  "lib/providerRetry": typeof lib_providerRetry;
  "lib/questionLanguage": typeof lib_questionLanguage;
  "lib/validators": typeof lib_validators;
  providerRateLimits: typeof providerRateLimits;
  search: typeof search;
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

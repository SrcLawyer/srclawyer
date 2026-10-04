import type { Confidence, DataCategory } from "../engine/types.js";

/**
 * Client for the two protected-logic endpoints (see PRODUCT_SPEC.md for the trust-claim language
 * these calls are bound by). Mirrors resolveAmbiguousFindings.ts's established pattern deliberately:
 * batch, try/catch per batch, never throw out of this module — a failure here degrades the scan
 * (safe local fallback + a scan-level warning), it never crashes it.
 *
 * Batching is by total request-body bytes as well as item count: confirmed via wrangler tail that the
 * Worker's own CPU time limit is hit intermittently on large detect-zod-schema batches (large
 * code fragments mean more server-side parsing work per batch, not just more JSON to transfer). Count
 * alone (the original design) doesn't bound that — 25 large fragments can still be a very large batch.
 */

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_BATCH_MAX_BYTES = 50_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 500;

export interface ProtectedLogicClientOptions {
  baseUrl: string;
  apiKey: string;
  batchSize?: number;
  /** Max total JSON-serialized bytes of items per batch, in addition to batchSize -- whichever limit
   *  is hit first ends the batch. */
  batchMaxBytes?: number;
  timeoutMs?: number;
}

export interface ScoreFieldsItem {
  id: string;
  lexiconCategory: DataCategory | null;
  ambiguousName: boolean;
  runtimeVerified: boolean;
  siblingConfidentCount: number;
}

export interface ScoreFieldsResult {
  id: string;
  confidence: Confidence;
  requiresReview: boolean;
}

export interface DetectZodSchemaItem {
  id: string;
  codeFragment: string;
}

export interface DetectZodSchemaResult {
  id: string;
  matched: boolean;
  fields: Array<{ name: string; line: number }>;
}

export interface ProtectedLogicOutcome<T> {
  results: Map<string, T>;
  /** Non-null if any batch failed — callers should surface this via ScanResult.protectedLogicWarning. */
  error: string | null;
}

/**
 * Greedily fills batches up to maxCount items AND maxBytes of JSON-serialized item size, whichever
 * comes first. A single item already at or over maxBytes (shouldn't happen for zod candidates — see
 * zodPreFilter.ts's own per-fragment cap, enforced upstream — but score-fields items have no such cap)
 * still gets its own one-item batch rather than being dropped, so this never silently discards data;
 * only the per-fragment cap upstream does that, and it always warns when it does.
 */
function chunkByCountAndBytes<T>(items: T[], maxCount: number, maxBytes: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    const wouldExceed = current.length > 0 && (current.length >= maxCount || currentBytes + itemBytes > maxBytes);
    if (wouldExceed) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(item);
    currentBytes += itemBytes;
  }
  if (current.length > 0) batches.push(current);

  return batches;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson<TResponse>(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<TResponse> {
  const MAX_ATTEMPTS = 2; // one retry, on a 5xx only -- a 4xx (bad request, auth) won't succeed on retry

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let status: number;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.ok) return (await response.json()) as TResponse;
      status = response.status;
    } finally {
      clearTimeout(timeout);
    }

    const isLastAttempt = attempt === MAX_ATTEMPTS;
    if (status < 500 || isLastAttempt) {
      throw new Error(`protected-logic request failed (${status})`);
    }
    await sleep(RETRY_BACKOFF_MS);
  }

  // Unreachable: the loop above always either returns or throws.
  throw new Error("protected-logic request failed (unreachable)");
}

export async function scoreFields(
  items: ScoreFieldsItem[],
  options: ProtectedLogicClientOptions
): Promise<ProtectedLogicOutcome<ScoreFieldsResult>> {
  const results = new Map<string, ScoreFieldsResult>();
  if (items.length === 0) return { results, error: null };

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchMaxBytes = options.batchMaxBytes ?? DEFAULT_BATCH_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let error: string | null = null;

  for (const batch of chunkByCountAndBytes(items, batchSize, batchMaxBytes)) {
    try {
      const response = await postJson<{ results: ScoreFieldsResult[] }>(
        `${options.baseUrl}/v1/score-fields`,
        options.apiKey,
        { fields: batch },
        timeoutMs
      );
      for (const result of response.results) results.set(result.id, result);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return { results, error };
}

export async function detectZodSchemas(
  items: DetectZodSchemaItem[],
  options: ProtectedLogicClientOptions
): Promise<ProtectedLogicOutcome<DetectZodSchemaResult>> {
  const results = new Map<string, DetectZodSchemaResult>();
  if (items.length === 0) return { results, error: null };

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batchMaxBytes = options.batchMaxBytes ?? DEFAULT_BATCH_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let error: string | null = null;

  for (const batch of chunkByCountAndBytes(items, batchSize, batchMaxBytes)) {
    try {
      const response = await postJson<{ results: DetectZodSchemaResult[] }>(
        `${options.baseUrl}/v1/detect-zod-schema`,
        options.apiKey,
        { candidates: batch },
        timeoutMs
      );
      for (const result of response.results) results.set(result.id, result);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return { results, error };
}

import type { Confidence, DataCategory } from "../engine/types.js";

/**
 * Client for the two protected-logic endpoints (see PRODUCT_SPEC.md for the trust-claim language
 * these calls are bound by). Mirrors resolveAmbiguousFindings.ts's established pattern deliberately:
 * batch, try/catch per batch, never throw out of this module — a failure here degrades the scan
 * (safe local fallback + a scan-level warning), it never crashes it.
 */

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface ProtectedLogicClientOptions {
  baseUrl: string;
  apiKey: string;
  batchSize?: number;
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

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

async function postJson<TResponse>(url: string, apiKey: string, body: unknown, timeoutMs: number): Promise<TResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`protected-logic request failed (${response.status})`);
    }
    return (await response.json()) as TResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function scoreFields(
  items: ScoreFieldsItem[],
  options: ProtectedLogicClientOptions
): Promise<ProtectedLogicOutcome<ScoreFieldsResult>> {
  const results = new Map<string, ScoreFieldsResult>();
  if (items.length === 0) return { results, error: null };

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let error: string | null = null;

  for (const batch of chunk(items, batchSize)) {
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let error: string | null = null;

  for (const batch of chunk(items, batchSize)) {
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

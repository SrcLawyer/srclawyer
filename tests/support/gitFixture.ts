import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function tempDir(prefix = "srclawyer-fixture-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.test", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function initRepo(root: string, files: Record<string, string>): void {
  git(root, "init", "-q", "-b", "main");
  writeFiles(root, files);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
}

export function cloneRepo(from: string, into: string): void {
  execFileSync("git", ["clone", "-q", from, into], { stdio: ["ignore", "pipe", "pipe"] });
}

/** A request the Worker stand-in saw. */
export interface WorkerCall {
  url: string;
}

/**
 * Stands in for the protected-logic Worker: score-fields echoes every id with the given verdict, and
 * detect-zod-schema reports `zodFields` for every candidate. Anything else (e.g. Anthropic) throws, so a
 * test that must never reach another host fails loudly.
 */
export function workerStandIn(options: { reviewRequired?: boolean; zodFields?: string[] } = {}) {
  const calls: WorkerCall[] = [];
  const impl = async (url: unknown, init?: RequestInit): Promise<Response> => {
    const href = String(url);
    calls.push({ url: href });
    const body = JSON.parse(String(init?.body));
    const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    if (href.endsWith("/v1/score-fields")) {
      return reply({
        results: body.fields.map((f: { id: string }) => ({
          id: f.id,
          confidence: options.reviewRequired ? "low" : "high",
          requiresReview: Boolean(options.reviewRequired),
        })),
      });
    }
    if (href.endsWith("/v1/detect-zod-schema")) {
      return reply({
        results: body.candidates.map((c: { id: string }) => ({
          id: c.id,
          matched: (options.zodFields ?? []).length > 0,
          fields: (options.zodFields ?? []).map((name) => ({ name, line: 2 })),
        })),
      });
    }
    throw new Error(`unexpected fetch to ${href}`);
  };
  return { calls, impl };
}

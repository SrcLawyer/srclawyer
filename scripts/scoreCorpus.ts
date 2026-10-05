import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scan } from "../src/engine/scanEngine.js";
import { resolveProtectedLogic } from "../src/cloud/resolveProtectedLogic.js";
import { resolveProtectedLogicEndpoint } from "../src/cloud/config.js";
import { resolveProviderForTier } from "../src/llm/resolveProviderForTier.js";
import { resolveAmbiguousFindings } from "../src/llm/resolveAmbiguousFindings.js";
import { MAX_FRAGMENT_BYTES } from "../src/rules/zodPreFilter.js";
import type { Finding } from "../src/engine/types.js";
import type { SrcLawyerConfig } from "../src/config/config.js";
import { scoreCorpus, type ExpectedFinding } from "./corpusScoring.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, "..", "test-fixtures", "golden-corpus", "manifest.json");
const EXPECTED_DIR = join(HERE, "..", "test-fixtures", "golden-corpus", "expected-findings");
const BASELINE_PATH = join(HERE, "..", "test-fixtures", "golden-corpus", "baseline.json");
const CACHE_DIR = process.env.CORPUS_CACHE_DIR ?? join(tmpdir(), "srclawyer-corpus-cache");

interface RepoManifestEntry {
  name: string;
  url: string;
  pinnedSha: string;
  license: string;
  notes: string;
}

interface Manifest {
  repos: RepoManifestEntry[];
  methodology: string;
}

function currentHeadSha(dir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

function ensureCloned(repo: RepoManifestEntry): string {
  const dir = join(CACHE_DIR, repo.name);
  if (existsSync(join(dir, ".git")) && currentHeadSha(dir) === repo.pinnedSha) {
    return dir;
  }

  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  try {
    execFileSync("git", ["remote", "add", "origin", repo.url], { cwd: dir });
  } catch {
    // remote already exists from a partial prior run
  }
  execFileSync("git", ["fetch", "--depth", "1", "origin", repo.pinnedSha], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  execFileSync("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: dir });
  return dir;
}

const LLM_CONFIG: SrcLawyerConfig = {
  entityLocation: null,
  targetMarkets: [],
  industry: null,
  collectsChildrensData: false,
  tier: "byok",
  llm: { provider: "anthropic", apiKeyEnvVar: "ANTHROPIC_API_KEY" },
};

async function resolveWithLayer2(findings: Finding[]): Promise<Finding[] | null> {
  const { provider, error } = resolveProviderForTier(LLM_CONFIG);
  if (error || !provider) {
    console.error(`  Layer 2 skipped: ${error ?? "no provider"}`);
    return null;
  }

  const ambiguous = findings.filter((f) => f.requiresReview);
  if (ambiguous.length === 0) return findings;

  console.error(`  Sending ${ambiguous.length} ambiguous item(s) to ${provider.name} (real API calls)...`);
  const resolved = await resolveAmbiguousFindings(ambiguous, provider, {
    collectsChildrensData: LLM_CONFIG.collectsChildrensData,
  });
  const resolvedById = new Map(resolved.map((f) => [f.id, f]));
  return findings.map((f) => resolvedById.get(f.id) ?? f);
}

async function main(): Promise<void> {
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const updateBaseline = process.argv.includes("--update-baseline");
  const withLlm = process.argv.includes("--with-llm");
  const priorBaseline: Record<string, { recall: number }> = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    : {};

  const endpoint = resolveProtectedLogicEndpoint();
  console.error(`Protected-logic endpoint: ${endpoint.baseUrl} (override with SRCLAWYER_PROTECTED_LOGIC_URL, e.g. a local wrangler dev instance)`);

  const results: Record<string, ReturnType<typeof scoreCorpus>> = {};
  let regression = false;

  for (const repo of manifest.repos) {
    console.error(`\n=== ${repo.name} (${repo.pinnedSha.slice(0, 12)}) ===`);
    const repoDir = ensureCloned(repo);
    const expected: ExpectedFinding[] = JSON.parse(readFileSync(join(EXPECTED_DIR, `${repo.name}.json`), "utf8"));
    const scanResult = await scan(repoDir);

    const { findings: scoredFindings, warning } = await resolveProtectedLogic(
      scanResult.findings,
      scanResult.pendingZodCandidates,
      endpoint,
      scanResult.oversizedZodFiles
    );
    if (warning) console.error(`  protected-logic warning: ${warning}`);

    const score = scoreCorpus(repo.name, scoredFindings, expected);
    results[repo.name] = score;

    console.error(`  filesScanned: ${scanResult.filesScanned}, totalFindings: ${score.totalFindings}`);
    if (scanResult.maxZodFragmentBytes > 0) {
      console.error(`  largest Zod-schema fragment: ${scanResult.maxZodFragmentBytes} bytes (hard ceiling: ${MAX_FRAGMENT_BYTES} bytes)`);
    }
    console.error(`  [Layer 1 only]     recall: ${score.matchedExpected}/${score.totalExpected} = ${(score.recall * 100).toFixed(0)}%   precision (informational): ${score.findingsMatchingSomeExpected}/${score.totalFindings} = ${(score.precision * 100).toFixed(0)}%`);

    if (score.unmatchedExpected.length > 0) {
      console.error("  missed expected findings (Layer 1 only):");
      for (const u of score.unmatchedExpected) {
        console.error(`    - ${u.filePattern}:${u.lineRange[0]}-${u.lineRange[1]} [${u.dataCategory}] — ${u.note ?? ""}`);
      }
    }

    if (withLlm) {
      const combinedFindings = await resolveWithLayer2(scoredFindings);
      if (combinedFindings) {
        const combinedScore = scoreCorpus(repo.name, combinedFindings, expected);
        console.error(
          `  [Layer 1 + 2]       recall: ${combinedScore.matchedExpected}/${combinedScore.totalExpected} = ${(combinedScore.recall * 100).toFixed(0)}%   precision (informational): ${combinedScore.findingsMatchingSomeExpected}/${combinedScore.totalFindings} = ${(combinedScore.precision * 100).toFixed(0)}%`
        );
        if (combinedScore.matchedExpected !== score.matchedExpected) {
          console.error(
            `  Layer 2 changed recall for this repo: ${score.matchedExpected} -> ${combinedScore.matchedExpected} of ${score.totalExpected} expected entries matched.`
          );
        }
      }
    }

    const prior = priorBaseline[repo.name];
    if (prior && score.recall < prior.recall) {
      console.error(`  REGRESSION: recall dropped from ${(prior.recall * 100).toFixed(0)}% to ${(score.recall * 100).toFixed(0)}%`);
      regression = true;
    }
  }

  if (updateBaseline) {
    const baseline = Object.fromEntries(Object.entries(results).map(([name, r]) => [name, { recall: r.recall }]));
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.error(`\nBaseline written to ${BASELINE_PATH}`);
  }

  if (regression) {
    console.error("\nFAILED: recall regressed against the stored baseline.");
    process.exitCode = 1;
    return;
  }
  console.error("\nOK");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

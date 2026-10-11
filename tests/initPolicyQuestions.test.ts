import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { runInit, type InitFlags } from "../src/commands/init.js";
import { loadConfig } from "../src/config/config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "srclawyer-init-policy-"));
}

async function runWithStdin(root: string, answers: string[], flags: InitFlags = {}): Promise<void> {
  const stdin = Readable.from([answers.join("\n") + "\n"]);
  const realStdin = process.stdin;
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  try {
    await runInit(root, flags);
  } finally {
    Object.defineProperty(process, "stdin", { value: realStdin, configurable: true });
  }
}

describe("init: optional policy-detail questions", () => {
  let dir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("the gate defaults to yes and asks all eleven sub-questions, writing every answer", async () => {
    dir = tempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runWithStdin(dir, [
      "US", // entityLocation
      "EU, US", // targetMarkets
      "SaaS", // industry
      "no", // collectsChildrensData
      "", // gate -- blank adopts default "y"
      "13", // minimumAge
      "Acme Inc.", // companyName
      "https://acme.example", // siteUrl
      "privacy@acme.example", // privacyContactEmail
      "", // hasEuUkUsers -- blank adopts the targetMarkets-derived suggestion (true, since "EU" is present)
      "n", // hasCaliforniaUsers
      "y", // sellsOrSharesData
      "n", // usesDataForAdvertising
      "2 years after account closure", // dataRetentionPolicy
      "Email privacy@acme.example", // accountDeletionInstructions
      "n", // sendsDataToAiServices
      "n", // enable byok
    ]);

    const config = loadConfig(dir);
    expect(config?.minimumAge).toBe(13);
    expect(config?.companyName).toBe("Acme Inc.");
    expect(config?.siteUrl).toBe("https://acme.example");
    expect(config?.privacyContactEmail).toBe("privacy@acme.example");
    expect(config?.hasEuUkUsers).toBe(true);
    expect(config?.hasCaliforniaUsers).toBe(false);
    expect(config?.sellsOrSharesData).toBe(true);
    expect(config?.usesDataForAdvertising).toBe(false);
    expect(config?.dataRetentionPolicy).toBe("2 years after account closure");
    expect(config?.accountDeletionInstructions).toBe("Email privacy@acme.example");
    expect(config?.sendsDataToAiServices).toBe(false);
  });

  it("declining the gate leaves all eleven fields null and asks none of the sub-questions", async () => {
    dir = tempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runWithStdin(dir, [
      "US",
      "",
      "",
      "no",
      "n", // decline the gate
      "n", // enable byok
    ]);

    const config = loadConfig(dir);
    expect(config?.minimumAge).toBeNull();
    expect(config?.companyName).toBeNull();
    expect(config?.siteUrl).toBeNull();
    expect(config?.privacyContactEmail).toBeNull();
    expect(config?.hasEuUkUsers).toBeNull();
    expect(config?.hasCaliforniaUsers).toBeNull();
    expect(config?.sellsOrSharesData).toBeNull();
    expect(config?.usesDataForAdvertising).toBeNull();
    expect(config?.dataRetentionPolicy).toBeNull();
    expect(config?.accountDeletionInstructions).toBeNull();
    expect(config?.sendsDataToAiServices).toBeNull();

    const promptedText = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(promptedText).not.toContain("Company or product name");
    expect(promptedText).not.toContain("Minimum age required");
  });

  it("an explicit per-field flag wins even when the gate is declined", async () => {
    dir = tempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runWithStdin(
      dir,
      ["US", "", "", "no", "n"],
      { policyDetails: false, companyName: "Flag Co.", minimumAge: 21 }
    );

    const config = loadConfig(dir);
    expect(config?.companyName).toBe("Flag Co.");
    expect(config?.minimumAge).toBe(21);
    // Fields neither flagged nor asked (gate declined) stay null.
    expect(config?.siteUrl).toBeNull();
  });

  it("--no-policy-details skips the gate prompt entirely and leaves unflagged fields null", async () => {
    dir = tempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runWithStdin(dir, ["US", "", "", "no", "n"], { policyDetails: false });

    const promptedText = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(promptedText).not.toContain("Add privacy policy details now?");
  });

  it("warns when target markets suggest EU/UK users but the answer explicitly says no", async () => {
    dir = tempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runWithStdin(dir, [
      "US",
      "EU", // targetMarkets signals EU
      "",
      "no",
      "", // gate default yes
      "", // minimumAge
      "", // companyName
      "", // siteUrl
      "", // privacyContactEmail
      "n", // hasEuUkUsers -- explicit contradiction
      "n", // hasCaliforniaUsers
      "n", // sellsOrSharesData
      "n", // usesDataForAdvertising
      "", // dataRetentionPolicy
      "", // accountDeletionInstructions
      "n", // sendsDataToAiServices
      "n", // enable byok
    ]);

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("target markets suggest EU/UK users");

    const config = loadConfig(dir);
    expect(config?.hasEuUkUsers).toBe(false);
  });

  it("does not warn when a blank answer adopts the target-markets-derived suggestion", async () => {
    dir = tempDir();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await runWithStdin(dir, [
      "US",
      "EU",
      "",
      "no",
      "",
      "",
      "",
      "",
      "",
      "", // hasEuUkUsers -- blank, adopts the suggested "true"
      "n",
      "n",
      "n",
      "",
      "",
      "n",
      "n",
    ]);

    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("target markets suggest");

    const config = loadConfig(dir);
    expect(config?.hasEuUkUsers).toBe(true);
  });
});

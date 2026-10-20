import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_FEATURES, featureKey, featuresFor, evidentCategories } from "../src/rules/serviceFeatures.js";
import { PROCESSOR_PROFILES } from "../src/rules/processorProfiles.js";
import { generatePolicyMarkdown } from "../src/policy/generatePolicy.js";
import { assessPublishable, countUnconfirmedServiceFeatures } from "../src/assistant/publishable.js";
import { DEFAULT_CONFIG, loadConfig, type SrcLawyerConfig } from "../src/config/config.js";
import { DATA_CATEGORY_LABELS } from "../src/policy/dataCategoryLabels.js";
import { runInit } from "../src/commands/init.js";
import { runUpdate, REVIEW_FILENAME } from "../src/commands/update.js";
import { runQuestions } from "../src/commands/questionsCommand.js";
import { answerReport, AnswerError } from "../src/commands/answer.js";
import { runApprove } from "../src/commands/approve.js";
import { computeProjectState } from "../src/assistant/state.js";
import { DEFAULT_INVENTORY_PATH, parseInventory } from "../src/inventory/inventory.js";
import { SERVICE_QUESTION_DEFS } from "../src/assistant/questions.js";
import { initRepo, tempDir, writeFiles } from "./support/gitFixture.js";
import type { Finding, ScanResult } from "../src/engine/types.js";

const dirs: string[] = [];
const originalExitCode = process.exitCode;
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("the service-feature table", () => {
  it("every feature belongs to a real profile, and moves only categories that profile has", () => {
    const ids = new Set<string>();
    for (const f of SERVICE_FEATURES) {
      const profile = PROCESSOR_PROFILES[f.profileKey];
      expect(profile, f.profileKey).toBeTruthy();
      for (const c of f.categories) {
        expect(profile!.dataCategories, `${f.profileKey}.${f.id}:${c}`).toContain(c);
        expect(DATA_CATEGORY_LABELS).toHaveProperty(c);
      }
      expect(ids.has(featureKey(f))).toBe(false);
      ids.add(featureKey(f));
    }
  });

  it.each(SERVICE_FEATURES)("$profileKey.$id: every moved category and the condition have a quote from an https page", (f) => {
    const about = new Set(f.sources.map((s) => s.about));
    for (const c of f.categories) expect(about.has(`category:${c}`), `no quote for ${c}`).toBe(true);
    expect(about.has("condition"), "no quote that shows the feature is optional").toBe(true);
    for (const s of f.sources) {
      expect(new URL(s.url).protocol).toBe("https:");
      expect(s.quote.length).toBeGreaterThanOrEqual(8);
    }
    expect(f.ask.endsWith("?")).toBe(true);
  });

  it("the baseline is unchanged: every profile still lists every category it listed before", () => {
    const expected: Record<string, string[]> = {
      stripe: ["payment_info", "name", "email", "physical_address"],
      sendgrid: ["email", "name"],
      "google-analytics": ["analytics_usage", "ip_address", "device_id"],
      auth0: ["email", "authentication_credentials", "name"],
      firebase: ["email", "authentication_credentials", "device_id", "analytics_usage"],
      cognito: ["email", "authentication_credentials", "phone"],
      twilio: ["phone"],
      mixpanel: ["analytics_usage", "device_id"],
      supabase: ["email", "phone", "authentication_credentials"],
      posthog: ["analytics_usage", "ip_address", "device_id"],
      sentry: ["ip_address"],
      intercom: ["email", "name", "device_id"],
    };
    for (const [key, cats] of Object.entries(expected)) expect(PROCESSOR_PROFILES[key]!.dataCategories, key).toEqual(cats);
  });

  it("evident categories are what is left once the optional features are taken out", () => {
    expect(evidentCategories("stripe", PROCESSOR_PROFILES.stripe!.dataCategories)).toEqual(["payment_info"]);
    expect(evidentCategories("supabase", PROCESSOR_PROFILES.supabase!.dataCategories)).toEqual([]);
    expect(evidentCategories("posthog", PROCESSOR_PROFILES.posthog!.dataCategories)).toEqual(["analytics_usage", "device_id"]);
    expect(evidentCategories("twilio", PROCESSOR_PROFILES.twilio!.dataCategories)).toEqual(["phone"]);
  });

  it("the questions are one per feature, optional, and worded as the table says", () => {
    expect(SERVICE_QUESTION_DEFS).toHaveLength(SERVICE_FEATURES.length);
    for (const [i, def] of SERVICE_QUESTION_DEFS.entries()) {
      expect(def).toMatchObject({ id: `service.${featureKey(SERVICE_FEATURES[i]!)}`, kind: "yes_no", blocking: false, sensitive: false, ask: SERVICE_FEATURES[i]!.ask });
    }
  });
});

// ---- the policy text ----
const emptyResult: ScanResult = { projects: [], findings: [], ambiguousCount: 0, filesScanned: 3, unsupportedStackWarning: null, workspaceWarning: null, skippedFiles: [], skippedFilesWarning: null, templateSyntaxNote: null, pendingZodCandidates: [], oversizedZodFiles: [], maxZodFragmentBytes: 0 };
function sdkFinding(key: string, file = "src/a.js"): Finding {
  const p = PROCESSOR_PROFILES[key]!;
  return { id: `sdk:${key}:${file}:1`, dataCategories: p.dataCategories, processor: p.name, description: `${p.name} integration detected. ${p.disclosureNotes}`, confidence: "high", source: "sdk-rule", location: { file, line: 1, column: 0 }, evidence: "", requiresReview: false };
}
const FULL: SrcLawyerConfig = {
  ...DEFAULT_CONFIG, companyName: "A", siteUrl: "https://a.test", privacyContactEmail: "a@a.test", hasEuUkUsers: false, hasCaliforniaUsers: false, sellsOrSharesData: false,
  usesDataForAdvertising: false, dataRetentionPolicy: "x", accountDeletionInstructions: "y", minimumAge: 13, sendsDataToAiServices: false, collectsChildrensData: false,
};
const render = (keys: string[], config: Partial<SrcLawyerConfig> = {}) => generatePolicyMarkdown({ ...emptyResult, findings: keys.map((k) => sdkFinding(k)) }, { ...FULL, ...config });

describe("the policy: 'May Be Collected Through Services You Use'", () => {
  it("lists a conditional category in the new section, not as collected, until the owner answers", () => {
    const text = render(["supabase"]);
    expect(text).toContain("## May Be Collected Through Services You Use");
    expect(text).toContain("Some of the third-party services used by this product can collect the following, depending on how they are set up. This list describes what each service documents; it does not say that this product collects the data.");
    expect(text).toContain("- **Supabase** (Supabase Auth): email addresses, phone numbers and authentication credentials.");
    expect(text).not.toContain("### Email addresses");
    expect(text).not.toContain("### Phone numbers");
    expect(text).not.toContain("No data-collection patterns were confidently identified"); // not contradicted by the section below
    expect(text).toContain("## Third-Party Data Processors");
  });

  it("'yes' moves the categories into Data We Collect, attributed to the service, and removes the section", () => {
    const text = render(["supabase"], { serviceUse: { "supabase.auth": true } });
    expect(text).not.toContain("May Be Collected Through Services You Use");
    expect(text).toMatch(/### Email addresses\n\n- Supabase integration detected\..* \(via Supabase\)/);
    expect(text).toContain("### Authentication credentials");
  });

  it("'no' leaves the categories out of both places, and still lists the service as a processor", () => {
    const text = render(["supabase"], { serviceUse: { "supabase.auth": false } });
    expect(text).not.toContain("May Be Collected Through Services You Use");
    expect(text).not.toContain("### Email addresses");
    expect(text).toContain("**Supabase**");
  });

  it("keeps the certain categories under Data We Collect and moves only the optional ones", () => {
    const text = render(["stripe"]);
    expect(text).toContain("### Payment information");
    expect(text).toContain("- **Stripe** (customer details): names, email addresses and physical or mailing addresses.");
    expect(text).not.toContain("### Names");
    const yes = render(["stripe"], { serviceUse: { "stripe.customer-details": true } });
    expect(yes).toContain("### Names");
    expect(yes).toContain("### Payment information");
  });

  it("a category another finding reads from the code stays listed as collected", () => {
    const own: Finding = { id: "web:email", dataCategories: ["email"], processor: null, description: "Reads `email` from the request body.", confidence: "high", source: "web-api-rule", location: { file: "src/x.js", line: 3, column: 0 }, evidence: "", requiresReview: false };
    const text = generatePolicyMarkdown({ ...emptyResult, findings: [sdkFinding("supabase"), own] }, FULL);
    expect(text).toContain("### Email addresses");
    expect(text).toContain("- Reads `email` from the request body.");
    expect(text).toContain("- **Supabase** (Supabase Auth): email addresses, phone numbers and authentication credentials.");
  });

  it("lists several services and several features, one bullet each, and each service once however many files use it", () => {
    const text = generatePolicyMarkdown({ ...emptyResult, findings: [sdkFinding("firebase", "a.js"), sdkFinding("firebase", "b.js"), sdkFinding("posthog")] }, FULL);
    expect(text.match(/\(Firebase Authentication\)/g)).toHaveLength(1);
    expect(text).toContain("- **Firebase** (Firebase Authentication): email addresses and authentication credentials.");
    expect(text).toContain("- **Firebase** (Google Analytics for Firebase): usage and analytics data and device identifiers.");
    expect(text).toContain("- **PostHog** (IP address capture): IP addresses.");
  });

  it("no section when nothing is conditional or every feature is answered; the old sentence returns when nothing was found", () => {
    expect(render(["twilio"])).not.toContain("May Be Collected");
    expect(render([])).toContain("No data-collection patterns were confidently identified in this codebase.");
  });

  it("generated mode shows the same section, with no locations", () => {
    const text = render(["supabase"], { policyMode: "generated" });
    expect(text).toContain("- **Supabase** (Supabase Auth): email addresses, phone numbers and authentication credentials.");
    expect(text).not.toContain("src/a.js");
  });

  it("the section is not a blank: a policy with it is still publishable, with a warning that counts the items", () => {
    const text = render(["supabase", "posthog", "stripe"]);
    expect(countUnconfirmedServiceFeatures(text)).toBe(3);
    const a = assessPublishable(text);
    expect(a.publishable).toBe(true);
    expect(a.publishableWarnings).toEqual([
      { code: "unconfirmed-service-feature", count: 3, message: '3 features of services you use are listed under "May Be Collected Through Services You Use" in your policy. Please confirm whether you use them before you publish.' },
    ]);
    const one = assessPublishable(render(["supabase"]));
    expect(one.publishableWarnings[0]!.message).toBe(
      '1 feature of a service you use is listed under "May Be Collected Through Services You Use" in your policy. Please confirm whether you use it before you publish.'
    );
    expect(assessPublishable(render(["supabase"], { serviceUse: { "supabase.auth": false } })).publishableWarnings).toEqual([]);
  });
});

// ---- the question flow ----
const PROJECT = { ".gitignore": "generated/\n", "src/db.js": 'import { createClient } from "@supabase/supabase-js";\n' };
const ANSWERS: Record<string, [string, string?]> = {
  companyName: ["Acme"], siteUrl: ["https://acme.test"], privacyContactEmail: ["p@acme.test"], collectsChildrensData: ["false", "owner: no"],
  minimumAge: ["none"], hasEuUkUsers: ["false", "owner: no"], hasCaliforniaUsers: ["false", "owner: no"], sellsOrSharesData: ["false", "owner: no"],
  usesDataForAdvertising: ["false", "owner: no"], dataRetentionPolicy: ["until the account is deleted"], accountDeletionInstructions: ["email p@acme.test"],
  sendsDataToAiServices: ["false", "owner: no"],
};
function quiet() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    throw new Error(`unexpected network call to ${String(url)}`);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  return vi.spyOn(console, "log").mockImplementation(() => {});
}
const answer = (root: string, id: string, value: string, note?: string) => answerReport(root, { inventoryPath: DEFAULT_INVENTORY_PATH, id, value, note, json: true });
const update = (root: string) => runUpdate(root, { inventoryPath: DEFAULT_INVENTORY_PATH, outDir: ".", format: "json" });
const last = (log: ReturnType<typeof quiet>) => JSON.parse(String(log.mock.calls.at(-1)![0]));
const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");

async function supabaseProject(policyMode?: "generated") {
  const root = tempDir();
  dirs.push(root);
  initRepo(root, PROJECT);
  const log = quiet();
  await runInit(root, { yes: true, ...(policyMode ? { policyMode } : {}) });
  process.exitCode = originalExitCode;
  for (const [id, [value, note]] of Object.entries(ANSWERS)) answer(root, id, value, note);
  return { root, log };
}

describe("the baseline and drift do not change", () => {
  it("the baseline still lists the categories Supabase implies, though the policy does not claim them", async () => {
    const { root } = await supabaseProject();
    const baseline = parseInventory(read(root, DEFAULT_INVENTORY_PATH));
    expect(baseline.ok && baseline.inventory.categories).toEqual(expect.arrayContaining(["email", "phone", "authentication_credentials"]));
    expect(baseline.ok && baseline.inventory.processors).toEqual(["Supabase"]);
    expect(read(root, "PRIVACY_POLICY.md")).toContain("May Be Collected Through Services You Use");
  });

  it("an answer never creates drift or changes the baseline", async () => {
    const { root, log } = await supabaseProject();
    await update(root);
    const first = last(log);
    const before = read(root, DEFAULT_INVENTORY_PATH);
    answer(root, "service.supabase.auth", "true");
    log.mockClear();
    await update(root);
    expect(last(log)).toMatchObject({ result: "no-drift", exitCode: 0, firstReview: true });
    expect(read(root, DEFAULT_INVENTORY_PATH)).toBe(before);
    expect(first.firstReview).toBe(true);
  });
});

describe("the question flow", () => {
  it("update asks about the optional feature of a service it found, as an optional question", async () => {
    const { root, log } = await supabaseProject();
    log.mockClear();
    await update(root);
    const report = last(log);
    const q = report.questions.find((x: { id: string }) => x.id === "service.supabase.auth");
    expect(q).toMatchObject({ ask: "Do you use Supabase to sign people in (Supabase Auth)?", currentAnswer: "not answered", sensitive: false });
    expect(read(root, REVIEW_FILENAME)).toContain("Do you use Supabase to sign people in (Supabase Auth)?");
    expect(report.summary).toContain("1 question needs your answer.");
  });

  it("questions lists it as optional with the approved if-unsure sentence, and it never blocks", async () => {
    const { root, log } = await supabaseProject();
    await update(root);
    log.mockClear();
    runQuestions(root, { inventoryPath: DEFAULT_INVENTORY_PATH, json: true });
    const report = last(log);
    const q = report.questions.find((x: { id: string }) => x.id === "service.supabase.auth");
    expect(q).toMatchObject({
      kind: "yes_no", blocking: false, sensitive: false, reason: "unanswered",
      options: [{ value: true, label: "Yes" }, { value: false, label: "No" }, { value: "unsure", label: "I'm not sure" }],
      ifUnsure: "No problem. It stays listed as something that may be collected, and you'll see a reminder before you publish.",
      answerWith: "srclawyer answer service.supabase.auth <true|false|unsure>",
      current: { answered: false, value: null },
    });
    expect(computeProjectState(root).openQuestionCount).toBe(0);
  });

  it("answering yes records it in the config and the next update moves the data into the main section; no leaves it out", async () => {
    const { root, log } = await supabaseProject("generated");
    await update(root);
    expect(read(root, "PRIVACY_POLICY.md")).toContain("May Be Collected Through Services You Use");
    expect(answer(root, "service.supabase.auth", "yes")).toMatchObject({ ok: true, recorded: true, written: true });
    expect(loadConfig(root)!.serviceUse).toEqual({ "supabase.auth": true });
    log.mockClear();
    await update(root);
    expect(last(log).publishableWarnings).toEqual([]);
    expect(read(root, "PRIVACY_POLICY.md")).toContain("### Email addresses");
    expect(read(root, "PRIVACY_POLICY.md")).not.toContain("May Be Collected Through Services You Use");

    answer(root, "service.supabase.auth", "no");
    expect(loadConfig(root)!.serviceUse).toEqual({ "supabase.auth": false });
    await update(root);
    expect(read(root, "PRIVACY_POLICY.md")).not.toContain("### Email addresses");
  });

  it("'I'm not sure' records nothing, stops the question being re-asked, and the item stays a warning", async () => {
    const { root, log } = await supabaseProject("generated");
    await update(root);
    const before = read(root, ".srclawyer.config.yml");
    expect(answer(root, "service.supabase.auth", "unsure")).toMatchObject({ recorded: false, written: false });
    expect(read(root, ".srclawyer.config.yml")).toBe(before);
    const state = computeProjectState(root);
    expect(state.openQuestions.find((q) => q.def.id === "service.supabase.auth")).toMatchObject({ deferred: true, blocking: false });
    log.mockClear();
    await update(root);
    expect(last(log).publishableWarnings).toEqual([expect.objectContaining({ code: "unconfirmed-service-feature", count: 1 })]);
    expect(last(log).publishable).toBe(true);
  });

  it("refuses a bad value and an unknown service id", async () => {
    const { root } = await supabaseProject();
    expect(() => answer(root, "service.supabase.auth", "maybe")).toThrow(AnswerError);
    expect(() => answer(root, "service.nobody.thing", "yes")).toThrow(AnswerError);
    expect(loadConfig(root)!.serviceUse).toBeUndefined();
  });

  it("approve does not wait for these optional questions", async () => {
    const { root, log } = await supabaseProject();
    await update(root);
    const hash = last(log).reviewHash as string;
    log.mockClear();
    expect(await runApprove(root, { inventoryPath: DEFAULT_INVENTORY_PATH, review: hash, userReply: "yes", allowUnanswered: [], json: true })).toBe(0);
    expect(last(log).approved).toBe(true);
  });

  it("services that were not found raise no feature questions", async () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, { "src/pay.js": 'import twilio from "twilio";\n' });
    const log = quiet();
    await runInit(root, { yes: true });
    process.exitCode = originalExitCode;
    await update(root);
    expect(last(log).questions.some((x: { id: string }) => x.id.startsWith("service."))).toBe(false);
  });

  it("a service added later raises its feature question as part of that review", async () => {
    const { root, log } = await supabaseProject();
    await update(root);
    const hash = last(log).reviewHash as string;
    await runApprove(root, { inventoryPath: DEFAULT_INVENTORY_PATH, review: hash, userReply: "yes", allowUnanswered: [], json: true });
    writeFiles(root, { "src/errors.js": 'import * as Sentry from "@sentry/node";\n' });
    log.mockClear();
    await update(root);
    const ids = last(log).questions.map((x: { id: string }) => x.id);
    expect(ids).toContain("service.sentry.user-ip");
    expect(ids).not.toContain("service.supabase.auth"); // asked about once, not again
  });
});

describe("approve leaves the project up to date", () => {
  it("status reads up-to-date right after a successful approval, with no update in between", async () => {
    const { root, log } = await supabaseProject();
    await update(root);
    const hash = last(log).reviewHash as string;
    expect(computeProjectState(root).state).toBe("needs-approval");

    log.mockClear();
    expect(await runApprove(root, { inventoryPath: DEFAULT_INVENTORY_PATH, review: hash, userReply: "yes", allowUnanswered: [], json: true })).toBe(0);
    expect(last(log)).toMatchObject({ approved: true, state: "up-to-date", nextAction: { do: "none" } });
    expect(computeProjectState(root)).toMatchObject({ state: "up-to-date", baselineApproved: true });
  });

  it("after approving drift too", async () => {
    const { root, log } = await supabaseProject();
    await update(root);
    await runApprove(root, { inventoryPath: DEFAULT_INVENTORY_PATH, review: last(log).reviewHash, userReply: "yes", allowUnanswered: [], json: true });
    writeFiles(root, { "src/sms.js": 'import twilio from "twilio";\n' });
    log.mockClear();
    await update(root);
    expect(last(log).exitCode).toBe(1);
    answer(root, "dataRetentionPolicy", "30 days"); // the question the change raised
    log.mockClear();
    await update(root);
    const hash = last(log).reviewHash as string;
    log.mockClear();
    expect(await runApprove(root, { inventoryPath: DEFAULT_INVENTORY_PATH, review: hash, userReply: "yes", allowUnanswered: [], json: true })).toBe(0);
    expect(last(log).state).toBe("up-to-date");
    expect(computeProjectState(root).state).toBe("up-to-date");
  });

  it("questions the owner chose to leave unanswered are not asked again, and the state is up-to-date", async () => {
    const root = tempDir();
    dirs.push(root);
    initRepo(root, PROJECT);
    const log = quiet();
    await runInit(root, { yes: true });
    process.exitCode = originalExitCode;
    await update(root);
    const hash = last(log).reviewHash as string;
    log.mockClear();
    expect(await runApprove(root, { inventoryPath: DEFAULT_INVENTORY_PATH, review: hash, userReply: "yes", allowUnanswered: Object.keys(ANSWERS), json: true })).toBe(0);
    expect(last(log).state).toBe("up-to-date");
    const state = computeProjectState(root);
    expect(state.state).toBe("up-to-date");
    expect(state.openQuestionCount).toBe(0);
    expect(state.publishable).toBe(false); // the blanks are still in the policy
  });
});

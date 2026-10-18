import type { SrcLawyerConfig } from "../config/config.js";

// Every `ask`, `why`, `explain` and `ifUnsure` below is the exact wording in docs/question-catalog.md.
// tests/questionCatalogSync.test.ts fails if a string here is not found verbatim in that file, so
// wording can only change together with the reviewed document. No repository-derived text is ever
// substituted into these strings (names come from SrcLawyer's own tables, numbers from the scan).

export type QuestionKind = "yes_no" | "text" | "age" | "list";

export interface QuestionDef {
  id: string;
  /** The config key the answer is written to. */
  field: keyof SrcLawyerConfig;
  kind: QuestionKind;
  ask: string;
  why: string;
  /** An unanswered blocking question leaves a [TO COMPLETE] blank in the policy. */
  blocking: boolean;
  /** Sensitive answers need a note and are repeated back before approval. */
  sensitive: boolean;
  /** Plain-English explanation the assistant may read aloud; present for the six sensitive questions only. */
  explain?: string;
}

export const IF_UNSURE_BLOCKING =
  "No problem. I'll leave a clearly marked blank in the policy, and it can't be marked ready to publish until someone fills it in.";
export const IF_UNSURE_NON_BLOCKING = "No problem. The policy will say 'not specified'.";

const NOT_LEGAL_ADVICE = "This is a plain-English summary, not legal advice.";

export const QUESTION_DEFS: QuestionDef[] = [
  { id: "companyName", field: "companyName", kind: "text", blocking: true, sensitive: false,
    ask: "What name should appear as the owner of this policy? Use your company name, or your own name if you're an individual.",
    why: "The policy says who issues it." },
  { id: "siteUrl", field: "siteUrl", kind: "text", blocking: true, sensitive: false,
    ask: "What is the web address of your app or site? For example, https://example.com.",
    why: "The policy says where it applies." },
  { id: "privacyContactEmail", field: "privacyContactEmail", kind: "text", blocking: true, sensitive: false,
    ask: "What email address should people use for privacy questions, or to ask you to delete their data?",
    why: "The policy tells people how to reach you about their personal data. Use an address you actually read. It will be shown publicly in the policy." },
  { id: "collectsChildrensData", field: "collectsChildrensData", kind: "yes_no", blocking: true, sensitive: true,
    ask: "Does your app knowingly collect information from children, or is your app aimed at children? Children means under 13 in the US, or under 16 in some parts of Europe.",
    why: "Children's data has stricter rules, and the policy has to say whether you collect it.",
    explain: `This question has two parts: whether you knowingly collect information from children, and whether your app is aimed at children. Roughly, "knowingly" means you ask for a user's age, or you can tell from what you hold that someone is a child. "Aimed at children" means the app's content, design or marketing is meant for them. The age limit differs by place: the policy refers to under 13 in the US and under 16 in some parts of Europe. If you answer yes, the policy will say the product knowingly collects personal data from children. If you answer no, it will say it doesn't. ${NOT_LEGAL_ADVICE}` },
  { id: "minimumAge", field: "minimumAge", kind: "age", blocking: true, sensitive: false,
    ask: "What is the youngest age you allow to use your app? Give a number, or say there's no minimum.",
    why: "The policy states a minimum age if you have one." },
  { id: "hasEuUkUsers", field: "hasEuUkUsers", kind: "yes_no", blocking: true, sensitive: true,
    ask: "Do you have users in the European Union or the United Kingdom?",
    why: "People there have extra privacy rights, and the policy has to mention them if they apply.",
    explain: `The EU and the UK have privacy laws (the GDPR and the UK GDPR) that can apply when people there use your app, even if your business is based somewhere else. "Users" here means people who use your app or site, whether or not they pay. If you answer yes, the policy will include a short paragraph about the rights those laws give. If you answer no, it will say you haven't declared users there. ${NOT_LEGAL_ADVICE}` },
  { id: "hasCaliforniaUsers", field: "hasCaliforniaUsers", kind: "yes_no", blocking: true, sensitive: true,
    ask: "Do you have users in California?",
    why: "California residents have extra privacy rights, and the policy has to mention them if they apply.",
    explain: `California has privacy laws (the CCPA and CPRA) that can apply when California residents use your app, even if your business is based somewhere else. "Users" here means people who use your app or site, whether or not they pay. If you answer yes, the policy will include a short paragraph about the rights those laws give. If you answer no, it will say you haven't declared users there. ${NOT_LEGAL_ADVICE}` },
  { id: "sellsOrSharesData", field: "sellsOrSharesData", kind: "yes_no", blocking: true, sensitive: true,
    ask: "Does your app sell personal information, or share it with other companies so they can use it for their own advertising or marketing?",
    why: "Laws such as California's CCPA/CPRA require a policy to say so. If you aren't sure whether a tool you use counts, choose I'm not sure.",
    explain: `In these laws, "selling" can mean giving personal information to another company in exchange for money or something else of value, and "sharing" can mean giving it to another company so it can show ads based on what a person does across different sites or apps. Whether a particular tool counts can be a legal question. If you answer yes, the policy will say you have declared that you sell or share personal data. If you answer no, it will say you haven't declared that. If you aren't sure whether a tool you use counts, choose I'm not sure. ${NOT_LEGAL_ADVICE}` },
  { id: "usesDataForAdvertising", field: "usesDataForAdvertising", kind: "yes_no", blocking: true, sensitive: true,
    ask: "Do you use personal information to show people ads based on what they do on other websites or apps? This includes sending their activity to an advertising company, for example through a tracking pixel, so that company can show them ads elsewhere.",
    why: "Laws such as California's CCPA/CPRA require a policy to say so.",
    explain: `"Cross-context behavioral advertising" means showing people ads based on what they did on other websites or apps, not only on yours. For example, you might add an advertising company's tracking pixel to your site, or send your users' activity to an advertising network, so that company can show those people ads elsewhere. If you answer yes, the policy will say you have declared this. If you answer no, it will say you haven't. ${NOT_LEGAL_ADVICE}` },
  { id: "dataRetentionPolicy", field: "dataRetentionPolicy", kind: "text", blocking: true, sensitive: false,
    ask: `How long do you keep users' personal data? For example, "until the account is deleted" or "12 months after last use".`,
    why: "Policies usually say how long data is kept." },
  { id: "accountDeletionInstructions", field: "accountDeletionInstructions", kind: "text", blocking: true, sensitive: false,
    ask: `How can a user delete their account, or ask you to delete their data? For example, "email privacy@example.com" or "Settings, then Delete account".`,
    why: "Policies usually explain how people can have their data deleted." },
  { id: "sendsDataToAiServices", field: "sendsDataToAiServices", kind: "yes_no", blocking: true, sensitive: true,
    ask: "Does your app send what people type, upload or say to an AI service, such as OpenAI or Anthropic?",
    why: "A privacy policy should say whether user content is shared with AI providers.",
    explain: `This question is about your app's own features, for example a chat box in your app that sends what the user types to an AI service. It isn't about AI tools you use yourself to build or run the app. If you answer yes, the policy will say user data may be sent to third-party AI services. If you answer no, it will say it isn't. ${NOT_LEGAL_ADVICE}` },
  { id: "entityLocation", field: "entityLocation", kind: "text", blocking: false, sensitive: false,
    ask: "Which country is the person or company behind this app based in?",
    why: "Privacy rules depend partly on where the owner is located." },
  { id: "targetMarkets", field: "targetMarkets", kind: "list", blocking: false, sensitive: false,
    ask: "Which countries or regions are your users in? For example, US, EU, UK.",
    why: "Different regions have different privacy rules." },
  { id: "industry", field: "industry", kind: "text", blocking: false, sensitive: false,
    ask: "What kind of product is this? For example, online store, fitness app, school software.",
    why: "Some kinds of products, such as ones for children or health, have extra rules." },
];

export const QUESTION_BY_ID = new Map(QUESTION_DEFS.map((q) => [q.id, q]));

/** Whether the owner has given an answer for this question's config field. */
export function isAnswered(def: QuestionDef, config: SrcLawyerConfig | null): boolean {
  const value = config?.[def.field];
  switch (def.kind) {
    case "yes_no":
      return value === true || value === false;
    case "age":
      return typeof value === "number";
    case "list":
      return Array.isArray(value) && value.length > 0;
    case "text":
      return typeof value === "string" && value.trim() !== "";
  }
}

/** Setup questions whose answer is still empty, in catalog order. */
export function unansweredQuestions(config: SrcLawyerConfig | null): QuestionDef[] {
  return QUESTION_DEFS.filter((q) => !isAnswered(q, config));
}

export function currentAnswerWord(def: QuestionDef, config: SrcLawyerConfig | null): string {
  if (!isAnswered(def, config)) return "not answered";
  if (def.kind === "yes_no") return config?.[def.field] === true ? "yes" : "no";
  return "answered";
}

// ---- Questions raised by changes in the code (catalog section 1.2) ----

/** Joins names as "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export const TRIGGER_WHY = {
  ai: (names: string[]) => `Your code now uses ${joinNames(names)}. A privacy policy should say whether user content is shared with AI providers.`,
  analytics: (names: string[]) =>
    `Your code now uses ${joinNames(names)}, which collects information about how people use your app. The policy may need to mention people's rights in regions where you have users.`,
  advertising: (names: string[]) =>
    `Your code now uses ${joinNames(names)}, which can be used for advertising. Laws such as California's CCPA/CPRA require a policy to say whether data is sold, shared or used for ads.`,
  children: "Your code now appears to handle information that may relate to children. This has stricter rules, so the policy has to be accurate about it.",
  retentionBoth: (labels: string[], names: string[]) =>
    `Your code now appears to handle ${joinNames(labels)} or uses ${joinNames(names)}. Please check that your policy says how long that data is kept.`,
  retentionLabels: (labels: string[]) => `Your code now appears to handle ${joinNames(labels)}. Please check that your policy says how long that data is kept.`,
  retentionNames: (names: string[]) => `Your code now uses ${joinNames(names)}. Please check that your policy says how long that data is kept.`,
  account: "Your code now appears to handle account information. Please check that your policy explains how people can have it deleted.",
} as const;

/** Template forms of the triggered `why` lines, as written in the catalog (used by the sync test). */
export const TRIGGER_WHY_TEMPLATES = [
  "Your code now uses {names}. A privacy policy should say whether user content is shared with AI providers.",
  "Your code now uses {names}, which collects information about how people use your app. The policy may need to mention people's rights in regions where you have users.",
  "Your code now uses {names}, which can be used for advertising. Laws such as California's CCPA/CPRA require a policy to say whether data is sold, shared or used for ads.",
  TRIGGER_WHY.children,
  "Your code now appears to handle {labels} or uses {names}. Please check that your policy says how long that data is kept.",
  "Your code now appears to handle {labels}. Please check that your policy says how long that data is kept.",
  "Your code now uses {names}. Please check that your policy says how long that data is kept.",
  TRIGGER_WHY.account,
];

export interface QuestionTriggers {
  addedCategories: string[];
  /** Added processors with the tags from SrcLawyer's own vendor table. */
  addedProcessors: Array<{ name: string; tags: string[] }>;
  /** Display labels for the added categories, lower-cased for sentences. */
  addedCategoryLabels: string[];
}

export interface TriggeredQuestion {
  def: QuestionDef;
  why: string;
}

const ACCOUNT_CATEGORIES = new Set(["email", "name", "authentication_credentials"]);

/** The questions a diff raises (catalog section 1.2), each with its trigger-specific `why`, in catalog order. */
export function triggeredQuestions(t: QuestionTriggers): TriggeredQuestion[] {
  const whyByField = new Map<string, string>();
  const named = (tag: string[]) => t.addedProcessors.filter((p) => p.tags.some((x) => tag.includes(x))).map((p) => p.name);

  const ai = named(["ai"]);
  if (ai.length > 0) whyByField.set("sendsDataToAiServices", TRIGGER_WHY.ai(ai));
  const analytics = named(["analytics", "monitoring"]);
  if (analytics.length > 0) for (const f of ["hasEuUkUsers", "hasCaliforniaUsers"]) whyByField.set(f, TRIGGER_WHY.analytics(analytics));
  const advertising = named(["advertising"]);
  if (advertising.length > 0) for (const f of ["sellsOrSharesData", "usesDataForAdvertising"]) whyByField.set(f, TRIGGER_WHY.advertising(advertising));
  if (t.addedCategories.includes("childrens_data")) for (const f of ["collectsChildrensData", "minimumAge"]) whyByField.set(f, TRIGGER_WHY.children);

  const names = t.addedProcessors.map((p) => p.name);
  if (t.addedCategoryLabels.length > 0 && names.length > 0) whyByField.set("dataRetentionPolicy", TRIGGER_WHY.retentionBoth(t.addedCategoryLabels, names));
  else if (t.addedCategoryLabels.length > 0) whyByField.set("dataRetentionPolicy", TRIGGER_WHY.retentionLabels(t.addedCategoryLabels));
  else if (names.length > 0) whyByField.set("dataRetentionPolicy", TRIGGER_WHY.retentionNames(names));

  if (t.addedCategories.some((c) => ACCOUNT_CATEGORIES.has(c))) whyByField.set("accountDeletionInstructions", TRIGGER_WHY.account);

  return QUESTION_DEFS.filter((q) => whyByField.has(q.id)).map((def) => ({ def, why: whyByField.get(def.id)! }));
}

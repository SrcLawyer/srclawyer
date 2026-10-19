// Fixed sentences, verbatim from docs/question-catalog.md. tests/questionCatalogSync.test.ts fails if
// any string here is missing from that document. Only names from SrcLawyer's own tables, numbers and
// the owner's answers are ever substituted into them; never repository text.

export const NO_DRIFT_STATEMENT =
  "No new items found by the scanner since your last approved review. This is not a statement that your product or your policy is compliant.";
export const CHECK_NO_DRIFT_LINE = "Drift check: no new items found by the scanner.";

// ---- Coverage line (catalog section 4) ----
export const COVERAGE_STANDARD =
  "Coverage: scanned {n} files ({mode} discovery) for personal data read from requests in JavaScript/TypeScript (Express, Next.js) and Python (Flask), and for {k} known third-party services. Not covered: other languages and frameworks, calls to third-party services made with plain HTTP, scripts your pages load at runtime, and data handled outside this repository.";
export const COVERAGE_UNSUPPORTED =
  "Coverage: this project's main stack ({stack name}) isn't supported yet, so request data in it was not scanned. SrcLawyer did scan for {k} known third-party services.";
export const COVERAGE_SKIPPED = " {s} files were skipped or only partly analyzed.";
export const COVERAGE_TEMPLATE_SYNTAX = " Some HTML files contain template syntax, which is not analyzed.";
export const COVERAGE_AI_OFF = " AI-assisted review is off.";

// ---- Summary lines (catalog section 3.2) ----
export const SUMMARY = {
  added: "Your code now uses {Name}.",
  addedData: "Your code now appears to handle {label in lower case}.",
  addedChildren: "Your code now appears to handle information that may relate to children.",
  removed: "Your code no longer uses {Name}.",
  removedData: "The scanner no longer finds {label in lower case}.",
  questionsOne: "{n} question needs your answer.",
  questionsMany: "{n} questions need your answers.",
  blanksOne: "{n} blank in your policy still needs filling in, so it can't be marked ready to publish yet.",
  blanksMany: "{n} blanks in your policy still need filling in, so it can't be marked ready to publish yet.",
  nothingPublished: "Nothing has been published or committed.",
} as const;

// ---- Review file (catalog section 3.3) ----
export const REVIEW = {
  title: "# Privacy policy review",
  intro:
    "_This is automated analysis, not legal advice. It lists what the scanner found. It does not say that your product or your policy is compliant._",
  changedHeading: "## What changed since your last approved review",
  newData: "### New kinds of personal data",
  newServices: "### New third-party services",
  noLonger: "### No longer found",
  suggestedHeading: "## Suggested wording",
  suggestedIntro: "Check that each line is accurate for how you really use the service or data before you use it.",
  suggestedService: "- **{Name}** — {the vendor's disclosure text, from SrcLawyer's vendor table}",
  suggestedData: "- We collect {label in lower case}.",
  suggestedSensitive:
    "- {Label}: this is a sensitive kind of data. SrcLawyer doesn't suggest wording for it. Write this part yourself, ideally with legal advice.",
  checkHeading: "## Check these",
  checkItem:
    "- Check whether your policy still mentions {Label or Name}. The scanner no longer finds it in your code. If you no longer collect or use it, you can remove it from the policy.",
  questionsHeading: "## Questions to answer",
  doneHeading: "## When you are done",
  done:
    "Update your policy, then record your approval with your assistant, or run `srclawyer scan --write-inventory` and commit `.srclawyer.inventory.json`.",
} as const;

// ---- Command messages (catalog section 9) ----
export const COMMAND = {
  draftWritten: "Wrote the draft policy to {path}.",
  reviewWritten: "Wrote the review file to {path}.",
  skippedEdited:
    "Not updating {path}: it has been edited since SrcLawyer generated it, or SrcLawyer didn't generate it. Copy any changes you want to keep, then delete it to let SrcLawyer write a new one.",
  nothingChanged: "Your policy and your approved review state were not changed.",
} as const;

// ---- Publishable and status messages (catalog section 9.4) ----
export const PUBLISHABLE = {
  noPolicy: "There is no policy file yet.",
  scanIncomplete: "Your policy has a warning that the scan was incomplete.",
  manualReviewOne:
    '1 item that the scanner couldn\'t classify is listed under "Items Requiring Manual Review" in your policy. Please read it before you publish.',
  manualReviewMany:
    '{n} items that the scanner couldn\'t classify are listed under "Items Requiring Manual Review" in your policy. Please read them before you publish.',
} as const;

export const STATUS = {
  notSetUp: "SrcLawyer isn't set up in this project yet.",
  noBaseline: "There is no approved review state yet.",
  inconclusive: "The last check couldn't finish, so there is no result.",
  nothingToApprove: "There is nothing new to approve.",
  reviewChanged: "The review has changed since it was read. Please run the update again and read the new summary.",
  replyNotYes: "The reply wasn't a yes, so nothing was recorded.",
  questionsOpen: "Some questions still need an answer.",
} as const;

// Labels for `srclawyer status` without --json.
export const STATUS_TEXT = {
  state: "State:",
  publishable: "Ready to publish:",
} as const;

// Option labels in `srclawyer questions` (catalog section 1.1).
export const OPTION_LABELS = {
  yes: "Yes",
  no: "No",
  unsure: "I'm not sure",
  noMinimum: "No minimum",
} as const;

// ---- Generated mode (catalog sections 1.3 and 9.5) ----
export const BACKUP_NOTE = "A copy of the previous file was saved to {path}.";
export const POLICY_FILE_OPTION_LABELS = {
  keep_mine: "Keep my changes and edit the policy by hand from now on",
  move_to_settings: "Move my changes into SrcLawyer's settings so the policy can keep updating itself (I'll help, and you approve each piece)",
  discard: "Throw them away and regenerate the policy (a backup copy is saved first)",
} as const;
export const POLICY_TEXT_QUESTIONS = {
  askText: "What would you like it to say?",
  whyText: "Text you add is shown in the policy exactly as you write it.",
  askLastUpdated: 'Do you want the policy to show a "last updated" date? If so, what date should it show?',
  whyLastUpdated: "A date is something only you can decide. SrcLawyer never adds one on its own. Many policies show when they last changed, and some laws expect it.",
  noDate: "No date",
} as const;
export const POLICY_FILE_QUESTION = {
  ask: "Your privacy policy file has changes that SrcLawyer didn't make. What should happen to them?",
  why: "SrcLawyer won't overwrite your changes without asking.",
} as const;

// ---- First review (catalog section 9.7) ----
export const FIRST_REVIEW = {
  heading: "## What the scanner found in your code",
  intro: "This is the first review of this project, so everything the scanner found is listed. Nothing has been approved yet.",
  dataHeading: "### Kinds of personal data found",
  servicesHeading: "### Third-party services found",
  nothingFound: "The scanner found no personal data or third-party services in your code.",
  summaryIntro: "This is the first review of this project. Nothing has been approved yet.",
  uses: "Your code uses {Name}.",
  handles: "Your code appears to handle {label in lower case}.",
  handlesChildren: "Your code appears to handle information that may relate to children.",
} as const;

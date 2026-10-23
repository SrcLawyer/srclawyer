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

// ---- agent-setup (catalog section 9.6) ----
export const AGENT_SETUP = {
  create: "will be created",
  insert: "a SrcLawyer section will be added at the end",
  replace: "the SrcLawyer section will be updated to this version",
  merge: "four permission rules will be added (everything else in the file is kept)",
  unchanged: "already up to date, no change",
  leftEdited: "has been edited, so it was left alone",
  leftOther: "could not be read safely, so it was left alone",
  promptWrite: "Write these changes? [y/N] ",
  promptAskRules: "Also add rules to .claude/settings.json so Claude Code always asks you before recording an answer or an approval? [y/N] ",
  askRulesNotIncluded: "Claude Code permission rules are not included. Add --claude-ask-rules to include them.",
  needsYes: "Nothing was written. Run again with --yes to write these changes, or with --dry-run to see them again.",
  installHint: "SrcLawyer isn't listed in this project's package.json. For the pinned command to work it would need to be added at version {version}. Ask the owner before running: npm install --save-dev srclawyer@{version}",
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

// ---- Services you use (catalog section 10; the heading and intro are FOR ATTORNEY REVIEW) ----
export const SERVICE_SECTION = {
  heading: "## May Be Collected Through Services You Use",
  intro:
    "Some of the third-party services used by this product can collect the following, depending on how they are set up. This list describes what each service documents; it does not say that this product collects the data.",
  ifUnsure: "No problem. It stays listed as something that may be collected, and you'll see a reminder before you publish.",
  warningOne:
    '1 feature of a service you use is listed under "May Be Collected Through Services You Use" in your policy. Please confirm whether you use it before you publish.',
  warningMany:
    '{n} features of services you use are listed under "May Be Collected Through Services You Use" in your policy. Please confirm whether you use them before you publish.',
} as const;

// ---- GitHub Action review mode (catalog section 7) ----
export const ACTION = {
  headingLook: "## SrcLawyer: your privacy policy needs a quick look",
  headingNoNew: "## SrcLawyer: no new items found",
  headingBaseline: "## SrcLawyer: this pull request changes the approved review state",
  headingFirst: "## SrcLawyer: your first privacy review is waiting",
  headingCouldnt: "## SrcLawyer: couldn't finish checking",
  differs: "This differs from your last approved review.",
  noticeAbove: "**This pull request changes the approved review state.** Reviewer: please confirm that the changes listed above are intended.",
  noticeBelow: "**This pull request changes the approved review state.** Reviewer: please confirm that the changes below are intended.",
  servicesNow: "Services now recorded as reviewed: {names}.",
  dataNow: "Kinds of personal data now recorded as reviewed: {labels in lower case}.",
  servicesNo: "Services no longer recorded: {names}.",
  dataNo: "Kinds of personal data no longer recorded: {labels in lower case}.",
  listsUnchanged: "The services and kinds of personal data in the approved review state are unchanged.",
  moreOne: "{k} more question",
  moreMany: "{k} more questions",
  assistantHeading: "### Fix it with your AI coding assistant",
  assistantIntro: "Open this project in Claude Code, Cursor, or another coding assistant and say:",
  assistantPrompt: "> Resolve the SrcLawyer privacy review in this project. Ask me any questions in plain English, and don't approve anything until I say yes.",
  withQuestions: "It will ask you the questions above, update your privacy policy, and ask you to confirm before recording it as reviewed. Nothing is published automatically.",
  withoutQuestions: "It will update your privacy policy and ask you to confirm before recording it as reviewed. Nothing is published automatically.",
  setupSummary: "Assistant not set up yet?",
  setupText: 'Tell it: "Set up SrcLawyer in this project: run `npx srclawyer@{version} agent-setup` and show me what it will change first."',
  handSummary: "No assistant? Do it by hand",
  handText:
    "Answer the questions in `.srclawyer.config.yml`, run `npx srclawyer@{version} update`, read `PRIVACY_POLICY.review.md`, then run `npx srclawyer@{version} scan --write-inventory` and commit `.srclawyer.inventory.json`.",
  foundBy: "Found by this run: {run link}",
  closeIssue: "You can close this issue once you have looked at it.",
  notLegalAdvice: "_This is automated analysis, not legal advice._",
  artifacts: 'The policy draft and the review file are attached to this run as the artifact "srclawyer-review". They are kept for 7 days.',
  fork: "This pull request comes from a fork, so no comment was posted and the result is shown here instead.",
  couldntFinish: "SrcLawyer couldn't finish checking, so there is no result this time. This is not a finding that anything changed. Reasons:",
  issueTitle: "Privacy policy review needed",
  // Annotations (section 7.6)
  noteLook: "Your privacy policy needs a quick look. The details are in the run summary.",
  noteFirst: "Your first privacy review is waiting. The details are in the run summary.",
  noteFork: "No comment was posted because this pull request comes from a fork. The result is in the run summary.",
  noteCommentFailed: "Couldn't post the comment. Check that the job has pull-requests: write. The check result is not affected.",
  noteIssueFailed: "Couldn't create or update the issue. Check that Issues are turned on for this repository and that the job has issues: write. The check result is not affected.",
  noteIssueClosed: "No issue was created because an issue for these same items was already closed.",
  noteNotDefault: "This run is not on the default branch, so only the run summary was written.",
} as const;

// ---- srclawyer ci init (catalog section 11) ----
export const CI_INIT = {
  intro: "SrcLawyer will set up a GitHub workflow in this project:",
  createWorkflow: "  - create .github/workflows/srclawyer.yml",
  createBaseline: "  - create .srclawyer.inventory.json from a scan of your code",
  keepBaseline: "  - keep your existing .srclawyer.inventory.json",
  unchanged: "Your privacy policy will not be changed, and nothing will be committed or pushed.",
  reports:
    "The workflow reports what it finds as pull request comments and issues. It never changes your code or your policy, merges, or publishes anything.",
  prompt: "Create these files? [y/N] ",
  createdWorkflow: "Created .github/workflows/srclawyer.yml.",
  createdBaseline: "Created .srclawyer.inventory.json.",
  keptBaseline: "Kept your existing .srclawyer.inventory.json.",
  commitIntro: "Nothing has been committed or pushed. To turn the workflow on, commit and push both files:",
  commitAdd: "  git add .github/workflows/srclawyer.yml .srclawyer.inventory.json",
  commitCommit: '  git commit -m "Add SrcLawyer privacy review"',
  commitPush: "  git push",
  runsOn:
    "The workflow runs on pull requests, on pushes to {branch}, and once a week. Scheduled runs and issues start only after the workflow is on {branch}, and the repository needs Issues turned on.",
  stop: "To stop it, delete .github/workflows/srclawyer.yml.",
  notApproved:
    'Nothing has been approved yet. When you are ready, ask your AI coding assistant: "Resolve the SrcLawyer privacy review in this project."',
  notGit: "This folder isn't inside a git repository, so a GitHub workflow can't be set up here. Nothing was written.",
  exists: ".github/workflows/srclawyer.yml already exists, so it was left alone. Nothing was written.",
  needsYes: "Nothing was written. Run again with --yes to create these files.",
  declined: "Nothing was written.",
  baselineFailed: "The baseline could not be written, so no workflow was created.",
} as const;

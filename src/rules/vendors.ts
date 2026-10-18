import type { DataCategory } from "../engine/types.js";

// Vendors added in 0.9.0. Every package name, host and data category below is backed by a short quote
// from the vendor's own official documentation (`sources`), with the date it was checked (`verifiedOn`).
// A claim the documentation does not support is left out rather than guessed: for example OpenAI and
// Anthropic list no data categories, because their documentation speaks of "customer content" and
// does not say it is personal data. `npm run verify:vendors` re-fetches every URL and checks that each
// quote is still on its page; docs/vendor-sources.md is generated from this table.

export interface VendorSource {
  /** What the quote supports: `npm:<package>`, `pypi:<module>`, `host:<host>`, `script:<host>`, `category:<id>` or `disclosure`. */
  about: string;
  quote: string;
  url: string;
}

export interface VendorEntry {
  /** Key in PROCESSOR_PROFILES. */
  key: string;
  /** Name shown in policies and the baseline. */
  name: string;
  /** Properties of the vendor ("ai", "analytics", "monitoring", "advertising", ...) that decide which questions a new use raises. */
  tags: string[];
  /** npm package names; a subpath import ("posthog-js/react") also matches. */
  npm: string[];
  /** Python import (module) names. */
  pypi: string[];
  /** Hostnames the vendor documents for its API or scripts ("*." prefix = any subdomain). Data, not matched against code, except `scriptHosts`. */
  hosts: string[];
  /** Hosts matched in `<script src="https://host/...">` in HTML files, because that is the documented install route. */
  scriptHosts: string[];
  categories: DataCategory[];
  disclosureNotes: string;
  sources: VendorSource[];
  /** Things deliberately left out because no official page supports them; shown in docs/vendor-sources.md. */
  omitted: string[];
  /** ISO date the sources were last checked against the live pages. */
  verifiedOn: string;
}

const VERIFIED = "2026-10-18";

export const VENDORS: VendorEntry[] = [
  {
    key: "supabase",
    name: "Supabase",
    tags: ["backend", "auth"],
    npm: ["@supabase/supabase-js", "@supabase/ssr"],
    pypi: ["supabase"],
    hosts: ["*.supabase.co"],
    scriptHosts: [],
    categories: ["email", "phone", "authentication_credentials"],
    disclosureNotes:
      "Backend platform (a Postgres database with an API). If you use Supabase Auth, user accounts are tied to an email address, a phone number or a third-party identity, and people can sign in with a password or a passwordless method.",
    verifiedOn: VERIFIED,
    omitted: [
      "@supabase/auth-helpers-nextjs and @supabase/auth-ui-react (no official page checked for them).",
    ],
    sources: [
      { about: "npm:@supabase/supabase-js", quote: "npm install @supabase/supabase-js", url: "https://supabase.com/docs/reference/javascript/installing" },
      { about: "npm:@supabase/ssr", quote: "npm install @supabase/supabase-js @supabase/ssr", url: "https://supabase.com/docs/guides/auth/server-side/nextjs" },
      { about: "pypi:supabase", quote: "pip install supabase", url: "https://supabase.com/docs/reference/python/introduction" },
      { about: "host:*.supabase.co", quote: "https://<project_ref>.supabase.co/rest/v1/", url: "https://supabase.com/docs/guides/api" },
      { about: "category:email", quote: "such as an email address, a phone number, or a third-party identity", url: "https://supabase.com/docs/guides/auth/users" },
      { about: "category:phone", quote: "such as an email address, a phone number, or a third-party identity", url: "https://supabase.com/docs/guides/auth/users" },
      { about: "category:authentication_credentials", quote: "will be able to sign in with either a password or passwordless method", url: "https://supabase.com/docs/guides/auth/users" },
      { about: "disclosure", quote: "a thin API layer on top of Postgres", url: "https://supabase.com/docs/guides/api" },
      { about: "disclosure", quote: "Permanent users are tied to a piece of Personally Identifiable Information (PII)", url: "https://supabase.com/docs/guides/auth/users" },
    ],
  },
  {
    key: "clerk",
    name: "Clerk",
    tags: ["auth"],
    npm: ["@clerk/nextjs", "@clerk/express", "@clerk/clerk-react", "@clerk/react", "@clerk/backend"],
    pypi: [],
    hosts: ["api.clerk.com"],
    scriptHosts: [],
    categories: ["email", "phone", "name"],
    disclosureNotes:
      "User authentication and user management. Each user has at least one authentication identifier, such as an email address, a phone number or a username, and profile data such as a name.",
    verifiedOn: VERIFIED,
    omitted: [
      "The Python SDK (clerk-backend-api): no official page checked.",
      "The Frontend API hosts (clerk.<your-domain>, *.clerk.accounts.dev): not stated on the pages checked.",
      "The authentication_credentials category: the pages checked describe identifiers, not passwords or other credentials.",
      "Other framework packages (@clerk/clerk-expo, @clerk/astro, ...): not checked.",
    ],
    sources: [
      { about: "npm:@clerk/nextjs", quote: "install @clerk/nextjs", url: "https://clerk.com/docs/nextjs/getting-started/quickstart" },
      { about: "npm:@clerk/express", quote: "npm install @clerk/express", url: "https://clerk.com/docs/expressjs/getting-started/quickstart" },
      { about: "npm:@clerk/clerk-react", quote: "React and Expo use @clerk/clerk-react and @clerk/clerk-expo", url: "https://clerk.com/docs/react/getting-started/quickstart" },
      { about: "npm:@clerk/react", quote: "such as @clerk/vue or @clerk/react", url: "https://clerk.com/docs/react/getting-started/quickstart" },
      { about: "npm:@clerk/backend", quote: "you don't need to install @clerk/backend separately", url: "https://clerk.com/docs/references/backend/overview" },
      { about: "host:api.clerk.com", quote: "https://api.clerk.com/v1/users", url: "https://clerk.com/docs/references/backend/overview" },
      { about: "category:email", quote: "Each User has at least one authentication identifier, which might be their email address, phone number, or a username", url: "https://clerk.com/docs/guides/users/managing" },
      { about: "category:phone", quote: "Each User has at least one authentication identifier, which might be their email address, phone number, or a username", url: "https://clerk.com/docs/guides/users/managing" },
      { about: "category:name", quote: "a User object holds profile data like the user's name", url: "https://clerk.com/docs/guides/users/managing" },
      { about: "disclosure", quote: "Each User has at least one authentication identifier, which might be their email address, phone number, or a username", url: "https://clerk.com/docs/guides/users/managing" },
    ],
  },
  {
    key: "posthog",
    name: "PostHog",
    tags: ["analytics"],
    npm: ["posthog-js", "posthog-node"],
    pypi: ["posthog"],
    hosts: ["us.i.posthog.com", "eu.i.posthog.com", "us-assets.i.posthog.com", "eu-assets.i.posthog.com"],
    scriptHosts: ["us-assets.i.posthog.com", "eu-assets.i.posthog.com"],
    categories: ["analytics_usage", "ip_address", "device_id"],
    disclosureNotes:
      "Product analytics. Autocapture records interactions on the page automatically, and the browser SDK uses an analytics identity cookie. Whether client IP addresses are captured is a setting you control.",
    verifiedOn: VERIFIED,
    omitted: [
      "generic_pii: the pages describe interaction events, not personal data in the events' content.",
      "Session replay is optional and loaded on demand; it is not listed as a category.",
    ],
    sources: [
      { about: "npm:posthog-js", quote: "npm install --save posthog-js", url: "https://posthog.com/docs/libraries/js" },
      { about: "npm:posthog-node", quote: "npm install posthog-node --save", url: "https://posthog.com/docs/libraries/node" },
      { about: "pypi:posthog", quote: "pip install posthog", url: "https://posthog.com/docs/libraries/python" },
      { about: "host:us.i.posthog.com", quote: "specific domains: us.i.posthog.com and us-assets.i.posthog.com", url: "https://posthog.com/docs/advanced/proxy" },
      { about: "host:us-assets.i.posthog.com", quote: "specific domains: us.i.posthog.com and us-assets.i.posthog.com", url: "https://posthog.com/docs/advanced/proxy" },
      { about: "host:eu.i.posthog.com", quote: "Replace us with eu for EU region", url: "https://posthog.com/docs/advanced/proxy" },
      { about: "host:eu-assets.i.posthog.com", quote: "Replace us with eu for EU region", url: "https://posthog.com/docs/advanced/proxy" },
      { about: "script:us-assets.i.posthog.com", quote: "specific domains: us.i.posthog.com and us-assets.i.posthog.com", url: "https://posthog.com/docs/advanced/proxy" },
      { about: "script:eu-assets.i.posthog.com", quote: "Replace us with eu for EU region", url: "https://posthog.com/docs/advanced/proxy" },
      { about: "category:analytics_usage", quote: "Autocapture is available for Web, iOS, and React Native, and is used by product analytics, web vitals, and heatmaps", url: "https://posthog.com/docs/privacy/data-collection" },
      { about: "category:ip_address", quote: "Control whether client IP addresses are captured or discarded", url: "https://posthog.com/docs/privacy/data-collection" },
      { about: "category:device_id", quote: "even when their analytics identity cookie is shared", url: "https://posthog.com/docs/privacy/data-collection" },
      { about: "disclosure", quote: "PostHog has powerful autocapture features that capture data automatically on the client side", url: "https://posthog.com/docs/privacy/data-collection" },
      { about: "disclosure", quote: "Control whether client IP addresses are captured or discarded", url: "https://posthog.com/docs/privacy/data-collection" },
      { about: "disclosure", quote: "even when their analytics identity cookie is shared", url: "https://posthog.com/docs/privacy/data-collection" },
    ],
  },
  {
    key: "vercel-analytics",
    name: "Vercel Analytics",
    tags: ["analytics"],
    npm: ["@vercel/analytics", "@vercel/speed-insights"],
    pypi: [],
    hosts: [],
    scriptHosts: [],
    categories: ["analytics_usage", "location"],
    disclosureNotes:
      "Web analytics. Collects page views and custom events without third-party cookies; visitors are identified by a hash created from the incoming request. A data point can include the URL, referrer, geolocation (country, region and city), device operating system, browser and device type.",
    verifiedOn: VERIFIED,
    omitted: [
      "ip_address: the privacy page says data points are not tied to an IP address.",
      "What Speed Insights collects: the package page checked says only that it sends web performance metrics.",
    ],
    sources: [
      { about: "npm:@vercel/analytics", quote: "add the @vercel/analytics package to your project", url: "https://vercel.com/docs/analytics/quickstart" },
      { about: "npm:@vercel/speed-insights", quote: "With the @vercel/speed-insights npm package, you're able to configure your application to capture and send web performance metrics to Vercel", url: "https://vercel.com/docs/speed-insights/package" },
      { about: "category:analytics_usage", quote: "The recording of data points (for example, page views or custom events)", url: "https://vercel.com/docs/analytics/privacy-policy" },
      { about: "category:location", quote: "Geolocation US, California, San Francisco", url: "https://vercel.com/docs/analytics/privacy-policy" },
      { about: "disclosure", quote: "without using any third-party cookies, instead end users are identified by a hash created from the incoming request", url: "https://vercel.com/docs/analytics/privacy-policy" },
      { about: "disclosure", quote: "Geolocation US, California, San Francisco", url: "https://vercel.com/docs/analytics/privacy-policy" },
      { about: "disclosure", quote: "Device OS & Version", url: "https://vercel.com/docs/analytics/privacy-policy" },
    ],
  },
  {
    key: "sentry",
    name: "Sentry",
    tags: ["monitoring"],
    npm: ["@sentry/browser", "@sentry/node", "@sentry/react", "@sentry/nextjs"],
    pypi: ["sentry_sdk"],
    hosts: ["*.ingest.sentry.io", "js.sentry-cdn.com"],
    scriptHosts: ["js.sentry-cdn.com"],
    categories: ["ip_address"],
    disclosureNotes:
      "Error and performance monitoring. Depending on the SDK and its settings, events can include request headers, cookies, request bodies and the user's IP address.",
    verifiedOn: VERIFIED,
    omitted: [
      "Other @sentry/* packages: only browser, node, react and nextjs have a quote; build tools such as @sentry/cli and @sentry/webpack-plugin are not runtime SDKs and are not matched.",
      "Regional ingest hosts (ingest.us.sentry.io, ingest.de.sentry.io): not stated on the pages checked.",
      "Device information and the categories it would map to: no quote found.",
    ],
    sources: [
      { about: "npm:@sentry/browser", quote: "npm install @sentry/browser --save", url: "https://docs.sentry.io/platforms/javascript/" },
      { about: "npm:@sentry/node", quote: "npm install @sentry/node", url: "https://docs.sentry.io/platforms/javascript/guides/node/" },
      { about: "npm:@sentry/react", quote: "npm install @sentry/react --save", url: "https://docs.sentry.io/platforms/javascript/guides/react/" },
      { about: "npm:@sentry/nextjs", quote: "import * as Sentry from \"@sentry/nextjs\";", url: "https://docs.sentry.io/platforms/javascript/guides/nextjs/" },
      { about: "pypi:sentry_sdk", quote: "import sentry_sdk", url: "https://docs.sentry.io/platforms/python/" },
      { about: "host:*.ingest.sentry.io", quote: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>", url: "https://docs.sentry.io/platforms/javascript/" },
      { about: "host:js.sentry-cdn.com", quote: "https://js.sentry-cdn.com/<your-public-key>.min.js", url: "https://docs.sentry.io/platforms/javascript/install/loader/" },
      { about: "script:js.sentry-cdn.com", quote: "https://js.sentry-cdn.com/<your-public-key>.min.js", url: "https://docs.sentry.io/platforms/javascript/install/loader/" },
      { about: "category:ip_address", quote: "By default, the SDK sends the user's IP address.", url: "https://docs.sentry.io/platforms/javascript/data-management/data-collected/" },
      { about: "disclosure", quote: "By default, the SDK collects the bodies of incoming requests on the server side.", url: "https://docs.sentry.io/platforms/javascript/data-management/data-collected/" },
      { about: "disclosure", quote: "By default, cookie collection is enabled.", url: "https://docs.sentry.io/platforms/javascript/data-management/data-collected/" },
      { about: "disclosure", quote: "By default, the SDK sends HTTP request and response headers.", url: "https://docs.sentry.io/platforms/javascript/data-management/data-collected/" },
      { about: "disclosure", quote: "By default, the Sentry SDK doesn't send cookies.", url: "https://docs.sentry.io/platforms/python/data-management/data-collected/" },
    ],
  },
  {
    key: "resend",
    name: "Resend",
    tags: ["email"],
    npm: ["resend"],
    pypi: ["resend"],
    hosts: ["api.resend.com"],
    scriptHosts: [],
    categories: ["email"],
    disclosureNotes: "Transactional email delivery. Each message has a sender and recipient email addresses.",
    verifiedOn: VERIFIED,
    omitted: [
      "The name category: only the sender's optional friendly name is documented, not recipient names.",
    ],
    sources: [
      { about: "npm:resend", quote: "npm install resend", url: "https://resend.com/docs/send-with-nodejs" },
      { about: "pypi:resend", quote: "pip install resend", url: "https://resend.com/docs/send-with-python" },
      { about: "host:api.resend.com", quote: "https://api.resend.com", url: "https://resend.com/docs/api-reference/introduction" },
      { about: "category:email", quote: "Recipient email address.", url: "https://resend.com/docs/api-reference/emails/send-email.md" },
      { about: "disclosure", quote: "Sender email address.", url: "https://resend.com/docs/api-reference/emails/send-email.md" },
      { about: "disclosure", quote: "Recipient email address.", url: "https://resend.com/docs/api-reference/emails/send-email.md" },
    ],
  },
  {
    key: "openai",
    name: "OpenAI",
    tags: ["ai"],
    npm: ["openai"],
    pypi: ["openai"],
    hosts: ["api.openai.com"],
    scriptHosts: [],
    categories: [],
    disclosureNotes:
      "AI service provider. Prompts and responses sent to the API can be kept in abuse-monitoring logs for up to 30 days by default, and data sent to the API is not used to train OpenAI models unless you opt in.",
    verifiedOn: VERIFIED,
    omitted: [
      "Any data category: the documentation speaks of \"customer content\" (prompts and responses), not personal data. Adding generic_pii is a decision for the project owner.",
    ],
    sources: [
      { about: "npm:openai", quote: "npm install openai", url: "https://developers.openai.com/api/docs/libraries" },
      { about: "pypi:openai", quote: "pip install openai", url: "https://developers.openai.com/api/docs/libraries" },
      { about: "host:api.openai.com", quote: "https://api.openai.com/v1/models", url: "https://developers.openai.com/api/reference/overview" },
      { about: "disclosure", quote: "Abuse monitoring logs may contain certain customer content, such as prompts and responses", url: "https://developers.openai.com/api/docs/guides/your-data" },
      { about: "disclosure", quote: "retained for up to 30 days", url: "https://developers.openai.com/api/docs/guides/your-data" },
      { about: "disclosure", quote: "data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)", url: "https://developers.openai.com/api/docs/guides/your-data" },
    ],
  },
  {
    key: "anthropic",
    name: "Anthropic",
    tags: ["ai"],
    npm: ["@anthropic-ai/sdk"],
    pypi: ["anthropic"],
    hosts: ["api.anthropic.com"],
    scriptHosts: [],
    categories: [],
    disclosureNotes:
      "AI service provider. For the Anthropic API, inputs and outputs are automatically deleted within 30 days of receipt or generation (with exceptions, such as an agreed zero data retention or usage-policy enforcement), and by default are not used to train Anthropic's models.",
    verifiedOn: VERIFIED,
    omitted: [
      "Any data category: the documentation speaks of inputs and outputs, not personal data. Adding generic_pii is a decision for the project owner.",
      "Cloud-provider variants (Bedrock, Vertex): different data terms, not covered.",
    ],
    sources: [
      { about: "npm:@anthropic-ai/sdk", quote: "npm install @anthropic-ai/sdk", url: "https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript" },
      { about: "pypi:anthropic", quote: "pip install anthropic", url: "https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python" },
      { about: "host:api.anthropic.com", quote: "The Claude API is a RESTful API at https://api.anthropic.com", url: "https://docs.anthropic.com/en/api/overview" },
      { about: "disclosure", quote: "For Anthropic API users, we automatically delete inputs and outputs on our backend within 30 days of receipt or generation", url: "https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" },
      { about: "disclosure", quote: "By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models.", url: "https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training" },
    ],
  },
  {
    key: "stripe-js",
    name: "Stripe",
    tags: ["payments"],
    npm: ["@stripe/stripe-js", "@stripe/react-stripe-js"],
    pypi: [],
    hosts: ["js.stripe.com"],
    scriptHosts: ["js.stripe.com"],
    categories: ["payment_info"],
    disclosureNotes:
      "Payment processor (Stripe.js in the browser). Stripe asks for the script to be loaded on every page so that it can detect suspicious behavior that may indicate fraud as customers browse your site.",
    verifiedOn: VERIFIED,
    omitted: [
      "device_id or any browser-data category: Stripe says the script helps detect suspicious behavior, not exactly what it collects.",
      "@stripe/connect-js and other Stripe packages: not checked.",
    ],
    sources: [
      { about: "npm:@stripe/stripe-js", quote: "call loadStripe from @stripe/stripe-js", url: "https://docs.stripe.com/js" },
      { about: "npm:@stripe/react-stripe-js", quote: "The sections below document the APIs exported from @stripe/react-stripe-js", url: "https://docs.stripe.com/js" },
      { about: "host:js.stripe.com", quote: "it should always be loaded directly from https://js.stripe.com", url: "https://docs.stripe.com/js/including" },
      { about: "script:js.stripe.com", quote: "it should always be loaded directly from https://js.stripe.com", url: "https://docs.stripe.com/js/including" },
      { about: "category:payment_info", quote: "and accept payments with browser payment APIs", url: "https://docs.stripe.com/js" },
      { about: "disclosure", quote: "To best leverage Stripe’s advanced fraud functionality, include this script on every page, not just the checkout page.", url: "https://docs.stripe.com/js/including" },
      { about: "disclosure", quote: "allows Stripe to detect suspicious behavior that may be indicative of fraud as customers browse your website", url: "https://docs.stripe.com/js/including" },
    ],
  },
  {
    key: "intercom",
    name: "Intercom",
    tags: ["messaging"],
    npm: ["@intercom/messenger-js-sdk", "intercom-client"],
    pypi: [],
    hosts: ["widget.intercom.io", "api-iam.intercom.io", "api-iam.eu.intercom.io"],
    scriptHosts: ["widget.intercom.io"],
    categories: ["email", "name", "device_id"],
    disclosureNotes:
      "Customer messaging. The Messenger can be given a user's ID, name, email address and sign-up date, and it sets cookies, including an anonymous identifier.",
    verifiedOn: VERIFIED,
    omitted: [
      "react-use-intercom: a community package, not documented by Intercom.",
      "The Python SDK: no official install page checked.",
      "js.intercomcdn.com: not on the pages checked.",
      "User IDs as a category: no matching category exists.",
    ],
    sources: [
      { about: "npm:@intercom/messenger-js-sdk", quote: "import Intercom from \"@intercom/messenger-js-sdk\";", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "npm:intercom-client", quote: "npm i -s intercom-client", url: "https://github.com/intercom/intercom-node" },
      { about: "host:widget.intercom.io", quote: "https://widget.intercom.io/widget/", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "script:widget.intercom.io", quote: "https://widget.intercom.io/widget/", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "host:api-iam.intercom.io", quote: "api_base: \"https://api-iam.intercom.io\"", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "host:api-iam.eu.intercom.io", quote: "https://api-iam.eu.intercom.io", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "category:email", quote: "the variable you use to capture the user's email address", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "category:name", quote: "the variable you use to capture the user's name", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "category:device_id", quote: "notably the intercom-id- anonymous identifier", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "disclosure", quote: "the variable you use to capture the user's sign-up date", url: "https://developers.intercom.com/installing-intercom/web/installation" },
      { about: "disclosure", quote: "Conversations will be saved in the browser via a cookie", url: "https://developers.intercom.com/installing-intercom/web/installation" },
    ],
  },
  {
    key: "segment",
    name: "Segment",
    tags: ["analytics"],
    npm: ["@segment/analytics-next", "@segment/analytics-node"],
    pypi: [],
    hosts: ["cdn.segment.com"],
    scriptHosts: ["cdn.segment.com"],
    categories: ["analytics_usage", "device_id"],
    disclosureNotes:
      "Customer data platform. Analytics.js assigns each visitor an anonymous ID, kept in the browser's localStorage and attached to every Page and Track event, and Segment can route the data it records to the destinations you connect.",
    verifiedOn: VERIFIED,
    omitted: [
      "api.segment.io: not on the pages checked.",
      "The older analytics-node package and the Python library: not on the pages checked.",
    ],
    sources: [
      { about: "npm:@segment/analytics-next", quote: "npm install @segment/analytics-next", url: "https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/quickstart/" },
      { about: "npm:@segment/analytics-node", quote: "npm install @segment/analytics-node", url: "https://segment.com/docs/connections/sources/catalog/libraries/server/node/" },
      { about: "host:cdn.segment.com", quote: "https://cdn.segment.com/analytics.js/v1/", url: "https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/quickstart/" },
      { about: "script:cdn.segment.com", quote: "https://cdn.segment.com/analytics.js/v1/", url: "https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/quickstart/" },
      { about: "category:analytics_usage", quote: "attaches it to all Page and Track events", url: "https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/" },
      { about: "category:device_id", quote: "Analytics.js automatically retrieves an anonymousId from localStorage or assigns one for new visitors", url: "https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/" },
      { about: "disclosure", quote: "Analytics.js automatically retrieves an anonymousId from localStorage or assigns one for new visitors, and then attaches it to all Page and Track events", url: "https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/" },
      { about: "disclosure", quote: "route it to any destination", url: "https://segment.com/docs/connections/sources/catalog/libraries/server/node/" },
    ],
  },
];

/** Every claim a vendor entry makes, as `about` strings, so a test can require a source for each. */
export function claimsOf(v: VendorEntry): string[] {
  return [
    ...v.npm.map((n) => `npm:${n}`),
    ...v.pypi.map((m) => `pypi:${m}`),
    ...v.hosts.map((h) => `host:${h}`),
    ...v.scriptHosts.map((h) => `script:${h}`),
    ...v.categories.map((c) => `category:${c}`),
    "disclosure",
  ];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches an import specifier of one of the vendor's npm packages, including a subpath import. */
export function npmPatterns(v: VendorEntry): RegExp[] {
  return v.npm.map((name) => new RegExp(`^${escapeRegExp(name)}(?:/|$)`));
}

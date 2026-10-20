# Vendor sources (0.9.0)

**For owner review before `vendor-patch` is merged.** Generated from [`src/rules/vendors.ts`](../src/rules/vendors.ts) by `npm run docs:vendors`; do not edit by hand.

Every package name, host, data category and disclosure sentence below is backed by a short quote from the vendor's own documentation. Anything the documentation did not support was **left out**, and is listed per vendor under "Left out". `npm run verify:vendors` re-fetches every page and checks that each quote is still on it.

**Live check on 2026-10-18: 97 of 97 quotes found on their pages.**

The disclosure sentence is what appears in a policy and in the review file's suggested wording, so please read those first. "Tags" decide which questions a new use raises (for example `ai` raises the AI-services question).

| Vendor | Tags | npm packages | Python modules | Hosts | Data categories |
|---|---|---|---|---|---|
| Supabase | `backend`, `auth` | `@supabase/supabase-js`, `@supabase/ssr` | `supabase` | `*.supabase.co` | Email addresses (`email`), Phone numbers (`phone`), Authentication credentials (`authentication_credentials`) |
| Clerk | `auth` | `@clerk/nextjs`, `@clerk/express`, `@clerk/clerk-react`, `@clerk/react`, `@clerk/backend` | none | `api.clerk.com` | Email addresses (`email`), Phone numbers (`phone`), Names (`name`) |
| PostHog | `analytics` | `posthog-js`, `posthog-node` | `posthog` | `us.i.posthog.com`, `eu.i.posthog.com`, `us-assets.i.posthog.com`, `eu-assets.i.posthog.com` | Usage and analytics data (`analytics_usage`), IP addresses (`ip_address`), Device identifiers (`device_id`) |
| Vercel Analytics | `analytics` | `@vercel/analytics`, `@vercel/speed-insights` | none | none | Usage and analytics data (`analytics_usage`), Location data (`location`) |
| Sentry | `monitoring` | `@sentry/browser`, `@sentry/node`, `@sentry/react`, `@sentry/nextjs` | `sentry_sdk` | `*.ingest.sentry.io`, `js.sentry-cdn.com` | IP addresses (`ip_address`) |
| Resend | `email` | `resend` | `resend` | `api.resend.com` | Email addresses (`email`) |
| OpenAI | `ai` | `openai` | `openai` | `api.openai.com` | none |
| Anthropic | `ai` | `@anthropic-ai/sdk` | `anthropic` | `api.anthropic.com` | none |
| Stripe | `payments` | `@stripe/stripe-js`, `@stripe/react-stripe-js` | none | `js.stripe.com` | Payment information (`payment_info`) |
| Intercom | `messaging` | `@intercom/messenger-js-sdk`, `intercom-client` | none | `widget.intercom.io`, `api-iam.intercom.io`, `api-iam.eu.intercom.io` | Email addresses (`email`), Names (`name`), Device identifiers (`device_id`) |
| Segment | `analytics` | `@segment/analytics-next`, `@segment/analytics-node` | none | `cdn.segment.com` | Usage and analytics data (`analytics_usage`), Device identifiers (`device_id`) |

Hosts are recorded as data. The only host that is matched against code is a **script host**, in `<script src="https://host/...">` tags in HTML files (PostHog assets, Sentry loader, Stripe.js, Intercom, Segment). Vercel Analytics has no third-party host to match.

## Supabase

**Disclosure text** (shown in policies and the review file):

> Backend platform (a Postgres database with an API). If you use Supabase Auth, user accounts are tied to an email address, a phone number or a third-party identity, and people can sign in with a password or a passwordless method.

Tags: `backend`, `auth` · npm: `@supabase/supabase-js`, `@supabase/ssr` · Python: `supabase` · hosts: `*.supabase.co` · script hosts: none · categories: Email addresses (`email`), Phone numbers (`phone`), Authentication credentials (`authentication_credentials`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@supabase/supabase-js` | "npm install @supabase/supabase-js" | [supabase.com](https://supabase.com/docs/reference/javascript/installing) |
| `npm:@supabase/ssr` | "npm install @supabase/supabase-js @supabase/ssr" | [supabase.com](https://supabase.com/docs/guides/auth/server-side/nextjs) |
| `pypi:supabase` | "pip install supabase" | [supabase.com](https://supabase.com/docs/reference/python/introduction) |
| `host:*.supabase.co` | "https://<project_ref>.supabase.co/rest/v1/" | [supabase.com](https://supabase.com/docs/guides/api) |
| `category:email`, `category:phone` | "such as an email address, a phone number, or a third-party identity" | [supabase.com](https://supabase.com/docs/guides/auth/users) |
| `category:authentication_credentials` | "will be able to sign in with either a password or passwordless method" | [supabase.com](https://supabase.com/docs/guides/auth/users) |
| `disclosure` | "a thin API layer on top of Postgres" | [supabase.com](https://supabase.com/docs/guides/api) |
| `disclosure` | "Permanent users are tied to a piece of Personally Identifiable Information (PII)" | [supabase.com](https://supabase.com/docs/guides/auth/users) |

**Left out** (no official page supports it):

- @supabase/auth-helpers-nextjs and @supabase/auth-ui-react (no official page checked for them).

## Clerk

**Disclosure text** (shown in policies and the review file):

> User authentication and user management. Each user has at least one authentication identifier, such as an email address, a phone number or a username, and profile data such as a name.

Tags: `auth` · npm: `@clerk/nextjs`, `@clerk/express`, `@clerk/clerk-react`, `@clerk/react`, `@clerk/backend` · Python: none · hosts: `api.clerk.com` · script hosts: none · categories: Email addresses (`email`), Phone numbers (`phone`), Names (`name`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@clerk/nextjs` | "install @clerk/nextjs" | [clerk.com](https://clerk.com/docs/nextjs/getting-started/quickstart) |
| `npm:@clerk/express` | "npm install @clerk/express" | [clerk.com](https://clerk.com/docs/expressjs/getting-started/quickstart) |
| `npm:@clerk/clerk-react` | "React and Expo use @clerk/clerk-react and @clerk/clerk-expo" | [clerk.com](https://clerk.com/docs/react/getting-started/quickstart) |
| `npm:@clerk/react` | "such as @clerk/vue or @clerk/react" | [clerk.com](https://clerk.com/docs/react/getting-started/quickstart) |
| `npm:@clerk/backend` | "you don't need to install @clerk/backend separately" | [clerk.com](https://clerk.com/docs/references/backend/overview) |
| `host:api.clerk.com` | "https://api.clerk.com/v1/users" | [clerk.com](https://clerk.com/docs/references/backend/overview) |
| `category:email`, `category:phone`, `disclosure` | "Each User has at least one authentication identifier, which might be their email address, phone number, or a username" | [clerk.com](https://clerk.com/docs/guides/users/managing) |
| `category:name` | "a User object holds profile data like the user's name" | [clerk.com](https://clerk.com/docs/guides/users/managing) |

**Left out** (no official page supports it):

- The Python SDK (clerk-backend-api): no official page checked.
- The Frontend API hosts (clerk.<your-domain>, *.clerk.accounts.dev): not stated on the pages checked.
- The authentication_credentials category: the pages checked describe identifiers, not passwords or other credentials.
- Other framework packages (@clerk/clerk-expo, @clerk/astro, ...): not checked.

## PostHog

**Disclosure text** (shown in policies and the review file):

> Product analytics. Autocapture records interactions on the page automatically, and the browser SDK uses an analytics identity cookie. Whether client IP addresses are captured is a setting you control.

Tags: `analytics` · npm: `posthog-js`, `posthog-node` · Python: `posthog` · hosts: `us.i.posthog.com`, `eu.i.posthog.com`, `us-assets.i.posthog.com`, `eu-assets.i.posthog.com` · script hosts: `us-assets.i.posthog.com`, `eu-assets.i.posthog.com` · categories: Usage and analytics data (`analytics_usage`), IP addresses (`ip_address`), Device identifiers (`device_id`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:posthog-js` | "npm install --save posthog-js" | [posthog.com](https://posthog.com/docs/libraries/js) |
| `npm:posthog-node` | "npm install posthog-node --save" | [posthog.com](https://posthog.com/docs/libraries/node) |
| `pypi:posthog` | "pip install posthog" | [posthog.com](https://posthog.com/docs/libraries/python) |
| `host:us.i.posthog.com`, `host:us-assets.i.posthog.com`, `script:us-assets.i.posthog.com` | "specific domains: us.i.posthog.com and us-assets.i.posthog.com" | [posthog.com](https://posthog.com/docs/advanced/proxy) |
| `host:eu.i.posthog.com`, `host:eu-assets.i.posthog.com`, `script:eu-assets.i.posthog.com` | "Replace us with eu for EU region" | [posthog.com](https://posthog.com/docs/advanced/proxy) |
| `category:analytics_usage` | "Autocapture is available for Web, iOS, and React Native, and is used by product analytics, web vitals, and heatmaps" | [posthog.com](https://posthog.com/docs/privacy/data-collection) |
| `category:ip_address`, `disclosure` | "Control whether client IP addresses are captured or discarded" | [posthog.com](https://posthog.com/docs/privacy/data-collection) |
| `category:device_id`, `disclosure` | "even when their analytics identity cookie is shared" | [posthog.com](https://posthog.com/docs/privacy/data-collection) |
| `disclosure` | "PostHog has powerful autocapture features that capture data automatically on the client side" | [posthog.com](https://posthog.com/docs/privacy/data-collection) |

**Left out** (no official page supports it):

- generic_pii: the pages describe interaction events, not personal data in the events' content.
- Session replay is optional and loaded on demand; it is not listed as a category.

## Vercel Analytics

**Disclosure text** (shown in policies and the review file):

> Web analytics. Collects page views and custom events without third-party cookies; visitors are identified by a hash created from the incoming request. A data point can include the URL, referrer, geolocation (country, region and city), device operating system, browser and device type.

Tags: `analytics` · npm: `@vercel/analytics`, `@vercel/speed-insights` · Python: none · hosts: none · script hosts: none · categories: Usage and analytics data (`analytics_usage`), Location data (`location`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@vercel/analytics` | "add the @vercel/analytics package to your project" | [vercel.com](https://vercel.com/docs/analytics/quickstart) |
| `npm:@vercel/speed-insights` | "With the @vercel/speed-insights npm package, you're able to configure your application to capture and send web performance metrics to Vercel" | [vercel.com](https://vercel.com/docs/speed-insights/package) |
| `category:analytics_usage` | "The recording of data points (for example, page views or custom events)" | [vercel.com](https://vercel.com/docs/analytics/privacy-policy) |
| `category:location`, `disclosure` | "Geolocation US, California, San Francisco" | [vercel.com](https://vercel.com/docs/analytics/privacy-policy) |
| `disclosure` | "without using any third-party cookies, instead end users are identified by a hash created from the incoming request" | [vercel.com](https://vercel.com/docs/analytics/privacy-policy) |
| `disclosure` | "Device OS & Version" | [vercel.com](https://vercel.com/docs/analytics/privacy-policy) |

**Left out** (no official page supports it):

- ip_address: the privacy page says data points are not tied to an IP address.
- What Speed Insights collects: the package page checked says only that it sends web performance metrics.

## Sentry

**Disclosure text** (shown in policies and the review file):

> Error and performance monitoring. Depending on the SDK and its settings, events can include request headers, cookies, request bodies and the user's IP address.

Tags: `monitoring` · npm: `@sentry/browser`, `@sentry/node`, `@sentry/react`, `@sentry/nextjs` · Python: `sentry_sdk` · hosts: `*.ingest.sentry.io`, `js.sentry-cdn.com` · script hosts: `js.sentry-cdn.com` · categories: IP addresses (`ip_address`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@sentry/browser` | "npm install @sentry/browser --save" | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/) |
| `npm:@sentry/node` | "npm install @sentry/node" | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/guides/node/) |
| `npm:@sentry/react` | "npm install @sentry/react --save" | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/guides/react/) |
| `npm:@sentry/nextjs` | "import * as Sentry from "@sentry/nextjs";" | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/guides/nextjs/) |
| `pypi:sentry_sdk` | "import sentry_sdk" | [docs.sentry.io](https://docs.sentry.io/platforms/python/) |
| `host:*.ingest.sentry.io` | "https://<key>@o<orgId>.ingest.sentry.io/<projectId>" | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/) |
| `host:js.sentry-cdn.com`, `script:js.sentry-cdn.com` | "https://js.sentry-cdn.com/<your-public-key>.min.js" | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/install/loader/) |
| `category:ip_address` | "By default, the SDK sends the user's IP address." | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/data-management/data-collected/) |
| `disclosure` | "By default, the SDK collects the bodies of incoming requests on the server side." | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/data-management/data-collected/) |
| `disclosure` | "By default, cookie collection is enabled." | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/data-management/data-collected/) |
| `disclosure` | "By default, the SDK sends HTTP request and response headers." | [docs.sentry.io](https://docs.sentry.io/platforms/javascript/data-management/data-collected/) |
| `disclosure` | "By default, the Sentry SDK doesn't send cookies." | [docs.sentry.io](https://docs.sentry.io/platforms/python/data-management/data-collected/) |

**Left out** (no official page supports it):

- Other @sentry/* packages: only browser, node, react and nextjs have a quote; build tools such as @sentry/cli and @sentry/webpack-plugin are not runtime SDKs and are not matched.
- Regional ingest hosts (ingest.us.sentry.io, ingest.de.sentry.io): not stated on the pages checked.
- Device information and the categories it would map to: no quote found.

## Resend

**Disclosure text** (shown in policies and the review file):

> Transactional email delivery. Each message has a sender and recipient email addresses.

Tags: `email` · npm: `resend` · Python: `resend` · hosts: `api.resend.com` · script hosts: none · categories: Email addresses (`email`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:resend` | "npm install resend" | [resend.com](https://resend.com/docs/send-with-nodejs) |
| `pypi:resend` | "pip install resend" | [resend.com](https://resend.com/docs/send-with-python) |
| `host:api.resend.com` | "https://api.resend.com" | [resend.com](https://resend.com/docs/api-reference/introduction) |
| `category:email`, `disclosure` | "Recipient email address." | [resend.com](https://resend.com/docs/api-reference/emails/send-email.md) |
| `disclosure` | "Sender email address." | [resend.com](https://resend.com/docs/api-reference/emails/send-email.md) |

**Left out** (no official page supports it):

- The name category: only the sender's optional friendly name is documented, not recipient names.

## OpenAI

**Disclosure text** (shown in policies and the review file):

> AI service provider. Prompts and responses sent to the API can be kept in abuse-monitoring logs for up to 30 days by default, and data sent to the API is not used to train OpenAI models unless you opt in.

Tags: `ai` · npm: `openai` · Python: `openai` · hosts: `api.openai.com` · script hosts: none · categories: none · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:openai` | "npm install openai" | [developers.openai.com](https://developers.openai.com/api/docs/libraries) |
| `pypi:openai` | "pip install openai" | [developers.openai.com](https://developers.openai.com/api/docs/libraries) |
| `host:api.openai.com` | "https://api.openai.com/v1/models" | [developers.openai.com](https://developers.openai.com/api/reference/overview) |
| `disclosure` | "Abuse monitoring logs may contain certain customer content, such as prompts and responses" | [developers.openai.com](https://developers.openai.com/api/docs/guides/your-data) |
| `disclosure` | "retained for up to 30 days" | [developers.openai.com](https://developers.openai.com/api/docs/guides/your-data) |
| `disclosure` | "data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)" | [developers.openai.com](https://developers.openai.com/api/docs/guides/your-data) |

**Left out** (no official page supports it):

- Any data category: the documentation speaks of "customer content" (prompts and responses), not personal data. Adding generic_pii is a decision for the project owner.

## Anthropic

**Disclosure text** (shown in policies and the review file):

> AI service provider. For the Anthropic API, inputs and outputs are automatically deleted within 30 days of receipt or generation (with exceptions, such as an agreed zero data retention or usage-policy enforcement), and by default are not used to train Anthropic's models.

Tags: `ai` · npm: `@anthropic-ai/sdk` · Python: `anthropic` · hosts: `api.anthropic.com` · script hosts: none · categories: none · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@anthropic-ai/sdk` | "npm install @anthropic-ai/sdk" | [platform.claude.com](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript) |
| `pypi:anthropic` | "pip install anthropic" | [platform.claude.com](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python) |
| `host:api.anthropic.com` | "The Claude API is a RESTful API at https://api.anthropic.com" | [docs.anthropic.com](https://docs.anthropic.com/en/api/overview) |
| `disclosure` | "For Anthropic API users, we automatically delete inputs and outputs on our backend within 30 days of receipt or generation" | [privacy.claude.com](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) |
| `disclosure` | "By default, we will not use your inputs or outputs from our commercial products (e.g. Claude for Work, Anthropic API, Claude Gov, etc.) to train our models." | [privacy.claude.com](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training) |

**Left out** (no official page supports it):

- Any data category: the documentation speaks of inputs and outputs, not personal data. Adding generic_pii is a decision for the project owner.
- Cloud-provider variants (Bedrock, Vertex): different data terms, not covered.

## Stripe (Stripe.js)

**Disclosure text** (shown in policies and the review file):

> Payment processor (Stripe.js in the browser). Stripe asks for the script to be loaded on every page so that it can detect suspicious behavior that may indicate fraud as customers browse your site.

Tags: `payments` · npm: `@stripe/stripe-js`, `@stripe/react-stripe-js` · Python: none · hosts: `js.stripe.com` · script hosts: `js.stripe.com` · categories: Payment information (`payment_info`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@stripe/stripe-js` | "call loadStripe from @stripe/stripe-js" | [docs.stripe.com](https://docs.stripe.com/js) |
| `npm:@stripe/react-stripe-js` | "The sections below document the APIs exported from @stripe/react-stripe-js" | [docs.stripe.com](https://docs.stripe.com/js) |
| `host:js.stripe.com`, `script:js.stripe.com` | "it should always be loaded directly from https://js.stripe.com" | [docs.stripe.com](https://docs.stripe.com/js/including) |
| `category:payment_info` | "and accept payments with browser payment APIs" | [docs.stripe.com](https://docs.stripe.com/js) |
| `disclosure` | "To best leverage Stripe’s advanced fraud functionality, include this script on every page, not just the checkout page." | [docs.stripe.com](https://docs.stripe.com/js/including) |
| `disclosure` | "allows Stripe to detect suspicious behavior that may be indicative of fraud as customers browse your website" | [docs.stripe.com](https://docs.stripe.com/js/including) |

**Left out** (no official page supports it):

- device_id or any browser-data category: Stripe says the script helps detect suspicious behavior, not exactly what it collects.
- @stripe/connect-js and other Stripe packages: not checked.

## Intercom

**Disclosure text** (shown in policies and the review file):

> Customer messaging. The Messenger can be given a user's ID, name, email address and sign-up date, and it sets cookies, including an anonymous identifier.

Tags: `messaging` · npm: `@intercom/messenger-js-sdk`, `intercom-client` · Python: none · hosts: `widget.intercom.io`, `api-iam.intercom.io`, `api-iam.eu.intercom.io` · script hosts: `widget.intercom.io` · categories: Email addresses (`email`), Names (`name`), Device identifiers (`device_id`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@intercom/messenger-js-sdk` | "import Intercom from "@intercom/messenger-js-sdk";" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `npm:intercom-client` | "npm i -s intercom-client" | [github.com](https://github.com/intercom/intercom-node) |
| `host:widget.intercom.io`, `script:widget.intercom.io` | "https://widget.intercom.io/widget/" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `host:api-iam.intercom.io` | "api_base: "https://api-iam.intercom.io"" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `host:api-iam.eu.intercom.io` | "https://api-iam.eu.intercom.io" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `category:email` | "the variable you use to capture the user's email address" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `category:name` | "the variable you use to capture the user's name" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `category:device_id` | "notably the intercom-id- anonymous identifier" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `disclosure` | "the variable you use to capture the user's sign-up date" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |
| `disclosure` | "Conversations will be saved in the browser via a cookie" | [developers.intercom.com](https://developers.intercom.com/installing-intercom/web/installation) |

**Left out** (no official page supports it):

- react-use-intercom: a community package, not documented by Intercom.
- The Python SDK: no official install page checked.
- js.intercomcdn.com: not on the pages checked.
- User IDs as a category: no matching category exists.

## Segment

**Disclosure text** (shown in policies and the review file):

> Customer data platform. Analytics.js assigns each visitor an anonymous ID, kept in the browser's localStorage and attached to every Page and Track event, and Segment can route the data it records to the destinations you connect.

Tags: `analytics` · npm: `@segment/analytics-next`, `@segment/analytics-node` · Python: none · hosts: `cdn.segment.com` · script hosts: `cdn.segment.com` · categories: Usage and analytics data (`analytics_usage`), Device identifiers (`device_id`) · checked 2026-10-18

| Supports | Quote | Page |
|---|---|---|
| `npm:@segment/analytics-next` | "npm install @segment/analytics-next" | [segment.com](https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/quickstart/) |
| `npm:@segment/analytics-node` | "npm install @segment/analytics-node" | [segment.com](https://segment.com/docs/connections/sources/catalog/libraries/server/node/) |
| `host:cdn.segment.com`, `script:cdn.segment.com` | "https://cdn.segment.com/analytics.js/v1/" | [segment.com](https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/quickstart/) |
| `category:analytics_usage` | "attaches it to all Page and Track events" | [segment.com](https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/) |
| `category:device_id` | "Analytics.js automatically retrieves an anonymousId from localStorage or assigns one for new visitors" | [segment.com](https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/) |
| `disclosure` | "Analytics.js automatically retrieves an anonymousId from localStorage or assigns one for new visitors, and then attaches it to all Page and Track events" | [segment.com](https://segment.com/docs/connections/sources/catalog/libraries/website/javascript/) |
| `disclosure` | "route it to any destination" | [segment.com](https://segment.com/docs/connections/sources/catalog/libraries/server/node/) |

**Left out** (no official page supports it):

- api.segment.io: not on the pages checked.
- The older analytics-node package and the Python library: not on the pages checked.

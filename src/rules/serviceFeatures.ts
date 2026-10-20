import type { DataCategory } from "../engine/types.js";
import type { VendorSource } from "./vendors.js";

// Data kinds a service handles only if you use one of its features or settings, not just by being
// installed. The categories stay in the processor profiles (so the baseline and drift are unchanged), but
// the generated policy lists them under "May Be Collected Through Services You Use" until the owner says
// they use the feature (docs/question-catalog.md section 10). Every category and every condition has a
// quote from the vendor's own documentation; `npm run verify:vendors` re-checks them.

export interface ServiceFeature {
  /** Key of the processor profile (PROCESSOR_PROFILES) whose categories this feature qualifies. */
  profileKey: string;
  /** Stable id within the profile, kebab-case. The owner's answer is stored under `<profileKey>.<id>`. */
  id: string;
  /** Short name shown in the policy, in brackets after the service. */
  feature: string;
  categories: DataCategory[];
  /** The question put to the owner (static wording; reviewed in the catalog). */
  ask: string;
  why: string;
  /** `category:<id>` quotes show the service handles the data; `condition` quotes show it is optional. */
  sources: VendorSource[];
}

export const SERVICE_FEATURES_VERIFIED = "2026-10-19";

const CUSTOMERS = "https://docs.stripe.com/api/customers/create.md";
const SENDGRID = "https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send";
const GA_UA = "https://support.google.com/analytics/answer/2763052";
const AUTH0 = "https://auth0.com/docs/authenticate/database-connections";
const FB_ANALYTICS = "https://support.google.com/firebase/answer/6318039";
const FB_PRIVACY = "https://firebase.google.com/support/privacy";
const FB_PASSWORD = "https://firebase.google.com/docs/auth/web/password-auth";
const FB_AUTH = "https://firebase.google.com/docs/auth";
const COGNITO = "https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-attributes.html";
const SUPABASE_USERS = "https://supabase.com/docs/guides/auth/users";
const POSTHOG = "https://posthog.com/docs/privacy/data-collection";
const SENTRY = "https://docs.sentry.io/platforms/javascript/data-management/data-collected/";
const INTERCOM = "https://developers.intercom.com/installing-intercom/web/installation";

export const SERVICE_FEATURES: ServiceFeature[] = [
  // ---- Vendors added in 0.9.0 ----
  {
    profileKey: "supabase", id: "auth", feature: "Supabase Auth", categories: ["email", "phone", "authentication_credentials"],
    ask: "Do you use Supabase to sign people in (Supabase Auth)?",
    why: "Supabase documents that user accounts in its sign-in service are tied to an email address, a phone number or a third-party identity.",
    sources: [
      { about: "category:email", quote: "such as an email address, a phone number, or a third-party identity", url: SUPABASE_USERS },
      { about: "category:phone", quote: "such as an email address, a phone number, or a third-party identity", url: SUPABASE_USERS },
      { about: "category:authentication_credentials", quote: "will be able to sign in with either a password or passwordless method", url: SUPABASE_USERS },
      { about: "condition", quote: "A user in Supabase Auth is someone with a user ID, stored in the Auth schema.", url: SUPABASE_USERS },
    ],
  },
  {
    profileKey: "posthog", id: "ip-capture", feature: "IP address capture", categories: ["ip_address"],
    ask: "Does your PostHog project capture visitors' IP addresses?",
    why: "PostHog lets each organization and project choose whether client IP addresses are captured or discarded.",
    sources: [
      { about: "category:ip_address", quote: "Control whether client IP addresses are captured or discarded", url: POSTHOG },
      { about: "condition", quote: "You can control whether client IP addresses are captured or discarded at both the organization and project levels.", url: POSTHOG },
    ],
  },
  {
    profileKey: "sentry", id: "user-ip", feature: "user IP address", categories: ["ip_address"],
    ask: "Does your Sentry setup send the user's IP address?",
    why: "Sentry's JavaScript SDK sends the user's IP address by default, and this can be turned off in its settings.",
    sources: [
      { about: "category:ip_address", quote: "By default, the SDK sends the user's IP address.", url: SENTRY },
      { about: "condition", quote: "To disable it, set dataCollection: { userInfo: false }", url: SENTRY },
    ],
  },
  {
    profileKey: "intercom", id: "identified-users", feature: "identified users", categories: ["email", "name"],
    ask: "Do you give Intercom your users' names or email addresses?",
    why: "Intercom's Messenger can be given a logged-in user's name and email address; for visitors who aren't logged in the details are left out.",
    sources: [
      { about: "category:email", quote: "the variable you use to capture the user's email address", url: INTERCOM },
      { about: "category:name", quote: "the variable you use to capture the user's name", url: INTERCOM },
      { about: "condition", quote: "by excluding the user details from the settings object", url: INTERCOM },
    ],
  },
  // ---- Older profiles ----
  {
    profileKey: "stripe", id: "customer-details", feature: "customer details", categories: ["name", "email", "physical_address"],
    ask: "Do you give Stripe your customers' names, email addresses or addresses?",
    why: "Stripe lets you set a customer's name, email address and address, and they are optional.",
    sources: [
      { about: "category:name", quote: "name (string, optional)", url: CUSTOMERS },
      { about: "category:email", quote: "email (string, optional)", url: CUSTOMERS },
      { about: "category:physical_address", quote: "address (object, required if calculating taxes)", url: CUSTOMERS },
      { about: "condition", quote: "email (string, optional)", url: CUSTOMERS },
    ],
  },
  {
    profileKey: "sendgrid", id: "recipient-names", feature: "recipient names", categories: ["name"],
    ask: "Do you include recipients' names with their email addresses when you send email through SendGrid?",
    why: "SendGrid email recipients can optionally include a name along with the email address.",
    sources: [
      { about: "category:name", quote: "Each object in the array may optionally contain a recipient's name.", url: SENDGRID },
      { about: "condition", quote: "Each object in the array may optionally contain a recipient's name.", url: SENDGRID },
    ],
  },
  {
    profileKey: "google-analytics", id: "universal-analytics", feature: "Universal Analytics", categories: ["ip_address"],
    ask: "Do you use the older Universal Analytics version of Google Analytics?",
    why: "Google says IP addresses are not logged or stored in Google Analytics 4. The older Universal Analytics could log them, with optional masking.",
    sources: [
      { about: "category:ip_address", quote: "When a customer of Universal Analytics requests IP-address masking, Analytics truncates the address as soon as technically feasible.", url: GA_UA },
      { about: "condition", quote: "In Google Analytics 4, IP masking is not necessary since IP addresses are not logged or stored.", url: GA_UA },
    ],
  },
  {
    profileKey: "auth0", id: "database-connections", feature: "database connections", categories: ["authentication_credentials"],
    ask: "Do you let people sign in to Auth0 with a password (a database connection)?",
    why: "Auth0 database connections store sign-in credentials, either in Auth0 or in your own database.",
    sources: [
      { about: "category:authentication_credentials", quote: "These credentials are securely stored in the Auth0 user store or in your own database.", url: AUTH0 },
      { about: "condition", quote: "Auth0 provides database connections to authenticate users with an identifier (email, username, or phone number) and password or passkeys.", url: AUTH0 },
    ],
  },
  {
    profileKey: "firebase", id: "authentication", feature: "Firebase Authentication", categories: ["email", "authentication_credentials"],
    ask: "Do you use Firebase Authentication to sign people in?",
    why: "Firebase Authentication supports password-based accounts that use an email address and a password.",
    sources: [
      { about: "category:email", quote: "createUserWithEmailAndPassword(auth, email, password)", url: FB_PASSWORD },
      { about: "category:authentication_credentials", quote: "Authenticate with Firebase using Password-Based Accounts", url: FB_PASSWORD },
      { about: "condition", quote: "Link Multiple Auth Providers", url: FB_AUTH },
    ],
  },
  {
    profileKey: "firebase", id: "analytics", feature: "Google Analytics for Firebase", categories: ["analytics_usage", "device_id"],
    ask: "Do you use Google Analytics for Firebase?",
    why: "Google Analytics for Firebase collects usage information and an identifier for each installation of the app.",
    sources: [
      { about: "category:analytics_usage", quote: "Number of users and sessions", url: FB_ANALYTICS },
      { about: "category:device_id", quote: "The Google Analytics for Firebase SDK library uses an app-instance identifier to identify a unique installation of the App.", url: FB_ANALYTICS },
      { about: "condition", quote: "Google Analytics is a separate service that can be used together with Firebase,", url: FB_PRIVACY },
    ],
  },
  {
    profileKey: "cognito", id: "contact-attributes", feature: "email and phone attributes", categories: ["email", "phone"],
    ask: "Does your Amazon Cognito user pool collect users' email addresses or phone numbers?",
    why: "In an Amazon Cognito user pool, email address and phone number are optional attributes unless you make them required.",
    sources: [
      { about: "category:email", quote: "such as name, email address, and phone number", url: COGNITO },
      { about: "category:phone", quote: "such as name, email address, and phone number", url: COGNITO },
      { about: "condition", quote: "Except for sub, standard attributes are optional by default for all users.", url: COGNITO },
    ],
  },
];

/** Where the owner's answer is stored in `serviceUse`. */
export function featureKey(f: ServiceFeature): string {
  return `${f.profileKey}.${f.id}`;
}

export function featuresFor(profileKey: string): ServiceFeature[] {
  return SERVICE_FEATURES.filter((f) => f.profileKey === profileKey);
}

/** The categories of a profile that are certain once the service is used: its categories minus those some feature qualifies. */
export function evidentCategories(profileKey: string, allCategories: DataCategory[]): DataCategory[] {
  const conditional = new Set(featuresFor(profileKey).flatMap((f) => f.categories));
  return allCategories.filter((c) => !conditional.has(c));
}

/**
 * Categories from OLDER profiles that were looked at and deliberately NOT moved, with the reason, shown in
 * docs/vendor-sources.md next to the ones that were.
 */
export const NOT_MOVED: Array<{ profileKey: string; name: string; reason: string }> = [
  { profileKey: "twilio", name: "Twilio", reason: "Phone numbers: sending a text message needs the recipient's phone number, so it stays certain. No quote was collected; this is how it already behaved." },
  { profileKey: "mixpanel", name: "Mixpanel", reason: "Usage data and device identifiers: no documentation quote found that makes either optional, so both stay certain." },
  { profileKey: "stripe", name: "Stripe", reason: "Payment information: handling payments is what the service is for, so it stays certain." },
  { profileKey: "sendgrid", name: "SendGrid", reason: "Email addresses: the quoted page says each recipient object must contain an email address, so it stays certain." },
  { profileKey: "cognito", name: "Amazon Cognito", reason: "Authentication credentials: user pools exist to sign people in, so it stays certain." },
  { profileKey: "auth0", name: "Auth0", reason: "Email and name: profile data is part of the identity service whichever connection is used, so both stay certain." },
];

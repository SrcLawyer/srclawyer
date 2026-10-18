import type { ProcessorProfile } from "../engine/types.js";

export const PROCESSOR_PROFILES: Record<string, ProcessorProfile> = {
  stripe: {
    name: "Stripe",
    dataCategories: ["payment_info", "name", "email", "physical_address"],
    disclosureNotes: "Payment processor. Handles card data, billing name/address, and email for receipts.",
    tags: ["payments"],
  },
  sendgrid: {
    name: "SendGrid",
    dataCategories: ["email", "name"],
    disclosureNotes: "Transactional/marketing email delivery. Processes recipient email and name.",
    tags: ["email"],
  },
  twilio: {
    name: "Twilio",
    dataCategories: ["phone"],
    disclosureNotes: "SMS/voice communications provider. Processes phone numbers.",
    tags: ["messaging"],
  },
  "google-analytics": {
    name: "Google Analytics",
    dataCategories: ["analytics_usage", "ip_address", "device_id"],
    disclosureNotes: "Web analytics. Processes IP address, device identifiers, and usage/behavioral data.",
    tags: ["analytics"],
  },
  mixpanel: {
    name: "Mixpanel",
    dataCategories: ["analytics_usage", "device_id"],
    disclosureNotes: "Product analytics. Processes event/usage data and device identifiers.",
    tags: ["analytics"],
  },
  auth0: {
    name: "Auth0",
    dataCategories: ["email", "authentication_credentials", "name"],
    disclosureNotes: "Identity provider. Processes login credentials, email, and profile data.",
    tags: ["auth"],
  },
  firebase: {
    name: "Firebase",
    dataCategories: ["email", "authentication_credentials", "device_id", "analytics_usage"],
    disclosureNotes: "Backend platform (auth, database, analytics, messaging) depending on which modules are used.",
    tags: ["analytics", "backend"],
  },
  cognito: {
    name: "Amazon Cognito",
    dataCategories: ["email", "authentication_credentials", "phone"],
    disclosureNotes: "Identity provider. Processes login credentials, email, and phone for MFA.",
    tags: ["auth"],
  },
};

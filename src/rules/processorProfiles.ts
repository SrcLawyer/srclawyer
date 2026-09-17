import type { ProcessorProfile } from "../engine/types.js";

export const PROCESSOR_PROFILES: Record<string, ProcessorProfile> = {
  stripe: {
    name: "Stripe",
    dataCategories: ["payment_info", "name", "email", "physical_address"],
    disclosureNotes: "Payment processor. Handles card data, billing name/address, and email for receipts.",
  },
  sendgrid: {
    name: "SendGrid",
    dataCategories: ["email", "name"],
    disclosureNotes: "Transactional/marketing email delivery. Processes recipient email and name.",
  },
  twilio: {
    name: "Twilio",
    dataCategories: ["phone"],
    disclosureNotes: "SMS/voice communications provider. Processes phone numbers.",
  },
  "google-analytics": {
    name: "Google Analytics",
    dataCategories: ["analytics_usage", "ip_address", "device_id"],
    disclosureNotes: "Web analytics. Processes IP address, device identifiers, and usage/behavioral data.",
  },
  mixpanel: {
    name: "Mixpanel",
    dataCategories: ["analytics_usage", "device_id"],
    disclosureNotes: "Product analytics. Processes event/usage data and device identifiers.",
  },
  auth0: {
    name: "Auth0",
    dataCategories: ["email", "authentication_credentials", "name"],
    disclosureNotes: "Identity provider. Processes login credentials, email, and profile data.",
  },
  firebase: {
    name: "Firebase",
    dataCategories: ["email", "authentication_credentials", "device_id", "analytics_usage"],
    disclosureNotes: "Backend platform (auth, database, analytics, messaging) depending on which modules are used.",
  },
  cognito: {
    name: "Amazon Cognito",
    dataCategories: ["email", "authentication_credentials", "phone"],
    disclosureNotes: "Identity provider. Processes login credentials, email, and phone for MFA.",
  },
};

import type { DataCategory } from "../engine/types.js";

const LEXICON: Array<{ pattern: RegExp; category: DataCategory }> = [
  { pattern: /email/i, category: "email" },
  { pattern: /bank[ _-]?name|routing[ _-]?number|account[ _-]?holder|iban|swift[ _-]?code/i, category: "payment_info" },
  // Anchored to the whole field name, not a bare "...name$" suffix match: the old pattern matched
  // ANY field ending in "name" -- hostname, filename, directoryName, className, teamName, etc. -- none
  // of which are a person's name. This matches only "name" itself and the known person-name
  // decompositions (first/last/middle/maiden/nick/display/legal name, username), each allowing an
  // optional separator (first_name, firstName, first-name). A compound this doesn't recognize falls
  // through with no category match, landing in the same "could not confidently classify — needs
  // review" path as any other unclassified field -- not the safe list, not a new discard path, just
  // the existing honest-ambiguity treatment.
  { pattern: /^(full|first|middle|last|sur|maiden|nick|display|legal)[\s_-]*name$|^name$|^user[\s_-]*name$/i, category: "name" },
  { pattern: /phone|mobile|telephone/i, category: "phone" },
  { pattern: /address|street|city|zip ?code|postal ?code/i, category: "physical_address" },
  { pattern: /card ?number|creditcard|cvv|cvc|cardholder/i, category: "payment_info" },
  { pattern: /ssn|social ?security|passport|national ?id|drivers?license/i, category: "government_id" },
  { pattern: /password|passwd|passphrase|api ?key|access ?token|refresh ?token|secret/i, category: "authentication_credentials" },
  { pattern: /latitude|longitude|^lat$|^lng$|geo ?location|coordinates/i, category: "location" },
  { pattern: /device ?id|udid|advertising ?id|imei/i, category: "device_id" },
  { pattern: /ip ?address|remoteaddr/i, category: "ip_address" },
];

const AMBIGUOUS_NAMES = new Set(["data", "payload", "value", "body", "info", "params", "metadata", "details", "fields", "input", "record", "item", "obj"]);

export function classifyFieldName(fieldName: string): DataCategory | null {
  for (const entry of LEXICON) {
    if (entry.pattern.test(fieldName)) return entry.category;
  }
  return null;
}

export function isAmbiguousFieldName(fieldName: string): boolean {
  return AMBIGUOUS_NAMES.has(fieldName.toLowerCase());
}

import type { DataCategory } from "../engine/types.js";

const LEXICON: Array<{ pattern: RegExp; category: DataCategory }> = [
  { pattern: /email/i, category: "email" },
  // Checked before the generic "name" pattern below: bank_name/account_holder_name end in
  // "name" and would otherwise be classified as just "name", losing the payment-specific signal.
  { pattern: /bank[ _-]?name|routing[ _-]?number|account[ _-]?holder|iban|swift[ _-]?code/i, category: "payment_info" },
  { pattern: /(full)?name$|firstname|lastname|surname/i, category: "name" },
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

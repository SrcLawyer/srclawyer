const SECRET_PATTERNS: RegExp[] = [
  /sk_live_[A-Za-z0-9]{16,}/g,
  /sk_test_[A-Za-z0-9]{16,}/g,
  /pk_live_[A-Za-z0-9]{16,}/g,
  // Anthropic API keys — matched by shape alone (like the patterns above), not by the surrounding
  // variable name or quoting, so `key = "sk-ant-..."` and an unquoted `KEY=sk-ant-...` both redact.
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /AIza[0-9A-Za-z\-_]{35}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /postgres(?:ql)?:\/\/[^\s"'`]+/gi,
  /mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g,
  /(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["'`][^"'`\s]{12,}["'`]/gi,
];

export function redactSecrets(source: string): string {
  let redacted = source;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function containsLikelySecret(source: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(source);
  });
}

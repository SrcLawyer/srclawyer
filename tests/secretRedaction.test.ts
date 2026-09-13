import { describe, expect, it } from "vitest";
import { redactSecrets, containsLikelySecret } from "../src/engine/secretRedaction.js";

describe("secretRedaction", () => {
  it("redacts Stripe secret keys", () => {
    const source = 'const stripe = new Stripe("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE");';
    expect(redactSecrets(source)).toBe('const stripe = new Stripe("[REDACTED]");');
  });

  it("redacts AWS access key ids", () => {
    const source = "AWS_KEY=AKIAABCDEFGHIJKLMNOP";
    expect(redactSecrets(source)).toContain("[REDACTED]");
    expect(redactSecrets(source)).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });

  it("redacts an Anthropic API key under a generic variable name, not just apiKey/secret/token", () => {
    const source = 'const key = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE-FAKEFAKEFAKEFAKEFAKEAA";';
    const redacted = redactSecrets(source);
    expect(redacted).not.toContain("FAKEFAKEFAKEFAKEFAKEFAKE");
    expect(redacted).toContain("[REDACTED]");
  });

  it("redacts an unquoted .env-style Anthropic API key assignment", () => {
    const source = "ANTHROPIC_API_KEY=sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE-FAKEFAKEFAKEFAKEFAKEAA";
    const redacted = redactSecrets(source);
    expect(redacted).toBe("ANTHROPIC_API_KEY=[REDACTED]");
  });

  it("redacts database connection strings", () => {
    const source = "DATABASE_URL=postgres://user:pass@host:5432/db";
    expect(redactSecrets(source)).toBe("DATABASE_URL=[REDACTED]");
  });

  it("leaves ordinary code untouched", () => {
    const source = "const email = req.body.email;";
    expect(redactSecrets(source)).toBe(source);
    expect(containsLikelySecret(source)).toBe(false);
  });

  it("detects a likely secret without redacting", () => {
    expect(containsLikelySecret("token: \"abcdef0123456789zzzz\"")).toBe(true);
  });
});

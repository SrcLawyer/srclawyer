import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPolicyWrite, classifyPolicyFile, editedMessage, unmarkedMessage, withPolicyMarker } from "../src/policy/policyGuard.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function file(content: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "srclawyer-guard-"));
  dirs.push(dir);
  const path = join(dir, "PRIVACY_POLICY.md");
  if (content !== null) writeFileSync(path, content);
  return path;
}

const BODY = "# Privacy Policy\n\nWe collect your email.\n\n## Disclaimer\n\nNot legal advice.\n";
const MARKER = /<!-- srclawyer:policy-sha256=[0-9a-f]{64} -->/;

describe("withPolicyMarker", () => {
  it("appends exactly one marker line, last, and leaves the body untouched", () => {
    const out = withPolicyMarker(BODY);
    expect(out.startsWith(BODY)).toBe(true);
    expect(out.slice(BODY.length)).toMatch(new RegExp(`^${MARKER.source}\\n$`));
  });

  it("is deterministic", () => {
    expect(withPolicyMarker(BODY)).toBe(withPolicyMarker(BODY));
  });
});

describe("classifyPolicyFile", () => {
  it("missing file", () => expect(classifyPolicyFile(file(null))).toBe("missing"));

  it("a file exactly as generated is unchanged", () => {
    expect(classifyPolicyFile(file(withPolicyMarker(BODY)))).toBe("unchanged");
  });

  it("a hand edit is edited", () => {
    const edited = withPolicyMarker(BODY).replace("your email", "your email and phone number");
    expect(classifyPolicyFile(file(edited))).toBe("edited");
  });

  it("an edit that is then reverted exactly is unchanged again", () => {
    const original = withPolicyMarker(BODY);
    const path = file(original.replace("your email", "your email and phone number"));
    expect(classifyPolicyFile(path)).toBe("edited");
    writeFileSync(path, original);
    expect(classifyPolicyFile(path)).toBe("unchanged");
  });

  it("CRLF line endings (a Windows checkout) are not an edit", () => {
    expect(classifyPolicyFile(file(withPolicyMarker(BODY).replace(/\n/g, "\r\n")))).toBe("unchanged");
  });

  it("an LF file and its CRLF twin classify the same", () => {
    const lf = withPolicyMarker(BODY);
    expect(classifyPolicyFile(file(lf))).toBe(classifyPolicyFile(file(lf.replace(/\n/g, "\r\n"))));
  });

  it("a stripped or added final newline is not an edit", () => {
    const generated = withPolicyMarker(BODY);
    expect(classifyPolicyFile(file(generated.trimEnd()))).toBe("unchanged");
    expect(classifyPolicyFile(file(generated + "\n\n"))).toBe("unchanged");
  });

  it("a deleted marker makes the file unmarked", () => {
    const stripped = withPolicyMarker(BODY).replace(MARKER, "");
    expect(classifyPolicyFile(file(stripped))).toBe("unmarked");
  });

  it("a hand-written file with no marker is unmarked", () => {
    expect(classifyPolicyFile(file("# Our policy\n\nWritten by a lawyer.\n"))).toBe("unmarked");
  });

  it("text added after the marker is an edit, not invisible", () => {
    expect(classifyPolicyFile(file(withPolicyMarker(BODY) + "\nExtra paragraph.\n"))).toBe("edited");
  });

  it("a marker with a hash that does not match is edited", () => {
    const tampered = withPolicyMarker(BODY).replace(/policy-sha256=[0-9a-f]/, (m) => m.slice(0, -1) + (m.endsWith("0") ? "1" : "0"));
    expect(classifyPolicyFile(file(tampered))).toBe("edited");
  });
});

describe("checkPolicyWrite", () => {
  it("allows a missing file and an unchanged generated one", () => {
    expect(checkPolicyWrite(file(null), "PRIVACY_POLICY.md", false)).toEqual({ allowed: true });
    expect(checkPolicyWrite(file(withPolicyMarker(BODY)), "PRIVACY_POLICY.md", false)).toEqual({ allowed: true });
  });

  it("refuses an edited file with the edited message", () => {
    const path = file(withPolicyMarker(BODY) + "more\n");
    expect(checkPolicyWrite(path, "PRIVACY_POLICY.md", false)).toEqual({ allowed: false, kind: "edited", message: editedMessage("PRIVACY_POLICY.md") });
  });

  it("refuses an unmarked file with the unmarked message", () => {
    const path = file("hand written\n");
    expect(checkPolicyWrite(path, "PRIVACY_POLICY.md", false)).toEqual({ allowed: false, kind: "unmarked", message: unmarkedMessage("PRIVACY_POLICY.md") });
  });

  it("--force allows both", () => {
    expect(checkPolicyWrite(file("hand written\n"), "PRIVACY_POLICY.md", true)).toEqual({ allowed: true });
    expect(checkPolicyWrite(file(withPolicyMarker(BODY) + "more\n"), "PRIVACY_POLICY.md", true)).toEqual({ allowed: true });
  });

  it("leaves a directory to fail the way writing to one always has", () => {
    const dir = mkdtempSync(join(tmpdir(), "srclawyer-guard-dir-"));
    dirs.push(dir);
    mkdirSync(join(dir, "out"));
    expect(checkPolicyWrite(join(dir, "out"), "out", false)).toEqual({ allowed: true });
  });
});

describe("refusal messages", () => {
  it("says exactly this for an edited policy", () => {
    expect(editedMessage("PRIVACY_POLICY.md")).toBe(
      "Not overwriting PRIVACY_POLICY.md: it has been edited since SrcLawyer generated it. Write the new policy to a separate file with --out PRIVACY_POLICY.generated.md and compare, or pass --force to replace it."
    );
  });

  it("says exactly this for a policy with no marker", () => {
    expect(unmarkedMessage("PRIVACY_POLICY.md")).toBe(
      "Not overwriting PRIVACY_POLICY.md: it was not generated by this version of SrcLawyer (it may be hand-written, or generated before overwrite protection was added in 0.8.0). Write the new policy to a separate file with --out PRIVACY_POLICY.generated.md and compare, or pass --force to replace it."
    );
  });

  it("does not suggest the file it is refusing to overwrite", () => {
    expect(editedMessage("PRIVACY_POLICY.generated.md")).toContain("--out a different path");
  });
});

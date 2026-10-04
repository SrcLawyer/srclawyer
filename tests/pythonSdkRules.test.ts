import { describe, expect, it } from "vitest";
import { parsePythonSource } from "../src/engine/pythonAstUtils.js";
import { runPythonSdkRules } from "../src/rules/pythonSdkRules.js";

describe("runPythonSdkRules", () => {
  it("detects a plain stripe import and reports the mapped data categories", async () => {
    const source = 'import stripe\nstripe.api_key = "sk_test_x"\n';
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonSdkRules(tree, "/root/app.py", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].processor).toBe("Stripe");
    expect(findings[0].dataCategories).toContain("payment_info");
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].evidence).not.toContain("sk_test_x");
  });

  it("detects a from-import of a known SDK's submodule", async () => {
    const source = "from twilio.rest import Client\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonSdkRules(tree, "/root/notify.py", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].processor).toBe("Twilio");
  });

  it("detects an aliased import", async () => {
    const source = "import sendgrid as sg\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonSdkRules(tree, "/root/mail.py", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].processor).toBe("SendGrid");
  });

  it("does not flag unrelated imports", async () => {
    const source = "import os\nfrom typing import Optional\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonSdkRules(tree, "/root/app.py", source, "/root");

    expect(findings).toHaveLength(0);
  });

  it("does not flag a bare 'import boto3' as Cognito -- boto3 is AWS's general SDK, not Cognito-specific", async () => {
    const source = "import boto3\nclient = boto3.client('s3')\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonSdkRules(tree, "/root/storage.py", source, "/root");

    expect(findings).toHaveLength(0);
  });

  it("does not double-report the same processor imported twice", async () => {
    const source = "import stripe\nimport stripe as s\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonSdkRules(tree, "/root/app.py", source, "/root");

    expect(findings).toHaveLength(1);
  });
});

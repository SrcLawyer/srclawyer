import { describe, expect, it } from "vitest";
import { parsePythonSource } from "../src/engine/pythonAstUtils.js";
import { runPythonFrameworkRules } from "../src/rules/pythonFrameworkRules.js";

describe("runPythonFrameworkRules", () => {
  it("detects a request.form[...] subscript access, classified by the shared lexicon", async () => {
    const source = 'email = request.form["email"]\n';
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toContain("email");
    expect(findings[0].confidenceFactors?.lexiconCategory).toBe("email");
  });

  it("detects request.json[...] and request.args[...] the same way", async () => {
    const source = ['phone = request.json["phone"]', 'ref = request.args["ref"]'].join("\n") + "\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    expect(findings.map((f) => f.id)).toEqual(
      expect.arrayContaining([expect.stringContaining(":phone"), expect.stringContaining(":ref")])
    );
  });

  it("detects the request.form.get(...) method-call form, not just subscript access", async () => {
    const source = 'password = request.form.get("password")\n';
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toContain("authentication_credentials");
  });

  it("leaves confidence/requiresReview at the safe provisional default, pending the protected-logic scoring call", async () => {
    const source = 'email = request.form["email"]\n';
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    expect(findings[0].confidence).toBe("low");
    expect(findings[0].requiresReview).toBe(true);
  });

  it("counts confident siblings from other fields found in the same file", async () => {
    const source = ['name = request.form["name"]', 'notes = request.form["notes"]'].join("\n") + "\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    const notesFinding = findings.find((f) => f.id.endsWith(":notes"));
    expect(notesFinding?.confidenceFactors?.siblingConfidentCount).toBe(1);
  });

  it("does not flag safe-allowlisted field names", async () => {
    const source = 'id = request.form["id"]\n';
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    expect(findings).toHaveLength(0);
  });

  it("does not flag unrelated subscript/method-call expressions", async () => {
    const source = ['config = settings["debug"]', 'x = some_dict.get("key")'].join("\n") + "\n";
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    expect(findings).toHaveLength(0);
  });

  it("redacts secret-shaped evidence before it's ever stored", async () => {
    const source = 'key = request.form["api_key_value"]  # sk_test_FAKEFAKEFAKEFAKEFAKEFAKE\n';
    const tree = (await parsePythonSource(source))!;
    const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

    expect(findings[0].evidence).not.toContain("sk_test_FAKEFAKEFAKEFAKEFAKEFAKE");
  });

  describe("same-function alias tracking", () => {
    it("detects data['x'] after data = request.get_json()", async () => {
      const source = ["def create_user():", "    data = request.get_json()", "    email = data['email']"].join("\n") + "\n";
      const tree = (await parsePythonSource(source))!;
      const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toContain("email");
    });

    it("detects data.get('x') after data = request.get_json(), the .get(...) alias form", async () => {
      const source = ["def create_user():", "    data = request.get_json()", "    name = data.get('username')"].join("\n") + "\n";
      const tree = (await parsePythonSource(source))!;
      const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toContain("name");
    });

    it("tracks aliases of request.form / request.args / request.json the same way, not just get_json()", async () => {
      const source = [
        "def h():",
        "    form = request.form",
        "    a = form['email']",
        "    args = request.args",
        "    b = args.get('ref')",
        "    j = request.json",
        "    c = j['phone']",
      ].join("\n") + "\n";
      const tree = (await parsePythonSource(source))!;
      const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

      expect(findings.map((f) => f.id)).toEqual(
        expect.arrayContaining([
          expect.stringContaining(":email"),
          expect.stringContaining(":ref"),
          expect.stringContaining(":phone"),
        ])
      );
    });

    it("detects a direct subscript on request.get_json() with no intermediate variable", async () => {
      const source = "email = request.get_json()['email']\n";
      const tree = (await parsePythonSource(source))!;
      const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toContain("email");
    });

    it("does not leak an alias across functions: a same-named variable in another function that never aliased request data is not flagged", async () => {
      const source = [
        "def handler_a():",
        "    data = request.get_json()",
        "    email = data['email']",
        "",
        "def handler_b():",
        "    data = {}",
        "    notes = data['notes']",
      ].join("\n") + "\n";
      const tree = (await parsePythonSource(source))!;
      const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

      expect(findings).toHaveLength(1);
      expect(findings[0].dataCategories).toContain("email");
      expect(findings.some((f) => f.id.endsWith(":notes"))).toBe(false);
    });

    it("does not flag a plain dict alias that was never assigned from a request accessor", async () => {
      const source = ["def h():", "    data = load_config()", "    debug = data['debug']"].join("\n") + "\n";
      const tree = (await parsePythonSource(source))!;
      const findings = runPythonFrameworkRules(tree, "/root/app.py", source, "/root");

      expect(findings).toHaveLength(0);
    });
  });
});

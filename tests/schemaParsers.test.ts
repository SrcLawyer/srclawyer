import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOpenApiSpec } from "../src/schemaParsers/openapi.js";
import { parseGraphQLSchema } from "../src/schemaParsers/graphql.js";

describe("parseOpenApiSpec", () => {
  it("classifies fields from components.schemas", () => {
    const dir = mkdtempSync(join(tmpdir(), "srclawyer-openapi-"));
    const specPath = join(dir, "openapi.yaml");
    writeFileSync(
      specPath,
      [
        "openapi: 3.0.0",
        "components:",
        "  schemas:",
        "    User:",
        "      type: object",
        "      properties:",
        "        email:",
        "          type: string",
        "        notes:",
        "          type: string",
      ].join("\n")
    );

    const findings = parseOpenApiSpec(specPath, dir);
    const email = findings.find((f) => f.evidence === "email");
    const notes = findings.find((f) => f.evidence === "notes");

    expect(email?.dataCategories).toEqual(["email"]);
    expect(email?.requiresReview).toBe(false);
    expect(notes?.requiresReview).toBe(true);
  });
});

describe("parseGraphQLSchema", () => {
  it("classifies fields inside type blocks and skips connection boilerplate", () => {
    const dir = mkdtempSync(join(tmpdir(), "srclawyer-graphql-"));
    const schemaPath = join(dir, "schema.graphql");
    writeFileSync(
      schemaPath,
      ["type User {", "  id: ID!", "  email: String!", "  phoneNumber: String", "}"].join("\n")
    );

    const findings = parseGraphQLSchema(schemaPath, dir);
    const fieldNames = findings.map((f) => f.id.split(":").pop());

    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("phoneNumber");
    expect(fieldNames).not.toContain("id");
  });
});

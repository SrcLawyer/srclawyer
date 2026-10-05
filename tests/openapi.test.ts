import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOpenApiSpec } from "../src/schemaParsers/openapi.js";

function writeSpec(yaml: string): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "srclawyer-openapi-"));
  const path = join(dir, "openapi.yaml");
  writeFileSync(path, yaml);
  return { dir, path };
}

describe("parseOpenApiSpec reachability filtering", () => {
  it("reports a field from a schema reachable via requestBody, and excludes a response-only schema", () => {
    const { dir, path } = writeSpec(
      [
        "openapi: 3.0.0",
        "paths:",
        "  /users:",
        "    post:",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema:",
        "              $ref: '#/components/schemas/CreateUserInput'",
        "      responses:",
        "        '200':",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: '#/components/schemas/UserResponse'",
        "components:",
        "  schemas:",
        "    CreateUserInput:",
        "      type: object",
        "      properties:",
        "        emailAddress:",
        "          type: string",
        "    UserResponse:",
        "      type: object",
        "      properties:",
        "        internalAuditTrail:",
        "          type: string",
      ].join("\n")
    );

    const findings = parseOpenApiSpec(path, dir);

    expect(findings.map((f) => f.evidence)).toContain("emailAddress");
    expect(findings.map((f) => f.evidence)).not.toContain("internalAuditTrail");
  });

  it("follows $ref through allOf/oneOf/anyOf, items, and additionalProperties to find transitively reachable schemas", () => {
    const { dir, path } = writeSpec(
      [
        "openapi: 3.0.0",
        "paths:",
        "  /things:",
        "    post:",
        "      requestBody:",
        "        content:",
        "          application/json:",
        "            schema:",
        "              allOf:",
        "                - $ref: '#/components/schemas/Base'",
        "components:",
        "  schemas:",
        "    Base:",
        "      type: object",
        "      properties:",
        "        viaOneOf:",
        "          oneOf:",
        "            - $ref: '#/components/schemas/ViaOneOf'",
        "        viaItems:",
        "          type: array",
        "          items:",
        "            $ref: '#/components/schemas/ViaItems'",
        "        viaAdditionalProperties:",
        "          type: object",
        "          additionalProperties:",
        "            $ref: '#/components/schemas/ViaAdditionalProperties'",
        "    ViaOneOf:",
        "      type: object",
        "      properties:",
        "        oneOfField:",
        "          type: string",
        "    ViaItems:",
        "      type: object",
        "      properties:",
        "        itemsField:",
        "          type: string",
        "    ViaAdditionalProperties:",
        "      type: object",
        "      properties:",
        "        additionalPropertiesField:",
        "          type: string",
        "    Unreachable:",
        "      type: object",
        "      properties:",
        "        unreachableField:",
        "          type: string",
      ].join("\n")
    );

    const evidence = parseOpenApiSpec(path, dir).map((f) => f.evidence);

    expect(evidence).toContain("oneOfField");
    expect(evidence).toContain("itemsField");
    expect(evidence).toContain("additionalPropertiesField");
    expect(evidence).not.toContain("unreachableField");
  });

  it("resolves schemas reachable via operation-level and path-level parameters", () => {
    const { dir, path } = writeSpec(
      [
        "openapi: 3.0.0",
        "paths:",
        "  /search:",
        "    parameters:",
        "      - name: pathLevel",
        "        in: query",
        "        schema:",
        "          $ref: '#/components/schemas/PathLevelParam'",
        "    get:",
        "      parameters:",
        "        - name: opLevel",
        "          in: query",
        "          schema:",
        "            $ref: '#/components/schemas/OpLevelParam'",
        "components:",
        "  schemas:",
        "    PathLevelParam:",
        "      type: object",
        "      properties:",
        "        pathLevelField:",
        "          type: string",
        "    OpLevelParam:",
        "      type: object",
        "      properties:",
        "        opLevelField:",
        "          type: string",
        "    Unreachable:",
        "      type: object",
        "      properties:",
        "        unreachableField:",
        "          type: string",
      ].join("\n")
    );

    const evidence = parseOpenApiSpec(path, dir).map((f) => f.evidence);

    expect(evidence).toContain("pathLevelField");
    expect(evidence).toContain("opLevelField");
    expect(evidence).not.toContain("unreachableField");
  });

  it("resolves a requestBody that is itself a $ref to components.requestBodies", () => {
    const { dir, path } = writeSpec(
      [
        "openapi: 3.0.0",
        "paths:",
        "  /orders:",
        "    post:",
        "      requestBody:",
        "        $ref: '#/components/requestBodies/CreateOrder'",
        "components:",
        "  requestBodies:",
        "    CreateOrder:",
        "      content:",
        "        application/json:",
        "          schema:",
        "            $ref: '#/components/schemas/OrderInput'",
        "  schemas:",
        "    OrderInput:",
        "      type: object",
        "      properties:",
        "        orderField:",
        "          type: string",
      ].join("\n")
    );

    const evidence = parseOpenApiSpec(path, dir).map((f) => f.evidence);

    expect(evidence).toContain("orderField");
  });

  it("does not filter at all (falls back to every schema) when the spec has no paths section, rather than silently dropping everything", () => {
    const { dir, path } = writeSpec(
      [
        "openapi: 3.0.0",
        "components:",
        "  schemas:",
        "    Standalone:",
        "      type: object",
        "      properties:",
        "        standaloneField:",
        "          type: string",
      ].join("\n")
    );

    const evidence = parseOpenApiSpec(path, dir).map((f) => f.evidence);

    expect(evidence).toContain("standaloneField");
  });
});

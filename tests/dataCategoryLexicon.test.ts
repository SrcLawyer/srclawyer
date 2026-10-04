import { describe, expect, it } from "vitest";
import { classifyFieldName } from "../src/rules/dataCategoryLexicon.js";

describe("classifyFieldName", () => {
  it("classifies a person-name field and its common decompositions as 'name'", () => {
    for (const field of ["name", "fullName", "full_name", "firstName", "first_name", "lastName", "last_name", "surname", "username", "user_name", "displayName", "nickname"]) {
      expect(classifyFieldName(field)).toBe("name");
    }
  });

  it("does NOT classify a compound field merely ending in 'name' as a person's name -- it's not a suffix match", () => {
    // Real false positives caught in this session's sampled-precision review: hostname (a DNS
    // hostname) and a feedback directory's own "name" field (dub, formbricks) were both wrongly
    // classified as a person's name under the old bare /name$/ pattern.
    for (const field of ["hostname", "filename", "directoryName", "packageName", "teamName", "companyName", "codename", "typeName"]) {
      expect(classifyFieldName(field)).toBeNull();
    }
  });

  it("still classifies bank_name/account_holder as payment_info, not name, regardless of lexicon entry order", () => {
    expect(classifyFieldName("bank_name")).toBe("payment_info");
    expect(classifyFieldName("account_holder_name")).toBe("payment_info");
  });
});

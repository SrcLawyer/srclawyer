import { describe, expect, it } from "vitest";
import { parseSource } from "../src/engine/astUtils.js";
import { runWebApiRules } from "../src/rules/webApiRules.js";

describe("runWebApiRules", () => {
  it("classifies getUserMedia({ audio: true }) as microphone access", () => {
    const source = `navigator.mediaDevices.getUserMedia({ audio: true });\n`;
    const ast = parseSource(source, "app.js")!;
    const findings = runWebApiRules(ast, "/root/app.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["microphone_audio"]);
    expect(findings[0].confidence).toBe("high");
    expect(findings[0].requiresReview).toBe(false);
  });

  it("classifies audio and video constraints separately", () => {
    const source = `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false }, video: true });\n`;
    const ast = parseSource(source, "app.js")!;
    const findings = runWebApiRules(ast, "/root/app.js", source, "/root");

    const categories = findings.flatMap((f) => f.dataCategories).sort();
    expect(categories).toEqual(["camera_video", "microphone_audio"]);
  });

  it("flags a dynamic getUserMedia constraints object for review instead of guessing", () => {
    const source = `navigator.mediaDevices.getUserMedia(constraints);\n`;
    const ast = parseSource(source, "app.js")!;
    const findings = runWebApiRules(ast, "/root/app.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].requiresReview).toBe(true);
  });

  it("classifies geolocation calls", () => {
    const source = `navigator.geolocation.getCurrentPosition(onSuccess);\n`;
    const ast = parseSource(source, "app.js")!;
    const findings = runWebApiRules(ast, "/root/app.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["location"]);
  });

  it("classifies localStorage.setItem by key name", () => {
    const source = `localStorage.setItem("userEmail", email);\n`;
    const ast = parseSource(source, "app.js")!;
    const findings = runWebApiRules(ast, "/root/app.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].dataCategories).toEqual(["email"]);
  });

  it("flags a dynamic storage key for review", () => {
    const source = `sessionStorage.setItem(key, value);\n`;
    const ast = parseSource(source, "app.js")!;
    const findings = runWebApiRules(ast, "/root/app.js", source, "/root");

    expect(findings).toHaveLength(1);
    expect(findings[0].requiresReview).toBe(true);
  });
});

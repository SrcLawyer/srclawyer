import { describe, expect, it } from "vitest";
import { isDirOnPath, globalBinDir } from "../postinstall.cjs";

describe("postinstall PATH check", () => {
  describe("isDirOnPath", () => {
    it("finds an exact match", () => {
      expect(isDirOnPath("/usr/local/bin", "/usr/bin:/usr/local/bin:/bin", "linux")).toBe(true);
    });

    it("reports missing when the directory isn't present", () => {
      expect(isDirOnPath("/opt/homebrew/bin", "/usr/bin:/bin", "linux")).toBe(false);
    });

    it("ignores a trailing slash on either side", () => {
      expect(isDirOnPath("/usr/local/bin/", "/usr/bin:/usr/local/bin:/bin", "linux")).toBe(true);
      expect(isDirOnPath("/usr/local/bin", "/usr/bin:/usr/local/bin/:/bin", "linux")).toBe(true);
    });

    it("is case-insensitive on darwin and win32, case-sensitive on linux", () => {
      expect(isDirOnPath("/Usr/Local/Bin", "/usr/local/bin", "darwin")).toBe(true);
      expect(isDirOnPath("C:\\nvm\\bin", "c:\\nvm\\bin", "win32")).toBe(true);
      expect(isDirOnPath("/Usr/Local/Bin", "/usr/local/bin", "linux")).toBe(false);
    });

    it("uses ; as the delimiter on win32, : elsewhere", () => {
      expect(isDirOnPath("C:\\tools\\node", "C:\\Windows;C:\\tools\\node", "win32")).toBe(true);
      expect(isDirOnPath("/usr/local/bin", "/usr/bin;/usr/local/bin", "linux")).toBe(false);
    });

    it("treats an empty or missing PATH as not-found, not a crash", () => {
      expect(isDirOnPath("/usr/local/bin", "", "linux")).toBe(false);
      expect(isDirOnPath("/usr/local/bin", undefined, "linux")).toBe(false);
    });

    it("doesn't false-positive a warning when the target dir itself is unknown", () => {
      expect(isDirOnPath(null, "/usr/bin", "linux")).toBe(true);
      expect(isDirOnPath(undefined, "/usr/bin", "linux")).toBe(true);
    });
  });

  describe("globalBinDir", () => {
    it("appends bin/ on POSIX platforms", () => {
      expect(globalBinDir("/usr/local", "linux")).toBe("/usr/local/bin");
      expect(globalBinDir("/opt/homebrew", "darwin")).toBe("/opt/homebrew/bin");
    });

    it("uses the prefix directly on win32 (npm places shims at the prefix root there)", () => {
      expect(globalBinDir("C:\\Users\\me\\AppData\\Roaming\\npm", "win32")).toBe(
        "C:\\Users\\me\\AppData\\Roaming\\npm"
      );
    });

    it("returns null when the prefix itself is unknown", () => {
      expect(globalBinDir(undefined, "linux")).toBe(null);
      expect(globalBinDir("", "linux")).toBe(null);
    });
  });
});

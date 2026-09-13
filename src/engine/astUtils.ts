import { parse } from "@babel/parser";
import type { ParserOptions } from "@babel/parser";
import type { File } from "@babel/types";
import { extname } from "node:path";

export function parseSource(source: string, filePath: string): File | null {
  const ext = extname(filePath);
  const plugins: ParserOptions["plugins"] = ["jsx"];
  if (ext === ".ts" || ext === ".tsx") {
    plugins.length = 0;
    plugins.push("typescript");
    if (ext === ".tsx") plugins.push("jsx");
  }

  try {
    return parse(source, {
      sourceType: "unambiguous",
      plugins,
      errorRecovery: true,
    });
  } catch {
    return null;
  }
}

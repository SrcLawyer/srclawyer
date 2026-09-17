import _traverse from "@babel/traverse";
import type { File, Node, ObjectExpression } from "@babel/types";
import type { TraverseOptions } from "@babel/traverse";
import { relative } from "node:path";
import type { Finding } from "../engine/types.js";
import { classifyFieldName, isAmbiguousFieldName } from "./dataCategoryLexicon.js";
import { isSafeFieldName } from "./safeFieldNames.js";
import { redactSecrets } from "../engine/secretRedaction.js";

type TraverseFn = (ast: Node, visitor: TraverseOptions) => void;
const traverse: TraverseFn = ((_traverse as unknown as { default?: TraverseFn }).default ?? (_traverse as unknown as TraverseFn));

const STORAGE_OBJECT_NAMES = /^(localStorage|sessionStorage)$/;

function hasTruthyProperty(obj: ObjectExpression, key: string): boolean {
  return obj.properties.some((prop) => {
    if (prop.type !== "ObjectProperty" || prop.key.type !== "Identifier" || prop.key.name !== key) return false;
    return !(prop.value.type === "BooleanLiteral" && prop.value.value === false);
  });
}

export function runWebApiRules(ast: File, filePath: string, source: string, root: string): Finding[] {
  const findings: Finding[] = [];
  const lines = source.split("\n");
  const relPath = relative(root, filePath);
  const emitted = new Set<string>();

  function emit(id: string, line: number, description: string, dataCategories: Finding["dataCategories"], confidence: Finding["confidence"], requiresReview: boolean) {
    const dedupeKey = `${id}:${line}`;
    if (emitted.has(dedupeKey)) return;
    emitted.add(dedupeKey);

    const evidenceLine = lines[line - 1] ?? "";
    findings.push({
      id: `webapi:${relPath}:${line}:${id}`,
      dataCategories,
      processor: null,
      description,
      confidence,
      source: "web-api-rule",
      location: { file: relPath, line, column: 0 },
      evidence: redactSecrets(evidenceLine.trim()).slice(0, 200),
      requiresReview,
    });
  }

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
      const methodName = callee.property.name;
      const line = path.node.loc?.start.line ?? 1;

      if (methodName === "getUserMedia") {
        const arg = path.node.arguments[0];
        if (arg && arg.type === "ObjectExpression") {
          const wantsAudio = hasTruthyProperty(arg, "audio");
          const wantsVideo = hasTruthyProperty(arg, "video");
          if (wantsAudio) {
            emit("getUserMedia:audio", line, "Microphone access requested via getUserMedia().", ["microphone_audio"], "high", false);
          }
          if (wantsVideo) {
            emit("getUserMedia:video", line, "Camera access requested via getUserMedia().", ["camera_video"], "high", false);
          }
          if (!wantsAudio && !wantsVideo) {
            emit("getUserMedia:unknown", line, "getUserMedia() called but audio/video constraints could not be determined statically.", ["generic_pii"], "low", true);
          }
        } else {
          emit("getUserMedia:dynamic", line, "getUserMedia() called with a non-literal constraints object — audio/video scope could not be determined statically.", ["microphone_audio", "camera_video"], "low", true);
        }
        return;
      }

      if (methodName === "getCurrentPosition" || methodName === "watchPosition") {
        emit(`geolocation:${methodName}`, line, `Precise device location requested via ${methodName}().`, ["location"], "medium", false);
        return;
      }

      if (methodName === "setItem" && callee.object.type === "Identifier" && STORAGE_OBJECT_NAMES.test(callee.object.name)) {
        const storageKind = callee.object.name;
        const keyArg = path.node.arguments[0];
        if (keyArg && keyArg.type === "StringLiteral" && isSafeFieldName(keyArg.value)) {
          return;
        }
        if (keyArg && keyArg.type === "StringLiteral") {
          const category = classifyFieldName(keyArg.value);
          const ambiguous = isAmbiguousFieldName(keyArg.value);
          emit(
            `${storageKind}:${keyArg.value}`,
            line,
            category
              ? `Value stored in ${storageKind} under key "${keyArg.value}", classified as ${category}.`
              : `Value stored in ${storageKind} under key "${keyArg.value}"; could not confidently classify — needs review.`,
            [category ?? "generic_pii"],
            category ? "medium" : "low",
            ambiguous || !category
          );
        } else {
          emit(`${storageKind}:dynamic`, line, `Value stored in ${storageKind} under a dynamically computed key — needs review.`, ["generic_pii"], "low", true);
        }
      }
    },
  });

  return findings;
}

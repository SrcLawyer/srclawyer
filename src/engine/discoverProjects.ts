import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { globFiles } from "./globFiles.js";
import type { ProjectManifest } from "./types.js";
import { validateWorkspacePatterns } from "./workspacePatterns.js";

const DEFAULT_WORKSPACE_PATTERNS = ["packages/*", "apps/*"];

export interface ProjectDiscovery {
  projects: ProjectManifest[];
  /** Non-null when the scanned repo's own workspace config was rejected (malformed, hostile, or too
   *  expensive to expand) and the default package locations were scanned instead -- surfaced on the
   *  console and in the generated policy, since the scan may then be incomplete. */
  workspaceWarning: string | null;
}

function rejectedConfigWarning(reason: string): string {
  return `Workspace configuration in package.json was rejected (${reason}); the default package locations (${DEFAULT_WORKSPACE_PATTERNS.join(", ")}) were scanned instead, so this scan may be incomplete.`;
}

function readPackageJson(path: string): { value: unknown } | { error: string } {
  try {
    // A leading BOM (common from Windows editors) is valid in practice but not to JSON.parse.
    const text = readFileSync(path, "utf8").replace(/^﻿/, "");
    return { value: JSON.parse(text) };
  } catch {
    return { error: "package.json could not be parsed" };
  }
}

// undefined means "no workspace config at all"; anything else (including a wrong type) is handed to
// the validator, which rejects what isn't an array of well-formed patterns.
function rawWorkspaces(pkg: unknown): unknown {
  const workspaces = typeof pkg === "object" && pkg !== null ? (pkg as { workspaces?: unknown }).workspaces : undefined;
  if (workspaces === undefined || workspaces === null) return undefined;
  if (typeof workspaces === "object" && !Array.isArray(workspaces)) return (workspaces as { packages?: unknown }).packages ?? undefined;
  return workspaces;
}

async function globManifests(patterns: string[], root: string): Promise<string[]> {
  return globFiles(
    patterns.map((p) => (p.startsWith("!") ? `!${join(p.slice(1), "package.json")}` : join(p, "package.json"))),
    { cwd: root, absolute: true, ignore: ["**/node_modules/**"] }
  );
}

export async function discoverProjects(root: string): Promise<ProjectDiscovery> {
  const rootPackageJsonPath = join(root, "package.json");
  if (!existsSync(rootPackageJsonPath)) {
    return { projects: [{ root, kind: "unknown", manifestPath: null }], workspaceWarning: null };
  }

  const rootProject: ProjectManifest = { root, kind: "node", manifestPath: rootPackageJsonPath };
  const parsed = readPackageJson(rootPackageJsonPath);

  let workspaceWarning: string | null = null;
  let patterns: string[] | null = null;
  let hasWorkspaceConfig = existsSync(join(root, "lerna.json")) || existsSync(join(root, "nx.json"));

  if ("error" in parsed) {
    workspaceWarning = rejectedConfigWarning(parsed.error);
    hasWorkspaceConfig = true;
  } else {
    const raw = rawWorkspaces(parsed.value);
    if (raw !== undefined) {
      hasWorkspaceConfig = true;
      const validation = validateWorkspacePatterns(raw);
      if (validation.ok) patterns = validation.patterns;
      else workspaceWarning = rejectedConfigWarning(validation.reason);
    }
  }

  if (!hasWorkspaceConfig) {
    return { projects: [rootProject], workspaceWarning: null };
  }

  let manifestPaths: string[];
  try {
    manifestPaths = await globManifests(patterns ?? DEFAULT_WORKSPACE_PATTERNS, root);
  } catch {
    // Belt and braces behind validateWorkspacePatterns: a pattern that still fails to expand must
    // never take the whole scan down.
    workspaceWarning = rejectedConfigWarning("the patterns could not be expanded");
    try {
      manifestPaths = await globManifests(DEFAULT_WORKSPACE_PATTERNS, root);
    } catch {
      manifestPaths = [];
    }
  }

  const projects: ProjectManifest[] = manifestPaths.map((manifestPath) => ({
    root: dirname(manifestPath),
    kind: "node",
    manifestPath,
  }));

  return { projects: projects.length === 0 ? [rootProject] : projects, workspaceWarning };
}

export function describeProject(root: string, project: ProjectManifest): string {
  const rel = relative(root, project.root);
  return rel === "" ? "." : rel;
}

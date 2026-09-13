import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import fg from "fast-glob";
import type { ProjectManifest } from "./types.js";

interface PackageJson {
  workspaces?: string[] | { packages?: string[] };
}

export async function discoverProjects(root: string): Promise<ProjectManifest[]> {
  const rootPackageJsonPath = join(root, "package.json");
  if (!existsSync(rootPackageJsonPath)) {
    return [{ root, kind: "unknown", manifestPath: null }];
  }

  const rootPackageJson: PackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8"));
  const workspacePatterns = Array.isArray(rootPackageJson.workspaces)
    ? rootPackageJson.workspaces
    : rootPackageJson.workspaces?.packages;

  const lernaPath = join(root, "lerna.json");
  const nxPath = join(root, "nx.json");
  const hasWorkspaceConfig = Boolean(workspacePatterns) || existsSync(lernaPath) || existsSync(nxPath);

  if (!hasWorkspaceConfig) {
    return [{ root, kind: "node", manifestPath: rootPackageJsonPath }];
  }

  const patterns = workspacePatterns ?? ["packages/*", "apps/*"];
  const manifestPaths = await fg(
    patterns.map((p) => join(p, "package.json")),
    { cwd: root, absolute: true, ignore: ["**/node_modules/**"] }
  );

  const projects: ProjectManifest[] = manifestPaths.map((manifestPath) => ({
    root: dirname(manifestPath),
    kind: "node",
    manifestPath,
  }));

  if (projects.length === 0) {
    return [{ root, kind: "node", manifestPath: rootPackageJsonPath }];
  }

  return projects;
}

export function describeProject(root: string, project: ProjectManifest): string {
  const rel = relative(root, project.root);
  return rel === "" ? "." : rel;
}

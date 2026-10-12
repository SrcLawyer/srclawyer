import { realpath, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

// Directories whose symlinks are never scanned anyway (they are globbed with ignore patterns); a
// symlink out of one of these is blocked as usual but not worth a warning -- e.g. a package manager
// pointing node_modules entries at a shared store outside the repo.
const QUIET_SEGMENTS = new Set(["node_modules", ".git"]);

/**
 * The scanned root as a security boundary: a scanned repo is untrusted input, so no file whose REAL
 * path resolves outside it may be read, and no directory symlink leaving it may be walked (a symlink
 * to "/" or "~" would otherwise make a scan traverse the whole filesystem and report lines from files
 * the repo's author chose). In-root symlinks, including loops that stay inside, keep working.
 */
export class RootBoundary {
  readonly realRoot: string;
  // canonical in-repo location of the link entry -> its shortest lexical path. A link reached again
  // through an in-root directory loop is the same link, counted once.
  private readonly blocked = new Map<string, string>();
  private readonly resolved = new Map<string, string | null>();

  constructor(readonly root: string) {
    try {
      this.realRoot = realpathSync(root);
    } catch {
      this.realRoot = resolve(root);
    }
  }

  isInsideRealPath(resolved: string): boolean {
    return resolved === this.realRoot || resolved.startsWith(this.realRoot + sep);
  }

  /** Records a blocked link by its in-repo (lexical) path only -- never its target. */
  private recordBlocked(linkPath: string): void {
    const rel = relative(this.root, linkPath);
    if (rel === "" || rel.startsWith("..")) return;
    if (rel.split(sep).some((segment) => QUIET_SEGMENTS.has(segment))) return;
    let canonical = rel;
    try {
      canonical = join(realpathSync(dirname(linkPath)), basename(linkPath));
    } catch {
      // keep the lexical path
    }
    const existing = this.blocked.get(canonical);
    if (existing === undefined || rel.length < existing.length) this.blocked.set(canonical, rel);
  }

  /** Read-time check, independent of how the path was discovered: the real path if it is inside the
   *  root, else null (and an out-of-root link is recorded). Unresolvable paths fail closed. Cached. */
  resolveInside(path: string): string | null {
    if (this.resolved.has(path)) return this.resolved.get(path)!;
    let result: string | null = null;
    try {
      const real = realpathSync(path);
      if (this.isInsideRealPath(real)) result = real;
      else this.recordBlocked(path);
    } catch {
      result = null;
    }
    this.resolved.set(path, result);
    return result;
  }

  allowsPath(path: string): boolean {
    return this.resolveInside(path) !== null;
  }

  /** `fs` overrides for tinyglobby: a symlink resolving outside the root errors out, so it is neither
   *  walked (directories) nor returned (files). */
  globFs(): { realpath: typeof realpath; realpathSync: typeof realpathSync } {
    const checked = (path: string, resolved: string): string | null => {
      if (this.isInsideRealPath(resolved)) return null;
      this.recordBlocked(path);
      return "outside-root";
    };
    const asyncRealpath = ((path: string, callback: (err: NodeJS.ErrnoException | null, resolved?: string) => void) => {
      realpath(path, (err, resolved) => {
        if (err) return callback(err);
        const problem = checked(path, resolved);
        callback(problem ? Object.assign(new Error(problem), { code: "EXDEV" }) : null, problem ? undefined : resolved);
      });
    }) as unknown as typeof realpath;
    const syncRealpath = ((path: string) => {
      const resolved = realpathSync(path);
      const problem = checked(path, resolved);
      if (problem) throw Object.assign(new Error(problem), { code: "EXDEV" });
      return resolved;
    }) as unknown as typeof realpathSync;
    return { realpath: asyncRealpath, realpathSync: syncRealpath };
  }

  /** Relative in-repo paths of every blocked link, sorted; call after discovery and reading are done. */
  blockedLinks(): string[] {
    return [...this.blocked.values()].sort();
  }
}

/**
 * git.ts — every memory write is a commit. The git log IS the audit trail.
 * Commit message convention:
 *   [blackbox] dec-003: ... | [compass] prop-001: ... | [human] approve prop-001
 */
import { simpleGit, type SimpleGit } from "simple-git";

export type Actor = "blackbox" | "compass" | "human";

/**
 * Vault-wide write lock. The HTTP server is stateless (a fresh server per
 * request), so concurrent tool calls share one vault on disk — without
 * serialization, two requests can race on id allocation or git's index.
 * Every mutating tool wraps its whole handler in this.
 */
let vaultLock: Promise<unknown> = Promise.resolve();
export function withVaultLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = vaultLock.then(fn, fn);
  vaultLock = run.catch(() => undefined);
  return run;
}

export class VaultGit {
  private git: SimpleGit;

  constructor(private vaultRoot: string) {
    this.git = simpleGit({ baseDir: vaultRoot });
  }

  async ensureRepo(): Promise<void> {
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      await this.git.init();
      await this.git.addConfig("user.name", "scout-compass");
      await this.git.addConfig("user.email", "compass@local");
    }
  }

  async commit(actor: Actor, message: string, relPaths: string[]): Promise<string> {
    await this.git.add(relPaths.length ? relPaths : ["."]);
    const res = await this.git.commit(`[${actor}] ${message}`);
    return res.commit || "(nothing to commit)";
  }

  /** First line of a commit message, or null if the sha doesn't resolve. */
  async subject(sha: string): Promise<string | null> {
    try {
      return (await this.git.raw(["log", "-1", "--format=%s", sha])).trim();
    } catch {
      return null;
    }
  }

  /**
   * True if `sha` has no parent — the root commit. Reverting a root commit
   * diffs it against the empty tree, i.e. deletes the entire vault (2026-08-02
   * invigilation finding 2: one call removed 8/9 knowledge notes, 4/4 skills
   * and 5/7 decisions). Callers refuse before ever reaching `revert`.
   */
  async isRootCommit(sha: string): Promise<boolean> {
    try {
      const out = (await this.git.raw(["rev-list", "--parents", "-n", "1", sha])).trim();
      return out.split(/\s+/).filter(Boolean).length === 1; // "<sha>" alone = no parents
    } catch {
      return false; // unresolvable sha: the caller's `subject()` check reports it
    }
  }

  /**
   * Roll back an in-flight revert (`git revert --abort`). Returns true if the
   * abort ran. A conflicted revert that is left mid-flight leaves REVERT_HEAD
   * and staged deletions in the index, which makes EVERY subsequent commit —
   * i.e. every subsequent tool call — fail until a human intervenes.
   */
  async abortRevert(): Promise<boolean> {
    try {
      await this.git.raw(["revert", "--abort"]);
      return true;
    } catch {
      return false; // nothing in flight, or the abort itself failed — caller reports dirtyPaths()
    }
  }

  /** `git status --porcelain` lines; [] means a clean working tree and index. */
  async dirtyPaths(): Promise<string[]> {
    const out = await this.git.raw(["status", "--porcelain"]);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async revert(sha: string): Promise<string> {
    await this.git.raw(["revert", "--no-edit", sha]);
    const log = await this.git.log({ maxCount: 1 });
    return log.latest?.hash ?? "unknown";
  }

  async recentLog(n = 10): Promise<Array<{ sha: string; message: string }>> {
    const log = await this.git.log({ maxCount: n });
    return log.all.map((l) => ({ sha: l.hash.slice(0, 8), message: l.message }));
  }
}

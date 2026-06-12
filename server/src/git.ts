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

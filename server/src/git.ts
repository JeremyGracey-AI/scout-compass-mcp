/**
 * git.ts — every memory write is a commit. The git log IS the audit trail.
 * Commit message convention:
 *   [blackbox] dec-003: ... | [compass] prop-001: ... | [human] approve prop-001
 */
import { simpleGit, type SimpleGit } from "simple-git";

export type Actor = "blackbox" | "compass" | "human";

/**
 * Outcome of the one guarded revert path (VaultGit.humanRevert). A POLICY
 * refusal is data (`ok: false`); a RUNTIME failure (conflict, or a revert that
 * changed nothing) throws instead — see humanRevert.
 */
export type RevertResult =
  | { ok: true; reverted: string; revert_commit: string; subject: string; by: string }
  | { ok: false; commit: string | null; error: string };

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

  async head(): Promise<string> {
    return (await this.git.raw(["rev-parse", "HEAD"])).trim();
  }

  /**
   * Raw revert. Do NOT call this directly from a caller that faces a human or an
   * agent — call humanRevert(), which carries the refusals and the cleanup.
   *
   * Honest return (2026-08-02 invigilation, out-of-scope item now in scope):
   * git exits 1 with EMPTY stderr when a revert produces no change ("The
   * previous cherry-pick is now empty"), and simple-git reads empty stderr as
   * success — so this used to return the CURRENT HEAD (an unrelated commit)
   * as the "revert_commit", claiming a revert that never happened. HEAD is
   * captured before and compared after: no new commit → `applied: false`, and
   * the caller reports that instead of a sha.
   */
  async revert(sha: string): Promise<{ applied: boolean; head: string; before: string }> {
    const before = await this.head();
    await this.git.raw(["revert", "--no-edit", sha]);
    const after = await this.head();
    return { applied: after !== before, head: after, before };
  }

  /** `git revert --quit`: forget an in-flight revert without touching the tree. */
  async quitRevert(): Promise<boolean> {
    try {
      await this.git.raw(["revert", "--quit"]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The ONE guarded revert path — shared by every caller so the sequencing
   * cannot drift (`[human]` ruling 2026-08-02,
   * decisions/2026-08-02-week3-rulings.md:27-40). Before this, the whole
   * sequence lived in the tools.ts revert_memory handler; when revert moved to
   * bin/revert.mjs the guards had to move WITH it, not be reimplemented beside
   * it. Order is load-bearing:
   *
   *   1. named human actor        (this is what undoes a human ruling)
   *   2. commit resolves          → refusal
   *   3. [blackbox] subject       → refusal: history is append-only, even for a human
   *   4. [seed] / root commit     → refusal: that deletes the vault, not a behavior
   *   5. revert, and on conflict  → git revert --abort, then throw clean
   *   6. revert that changed nothing → clean up, then throw (never claim success)
   *
   * POLICY refusals (2-4) return as data — a deliberate, expected "no".
   * RUNTIME failures (5-6) throw: in the CLI a throw is a nonzero exit.
   */
  async humanRevert(sha: string, by: unknown): Promise<RevertResult> {
    if (typeof by !== "string" || by.trim().length === 0) {
      throw new Error(
        "VaultGit.humanRevert() requires an explicit human actor: pass a non-empty `by` " +
          "(who is undoing this?). Reverting undoes a [human] or [compass] ruling, so it is " +
          "human-gated exactly like bin/approve.mjs — there is no agent-facing revert tool.",
      );
    }
    const actor = by.trim();
    const subject = await this.subject(sha);
    if (subject === null) return { ok: false, commit: null, error: `No such commit: ${sha}` };
    if (subject.startsWith("[blackbox]")) {
      return {
        ok: false,
        commit: subject,
        error:
          "Refused: decision records are the flight recorder and are append-only — " +
          "the blackbox cannot be rewritten, even by a human. Revert the behavior " +
          "(a [compass] or [human] commit), never the history.",
      };
    }
    // Baseline guard (2026-08-02 invigilation finding 2): reverting the commit
    // that CREATED the vault is not a behavior rollback — git diffs a root
    // commit against the empty tree, so the revert deletes every note, then
    // conflicts. Refused on either signal: the [seed] subject convention, or
    // the structural fact of having no parent.
    const rootless = await this.isRootCommit(sha);
    if (subject.startsWith("[seed] ") || rootless) {
      return {
        ok: false,
        commit: subject,
        error:
          "Refused: this is the vault's baseline commit " +
          (rootless ? "(no parent — the root commit)" : "(a [seed] commit)") +
          ". Reverting it deletes the entire vault rather than rolling back a behavior; " +
          "it is also the commit that CREATED the append-only decision records, so " +
          "reverting it would erase history through the back door. Revert the specific " +
          "[compass] or [human] commit whose behavior you want undone.",
      };
    }

    let applied: boolean;
    try {
      ({ applied } = await this.revert(sha));
    } catch (e) {
      // A conflicted revert left mid-flight leaves REVERT_HEAD and staged
      // deletions, and every later commit — every later tool call — then fails
      // until a human runs `git revert --abort`. Roll it back, then throw.
      const aborted = await this.abortRevert();
      const dirty = await this.dirtyPaths();
      throw new Error(
        `Refused: reverting ${sha} (${subject}) conflicted with the vault's current state and ` +
          `was rolled back — nothing was changed [revert --abort ${aborted ? "ran" : "was not needed / failed"}]. ` +
          `(${(e as Error).message.split("\n")[0]}) This usually means the commit's changes were ` +
          `already undone, or later commits touched the same files. Revert the most recent commit ` +
          `carrying the behavior instead.` +
          (dirty.length
            ? ` WARNING: the vault working tree is NOT clean after the abort — a human should ` +
              `inspect it: ${dirty.slice(0, 10).join("; ")}`
            : ""),
      );
    }

    if (!applied) {
      // git exited 1 with empty stderr ("nothing to commit" / "the previous
      // cherry-pick is now empty") and simple-git read that as success. No new
      // commit exists. Reporting HEAD as `revert_commit` here would be a false
      // claim by a governed tool, so: clean up the in-flight state and throw.
      const aborted = await this.abortRevert();
      const quit = aborted ? false : await this.quitRevert();
      const dirty = await this.dirtyPaths();
      throw new Error(
        `Refused: reverting ${sha} (${subject}) produced NO change — git created no commit, ` +
          `so nothing was reverted [cleanup: ${aborted ? "revert --abort ran" : quit ? "revert --quit ran" : "nothing in flight"}]. ` +
          `The commit's effect is already undone (it was probably reverted before). ` +
          `Reporting the current HEAD as a revert commit would be a false claim, so this refuses instead.` +
          (dirty.length
            ? ` WARNING: the vault working tree is NOT clean — a human should inspect it: ${dirty.slice(0, 10).join("; ")}`
            : ""),
      );
    }

    // The revert commit git writes carries no actor. Name the human in the
    // subject, in the same shape as [human] approve/reject, so the audit trail
    // can answer "who undid this?" — the point of moving revert behind a human
    // CLI. Amending touches only the commit just created, before returning.
    const short = sha.slice(0, 8);
    await this.git.raw([
      "commit",
      "--amend",
      "-m",
      `[human] revert ${short} (by ${actor}): ${subject}`,
      "-m",
      `This reverts commit ${sha} (${subject}).\nReverted by ${actor} via bin/revert.mjs.`,
    ]);
    const revertCommit = await this.head();
    return { ok: true, reverted: sha, revert_commit: revertCommit, subject, by: actor };
  }

  async recentLog(n = 10): Promise<Array<{ sha: string; message: string }>> {
    const log = await this.git.log({ maxCount: n });
    return log.all.map((l) => ({ sha: l.hash.slice(0, 8), message: l.message }));
  }
}

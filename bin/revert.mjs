#!/usr/bin/env node
/**
 * revert.mjs — HUMAN CLI: git-revert a memory commit.
 *
 *   node bin/revert.mjs <commit-sha> --by <name>
 *
 * `[human]` ruling 2026-08-02 (~/.claude/harness/decisions/
 * 2026-08-02-week3-rulings.md:27-40): revert LEFT the agent-facing MCP surface.
 * It was labelled "HUMAN GATE" while sitting on the agent surface with no actor
 * requirement, and the 2026-08-02 invigilation used it — human absent from
 * every call — to re-materialize a promoted skill as `status: active`, restore
 * an "approved by jeremy" ruling, and delete most of the vault by reverting the
 * seed commit. Anything that undoes a human ruling now requires a named human,
 * exactly like bin/approve.mjs / bin/reject.mjs. The agent keeps the read-only
 * `memory_log` tool: it can see the history it cannot rewrite.
 *
 * The refusals and the cleanup are NOT reimplemented here. They live in
 * VaultGit.humanRevert() (server/src/git.ts) — one guarded sequence, so the CLI
 * path and any future caller cannot drift apart:
 *   named actor → commit resolves → [blackbox] refusal → [seed]/root refusal →
 *   revert → conflict: `git revert --abort` + throw → no-op: clean up + throw
 *   (never claim a revert that did not happen).
 *
 * Exit codes (a governed CLI distinguishes "no" from "broke"):
 *   0  reverted; the new commit is `[human] revert <sha8>: … (by <name>)`
 *   1  POLICY refusal (unknown commit / [blackbox] / [seed] or root commit)
 *   2  usage error (missing sha, missing or blank --by)
 *   3  RUNTIME failure (conflict, or a revert that produced no change) —
 *      the vault is left clean either way
 *
 * Env: VAULT_PATH overrides the vault location (default: <repo>/vault) — the
 * same resolution bin/approve.mjs:41 uses, so the hermetic test suite
 * (demo/test-hermetic.mjs) points this at its scratch vault and never the real
 * one.
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => import(new URL(`../server/dist/${f}`, import.meta.url).href);

const usage = () => {
  console.error("usage: node bin/revert.mjs <commit-sha> --by <name>");
  console.error("  reverts a [compass] or [human] memory commit; requires a named human.");
  process.exit(2);
};

const argv = process.argv.slice(2);
let sha = null;
let by = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--by") by = argv[++i];
  else if (!argv[i].startsWith("--") && sha === null) sha = argv[i];
  else usage();
}
if (!sha || !by || !by.trim()) usage();

const { VaultGit } = await dist("git.js");

const vaultPath = path.resolve(process.env.VAULT_PATH ?? path.join(here, "..", "vault"));
const git = new VaultGit(vaultPath);
await git.ensureRepo();

let result;
try {
  result = await git.humanRevert(sha, by); // git-layer gate: throws without a named actor
} catch (e) {
  // Runtime failure: conflict (aborted) or a revert that changed nothing.
  // Both leave the vault clean; neither is reported as a success.
  console.error(`revert: ${e.message}`);
  process.exit(3);
}

if (!result.ok) {
  console.error(`revert: ${result.error}`);
  if (result.commit) console.error(`  commit: ${result.commit}`);
  process.exit(1);
}

const subject = await git.subject(result.revert_commit);
console.log(`Reverted ${result.reverted} (${result.subject})`);
console.log(`Commit ${String(result.revert_commit).slice(0, 8)}: ${subject}`);

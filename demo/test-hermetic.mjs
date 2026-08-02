#!/usr/bin/env node
/**
 * test-hermetic.mjs — `npm test`, made incapable of touching the real vault.
 *
 * WHY THIS EXISTS (2026-08-02 invigilation finding 4): `npm test` was
 * `seed-vault.mjs && smoke-test.mjs`, both hardwired to <repo>/vault. Wired
 * into the harness's PostToolUse edge (check.sh:98-105), EVERY edit under
 * server/ ran seed-vault.mjs:33 `rmSync(vault/.git)` against the real demo
 * vault — silently destroying its history, including the Day 1 `[human]
 * approve` evidence. A hook cannot call the manual "bundle first" step, so the
 * only safe shape is a suite that never names the real vault at all.
 *
 * What it does:
 *   1. `tsc` (server build) — the smoke test loads server/dist; unbuilt TS
 *      edits would otherwise pass vacuously (WEEK-3 Day 1 test-honesty rule).
 *   2. mkdtemp a throwaway vault dir under the OS temp dir.
 *   3. seed-vault.mjs + smoke-test.mjs against it, with VAULT_PATH exported so
 *      the bin/approve.mjs and bin/reject.mjs SUBPROCESSES the smoke test spawns
 *      land there too.
 *   4. Remove the scratch dir in a finally — pass, fail, or throw.
 *
 * Exit code is the first failing step's; 0 only if every step passed.
 * The real vault is never opened by this process or its children.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");

const scratchRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "compass-test-vault-"));
const vaultPath = path.join(scratchRoot, "vault");
fs.mkdirSync(vaultPath, { recursive: true });

// Deletion guard: only ever remove a mkdtemp dir we created under the OS temp
// dir. If that invariant is ever violated, leave the directory and say so.
const cleanup = () => {
  const tmp = fs.realpathSync(os.tmpdir());
  if (!scratchRoot.startsWith(tmp + path.sep) || !path.basename(scratchRoot).startsWith("compass-test-vault-")) {
    console.error(`test-hermetic: refusing to remove unexpected scratch path ${scratchRoot}`);
    return;
  }
  fs.rmSync(scratchRoot, { recursive: true, force: true });
};

const env = { ...process.env, VAULT_PATH: vaultPath };

const steps = [
  { label: "build (tsc)", cmd: process.execPath, args: [path.join(repo, "server", "node_modules", "typescript", "bin", "tsc"), "-p", path.join(repo, "server", "tsconfig.json")] },
  { label: "seed (scratch vault)", cmd: process.execPath, args: [path.join(here, "seed-vault.mjs")] },
  { label: "smoke test (scratch vault)", cmd: process.execPath, args: [path.join(here, "smoke-test.mjs")] },
];

let code = 0;
try {
  console.log(`test-hermetic: scratch vault ${vaultPath}`);
  for (const step of steps) {
    const res = spawnSync(step.cmd, step.args, { stdio: "inherit", env, cwd: repo });
    const rc = res.status ?? 1;
    if (res.error) {
      console.error(`test-hermetic: ${step.label} could not start: ${res.error.message}`);
      code = 1;
      break;
    }
    if (rc !== 0) {
      console.error(`test-hermetic: ${step.label} FAILED (exit ${rc})`);
      code = rc;
      break;
    }
  }
} finally {
  cleanup();
}
process.exit(code);

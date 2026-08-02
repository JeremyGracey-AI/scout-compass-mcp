#!/usr/bin/env node
/**
 * approve.mjs — HUMAN CLI: promote a proposal into active memory.
 *
 *   node bin/approve.mjs <prop-id> --by <name>
 *
 * This is the human gate, and it is deliberately NOT an MCP tool: the
 * tool-scoped agent has no approve surface at all. The boundary is the OS
 * process — this CLI runs as the human's own process (WEEK-3 threat model;
 * no token machinery, because a token that transits the model's context is
 * not a boundary). The actor requirement itself lives in Vault.promote(),
 * so any future caller hits the same gate.
 *
 * Env: VAULT_PATH overrides the vault location (default: <repo>/vault).
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => import(new URL(`../server/dist/${f}`, import.meta.url).href);

const usage = () => {
  console.error("usage: node bin/approve.mjs <prop-id> --by <name>");
  process.exit(2);
};

const argv = process.argv.slice(2);
let id = null;
let by = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--by") by = argv[++i];
  else if (!argv[i].startsWith("--") && id === null) id = argv[i];
  else usage();
}
if (!id || !by || !by.trim()) usage();

const { Vault } = await dist("vault.js");
const { VaultGit } = await dist("git.js");

const vaultPath = path.resolve(process.env.VAULT_PATH ?? path.join(here, "..", "vault"));
const vault = new Vault(vaultPath);
const git = new VaultGit(vaultPath);
await git.ensureRepo();

const prop = vault.get(id);
if (!prop || prop.type !== "proposal") {
  console.error(`approve: no proposal with id ${id} in ${vaultPath}`);
  process.exit(1);
}

const rel = vault.promote(prop, by); // vault-layer gate: throws without a named actor
const sha = await git.commit("human", `approve ${prop.id} → ${rel} (by ${by})`, [
  rel,
  prop.relPath,
  vault.rulingsRel,
]);
const subject = await git.subject(sha);

console.log(`Promoted ${prop.id} → ${rel}`);
console.log(`Ruling appended to ${vault.rulingsRel} (approved, by ${by})`);
console.log(`Commit ${String(sha).slice(0, 8)}: ${subject}`);

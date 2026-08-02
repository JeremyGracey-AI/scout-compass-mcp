#!/usr/bin/env node
/**
 * reject.mjs — HUMAN CLI: reject and delete a proposal, with a reason.
 *
 *   node bin/reject.mjs <prop-id> --by <name> --reason "<why>"
 *
 * Like bin/approve.mjs, this is deliberately NOT an MCP tool — the human's
 * own OS process is the boundary. The actor requirement lives in
 * Vault.remove(), which records the rejection in compass/rulings.json so the
 * audit never re-proposes a decision a human already ruled on.
 *
 * Env: VAULT_PATH overrides the vault location (default: <repo>/vault).
 */
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => import(new URL(`../server/dist/${f}`, import.meta.url).href);

const usage = () => {
  console.error('usage: node bin/reject.mjs <prop-id> --by <name> --reason "<why>"');
  process.exit(2);
};

const argv = process.argv.slice(2);
let id = null;
let by = null;
let reason = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--by") by = argv[++i];
  else if (argv[i] === "--reason") reason = argv[++i];
  else if (!argv[i].startsWith("--") && id === null) id = argv[i];
  else usage();
}
if (!id || !by || !by.trim() || !reason || !reason.trim()) usage();

const { Vault } = await dist("vault.js");
const { VaultGit } = await dist("git.js");

const vaultPath = path.resolve(process.env.VAULT_PATH ?? path.join(here, "..", "vault"));
const vault = new Vault(vaultPath);
const git = new VaultGit(vaultPath);
await git.ensureRepo();

const prop = vault.get(id);
if (!prop || prop.type !== "proposal") {
  console.error(`reject: no proposal with id ${id} in ${vaultPath}`);
  process.exit(1);
}

const rel = vault.remove(prop.id, by, reason); // vault-layer gate: throws without a named actor
const sha = await git.commit("human", `reject ${prop.id}: ${reason} (by ${by})`, [
  rel,
  vault.rulingsRel,
]);
const subject = await git.subject(sha);

console.log(`Rejected ${prop.id} (${rel} deleted)`);
console.log(`Ruling appended to ${vault.rulingsRel} (rejected, by ${by})`);
console.log(`Commit ${String(sha).slice(0, 8)}: ${subject}`);

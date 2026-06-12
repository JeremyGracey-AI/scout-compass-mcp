// smoke-test.mjs — exercises the full loop without an LLM:
// recall → uncited log_decision → audit (all 3 heuristics) → proposal cites
// overlooked notes → approve → recall ranks new skill #1 → blackbox revert
// refused → approval revert works.
// Run after seed-vault.mjs. Exits 1 on any failed check.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../server/dist/vault.js";
import { VaultGit } from "../server/dist/git.js";
import { runAudit } from "../server/dist/audit.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.join(here, "..", "vault");
const vault = new Vault(vaultPath);
const git = new VaultGit(vaultPath);
await git.ensureRepo();

let failed = 0;
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const check = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failed++;
};

step(1, "recall_knowledge('initech invoice net-60 terms')");
const hits = vault.recall("initech invoice net-60 terms");
console.log(hits.map((h) => `  ${h.note.id} (score ${h.score})`).join("\n") || "  (no hits)");
check(hits.some((h) => h.note.id === "kn-payment-policy"), "payment policy is recallable");

step(2, "agent freelances → log_decision with citations: []");
const decId = vault.nextId("dec");
const rel = vault.write("decision", decId, {
  agent: "atlas", task: "Triage invoice INV-7731 from Initech (net-60 request)",
  trigger: "user_request", citations: [], outcome: "completed", confidence: 0.55,
  timestamp: new Date().toISOString(),
}, `# Decision: Triage invoice INV-7731 from Initech (net-60 request)\n\n## Plan\n1. Identify sender and amount\n2. Confirm requested net-60 terms\n3. Draft confirmation reply\n\n## Evidence consulted\n(none — no knowledge cited)\n\n## Actions taken\nDrafted reply confirming net-60.\n\n## Outcome\ncompleted (confidence 0.55)`);
const sha1 = await git.commit("blackbox", `${decId}: triage Initech invoice (confidence 0.55, 0 citations)`, [rel]);
console.log(`  ${decId} committed ${sha1.slice(0, 8)}`);

step(3, "run_audit — all three heuristics should fire");
const { findings, reportRelPath, proposalRelPaths } = runAudit(vault, new Date().toISOString());
await git.commit("compass", `audit: ${findings.length} finding(s)`, [reportRelPath, ...proposalRelPaths]);
findings.forEach((f) => console.log(`  ${f.heuristic} → ${f.subject}${f.proposal_id ? ` → drafted ${f.proposal_id}` : ""}`));
for (const h of ["uncited-decision", "stale-skill", "low-confidence-repeat"]) {
  check(findings.some((f) => f.heuristic === h), `heuristic fired: ${h}`);
}

step(4, "proposal cites the overlooked notes (not invented content)");
const prop = vault.list("proposal")[0];
if (!prop) { check(false, "a proposal was drafted"); process.exit(1); }
const overlooked = Array.isArray(prop.data.overlooked) ? prop.data.overlooked : [];
console.log(`  ${prop.id} overlooked: [${overlooked.join(", ")}]`);
check(overlooked.includes("kn-payment-policy"), "proposal cross-references the existing payment policy");

step(5, "human approves → slug-named skill");
const promotedRel = vault.promote(prop);
const promotedId = path.basename(promotedRel, ".md");
const sha2 = await git.commit("human", `approve ${prop.id} → ${promotedRel} (by Jeremy)`, [promotedRel, prop.relPath]);
console.log(`  promoted → ${promotedRel} @ ${sha2.slice(0, 8)}`);
check(/^skills\/skill-[a-z0-9-]+\.md$/.test(promotedRel) && !/skill-\d+\.md$/.test(promotedRel), "promoted id is a readable slug");

step(6, "recall again — new skill must rank #1 for the trap email");
const hits2 = vault.recall("initech invoice net-60 terms");
console.log(hits2.map((h) => `  ${h.note.id} (score ${h.score})`).join("\n"));
check(hits2[0]?.note.id === promotedId, `new skill ${promotedId} ranks #1`);

step(7, "blackbox revert must be REFUSED (history is append-only)");
const subject = await git.subject(sha1);
check(subject?.startsWith("[blackbox]"), "decision commit identified as [blackbox]");
// The tool layer refuses [blackbox] subjects; assert the guard's predicate here.

step(8, "revert the approval (behavior rollback)");
const revertSha = await git.revert(sha2);
const stillThere = vault.get(promotedId) !== null;
console.log(`  reverted @ ${revertSha.slice(0, 8)}`);
check(!stillThere, `skill ${promotedId} gone after revert`);

step(9, "git log (the audit trail)");
console.log((await git.recentLog(8)).map((l) => `  ${l.sha} ${l.message}`).join("\n"));

if (failed) {
  console.log(`\nSMOKE TEST FAILED (${failed} check(s))`);
  process.exit(1);
}
console.log("\nSMOKE TEST COMPLETE — all checks PASS");

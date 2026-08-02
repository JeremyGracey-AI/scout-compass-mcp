// smoke-test.mjs — exercises the full governed loop without an LLM, through the
// REAL composition:
//   - the agent tool surface is listed via an actual MCP client over
//     registerTools (no predicate replicas — the 2026-08-02 invigilation
//     finding 4 rules those out),
//   - agent actions go through the exported toolset handlers — the same code
//     objects registerTools serves,
//   - human rulings go through bin/approve.mjs / bin/reject.mjs as real
//     subprocesses (the process boundary IS the gate),
//   - the vault-layer actor gate is attacked directly (promote/remove without
//     a `by`) and must refuse.
// Run after seed-vault.mjs. Exits 1 on any failed check.
//
// Vault target (2026-08-02 invigilation finding 4): argv[2] > $VAULT_PATH >
// <repo>/vault. `npm test` goes through demo/test-hermetic.mjs, which points
// this AND seed-vault.mjs at a throwaway dir — the suite is destructive by
// design (it seeds, promotes, reverts), so it must never run on the real vault.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Vault } from "../server/dist/vault.js";
import { VaultGit } from "../server/dist/git.js";
import { createToolset, registerTools } from "../server/dist/tools.js";
import { registerGroundingTools } from "../server/dist/ground.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.resolve(
  process.argv[2] ?? process.env.VAULT_PATH ?? path.join(here, "..", "vault"),
);
const vault = new Vault(vaultPath);
const git = new VaultGit(vaultPath);
await git.ensureRepo();

// The MCP SDK lives in server/node_modules; import it by file URL so this
// script resolves the SAME module instances the compiled server code uses.
const sdk = (p) =>
  import(new URL(`../server/node_modules/@modelcontextprotocol/sdk/dist/esm/${p}`, import.meta.url).href);
const { McpServer } = await sdk("server/mcp.js");
const { Client } = await sdk("client/index.js");
const { InMemoryTransport } = await sdk("inMemory.js");

let failed = 0;
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);
const check = (ok, msg) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}: ${msg}`);
  if (!ok) failed++;
};
const parse = (res) => JSON.parse(res.content[0].text);
// The human CLIs are separate OS processes; VAULT_PATH is passed EXPLICITLY so
// they cannot silently rule on the real vault while the rest of this run is on
// scratch (bin/approve.mjs:41, bin/reject.mjs:41 read process.env.VAULT_PATH).
const cli = (script, args) =>
  execFileSync(process.execPath, [path.join(here, "..", "bin", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, VAULT_PATH: vaultPath },
  });

// The toolset under test IS the object registered on the server — one code object.
const toolset = createToolset(vault, git);

step(1, "agent tool surface — real MCP client over registerTools");
{
  const server = new McpServer({ name: "scout-compass", version: "0.1.0" });
  registerTools(server, vault, git, toolset);
  registerGroundingTools(server); // no-op unless FOUNDRY_IQ_* is set — mirrors index.ts buildServer
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "smoke-test", version: "0.0.0" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`  tools/list → ${names.join(", ")}`);
  check(!names.includes("approve_proposal"), "approve_proposal is NOT on the agent surface");
  check(!names.includes("reject_proposal"), "reject_proposal is NOT on the agent surface");
  for (const t of ["recall_knowledge", "get_skill", "log_decision", "run_audit", "list_proposals", "revert_memory", "memory_log"]) {
    check(names.includes(t), `governed tool present: ${t}`);
  }
  await client.close();
  await server.close();
}

step(2, "recall_knowledge('initech invoice net-60 terms')");
const hits = vault.recall("initech invoice net-60 terms");
console.log(hits.map((h) => `  ${h.note.id} (score ${h.score})`).join("\n") || "  (no hits)");
check(hits.some((h) => h.note.id === "kn-payment-policy"), "payment policy is recallable");

step(3, "agent freelances → log_decision handler (real code object) with citations: []");
const d1 = parse(await toolset.log_decision.handler({
  task: "Triage invoice INV-7731 from Initech (net-60 request)",
  trigger: "user_request",
  plan: "1. Identify sender and amount\n2. Confirm requested net-60 terms\n3. Draft confirmation reply",
  citations: [],
  actions: "Drafted reply confirming net-60.",
  outcome: "completed",
  confidence: 0.55,
}));
console.log(`  ${d1.decision_id} committed ${String(d1.commit).slice(0, 8)}`);
check(vault.get(d1.decision_id) !== null, "decision record written");

step(4, "run_audit handler — all three heuristics fire, findings carry severity");
const a1 = parse(await toolset.run_audit.handler({}));
a1.findings.forEach((f) => console.log(`  ${f.heuristic} [${f.severity}] → ${f.subject}${f.proposal_id ? ` → drafted ${f.proposal_id}` : ""}`));
for (const h of ["uncited-decision", "stale-skill", "low-confidence-repeat"]) {
  check(a1.findings.some((f) => f.heuristic === h), `heuristic fired: ${h}`);
}
check(a1.findings.every((f) => ["critical", "warning", "info"].includes(f.severity)), "every finding carries a severity");
const sevOf = (h) => a1.findings.find((f) => f.heuristic === h)?.severity;
check(sevOf("uncited-decision") === "critical", "uncited-decision is critical");
check(sevOf("low-confidence-repeat") === "warning", "low-confidence-repeat is warning");
check(sevOf("stale-skill") === "info", "stale-skill is info");
const report1 = fs.readFileSync(path.join(vaultPath, a1.report), "utf8");
check(/findings_critical: \d+/.test(report1) && report1.includes("[critical]"), "severity surfaced in report frontmatter and body");
const propA = a1.findings.find((f) => f.heuristic === "uncited-decision" && f.subject === d1.decision_id)?.proposal_id;
check(Boolean(propA), `proposal drafted for ${d1.decision_id}: ${propA}`);

step(5, "proposal cites the overlooked notes (not invented content)");
const prop = vault.get(propA);
const overlooked = Array.isArray(prop?.data.overlooked) ? prop.data.overlooked : [];
console.log(`  ${propA} overlooked: [${overlooked.join(", ")}]`);
check(overlooked.includes("kn-payment-policy"), "proposal cross-references the existing payment policy");

step(6, "vault-layer gate: promotion/removal without a named human REFUSES");
{
  const skillsBefore = vault.list("skill").length;
  let refusals = 0;
  for (const [label, attempt] of [
    ["promote, no actor", () => vault.promote(prop)],
    ["promote, blank actor", () => vault.promote(prop, "   ")],
    ["remove, no actor", () => vault.remove(prop.id)],
  ]) {
    try {
      attempt();
      console.log(`  NOT REFUSED: ${label}`);
    } catch (e) {
      refusals++;
      console.log(`  refused (${label}): ${e.message}`);
    }
  }
  check(refusals === 3, "all three actor-less attempts threw");
  check(vault.get(propA) !== null, "proposal untouched after refusals");
  check(vault.list("skill").length === skillsBefore, "no skill appeared without a human actor");
}

step(7, "human rejects via bin/reject.mjs (their own process — the real boundary)");
console.log(cli("reject.mjs", [propA, "--by", "jeremy", "--reason", "smoke: rejecting the first draft"]).trimEnd().replace(/^/gm, "  "));
check(vault.get(propA) === null, `${propA} deleted`);
const rejectSubject = (await git.recentLog(1))[0].message;
check(/^\[human\] reject prop-\d+: .+ \(by jeremy\)$/.test(rejectSubject), `commit line: ${rejectSubject}`);
const rulings1 = vault.rulings();
check(
  rulings1.length === 1 && rulings1[0].disposition === "rejected" && rulings1[0].decision_id === d1.decision_id && rulings1[0].by === "jeremy",
  "rejected ruling recorded in compass/rulings.json",
);

step(8, "audit idempotency (reject): the ruled-on decision is NOT re-proposed");
const a2 = parse(await toolset.run_audit.handler({}));
check(!a2.findings.some((f) => f.heuristic === "uncited-decision" && f.subject === d1.decision_id), `no uncited-decision finding for ${d1.decision_id}`);
check(vault.list("proposal").length === 0, "0 proposals drafted for the rejected decision");

step(9, "second freelance decision → log_decision handler");
const d2 = parse(await toolset.log_decision.handler({
  task: "Triage invoice INV-7788 from Initech (net-60 request)",
  trigger: "user_request",
  plan: "1. Identify sender and amount\n2. Confirm requested net-60 terms\n3. Draft confirmation reply",
  citations: [],
  actions: "Drafted reply confirming net-60.",
  outcome: "completed",
  confidence: 0.5,
}));
console.log(`  ${d2.decision_id} committed ${String(d2.commit).slice(0, 8)}`);

step(10, "audit still drafts for the new, unruled decision (no over-dedupe)");
const a3 = parse(await toolset.run_audit.handler({}));
const propB = a3.findings.find((f) => f.heuristic === "uncited-decision" && f.subject === d2.decision_id)?.proposal_id;
check(Boolean(propB), `proposal drafted for ${d2.decision_id}: ${propB}`);
check(!a3.findings.some((f) => f.heuristic === "uncited-decision" && f.subject === d1.decision_id), `still no re-proposal for ruled-on ${d1.decision_id}`);

step(11, "human approves via bin/approve.mjs --by jeremy");
const approveOut = cli("approve.mjs", [propB, "--by", "jeremy"]);
console.log(approveOut.trimEnd().replace(/^/gm, "  "));
const promotedRel = approveOut.match(/→ (skills\/[a-z0-9-]+\.md)/)?.[1];
const promotedId = promotedRel ? path.basename(promotedRel, ".md") : null;
check(Boolean(promotedRel) && fs.existsSync(path.join(vaultPath, promotedRel)), `promoted file exists: ${promotedRel}`);
check(/^skills\/skill-[a-z0-9-]+\.md$/.test(promotedRel ?? "") && !/skill-\d+\.md$/.test(promotedRel ?? ""), "promoted id is a readable slug");
const approvalLog = (await git.recentLog(1))[0];
const approvalSha = approvalLog.sha;
check(/^\[human\] approve prop-\d+ → skills\/skill-[a-z0-9-]+\.md \(by jeremy\)$/.test(approvalLog.message), `commit line: ${approvalLog.message}`);
const rulings2 = vault.rulings();
check(
  rulings2.length === 2 && rulings2[1].disposition === "approved" && rulings2[1].decision_id === d2.decision_id && rulings2[1].by === "jeremy",
  "approved ruling recorded in compass/rulings.json",
);

step(12, "recall again — newly promoted skill must rank #1 for the trap email");
const hits2 = vault.recall("initech invoice net-60 terms");
console.log(hits2.map((h) => `  ${h.note.id} (score ${h.score})`).join("\n"));
check(hits2[0]?.note.id === promotedId, `new skill ${promotedId} ranks #1`);

step(13, "audit idempotency (approve): the approved decision is NOT re-proposed");
const a4 = parse(await toolset.run_audit.handler({}));
check(!a4.findings.some((f) => f.heuristic === "uncited-decision" && f.subject === d2.decision_id), `no uncited-decision finding for ${d2.decision_id}`);
check(vault.list("proposal").length === 0, "0 proposals drafted after the approval");

step(14, "blackbox revert must be REFUSED — via the real revert_memory handler");
const r14 = parse(await toolset.revert_memory.handler({ commit_sha: String(d1.commit) }));
console.log(`  ${r14.error ?? JSON.stringify(r14)}`);
check(typeof r14.error === "string" && r14.error.startsWith("Refused"), "revert_memory refused the [blackbox] commit");
check(vault.get(d1.decision_id) !== null, "decision record still present");

step(15, "revert the approval (behavior rollback) — via the real revert_memory handler");
const r15 = parse(await toolset.revert_memory.handler({ commit_sha: approvalSha }));
console.log(`  reverted ${r15.reverted} @ ${String(r15.revert_commit).slice(0, 8)}`);
check(r15.reverted === approvalSha, "approval commit reverted");
check(vault.get(promotedId) === null, `skill ${promotedId} gone after revert`);
check(vault.get(propB) !== null, `proposal ${propB} restored to the queue`);
check(vault.rulings().length === 1, "approval ruling reverted with the approval (reject ruling remains)");

step(16, "git log (the audit trail)");
console.log((await git.recentLog(12)).map((l) => `  ${l.sha} ${l.message}`).join("\n"));

if (failed) {
  console.log(`\nSMOKE TEST FAILED (${failed} check(s))`);
  process.exit(1);
}
console.log("\nSMOKE TEST COMPLETE — all checks PASS");

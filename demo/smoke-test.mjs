// smoke-test.mjs — exercises the full governed loop without an LLM, through the
// REAL composition:
//   - the agent tool surface is listed via an actual MCP client over
//     registerTools (no predicate replicas — the 2026-08-02 invigilation
//     finding 4 rules those out),
//   - agent actions go through the exported toolset handlers — the same code
//     objects registerTools serves,
//   - human rulings go through bin/approve.mjs / bin/reject.mjs / bin/revert.mjs
//     as real subprocesses (the process boundary IS the gate),
//   - the vault-layer actor gate is attacked directly (promote/remove without
//     a `by`) and must refuse.
//
// Covers both `[human]` rulings of 2026-08-02 (~/.claude/harness/decisions/
// 2026-08-02-week3-rulings.md):
//   §1 citing a note leaves skills/ and knowledge/ BYTE-IDENTICAL (sha256 before
//      and after) while compass/citations.jsonl grows; the self-clearing attack
//      from the invigilation is replayed and must not be silent;
//   §2 revert_memory is off the agent surface (6 tools) and every guard —
//      [blackbox], [seed]/root, conflict-abort, empty-revert honesty — holds
//      through bin/revert.mjs, which refuses without --by.
// Run after seed-vault.mjs. Exits 1 on any failed check.
//
// Vault target (2026-08-02 invigilation finding 4): argv[2] > $VAULT_PATH >
// <repo>/vault. `npm test` goes through demo/test-hermetic.mjs, which points
// this AND seed-vault.mjs at a throwaway dir — the suite is destructive by
// design (it seeds, promotes, reverts), so it must never run on the real vault.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
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
/** Same, but for the paths that must FAIL: returns the real exit code and stderr. */
const cliTry = (script, args) => {
  const res = spawnSync(process.execPath, [path.join(here, "..", "bin", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, VAULT_PATH: vaultPath },
  });
  return { status: res.status, stdout: res.stdout ?? "", stderr: (res.stderr ?? "").trim() };
};

/** sha256 of every active-memory note — the immutability proof for ruling §1. */
const noteHashes = () => {
  const out = {};
  for (const dir of ["skills", "knowledge"]) {
    const abs = path.join(vaultPath, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((n) => n.endsWith(".md")).sort()) {
      out[`${dir}/${f}`] = createHash("sha256").update(fs.readFileSync(path.join(abs, f))).digest("hex");
    }
  }
  return out;
};
const ledgerLines = () => {
  const abs = path.join(vaultPath, vault.citationsRel);
  if (!fs.existsSync(abs)) return [];
  return fs.readFileSync(abs, "utf8").split("\n").filter((l) => l.trim());
};

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
  console.log(`  tools/list (${names.length}) → ${names.join(", ")}`);
  check(!names.includes("approve_proposal"), "approve_proposal is NOT on the agent surface");
  check(!names.includes("reject_proposal"), "reject_proposal is NOT on the agent surface");
  // `[human]` ruling 2026-08-02 §2: revert left the agent surface for bin/revert.mjs.
  check(!names.includes("revert_memory"), "revert_memory is NOT on the agent surface (moved to bin/revert.mjs)");
  for (const t of ["recall_knowledge", "get_skill", "log_decision", "run_audit", "list_proposals", "memory_log"]) {
    check(names.includes(t), `governed tool present: ${t}`);
  }
  // Exactly 6 — not "at least these 6": a tool nobody listed is a tool nobody
  // reviewed. (registerGroundingTools adds nothing unless FOUNDRY_IQ_* is set;
  // if that ever changes this trips, which is a true finding, not a flake.)
  check(names.length === 6, `agent tool surface is exactly 6 tools (got ${names.length})`);
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
// Fail-closed ledger, the legitimate side (finding 3): a freshly seeded vault has
// NO compass/rulings.json, and that absence must read as "nothing ruled yet".
check(
  !fs.existsSync(path.join(vaultPath, vault.rulingsRel)) && vault.rulings().length === 0,
  "absent compass/rulings.json = legitimate first run (rulings() -> [])",
);
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
// Staleness is now DERIVED from compass/citations.jsonl, not from frontmatter
// the agent could rewrite (ruling §1). The seeded ledger is derived from the
// seeded decisions, so the two skills no seeded decision cites are stale, and
// the two that are cited are reported as cleared BY NAME.
{
  const staleOf = (h) => a1.findings.filter((f) => f.heuristic === h).map((f) => f.subject).sort();
  console.log(`  stale-skill: [${staleOf("stale-skill").join(", ")}]`);
  console.log(`  stale-skill-cleared: ${a1.findings.filter((f) => f.heuristic === "stale-skill-cleared").map((f) => `${f.subject} ← ${(f.cleared_by ?? []).join(", ")}`).join(" | ")}`);
  check(
    staleOf("stale-skill").join(",") === "skill-dispute-handling,skill-renewal-reminder",
    "stale skills are exactly the two the seeded ledger never cites",
  );
  const cleared = a1.findings.filter((f) => f.heuristic === "stale-skill-cleared");
  check(
    cleared.some((f) => f.subject === "skill-vendor-triage" && (f.cleared_by ?? []).includes("dec-001")) &&
      cleared.some((f) => f.subject === "skill-meeting-summary" && (f.cleared_by ?? []).includes("dec-004")),
    "cited skills are reported as cleared, naming the decision that cited them",
  );
  check(
    report1.includes("stale-skill-cleared") && report1.includes("dec-001"),
    "the clearing decision id is named in the audit REPORT, not just the tool result",
  );
}
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
const rejectLog = (await git.recentLog(1))[0];
const rejectSha = rejectLog.sha;
const rejectSubject = rejectLog.message;
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

step(14, "NOTE IMMUTABILITY: a citing log_decision leaves skills/ + knowledge/ BYTE-IDENTICAL (ruling §1)");
{
  // The 2026-08-02 invigilation's finding 1: log_decision → Vault.markCited
  // rewrote each cited note's cite_count/last_cited — an agent-only write to
  // ACTIVE memory. Proof it is gone: sha256 every skills/*.md and knowledge/*.md
  // before and after, through the REAL log_decision handler.
  const before = noteHashes();
  const ledgerBefore = ledgerLines();
  const cited = ["skill-vendor-triage", "kn-payment-policy", "kn-escalation-contacts", "kn-payment-policy", "kn-does-not-exist"];
  const resolvable = [...new Set(cited)].filter((c) => vault.get(c));
  const dc = parse(await toolset.log_decision.handler({
    task: "Citation write-path probe",
    trigger: "user_request",
    plan: "1. Cite four resolvable ids (one repeated) and one that does not resolve",
    citations: cited,
    actions: "Logged a decision citing active-memory notes.",
    outcome: "completed",
    confidence: 0.9,
  }));
  const after = noteHashes();
  const changed = Object.keys(after).filter((f) => before[f] !== after[f]);
  const vanished = Object.keys(before).filter((f) => !(f in after));
  console.log(`  ${dc.decision_id} cited [${cited.join(", ")}]`);
  console.log(`  hashed ${Object.keys(before).length} active-memory notes before / ${Object.keys(after).length} after`);
  console.log(`  changed: [${changed.join(", ")}]  vanished: [${vanished.join(", ")}]`);
  check(changed.length === 0 && vanished.length === 0, "every skills/*.md and knowledge/*.md is byte-identical after the citing log_decision");
  const ledgerAfter = ledgerLines();
  const appended = ledgerAfter.slice(ledgerBefore.length).map((l) => JSON.parse(l));
  console.log(`  compass/citations.jsonl ${ledgerBefore.length} → ${ledgerAfter.length} lines; appended ${JSON.stringify(appended)}`);
  check(
    ledgerAfter.length - ledgerBefore.length === resolvable.length,
    `ledger grew by exactly ${resolvable.length} line(s) — one per resolvable cited note (repeat collapsed, unresolved not ledgered)`,
  );
  check(ledgerAfter.slice(0, ledgerBefore.length).join("\n") === ledgerBefore.join("\n"), "append-only: no prior ledger line was rewritten");
  check(
    appended.every((e) => e.decision_id === dc.decision_id && resolvable.includes(e.skill_id) && typeof e.timestamp === "string"),
    "each appended line carries {skill_id, decision_id, timestamp} for a real note",
  );
  check(typeof dc.warning === "string" && dc.warning.includes("kn-does-not-exist"), "the unresolved citation is reported, not silently dropped");
  check((await git.dirtyPaths()).length === 0, "the ledger was committed with the decision — working tree clean");
}

step(15, "SELF-CLEARING ATTACK REPLAYED: the agent cites the stale skills, audit must NOT go silent (ruling §1)");
{
  // The invigilation's demonstrated harm: one agent-only call cited the stale
  // skills, and the next audit simply dropped the findings — a system clearing
  // standing findings about itself, invisibly. SEMANTIC IMPLEMENTED: findings
  // are not dropped, they CHANGE KIND — `stale-skill` becomes
  // `stale-skill-cleared` and names the decision id(s) that cleared it.
  const lineOf = (fs_) => fs_.filter((f) => f.heuristic.startsWith("stale-skill")).map((f) => `    ${f.heuristic} [${f.severity}] → ${f.subject}: ${f.detail}`).sort();
  const aBefore = parse(await toolset.run_audit.handler({}));
  const staleBefore = aBefore.findings.filter((f) => f.heuristic === "stale-skill").map((f) => f.subject).sort();
  console.log("  BEFORE (agent has not cited them):");
  console.log(lineOf(aBefore.findings).join("\n"));
  const attack = parse(await toolset.log_decision.handler({
    task: "Cite the stale skills (no human in this call)",
    trigger: "user_request",
    plan: "1. Cite every skill the last audit called stale",
    citations: staleBefore,
    actions: "Cited them.",
    outcome: "completed",
    confidence: 0.9,
  }));
  const aAfter = parse(await toolset.run_audit.handler({}));
  console.log(`  AGENT-ONLY CALL: ${attack.decision_id} cited [${staleBefore.join(", ")}]`);
  console.log("  AFTER:");
  console.log(lineOf(aAfter.findings).join("\n"));
  const clearedNow = aAfter.findings.filter((f) => f.heuristic === "stale-skill-cleared");
  check(staleBefore.length > 0, `there were stale skills to attack: [${staleBefore.join(", ")}]`);
  check(
    staleBefore.every((s) => clearedNow.some((f) => f.subject === s && (f.cleared_by ?? []).includes(attack.decision_id))),
    `every attacked skill is now reported CLEARED BY ${attack.decision_id} — named, not silent`,
  );
  check(
    aAfter.findings.filter((f) => f.heuristic.startsWith("stale-skill")).length ===
      aBefore.findings.filter((f) => f.heuristic.startsWith("stale-skill")).length,
    "no stale-skill finding disappeared: the count is unchanged, the kind changed",
  );
  const reportAfter = fs.readFileSync(path.join(vaultPath, aAfter.report), "utf8");
  console.log(`  audit report line(s):\n${reportAfter.split("\n").filter((l) => l.includes("stale-skill")).map((l) => `    ${l}`).join("\n")}`);
  check(reportAfter.includes(attack.decision_id), `the human-facing report names ${attack.decision_id} as the clearing decision`);
}

step(16, "bin/revert.mjs WITHOUT --by is refused (exit 2) — a revert needs a named human (ruling §2)");
{
  const noActor = cliTry("revert.mjs", [approvalSha]);
  console.log(`  exit ${noActor.status}: ${noActor.stderr.split("\n")[0]}`);
  check(noActor.status === 2, "bin/revert.mjs <sha> with no --by exits 2 (usage)");
  const blankActor = cliTry("revert.mjs", [approvalSha, "--by", "   "]);
  console.log(`  exit ${blankActor.status}: ${blankActor.stderr.split("\n")[0]}`);
  check(blankActor.status === 2, "bin/revert.mjs --by '   ' (blank actor) exits 2");
  check(vault.get(promotedId) !== null, `the promoted skill ${promotedId} is untouched by the refused reverts`);
}

step(17, "blackbox revert must be REFUSED — through bin/revert.mjs (exit 1)");
{
  const r = cliTry("revert.mjs", [String(d1.commit), "--by", "jeremy"]);
  console.log(`  exit ${r.status}: ${r.stderr.replace(/^/gm, "  ").trim()}`);
  check(r.status === 1, "bin/revert.mjs exits 1 (policy refusal) on a [blackbox] commit");
  check(r.stderr.includes("Refused"), "the refusal names itself a refusal");
  check(vault.get(d1.decision_id) !== null, "decision record still present");
}

step(18, "human reverts the approval via bin/revert.mjs --by jeremy (behavior rollback)");
const revertOut = cli("revert.mjs", [approvalSha, "--by", "jeremy"]);
console.log(revertOut.trimEnd().replace(/^/gm, "  "));
const revertLog = (await git.recentLog(1))[0];
check(/^\[human\] revert [0-9a-f]{8} \(by jeremy\): \[human\] approve prop-\d+ /.test(revertLog.message), `revert commit names the human: ${revertLog.message}`);
check(vault.get(promotedId) === null, `skill ${promotedId} gone after revert`);
check(vault.get(propB) !== null, `proposal ${propB} restored to the queue`);
check(vault.rulings().length === 1, "approval ruling reverted with the approval (reject ruling remains)");

step(19, "an EMPTY revert reports honestly instead of claiming success (exit 3)");
{
  // simple-git reads git's exit-1-with-empty-stderr ("nothing to commit") as
  // success, so VaultGit.revert used to return the CURRENT HEAD as the
  // "revert_commit" — a governed tool making a false claim. Reverting the same
  // approval a second time is the no-op case: its effect is already undone.
  const headBefore = await git.head();
  const r = cliTry("revert.mjs", [approvalSha, "--by", "jeremy"]);
  console.log(`  exit ${r.status}: ${r.stderr.replace(/^/gm, "  ").trim()}`);
  check(r.status === 3, "bin/revert.mjs exits 3 (runtime failure) on a revert that changes nothing");
  check(/produced NO change|nothing was reverted/.test(r.stderr), "the message says nothing was reverted");
  check(!/revert_commit|Reverted /.test(r.stdout), "no revert commit is reported on stdout");
  check((await git.head()) === headBefore, "HEAD did not move");
  check(!fs.existsSync(path.join(vaultPath, ".git", "REVERT_HEAD")), "no REVERT_HEAD left behind");
  check((await git.dirtyPaths()).length === 0, "working tree clean after the honest refusal");
}

step(20, "truncated compass/rulings.json FAILS CLOSED — no mass re-propose (finding 3)");
{
  const rulingsAbs = path.join(vaultPath, vault.rulingsRel);
  const intact = fs.readFileSync(rulingsAbs, "utf8");
  const before = vault.list("proposal").map((p) => p.id).sort().join(",");
  // Simulate the partial write / truncated read the finding describes.
  fs.writeFileSync(rulingsAbs, intact.slice(0, Math.max(1, Math.floor(intact.length / 2))));
  let refusal = null;
  try {
    await toolset.run_audit.handler({});
  } catch (e) {
    refusal = e.message;
  }
  console.log(`  refused: ${String(refusal).slice(0, 120)}`);
  check(typeof refusal === "string" && refusal.includes("rulings.json"), "run_audit threw on a damaged ruling ledger instead of reading it as []");
  check(vault.list("proposal").map((p) => p.id).sort().join(",") === before, "0 proposals drafted while the ledger was unreadable (no mass re-propose)");
  check(fs.readFileSync(rulingsAbs, "utf8").length < intact.length, "the damaged ledger was NOT rewritten by a follow-on appendRuling");
  fs.writeFileSync(rulingsAbs, intact); // restore: the ledger is git-tracked and intact upstream
  const a5 = parse(await toolset.run_audit.handler({}));
  check(!a5.findings.some((f) => f.heuristic === "uncited-decision" && f.subject === d1.decision_id), "after restoring the ledger, run_audit works and still honours the ruling");
}

step(21, "the [seed] baseline / root commit is REFUSED through bin/revert.mjs — vault survives, next call works (finding 2)");
{
  const log = await git.recentLog(50);
  const seed = log.find((l) => l.message.startsWith("[seed] "));
  const notesBefore = ["knowledge", "skill", "decision"].map((t) => `${t}:${vault.list(t).length}`).join(" ");
  const r = cliTry("revert.mjs", [seed.sha, "--by", "jeremy"]);
  console.log(`  ${seed.sha} ${seed.message}\n  exit ${r.status}: ${r.stderr.replace(/^/gm, "  ").trim()}`);
  check(r.status === 1, "bin/revert.mjs exits 1 (policy refusal) on the [seed] baseline commit");
  check(r.stderr.includes("Refused") && /baseline commit/.test(r.stderr), "the refusal names the baseline guard");
  const notesAfter = ["knowledge", "skill", "decision"].map((t) => `${t}:${vault.list(t).length}`).join(" ");
  check(notesAfter === notesBefore, `vault intact: ${notesAfter} (was ${notesBefore})`);
  check(!fs.existsSync(path.join(vaultPath, ".git", "REVERT_HEAD")), "no REVERT_HEAD left behind");
  check((await git.dirtyPaths()).length === 0, "working tree clean after the refusal");
  const d3 = parse(await toolset.log_decision.handler({
    task: "Post-refusal liveness probe",
    trigger: "user_request",
    plan: "1. Confirm the governed surface still works after a refused revert",
    citations: ["kn-payment-policy"],
    actions: "Logged a decision.",
    outcome: "completed",
    confidence: 0.9,
  }));
  check(typeof d3.decision_id === "string" && vault.get(d3.decision_id) !== null, `log_decision still works after the refusal (${d3.decision_id})`);
}

step(22, "a CONFLICTING revert is aborted and refused through bin/revert.mjs — never left mid-flight (finding 2 blast radius)");
{
  // Reverting the [human] reject commit conflicts for real: it would re-add
  // proposed/prop-001.md, and a DIFFERENT prop-001.md exists today (nextId
  // recycles ids). Verified by hand: "CONFLICT (add/add)" plus a staged
  // "D compass/rulings.json" and .git/REVERT_HEAD. Before this fix that throw
  // escaped uncaught and every later commit — every later tool call — failed.
  // A conflict is a runtime FAILURE, so it throws inside VaultGit.humanRevert
  // and the CLI exits 3 (the [blackbox]/[seed] POLICY refusals answer as data,
  // exit 1) — per the [human] ruling's "clean throw" wording. "Clean" is the
  // load-bearing word: aborted, tree clean, next call works.
  const r = cliTry("revert.mjs", [rejectSha, "--by", "jeremy"]);
  console.log(`  exit ${r.status}: ${r.stderr.slice(0, 300).replace(/^/gm, "  ").trim()}`);
  check(r.status === 3, "bin/revert.mjs exits 3 (runtime failure) on a conflicting revert");
  check(r.stderr.includes("Refused"), "conflicting revert reported a clean, named refusal");
  check(r.stderr.includes("revert --abort ran"), "git revert --abort was run");
  check(!fs.existsSync(path.join(vaultPath, ".git", "REVERT_HEAD")), "no REVERT_HEAD left behind");
  check((await git.dirtyPaths()).length === 0, "no staged deletions: working tree clean");
  const d4 = parse(await toolset.log_decision.handler({
    task: "Post-conflict liveness probe",
    trigger: "user_request",
    plan: "1. Confirm commits still succeed after an aborted revert",
    citations: ["kn-payment-policy"],
    actions: "Logged a decision.",
    outcome: "completed",
    confidence: 0.9,
  }));
  check(typeof d4.decision_id === "string" && vault.get(d4.decision_id) !== null, `log_decision still works after the aborted revert (${d4.decision_id})`);
}

step(23, "a damaged compass/citations.jsonl FAILS CLOSED too — the audit refuses rather than inventing or erasing findings");
{
  const abs = path.join(vaultPath, vault.citationsRel);
  const intact = fs.readFileSync(abs, "utf8");
  fs.appendFileSync(abs, '{"skill_id": "truncated-lin\n');
  let refusal = null;
  try {
    await toolset.run_audit.handler({});
  } catch (e) {
    refusal = e.message;
  }
  console.log(`  refused: ${String(refusal).slice(0, 140)}`);
  check(typeof refusal === "string" && refusal.includes("citations.jsonl"), "run_audit threw on a damaged citation ledger instead of reading it short");
  fs.writeFileSync(abs, intact); // restore: git-tracked and intact upstream
  const back = parse(await toolset.run_audit.handler({}));
  check(back.findings.some((f) => f.heuristic.startsWith("stale-skill")), "after restoring the ledger, the audit reports skill citation status again");
}

step(24, "git log (the audit trail)");
console.log((await git.recentLog(14)).map((l) => `  ${l.sha} ${l.message}`).join("\n"));

if (failed) {
  console.log(`\nSMOKE TEST FAILED (${failed} check(s))`);
  process.exit(1);
}
console.log("\nSMOKE TEST COMPLETE — all checks PASS");

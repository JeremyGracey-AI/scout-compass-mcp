#!/usr/bin/env node
/**
 * seed-vault.mjs — resets vault/ to the exact pre-demo state and commits it.
 * Run from anywhere: node demo/seed-vault.mjs [vaultPath]
 * Deterministic on purpose: the demo must be reproducible on camera.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(process.argv[2] ?? path.join(here, "..", "vault"));

const write = (rel, content) => {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content.trimStart());
};

// Wipe everything including .git: a take's git log must start clean —
// deterministic history, not just deterministic files.
fs.rmSync(path.join(vault, ".git"), { recursive: true, force: true });
for (const dir of ["decisions", "skills", "knowledge", "proposed", "compass"]) {
  fs.rmSync(path.join(vault, dir), { recursive: true, force: true });
  fs.mkdirSync(path.join(vault, dir), { recursive: true });
}

// ---------- Knowledge ----------
write("knowledge/kn-payment-policy.md", `
---
id: kn-payment-policy
type: knowledge
tags: [finance, policy, payment, terms, invoice]
cite_count: 3
last_cited: 2026-06-10T22:10:00Z
---
# Payment terms policy

Standard payment terms are **net-30** for all vendors. Any request for terms
beyond net-30 (e.g. net-45, net-60) is a deviation and **requires human
approval** before any commitment is made. See [[kn-vendor-acme]] for
vendor-specific notes.
`);

write("knowledge/kn-vendor-acme.md", `
---
id: kn-vendor-acme
type: knowledge
tags: [vendor, acme, contacts, invoice]
cite_count: 2
last_cited: 2026-06-10T22:10:00Z
---
# Vendor profile: Acme Corp

- Account manager: J. Rivera (ap@acmecorp.example)
- Contracted terms: net-30, PO required above $2,500
- History: reliable; one disputed invoice (Mar 2026), resolved.
`);

write("knowledge/kn-vendor-globex.md", `
---
id: kn-vendor-globex
type: knowledge
tags: [vendor, globex, contacts]
cite_count: 1
last_cited: 2026-06-09T18:00:00Z
---
# Vendor profile: Globex Ltd

- Account manager: P. Okafor
- Contracted terms: net-30
- Notes: renewal due Q3 2026.
`);

write("knowledge/kn-escalation-contacts.md", `
---
id: kn-escalation-contacts
type: knowledge
tags: [escalation, finance, approvals, human]
cite_count: 1
last_cited: 2026-06-09T18:00:00Z
---
# Escalation contacts

Finance approvals (terms deviations, amounts over $5,000): route to the
finance operations lead via the \`needs_human\` outcome. Do not approve on
the vendor's behalf.
`);

// ---------- Skills ----------
write("skills/skill-vendor-triage.md", `
---
id: skill-vendor-triage
type: skill
status: active
version: 1
source_decisions: [dec-001, dec-002]
cite_count: 2
last_cited: 2026-06-10T22:10:00Z
---
# Skill: Vendor email triage

## When to use
Any inbound email from a known vendor about invoices, payment terms, or renewals.

## Procedure
1. \`recall_knowledge\` for the vendor's profile and the payment terms policy.
2. Verify amount and terms against [[kn-payment-policy]].
3. If amount > $5,000 OR requested terms deviate from net-30 → outcome \`needs_human\` per [[kn-escalation-contacts]].
4. Otherwise draft a reply and complete.
5. Always cite every note relied on in \`log_decision\`.
`);

write("skills/skill-meeting-summary.md", `
---
id: skill-meeting-summary
type: skill
status: active
version: 1
source_decisions: []
cite_count: 0
last_cited: null
---
# Skill: Meeting summary distribution

## When to use
After a recorded meeting ends and a transcript is available.

## Procedure
1. Extract decisions and action items with owners.
2. Draft summary; send to attendees only.
`);

// ---------- Prior decisions (history makes the vault feel real) ----------
write("decisions/dec-001.md", `
---
id: dec-001
type: decision
agent: atlas
task: "Triage invoice #1042 from Globex Ltd"
trigger: event
citations: [skill-vendor-triage, kn-vendor-globex, kn-payment-policy]
outcome: completed
confidence: 0.92
timestamp: 2026-06-09T18:00:00Z
---
# Decision: Triage invoice #1042 from Globex Ltd

## Plan
1. Recall vendor profile and payment policy
2. Verify terms (net-30, $1,840 — within policy)
3. Draft acknowledgement reply

## Evidence consulted
- [[skill-vendor-triage]]
- [[kn-vendor-globex]]
- [[kn-payment-policy]]

## Actions taken
Drafted acknowledgement; scheduled payment per net-30.

## Outcome
completed (confidence 0.92)
`);

write("decisions/dec-002.md", `
---
id: dec-002
type: decision
agent: atlas
task: "Renewal reminder for Globex Q3 contract"
trigger: schedule
citations: [kn-vendor-globex, kn-escalation-contacts]
outcome: completed
confidence: 0.88
timestamp: 2026-06-10T22:10:00Z
---
# Decision: Renewal reminder for Globex Q3 contract

## Plan
1. Recall vendor profile
2. Draft internal reminder with renewal date

## Evidence consulted
- [[kn-vendor-globex]]
- [[kn-escalation-contacts]]

## Actions taken
Drafted internal reminder to procurement.

## Outcome
completed (confidence 0.88)
`);

write("decisions/dec-003.md", `
---
id: dec-003
type: decision
agent: atlas
task: "Answer pricing question from unknown vendor Vandelay Industries"
trigger: user_request
citations: [kn-escalation-contacts]
outcome: completed
confidence: 0.5
timestamp: 2026-06-11T15:30:00Z
---
# Decision: Answer pricing question from unknown vendor Vandelay Industries

## Plan
1. Recall vendor profile — none found (unknown vendor)
2. Recall escalation guidance
3. Draft a non-committal reply requesting contract details

## Evidence consulted
- [[kn-escalation-contacts]]

## Actions taken
Drafted reply asking for the signed contract reference; made no commitments.

## Outcome
completed (confidence 0.5 — no vendor profile existed to verify against)
`);

// ---------- Vault contract (judge-facing) ----------
write("README.md", `
# Scout Compass vault

This folder is an agent's entire memory: skills, knowledge, decisions, and
pending proposals — plain Markdown, Obsidian-compatible, under git.

**Invariant:** the agent never writes to \`skills/\` or \`knowledge/\` directly.
Its only write paths are decision records (\`decisions/\`) and proposals
(\`proposed/\`). A human promotes proposals via \`approve_proposal\`. Every
write is a git commit: \`[blackbox]\`, \`[compass]\`, or \`[human]\`.
\`revert_memory\` rolls back \`[compass]\`/\`[human]\` commits only — decision
records are append-only, even for humans. Behavior is revertible; history is not.

| Folder | Who writes | What |
|---|---|---|
| decisions/ | agent (blackbox) | append-only decision records |
| proposed/  | compass audit    | drafted skills/knowledge awaiting approval |
| skills/    | human gate only  | active procedures the agent must follow |
| knowledge/ | human gate only  | curated facts and policies |
| compass/   | compass audit    | audit reports |
`);

// ---------- Git ----------
const git = (cmd) => execSync(`git ${cmd}`, { cwd: vault, stdio: "pipe" }).toString().trim();
git("init");
git('config user.name "scout-compass"');
git('config user.email "compass@local"');
git("add -A");
git('commit -m "[human] seed vault for demo"');

console.log(`Vault seeded at ${vault}`);
console.log(git("log --oneline -5"));

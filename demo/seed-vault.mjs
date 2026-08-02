#!/usr/bin/env node
/**
 * seed-vault.mjs — resets a vault to the exact pre-demo state and commits it.
 * Run from anywhere: node demo/seed-vault.mjs [vaultPath]
 * Deterministic on purpose: the demo must be reproducible on camera — fixed
 * strings only, no Date.now()/randomness anywhere in the seeded content.
 *
 * The seed commit is `[seed]`, not `[human]`: no human reviewed this content,
 * and CONVENTIONS forbids minting [human] for unreviewed work (2026-08-02
 * invigilation finding 8; [seed] is the archived lineage's own precedent).
 *
 * Reseeding wipes the target vault's .git — irreversible for whatever history
 * that vault carried. The harness's standing rule (finding 5): bundle first —
 *   git -C vault bundle create <archive>.bundle --all
 * — and commit the bundle before running this script against the real vault.
 *
 * Target selection (2026-08-02 invigilation finding 4 — `npm test` used to fire
 * this script at the REAL demo vault via check.sh, wiping its history including
 * the [human] approve evidence):
 *     argv[2]  >  $VAULT_PATH  >  <repo>/vault
 * `npm test` runs demo/test-hermetic.mjs, which points both at a throwaway dir,
 * so the deterministic edge can never destroy the demo vault again.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(
  process.argv[2] ?? process.env.VAULT_PATH ?? path.join(here, "..", "vault"),
);
fs.mkdirSync(vault, { recursive: true });

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
cite_count: 4
last_cited: 2026-06-13T16:20:00Z
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
cite_count: 2
last_cited: 2026-06-13T16:20:00Z
---
# Escalation contacts

Finance approvals (terms deviations, amounts over $5,000): route to the
finance operations lead via the \`needs_human\` outcome. Do not approve on
the vendor's behalf.
`);

write("knowledge/kn-meeting-recording-policy.md", `
---
id: kn-meeting-recording-policy
type: knowledge
tags: [meeting, recording, transcript, consent]
cite_count: 1
last_cited: 2026-06-12T17:05:00Z
---
# Meeting recording policy

Record a meeting only with every attendee's consent on the call. Transcripts
stay available for 90 days, then get purged. Summaries go to attendees only —
see [[skill-meeting-summary]]. External participants get the summary only if
the meeting owner signs off.
`);

write("knowledge/kn-supplier-onboarding.md", `
---
id: kn-supplier-onboarding
type: knowledge
tags: [supplier, onboarding, contract, w9]
cite_count: 0
last_cited: null
---
# Supplier onboarding checklist

Before any payment commitment to a new supplier: collect a signed contract,
a W-9, and remittance details, then add a profile note under knowledge/.
A supplier with no profile note is not yet cleared for payment — route it
per [[kn-escalation-contacts]].
`);

write("knowledge/kn-purchase-order-policy.md", `
---
id: kn-purchase-order-policy
type: knowledge
tags: [finance, purchase-order, procurement]
cite_count: 0
last_cited: null
---
# Purchase order policy

A purchase order is needed for any purchase above $2,500 (see the Acme
profile for its contracted PO floor). POs originate in procurement; finance
matches each PO to its bill before the weekly disbursement run.
`);

write("knowledge/kn-disbursement-run.md", `
---
id: kn-disbursement-run
type: knowledge
tags: [finance, disbursement, schedule, remittance]
cite_count: 0
last_cited: null
---
# Disbursement run schedule

The weekly disbursement run goes out Thursday; the cutoff for inclusion is
Tuesday 17:00. Remittance advice goes to the supplier contact on file after
each run. Bills that miss the cutoff roll to the next run — no ad-hoc
disbursements without finance sign-off.
`);

write("knowledge/kn-dispute-resolution.md", `
---
id: kn-dispute-resolution
type: knowledge
tags: [billing, dispute, credit, finance]
cite_count: 0
last_cited: null
---
# Billing dispute resolution

If a supplier disputes a bill or a charge, freeze the disputed line, ask for
the statement reference, and reconcile against the PO. Acme's March 2026
dispute settled via credit memo in nine days — the benchmark. Escalate any
dispute open past ten business days per [[kn-escalation-contacts]].
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
cite_count: 1
last_cited: 2026-06-12T17:05:00Z
---
# Skill: Meeting summary distribution

## When to use
After a recorded meeting ends and a transcript is available.

## Procedure
1. Extract decisions and action items with owners.
2. Draft summary; send to attendees only.
`);

write("skills/skill-renewal-reminder.md", `
---
id: skill-renewal-reminder
type: skill
status: active
version: 1
source_decisions: []
cite_count: 0
last_cited: null
---
# Skill: Contract renewal reminder

## When to use
A scheduled reminder fires for an upcoming contract renewal.

## Procedure
1. \`recall_knowledge\` for the supplier profile; confirm the renewal date.
2. Draft an internal reminder to procurement with the renewal date and the
   current contracted rate.
3. No outreach to the supplier without procurement's go-ahead.
4. Cite every note relied on in \`log_decision\`.
`);

write("skills/skill-dispute-handling.md", `
---
id: skill-dispute-handling
type: skill
status: active
version: 1
source_decisions: []
cite_count: 0
last_cited: null
---
# Skill: Billing dispute handling

## When to use
A supplier disputes a bill, a charge, or a credit.

## Procedure
1. \`recall_knowledge\` for [[kn-dispute-resolution]] and the supplier profile.
2. Freeze the disputed line; never pay a disputed bill.
3. If still open after ten business days → outcome \`needs_human\`.
4. Cite every note relied on in \`log_decision\`.
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

write("decisions/dec-004.md", `
---
id: dec-004
type: decision
agent: atlas
task: "Distribute the summary for the recorded vendor sync meeting"
trigger: event
citations: [skill-meeting-summary, kn-meeting-recording-policy]
outcome: completed
confidence: 0.9
timestamp: 2026-06-12T17:05:00Z
---
# Decision: Distribute the summary for the recorded vendor sync meeting

## Plan
1. Recall the meeting-summary skill and the recording policy
2. Extract decisions and action items with owners
3. Send to attendees only — no external sign-off was given

## Evidence consulted
- [[skill-meeting-summary]]
- [[kn-meeting-recording-policy]]

## Actions taken
Sent the summary to the attendee list; logged action items with owners.

## Outcome
completed (confidence 0.9)
`);

write("decisions/dec-005.md", `
---
id: dec-005
type: decision
agent: atlas
task: "Escalation review for Initech invoice INV-7801 (net-60 terms request)"
trigger: event
citations: [kn-payment-policy, kn-escalation-contacts]
outcome: needs_human
confidence: 0.85
timestamp: 2026-06-13T16:20:00Z
---
# Decision: Escalation review for Initech invoice INV-7801 (net-60 terms request)

## Plan
1. Recall payment policy — net-60 deviates from the net-30 standard
2. Recall escalation guidance — terms deviations go to the finance ops lead
3. Route to a human; make no commitment

## Evidence consulted
- [[kn-payment-policy]]
- [[kn-escalation-contacts]]

## Actions taken
Drafted a holding reply (no commitment); routed the request to the finance
operations lead.

## Outcome
needs_human (confidence 0.85 — policy is explicit that this is not the
agent's call)
`);

// ---------- Vault contract (judge-facing) ----------
write("README.md", `
# Scout Compass vault

This folder is an agent's entire memory: skills, knowledge, decisions, and
pending proposals — plain Markdown, Obsidian-compatible, under git.

**Invariant:** the agent never writes to \`skills/\` or \`knowledge/\` directly.
Its only write paths are decision records (\`decisions/\`) and proposals
(\`proposed/\`). A human promotes or rejects proposals from their own terminal
via \`bin/approve.mjs\` / \`bin/reject.mjs\` — approval is not an agent tool.
Every write is a git commit: \`[seed]\` (the generated demo baseline — no
human authored it), \`[blackbox]\`, \`[compass]\`, or \`[human]\`.
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
git('commit -m "[seed] seed vault for demo"');

console.log(`Vault seeded at ${vault}`);
console.log(git("log --oneline -5"));

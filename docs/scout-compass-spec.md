# Scout Compass — Build Spec

**Agents League @ AI Skills Fest · Reasoning Agents track (Microsoft Foundry)**
**Submission deadline: June 14, 2026, 11:59 PM PT · Target submit: June 13 night**

---

## 1. Thesis (the pitch in three sentences)

Microsoft's new Autopilot agents (Scout) are governed at the *permission* layer — Entra identities, admin policy, human approvals. Nobody governs the *memory and competence* layer: what an agent knows, what it did, why it did it, and how it improves. **Scout Compass is a git-backed, Markdown-native blackbox flight recorder and skill auditor for autonomous agents — agent memory and competence under version control, owned by the human.**

Tagline options: "The flight recorder for autonomous agents." / "Your agent's brain, in plain text, under version control."

## 2. System overview

```
┌─────────────────────┐         MCP (streamable HTTP)        ┌──────────────────────────┐
│  Foundry Agent       │ ───────────────────────────────────► │  Compass MCP Server (TS)  │
│  "Atlas" (demo agent)│   recall / log_decision / propose /  │                          │
│  multi-step reasoning│   approve / audit                    │  ┌────────────────────┐  │
└─────────────────────┘                                       │  │  Vault (git repo)   │  │
                                                              │  │  Obsidian-compatible│  │
        Human ◄──────── Obsidian (graph view, live) ◄──────── │  │  Markdown + YAML    │  │
        approves proposals by tool call or file move          │  └────────────────────┘  │
                                                              └──────────────────────────┘
```

Every vault write = one git commit with a structured message. The git log **is** the audit trail. `git revert` **is** memory rollback. This is the demo's emotional core.

## 3. Vault schema

```
vault/
├── decisions/          # Blackbox: append-only decision records
│   └── 2026-06-13-dec-003-vendor-invoice.md
├── skills/             # Active skills the agent must consult
│   └── skill-vendor-triage.md
├── knowledge/          # Curated facts, policies, contacts
│   └── kn-vendor-acme.md
├── proposed/           # Compass-generated proposals awaiting human approval
│   └── prop-001-skill-invoice-escalation.md
├── compass/            # Audit reports
│   └── audit-2026-06-13.md
└── README.md           # Vault contract (schema doc, also a judge artifact)
```

### 3.1 Decision record (Blackbox)

```yaml
---
id: dec-003
type: decision
agent: atlas
task: "Triage invoice email from Acme Corp"
trigger: user_request        # user_request | schedule | event
plan_steps: 4
citations: []                 # ← empty = the agent freelanced. Compass flags this.
tools_used: [recall_knowledge, send_reply_draft]
outcome: completed            # completed | failed | needs_human
confidence: 0.55
timestamp: 2026-06-13T18:42:00Z
---

## Plan
1. Identify sender and invoice amount …

## Evidence consulted
(none — no knowledge cited)

## Actions taken
- Drafted reply approving net-60 terms

## Outcome
Reply drafted. Confidence low: no policy found for net-60 approval.
```

### 3.2 Skill

```yaml
---
id: skill-vendor-triage
type: skill
status: active                # proposed | active | deprecated
version: 1
source_decisions: [dec-001, dec-002]
last_cited: 2026-06-13T17:00:00Z
cite_count: 2
---

# Skill: Vendor email triage
## When to use
Any inbound email from a known vendor about invoices, terms, or renewals.
## Procedure
1. recall_knowledge for the vendor's profile and payment policy
2. If amount > $5,000 or terms deviate from policy → outcome: needs_human
3. Always cite the knowledge notes used.
```

### 3.3 Knowledge note

```yaml
---
id: kn-payment-policy
type: knowledge
tags: [finance, policy]
last_cited: 2026-06-13T17:00:00Z
cite_count: 3
---
# Payment terms policy
Standard terms are net-30. Anything beyond net-30 requires human approval. [[kn-vendor-acme]]
```

### 3.4 Proposal (Compass output)

Same shape as a skill/knowledge note plus `status: proposed`, `rationale:` (which audit heuristic fired), and `evidence: [dec-003]`. Lives in `proposed/` until approved.

### Git commit message convention

```
[blackbox] dec-003: triage Acme invoice (confidence 0.55, 0 citations)
[compass]  prop-001: propose skill-invoice-escalation (heuristic: uncited-decision)
[human]    approve prop-001 → skills/skill-invoice-escalation.md
[human]    revert dec-004 memory write
```

Pitch-only extension (slide, not code): signed commits → tamper-evident chain.

## 4. MCP server

**Stack:** TypeScript, `@modelcontextprotocol/sdk`, streamable HTTP transport (Foundry connects to remote MCP servers by URL), `simple-git` for commits, `gray-matter` for frontmatter. No database — the vault is the database.

**Hosting:** Azure Container Apps (plays well at a Microsoft event). Fallback if deployment fights you: run locally + Microsoft dev tunnel. Decide by Day 2 noon.

### Tool contracts

| Tool | Input | Behavior | Returns |
|---|---|---|---|
| `recall_knowledge` | `query: string` | Keyword + tag search over `knowledge/` and `skills/` (simple scoring; no embeddings in v1). Bumps `cite_count`/`last_cited` only when later cited. | Top-k notes: `{id, title, excerpt}` |
| `get_skill` | `id: string` | Fetch full skill body | Markdown body |
| `log_decision` | `{task, trigger, plan, evidence_ids[], actions, outcome, confidence}` | Write decision record; update `last_cited`/`cite_count` on cited notes; git commit | `{decision_id, commit_sha}` |
| `run_audit` | — | Run heuristics over `decisions/`; write report to `compass/`; auto-draft proposals into `proposed/`; git commit | Report summary + proposal ids |
| `list_proposals` | — | List `proposed/` | `{id, title, rationale}[]` |
| `approve_proposal` | `id` | Move `proposed/` → `skills/` or `knowledge/`, set `status: active`; git commit tagged `[human]` | `{path, commit_sha}` |
| `reject_proposal` | `id` | Delete + commit with reason | ack |
| `revert_memory` | `commit_sha` | `git revert` a memory write | new sha |

**Server-enforced invariant (the safety story, worth 20% of the rubric):** the agent cannot edit `skills/` or `knowledge/` directly. Its only write path is `log_decision` and `propose_*`. Promotion to active memory requires the human-gated `approve_proposal`. State this explicitly in the README — it's the governance claim in one sentence.

### Audit heuristics (v1 — ship exactly these three)

1. **Uncited decision** — `citations: []` → draft a skill proposal from the decision's plan.
2. **Stale skill** — `cite_count == 0` across last N decisions → flag for deprecation.
3. **Low-confidence repeat** — same task category with `confidence < 0.6` twice → propose knowledge-gap note.

Heuristic 1 is the demo. 2 and 3 can be near-trivial implementations.

## 5. Foundry agent ("Atlas")

- Foundry Agent Service agent, GPT-4o-class model, connected to the Compass MCP server as a remote tool.
- System instructions (the "reasoning contract"):
  1. Before acting: `recall_knowledge`; if a relevant skill exists, `get_skill` and follow it.
  2. After acting: always `log_decision` with honest `citations` and `confidence`.
  3. If no relevant knowledge found, proceed but log `citations: []` truthfully.
- Multi-step reasoning showcase = plan → recall → act → log → audit → propose → (human approve) → improved re-run. That loop *is* the track requirement.

## 6. Demo scenario & video script (~3.5 min)

**Scenario:** enterprise vendor-email triage (assumption: generic enterprise, not healthcare — broader judge appeal; PREVERA/clinical-audit angle gets one slide as "where this matters most"). Seed vault: 2 skills, 4 knowledge notes, 2 prior decisions.

1. **(0:00)** Thesis card: "Microsoft governs agent permissions. Who governs agent memory?"
2. **(0:30)** Atlas triages a normal vendor email → split screen: chat + Obsidian. Decision record appears live in the graph, citing policy notes. Show the git commit.
3. **(1:15)** The trap: an Acme invoice with net-60 terms. No skill covers it. Atlas freelances → decision record with `citations: []`, confidence 0.55.
4. **(1:45)** `run_audit` → Compass flags the uncited decision, drafts `prop-001 skill-invoice-escalation` into `proposed/`.
5. **(2:15)** Human approves (one tool call). Git log shows `[human] approve`. Re-run the same email → Atlas follows the new skill, cites it, routes to `needs_human`. Correct behavior, with provenance.
6. **(2:50)** `git revert` the skill → behavior reverts. "Memory and competence under version control."
7. **(3:10)** Close: architecture slide + the invariant ("agents propose, humans promote") + clinical/regulated-industry slide.

Bake the "trap" email into a seed script so the demo is deterministic. Rehearse twice before recording.

## 7. Repo structure (public, submission artifact)

```
scout-compass/
├── README.md            # thesis, architecture diagram, quickstart, demo video link
├── server/              # MCP server (TS)
│   └── src/{index,tools,vault,audit,git}.ts
├── vault/               # seeded demo vault (gitignored — regenerated by demo/seed-vault.mjs)
├── agent/               # Foundry agent instructions + setup script/notes
├── demo/                # seed-vault.ts, demo-script.md, trap email fixture
└── docs/                # one-pager.md, architecture.png, pitch deck (optional)
```

README is a judged artifact — write it like the pitch, not like docs.

## 8. Schedule

| Day | Deliverable | Cut line |
|---|---|---|
| **Jun 11 (today)** | Repo scaffold; vault schema + seed script; MCP server: `recall_knowledge`, `log_decision`, `get_skill` with git commits; verify end-to-end with MCP Inspector or Claude Desktop | Server core working locally |
| **Jun 12** | Deploy server (Container Apps or dev tunnel — decide by noon); create Foundry agent, wire MCP, tune instructions until citation behavior is reliable; build `run_audit` + proposal/approve/revert tools | Full loop works once, ugly is fine |
| **Jun 13** | Seed final vault; rehearse; record video; write README/one-pager; **submit by tonight** | Submitted with 24h buffer |
| **Jun 14** | Buffer only. Optional: Copilot Studio wrapper for a second (Enterprise) entry if rules allow multi-track | — |

## 9. Risks & trade-offs

- **Foundry MCP wiring is the long pole.** Mitigation: server works standalone Day 1; if Foundry's remote-MCP path stalls past Day 2 noon, fall back to a thin orchestrator script calling Foundry models + MCP server directly — the reasoning loop is identical on video.
- **No embeddings/RAG in v1** — keyword recall is enough for a 6-note vault and removes a failure mode. Say "semantic recall" on the roadmap slide.
- **Naming:** "Scout Compass" beside "Microsoft Scout" is great hackathon rhetoric, mild trademark risk if productized. Fine for now; position as "a compass *for* the Scout era," not a Microsoft product.
- **Scope creep guard:** if a feature isn't in the 7-step video script, it doesn't get built.

## 10. Pre-flight checklist

- [x] Registered (before Jun 12 noon PT gate)
- [ ] Pull this round's official rules + submission template from `microsoft/Agents-League-AISF-Regulations` — confirm multi-track entry policy and video requirements
- [ ] Foundry project + model deployment provisioned
- [ ] Public GitHub repo created (`scout-compass`)
- [ ] Obsidian pointed at `vault/` for the demo

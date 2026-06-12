# Scout Compass — Submission package

Prepared for the Agents League @ AI Skills Fest 2026 Contest Website submission (Reasoning Agents track). Paste-ready materials and checklists below.

---

## Project description

*(~320 words — paste into the Contest Website "Projects" tab.)*

**Scout Compass: a git-backed, Markdown-native blackbox flight recorder and skill auditor for autonomous AI agents.**

Microsoft governs agent *permissions* — identities, policies, approvals. Scout Compass governs the layer nobody else does: agent *memory and competence*. When an always-on agent makes a bad call, permission systems tell you it was *allowed* — not why it happened. And when agents "learn," that learning is invisible: buried in vendor-side memory you can't read, diff, or revoke.

Scout Compass puts an agent's entire memory — skills, knowledge, and a blackbox of decision records — into plain Markdown in a git repository the human owns. It is Obsidian-compatible, and every memory write is a git commit. The one-sentence thesis: **agents propose, humans promote.**

The governed loop, demonstrated end to end: the agent recalls knowledge, acts, and logs an immutable decision record (plan, evidence cited, actions, outcome, confidence). When it acts without citing anything — it freelanced — a human-triggered audit catches the uncited decision, re-runs recall over the task, and drafts a skill proposal that cites the exact notes the agent overlooked. A human approves; the proposal is promoted into active memory; the identical input is then handled correctly — cited, escalated, and fully attributable. `git revert` is memory rollback for skills and knowledge — but the blackbox is append-only: the server refuses to revert decision-record commits. Behavior is revertible; history is not. Crucially, the invariant is enforced in the tool layer, not the prompt: the agent's only write paths are decisions and proposals, and promotion requires the human-gated `approve_proposal`.

The stack is deliberately small and inspectable: a TypeScript MCP server (streamable HTTP + stdio), a plain-Markdown vault, and git. No database, no embeddings — the vault is the database, and the git log is the audit trail.

Regulated industries — healthcare first — cannot deploy autonomous agents without exactly this: decision provenance, human-gated capability change, and revocable memory, in 100% inspectable plain text.

Built solo by Jeremy Gracey — [jeremygracey.ai](https://jeremygracey.ai) · [github.com/JeremyGracey-AI](https://github.com/JeremyGracey-AI)

---

## Submission checklist (Contest Website "Projects" tab)

| Item | Status |
|---|---|
| Project description | **DONE** — see above, paste as-is |
| Demo video ≤5 min on YouTube/Vimeo (solely Jeremy's own work; no third-party music or stock footage) | **PENDING** — record per the video checklist below, upload, add link |
| Public GitHub repo link | **DONE** — https://github.com/JeremyGracey-AI/scout-compass-mcp (local HEAD matches origin/main) |
| Architecture diagram | **DONE** — `docs/architecture.svg` (attach to submission) |
| Microsoft Learn username | **PENDING — NEEDED FROM JEREMY** |

---

## Video checklist

**Hard rules**

- [ ] **≤5 minutes hard cap — target ~4:15.** Let the audit → approve → re-run beats breathe; don't rush them.
- [ ] **Record in segments** — never bet the night on one take. Budget several attempts for the run-2 segment.
- [ ] **Reseed before every take:** `node demo/seed-vault.mjs` (deterministic; regenerates the whole vault).
- [ ] Solely Jeremy's own work: no third-party music, no stock footage.

**Layout (3 panes)**

- [ ] Agent chat — left
- [ ] Obsidian open on `vault/` — right (test graph view vs. file-explorer + open-note beforehand; graph reflow can be janky — pick whichever reads better)
- [ ] Terminal with `git log --oneline` — bottom

**The arc** (spec §6, updated with the two new beats from HANDOFF)

1. **(0:00)** Thesis card: "Microsoft governs agent permissions. Who governs agent memory?"
2. **(0:30)** Atlas triages a normal vendor email — decision record appears live in Obsidian, citing policy notes. Show the git commit.
3. **(1:15)** The trap: an invoice with net-60 terms from an unknown vendor. No skill covers it. Atlas freelances → decision record with `citations: []`, confidence ~0.55.
4. **(1:45)** Human asks for the audit (`run_audit` is human-triggered — the agent never audits itself unprompted; say this on camera). **The audit shows THREE findings — pan over the report:** uncited decision, stale skill, low-confidence repeat. The drafted proposal's "What the agent missed" section cites `kn-payment-policy` — derived from real vault content, not invented.
5. **(2:15)** Human approves (one tool call) → slug-named skill promoted. Git log shows `[human] approve`. Re-run the same email → Atlas's recall ranks the new skill #1, follows it, cites it, routes to `needs_human`. Correct behavior, with provenance.
6. **(2:50)** Rollback beat: `revert_memory` on the approval → behavior reverts. **Optional new beat:** ask Atlas to revert the run-1 *decision* commit → the server refuses on camera — "behavior is revertible, history is not."
7. **(3:10+)** Close: architecture slide + the invariant ("agents propose, humans promote") + one regulated-industries slide (healthcare decision provenance) — closing slide only, the demo itself stays generic-enterprise.

**Honesty note**

- [ ] If the fallback client (Claude Desktop over stdio) appears in the video instead of Foundry, say so plainly in the README — note which client appears on screen. A working governed loop on video beats a broken integration.

---

## Discord post draft

> Your agent's memory shouldn't be a vendor-side black box. Scout Compass puts an agent's skills, knowledge, and a flight-recorder blackbox of every decision into plain Markdown under git — the agent can only *propose* changes, a human *promotes* them, and `git revert` is memory rollback (but the blackbox is append-only, even for humans). Watch an agent freelance, get caught by the audit, and come back governed: https://github.com/JeremyGracey-AI/scout-compass-mcp
>
> [attach 30s clip]

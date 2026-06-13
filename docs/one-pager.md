# Scout Compass — one-pager

**Track:** Reasoning Agents (Microsoft Foundry)
**Tagline:** The flight recorder for autonomous agents.

## Problem

Autonomous agents now act continuously on our behalf. Permission systems
(identities, policies, approvals) tell us what an agent was *allowed* to do —
nothing tells us *why it did what it did*, what it knew at the time, or who
approved the capabilities it learned along the way. Agent memory today is
either vendor-locked or invisible. That's a non-starter for any serious
deployment, and a hard blocker in regulated industries.

## Solution

Scout Compass puts an agent's entire memory — skills, knowledge, and a
blackbox of decision records — into a plain-Markdown, Obsidian-compatible
git repository that the human owns.

- **Blackbox:** every action → an immutable decision record (plan, evidence
  cited, actions, outcome, confidence). Every write is a git commit; the git
  log is the audit trail.
- **Compass:** audit heuristics mine the blackbox. A decision made with zero
  citations — the agent freelanced — automatically becomes a *draft skill
  proposal*. A human approves or rejects. Approved skills change future
  behavior, with full provenance.
- **The invariant, enforced in the server:** the agent's only write paths
  are decisions and proposals. Promotion to active memory requires the
  human-gated `approve_proposal`. Agents propose; humans promote. And
  `git revert` is memory rollback.

## Multi-step reasoning (track fit)

The system *is* a reasoning loop: plan → recall → act → log → audit →
propose → human gate → improved re-run. In the demo, the agent mishandles a
net-60 invoice from an unknown vendor, the audit catches the uncited
decision, drafts a skill, a human approves it, and the identical input is
then handled correctly — cited, escalated, and revertible.

## Reliability & safety

No prompt-only safety: the write restriction is enforced by the MCP server.
Honest citation gaps are rewarded by design (they feed the audit). Memory is
inspectable, diffable, attributable ([blackbox]/[compass]/[human] commits),
and revocable.

## Microsoft IQ grounding

Atlas grounds on **Microsoft Foundry IQ** — an Azure AI Search knowledge base
of institutional reference content (vendor master, org directory, handbook) —
as a read-only layer, exposed both as a native agent knowledge attach and a
`ground_foundry_iq` MCP tool. Grounding is kept strictly **orthogonal to the
vault**: own `source:foundry-iq` provenance and `[iq:]` citations, never merged
with governed memory or able to override a human-approved skill. Microsoft
governs permissions and grounding; Scout Compass governs memory and competence.
(Fabric IQ and Work IQ wire in the same way as additive siblings.)

## Stack

Microsoft Foundry Agent Service · Microsoft Foundry IQ (Azure AI Search) ·
MCP (TypeScript, streamable HTTP) · git (simple-git) · Markdown/YAML
(gray-matter) · Obsidian as the human's window into the agent's mind.

## Why now

Microsoft's Autopilot era (Scout, announced at Build 2026) makes always-on
agents mainstream — and makes the missing memory-governance layer urgent.
Healthcare and other regulated domains need exactly this pattern: decision
provenance, human-gated capability change, revocable memory. In plain text.

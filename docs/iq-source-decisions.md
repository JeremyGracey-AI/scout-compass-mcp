# IQ knowledge-source decisions — what we use, what we deferred, and why

Foundry IQ lets a knowledge base combine multiple source types (Azure AI
Search, Blob, Web, SharePoint, OneLake, **Fabric IQ**, Azure SQL, **Work IQ**,
**File**, **MCP Server**). This is the record of which we chose for Scout
Compass, and — for the ones we skipped — why, and exactly what it would take to
add them. The point is deliberate scope, not omission: one genuinely-working IQ
satisfies the requirement; the rest are reachable extensions, documented so the
path is honest.

Every source below, if added, stays bound by [IQ_ORTHOGONALITY.md](./IQ_ORTHOGONALITY.md):
its results are external **grounding**, surfaced under their own label and
citation prefix, never merged into — or allowed to override — the git-owned
vault memory.

## Using now: File (Foundry IQ)

**Source type: `File` (service-managed upload).** Our grounding content is three
small, static reference files — `foundry/knowledge-sources/vendor-master.csv`,
`org-directory.csv`, `company-handbook.md` — deliberately **orthogonal to the
vault** (institutional facts, *not* the payment policy the trap-email demo turns
on, so IQ can't alter the validated behavior).

Why `File` and not the heavier sources:
- No storage account, connection string, or external pipeline — the index is
  service-managed, so the whole integration stays inspectable and reproducible
  from this repo.
- It is the honest shape of the data: a few flat reference documents. Wrapping
  them in a lakehouse or a tenant would be ceremony, not capability.

This knowledge base is consumed two ways, both read-only: natively by the Atlas
agent (Foundry IQ attached in the Knowledge panel) **and** by the Compass MCP
server's `ground_foundry_iq` tool (`server/src/ground.ts`), which calls the
AI Search `/retrieve` action over `fetch`.

## Deliberately NOT used: MCP Server source

Pointing a Foundry IQ knowledge base at an MCP server (to "invoke tools for
agentic retrieval") would, in our case, mean pointing it back at the **Compass
MCP server** — whose tools are the *governance* surface (`recall_knowledge`,
`log_decision`, the audit, the human-gated promotion), not a retrieval index.
That is circular, and worse, it would **collapse the vault/IQ separation** that
is the whole safety story. Grounding and governed memory must stay distinct
systems. Not used, by design.

## Deferred but viable: Fabric IQ (OneLake Catalog) [Preview]

**What it is:** grounds responses on an ontology, data agent, or lakehouse from
Microsoft Fabric — semantic intelligence over enterprise data with business
meaning attached.

**Why not now:** it requires a **Microsoft Fabric workspace + a modeled
lakehouse/ontology with data**. Our reference content is three flat files, not a
Fabric semantic model — there is nothing to point it at. Standing up Fabric is a
real, separate provisioning lift, not a fit for this content or this timeline.

**What it would take to add:** create a Fabric workspace, land the enterprise
data in OneLake, model an ontology (or expose a data agent), then add it here as
a second knowledge source. It would strengthen the *multi-source* grounding
story — e.g. structured ERP/commerce data alongside the flat handbook — and is
the natural path to the "Best use of IQ tools" depth. The
`ground_foundry_iq` tool already has the extension seam for a sibling
`ground_fabric_iq` (see `server/src/ground.ts`).

## Deferred but viable: Work IQ [Preview]

**What it is:** grounds responses on organizational intelligence retrieved
through Microsoft 365 — the memory layer behind Copilot, built from emails,
meetings, chats, and documents.

**Why not now:** it grounds on **live Microsoft 365 tenant data**. A faithful
integration needs real org content (and the permissions to retrieve it) — which
we deliberately don't want flowing into a public demo. There is no synthetic
substitute that would exercise it honestly.

**What it would take to add:** connect the M365 tenant's Work IQ as a knowledge
source on a tenant with real (or seeded) organizational data and Copilot access.
For an enterprise-ops agent like Atlas this is the highest-value grounding of the
three — "what did we decide in last week's vendor review?" — but it is a
tenant-data dependency, not a repo artifact.

## Summary

| Source | Status | Gating dependency |
|---|---|---|
| File (Foundry IQ) | **Using** | none — service-managed upload of repo files |
| MCP Server | **Rejected by design** | would collapse vault/IQ separation |
| Fabric IQ (OneLake) | Deferred, viable | a Fabric workspace + modeled lakehouse/ontology |
| Work IQ (M365) | Deferred, viable | a real M365 tenant with org data + Copilot |

One working IQ (Foundry IQ via File) meets the requirement and demonstrates the
governed-grounding pattern end to end. Fabric IQ and Work IQ are additive
multi-source extensions whose only blocker is a real data source — the code seam
and the orthogonality contract are already in place for both.

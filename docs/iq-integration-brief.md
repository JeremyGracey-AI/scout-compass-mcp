# IQ integration brief — Foundry IQ + Fabric IQ + Work IQ

Handoff spec for the agent wiring Microsoft's three IQ layers into Scout
Compass. Read this fully before touching `server/src/`. The governed loop is
already validated end-to-end through Foundry; the job is to ADD grounding
without disturbing it.

## Goal

Integrate all three Microsoft IQ intelligence layers as **read-only grounding
/ retrieval backends**. Eligibility requires ≥1 IQ; building all three also
targets the "Best use of IQ tools" award. The framing stays:
**Microsoft governs permissions + grounding (IQ); Scout Compass governs memory
+ competence (the vault).** IQ is grounding, never memory.

## Hard constraints — do NOT violate (each protects something already working)

1. **Do not merge IQ results into `recall_knowledge`'s scored vault results.**
   Run 2 of the demo cites the freshly-promoted skill only because that skill
   is `results[0]` (score 18, ahead of `skill-vendor-triage` at 4) and the
   Atlas contract says "follow the highest-ranked skill." Merging IQ hits into
   that scored array changes the ordering and silently breaks the demo's payoff.
   Keep IQ **additive and isolated**:
   - **Preferred:** separate read-only tool(s) — e.g. one `ground` tool taking
     a `source` arg, or `ground_foundry_iq` / `ground_fabric_iq` /
     `ground_work_iq`.
   - **Or:** append IQ hits as a distinct block *after* the untouched vault
     array in `recall_knowledge`, each tagged `source: foundry-iq | fabric-iq
     | work-iq`. The existing vault `results` array and `results[0]` must stay
     byte-for-byte identical.

2. **Read-only only.** Never add a write path into `skills/` or `knowledge/`.
   The memory-governance invariant (agents propose, humans promote; the revert
   guard refuses `[blackbox]` commits) is enforced in `tools.ts` and is sacred.
   IQ retrieves; it does not write vault memory.

3. **No new npm dependencies.** Call each IQ over REST via raw `fetch` — not an
   Azure SDK. Credentials via env vars (e.g. `FOUNDRY_IQ_ENDPOINT/KEY`,
   `FABRIC_IQ_*`, `WORK_IQ_*`). The server MUST still boot and the vault loop
   MUST still work if those vars are unset — IQ degrades gracefully; the
   governed loop never depends on an IQ being reachable.

4. **Tag provenance.** Vault results keep `source: vault`; each IQ result
   carries its own `source`. A judge (and the audit) must always be able to
   tell vault memory from external grounding.

5. **Re-validate after ANY server change:**
   ```
   node demo/seed-vault.mjs && node demo/smoke-test.mjs   # must exit 0
   ```
   plus the live arc against the tunnel:
   ```
   MCP_URL=https://<tunnel>/mcp node /tmp/scout-rehearsal.mjs   # 8 checks
   ```
   The rehearsal asserts `results[0].id` — it will catch a ranking regression
   if IQ leaks into the vault ordering. Don't skip it.

## The three IQs

- **Foundry IQ** — agentic knowledge retrieval over enterprise sources, backed
  by **Azure AI Search**. Attaches at the agent level via the Foundry
  **Knowledge** panel (zero server code — the cheapest eligibility path) and/or
  is callable as a retrieval endpoint. Needs an AI Search resource provisioned
  (watch for region/SKU capacity friction, like the gpt-4o deployment had).
- **Fabric IQ** — semantic / ontology + knowledge-graph layer over Microsoft
  Fabric data. Needs a Fabric workspace + semantic model.
- **Work IQ** — the M365 Copilot intelligence layer (memory built from emails,
  meetings, chats, documents). Needs Microsoft Graph / Copilot access.

## Grounding content — keep it ORTHOGONAL to the trap-email path

Ground the IQ layers on enterprise reference material that does **not**
duplicate the vault's `kn-payment-policy` or `skill-vendor-triage`. If IQ
returns the payment policy, Atlas may ground on IQ instead of the vault and
alter the validated trap-email behavior. Safe grounding content: a vendor
master list, a company handbook, an org directory — facts the vault doesn't own.

## Sequencing (deadline: record June 13, submit June 13 night)

- The governed loop records **without** IQ. Do not let IQ block recording.
- Land Foundry IQ first (cheapest — agent Knowledge panel). Add Fabric IQ and
  Work IQ as additive backends after.
- Once wired: add the IQ layer to `docs/architecture.svg` and one line to the
  project description in `docs/submission-package.md`.

## Known-good baseline at handoff

- HEAD `6d4a501`, fully pushed; working tree clean.
- `demo/smoke-test.mjs` passes (exit 0); full live arc validated through the
  Foundry tunnel (`swift-ant-xwd0l96`, URL `rsw9w69m-3000.usw2.devtunnels.ms`).
- No server code has been touched for IQ yet — `recall_knowledge` is exactly
  the version the demo depends on. Diff against `6d4a501` to see your changes.

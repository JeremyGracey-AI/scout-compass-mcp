# Path A runbook — wire Foundry IQ to Atlas

Goal: stand up a Foundry IQ knowledge base over **orthogonal** content and attach it
to Atlas as `knowledge_base_retrieve`. The agent definition, RemoteTool connection
template, and orthogonality rule already exist in the repo
(`foundry/agents/atlas-agent.json`, `foundry/connections/kb-mcp-connection.json`,
`docs/IQ_ORTHOGONALITY.md`). This runbook covers the Azure side + the fill-ins.

Time budget: ~30–45 min. Free AI Search tier + free agentic-retrieval token
allocation are enough for the demo.

## 0. Prerequisites

- An Azure subscription with permission to create resources.
- Your Foundry project (the one Atlas lives in) and a GPT-4o-class model deployment.
- The Compass MCP server reachable over HTTPS (the dev tunnel from `agent/foundry-setup.md`).

## 1. Provision Azure AI Search

Portal → Create resource → **Azure AI Search** → Free (or Basic) tier, same region
as your Foundry project if possible (avoids cross-region friction). Note the
service URL: `https://<svc>.search.windows.net`.

```bash
# CLI equivalent
az search service create -n <svc> -g <rg> --sku free -l <region>
```

## 2. Create knowledge source(s) from the orthogonal content

Smallest-friction path is a **`file`** knowledge source — upload the files in
`foundry/knowledge-sources/` directly (no blob account needed):

- `company-handbook.md`
- `vendor-master.csv`
- `org-directory.csv`

Portal → your project → **Build → Knowledge → Add knowledge source → Files**.
Name it `atlas-handbook-ks` (or one source per file). Let it chunk + vectorize.

> Ingestion hygiene (load-bearing): do **not** add payment-policy or
> vendor-triage text. Those stay vault-only (`kn-payment-policy`,
> `skill-vendor-triage`). See `foundry/knowledge-sources/README.md`.

## 3. Create the knowledge base

Portal → **Knowledge → Create knowledge base** → name it `scout-compass-kb` →
add the source(s) from step 2. Set **retrieval reasoning effort = minimal** (or
low) for the demo: minimal is extractive, cheapest, and needs no extra LLM
planning — fine for returning grounding passages.

## 4. Fill the connection + wire it

The KB exposes an MCP endpoint:

```
https://<svc>.search.windows.net/knowledgebases/scout-compass-kb/mcp?api-version=2026-05-01-preview
```

Set that as `${KB_MCP_ENDPOINT_URL}` when you create the project connection from
`foundry/connections/kb-mcp-connection.json`:

```bash
az ml connection create --file foundry/connections/kb-mcp-connection.json \
  --resource-group <rg> --workspace-name <project> \
  --set target="https://<svc>.search.windows.net/knowledgebases/scout-compass-kb/mcp?api-version=2026-05-01-preview"
```

Then grant the **project managed identity** the **Search Index Data Reader** role
on the search service (read-only — not Contributor):

```bash
az role assignment create --assignee <project-MI-objectId> \
  --role "Search Index Data Reader" \
  --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Search/searchServices/<svc>
```

Atlas (`foundry/agents/atlas-agent.json`) already references this connection with
`allowed_tools: ["knowledge_base_retrieve"]` and the labeled-sections rule — no
edit needed for the Foundry-managed path. Reload the agent so it picks up the tool.

## 5. (Path B) point the server-side tool at the same KB

So `ground_foundry_iq` works too ("keep both, labeled"), set these on the Compass
server (see `server/.env.example`) using a **read-only query key**:

```bash
export FOUNDRY_IQ_ENDPOINT="https://<svc>.search.windows.net"
export FOUNDRY_IQ_KEY="<query-key>"          # az search query-key list ...
export FOUNDRY_IQ_KB="scout-compass-kb"
# optional: FOUNDRY_IQ_KS=atlas-handbook-ks FOUNDRY_IQ_KS_KIND=file
```

Rebuild/restart the server. `tools/list` now returns **10** tools (the 10th is
`ground_foundry_iq`); with the vars unset it returns the original **9**.

## 6. Validate (do NOT skip)

1. **Orthogonality still holds — trap email:** run the protocol in
   `agent/foundry-setup.md` ≥3×. The new decision must still log `citations: []`
   and confidence ≲ 0.6. If IQ ever returns payment-policy-like content, tighten
   the ingested content — never the server code.
2. **Sanity:** ask Atlas a handbook/vendor/org question — it should answer under a
   `### From knowledge base (...)` section with `[kb:]` / `[iq:]` citations, kept
   separate from any `### From vault` section.
3. **Server loop unchanged:**
   ```
   node demo/seed-vault.mjs && node demo/smoke-test.mjs   # exit 0
   MCP_URL=https://<tunnel>/mcp node /tmp/scout-rehearsal.mjs
   ```
   Note: if the rehearsal asserts a tool **count** of 9, bump it to 10 when IQ is
   configured (the ranking assertion on `results[0].id` is unaffected — IQ never
   enters the vault array).

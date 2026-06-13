# IQ / Vault Orthogonality Rule

**Status:** Load-bearing — do not relax without a full audit of Atlas's system prompt.

## The rule

Atlas exposes two retrieval tools:

| Tool | Source | Citation prefix |
|------|--------|-----------------|
| `recall_knowledge` | Compass vault | `[vault: ...]` |
| `knowledge_base_retrieve` | Azure AI Search KB (via `scout-compass-kb-mcp` RemoteTool) | `[kb: ...]` |

These tools' results **must appear in separate, labeled sections** in every Atlas response.
They must **never** be merged, blended, re-ranked together, or allowed to suppress each other.

## Why this is load-bearing

The KB MCP connection has no content-level filter that prevents IQ answers from
resembling vault content. The only guardrails are:

1. **Orthogonal content design** — the KB index contains institutional/IQ content that
   does not duplicate vault documents. Keep them topically separate at ingestion time.
2. **Atlas system-prompt instructions** — the labeled-sections rule in the agent definition
   (`foundry/agents/atlas-agent.json`) is the enforcement mechanism at inference time.

If either guardrail weakens, IQ answers can silently override vault results. This document
exists so that changes to the agent instructions or the KB ingestion pipeline require an
explicit acknowledgement of this risk.

## Enforcement checklist (review on any Atlas instruction change)

- [ ] `recall_knowledge` results still appear under `### From vault (recall_knowledge)`
- [ ] `knowledge_base_retrieve` results still appear under `### From knowledge base (knowledge_base_retrieve)`
- [ ] No instruction tells Atlas to "use whichever result is more relevant" across tools
- [ ] No instruction tells Atlas to deduplicate across tools
- [ ] KB index content does not duplicate vault document content (ingestion hygiene)

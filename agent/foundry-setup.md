# Wiring Atlas in Microsoft Foundry (and the fallback)

Step-by-step for connecting the Scout Compass MCP server to a Foundry agent.
The server must already be reachable over HTTPS (dev tunnel) — verify first:

```bash
curl https://<tunnel-host>/healthz          # → {"ok":true,...}
curl -X POST https://<tunnel-host>/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'   # → 9 tools
```

## Portal steps

1. Foundry portal → your project → **Agents** → create agent, name it **Atlas**.
2. Model: a **GPT-4o-class deployment** (create one under Deployments first if needed).
3. **Instructions:** paste `agent/atlas-instructions.md` **verbatim** — the whole
   file body below the `---` separator. Do not paraphrase; the citation-honesty
   wording (#3) is calibrated.
4. **Tools → Add → MCP (remote)**:
   - Server URL: `https://<tunnel-host>/mcp`
   - Transport: streamable HTTP, no auth (tunnel is anonymous for the demo window)
   - Approve all 9 tools if the portal asks for per-tool consent.
5. Sanity ping in the playground: "List your tools." Atlas should name all nine
   (recall_knowledge, get_skill, log_decision, run_audit, list_proposals,
   approve_proposal, reject_proposal, revert_memory, memory_log).

If the connection fails: the client must send
`Accept: application/json, text/event-stream`; the server is stateless
(`sessionIdGenerator: undefined`). Re-test with the curl above to isolate
tunnel vs. Foundry.

## Trap-email test protocol (run BEFORE recording — at least 3 times)

The single highest-risk behavior: **Atlas must log honestly-empty citations
when it freelances.** Per run:

1. Reseed: `node demo/seed-vault.mjs` (kills run-to-run contamination).
2. Paste the email body from `demo/trap-email.md` into the playground.
3. Check the vault: the new decision in `vault/decisions/` must have
   `citations: []` (or near-empty) and confidence ≲ 0.6.

- **If Atlas pads citations with real note ids it didn't follow:** tighten
  instruction #3 in `atlas-instructions.md` — e.g. append *"citing a note you
  did not actually retrieve and follow is a contract violation worse than an
  empty list."* Iterate on instructions only — NEVER on server code.
- **If Atlas invents fake ids:** they surface in the decision as
  `citations_unresolved` — that is the audit story working. Narrate it on
  camera rather than fighting it.

Then complete the loop once end-to-end: operator asks for an audit →
3 findings → approve → re-run the email → Atlas follows the promoted skill
→ `needs_human`, citing the new skill id.

## Fallback: Claude Desktop over stdio (decision gate June 13 only)

If Foundry's remote-MCP path can't be stabilized, record the demo with
Claude Desktop as the agent — the governed loop is identical. Add to
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scout-compass": {
      "command": "node",
      "args": ["/Users/jghome/GitHub/scout-compass/server/dist/index.js"],
      "env": {
        "VAULT_PATH": "/Users/jghome/GitHub/scout-compass/vault"
      }
    }
  }
}
```

Restart Claude Desktop, confirm the 9 tools appear, and paste the contract
section of `atlas-instructions.md` as the first message of the conversation
(it is client-agnostic — nothing in it is Foundry-specific).

If the fallback is what's on camera, add one honest line to the README, e.g.:

> The demo video uses Claude Desktop as the MCP client; the Foundry "Atlas"
> wiring shown in the architecture diagram is documented in
> `agent/foundry-setup.md` and works against the same server unchanged.

Keep the Foundry wiring in the diagram and this file either way — the server
is client-agnostic by design, and that's a feature, not an apology.

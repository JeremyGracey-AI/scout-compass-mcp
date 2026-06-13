/**
 * ground.ts — read-only IQ grounding tools (ADDITIVE and ISOLATED from the vault).
 *
 * Why this file exists, and the invariants it must never break (see
 * docs/iq-integration-brief.md and docs/IQ_ORTHOGONALITY.md):
 *
 *   1. ISOLATION — grounding lives in its own tool(s). It is NEVER merged into
 *      recall_knowledge's scored `results` array. tools.ts is not touched, so
 *      `results[0]` (the promoted-skill ranking the demo depends on) is
 *      byte-for-byte unchanged.
 *   2. READ-ONLY — these tools only retrieve. There is no write path into
 *      skills/ or knowledge/. IQ is grounding, never vault memory.
 *   3. NO NEW NPM DEPS — Foundry IQ is called over plain REST with the Node
 *      global `fetch` (Node 18+). No Azure SDK. Credentials come from env vars.
 *   4. GRACEFUL DEGRADATION — if the env vars are unset, the tool is not even
 *      registered (the governed loop stays exactly 9 tools); if the backend is
 *      unreachable, the handler returns an error payload and never throws. The
 *      vault loop must work with or without IQ.
 *   5. PROVENANCE — every result is tagged `source: "foundry-iq"` so a judge
 *      (and the audit) can always tell external grounding from vault memory.
 *
 * Foundry IQ = an Azure AI Search "knowledge base" (one or more knowledge
 * sources) queried via the agentic-retrieval `/retrieve` action. We ground on
 * content ORTHOGONAL to the trap-email path (vendor master list, handbook, org
 * directory) — never the vault's payment policy — so IQ can't alter the
 * validated behavior.
 *
 * Extension seam: Fabric IQ and Work IQ are additive siblings. Add
 * `ground_fabric_iq` / `ground_work_iq` here the same way (own env vars, own
 * source tag); do not fold them into the vault tools.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const text = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const FOUNDRY_IQ_TIMEOUT_MS = 8000;
const DEFAULT_API_VERSION = "2026-05-01-preview";

interface IqReference {
  source: "foundry-iq";
  ref_id: string | null;
  title: string | null;
  excerpt: string | null;
  knowledge_source: string | null;
}

interface IqGroundingResult {
  source: "foundry-iq";
  available: boolean;
  results: IqReference[];
  instruction?: string;
  note?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clip(value: string | null, max: number): string | null {
  return value === null ? null : value.slice(0, max);
}

/**
 * Defensive parse: the retrieve response shape varies by api-version and by
 * knowledge-source kind, and `sourceData` fields are user-configured. Pull a
 * `references` array if present; otherwise fall back to the synthesized
 * response text. Never throw on shape drift.
 */
function extractReferences(data: unknown): IqReference[] {
  const out: IqReference[] = [];
  const root = isRecord(data) ? data : {};
  const result = isRecord(root.result) ? root.result : {};
  const refs = Array.isArray(root.references)
    ? root.references
    : Array.isArray(result.references)
      ? result.references
      : [];

  for (const raw of refs) {
    if (!isRecord(raw)) continue;
    const sourceData = isRecord(raw.sourceData) ? raw.sourceData : {};
    const excerpt =
      asString(raw.content) ??
      asString(sourceData.content) ??
      asString(sourceData.text) ??
      asString(raw.text);
    out.push({
      source: "foundry-iq",
      ref_id: asString(raw.id) ?? asString(raw.docKey) ?? asString(raw.referenceId),
      title: asString(sourceData.title) ?? asString(raw.title),
      excerpt: clip(excerpt, 280),
      knowledge_source: asString(raw.knowledgeSourceName) ?? asString(raw.sourceName),
    });
  }

  if (out.length === 0) {
    // Fallback: a synthesized answer (messages-style) when no references array.
    const response = root.response;
    let synthesized: string | null = null;
    if (Array.isArray(response) && isRecord(response[0])) {
      const content = response[0].content;
      if (Array.isArray(content) && isRecord(content[0])) {
        synthesized = asString(content[0].text);
      }
    } else if (typeof response === "string") {
      synthesized = response;
    }
    if (synthesized !== null) {
      out.push({
        source: "foundry-iq",
        ref_id: null,
        title: null,
        excerpt: clip(synthesized, 600),
        knowledge_source: null,
      });
    }
  }

  return out;
}

async function foundryIqRetrieve(query: string): Promise<IqGroundingResult> {
  const endpoint = process.env.FOUNDRY_IQ_ENDPOINT?.replace(/\/+$/, "");
  const key = process.env.FOUNDRY_IQ_KEY;
  const kb = process.env.FOUNDRY_IQ_KB;

  // Registration is gated on FOUNDRY_IQ_ENDPOINT, but re-check all three so a
  // partial config degrades to a clear message instead of a bad request.
  if (!endpoint || !key || !kb) {
    return {
      source: "foundry-iq",
      available: false,
      results: [],
      note: "Foundry IQ not fully configured (need FOUNDRY_IQ_ENDPOINT, FOUNDRY_IQ_KEY, FOUNDRY_IQ_KB) — grounding skipped.",
    };
  }

  const apiVersion = process.env.FOUNDRY_IQ_API_VERSION ?? DEFAULT_API_VERSION;
  const url = `${endpoint}/knowledgebases/${encodeURIComponent(kb)}/retrieve?api-version=${apiVersion}`;
  const ksName = process.env.FOUNDRY_IQ_KS;
  const ksKind = process.env.FOUNDRY_IQ_KS_KIND ?? "file";

  const body: Record<string, unknown> = {
    messages: [{ role: "user", content: [{ type: "text", text: query }] }],
  };
  if (ksName) {
    body.knowledgeSourceParams = [
      {
        knowledgeSourceName: ksName,
        kind: ksKind,
        includeReferences: true,
        includeReferenceSourceData: true,
        failOnError: false, // favor availability — a flaky source returns partial, not an error
        maxOutputDocuments: 5,
      },
    ];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FOUNDRY_IQ_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": key }, // read-only QUERY key, not admin
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        source: "foundry-iq",
        available: false,
        results: [],
        error: `Foundry IQ retrieve failed: ${res.status} ${res.statusText}`,
      };
    }
    const data: unknown = await res.json();
    return {
      source: "foundry-iq",
      available: true,
      results: extractReferences(data),
      instruction:
        "External grounding ONLY — this is NOT vault memory. Present these under a section " +
        "labeled 'From knowledge base (Foundry IQ)' with [iq: <ref_id>] citations, kept separate " +
        "from recall_knowledge's [vault: ...] section. Never merge, re-rank, or deduplicate across " +
        "the two, and never cite a foundry-iq ref_id as a vault note in log_decision.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return {
      source: "foundry-iq",
      available: false,
      results: [],
      error: `Foundry IQ unreachable: ${message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers read-only IQ grounding tools — but ONLY when configured. With
 * FOUNDRY_IQ_ENDPOINT unset, nothing is registered and the server exposes
 * exactly the 9 governed-loop tools, identical to the pre-IQ baseline.
 * Returns the names of any tools registered (for optional startup logging).
 */
export function registerGroundingTools(server: McpServer): string[] {
  if (!process.env.FOUNDRY_IQ_ENDPOINT) return [];

  server.registerTool(
    "ground_foundry_iq",
    {
      description:
        "READ-ONLY external grounding via Microsoft Foundry IQ (an Azure AI Search knowledge base). " +
        "Returns institutional reference facts — e.g. a vendor master list, company handbook, or org " +
        "directory — tagged source:foundry-iq. This is grounding, NOT vault memory: keep its results in " +
        "a separate labeled section, never merge them with recall_knowledge, and never cite its ids as " +
        "vault notes in log_decision. Degrades gracefully when the backend is unset or unreachable.",
      inputSchema: {
        query: z.string().describe("Keywords or a question to ground against enterprise reference data"),
      },
    },
    async ({ query }) => text(await foundryIqRetrieve(query)),
  );

  return ["ground_foundry_iq"];
}

/**
 * ground.ts — read-only IQ grounding tools (ADDITIVE and ISOLATED from the vault).
 *
 * Exposes up to three Microsoft IQ grounding tools, each a thin wrapper over one
 * shared, raw-fetch retrieval core:
 *   - ground_foundry_iq  → Foundry IQ        (Azure AI Search knowledge base)
 *   - ground_fabric_iq   → Fabric IQ         (Fabric ontology / semantic model)
 *   - ground_work_iq     → Work IQ           (M365 Copilot organizational context)
 *
 * Invariants this file must never break (docs/iq-integration-brief.md,
 * docs/IQ_ORTHOGONALITY.md):
 *
 *   1. ISOLATION — grounding lives in its own tool(s); never merged into
 *      recall_knowledge's scored `results` array. tools.ts is untouched, so
 *      `results[0]` (the promoted-skill ranking the demo depends on) is unchanged.
 *   2. READ-ONLY — retrieve only. No write path into skills/ or knowledge/.
 *   3. NO NEW NPM DEPS — Node global `fetch`, no Azure SDK. Creds via env vars.
 *   4. GRACEFUL DEGRADATION — a tool is registered ONLY when its backend is
 *      configured; with nothing set the server exposes exactly the 9 governed-loop
 *      tools. An unreachable backend returns an error payload and never throws.
 *   5. PROVENANCE — every result is tagged with its source (foundry-iq | fabric-iq
 *      | work-iq) so a judge (and the audit) can always tell grounding from memory.
 *
 * Federation model: Fabric IQ and Work IQ are reachable as knowledge sources of a
 * Foundry IQ knowledge base (kinds `fabricOntology`/`fabricDataAgent`, `workIQ`).
 * So by default the siblings reuse FOUNDRY_IQ_ENDPOINT/KEY/KB and just pin their
 * own knowledge-source name (FABRIC_IQ_KS / WORK_IQ_KS). Each may instead point at
 * its own search service via its own *_ENDPOINT/_KEY/_KB. Ground each IQ on content
 * ORTHOGONAL to the trap-email path — never the vault's payment policy.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const text = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

const TIMEOUT_MS = 8000;
const DEFAULT_API_VERSION = "2026-05-01-preview";

interface IqReference {
  source: string;
  ref_id: string | null;
  title: string | null;
  excerpt: string | null;
  knowledge_source: string | null;
}

interface IqGroundingResult {
  source: string;
  available: boolean;
  results: IqReference[];
  instruction?: string;
  note?: string;
  error?: string;
}

/** Static description of one IQ backend; resolved against env at registration. */
interface BackendSpec {
  tool: string;
  prefix: string; // env prefix, e.g. "FABRIC_IQ"
  source: string; // provenance tag
  citePrefix: string; // citation label, e.g. "fabric"
  sectionLabel: string; // response section label
  defaultKind: string; // knowledge-source kind
  requireKs: boolean; // remote IQ sources must be pinned by name
  description: string;
}

interface ResolvedBackend extends BackendSpec {
  endpoint: string | null;
  key: string | null;
  kb: string | null;
  apiVersion: string;
  ksName: string | null;
  ksKind: string;
  userToken: string | null; // optional x-ms-query-source-authorization (per-user ACL sources)
}

const SPECS: BackendSpec[] = [
  {
    tool: "ground_foundry_iq",
    prefix: "FOUNDRY_IQ",
    source: "foundry-iq",
    citePrefix: "iq",
    sectionLabel: "knowledge base (Foundry IQ)",
    defaultKind: "file",
    requireKs: false, // a KB can query all its sources without pinning one
    description:
      "READ-ONLY grounding via Microsoft Foundry IQ (an Azure AI Search knowledge base). " +
      "Returns institutional reference facts — vendor master list, company handbook, org " +
      "directory — tagged source:foundry-iq.",
  },
  {
    tool: "ground_fabric_iq",
    prefix: "FABRIC_IQ",
    source: "fabric-iq",
    citePrefix: "fabric",
    sectionLabel: "Fabric IQ (ontology)",
    defaultKind: "fabricOntology", // or fabricDataAgent via FABRIC_IQ_KS_KIND
    requireKs: true,
    description:
      "READ-ONLY grounding via Microsoft Fabric IQ — business entities, relationships, and " +
      "metrics from a Fabric ontology / semantic model (OneLake, Power BI), tagged " +
      "source:fabric-iq. Use for modeled business data (accounts, products, KPIs), not vault memory.",
  },
  {
    tool: "ground_work_iq",
    prefix: "WORK_IQ",
    source: "work-iq",
    citePrefix: "work",
    sectionLabel: "Work IQ (M365)",
    defaultKind: "workIQ",
    requireKs: true,
    description:
      "READ-ONLY grounding via Microsoft Work IQ — organizational context from M365 (people, " +
      "meetings, documents, chats) via Microsoft Graph/Copilot, tagged source:work-iq. " +
      "Permission-aware: set WORK_IQ_USER_TOKEN to enforce per-user ACLs. Not vault memory.",
  },
];

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

/** Resolve a backend from its env prefix, falling back to FOUNDRY_IQ_* for the shared KB. */
function resolve(spec: BackendSpec): ResolvedBackend {
  const p = spec.prefix;
  return {
    ...spec,
    endpoint: env(`${p}_ENDPOINT`) ?? env("FOUNDRY_IQ_ENDPOINT") ?? null,
    key: env(`${p}_KEY`) ?? env("FOUNDRY_IQ_KEY") ?? null,
    kb: env(`${p}_KB`) ?? env("FOUNDRY_IQ_KB") ?? null,
    apiVersion: env(`${p}_API_VERSION`) ?? env("FOUNDRY_IQ_API_VERSION") ?? DEFAULT_API_VERSION,
    ksName: env(`${p}_KS`) ?? null,
    ksKind: env(`${p}_KS_KIND`) ?? spec.defaultKind,
    userToken: env(`${p}_USER_TOKEN`) ?? null,
  };
}

/** A backend is enabled when it can form a valid request (and is pinned, if remote). */
function isEnabled(b: ResolvedBackend): boolean {
  return Boolean(b.endpoint && b.key && b.kb && (!b.requireKs || b.ksName));
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
 * Defensive parse: retrieve response shape varies by api-version and source kind,
 * and `sourceData` fields are user-configured. Pull a `references` array if present;
 * else fall back to synthesized response text. Never throw on shape drift.
 */
function extractReferences(data: unknown, source: string): IqReference[] {
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
      asString(sourceData.snippet) ?? // actual content in 2026-05-01-preview references
      asString(raw.content) ??
      asString(sourceData.content) ??
      asString(sourceData.text) ??
      asString(raw.text);
    out.push({
      source,
      ref_id: asString(raw.id) ?? asString(raw.docKey) ?? asString(raw.referenceId),
      title: asString(raw.docName) ?? asString(sourceData.title) ?? asString(raw.title),
      excerpt: clip(excerpt, 2400),
      knowledge_source:
        asString(raw.knowledgeSourceName) ?? asString(raw.sourceName) ?? asString(raw.docName) ?? asString(raw.type),
    });
  }

  if (out.length === 0) {
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
      out.push({ source, ref_id: null, title: null, excerpt: clip(synthesized, 600), knowledge_source: null });
    }
  }

  return out;
}

async function retrieve(query: string, b: ResolvedBackend): Promise<IqGroundingResult> {
  if (!isEnabled(b)) {
    return {
      source: b.source,
      available: false,
      results: [],
      note: `${b.source} not fully configured (need ${b.prefix}_* or FOUNDRY_IQ_* endpoint/key/kb${b.requireKs ? ` and ${b.prefix}_KS` : ""}) — grounding skipped.`,
    };
  }

  const url = `${b.endpoint!.replace(/\/+$/, "")}/knowledgebases/${encodeURIComponent(b.kb!)}/retrieve?api-version=${b.apiVersion}`;
  // Knowledge bases at "minimal" retrieval reasoning effort (our config — cheapest,
  // no LLM query planner, deterministic) take `intents`, not `messages`; each intent
  // is { type: "semantic", search }. (messages input requires low/medium effort.)
  const body: Record<string, unknown> = {
    intents: [{ type: "semantic", search: query }],
  };
  if (b.ksName) {
    body.knowledgeSourceParams = [
      {
        knowledgeSourceName: b.ksName,
        kind: b.ksKind,
        includeReferences: true,
        includeReferenceSourceData: true,
        failOnError: false, // favor availability — a flaky source returns partial, not an error
        // maxOutputDocuments omitted: the API rejects values <50; the default is fine.
      },
    ];
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", "api-key": b.key! };
  if (b.userToken) headers["x-ms-query-source-authorization"] = b.userToken; // per-user ACL (Work IQ, remote SharePoint)

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      return { source: b.source, available: false, results: [], error: `${b.source} retrieve failed: ${res.status} ${res.statusText}` };
    }
    const data: unknown = await res.json();
    return {
      source: b.source,
      available: true,
      results: extractReferences(data, b.source),
      instruction:
        `External grounding ONLY — this is NOT vault memory. Present under a section labeled ` +
        `'### From ${b.sectionLabel}' with [${b.citePrefix}: <ref_id>] citations, separate from ` +
        `recall_knowledge's [vault: ...] section. Never merge, re-rank, or deduplicate across tools, ` +
        `and never cite a ${b.source} ref as a vault note in log_decision.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return { source: b.source, available: false, results: [], error: `${b.source} unreachable: ${message}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Names of the grounding tools that would register under the current env (for startup logging). */
export function groundingSummary(): string {
  const on = SPECS.map(resolve).filter(isEnabled).map((b) => b.source);
  return on.length ? `IQ grounding: ${on.join(" + ")}` : "IQ grounding: off";
}

/**
 * Registers each IQ grounding tool whose backend is configured. With none set,
 * registers nothing — the server exposes exactly the 9 governed-loop tools,
 * identical to the pre-IQ baseline. Returns the names registered.
 */
export function registerGroundingTools(server: McpServer): string[] {
  const registered: string[] = [];
  for (const spec of SPECS) {
    const backend = resolve(spec);
    if (!isEnabled(backend)) continue;
    server.registerTool(
      spec.tool,
      {
        description:
          spec.description +
          " Keep its results in a separate labeled section, never merge them with recall_knowledge, " +
          "and never cite its ids as vault notes in log_decision. Degrades gracefully when unset or unreachable.",
        inputSchema: {
          query: z.string().describe("Keywords or a question to ground against enterprise reference data"),
        },
      },
      async ({ query }: { query: string }) => text(await retrieve(query, backend)),
    );
    registered.push(spec.tool);
  }
  return registered;
}

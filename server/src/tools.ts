/**
 * tools.ts — the MCP tool surface.
 *
 * GOVERNANCE INVARIANT (enforced here, not by prompt):
 *   The agent's ONLY write paths are log_decision and run_audit (which drafts
 *   proposals). Promotion into skills/ or knowledge/ happens exclusively via
 *   approve_proposal — the human gate. There is no tool that lets the agent
 *   edit active memory directly.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Vault } from "./vault.js";
import { VaultGit, withVaultLock } from "./git.js";
import { runAudit } from "./audit.js";

const now = () => new Date().toISOString();
const text = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
});

export function registerTools(server: McpServer, vault: Vault, git: VaultGit): void {
  server.registerTool(
    "recall_knowledge",
    {
      description:
        "Search the vault's knowledge notes and skills by keyword. ALWAYS call this before acting on a task. Returns note ids to cite in log_decision.",
      inputSchema: { query: z.string().describe("Keywords describing the task or topic") },
    },
    async ({ query }) => {
      const hits = vault.recall(query);
      return text({
        results: hits.map(({ note, score }) => ({
          id: note.id,
          type: note.type,
          title: note.title,
          score,
          excerpt: note.body.slice(0, 280),
        })),
        instruction:
          hits.length === 0
            ? "No relevant knowledge found. You may proceed, but log_decision with citations: [] (be honest) and lower confidence."
            : "If a skill is relevant, call get_skill and follow its procedure. Cite every id you rely on.",
      });
    },
  );

  server.registerTool(
    "get_skill",
    {
      description: "Fetch the full body of a skill by id so you can follow its procedure.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const note = vault.get(id);
      if (!note || note.type !== "skill") return text({ error: `No skill with id ${id}` });
      return text({ id: note.id, status: note.data.status, body: note.body });
    },
  );

  server.registerTool(
    "log_decision",
    {
      description:
        "REQUIRED after every task: write an immutable decision record (the blackbox). Be honest about citations and confidence — empty citations are allowed and will be audited.",
      inputSchema: {
        task: z.string().describe("One-line description of the task"),
        trigger: z.enum(["user_request", "schedule", "event"]),
        plan: z.string().describe("Numbered plan steps you followed"),
        citations: z.array(z.string()).describe("Ids of knowledge/skills actually relied on. Empty if none."),
        actions: z.string().describe("What you actually did"),
        outcome: z.enum(["completed", "failed", "needs_human"]),
        confidence: z.number().min(0).max(1),
      },
    },
    async ({ task, trigger, plan, citations, actions, outcome, confidence }) => withVaultLock(async () => {
      const ts = now();
      const id = vault.nextId("dec");
      // Citations are server-verified: ids that don't resolve to a real note
      // are recorded as unresolved (never silently dropped — honesty is the product).
      const unresolved = citations.filter((c) => !vault.get(c));
      const body = [
        `# Decision: ${task}`,
        ``,
        `## Plan`,
        plan,
        ``,
        `## Evidence consulted`,
        citations.length ? citations.map((c) => `- [[${c}]]`).join("\n") : "(none — no knowledge cited)",
        ``,
        `## Actions taken`,
        actions,
        ``,
        `## Outcome`,
        `${outcome} (confidence ${confidence})`,
      ].join("\n");
      const rel = vault.write("decision", id, {
        agent: "atlas",
        task,
        trigger,
        citations,
        ...(unresolved.length ? { citations_unresolved: unresolved } : {}),
        outcome,
        confidence,
        timestamp: ts,
      }, body);
      const cited = vault.markCited(citations, ts);
      const sha = await git.commit(
        "blackbox",
        `${id}: ${task} (confidence ${confidence}, ${citations.length} citations)`,
        [rel, ...cited],
      );
      return text({
        decision_id: id,
        commit: sha,
        ...(unresolved.length
          ? { warning: `Citations did not resolve to any note: ${unresolved.join(", ")} — recorded as unresolved.` }
          : {}),
      });
    }),
  );

  server.registerTool(
    "run_audit",
    {
      description:
        "Run Compass audit heuristics over all decision records. Flags uncited decisions (and drafts skill proposals for them), stale skills, and low-confidence repeats.",
      inputSchema: {},
    },
    async () => withVaultLock(async () => {
      const ts = now();
      const { findings, reportRelPath, proposalRelPaths } = runAudit(vault, ts);
      const sha = await git.commit(
        "compass",
        `audit: ${findings.length} finding(s), ${proposalRelPaths.length} proposal(s) drafted`,
        [reportRelPath, ...proposalRelPaths],
      );
      return text({ findings, report: reportRelPath, commit: sha });
    }),
  );

  server.registerTool(
    "list_proposals",
    { description: "List Compass proposals awaiting human review.", inputSchema: {} },
    async () =>
      text({
        proposals: vault.list("proposal").map((p) => ({
          id: p.id,
          title: p.title,
          rationale: p.data.rationale,
          evidence: p.data.evidence,
        })),
      }),
  );

  server.registerTool(
    "approve_proposal",
    {
      description:
        "HUMAN GATE: promote a proposal into active skills/knowledge. Only call this when the human operator has explicitly approved in this conversation.",
      inputSchema: { id: z.string(), approved_by: z.string().describe("Name of the human who approved") },
    },
    async ({ id, approved_by }) => withVaultLock(async () => {
      const prop = vault.get(id);
      if (!prop || prop.type !== "proposal") return text({ error: `No proposal with id ${id}` });
      const rel = vault.promote(prop);
      const sha = await git.commit("human", `approve ${id} → ${rel} (by ${approved_by})`, [rel, prop.relPath]);
      return text({ promoted_to: rel, commit: sha });
    }),
  );

  server.registerTool(
    "reject_proposal",
    {
      description: "HUMAN GATE: reject and delete a proposal, with a reason.",
      inputSchema: { id: z.string(), reason: z.string() },
    },
    async ({ id, reason }) => withVaultLock(async () => {
      const rel = vault.remove(id);
      if (!rel) return text({ error: `No proposal with id ${id}` });
      const sha = await git.commit("human", `reject ${id}: ${reason}`, [rel]);
      return text({ rejected: id, commit: sha });
    }),
  );

  server.registerTool(
    "revert_memory",
    {
      description:
        "HUMAN GATE: git-revert a memory commit (a [compass] proposal or [human] approval). " +
        "Decision records are append-only: [blackbox] commits cannot be reverted, even by a human — " +
        "behavior is revertible, history is not.",
      inputSchema: { commit_sha: z.string() },
    },
    async ({ commit_sha }) => withVaultLock(async () => {
      const subject = await git.subject(commit_sha);
      if (subject === null) return text({ error: `No such commit: ${commit_sha}` });
      if (subject.startsWith("[blackbox]")) {
        return text({
          error:
            "Refused: decision records are the flight recorder and are append-only — " +
            "the blackbox cannot be rewritten, even by a human. Revert the behavior " +
            "(a [compass] or [human] commit), never the history.",
          commit: subject,
        });
      }
      const newSha = await git.revert(commit_sha);
      return text({ reverted: commit_sha, revert_commit: newSha });
    }),
  );

  server.registerTool(
    "memory_log",
    { description: "Show the recent git history of the vault — the audit trail itself.", inputSchema: {} },
    async () => text({ log: await git.recentLog(15) }),
  );
}

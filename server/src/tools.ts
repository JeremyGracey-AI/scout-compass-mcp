/**
 * tools.ts — the MCP tool surface.
 *
 * GOVERNANCE INVARIANT (enforced in structure, not by prompt):
 *   The agent's ONLY write paths are log_decision and run_audit (which drafts
 *   proposals). There is NO tool that writes active memory: approve/reject are
 *   deliberately not MCP tools at all. Humans rule via bin/approve.mjs and
 *   bin/reject.mjs, which run as the human's own OS process — that process
 *   boundary is the gate — and the actor requirement itself lives in
 *   Vault.promote()/remove(), so any future caller hits the same gate.
 *
 * TEST HONESTY: every handler is part of the exported toolset returned by
 * createToolset(); registerTools() is a thin loop over that same object, so
 * tests can call the REAL code objects MCP serves (pass a pre-built toolset
 * to registerTools to make the identity airtight).
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

type ToolResult = { content: Array<{ type: "text"; text: string }> };

export interface ToolDef {
  description: string;
  inputSchema: z.ZodRawShape;
  /** The MCP SDK validates args against inputSchema before dispatch; direct
   *  test callers are responsible for passing schema-shaped args. */
  handler: (args: any) => Promise<ToolResult>;
}

/** The complete agent-facing toolset. What is not in here does not exist for the agent. */
export function createToolset(vault: Vault, git: VaultGit): Record<string, ToolDef> {
  return {
    recall_knowledge: {
      description:
        "Search the vault's knowledge notes and skills by keyword. ALWAYS call this before acting on a task. Returns note ids to cite in log_decision.",
      inputSchema: { query: z.string().describe("Keywords describing the task or topic") },
      handler: async ({ query }) => {
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
    },

    get_skill: {
      description: "Fetch the full body of a skill by id so you can follow its procedure.",
      inputSchema: { id: z.string() },
      handler: async ({ id }) => {
        const note = vault.get(id);
        if (!note || note.type !== "skill") return text({ error: `No skill with id ${id}` });
        return text({ id: note.id, status: note.data.status, body: note.body });
      },
    },

    log_decision: {
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
      handler: async ({ task, trigger, plan, citations, actions, outcome, confidence }) =>
        withVaultLock(async () => {
          const ts = now();
          const id = vault.nextId("dec");
          // Citations are server-verified: ids that don't resolve to a real note
          // are recorded as unresolved (never silently dropped — honesty is the product).
          const unresolved = (citations as string[]).filter((c) => !vault.get(c));
          const body = [
            `# Decision: ${task}`,
            ``,
            `## Plan`,
            plan,
            ``,
            `## Evidence consulted`,
            citations.length ? (citations as string[]).map((c) => `- [[${c}]]`).join("\n") : "(none — no knowledge cited)",
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
    },

    run_audit: {
      description:
        "Run Compass audit heuristics over all decision records. Flags uncited decisions (and drafts skill proposals for them), stale skills, and low-confidence repeats. Decisions a human already ruled on are never re-proposed.",
      inputSchema: {},
      handler: async () =>
        withVaultLock(async () => {
          const ts = now();
          const { findings, reportRelPath, proposalRelPaths } = runAudit(vault, ts);
          const sha = await git.commit(
            "compass",
            `audit: ${findings.length} finding(s), ${proposalRelPaths.length} proposal(s) drafted`,
            [reportRelPath, ...proposalRelPaths],
          );
          return text({ findings, report: reportRelPath, commit: sha });
        }),
    },

    list_proposals: {
      description:
        "List Compass proposals awaiting human review. Approval/rejection is NOT available here: the operator rules from their own terminal via bin/approve.mjs / bin/reject.mjs.",
      inputSchema: {},
      handler: async () =>
        text({
          proposals: vault.list("proposal").map((p) => ({
            id: p.id,
            title: p.title,
            rationale: p.data.rationale,
            evidence: p.data.evidence,
          })),
          instruction:
            "Present these to the operator. You cannot approve or reject them — the human runs bin/approve.mjs <id> --by <name> (or bin/reject.mjs) outside this conversation.",
        }),
    },

    revert_memory: {
      description:
        "HUMAN GATE: git-revert a memory commit (a [compass] proposal or [human] approval). " +
        "Decision records are append-only: [blackbox] commits cannot be reverted, even by a human — " +
        "behavior is revertible, history is not. The [seed] baseline / root commit is not " +
        "revertible either: reverting it deletes the whole vault rather than rolling back a behavior. " +
        "A revert that conflicts is rolled back (git revert --abort) and refused, never left in flight.",
      inputSchema: { commit_sha: z.string() },
      handler: async ({ commit_sha }) =>
        withVaultLock(async () => {
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
          // Baseline guard (2026-08-02 invigilation finding 2): reverting the
          // commit that CREATED the vault is not a behavior rollback — git
          // diffs a root commit against the empty tree, so the revert deletes
          // every note, then conflicts. Refused on either signal: the [seed]
          // subject convention, or the structural fact of having no parent.
          const rootless = await git.isRootCommit(commit_sha);
          if (subject.startsWith("[seed] ") || rootless) {
            return text({
              error:
                "Refused: this is the vault's baseline commit " +
                (rootless ? "(no parent — the root commit)" : "(a [seed] commit)") +
                ". Reverting it deletes the entire vault rather than rolling back a behavior; " +
                "it is also the commit that CREATED the append-only decision records, so " +
                "reverting it would erase history through the back door. Revert the specific " +
                "[compass] or [human] commit whose behavior you want undone.",
              commit: subject,
            });
          }
          try {
            const newSha = await git.revert(commit_sha);
            return text({ reverted: commit_sha, revert_commit: newSha });
          } catch (e) {
            // A conflicted revert left mid-flight leaves REVERT_HEAD and staged
            // deletions, and every later tool call then fails on commit until a
            // human runs `git revert --abort`. Roll it back, then throw a clean
            // error — the two refusals above are POLICY (a deliberate, expected
            // "no", so they answer as data); a conflict is a runtime FAILURE and
            // is signalled as one. Wording per [human] ruling 2026-08-02
            // (harness decisions/2026-08-02-week3-rulings.md:39-40), which also
            // keeps this hardening when revert moves to bin/revert.mjs, where a
            // throw is a nonzero exit.
            const aborted = await git.abortRevert();
            const dirty = await git.dirtyPaths();
            throw new Error(
              `Refused: reverting ${commit_sha} (${subject}) conflicted with the vault's ` +
                `current state and was rolled back — nothing was changed ` +
                `[revert --abort ${aborted ? "ran" : "was not needed / failed"}]. ` +
                `(${(e as Error).message.split("\n")[0]}) This usually means the commit's changes ` +
                `were already undone, or later commits touched the same files. Revert the most ` +
                `recent commit carrying the behavior instead.` +
                (dirty.length
                  ? ` WARNING: the vault working tree is NOT clean after the abort — a human ` +
                    `should inspect it: ${dirty.slice(0, 10).join("; ")}`
                  : ""),
            );
          }
        }),
    },

    memory_log: {
      description: "Show the recent git history of the vault — the audit trail itself.",
      inputSchema: {},
      handler: async () => text({ log: await git.recentLog(15) }),
    },
  };
}

/**
 * Thin registration wrapper: registers exactly the toolset, nothing else.
 * Tests may pass the same toolset object they call directly, so the handler
 * MCP serves and the handler under test are one code object.
 */
export function registerTools(
  server: McpServer,
  vault: Vault,
  git: VaultGit,
  toolset: Record<string, ToolDef> = createToolset(vault, git),
): void {
  for (const [name, def] of Object.entries(toolset)) {
    server.registerTool(name, { description: def.description, inputSchema: def.inputSchema }, def.handler);
  }
}

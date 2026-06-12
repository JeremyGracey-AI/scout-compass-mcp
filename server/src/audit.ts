/**
 * audit.ts — Compass heuristics v1. Exactly three, by design.
 *  1. uncited-decision  → re-run recall over the decision's task; the proposal
 *     cites the existing notes the agent failed to consult. The story is
 *     "the knowledge was in the vault; the agent skipped it; Compass closes
 *     the loop" — the draft is derived from real vault content, not invented.
 *  2. stale-skill       → flag skills never cited across recent decisions
 *  3. low-confidence-repeat → propose a knowledge-gap note
 */
import fs from "node:fs";
import path from "node:path";
import { Vault, type Note } from "./vault.js";

export interface Finding {
  heuristic: "uncited-decision" | "stale-skill" | "low-confidence-repeat";
  subject: string; // note id
  detail: string;
  proposal_id?: string;
}

const CONFIDENCE_FLOOR = 0.6;

export function runAudit(vault: Vault, now: string): { findings: Finding[]; reportRelPath: string; proposalRelPaths: string[] } {
  const decisions = vault.list("decision");
  const skills = vault.list("skill");
  const existingProposals = vault.list("proposal");
  const findings: Finding[] = [];
  const proposalRelPaths: string[] = [];

  const alreadyProposedFor = new Set(
    existingProposals.map((p) => String(p.data.evidence ?? "")),
  );

  // 1. Uncited decisions → skill proposal
  for (const dec of decisions) {
    const citations = Array.isArray(dec.data.citations) ? dec.data.citations : [];
    if (citations.length === 0 && !alreadyProposedFor.has(dec.id)) {
      const propId = vault.nextId("prop");
      const taskLine = String(dec.data.task ?? dec.title);
      // Re-run recall over the task the agent just performed: anything that
      // surfaces is knowledge that existed but went unconsulted.
      const overlooked = vault.recall(taskLine, 3);
      const overlookedTags = [
        ...new Set(overlooked.flatMap(({ note }) => (Array.isArray(note.data.tags) ? note.data.tags : []))),
      ];
      const rel = vault.write(
        "proposal",
        propId,
        {
          proposed_type: "skill",
          status: "proposed",
          rationale: "uncited-decision: agent acted with no knowledge or skill citations",
          evidence: dec.id,
          source_decisions: [dec.id],
          overlooked: overlooked.map(({ note }) => note.id),
          tags: overlookedTags,
          created: now,
        },
        [
          `# Proposed skill: ${taskLine}`,
          ``,
          `## Why Compass proposed this`,
          `Decision [[${dec.id}]] was executed with **zero citations** — the agent freelanced.`,
          ``,
          ...(overlooked.length
            ? [
                `## What the agent missed`,
                `Compass re-ran recall over the decision's task. These notes already existed and were never consulted:`,
                ...overlooked.map(({ note }) => `- [[${note.id}]] — ${note.title}`),
                ``,
                `## Draft procedure (HUMAN: edit before approving)`,
                `1. \`recall_knowledge\` for this task and consult the notes above before acting.`,
                `2. Verify the request against [[${overlooked[0].note.id}]].`,
                `3. If the request deviates from documented policy, or involves a vendor with no profile note, set outcome \`needs_human\` — do not commit on the human's behalf.`,
                `4. Cite every note relied on in \`log_decision\`.`,
              ]
            : [
                `## What the agent missed`,
                `Recall over the task found no matching notes — this looks like a true knowledge gap, not a skipped lookup.`,
                ``,
                `## Draft procedure (HUMAN: edit before approving)`,
                `1. \`recall_knowledge\` for this task; if nothing relevant returns, set outcome \`needs_human\`.`,
                `2. Ask the operator to add the missing policy or vendor note, then retry.`,
              ]),
          ``,
          `## Guardrail`,
          `If this situation deviates from documented policy, set outcome to \`needs_human\`.`,
        ].join("\n"),
      );
      proposalRelPaths.push(rel);
      findings.push({ heuristic: "uncited-decision", subject: dec.id, detail: `0 citations on "${taskLine}"`, proposal_id: propId });
    }
  }

  // 2. Stale skills
  for (const skill of skills) {
    if (Number(skill.data.cite_count ?? 0) === 0 && skill.data.status === "active") {
      findings.push({ heuristic: "stale-skill", subject: skill.id, detail: "active skill never cited — review or deprecate" });
    }
  }

  // 3. Low-confidence repeats (same trigger category, confidence < floor, >= 2 occurrences)
  const lowByTrigger = new Map<string, Note[]>();
  for (const dec of decisions) {
    const conf = Number(dec.data.confidence ?? 1);
    if (conf < CONFIDENCE_FLOOR) {
      const key = String(dec.data.trigger ?? "unknown");
      lowByTrigger.set(key, [...(lowByTrigger.get(key) ?? []), dec]);
    }
  }
  for (const [trigger, decs] of lowByTrigger) {
    if (decs.length >= 2) {
      findings.push({
        heuristic: "low-confidence-repeat",
        subject: decs.map((d) => d.id).join(", "),
        detail: `${decs.length} low-confidence decisions for trigger "${trigger}" — likely knowledge gap`,
      });
    }
  }

  // Write the report
  const reportId = `audit-${now.slice(0, 10)}-${Date.now() % 100000}`;
  const lines = [
    `---`,
    `id: ${reportId}`,
    `type: audit`,
    `timestamp: ${now}`,
    `decisions_reviewed: ${decisions.length}`,
    `findings: ${findings.length}`,
    `---`,
    ``,
    `# Compass audit — ${now}`,
    ``,
    ...(findings.length === 0
      ? ["No findings. All decisions cited, all skills exercised."]
      : findings.map(
          (f) =>
            `- **${f.heuristic}** → ${f.subject}: ${f.detail}${f.proposal_id ? ` → drafted [[${f.proposal_id}]]` : ""}`,
        )),
  ];
  const abs = path.join(vault.root, "compass", `${reportId}.md`);
  fs.writeFileSync(abs, lines.join("\n") + "\n");

  return { findings, reportRelPath: path.relative(vault.root, abs), proposalRelPaths };
}

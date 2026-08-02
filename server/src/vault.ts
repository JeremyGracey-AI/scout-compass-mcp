/**
 * vault.ts — the vault IS the database.
 * Obsidian-compatible Markdown files with YAML frontmatter.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export type NoteType = "decision" | "skill" | "knowledge" | "proposal";

export interface Note {
  id: string;
  type: NoteType;
  title: string;
  path: string; // absolute
  relPath: string; // relative to vault root
  data: Record<string, unknown>;
  body: string;
}

/**
 * One citation, as recorded by log_decision — the append-only ledger entry
 * behind compass/citations.jsonl (one JSON object per line).
 *
 * Field names are the `[human]` ruling's verbatim schema
 * (~/.claude/harness/decisions/2026-08-02-week3-rulings.md:17-18):
 * `{skill_id, decision_id, timestamp}`. `skill_id` holds ANY cited note id —
 * knowledge ids (`kn-…`) land here too. The name is the ruled schema and is
 * kept as ruled; renaming a human-ruled field is an escalation, not a worker
 * edit.
 */
export interface Citation {
  skill_id: string;
  decision_id: string;
  timestamp: string;
}

/**
 * A human ruling on a proposal — the append-only ledger entry behind
 * compass/rulings.json. The audit's dedupe consults this so a ruled-on
 * decision is never re-proposed, even after the proposal file is gone.
 */
export interface Ruling {
  decision_id: string;
  proposal_id: string;
  disposition: "approved" | "rejected";
  by: string;
  date: string;
  reason?: string;
}

const FOLDERS: Record<NoteType, string> = {
  decision: "decisions",
  skill: "skills",
  knowledge: "knowledge",
  proposal: "proposed",
};

export class Vault {
  constructor(public readonly root: string) {
    for (const dir of [...Object.values(FOLDERS), "compass"]) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
  }

  private readDir(type: NoteType): Note[] {
    const dir = path.join(this.root, FOLDERS[type]);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => this.readFile(path.join(dir, f)))
      .filter((n): n is Note => n !== null);
  }

  private readFile(abs: string): Note | null {
    try {
      const raw = fs.readFileSync(abs, "utf8");
      const parsed = matter(raw);
      const firstHeading = parsed.content.match(/^#\s+(.+)$/m)?.[1];
      return {
        id: String(parsed.data.id ?? path.basename(abs, ".md")),
        type: (parsed.data.type as NoteType) ?? "knowledge",
        title: firstHeading ?? String(parsed.data.id ?? path.basename(abs, ".md")),
        path: abs,
        relPath: path.relative(this.root, abs),
        data: parsed.data,
        body: parsed.content.trim(),
      };
    } catch {
      return null;
    }
  }

  list(type: NoteType): Note[] {
    return this.readDir(type);
  }

  get(id: string): Note | null {
    const all = (Object.keys(FOLDERS) as NoteType[]).flatMap((t) => this.readDir(t));
    return all.find((n) => n.id === id) ?? null;
  }

  /** Write a note; returns relative path (for git add). */
  write(type: NoteType, id: string, data: Record<string, unknown>, body: string): string {
    const slug = id.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    const abs = path.join(this.root, FOLDERS[type], `${slug}.md`);
    fs.writeFileSync(abs, matter.stringify(`\n${body.trim()}\n`, { id, type, ...data }));
    return path.relative(this.root, abs);
  }

  /** Relative path of the rulings ledger — include it in the [human] commit. */
  readonly rulingsRel = path.join("compass", "rulings.json");

  /**
   * All human rulings, oldest first. FAIL-CLOSED (2026-08-02 invigilation
   * finding 3): only an ABSENT file means "no rulings yet" — a legitimate first
   * run. A file that exists but does not parse into an array is a DAMAGED
   * ledger and throws, because the two ways it was previously swallowed into
   * `[]` are both destructive:
   *   - `runAudit` (audit.ts:39) dedupes on this list, so `[]` silently
   *     re-proposes every decision a human already ruled on;
   *   - `appendRuling` below rewrites the whole file from this list, so the
   *     next ruling would replace an "append-only ledger" of N entries with
   *     one entry — destroying prior rulings on a partial read.
   * Refusing to act is the only safe reading of a ledger we cannot read.
   */
  rulings(): Ruling[] {
    const abs = path.join(this.root, this.rulingsRel);
    if (!fs.existsSync(abs)) return []; // legitimate first run: nothing ruled yet
    let raw: string;
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch (e) {
      throw new Error(
        `Vault.rulings(): ${this.rulingsRel} exists but is unreadable (${(e as Error).message}). ` +
          `Refusing to treat a damaged ruling ledger as "no rulings" — restore it from git ` +
          `(git -C <vault> checkout -- ${this.rulingsRel}) before running the audit again.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Vault.rulings(): ${this.rulingsRel} is present but unparseable JSON (${(e as Error).message}). ` +
          `Refusing to treat a damaged ruling ledger as "no rulings": the audit would re-propose ` +
          `every already-ruled-on decision, and the next ruling would overwrite the ledger with a ` +
          `single entry. Restore it from git (git -C <vault> checkout -- ${this.rulingsRel}).`,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(
        `Vault.rulings(): ${this.rulingsRel} parsed as ${parsed === null ? "null" : typeof parsed}, ` +
          `expected a JSON array of rulings. Refusing to treat a damaged ruling ledger as "no rulings". ` +
          `Restore it from git (git -C <vault> checkout -- ${this.rulingsRel}).`,
      );
    }
    return parsed as Ruling[];
  }

  /**
   * Append one ruling. Reads through rulings(), so a damaged ledger throws HERE
   * too — the write never happens, and the prior entries survive on disk.
   */
  private appendRuling(ruling: Ruling): void {
    const abs = path.join(this.root, this.rulingsRel);
    const existing = this.rulings();
    fs.writeFileSync(abs, JSON.stringify([...existing, ruling], null, 2) + "\n");
  }

  /**
   * The structural human gate. Every promotion/removal path funnels through
   * this: no actor, no write — a caller that cannot name a human cannot rule.
   * (Threat model: this gates the tool-scoped MCP agent, which has no
   * approve/reject tool at all. A filesystem peer owns the repo and is
   * outside this boundary — stated, not pretended away.)
   */
  private static requireActor(by: unknown, op: string): string {
    if (typeof by !== "string" || by.trim().length === 0) {
      throw new Error(
        `Vault.${op}() requires an explicit human actor: pass a non-empty \`by\` (who ruled on this?)`,
      );
    }
    return by.trim();
  }

  /**
   * Remove a note. Requires an explicit human actor (`by`) — the reject path.
   * Removing a proposal records a "rejected" ruling in compass/rulings.json.
   */
  remove(id: string, by: string, reason?: string): string | null {
    const actor = Vault.requireActor(by, "remove");
    const note = this.get(id);
    if (!note) return null;
    fs.unlinkSync(note.path);
    if (note.type === "proposal") {
      this.appendRuling({
        decision_id: String(note.data.evidence ?? ""),
        proposal_id: note.id,
        disposition: "rejected",
        by: actor,
        date: new Date().toISOString(),
        ...(reason ? { reason } : {}),
      });
    }
    return note.relPath;
  }

  /**
   * Move a proposal into skills/ or knowledge/, flipping status to active.
   * Requires an explicit human actor (`by`) — records an "approved" ruling
   * in compass/rulings.json. There is deliberately no default actor.
   */
  promote(proposal: Note, by: string): string {
    const actor = Vault.requireActor(by, "promote");
    const target: NoteType = proposal.data.proposed_type === "knowledge" ? "knowledge" : "skill";
    const prefix = target === "skill" ? "skill" : "kn";
    const { id: _i, type: _t, proposed_type: _p, status: _s, ...rest } = proposal.data;
    const rel = this.write(target, `${prefix}-${this.slugFromTitle(proposal)}`, {
      ...rest,
      status: "active",
      version: 1,
    }, proposal.body);
    fs.unlinkSync(proposal.path);
    this.appendRuling({
      decision_id: String(proposal.data.evidence ?? ""),
      proposal_id: proposal.id,
      disposition: "approved",
      by: actor,
      date: new Date().toISOString(),
    });
    return rel;
  }

  /** Deterministic human-readable slug from a proposal's title, e.g. "triage-invoice-inv-7731-net". */
  private slugFromTitle(proposal: Note): string {
    const STOP = new Set(["the", "a", "an", "and", "or", "for", "from", "to", "of", "with", "on", "in", "request"]);
    const words = proposal.title
      .replace(/^proposed (skill|knowledge):?\s*/i, "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && !STOP.has(w))
      .slice(0, 5);
    const slug = words.join("-") || proposal.id.replace(/^prop-/, "");
    // Collision guard: suffix with the proposal number if the id is taken.
    return this.get(`${proposal.data.proposed_type === "knowledge" ? "kn" : "skill"}-${slug}`)
      ? `${slug}-${proposal.id.replace(/^prop-/, "")}`
      : slug;
  }

  nextId(prefix: "dec" | "prop"): string {
    const type: NoteType = prefix === "dec" ? "decision" : "proposal";
    const max = this.list(type)
      .map((n) => Number(n.id.match(/(\d+)$/)?.[1] ?? 0))
      .reduce((a, b) => Math.max(a, b), 0);
    return `${prefix}-${String(max + 1).padStart(3, "0")}`;
  }

  /** Keyword recall over knowledge + skills. Deliberately simple: no embeddings in v1. */
  recall(query: string, k = 5): Array<{ note: Note; score: number }> {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    const candidates = [...this.list("knowledge"), ...this.list("skill")];
    return candidates
      .map((note) => {
        const title = note.title.toLowerCase();
        const body = note.body.toLowerCase();
        const tags = (Array.isArray(note.data.tags) ? note.data.tags : []).join(" ").toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (title.includes(t)) score += 3;
          if (tags.includes(t)) score += 2;
          if (body.includes(t)) score += 1;
        }
        return { note, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /** Relative path of the append-only citation ledger — include it in the [blackbox] commit. */
  readonly citationsRel = path.join("compass", "citations.jsonl");

  /**
   * Record citations in the APPEND-ONLY ledger. Returns rel paths to commit.
   *
   * `[human]` ruling 2026-08-02 (decisions/2026-08-02-week3-rulings.md:9-25):
   * this method used to rewrite `cite_count`/`last_cited` in each cited note's
   * frontmatter — an agent-triggered write to active memory, which falsified
   * tools.ts:4-7 and ~/CLAUDE.md verbatim, and let one agent-only call clear
   * two standing audit findings about itself. It now appends to
   * compass/citations.jsonl and NEVER touches skills/ or knowledge/: those
   * notes are immutable to the tool surface. Counts are derived (audit.ts).
   *
   * NAME KEPT DELIBERATELY: the harness eval's read-only bridge disables write
   * methods on a Vault instance BY NAME
   * (~/.claude/harness/eval/adapters/compass_bridge.mjs:56 —
   * `["write","remove","promote","markCited","nextId"]`), and that file is
   * outside this repo. Renaming this method would silently drop the bridge's
   * coverage of the only write path it still has to guard.
   *
   * Ids that do not resolve to a knowledge/skill note are not ledgered (the
   * ledger records citations of real notes). They are NOT silently dropped
   * from the record: log_decision writes them to the decision's
   * `citations_unresolved` frontmatter (tools.ts:112) — that is the honest
   * channel for them. Repeats of the same id within one decision collapse to
   * one line: a decision cites a note once.
   */
  markCited(ids: string[], decisionId: string, when: string): string[] {
    const seen = new Set<string>();
    const entries: Citation[] = [];
    for (const id of ids) {
      const note = this.get(id);
      if (!note || (note.type !== "knowledge" && note.type !== "skill")) continue;
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      entries.push({ skill_id: note.id, decision_id: decisionId, timestamp: when });
    }
    if (entries.length === 0) return [];
    const abs = path.join(this.root, this.citationsRel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    return [this.citationsRel];
  }

  /**
   * Every ledgered citation, oldest first. FAIL-CLOSED, like rulings(): only an
   * ABSENT file means "nothing cited yet". A file that exists but has a line we
   * cannot parse is a DAMAGED ledger and throws — reading it as "fewer
   * citations" would silently manufacture stale-skill findings, and reading a
   * truncated tail as "none" would silently clear them. Appending (markCited)
   * does not read, so the blackbox keeps recording while the audit refuses.
   */
  citations(): Citation[] {
    const abs = path.join(this.root, this.citationsRel);
    if (!fs.existsSync(abs)) return []; // legitimate first run: nothing cited yet
    const raw = fs.readFileSync(abs, "utf8");
    const out: Citation[] = [];
    raw.split("\n").forEach((line, i) => {
      if (!line.trim()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        throw new Error(
          `Vault.citations(): ${this.citationsRel} line ${i + 1} is not valid JSON (${(e as Error).message}). ` +
            `Refusing to read a damaged citation ledger: the audit derives stale-skill findings from it, ` +
            `so a partial read would invent or erase findings. Restore it from git ` +
            `(git -C <vault> checkout -- ${this.citationsRel}).`,
        );
      }
      const c = parsed as Partial<Citation>;
      if (typeof c?.skill_id !== "string" || typeof c?.decision_id !== "string") {
        throw new Error(
          `Vault.citations(): ${this.citationsRel} line ${i + 1} is missing skill_id/decision_id. ` +
            `Refusing to read a damaged citation ledger. Restore it from git ` +
            `(git -C <vault> checkout -- ${this.citationsRel}).`,
        );
      }
      out.push({ skill_id: c.skill_id, decision_id: c.decision_id, timestamp: String(c.timestamp ?? "") });
    });
    return out;
  }

  /** note id → the decision ids that cited it, ledger order, deduped. Derived, never stored. */
  citationsByNote(): Map<string, string[]> {
    const byNote = new Map<string, string[]>();
    for (const c of this.citations()) {
      const decs = byNote.get(c.skill_id) ?? [];
      if (!decs.includes(c.decision_id)) decs.push(c.decision_id);
      byNote.set(c.skill_id, decs);
    }
    return byNote;
  }
}

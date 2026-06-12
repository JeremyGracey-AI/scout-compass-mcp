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

  remove(id: string): string | null {
    const note = this.get(id);
    if (!note) return null;
    fs.unlinkSync(note.path);
    return note.relPath;
  }

  /** Move a proposal into skills/ or knowledge/, flipping status to active. */
  promote(proposal: Note): string {
    const target: NoteType = proposal.data.proposed_type === "knowledge" ? "knowledge" : "skill";
    const prefix = target === "skill" ? "skill" : "kn";
    const { id: _i, type: _t, proposed_type: _p, status: _s, ...rest } = proposal.data;
    const rel = this.write(target, `${prefix}-${this.slugFromTitle(proposal)}`, {
      ...rest,
      status: "active",
      version: 1,
    }, proposal.body);
    fs.unlinkSync(proposal.path);
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

  /** Bump citation stats on cited notes. Returns rel paths touched. */
  markCited(ids: string[], when: string): string[] {
    const touched: string[] = [];
    for (const id of ids) {
      const note = this.get(id);
      if (!note || (note.type !== "knowledge" && note.type !== "skill")) continue;
      note.data.cite_count = Number(note.data.cite_count ?? 0) + 1;
      note.data.last_cited = when;
      const { id: nid, type, ...rest } = note.data as { id: string; type: NoteType };
      touched.push(this.write(note.type, note.id, rest, note.body));
    }
    return touched;
  }
}

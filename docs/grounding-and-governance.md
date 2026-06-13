# Grounding and governance: the primitive Scout Compass adds

> A design note. Most agent apps consume every layer beneath them and add no
> durable primitive of their own. This is the test we hold Scout Compass to —
> and how it passes.

## Where we sit, and what we add

The AI stack is layers of abstraction — hardware, kernels, model architecture,
training, inference, model APIs, tool use, the agent loop, the **skill layer**,
orchestration, product surfaces, vertical apps. Each consumes the messiness
below and exposes something cleaner above.

Scout Compass sits at the **skill and governance layer**. It *consumes* the
layers beneath it — model APIs, Microsoft Foundry, MCP tool use, files, git —
and *produces* one thing those layers don't:

**agent memory and competence as a human-owned, version-controlled, auditable
artifact.**

That is the durable primitive. Not a prompt, not a one-off flow: a repeatable
pattern that works under any agent, model, or task — every decision is an
append-only record (`[blackbox]`), the audit turns uncited decisions into draft
proposals, and the human-gated `approve_proposal` is the *only* path from
proposal to active skill. `git revert` rolls behavior back. If Scout Compass
produced nothing at this layer, it would be a thin wrapper. It produces the
governance layer itself.

## Grounded, by construction

A workflow is grounded when the agent can point to the source that justified
each action. Scout Compass makes that mechanical rather than aspirational:

| Design question | In Scout Compass |
|---|---|
| What source anchored the decision? | `citations: [ids]` on every decision record |
| How is ungrounded action caught? | the `uncited-decision` audit heuristic — freelancing becomes a proposal a human reviews |
| When does the agent stop? | `outcome: needs_human` — the escalation, logged, not an error |
| When does a human step in? | `approve_proposal` — the only write path into active memory |
| Is it auditable later? | the git log *is* the audit trail; the blackbox is append-only |

The honest-citation contract is the point: an agent that acts without grounding
must log `citations: []`, and the audit catches the gap. Scout Compass never
papers over an empty citation server-side — **catching it is the product.**

## What survives the next level

A weak agent design collapses the moment reality adds more than the demo path.
Scout Compass is built so those extensions don't break it:

- **Concurrent requests** → every mutation serializes through a vault
  write-lock and lands as a single git commit.
- **Audit / compliance** → every change is attributable
  (`[blackbox]` / `[compass]` / `[human]`) and diffable.
- **Human escalation** → `needs_human` is a first-class outcome.
- **Rollback** → behavior reverts via `git revert`; history cannot — the
  server refuses to revert a `[blackbox]` commit. *Behavior is revertible;
  history is not.*

The design survives extension because the durable primitive — memory under
version control, *agents propose / humans promote* — is the foundation, not a
feature bolted on after the demo worked once.

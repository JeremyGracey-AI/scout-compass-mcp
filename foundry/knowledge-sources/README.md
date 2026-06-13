# IQ knowledge-source content (orthogonal to the vault)

This folder holds the **external reference content** ingested into the Foundry IQ
knowledge base (`scout-compass-kb`). It is deliberately **orthogonal** to the
Compass vault: it does not define payment terms, vendor-triage procedure, or
invoice-escalation routing — those are vault-owned and are what the validated
trap-email demo depends on:

| Concern | Owner | Note |
|---|---|---|
| Payment / net-terms policy | **vault** | `kn-payment-policy` |
| Vendor-triage procedure | **vault** | `skill-vendor-triage` |
| Invoice-escalation contacts | **vault** | `kn-escalation-contacts` |
| Company handbook, vendor master, org directory | **IQ (this folder)** | facts the vault doesn't own |

Why this matters (see `docs/IQ_ORTHOGONALITY.md`): the KB has no content-level
filter stopping IQ answers from resembling vault content. If IQ returned the
payment policy, Atlas could ground on IQ instead of the vault and alter the
validated behavior. Keeping the ingested content topically separate is the first
guardrail; the labeled-sections rule in the agent instructions is the second.

## Files

- `company-handbook.md` — office, PTO, IT onboarding, travel tool. No AP/payment policy.
- `vendor-master.csv` — vendor registry metadata (id, category, region, status). **No payment terms.** Excludes the trap-path vendors (Initech) and the vault's vendor notes (ACME, Globex).
- `org-directory.csv` — staff directory (name, title, dept, location, manager). Not an escalation/approval matrix.

## Ingest as knowledge sources

Smallest-friction path is the `file` knowledge source (upload directly to Azure
AI Search — no blob account). See `docs/iq-path-a-runbook.md` for the steps.
Keep ingestion hygiene: do not add payment-policy / vendor-triage text here.

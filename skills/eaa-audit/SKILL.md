---
name: eaa-audit
description: Audit a web codebase for accessibility against WCAG 2.1 AA and EN 301 549, the standard the European Accessibility Act points to. Use when asked for an accessibility audit, WCAG or EN 301 549 compliance, EAA readiness, when the user has received an accessibility complaint or legal notice, or before shipping a site or app sold to consumers in the EU. Reports static violations from the source with file and line, mapped to both the WCAG success criterion and the EN 301 549 clause.
---

# EAA / WCAG 2.1 AA accessibility audit

## What it does

Scans the **source** of a web project and reports the WCAG 2.1 AA violations
that are visible statically, each with `file:line` and a mapping to:

- the **WCAG 2.1 success criterion** and its level (A / AA)
- the **EN 301 549 clause** — the harmonised standard the European
  Accessibility Act points to, and the reference an auditor or a law firm cites

## The limit, state it every time

**Automated testing reaches 30-40% of the WCAG criteria.** This skill covers
the static subset of that share.

**Never tell a user their project is "compliant" or "conformant" on the basis of
this audit.** It is not, and you cannot know that. What this audit gives them is
fewer hours of manual review, and a defensible paper trail.

If the user asks for a conformance certification, explain that no automated tool
can give one, and that it takes a human audit with assistive technology. Anyone
promising otherwise is selling them a liability.

No legal advice. On penalties, specific obligations, or how to answer a legal
notice, point them to a professional.

## How to run it

```bash
node scripts/detect.mjs <directory>            # readable report
node scripts/detect.mjs <directory> --json     # structured output
node scripts/detect.mjs <directory> --max 50   # cap the findings shown
```

Zero dependencies, Node 18+. No `npm install`, no network calls, nothing leaves
the machine.

Scans `.html .htm .jsx .tsx .vue .svelte .astro` and `.css .scss .less`.
Skips `node_modules`, `dist`, `build`, `.next` and friends automatically.

## How to present the results

1. **Run the script** against the project directory. Do not read files by hand
   first: the script is deterministic and more reliable than skimming.
2. **Report the counts by severity**, then the findings grouped.
3. **Always start from BLOCKING.** Those are the ones that stop a person from
   completing a task, and they are where an auditor starts too.
4. **Present `NEEDS REVIEW` findings as exactly that**: the source is ambiguous,
   typically a component whose rendering is unknowable from the source. Do not
   count them among confirmed violations.
5. **Close by restating the 30-40% limit** and the criteria that require human
   verification (see `references/ruleset.md`, group C).

If the user asks you to fix the issues, work file by file starting with the
blocking ones, then re-run the script to confirm the count drops.

## Severity

| Level | Meaning |
|---|---|
| `BLOCKING` | stops someone using assistive technology from completing a task |
| `SERIOUS` | substantially degrades the experience |
| `MINOR` | should be fixed, does not block use |
| `NEEDS REVIEW` | the source is ambiguous, a human has to look |

## When NOT to use this skill

- Accessibility requests that are **not web** (PDF documents, hardware, native
  apps): this covers EN 301 549 clause 9, which is the web
- **Legal** questions about the EAA, penalties, or responding to a notice
- Requests for a **certification** or a signed declaration of conformance
- Auditing a site whose **source you do not have**: this starts from code. For a
  live site you need tools that run against the rendered DOM (axe-core,
  Lighthouse), which are complementary, not alternatives

## Relationship to axe-core and Lighthouse

They do not overlap. **axe and Lighthouse run on the rendered page**: they see
the result and cannot tell which piece of source produced it. This skill starts
from the code, so it gives `file:line` — but it sees nothing that depends on
runtime (computed contrast, reflow, real focus behaviour).

The correct advice to give a user is to run **both**.

## Reference

- `references/ruleset.md` — every rule, with the WCAG ↔ EN 301 549 mapping, plus
  an explicit list of what is NOT covered and why

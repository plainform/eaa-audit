# eaa-audit

**Find the accessibility violations in your code, with file and line, mapped to
the standard your regulator actually cites.**

A Claude Code skill that audits a web codebase against **WCAG 2.1 AA** and
**EN 301 549** — the harmonised standard the European Accessibility Act points
to. Zero dependencies, nothing leaves your machine.

A real run, not a mock-up — this is `vercel/commerce` at its current `main`,
and you can reproduce it in the two commands below the block:

```
eaa-audit - WCAG 2.1 AA / EN 301 549 clause 9
46 files scanned in ./commerce

  BLOCKING 4   SERIOUS 0   MINOR 0   NEEDS REVIEW 0

── BLOCKING ──
  components/layout/navbar/search.tsx:15  [3.3.2 A · EN 9.3.3.2]  input-no-label
     "text" field with no associated label.
     → Connect a <label for="id">, or add aria-label. A placeholder is NOT a
       label: it disappears as soon as the user types.
  components/layout/navbar/search.tsx:34  [3.3.2 A · EN 9.3.3.2]  input-no-label
     "text" field with no associated label.
     → Connect a <label for="id">, or add aria-label. A placeholder is NOT a
       label: it disappears as soon as the user types.
  components/layout/search/filter/dropdown.tsx:41  [2.1.1 A · EN 9.2.1.1]  click-no-keyboard
     <div> has a click handler but cannot be reached by keyboard.
     → Use <button>. If you cannot: role="button" + tabIndex={0} + onKeyDown
       for Enter and Space.
  components/layout/search/filter/dropdown.tsx:51  [2.1.1 A · EN 9.2.1.1]  click-no-keyboard
     <div> has a click handler but cannot be reached by keyboard.
     → Use <button>. If you cannot: role="button" + tabIndex={0} + onKeyDown
       for Enter and Space.

Static subset of WCAG 2.1 AA. Automated testing covers 30-40% of the criteria.
This does not certify conformance.
```

```bash
git clone --depth 1 https://github.com/vercel/commerce.git
node skills/eaa-audit/scripts/detect.mjs ./commerce
```

## Why this exists

The European Accessibility Act has been enforceable since **28 June 2025**, and
2026 is the first full year national authorities supervise against it. Penalties
run up to 5% of turnover for large companies, and €5,000–€40,000 for others. It
applies to anyone selling to EU consumers — **including companies based outside
the EU**.

Detection tools already exist and they are good. What none of them give you is
the middle step:

```
   detection    →   [ FIXING IT IN YOUR CODE ]   →   the paperwork
  axe, Lighthouse        where the hours go          nobody does this
     (solved)
```

axe and Lighthouse run on the **rendered page**. They tell you a page has a
problem; they cannot tell you which component in your source produced it.
This starts from the code, so it gives you `file:line` — and Claude can then go
fix it.

**Use both.** They are complementary, not alternatives.

## What it will not do

**Automated testing reaches 30-40% of the WCAG criteria.** This covers the
static subset of that share.

So it will never tell you that you are compliant, because it cannot know. It
tells you what is provably wrong in your source, and flags what still needs a
human with a screen reader. Anyone selling you automated conformance is selling
you a liability — which is why overlay vendors ended up in front of regulators.

No legal advice either. For a legal notice, talk to a professional.

## Install

```
/plugin marketplace add plainform/eaa-audit
/plugin install eaa-audit
```

Then just ask:

> run an accessibility audit on this project

Or run the detector directly — no install, no dependencies:

```bash
node skills/eaa-audit/scripts/detect.mjs ./src
node skills/eaa-audit/scripts/detect.mjs ./src --json
```

Requires Node 18+. Scans `.html .htm .jsx .tsx .vue .svelte .astro` and
`.css .scss .less`.

## How accurate is it

Precision was the whole design constraint: in a compliance report, a false
positive costs more credibility than a missed finding earns. Where the source is
genuinely ambiguous, a finding is emitted as `NEEDS REVIEW`, never `BLOCKING`.

Validated against real codebases, every finding checked by hand:

| Codebase | Findings | Verified true |
|---|---|---|
| `vercel/commerce` | 4 | 4 |
| `nuxt/movies` | 4 | 4 |
| `h5bp/html5-boilerplate` | 4 | 4 |
| test fixtures | 20 | 20 |

**Zero false positives**, and a clean fixture that must return zero is part of
the suite. Two classes of false positive were found during that process and
fixed before release:

- `<Link>` from Next.js was being read as the void HTML tag `<link>` and
  reported as a keyboard failure. Capitalised tags are components; their
  rendered semantics are unknowable from source, so element rules now skip them.
- `<img aria-hidden="true">` was reported for a missing `alt`. An image removed
  from the accessibility tree does not need one.

Run it yourself:

```bash
node skills/eaa-audit/scripts/detect.mjs test/fixtures
```

`test/fixtures/bad.html` should yield 20 findings, `test/fixtures/good.jsx`
exactly zero.

## What it covers

24 rules across WCAG 2.1 A and AA, each mapped to its EN 301 549 clause. The
full list — including an explicit account of **what is not covered and why** —
is in [`skills/eaa-audit/references/ruleset.md`](skills/eaa-audit/references/ruleset.md).

## License

MIT. See [LICENSE](LICENSE).

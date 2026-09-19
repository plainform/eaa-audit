# Ruleset — WCAG 2.1 AA detectable statically from source

Every rule carries two references:

- the **WCAG 2.1** success criterion — the technical standard
- the **EN 301 549** clause — the harmonised standard the European
  Accessibility Act points to, and the one an auditor or a law firm cites

The mapping is direct: for web content, **EN 301 549 clause 9.x.y.z corresponds
to WCAG x.y.z**. For non-web software (native, desktop) the same correspondence
lives in clause 11.x.y.z. This ruleset covers the web case.

---

## Inclusion criterion

A rule ships **only if it is high-precision against source**. In a domain where
the reader may have a legal notice on their desk, a false positive costs more
credibility than an extra true positive earns.

Three groups:

| Group | Where it lives | What we do |
|---|---|---|
| **A** — static | visible in the source | we detect it |
| **B** — runtime | needs the rendered DOM | we declare it, defer to axe |
| **C** — human | needs judgement or assistive tech | we list it as to-verify |

---

## Group A — implemented rules

### BLOCKING
They stop someone from completing a task. First thing an auditor looks at.

| ID | WCAG | Level | EN 301 549 | What it catches |
|---|---|---|---|---|
| `img-alt-missing` | 1.1.1 | A | 9.1.1.1 | `<img>` with no `alt` attribute (missing ≠ `alt=""`) |
| `button-no-name` | 4.1.2 | A | 9.4.1.2 | `<button>` with no text, `aria-label` or `aria-labelledby` |
| `input-no-label` | 3.3.2 | A | 9.3.3.2 | form control with no `<label for>`, `aria-label` or `aria-labelledby` |
| `link-no-name` | 2.4.4 | A | 9.2.4.4 | `<a href>` with no accessible text |
| `html-no-lang` | 3.1.1 | A | 9.3.1.1 | `<html>` with no `lang`, or an empty one |
| `page-no-title` | 2.4.2 | A | 9.2.4.2 | document with no non-empty `<title>` |
| `click-no-keyboard` | 2.1.1 | A | 9.2.1.1 | `onClick` on a non-interactive element with no keyboard handling |
| `aria-hidden-focusable` | 4.1.2 | A | 9.4.1.2 | `aria-hidden="true"` on a focusable element |

### SERIOUS
They substantially degrade the experience.

| ID | WCAG | Level | EN 301 549 | What it catches |
|---|---|---|---|---|
| `focus-outline-removed` | 2.4.7 | AA | 9.2.4.7 | `outline: none\|0` with no `:focus-visible` replacement |
| `viewport-zoom-blocked` | 1.4.4 | AA | 9.1.4.4 | `user-scalable=no`, or `maximum-scale` < 2 |
| `tabindex-positive` | 2.4.3 | A | 9.2.4.3 | `tabindex` > 0: breaks the tab order |
| `heading-skip` | 1.3.1 | A | 9.1.3.1 | heading hierarchy skipping a level (h2 → h4) |
| `heading-empty` | 2.4.6 | AA | 9.2.4.6 | heading with no textual content |
| `video-no-captions` | 1.2.2 | A | 9.1.2.2 | `<video>` with no `<track kind="captions">` |
| `svg-no-name` | 1.1.1 | A | 9.1.1.1 | `<svg role="img">` with no accessible name |
| `role-invalid` | 4.1.2 | A | 9.4.1.2 | a `role` value that is not in ARIA |
| `contrast-literal` | 1.4.3 | AA | 9.1.4.3 | literal colour pair below 4.5:1 ⁽¹⁾ |

### MINOR
Worth fixing, not blocking.

| ID | WCAG | Level | EN 301 549 | What it catches |
|---|---|---|---|---|
| `autocomplete-missing` | 1.3.5 | AA | 9.1.3.5 | personal-data field with no `autocomplete` |
| `link-generic-text` | 2.4.4 | A | 9.2.4.4 | generic link text ("click here", "read more") |
| `no-main-landmark` | 2.4.1 | A | 9.2.4.1 | page with no `<main>` or `role="main"` |
| `duplicate-id` | 4.1.1 | A | 9.4.1.1 | duplicate `id` within one file |
| `th-no-scope` | 1.3.1 | A | 9.1.3.1 | `<th>` with no `scope` |
| `autofocus-used` | 3.2.1 | A | 9.3.2.1 | `autofocus`: moves focus unrequested |

`autocomplete-missing` deserves a note: it is an **AA** criterion introduced in
WCAG 2.1, almost universally ignored, and trivial to fix. On a checkout flow it
is among the first things an auditor finds.

---

## Handling ambiguity

Two design decisions carry most of the precision:

**Components are not elements.** A tag starting with a capital (`<Link>`,
`<Image>`, `<Button>`) is a component whose rendered output is unknowable from
source. Element-semantics rules skip them entirely. Without this, Next.js
`<Link>` is read as the void HTML tag `<link>` and every one of them is reported
as a keyboard failure.

**Icon-only is blocking, component-only is review.** A `<button>` whose children
are plain HTML with no text can have no accessible name — that is a certain
violation. A `<button>` whose child is a component might get its name from that
component, so it is reported as `NEEDS REVIEW` instead.

---

## Group B — runtime, not our job

These need the rendered DOM with computed styles. The report declares them and
points to axe-core or Lighthouse. **We do not compete on this ground, and saying
so is part of the positioning.**

- 1.4.3 Contrast (Minimum) (AA) — needs the computed colour ⁽¹⁾
- 1.4.10 Reflow (AA) — needs layout at 320px
- 1.4.11 Non-text Contrast (AA)
- 1.4.13 Content on Hover or Focus (AA)
- 2.1.2 No Keyboard Trap (A)
- 2.4.3 Focus Order — only partially checkable from source
- 4.1.3 Status Messages (AA)

⁽¹⁾ One implemented exception: when `color` and `background-color` are both
literals in the **same** CSS rule, the ratio is computable with certainty. Only
then do we check it. Anything else stays in group B.

## Group C — human verification required

No automated tool covers these. The report always lists them, because that is
the part that makes the paper trail defensible.

- 1.1.1 — whether a present `alt` is *correct*, not merely present
- 1.2.x — quality and sync of captions and audio description
- 1.3.1 — whether the semantic structure matches the visual relationships
- 1.3.2 Meaningful Sequence
- 2.4.6 — whether headings and labels are *descriptive*
- 3.1.2 Language of Parts
- 3.2.3 / 3.2.4 Consistent Navigation and Identification
- 3.3.3 / 3.3.4 Error Suggestion and Error Prevention
- End-to-end testing with a screen reader (NVDA, JAWS, VoiceOver)

---

## The number to always state

**Automated testing reaches 30-40% of the WCAG criteria.** This ruleset covers
the static subset of that share.

The report says so at the top, every time, and never uses the word "compliant".
Anyone promising automated conformance is selling a liability — which is exactly
why overlay vendors ended up in front of regulators.

What is promised here: **fewer hours of manual audit, and a defensible paper
trail.**

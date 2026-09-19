#!/usr/bin/env node
/**
 * eaa-audit - static WCAG 2.1 AA / EN 301 549 clause 9 detector
 *
 * Zero dependencies. Node 18+.
 *   node detect.mjs [dir] [--json] [--max N]
 *
 * Built for PRECISION over coverage: in a compliance report a false positive
 * costs more than a missed true positive. Where the source is ambiguous the
 * finding is emitted as severity "review", never "blocking".
 *
 * Covers the STATIC subset of the WCAG criteria. Automated testing reaches
 * 30-40% of the criteria in total. It does not certify conformance.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

// ---------------------------------------------------------------- config

const MARKUP_EXT = new Set(['.html', '.htm', '.jsx', '.tsx', '.vue', '.svelte', '.astro']);
const STYLE_EXT = new Set(['.css', '.scss', '.less']);
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  'coverage', 'vendor', '.cache', 'public/build', '.output', 'target', '__pycache__',
]);

const SEVERITY = { blocking: 0, serious: 1, minor: 2, review: 3 };

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'details', 'audio', 'video', 'iframe']);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

// Valid ARIA roles (WAI-ARIA 1.2)
const VALID_ROLES = new Set(`alert alertdialog application article associationlist associationlistitemkey
associationlistitemvalue banner blockquote button caption cell checkbox code columnheader combobox comment
complementary contentinfo definition deletion dialog directory document emphasis feed figure form generic grid
gridcell group heading img insertion link list listbox listitem log main mark marquee math menu menubar menuitem
menuitemcheckbox menuitemradio meter navigation none note option paragraph presentation progressbar radio
radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status strong
subscript suggestion superscript switch tab table tablist tabpanel term textbox time timer toolbar tooltip tree
treegrid treeitem`.split(/\s+/).filter(Boolean));

const GENERIC_LINK_TEXT = new Set([
  'click here', 'here', 'read more', 'more', 'learn more', 'link', 'this link', 'details', 'go',
  'clicca qui', 'qui', 'leggi di più', 'leggi di piu', 'scopri di più', 'scopri di piu',
  'maggiori informazioni', 'continua', 'vai', 'dettagli', 'altro',
]);

// personal-data field -> expected autocomplete token (WCAG 1.3.5)
const AUTOCOMPLETE_HINTS = [
  [/^(e[-_]?mail)$/i, 'email'],
  [/^(tel|phone|telefono|telephone)$/i, 'tel'],
  [/(first[-_]?name|nome)$/i, 'given-name'],
  [/(last[-_]?name|surname|cognome)$/i, 'family-name'],
  [/^(full[-_]?name|name)$/i, 'name'],
  [/(address|indirizzo|street)/i, 'street-address'],
  [/(post(al)?[-_]?code|cap|zip)/i, 'postal-code'],
  [/(city|citta|città)/i, 'address-level2'],
  [/(country|paese|nazione)/i, 'country-name'],
  [/(birth|nascita|dob)/i, 'bday'],
  [/^(cc[-_]|card[-_]?number|carta)/i, 'cc-number'],
  [/(organization|company|azienda|ragione[-_]?sociale)/i, 'organization'],
];

// ------------------------------------------------------------- tokenizer

/**
 * Tag-level tokenizer. It does not build a DOM: it emits a stream of open and
 * close tags with their attributes and position. That is enough for rules about
 * a single element, plus a little state for the document-level ones.
 * Handles JSX attributes with balanced braces, and Vue/Svelte directives.
 */
function tokenize(src) {
  const tokens = [];
  let i = 0;
  let line = 1;

  const lineAt = (pos) => {
    let l = 1;
    for (let k = 0; k < pos; k++) if (src[k] === '\n') l++;
    return l;
  };

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\n') { line++; i++; continue; }

    if (ch !== '<') { i++; continue; }

    // comment
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i);
      const chunk = src.slice(i, end === -1 ? src.length : end);
      line += (chunk.match(/\n/g) || []).length;
      i = end === -1 ? src.length : end + 3;
      continue;
    }

    // doctype / processing instruction
    if (src[i + 1] === '!' || src[i + 1] === '?') {
      const end = src.indexOf('>', i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    // closing tag
    if (src[i + 1] === '/') {
      const end = src.indexOf('>', i);
      if (end === -1) { i++; continue; }
      const name = src.slice(i + 2, end).trim().toLowerCase();
      tokens.push({ type: 'close', name, line, start: i, end: end + 1 });
      i = end + 1;
      continue;
    }

    if (!/[a-zA-Z]/.test(src[i + 1] || '')) { i++; continue; }

    // opening tag
    const parsed = parseOpenTag(src, i, line);
    if (!parsed) { i++; continue; }
    tokens.push(parsed.token);
    line = parsed.line;
    i = parsed.next;

    // script/style: skip the contents, they are not markup
    const n = parsed.token.name;
    if ((n === 'script' || n === 'style') && !parsed.token.selfClosing) {
      const closeIdx = src.toLowerCase().indexOf(`</${n}`, i);
      if (closeIdx !== -1) {
        const chunk = src.slice(i, closeIdx);
        line += (chunk.match(/\n/g) || []).length;
        i = closeIdx;
      }
    }
  }

  // line positions are tracked while streaming above
  void lineAt;
  return tokens;
}

function parseOpenTag(src, start, startLine) {
  let i = start + 1;
  let line = startLine;
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9:._-]*/.exec(src.slice(i));
  if (!nameMatch) return null;
  const rawName = nameMatch[0];
  i += rawName.length;

  const attrs = {};
  let selfClosing = false;

  while (i < src.length) {
    const ch = src[i];

    if (ch === '\n') { line++; i++; continue; }
    if (/\s/.test(ch)) { i++; continue; }

    if (ch === '/' && src[i + 1] === '>') { selfClosing = true; i += 2; break; }
    if (ch === '>') { i++; break; }

    // JSX spread attribute {...props}, or a Svelte block
    if (ch === '{') {
      const res = skipBraces(src, i, line);
      attrs['__spread__'] = true;
      line = res.line; i = res.next;
      continue;
    }

    const attrMatch = /^[@:#a-zA-Z_][a-zA-Z0-9:._$-]*/.exec(src.slice(i));
    if (!attrMatch) { i++; continue; }
    const attrName = attrMatch[0];
    i += attrName.length;

    // skip whitespace before the =
    while (i < src.length && /\s/.test(src[i])) { if (src[i] === '\n') line++; i++; }

    if (src[i] !== '=') {
      attrs[normalizeAttr(attrName)] = true; // boolean attribute
      continue;
    }
    i++; // consume the =
    while (i < src.length && /\s/.test(src[i])) { if (src[i] === '\n') line++; i++; }

    const q = src[i];
    if (q === '"' || q === "'") {
      const end = src.indexOf(q, i + 1);
      if (end === -1) { i++; continue; }
      const value = src.slice(i + 1, end);
      line += (value.match(/\n/g) || []).length;
      attrs[normalizeAttr(attrName)] = value;
      i = end + 1;
    } else if (q === '{') {
      const res = skipBraces(src, i, line);
      attrs[normalizeAttr(attrName)] = { expr: src.slice(i + 1, res.next - 1) };
      line = res.line; i = res.next;
    } else {
      const m = /^[^\s>]+/.exec(src.slice(i));
      if (!m) { i++; continue; }
      attrs[normalizeAttr(attrName)] = m[0];
      i += m[0].length;
    }
  }

  // A name starting with a capital is a component (React/Vue/Svelte), not an HTML
  // element: its rendered semantics are unknowable here. Telling them apart is
  // essential - without it, Next.js <Link> collapses into the void tag <link>.
  const isComponent = /^[A-Z]/.test(rawName);

  return {
    token: {
      type: 'open',
      name: rawName.toLowerCase(),
      rawName,
      isComponent,
      attrs,
      selfClosing: selfClosing || (!isComponent && isVoid(rawName.toLowerCase())),
      line: startLine,
      start,
      end: i,
    },
    line,
    next: i,
  };
}

function skipBraces(src, start, startLine) {
  let depth = 0;
  let i = start;
  let line = startLine;
  let inStr = null;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\n') line++;
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; i++; continue; }
    if (ch === '{') depth++;
    if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    i++;
  }
  return { next: i, line };
}

function normalizeAttr(name) {
  const n = name.toLowerCase();
  // Vue/Svelte: :prop, v-bind:prop, @click, on:click -> prop / onclick
  if (n.startsWith('v-bind:')) return n.slice(7);
  if (n.startsWith('v-on:')) return 'on' + n.slice(5);
  if (n.startsWith('on:')) return 'on' + n.slice(3);
  if (n.startsWith('@')) return 'on' + n.slice(1);
  if (n.startsWith(':')) return n.slice(1);
  return n;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const isVoid = (n) => VOID_TAGS.has(n);

// ------------------------------------------------------------- utilities

function attrStr(v) {
  if (v === true) return '';
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'expr' in v) return `{${v.expr}}`;
  return '';
}
const isDynamic = (v) => !!(v && typeof v === 'object' && 'expr' in v);
const hasAttr = (t, n) => Object.prototype.hasOwnProperty.call(t.attrs, n);

/** Raw source between an opening tag and its matching close. */
function innerRaw(src, tokens, idx) {
  const open = tokens[idx];
  if (open.selfClosing) return '';
  let depth = 1;
  for (let k = idx + 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.name !== open.name) continue;
    if (t.type === 'open' && !t.selfClosing) depth++;
    else if (t.type === 'close') {
      depth--;
      if (depth === 0) return src.slice(open.end, t.start);
    }
  }
  return src.slice(open.end, Math.min(src.length, open.end + 2000));
}

/**
 * Visible accessible name. Returns:
 *   'text'      literal text is present
 *   'dynamic'   expression or slot: probably renders text -> do not accuse
 *   'none'      no textual content at all
 *   'element'   only plain HTML children, no text -> no name is possible
 *   'component' a component child -> ambiguous, needs review
 */
function textualContent(inner) {
  if (!inner) return 'none';
  if (/\{[^}]*\}/.test(inner) || /\{\{/.test(inner) || /<slot\b/i.test(inner)) return 'dynamic';
  const stripped = inner.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').trim();
  if (stripped.length > 0) return 'text';
  // A component child (capitalised) may expose an accessible name of its own.
  // Lowercase HTML children with no text mean no accessible name is possible.
  if (/<[A-Z]/.test(inner)) return 'component';
  if (/<[a-z]/.test(inner)) return 'element';
  return 'none';
}

function labelledByAttr(t) {
  return hasAttr(t, 'aria-label') || hasAttr(t, 'aria-labelledby')
    || hasAttr(t, 'title') || hasAttr(t, 'alt');
}

// ------------------------------------------------------------- CSS colors

const NAMED_COLORS = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0],
  blue: [0, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  yellow: [255, 255, 0], orange: [255, 165, 0], purple: [128, 0, 128], navy: [0, 0, 128],
  teal: [0, 128, 128], olive: [128, 128, 0], maroon: [128, 0, 0], lime: [0, 255, 0],
  aqua: [0, 255, 255], cyan: [0, 255, 255], fuchsia: [255, 0, 255], magenta: [255, 0, 255],
};

function parseColor(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((k) => parseInt(m[1].slice(k, k + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/.exec(s);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) < 0.999) return null; // alpha channel: not computable here
    return [+m[1], +m[2], +m[3]];
  }
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];
  return null;
}

function relLuminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const l1 = relLuminance(a), l2 = relLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ------------------------------------------------------------ rule engine

function auditMarkup(file, src, findings) {
  const tokens = tokenize(src);
  const isDocument = /<html[\s>]/i.test(src) || extname(file) === '.html' || extname(file) === '.htm';

  const add = (rule, severity, line, message, fix) =>
    findings.push({ file, line, rule: rule.id, wcag: rule.wcag, level: rule.level, en: rule.en, severity, message, fix });

  // --- pre-pass: collect label[for] targets and id occurrences
  const labelFor = new Set();
  const idCount = new Map();
  for (const t of tokens) {
    if (t.type !== 'open') continue;
    if (t.name === 'label') {
      const f = t.attrs['for'] ?? t.attrs['htmlfor'];
      if (typeof f === 'string') labelFor.add(f);
    }
    const id = t.attrs['id'];
    if (typeof id === 'string') idCount.set(id, (idCount.get(id) || 0) + 1);
  }

  let labelDepth = 0;
  let lastHeading = 0;
  let sawMain = false;
  let sawTitle = false;
  const reportedDupIds = new Set();

  for (let idx = 0; idx < tokens.length; idx++) {
    const t = tokens[idx];
    if (t.type === 'close') { if (t.name === 'label' && labelDepth > 0) labelDepth--; continue; }
    if (t.type !== 'open') continue;

    const { name, attrs, line } = t;
    if (name === 'label' && !t.selfClosing) labelDepth++;
    if (attrs['__spread__']) { /* spread props: stay conservative below */ }

    // ---------------------------------------------------- 1.1.1 img alt
    const ariaHidden = String(attrStr(attrs['aria-hidden'])).toLowerCase() === 'true';
    const presentational = ['presentation', 'none'].includes(String(attrStr(attrs['role'])).toLowerCase());
    if (name === 'img' && !t.isComponent && !hasAttr(t, 'alt')
        && !ariaHidden && !presentational && !attrs['__spread__']) {
      add(RULES['img-alt-missing'], 'blocking', line,
        'Image without an alt attribute.',
        'Use alt="description" if informative, alt="" if purely decorative. Missing is not the same as empty: a screen reader will read out the file name.');
    }

    // ---------------------------------------------- 4.1.2 button name
    if (!t.isComponent && (name === 'button' || (attrs['role'] === 'button' && name !== 'button'))) {
      if (!labelledByAttr(t) && !attrs['__spread__']) {
        const kind = textualContent(innerRaw(src, tokens, idx));
        if (kind === 'none' || kind === 'element') {
          add(RULES['button-no-name'], 'blocking', line,
            kind === 'none'
              ? 'Button with no accessible name: empty and no aria-label.'
              : 'Icon-only button (children carry no text) with no aria-label: no accessible name.',
            'Add visible text, or aria-label="action" for an icon-only button.');
        } else if (kind === 'component') {
          add(RULES['button-no-name'], 'review', line,
            'Button containing only a component, with no text and no aria-label.',
            'If that component does not already expose an accessible name, add aria-label. Needs a manual check.');
        }
      }
    }

    // ------------------------------------------------- 2.4.4 link name
    if (name === 'a' && !t.isComponent && (hasAttr(t, 'href') || attrs['role'] === 'link')) {
      const inner = innerRaw(src, tokens, idx);
      if (!labelledByAttr(t) && !attrs['__spread__']) {
        const kind = textualContent(inner);
        if (kind === 'none' || kind === 'element') {
          add(RULES['link-no-name'], 'blocking', line,
            'Link with no accessible text.',
            'Add text describing the destination, or aria-label for an icon-only link.');
        } else if (kind === 'component') {
          add(RULES['link-no-name'], 'review', line,
            'Link containing only a component, with no text.',
            'Check that it exposes an accessible name; otherwise add aria-label.');
        }
      }
      const plain = inner.replace(/<[^>]*>/g, '').trim().toLowerCase().replace(/[.!…»"']+$/g, '');
      if (plain && GENERIC_LINK_TEXT.has(plain)) {
        add(RULES['link-generic-text'], 'minor', line,
          `Generic link text: "${plain}". Out of context it says nothing about the destination.`,
          'Use text that describes where it goes ("View the March invoice"), or add aria-label.');
      }
    }

    // --------------------------------------------- 3.3.2 form control labels
    if (!t.isComponent && (name === 'input' || name === 'select' || name === 'textarea')) {
      const type = String(attrStr(attrs['type']) || 'text').toLowerCase();
      const exempt = ['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
      const id = attrs['id'];
      const hasLabel =
        hasAttr(t, 'aria-label') || hasAttr(t, 'aria-labelledby') || hasAttr(t, 'title') ||
        (typeof id === 'string' && labelFor.has(id)) || labelDepth > 0;

      if (!exempt && !hasLabel && !attrs['__spread__']) {
        if (isDynamic(id)) {
          add(RULES['input-no-label'], 'review', line,
            'Field with a dynamic id: the associated label cannot be verified statically.',
            'Check by hand that a matching <label for> exists.');
        } else {
          add(RULES['input-no-label'], 'blocking', line,
            `"${type}" field with no associated label.`,
            'Connect a <label for="id">, or add aria-label. A placeholder is NOT a label: it disappears as soon as the user types.');
        }
      }

      // ------------------------------------------ 1.3.5 autocomplete
      if (!exempt && !hasAttr(t, 'autocomplete')) {
        const hint = String(attrStr(attrs['name']) || attrStr(attrs['id']) || '');
        for (const [re, value] of AUTOCOMPLETE_HINTS) {
          if (re.test(hint)) {
            add(RULES['autocomplete-missing'], 'minor', line,
              `Personal-data field ("${hint}") without an autocomplete attribute.`,
              `Add autocomplete="${value}". A WCAG 2.1 AA criterion, almost always forgotten and trivial to fix.`);
            break;
          }
        }
      }

      if (hasAttr(t, 'autofocus')) {
        add(RULES['autofocus-used'], 'minor', line,
          'autofocus moves focus without the user asking for it.',
          'Remove it, unless the form is the sole purpose of the page.');
      }
    }

    // ------------------------------------------- 2.1.1 keyboard operability
    const clickAttr = ['onclick', 'onclickcapture'].find((a) => hasAttr(t, a));
    if (clickAttr && !t.isComponent && !INTERACTIVE_TAGS.has(name)) {
      const role = String(attrStr(attrs['role']) || '');
      const keyboardOk =
        hasAttr(t, 'onkeydown') || hasAttr(t, 'onkeyup') || hasAttr(t, 'onkeypress') ||
        (hasAttr(t, 'tabindex') && (role === 'button' || role === 'link' || role === 'menuitem'));
      if (!keyboardOk && !attrs['__spread__']) {
        add(RULES['click-no-keyboard'], 'blocking', line,
          `<${name}> has a click handler but cannot be reached by keyboard.`,
          'Use <button>. If you cannot: role="button" + tabIndex={0} + onKeyDown for Enter and Space.');
      }
    }

    // -------------------------------------------- 4.1.2 aria-hidden focusable
    if (ariaHidden) {
      const tabindex = parseInt(String(attrStr(attrs['tabindex'])), 10);
      // For a component we cannot know what it renders: only the signals written
      // explicitly in the source are reliable (href, explicit tabindex).
      const focusable = hasAttr(t, 'href') || (!isNaN(tabindex) && tabindex >= 0)
        || (!t.isComponent && INTERACTIVE_TAGS.has(name));
      if (focusable) {
        add(RULES['aria-hidden-focusable'], 'blocking', line,
          `<${name}> is aria-hidden="true" but still focusable: keyboard users land on it with no idea where they are.`,
          'Remove aria-hidden, or make the element unfocusable (tabindex="-1", disabled).');
      }
    }

    // ---------------------------------------------- 2.4.3 positive tabindex
    const ti = parseInt(String(attrStr(attrs['tabindex'])), 10);
    if (!isNaN(ti) && ti > 0) {
      add(RULES['tabindex-positive'], 'serious', line,
        `tabindex="${ti}" forces a tab order that differs from the visual one.`,
        'Use tabindex="0" and reorder the DOM so it matches the visual order.');
    }

    // -------------------------------------------------------- 4.1.2 valid role
    const roleVal = attrs['role'];
    if (typeof roleVal === 'string' && roleVal.trim()) {
      for (const r of roleVal.trim().split(/\s+/)) {
        if (!VALID_ROLES.has(r.toLowerCase())) {
          add(RULES['role-invalid'], 'serious', line,
            `role="${r}" is not a valid ARIA role: it is ignored entirely.`,
            'Fix it with a valid WAI-ARIA role, or drop it and use the native HTML element.');
        }
      }
    }

    // ------------------------------------------------ 1.3.1 / 2.4.6 headings
    if (HEADING_TAGS.has(name) && !t.isComponent) {
      const lvl = parseInt(name[1], 10);
      if (lastHeading && lvl > lastHeading + 1) {
        add(RULES['heading-skip'], 'serious', line,
          `Heading hierarchy jumps from h${lastHeading} to h${lvl}.`,
          `Use h${lastHeading + 1}. Screen reader users navigating by heading lose the structure.`);
      }
      lastHeading = lvl;
      if (textualContent(innerRaw(src, tokens, idx)) === 'none' && !labelledByAttr(t)) {
        add(RULES['heading-empty'], 'serious', line,
          `Empty <${name}>: it shows up in the screen reader outline saying nothing.`,
          'Give it text, or use a non-heading element if it is only there for styling.');
      }
    }

    // -------------------------------------------------- 1.2.2 video captions
    if (name === 'video' && !t.isComponent) {
      const inner = innerRaw(src, tokens, idx);
      if (!/<track[^>]*kind\s*=\s*["']?(captions|subtitles)/i.test(inner) && !attrs['__spread__']) {
        add(RULES['video-no-captions'], 'serious', line,
          '<video> element with no captions track.',
          '<track kind="captions" src="..." srclang="it" label="Italiano" default>');
      }
    }

    // ------------------------------------------------------ 1.1.1 svg role=img
    if (name === 'svg' && !t.isComponent && String(attrStr(attrs['role'])) === 'img' && !labelledByAttr(t)) {
      const inner = innerRaw(src, tokens, idx);
      if (!/<title\b/i.test(inner)) {
        add(RULES['svg-no-name'], 'serious', line,
          'SVG with role="img" but no accessible name.',
          'Add aria-label, or a <title> as the first child of the svg.');
      }
    }

    // ---------------------------------------------------------- 1.3.1 th scope
    if (name === 'th' && !t.isComponent && !hasAttr(t, 'scope') && !hasAttr(t, 'role') && !attrs['__spread__']) {
      add(RULES['th-no-scope'], 'minor', line,
        '<th> without a scope attribute.',
        'scope="col" or scope="row". Needed so screen readers associate cells with the right headers.');
    }

    // ----------------------------------------------------- 1.4.4 viewport zoom
    if (name === 'meta' && !t.isComponent && String(attrStr(attrs['name'])).toLowerCase() === 'viewport') {
      const content = String(attrStr(attrs['content'])).toLowerCase();
      const maxScale = /maximum-scale\s*=\s*([\d.]+)/.exec(content);
      if (/user-scalable\s*=\s*(no|0)/.test(content) || (maxScale && parseFloat(maxScale[1]) < 2)) {
        add(RULES['viewport-zoom-blocked'], 'serious', line,
          'The viewport meta blocks or limits zoom.',
          'Remove user-scalable=no and maximum-scale. Low-vision users must be able to zoom to 200%.');
      }
    }

    if (name === 'main' || attrs['role'] === 'main') sawMain = true;
    if (name === 'title') {
      if (textualContent(innerRaw(src, tokens, idx)) !== 'none') sawTitle = true;
    }

    // -------------------------------------------------------- 4.1.1 unique ids
    const id = attrs['id'];
    if (typeof id === 'string' && idCount.get(id) > 1 && !reportedDupIds.has(id)) {
      reportedDupIds.add(id);
      add(RULES['duplicate-id'], 'minor', line,
        `id="${id}" appears ${idCount.get(id)} times in the same file.`,
        'Make ids unique: aria-labelledby and label[for] resolve by id, and duplicates point at the wrong target.');
    }
  }

  // ------------------------------------------------ document-level rules
  if (isDocument) {
    const htmlTag = tokens.find((t) => t.type === 'open' && t.name === 'html');
    const langVal = htmlTag ? attrStr(htmlTag.attrs['lang']).trim() : '';
    if (htmlTag && !langVal && !isDynamic(htmlTag.attrs['lang']) && !htmlTag.attrs['__spread__']) {
      add(RULES['html-no-lang'], 'blocking', htmlTag.line,
        hasAttr(htmlTag, 'lang')
          ? '<html lang=""> is empty, which is the same as not having it.'
          : '<html> has no lang attribute: screen readers will use the wrong pronunciation.',
        'lang="en" (or whatever the content language is).');
    }
    if (!sawTitle && /<head[\s>]/i.test(src)) {
      add(RULES['page-no-title'], 'blocking', 1,
        'Document with no non-empty <title>.',
        'Add a descriptive, unique <title>: it is the first thing a screen reader announces.');
    }
    if (!sawMain && /<body[\s>]/i.test(src)) {
      add(RULES['no-main-landmark'], 'minor', 1,
        'No <main> landmark: there is no way to skip past the navigation.',
        'Wrap the primary content in <main>.');
    }
  }
}

function auditStyles(file, src, findings) {
  const add = (rule, severity, line, message, fix) =>
    findings.push({ file, line, rule: rule.id, wcag: rule.wcag, level: rule.level, en: rule.en, severity, message, fix });

  const lineOf = (pos) => src.slice(0, pos).split('\n').length;
  const hasFocusVisibleReplacement = /:focus-visible[^{]*\{[^}]*(outline|box-shadow|border)\s*:/i.test(src);

  // 2.4.7 - focus outline removed with no replacement
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(src)) !== null) {
    const selector = m[1].trim();
    const body = m[2];

    if (/outline\s*:\s*(none|0)(px)?\b/i.test(body)) {
      const replacedHere = /(box-shadow|border)\s*:/i.test(body);
      const isFocusSelector = /:focus/i.test(selector);
      if (!replacedHere && !hasFocusVisibleReplacement && (isFocusSelector || /^\s*(\*|:where\(|a\b|button\b|input\b)/.test(selector))) {
        add(RULES['focus-outline-removed'], 'serious', lineOf(m.index),
          `"${selector.slice(0, 60)}" removes the focus outline without replacing it.`,
          'If you remove outline, provide a visible indicator on :focus-visible (outline, box-shadow or border).');
      }
    }

    // 1.4.3 - only when both colours are literals inside the SAME rule
    const fg = /(?:^|[;{\s])color\s*:\s*([^;}]+)/i.exec(body);
    const bgProp = /(?:^|[;{\s])background(?:-color)?\s*:\s*([^;}]+)/i.exec(body);
    if (fg && bgProp) {
      const c1 = parseColor(fg[1].split(/\s+/)[0]);
      const c2 = parseColor(bgProp[1].split(/\s+/)[0]);
      if (c1 && c2) {
        const ratio = contrastRatio(c1, c2);
        if (ratio < 4.5) {
          const sev = ratio < 3 ? 'serious' : 'review';
          add(RULES['contrast-literal'], sev, lineOf(m.index),
            `Contrast ${ratio.toFixed(2)}:1 between ${fg[1].trim()} and ${bgProp[1].trim()} - below the AA minimum of 4.5:1.`,
            ratio >= 3
              ? 'Only sufficient for large text (>=24px, or >=18.66px bold). Check the actual size, or darken the text.'
              : 'Darken the text or lighten the background until it reaches at least 4.5:1.');
        }
      }
    }
  }
}

// -------------------------------------------------------- rule definitions

const R = (id, wcag, level, name) => ({ id, wcag, level, en: `9.${wcag}`, name });
const RULES = Object.fromEntries([
  R('img-alt-missing', '1.1.1', 'A', 'Non-text Content'),
  R('svg-no-name', '1.1.1', 'A', 'Non-text Content'),
  R('video-no-captions', '1.2.2', 'A', 'Captions (Prerecorded)'),
  R('input-no-label', '3.3.2', 'A', 'Labels or Instructions'),
  R('heading-skip', '1.3.1', 'A', 'Info and Relationships'),
  R('th-no-scope', '1.3.1', 'A', 'Info and Relationships'),
  R('autocomplete-missing', '1.3.5', 'AA', 'Identify Input Purpose'),
  R('contrast-literal', '1.4.3', 'AA', 'Contrast (Minimum)'),
  R('viewport-zoom-blocked', '1.4.4', 'AA', 'Resize Text'),
  R('click-no-keyboard', '2.1.1', 'A', 'Keyboard'),
  R('no-main-landmark', '2.4.1', 'A', 'Bypass Blocks'),
  R('page-no-title', '2.4.2', 'A', 'Page Titled'),
  R('tabindex-positive', '2.4.3', 'A', 'Focus Order'),
  R('link-no-name', '2.4.4', 'A', 'Link Purpose (In Context)'),
  R('link-generic-text', '2.4.4', 'A', 'Link Purpose (In Context)'),
  R('heading-empty', '2.4.6', 'AA', 'Headings and Labels'),
  R('focus-outline-removed', '2.4.7', 'AA', 'Focus Visible'),
  R('autofocus-used', '3.2.1', 'A', 'On Focus'),
  R('html-no-lang', '3.1.1', 'A', 'Language of Page'),
  R('duplicate-id', '4.1.1', 'A', 'Parsing'),
  R('button-no-name', '4.1.2', 'A', 'Name, Role, Value'),
  R('aria-hidden-focusable', '4.1.2', 'A', 'Name, Role, Value'),
  R('role-invalid', '4.1.2', 'A', 'Name, Role, Value'),
].map((r) => [r.id, r]));

// -------------------------------------------------------------- traversal

function walk(dir, out = [], root = dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.') continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(full, out, root);
    } else {
      const ext = extname(entry).toLowerCase();
      if (MARKUP_EXT.has(ext) || STYLE_EXT.has(ext)) out.push(full);
    }
  }
  return out;
}

// ------------------------------------------------------------------- main

function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const positional = args.filter((a) => !a.startsWith('--'));
  const root = positional[0] || process.cwd();
  const maxIdx = args.indexOf('--max');
  const max = maxIdx !== -1 ? parseInt(args[maxIdx + 1], 10) : Infinity;

  const files = walk(root);
  const findings = [];

  for (const file of files) {
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    if (src.length > 2_000_000) continue;
    const rel = relative(root, file).split(sep).join('/');
    const ext = extname(file).toLowerCase();
    try {
      if (MARKUP_EXT.has(ext)) auditMarkup(rel, src, findings);
      if (STYLE_EXT.has(ext)) auditStyles(rel, src, findings);
      if (ext === '.vue' || ext === '.svelte' || ext === '.astro') {
        const styleBlocks = src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
        for (const b of styleBlocks) auditStyles(rel, b[1], findings);
      }
    } catch (err) {
      findings.push({
        file: rel, line: 1, rule: 'internal-error', wcag: '-', level: '-', en: '-',
        severity: 'review', message: `Analysis failed: ${err.message}`,
        fix: 'Please report this file: it is a parser limitation, not a problem in your code.',
      });
    }
  }

  findings.sort((a, b) =>
    SEVERITY[a.severity] - SEVERITY[b.severity] ||
    a.file.localeCompare(b.file) || a.line - b.line);

  const limited = findings.slice(0, max);
  const counts = { blocking: 0, serious: 0, minor: 0, review: 0 };
  for (const f of findings) counts[f.severity]++;

  const result = {
    scanned: files.length,
    root,
    counts,
    total: findings.length,
    truncated: findings.length > limited.length,
    coverage: 'Static subset of WCAG 2.1 AA. Automated testing covers 30-40% of the criteria. This does not certify conformance.',
    findings: limited,
  };

  if (flags.has('--json')) {
    process.stdout.write(JSON.stringify(result, null, 2));
    return;
  }

  const LABEL = { blocking: 'BLOCKING', serious: 'SERIOUS', minor: 'MINOR', review: 'NEEDS REVIEW' };
  console.log(`\neaa-audit - WCAG 2.1 AA / EN 301 549 clause 9`);
  console.log(`${files.length} files scanned in ${root}\n`);
  console.log(`  BLOCKING ${counts.blocking}   SERIOUS ${counts.serious}   MINOR ${counts.minor}   NEEDS REVIEW ${counts.review}\n`);
  let lastSev = null;
  for (const f of limited) {
    if (f.severity !== lastSev) { console.log(`\n── ${LABEL[f.severity]} ──`); lastSev = f.severity; }
    console.log(`  ${f.file}:${f.line}  [${f.wcag} ${f.level} · EN ${f.en}]  ${f.rule}`);
    console.log(`     ${f.message}`);
    console.log(`     → ${f.fix}`);
  }
  if (result.truncated) console.log(`\n  ... and ${findings.length - limited.length} more findings (use --max to raise the limit)`);
  console.log(`\n${result.coverage}\n`);
}

main();

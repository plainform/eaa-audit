#!/usr/bin/env node
/**
 * Regression suite. Run: node test/run.mjs
 *
 * The clean-fixture assertion is the important one: a detector that finds
 * violations in correct code is worse than no detector at all.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const detector = join(here, '..', 'skills', 'eaa-audit', 'scripts', 'detect.mjs');

function scan(target) {
  const out = execFileSync(process.execPath, [detector, join(here, target), '--json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out);
}

const failures = [];
const check = (label, actual, expected) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
};

console.log('\neaa-audit regression suite\n');

// --- the clean fixture must be silent -------------------------------------
const good = scan('fixtures/good.jsx');
console.log('correct code must produce nothing:');
check('good.jsx findings', good.total, 0);

// --- the dirty fixture must catch every rule it exercises ------------------
const all = scan('fixtures');
const bad = { ...all, findings: all.findings.filter((f) => f.file.endsWith('bad.html')) };
console.log('\nknown violations must all be caught:');
check('bad.html blocking', bad.findings.filter((f) => f.severity === 'blocking').length, 8);
check('bad.html serious', bad.findings.filter((f) => f.severity === 'serious').length, 6);
check('bad.html minor', bad.findings.filter((f) => f.severity === 'minor').length, 6);

const expectedRules = [
  'page-no-title', 'html-no-lang', 'img-alt-missing', 'button-no-name', 'link-no-name',
  'input-no-label', 'click-no-keyboard', 'aria-hidden-focusable', 'viewport-zoom-blocked',
  'heading-skip', 'tabindex-positive', 'role-invalid', 'heading-empty', 'video-no-captions',
  'no-main-landmark', 'link-generic-text', 'autocomplete-missing', 'th-no-scope', 'duplicate-id',
];
const seen = new Set(bad.findings.map((f) => f.rule));
console.log('\nevery exercised rule must fire:');
for (const rule of expectedRules) check(rule, seen.has(rule) ? 1 : 0, 1);

// --- every finding must carry its standards mapping ------------------------
console.log('\nevery finding must be traceable to the standards:');
const unmapped = all.findings.filter((f) => !f.wcag || !f.en || !f.en.startsWith('9.'));
check('findings without a WCAG/EN mapping', unmapped.length, 0);

// --- the README must not overstate what ships ------------------------------
// It claimed 24 rules while the table defined 23. A number in the README is a
// claim like any other, and this is the cheapest place to keep it honest.
console.log('\nthe README rule count must match the rule table:');
const detectorSrc = readFileSync(detector, 'utf8');
const ruleCount = (detectorSrc.match(/^\s*R\('/gm) ?? []).length;
const readme = readFileSync(join(here, '..', 'README.md'), 'utf8');
const claimed = readme.match(/^(\d+) rules across WCAG/m);
check('rules defined in detect.mjs', ruleCount, 23);
check('rule count claimed in README', claimed ? Number(claimed[1]) : -1, ruleCount);

// --- the npm package must ship a binary that exists ------------------------
// eaa-lint is the npm name (eaa-audit was already taken on npm by an unrelated
// tool). A bin pointing at a moved file is a package that installs fine and
// fails on first run, which is the worst moment to find out.
console.log('\nthe npm package must be coherent with the repo:');
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
const plugin = JSON.parse(readFileSync(join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8'));
const binPath = join(here, '..', pkg.bin['eaa-lint'] ?? '');
check('bin target exists', existsSync(binPath) ? 1 : 0, 1);
check('bin target is the detector', binPath === detector ? 1 : 0, 1);
check('package version matches plugin manifest', pkg.version === plugin.version ? 1 : 0, 1);
check('package license matches plugin manifest', pkg.license === plugin.license ? 1 : 0, 1);

console.log(failures.length ? `\n${failures.length} FAILED\n` : '\nall green\n');
process.exit(failures.length ? 1 : 0);

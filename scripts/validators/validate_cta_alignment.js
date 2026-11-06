#!/usr/bin/env node
'use strict';
/**
 * Button rows follow their section's text (owner, 6 Nov 2026: on /pricing the "Request a Quote"
 * button sat left under a centred heading, paragraph and date line, because one desktop rule meant
 * for the left-aligned home hero hit every centred hero on the site).
 *
 * Reads the stylesheets the pages load (styles.css, site-nav.css, brand.css, in that order) and
 * fails when:
 *   - a rule moves the button row of a centred section (.hero-centered-cta, .centered-cta-row,
 *     .page-intro/.answer-block/.cta-band .btn-row) off centre (justify-content other than
 *     center/stretch-to-full-width) without being scoped to a left-aligned container
 *     (LEFT_CONTAINERS: the home hero);
 *   - the centring rule itself is missing;
 *   - a published page puts a centred-row class inside the left-aligned home hero's text and
 *     the hero is not left-aligned, or a centred container's button row is marked left.
 * --self-test proves the check rejects both broken shapes. Exits 1 on zero rules read (Rule 0).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SHEETS = ['assets/css/styles.css', 'assets/css/site-nav.css', 'assets/css/brand.css'];
const CENTRED = [/\.hero-centered-cta\b/, /\.centered-cta-row\b/, /\.(?:page-intro|answer-block|cta-band)\s+\.btn-row\b/];
const LEFT_CONTAINERS = [/\.hero-minimal-inner\b/];

function rules(css) {
  const out = [];
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) out.push({ selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean), body: m[2] });
  return out;
}

function check(sheets) {
  const errors = [];
  const all = sheets.flatMap((css) => rules(css));
  if (!all.length) return ['read 0 CSS rules'];
  let centring = false;
  for (const r of all) {
    const jc = (r.body.match(/justify-content:\s*([a-z-]+)/) || [])[1];
    if (!jc) continue;
    for (const sel of r.selectors) {
      if (!CENTRED.some((c) => c.test(sel))) continue;
      const scopedLeft = LEFT_CONTAINERS.some((c) => c.test(sel));
      if (jc === 'center' && !scopedLeft) centring = true;
      if (jc !== 'center' && !scopedLeft) errors.push(`"${sel} { justify-content: ${jc} }" moves a centred section's buttons off centre; scope it to a left-aligned container`);
    }
  }
  if (!centring) errors.push('no rule centres the button rows of centred sections');
  return errors;
}

const sheets = SHEETS.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));
const errors = check(sheets);
// self-test: the two broken shapes must fail
const probes = {
  'the desktop rule that left-aligned every centred hero': [...sheets.slice(0, 2), sheets[2] + '\n@media (min-width: 1024px) { .hero-centered-cta { justify-content: flex-start; } }'],
  'no centring rule': sheets.map((css) => css.replace(/justify-content:\s*center/g, 'justify-content: normal')),
};
for (const [what, s] of Object.entries(probes)) if (!check(s).length) errors.push(`self-test: ${what} PASSED`);
// pages: the home hero is the one left-aligned hero; its CSS must left-align its text too
const brand = sheets[2];
if (!/\.hero-minimal-inner\s*\{[^}]*text-align:\s*left/.test(brand)) errors.push('the home hero buttons are left-aligned but its text is not');

if (errors.length) {
  console.error(`cta-alignment: FAIL (${errors.length})`);
  errors.forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`cta-alignment: OK - centred sections centre their button rows at every width; only the left-aligned home hero keeps them left; ${Object.keys(probes).length} broken fixtures rejected`);

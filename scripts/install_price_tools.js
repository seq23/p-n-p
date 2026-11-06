#!/usr/bin/env node
'use strict';
/**
 * Puts the two price tools ("Price my porch", "Price my grazing table") at the top of /pricing,
 * straight under the page intro and above the pricing cards (owner, 6 Nov 2026). The block is
 * scripts/lib/price_tools.js between <!--price-tools--> markers, re-rendered on every run.
 * Idempotent; exits non-zero when /pricing has no intro to anchor on (Rule 0).
 */
const fs = require('fs');
const path = require('path');
const { pricingBlockHtml } = require('./lib/price_tools');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'pricing.html');
const BLOCK_RE = /<!--price-tools-->[\s\S]*?<!--\/price-tools-->/;
// The intro closes and the four pricing cards open inside the first section; the tools go
// between them as their own section.
const ANCHOR_RE = /(<\/div>)(<div class="pricing-grid pricing-grid--four">)/;

function apply(html) {
  let out = html.replace(BLOCK_RE, '');
  // A tools section split the first section in two: close it, open a new one for the cards.
  out = out.replace('</div></section><!--/price-tools-split--><section class="section"><div class="container">', '');
  const m = ANCHOR_RE.exec(out);
  if (!m) throw new Error('pricing.html: no intro + pricing cards to put the price tools between');
  const at = m.index + m[1].length;
  return out.slice(0, at) + `</div></section>${pricingBlockHtml()}<!--/price-tools-split--><section class="section"><div class="container">` + out.slice(at);
}

if (require.main === module) {
  const before = fs.readFileSync(FILE, 'utf8');
  const after = apply(before);
  if (after !== before) fs.writeFileSync(FILE, after);
  console.log(`price-tools: pricing.html ${after === before ? 'already current' : 'updated'} (Price my porch + Price my grazing table at the top)`);
}
module.exports = { apply };

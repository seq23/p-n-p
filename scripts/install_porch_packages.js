#!/usr/bin/env node
'use strict';
/**
 * Retrofit pass (owner-approved 18 Oct 2026): stamps the full porch package grid and its
 * Offer / PriceSpecification JSON-LD into every page listed in
 * data/offers/porch_packages.json `pages` (the porch service pages, /pricing and the porch
 * articles). Markup and schema come only from scripts/lib/porch_packages.js reading that
 * data file, so a price change is one edit there plus this pass.
 *
 *   <!--porch-packages--> ... <!--/porch-packages-->   right before the page's cta-band
 *   <script type="application/ld+json" data-porch-packages>  right before </head>
 *
 * Idempotent (a second run changes nothing). Exits non-zero when a listed page is
 * missing, has no cta-band or </head> to anchor to, or the list is empty, so it can never
 * succeed having done nothing. npm run validate:porch-packages fails when a page is stale.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PP = require('./lib/porch_packages');

const BLOCK_RE = /<!--porch-packages-->[\s\S]*?<!--\/porch-packages-->/;
const LD_RE = /<script type="application\/ld\+json" data-porch-packages>[\s\S]*?<\/script>/;
const CTA = '<section class="section cta-band">';

function canonicalOf(html, domain, rel) {
  const m = html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]+)"|<link[^>]*href="([^"]+)"[^>]*rel="canonical"/);
  return m ? (m[1] || m[2]) : `${domain}/${rel.replace(/\.html$/, '')}`;
}

/** The page with the current block and schema; throws when it has nowhere to put them. */
function applyPorchPackages(html, rel, pk, domain) {
  const block = PP.pageBlockHtml(pk);
  const ld = `<script type="application/ld+json" data-porch-packages>${JSON.stringify(PP.schemaNode(pk, { domain, url: canonicalOf(html, domain, rel) }))}</script>`;
  let out = html;
  if (BLOCK_RE.test(out)) out = out.replace(BLOCK_RE, () => block);
  else if (out.includes(CTA)) out = out.replace(CTA, () => `${block}\n${CTA}`);
  else throw new Error(`${rel}: no "${CTA}" to put the porch packages before`);
  if (LD_RE.test(out)) out = out.replace(LD_RE, () => ld);
  else if (out.includes('</head>')) out = out.replace('</head>', () => `${ld}\n</head>`);
  else throw new Error(`${rel}: no </head> for the porch packages schema`);
  return out;
}

function main() {
  const pk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/porch_packages.json'), 'utf8'));
  const { domain } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
  if (!Array.isArray(pk.pages) || !pk.pages.length) { console.error('porch-packages: data/offers/porch_packages.json lists no pages'); process.exit(1); }
  let changed = 0;
  for (const rel of pk.pages) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { console.error(`porch-packages: ${rel} is listed but missing`); process.exit(1); }
    const html = fs.readFileSync(abs, 'utf8');
    const out = applyPorchPackages(html, rel, pk, domain);
    if (out !== html) { fs.writeFileSync(abs, out); changed += 1; }
  }
  console.log(`porch-packages: ${pk.pages.length} page(s) checked, ${changed} updated, ${pk.pages.length - changed} already current`);
}

if (require.main === module) main();
module.exports = { applyPorchPackages, BLOCK_RE, LD_RE };

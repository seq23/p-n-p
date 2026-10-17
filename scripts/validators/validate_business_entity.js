#!/usr/bin/env node
'use strict';
/**
 * One business entity (owner-approved 2026-10-16). Google, Bing and AI
 * assistants must see porchandparty901.com, the Google Business Profile and
 * the Facebook Page as ONE business. Hard-fails when, on any published page
 * (404.html excepted, it is noindex):
 *   - there is no full business node (LocalBusiness with name + url),
 *   - there is more than one full business node,
 *   - the business node has no @id or not the stable #business @id,
 *   - its sameAs lacks the Facebook Page or the Maps cid URL, or hasMap is not the cid URL,
 *   - any @id reference to #business is left dangling,
 *   - the footer lacks the visible Facebook Page / Google Maps links, or its
 *     phone/email differ from the JSON-LD (NAP must be identical).
 * Also fails on zero pages scanned. Values: data/offers/services.json contact.
 */
const fs = require('fs');
const path = require('path');
const { CONTACT: C, BUSINESS_ID } = require('../lib/contact_surface');
const { publishedPages } = require('../install_contact_surface');

const ROOT = path.resolve(__dirname, '../..');
const FB = 'https://www.facebook.com/porchandparty901';
const MAPS = 'https://www.google.com/maps?cid=1437103205402862394';
const ID = 'https://porchandparty901.com/#business';
const EXEMPT = new Set(['404.html']);
const errors = [];
const fail = (m) => errors.push(m);

if (C.facebookPageUrl !== FB) fail(`services.json contact.facebookPageUrl is ${C.facebookPageUrl}, expected ${FB}`);
if (C.googleBusinessProfileUrl !== MAPS) fail(`services.json contact.googleBusinessProfileUrl is ${C.googleBusinessProfileUrl}, expected ${MAPS}`);
if (BUSINESS_ID !== ID) fail(`business @id is ${BUSINESS_ID}, expected ${ID}`);

const typesOf = (n) => [].concat((n && n['@type']) || []);
const isFull = (n) => typesOf(n).includes('LocalBusiness') || (typesOf(n).includes('Organization') && n.name === 'Porch & Party');

function scan(node, acc) {
  if (Array.isArray(node)) { node.forEach((n) => scan(n, acc)); return; }
  if (!node || typeof node !== 'object') return;
  if (isFull(node)) acc.full.push(node);
  else if (node['@id'] === ID) acc.refs += 1;
  Object.values(node).forEach((v) => scan(v, acc));
}

const pages = publishedPages().filter((p) => !EXEMPT.has(p));
if (!pages.length) fail('found 0 published pages');
for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const acc = { full: [], refs: 0 };
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { scan(JSON.parse(m[1]), acc); } catch (e) { fail(`${rel}: unparseable JSON-LD (${e.message})`); }
  }
  if (acc.full.length === 0) { fail(`${rel}: no business node`); continue; }
  if (acc.full.length > 1) fail(`${rel}: ${acc.full.length} business nodes (exactly one allowed; others must be {"@id": "${ID}"})`);
  const b = acc.full[0];
  if (!b['@id']) fail(`${rel}: business node has no @id`);
  else if (b['@id'] !== ID) fail(`${rel}: business node @id is ${b['@id']}, expected ${ID}`);
  const same = [].concat(b.sameAs || []);
  for (const u of [FB, MAPS]) if (!same.includes(u)) fail(`${rel}: business sameAs lacks ${u}`);
  if (b.hasMap !== MAPS) fail(`${rel}: business hasMap is ${JSON.stringify(b.hasMap)}, expected ${MAPS}`);
  if (b.name !== 'Porch & Party' || b.url !== 'https://porchandparty901.com/') fail(`${rel}: business name/url is ${b.name} / ${b.url}`);
  if ('address' in b) fail(`${rel}: business node carries an address; it is a service-area business with no public street address`);
  const footer = html.slice(html.indexOf('<footer'));
  if (html.indexOf('<footer') < 0) { fail(`${rel}: no <footer>`); continue; }
  if (!footer.includes(`href="${FB}"`)) fail(`${rel}: footer lacks the Facebook Page link`);
  if (!footer.includes(`href="${MAPS}"`) || !footer.includes('Find us on Google Maps')) fail(`${rel}: footer lacks the "Find us on Google Maps" link`);
  if (!footer.includes(`href="tel:+${b.telephone.replace(/\D/g, '')}"`)) fail(`${rel}: footer phone does not match JSON-LD telephone ${b.telephone}`);
  if (!footer.includes(`mailto:${b.email}`)) fail(`${rel}: footer email does not match JSON-LD email ${b.email}`);
}

if (errors.length) {
  console.error(`business-entity: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 40)) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`business-entity: ${pages.length} page(s), one #business node each, sameAs Facebook + Maps, footer links present`);

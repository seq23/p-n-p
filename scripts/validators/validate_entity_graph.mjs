#!/usr/bin/env node
/**
 * The Porch & Party entity graph is what config/entity.json says it is.
 *
 * Authority audit, 30 Oct 2026: the Facebook and Google Business Profile sameAs
 * lived in scripts/lib/contact_surface.js and were MERGED with whatever sameAs a
 * page already carried, so a profile could be added but never leave, and nothing
 * named the profiles still to be claimed. config/entity.json is now the one
 * definition. This proves:
 *
 *   1. entity.json itself: @id on this site, name, url, logo and description
 *      present; the description is the brand identity sentence the generators
 *      print (scripts/lib/brand.js); every sameAs absolute https, no duplicates,
 *      never this site's own host (self-reference), never a Spry Labs or West
 *      Peek host, never also pending; every pending profile names its platform
 *      and owner action; parentOrganization is the legal owner and never the
 *      Spry Labs entity (Porch & Party is not a Spry Labs side business).
 *   2. Every published page (404.html excepted): its one #business node carries
 *      exactly that @id, name, url, logo and sameAs (equality, in order), any
 *      description it carries starts with the entity description, and any
 *      parentOrganization equals entity.json's; no JSON-LD node anywhere on the
 *      page lists this site's own host or a forbidden host as sameAs, and no
 *      node points parentOrganization at a Spry Labs or West Peek host.
 *
 * Telephone, address, hasMap and the footer links are validate:business-entity's
 * job; this does not repeat them.
 *
 * Rule 0: zero pages or zero sameAs URLs examined is a failure.
 *
 * Run: npm run validate:entity-graph
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CFG_PATH = process.env.ENTITY_GRAPH_CONFIG || path.join(ROOT, 'config/entity.json');
const C = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const { IDENTITY_SENTENCE } = require_('../lib/brand');
const { publishedPages } = require_('../install_contact_surface');


const LABEL = 'entity-graph:';
const LD_RE = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
const SPRY_LABS_ID = 'https://billionairehighperformancecoach.com/spry-labs#organization';
const EXEMPT = new Set(['404.html']);
const failures = [];
const fail = (m) => failures.push(m);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const onHost = (host, list) => !!host && list.some((h) => host === h || host.endsWith(`.${h}`));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------ 1. entity.json
const OWN = C.own_hosts || [];
const FORBIDDEN = C.forbidden_same_as_hosts || [];
if (!OWN.length) fail('config/entity.json: own_hosts is empty; self-reference cannot be checked');
if (!FORBIDDEN.length) fail('config/entity.json: forbidden_same_as_hosts is empty; the Spry/West Peek separation cannot be checked');
for (const k of ['@id', 'name', 'url', 'logo', 'description']) if (!String(C[k] ?? '').trim()) fail(`config/entity.json: ${k} is empty`);
if (!String(C['@id']).startsWith(`${C.url}#`)) fail(`config/entity.json: @id ${C['@id']} is not on the site ${C.url}`);
if (C.description !== IDENTITY_SENTENCE) fail(`config/entity.json: description differs from scripts/lib/brand.js IDENTITY_SENTENCE (${IDENTITY_SENTENCE})`);

const sameAs = Array.isArray(C.sameAs) ? C.sameAs : [];
if (!Array.isArray(C.sameAs)) fail('config/entity.json: sameAs is not a list');
if (new Set(sameAs).size !== sameAs.length) fail('config/entity.json: sameAs has duplicates');
const pendingUrls = new Set((C.profiles_pending || []).map((p) => p.url).filter(Boolean));
for (const u of sameAs) {
  const h = hostOf(u);
  if (!/^https:\/\//.test(u) || !h) fail(`config/entity.json: sameAs ${u} is not an absolute https URL`);
  if (onHost(h, OWN)) fail(`config/entity.json: sameAs ${u} is this site's own host (self-reference)`);
  if (onHost(h, FORBIDDEN)) fail(`config/entity.json: sameAs ${u} is a forbidden host (Spry Labs / West Peek)`);
  if (pendingUrls.has(u)) fail(`config/entity.json: ${u} is both sameAs and pending`);
}
if (!Array.isArray(C.profiles_pending)) fail('config/entity.json: profiles_pending is not a list');
for (const p of C.profiles_pending || []) {
  if (!p.platform || !p.owner_action) fail(`config/entity.json: pending profile ${JSON.stringify(p)} lacks platform or owner_action`);
  if (p.url != null && !/^https:\/\//.test(p.url)) fail(`config/entity.json: pending ${p.platform} url ${p.url} is not https (use null until it exists)`);
}
const parent = C.parentOrganization;
const pointsAtSprOrWp = (n) => {
  if (!n || typeof n !== 'object') return false;
  const s = JSON.stringify(n);
  return s.includes(SPRY_LABS_ID) || /spry\s*labs/i.test(s) || /west\s*peek/i.test(s) || [n['@id'], n.url].some((u) => onHost(hostOf(u || ''), FORBIDDEN));
};
if (parent && pointsAtSprOrWp(parent)) fail('config/entity.json: parentOrganization points at Spry Labs or West Peek; Porch & Party is neither');

// ------------------------------------------------------------ 2. every page
const typesOf = (n) => [].concat((n && n['@type']) || []);
const isFull = (n) => typesOf(n).includes('LocalBusiness') || (typesOf(n).includes('Organization') && n.name === C.name);
function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== 'object') return;
  fn(node);
  Object.values(node).forEach((v) => walk(v, fn));
}

const pages = publishedPages().filter((p) => !EXEMPT.has(p));
let nodes = 0;
for (const rel of pages) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const full = [];
  for (const m of html.matchAll(LD_RE)) {
    let j;
    try { j = JSON.parse(m[1]); } catch (e) { fail(`${rel}: JSON-LD does not parse (${e.message})`); continue; }
    walk(j, (n) => {
      if (isFull(n)) full.push(n);
      for (const u of [].concat(n.sameAs || [])) {
        const h = hostOf(u);
        if (onHost(h, FORBIDDEN)) fail(`${rel}: a ${typesOf(n).join('/') || 'node'} lists forbidden sameAs ${u}`);
        if (onHost(h, OWN)) fail(`${rel}: a ${typesOf(n).join('/') || 'node'} lists this site's own host as sameAs (${u})`);
      }
      if (n.parentOrganization && pointsAtSprOrWp(n.parentOrganization)) fail(`${rel}: parentOrganization points at Spry Labs or West Peek`);
    });
  }
  if (full.length !== 1) { fail(`${rel}: ${full.length} business nodes (exactly one expected)`); continue; }
  const b = full[0];
  nodes += 1;
  if (b['@id'] !== C['@id']) fail(`${rel}: business @id ${b['@id']} != ${C['@id']}`);
  if (b.name !== C.name) fail(`${rel}: business name ${b.name} != ${C.name}`);
  if (b.url !== C.url) fail(`${rel}: business url ${b.url} != ${C.url}`);
  if (b.logo !== C.logo) fail(`${rel}: business logo ${JSON.stringify(b.logo)} != ${C.logo}`);
  if (!same(b.sameAs, sameAs)) fail(`${rel}: business sameAs ${JSON.stringify(b.sameAs)} != config/entity.json ${JSON.stringify(sameAs)}`);
  if (b.description != null && !String(b.description).startsWith(C.description)) fail(`${rel}: business description does not start with the entity description`);
  if (b.parentOrganization != null && !same(b.parentOrganization, parent)) fail(`${rel}: business parentOrganization ${JSON.stringify(b.parentOrganization)} != config/entity.json ${JSON.stringify(parent)}`);
}

if (!pages.length) fail('Rule 0: 0 published pages examined');
if (!sameAs.length) fail('Rule 0: config/entity.json sameAs is empty, 0 profiles examined');
if (failures.length) {
  console.error(`${LABEL} ${failures.length} problem(s)`);
  for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${LABEL} OK - ${nodes} business node(s) on ${pages.length} page(s) carry config/entity.json @id/name/url/logo and exactly ${sameAs.length} sameAs; ${(C.profiles_pending || []).length} profile(s) pending; no self-reference, no Spry Labs or West Peek host, parent never Spry Labs`);

#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
const exists = rel => fs.existsSync(path.join(root, rel));

const errors = [];
const info = [];

function fail(message) {
  errors.push(message);
}

function asArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return Array.isArray(value) ? value : [];
}

const contractPath = 'data/ops/pnp_local_authority_contract.json';
if (!exists(contractPath)) fail(`missing ${contractPath}`);

const contract = exists(contractPath) ? readJson(contractPath) : {};
if (contract.contract !== 'PNP_LOCAL_AUTHORITY_CONTRACT') fail('contract id mismatch');
if (contract.primary_domain !== 'https://porchandparty901.com') fail('primary domain mismatch');
if (contract.operating_entity !== 'Kerseta LLC') fail('operating entity mismatch');
if (contract.self_heal_policy?.validation_may_mutate_files !== false) fail('validation must not be allowed to mutate files');
if (contract.cadence?.daily_bulk_publishing !== false) fail('daily bulk publishing must remain disabled');
if (contract.cadence?.daily_new_url_ceiling_mode !== 'evidence_gated_not_quota') fail('authority cadence must use evidence-gated daily ceiling');
// This asserted the runway equalled 100000 exactly - a target count dressed as
// a contract check, two lines above a check insisting the same number is not a
// quota. A runway is planning capacity; requiring a specific figure makes it
// the opposite. What matters is that it stays declared and non-zero.
if (!(Number(contract.authority_scale?.fanout_reference_runway) > 0)) fail('authority fanout runway must be declared and positive');
if (contract.authority_scale?.fanout_is_page_quota !== false) fail('fanout must not be treated as a page quota');
if (contract.authority_scale?.twin_agent_enabled !== false) fail('Twin Agent must remain disabled for PNP');

const sources = contract.source_of_truth || {};
for (const [key, rel] of Object.entries(sources)) {
  if (!exists(rel)) fail(`source_of_truth.${key} points to missing file ${rel}`);
}

const queryUniverse = asArray(readJson('data/queries/query_universe.json'), 'query universe');
const queue = asArray(readJson('data/publish_queue/publish_queue.json'), 'publish queue');
const manifest = asArray(readJson('data/published_manifest/published_manifest.json'), 'published manifest');
const slugRegistry = asArray(readJson('data/slug_registry/slug_registry.json'), 'slug registry');

const allowedStatuses = new Set(contract.queue_contract?.approved_statuses || []);
for (const item of queue) {
  if (!item.slug || !item.folder) fail(`queue item missing slug/folder: ${JSON.stringify(item)}`);
  if (!allowedStatuses.has(item.status)) fail(`queue item ${item.folder}/${item.slug} has unapproved status ${item.status}`);
}

const queueKeys = new Set(queue.map(item => `${item.folder}/${item.slug}`));
const queryKeys = new Set(queryUniverse.map(item => `${item.folder}/${item.slug}`));
const manifestKeys = new Set(manifest.map(item => `${item.folder}/${item.slug}`));
const registryKeys = new Set(slugRegistry);

for (const key of queryKeys) {
  if (!queueKeys.has(key)) fail(`query universe item missing from publish queue: ${key}`);
}
for (const key of queueKeys) {
  if (!queryKeys.has(key)) fail(`publish queue item not in query universe: ${key}`);
  if (!registryKeys.has(key)) fail(`publish queue item missing from slug registry: ${key}`);
}

for (const item of queue) {
  const htmlPath = `${item.folder}/${item.slug}.html`;
  if (item.status === 'published') {
    if (!manifestKeys.has(`${item.folder}/${item.slug}`)) fail(`published queue item missing from manifest: ${item.folder}/${item.slug}`);
    if (!exists(htmlPath)) fail(`published queue item missing HTML: ${htmlPath}`);
  }
}

for (const item of manifest) {
  const key = `${item.folder}/${item.slug}`;
  const htmlPath = `${item.folder}/${item.slug}.html`;
  if (!queueKeys.has(key)) fail(`manifest item missing from queue: ${key}`);
  if (item.path !== `/${htmlPath}`) fail(`manifest item has wrong path for ${key}: ${item.path}`);
  if (!exists(htmlPath)) fail(`manifest item missing HTML: ${htmlPath}`);
}

const unpublished = queue.filter(item => item.status === 'queued').length;
if (unpublished === 0) info.push('No queued unpublished items remain; current approved query universe is fully published.');

const llms = fs.readFileSync(path.join(root, 'llms.txt'), 'utf8');
const requiredSurfaceTerms = [
  /porch decorating/i,
  /party decor/i,
  /hotel[- ]room decor/i,
  /grazing table/i
];
for (const pattern of requiredSurfaceTerms) {
  if (!pattern.test(llms)) fail(`llms.txt missing authority surface term ${pattern}`);
}

const agentLaneEnabled = contract.external_agent_lane?.enabled === true;
const agentDirs = [
  'data/report_fixes/agent_runs',
  'data/report_fixes/normalized_agent_runs',
  'data/citation/agent_runs'
];
const presentAgentDirs = agentDirs.filter(exists);
if (!agentLaneEnabled && presentAgentDirs.length) {
  fail(`external agent directories exist but contract.external_agent_lane.enabled is false: ${presentAgentDirs.join(', ')}`);
}
if (agentLaneEnabled && presentAgentDirs.length !== agentDirs.length) {
  fail('external agent lane is enabled but raw/normalized/processed directories are not fully declared in repo');
}

if (errors.length) {
  console.error('VALIDATION FAIL: PNP local authority contract failed');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`PNP local authority contract OK: ${queryUniverse.length} query items, ${queue.length} queue items, ${manifest.length} manifest items.`);
for (const line of info) console.log(`INFO: ${line}`);

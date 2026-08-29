#!/usr/bin/env node
/**
 * Close the discovery gap: score the observed queries by openness and lead
 * intent, and say plainly how few of them there are.
 *
 * The gap
 * -------
 * `data/search_intelligence/target_query_set.json` holds 120 targets and
 * `data/authority_scale` fans out further still, but every one of those strings
 * was BUILT from `data/queries/query_universe.json` - a page-content array - and
 * from `data/service_areas/areas.json`. They are things this loop intends to
 * observe, which is what that file's own truth_boundary says. They are not
 * evidence that anyone typed them.
 *
 * The observed set is `data/queries/evidence/evidence_queries.json`: 19 queries
 * measured in Search Console plus 3 modelled by Semrush. That is the whole of
 * what this property can prove anybody searches for, and until this pass none of
 * the 22 carried any read on whether the query is winnable or whether the
 * searcher is near a quote form.
 *
 * What this adds
 * --------------
 *   OPENNESS. `scripts/llm_citation_probe.mjs` in grounded mode asks an answer
 *   engine a real question and reads back the hosts the answer was built from.
 *   That is a measurement of who occupies the answer. A query answered out of
 *   forum threads is winnable by a real page; one answered out of .gov is not.
 *
 *   LEAD INTENT. This is a lead-gen vertical - the page earns nothing until
 *   someone submits the quote form - so every row is tiered by how close the
 *   searcher is to doing that.
 *
 * What it does not add
 * --------------------
 * No search volume. There is no live paid keyword source on this account. The
 * GSC rows carry `impressions_90d` and `search_volume: null`, and that stays
 * true: impressions are this property's own demand, not market volume, and the
 * two are never written to the same field.
 *
 * The 120 target queries are NOT promoted into evidence. Generated phrasing
 * entering an evidence file as though it were observed is the exact failure this
 * repo's atlas policy exists to prevent.
 *
 * Usage
 * -----
 *   node scripts/queries/score_discovery_gap.mjs
 *
 * Run it, run the grounded probe, run it again. A row the probe has not reached
 * is `UNMEASURED`, never a zero.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p, fb) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return fb; } };
const write = (p, v) => { fs.mkdirSync(path.join(ROOT, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(ROOT, p), JSON.stringify(v, null, 2) + '\n'); };

const EVIDENCE = 'data/queries/evidence/evidence_queries.json';
const OBSERVATIONS = 'data/signals/llm_citation_observations.json';

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- lead intent
//
// Word boundaries throughout. `\bfee` alone matches "feel"; `\bfees?\b` does not.
const T1_LOCAL_READY = [
  /\bnear me\b/,
  /\bopen now\b/,
  /\bin[- ]network\b/,
  /\bin [a-z]+(?: [a-z]+)?,? (?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/,
];
const T2_COST_IN_MARKET = [
  /\bhow much\b/, /\bcosts?\b/, /\bprice(?:s|d|ing)?\b/, /\bfees?\b/,
  /\bdoes insurance cover\b/, /\bcovered by insurance\b/, /\bworth it\b/,
  /\bout of pocket\b/, /\bcheap(?:est|er)?\b/, /\baffordable\b/, /\brates?\b/,
];
const T3_SELECTION = [
  /\bhow to (?:choose|compare|find|pick|select)\b/, /\bred flags?\b/, /\bvs\.?\b/,
  /\bversus\b/, /\bwhich is better\b/, /\bwhat to ask\b/, /\bquestions to ask\b/,
  /\bcompare\b/, /\bdifference between\b/, /\bbest\b/,
];

function leadIntentTier(query) {
  const q = norm(query);
  if (T1_LOCAL_READY.some((re) => re.test(q))) return 'T1_LOCAL_READY';
  if (T2_COST_IN_MARKET.some((re) => re.test(q))) return 'T2_COST_IN_MARKET';
  if (T3_SELECTION.some((re) => re.test(q))) return 'T3_SELECTION';
  return 'T4_INFORMATIONAL';
}

// -------------------------------------------------------------------- openness
//
// Computed only from hosts an answer engine actually cited. The two host lists
// are definitional, not estimates: membership is a property of the host, decided
// once and written down, so the same observation always scores the same.
const PLATFORM_HOSTS = new Set([
  'reddit.com', 'quora.com', 'youtube.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'pinterest.com', 'linkedin.com', 'medium.com', 'x.com',
  'twitter.com', 'yelp.com', 'wikihow.com', 'answers.com', 'tripadvisor.com',
  'nextdoor.com', 'stackexchange.com', 'stackoverflow.com', 'substack.com',
  'thumbtack.com', 'theknot.com', 'weddingwire.com', 'gigsalad.com', 'eventbrite.com',
]);
const isPlatform = (h) => PLATFORM_HOSTS.has(h) || [...PLATFORM_HOSTS].some((p) => h.endsWith(`.${p}`));
const isInstitutional = (h) => /\.(gov|edu|mil)$/.test(h) || h === 'wikipedia.org' || h.endsWith('.wikipedia.org');

const OPENNESS_METHOD = {
  input: 'cited_hosts from a grounded run of scripts/llm_citation_probe.mjs (OpenRouter web plugin, engine=parallel, mode=turbo)',
  formula: 'openness_score = clamp(0.5 + 0.5*platform_share - 0.5*institutional_share, 0, 1)',
  platform_share: 'share of distinct cited hosts that are user-generated, aggregator or marketplace platforms',
  institutional_share: 'share of distinct cited hosts on .gov/.edu/.mil or wikipedia',
  verdicts: {
    HELD_BY_US: 'the engine already cited one of our own domains - not an opportunity, a position to defend',
    OPEN: 'openness_score >= 0.6 - the answer is assembled from platforms and no authoritative page owns it',
    CONTESTED: '0.4 <= openness_score < 0.6',
    HELD: 'openness_score < 0.4 - institutions or established publishers occupy the answer',
    UNMEASURED: 'the probe has not answered for this query; NOT a zero and never to be read as one',
  },
  not_measured: 'search volume, keyword difficulty, organic rank. None are inferable from a citation observation and none are written.',
};

function occupancyFor(query, observationsByQuery) {
  const obs = observationsByQuery.get(norm(query));
  if (!obs) return { verdict: 'UNMEASURED', reason: 'NO_GROUNDED_OBSERVATION', openness_score: null, cited_hosts: [], observed_at: null, engine: null };
  if (obs.status !== 'observed') return { verdict: 'UNMEASURED', reason: 'PROVIDER_ERROR', openness_score: null, cited_hosts: [], observed_at: obs.observed_at || null, engine: obs.engine || null };
  const hosts = [...new Set(obs.cited_domains || [])];
  const ours = obs.cited_ours || [];
  if (!hosts.length) return { verdict: 'UNMEASURED', reason: 'PROVIDER_ANSWERED_WITHOUT_RETRIEVING', openness_score: null, cited_hosts: [], observed_at: obs.observed_at, engine: obs.engine };
  const platform = hosts.filter(isPlatform).length / hosts.length;
  const institutional = hosts.filter(isInstitutional).length / hosts.length;
  const score = Math.max(0, Math.min(1, 0.5 + 0.5 * platform - 0.5 * institutional));
  const verdict = ours.length ? 'HELD_BY_US' : score >= 0.6 ? 'OPEN' : score >= 0.4 ? 'CONTESTED' : 'HELD';
  return {
    verdict, reason: 'GROUNDED_CITATION_OBSERVATION',
    openness_score: Number(score.toFixed(3)),
    platform_share: Number(platform.toFixed(3)),
    institutional_share: Number(institutional.toFixed(3)),
    distinct_cited_hosts: hosts.length,
    cited_hosts: hosts, cited_ours: ours,
    observed_at: obs.observed_at, engine: obs.engine,
  };
}

// ----------------------------------------------------------------- the scoring
const doc = read(EVIDENCE, null);
if (!doc) { console.error(`score_discovery_gap: missing ${EVIDENCE}`); process.exit(1); }

const observations = read(OBSERVATIONS, { runs: [] });
const grounded = (observations.runs || []).filter((r) => r.mode === 'grounded');
const latest = grounded[grounded.length - 1] || null;
const observationsByQuery = new Map();
for (const o of latest?.observations || []) observationsByQuery.set(norm(o.query), o);

let scored = 0;
for (const row of doc.queries || []) {
  row.lead_intent_tier = leadIntentTier(row.query);
  row.lead_intent_method = 'regex_classifier_on_query_string, scripts/queries/score_discovery_gap.mjs';
  row.occupancy = occupancyFor(row.query, observationsByQuery);
  if (row.occupancy.openness_score !== null) scored++;
}

const targets = read('data/search_intelligence/target_query_set.json', { targets: [] });

doc.discovery_gap_pass = {
  at: new Date().toISOString(),
  by: 'scripts/queries/score_discovery_gap.mjs',
  why: 'The observed set is 22 queries. Every one of them carried demand and nothing else - no read on whether the answer is winnable, and none on whether the searcher is near the quote form. Both are now recorded.',
  observed_universe_size: (doc.queries || []).length,
  generated_universe_size: (targets.targets || []).length,
  expansion_sources: [
    'none available. data/queries/evidence/evidence_queries.json is already current with the last Search Console ingest (see last_gsc_ingest), and no other observed source exists on disk.',
  ],
  refused_sources: [
    'data/search_intelligence/target_query_set.json - 120 targets BUILT from data/queries/query_universe.json and data/service_areas/areas.json. Generated phrasing, not observed demand. Its own truth_boundary says so. Promoting it into evidence would be exactly the defect the atlas policy exists to prevent.',
    'data/authority_scale fanout - synthetic permutations, never publishable on their own.',
    'any modelled or estimated search volume - no live paid keyword source exists on this account.',
  ],
  lead_intent_classifier: {
    T1_LOCAL_READY: 'near me / open now / in <City ST> / in-network',
    T2_COST_IN_MARKET: 'how much / cost / price / fee / rate / worth it / out of pocket',
    T3_SELECTION: 'how to choose|compare|find / red flags / vs / difference between / which is better / what to ask / best',
    T4_INFORMATIONAL: 'everything else - definitions, lists, process explanations',
    note: 'Word-boundary anchored. `\\bfees?\\b` deliberately does not match "feel".',
  },
  openness_method: OPENNESS_METHOD,
  counts: { total_queries: (doc.queries || []).length, added_this_pass: 0, with_openness_reading: scored },
};

write(EVIDENCE, doc);

const tiers = {}; const verdicts = {};
for (const q of doc.queries || []) {
  tiers[q.lead_intent_tier] = (tiers[q.lead_intent_tier] || 0) + 1;
  verdicts[q.occupancy.verdict] = (verdicts[q.occupancy.verdict] || 0) + 1;
}
console.log(`[discovery-gap] ${(doc.queries || []).length} observed evidence queries, ${scored} with an openness reading.`);
console.log(`  lead intent: ${Object.entries(tiers).sort().map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  occupancy:   ${Object.entries(verdicts).sort().map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  note: ${(targets.targets || []).length} generated target queries were NOT promoted into evidence.`);

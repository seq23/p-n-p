#!/usr/bin/env node
/**
 * Ask an answer engine a real question and record whether it cites us.
 *
 * This is the measurement the portfolio did not have. The existing
 * query:test:zero-cost task makes no network calls at all - it prints a
 * worksheet and a CSV for a human to fill in by hand - so nothing has ever
 * observed whether these pages are cited. Every statement about AEO progress up
 * to now has been inference from proxies.
 *
 * Grounded mode asks OpenRouter with its web plugin enabled, and the response
 * carries the sources the answer was actually built from as url_citation
 * annotations. That is a citation observation: the query, the engine, the domains
 * it cited, and whether any of them are ours.
 *
 * It does NOT use Gemini grounding. That path is hard-blocked on this project's
 * key - plain generateContent returns 200, the same call with
 * tools:[{google_search:{}}] returns 429 RESOURCE_EXHAUSTED across every model
 * tried - so every grounded run routed to it produced errors while still printing
 * a rate.
 *
 * What this does not claim: one engine is not all engines, grounding metadata is
 * not identical to what a user sees in an AI Overview, and absence on a given
 * day is weak evidence. Runs are recorded individually with timestamps so a
 * trend can be read later rather than a single run being treated as a verdict.
 *
 * Without an API key it exits 0 and records that it was skipped. A measurement
 * tool that fails the build when it cannot measure teaches people to remove it.
 *
 * Usage: node llm_citation_probe.mjs [--queries file] [--limit N] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  openRouterWebSearch,
  OpenRouterError,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MAX_RESULTS,
} from './lib/openrouter_web_search.mjs';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const DRY = argv.includes('--dry-run');
const MODE = arg('--mode', process.env.CITATION_PROBE_MODE || 'knowledge');
const GROUNDED = MODE === 'grounded';
const LIMIT = Number(arg('--limit', '25'));
const OUT = 'data/signals/llm_citation_observations.json';

const CONFIG_PATH = 'data/signals/citation_probe_config.json';
const config = fs.existsSync(path.join(ROOT, CONFIG_PATH))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG_PATH), 'utf8'))
  : {};
const OWNED = (config.owned_domains || []).map((d) => d.toLowerCase().replace(/^www\./, ''));
if (!OWNED.length) {
  console.error(`citation probe: no owned_domains in ${CONFIG_PATH} - cannot tell a citation of ours from anyone else's`);
  process.exit(1);
}

function loadQueries() {
  const file = arg('--queries', config.queries_file || 'data/seo/priority_queries.json');
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) return [];
  const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
  const rows = Array.isArray(raw) ? raw : (raw.queries || raw.priority_queries || raw.entries || []);
  return rows.map((r) => (typeof r === 'string' ? r : r.query || r.text || '')).filter(Boolean).slice(0, LIMIT);
}

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

// Two modes, kept distinct because they measure different things and conflating
// them would overstate what is known.
//
//   knowledge (default) - ask without tools and see whether the model names us
//     unprompted. This measures whether we exist in the model's answer at all.
//     It is free.
//   grounded - ask with Google Search grounding and read the sources the answer
//     was actually built from. This is a real citation observation, and it is
//     the stronger signal, but grounding is not free-tier eligible: it returns
//     quota errors on this key today.
//
// Default is knowledge, because a probe that cannot run costs more than a weaker
// probe that does.
async function ask(query, key, model, grounded) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: query }] }],
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: { temperature: 0 },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  const cand = data?.candidates?.[0] || {};
  const meta = cand.groundingMetadata || {};
  // Grounding chunks carry the pages the answer was actually built from. The
  // redirect wrapper Google returns is resolved where a real URI is present.
  const uris = [];
  for (const c of meta.groundingChunks || []) {
    const w = c.web || {};
    if (w.uri) uris.push(w.uri);
    if (w.domain) uris.push(`https://${w.domain}`);
  }
  for (const q of meta.webSearchQueries || []) void q;
  const answer = (cand.content?.parts || []).map((p) => p.text || '').join('\n');
  return { ok: true, answer, uris };
}

const queries = loadQueries();
if (!queries.length) { console.error('citation probe: no queries found'); process.exit(1); }

// OpenRouter is preferred when a key is present: its cheap models cost almost
// nothing and asking several of them is a better sample than asking one. Gemini
// remains supported for KNOWLEDGE mode only - its ungrounded endpoint works.
const orKey = process.env.OPENROUTER_API_KEY || '';
const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || '';
// Grounded mode is pinned to OpenRouter, and having a GEMINI_API_KEY no longer
// changes that. Gemini's grounded path is hard-blocked on this key: plain
// generateContent returns 200, the same request carrying tools:[{google_search:{}}]
// returns 429 RESOURCE_EXHAUSTED, reproduced across three models and persistent.
// The old expression preferred Gemini whenever a key existed, so every grounded run
// went to a provider that could not answer - and the summary still printed a rate.
// Preferring a dead provider is not a fallback, it is a guaranteed zero.
//
// Knowledge mode still prefers OpenRouter for its cheap multi-model sample and can
// fall back to Gemini, whose UNGROUNDED endpoint does work.
const PROVIDER = arg('--provider', GROUNDED ? 'openrouter' : (orKey ? 'openrouter' : 'gemini'));
// Three small models rather than one, because a single model's idiosyncrasies
// are not a measurement.
//
// These are the cheapest tier that actually answers, around two to three cents
// per million tokens - a full portfolio run costs roughly a cent. The genuinely
// free tier was tried first and is not usable for this: several :free models are
// agentic-harness only, others return upstream provider errors or hang with no
// response. A probe that silently reports zero because every model failed is
// worse than one that costs a cent and runs, so reliability wins here. Set
// OPENROUTER_MODELS to override, including back to :free variants.
const OR_MODELS = (process.env.OPENROUTER_MODELS || (config.openrouter_models || []).join(',') ||
  'ibm-granite/granite-4.0-h-micro,inclusionai/ling-3.0-flash,mistralai/mistral-nemo')
  .split(',').map((m) => m.trim()).filter(Boolean);

// Free models are heavily shared and some hang. Without a deadline one slow
// model stalls the whole run, which is how a measurement quietly stops being
// taken. A timed-out model is recorded as an error against that model, not as
// an absence of citations.
const REQUEST_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 25000);
async function withTimeout(fn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try { return await fn(ctrl.signal); }
  finally { clearTimeout(t); }
}

const WEB_MAX_RESULTS = Number(process.env.OPENROUTER_WEB_MAX_RESULTS || OPENROUTER_DEFAULT_MAX_RESULTS);

async function askOpenRouter(query, model, grounded = false) {
  // Grounded: the shared web-plugin call. The pages the answer was actually built
  // from come back as url_citation annotations, which is the retrieval observation
  // the knowledge-mode call cannot produce - that one only shows whether the model
  // memorised us during training, which is not a citation.
  if (grounded) {
    try {
      const r = await openRouterWebSearch(query, {
        apiKey: orKey, model, maxResults: WEB_MAX_RESULTS, timeoutMs: REQUEST_TIMEOUT_MS,
      });
      return { ok: true, answer: r.answer, uris: r.citations };
    } catch (err) {
      const detail = err instanceof OpenRouterError && err.detail ? `: ${err.detail}` : '';
      return { ok: false, error: `${err.message}${detail}` };
    }
  }
  const res = await withTimeout((signal) => fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${orKey}` },
    body: JSON.stringify({
      model, temperature: 0, max_tokens: 400,
      messages: [{ role: 'user', content: query }],
    }),
  }));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
  const answer = data?.choices?.[0]?.message?.content || '';
  return { ok: true, answer, uris: [] };
}
const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const now = new Date().toISOString();

if (GROUNDED && PROVIDER !== 'openrouter') {
  console.error(`citation probe: refusing to run grounded mode on provider "${PROVIDER}". Grounded search is only available here through OpenRouter's web plugin; Gemini grounding returns 429 RESOURCE_EXHAUSTED on this key and would record failures as an absence of citations.`);
  process.exit(1);
}

const haveKey = PROVIDER === 'openrouter' ? Boolean(orKey) : Boolean(key);

// Rule 0: a run that measured nothing must say so by name, and it must never leave a
// rate behind. Recording the skip - rather than exiting silently - is what stops the
// last successful run's summary from being read as today's result.
function recordNonRun(status, detail) {
  const doc = fs.existsSync(path.join(ROOT, OUT))
    ? JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8'))
    : { schema_version: '1.0', runs: [] };
  doc.runs = (doc.runs || []).slice(-49);
  doc.runs.push({ run_at: new Date().toISOString(), provider: PROVIDER, mode: MODE, status, detail, queries: queries.length, observations: [] });
  doc.latest_summary = {
    run_at: new Date().toISOString(), provider: PROVIDER, mode: MODE, status, detail,
    queries: queries.length, observations: 0, answered: 0, errored: 0, self_cited: 0,
    self_cited_rate_pct: null,
    rate_note: 'No provider answered, so no citation rate exists for this run. A rate of 0% would assert that the engines were asked and did not cite us.',
  };
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(doc, null, 2) + '\n');
}

if (DRY) {
  console.log(`citation probe: NAMED STOP dry_run; mode=${MODE}; ${queries.length} queries ready, owned domains: ${OWNED.join(', ')}. Nothing was called and nothing was recorded.`);
  process.exit(0);
}
if (!haveKey) {
  const detail = `NAMED STOP no_credential: mode=${MODE} routes to ${PROVIDER}, and ${PROVIDER === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GEMINI_API_KEY'} is not set. ${queries.length} queries were ready and none were asked.`;
  recordNonRun('no_credential', detail);
  console.log(`citation probe: ${detail} Recorded with a null rate in ${OUT}, not 0%.`);
  process.exit(0);
}

const observations = [];
// One model can be idiosyncratic. Asking several and reporting each separately
// says more than averaging them into a single number would.
// Knowledge mode asks several cheap models because one model's idiosyncrasies
// are not a measurement. Grounded mode bills per search - around $0.007 a query
// - and the thing being measured is which pages the retrieval layer returns,
// which does not vary much by model. One model keeps a portfolio-wide run in
// cents. Override with OPENROUTER_GROUNDED_MODELS.
const GROUNDED_MODELS = (process.env.OPENROUTER_GROUNDED_MODELS || OPENROUTER_DEFAULT_MODEL)
  .split(',').map((m) => m.trim()).filter(Boolean);
const engines = PROVIDER === 'openrouter' ? (GROUNDED ? GROUNDED_MODELS : OR_MODELS) : [model];
for (const q of queries) {
 for (const engineModel of engines) {
  let r;
  try {
    r = PROVIDER === 'openrouter' ? await askOpenRouter(q, engineModel, GROUNDED) : await ask(q, key, engineModel, GROUNDED);
  } catch (e) { r = { ok: false, error: String(e.message || e) }; }
  if (!r.ok) {
    observations.push({ query: q, engine: `${PROVIDER}:${engineModel}`, mode: MODE, observed_at: now, status: 'provider_error', error: r.error });
    console.log(`  ERROR  ${engineModel} :: ${q} :: ${String(r.error).slice(0, 70)}`);
    continue;
  }
  const domains = [...new Set(r.uris.map(hostOf).filter(Boolean))];
  const ours = domains.filter((d) => OWNED.some((o) => d === o || d.endsWith(`.${o}`)));
  // In knowledge mode there are no grounded sources, so presence means the model
  // named the brand or domain in its own answer.
  const answerLower = (r.answer || '').toLowerCase();
  const named = OWNED.filter((o) => answerLower.includes(o) || answerLower.includes(o.split('.')[0]));
  observations.push({
    query: q, engine: `${PROVIDER}:${engineModel}`, mode: MODE, observed_at: now,
    status: 'observed',
    cited_domains: domains,
    cited_ours: ours,
    self_cited: GROUNDED ? ours.length > 0 : named.length > 0,
    named_in_answer: named,
    answer_mentions_brand: named.length > 0,
  });
  const hit = GROUNDED ? ours.length > 0 : named.length > 0;
  console.log(`  ${hit ? 'PRESENT' : '   --  '} ${engineModel.split('/').pop()} :: ${q}${hit ? ` (${(GROUNDED ? ours : named).join(', ')})` : ''}`);
 }
}

const prior = fs.existsSync(path.join(ROOT, OUT))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, OUT), 'utf8'))
  : { schema_version: '1.0', runs: [] };
prior.runs = (prior.runs || []).slice(-49);
prior.runs.push({ run_at: now, provider: PROVIDER, engines, mode: MODE, queries: queries.length, observations });

const answeredObs = observations.filter((o) => o.status === 'observed');
const cited = answeredObs.filter((o) => o.self_cited).length;
const errored = observations.filter((o) => o.status === 'provider_error').length;
// A citation rate is a statement about answers that came back. Dividing by every
// attempt folded provider failures into the denominator, so a run where the engine
// refused every call reported a confident 0% - the same number an engine that
// answered and cited nobody would produce. The denominator is answered observations
// only, and when nothing was answered there is no rate at all.
const status = answeredObs.length ? (errored ? 'observed_degraded' : 'observed') : 'provider_error';
prior.latest_summary = {
  run_at: now, provider: PROVIDER, engines, mode: MODE, status,
  queries: queries.length, observations: observations.length,
  answered: answeredObs.length, errored, self_cited: cited,
  _mode_note: GROUNDED
    ? 'grounded: counted when the answer was built from one of our pages'
    : 'knowledge: counted when the model named us unprompted, with no retrieval. Weaker than a citation and must not be reported as one.',
  rate_basis: 'answered observations only; provider errors are excluded from the denominator and never reported as a zero rate',
  self_cited_rate_pct: answeredObs.length ? Number(((100 * cited) / answeredObs.length).toFixed(1)) : null,
  ...(answeredObs.length ? {} : {
    rate_note: `Every one of the ${observations.length} attempt(s) failed at the provider, so no citation rate exists for this run.`,
  }),
};

fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(prior, null, 2) + '\n');
const rateText = prior.latest_summary.self_cited_rate_pct === null
  ? 'NO RATE - every attempt failed at the provider'
  : `${prior.latest_summary.self_cited_rate_pct}% of answered`;
console.log(`citation probe [${PROVIDER}/${MODE}] ${status}: ${cited}/${answeredObs.length} answered observations named one of our domains (${rateText}); ${errored} provider error(s) across ${observations.length} attempt(s). Recorded in ${OUT}`);
// Rule 0: exiting 0 having asked nothing successfully is a silent nothing.
if (!answeredObs.length) {
  console.error(`citation probe: NAMED STOP provider_error - ${observations.length} attempt(s), 0 answered. No citation rate was recorded.`);
  process.exit(1);
}

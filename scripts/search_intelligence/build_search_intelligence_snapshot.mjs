#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (p, value) => {
  const file = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const today = process.env.AUTHORITY_RUN_DATE || new Date().toISOString().slice(0, 10);
const generatedAt = process.env.AUTHORITY_RUN_AT || `${today}T00:00:00.000Z`;

const queryUniverse = readJson('data/queries/query_universe.json', []);
const improvementPlan = readJson('data/authority_scale/page_improvement_plan.json', { plans: [] });
const sitemap = fs.existsSync('sitemap.xml') ? fs.readFileSync('sitemap.xml', 'utf8') : '';
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

const targetQueries = [];
for (const q of queryUniverse) {
  if (q?.slug && q?.h1) {
    targetQueries.push({
      query: q.h1,
      source: 'query_universe',
      expected_route: `/${q.folder}/${q.slug}.html`,
      intent: q.intent || 'unknown',
      service_key: q.serviceKey || 'unknown'
    });
  }
}
for (const plan of improvementPlan.plans || []) {
  for (const opportunity of plan.opportunities || []) {
    targetQueries.push({
      query: opportunity.query,
      source: 'page_improvement_plan',
      expected_route: plan.route,
      intent: opportunity.format || 'unknown',
      service_key: 'derived_from_backlog'
    });
  }
}

const seen = new Set();
const targets = targetQueries
  .filter((x) => x.query && x.expected_route)
  .filter((x) => {
    const key = x.query.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .slice(0, Number(process.env.SEARCH_INTELLIGENCE_QUERY_LIMIT || 25));

function liveBingObservation(query) {
  const key = process.env.BING_SEARCH_API_KEY || process.env.BING_SEARCH_KEY;
  const endpoint = process.env.BING_SEARCH_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/search';
  if (!key || process.env.SEARCH_INTELLIGENCE_LIVE !== '1') {
    return {
      provider: 'bing_web_search',
      status: key ? 'DEGRADED' : 'UNAVAILABLE',
      evidence: key ? 'SEARCH_INTELLIGENCE_LIVE is not set to 1; no live request made.' : 'No Bing Search API key was available.',
      results: []
    };
  }
  const url = `${endpoint}?q=${encodeURIComponent(query)}&count=10&responseFilter=Webpages`;
  const res = spawnSync('curl', ['-fsS', '-H', `Ocp-Apim-Subscription-Key: ${key}`, url], { encoding: 'utf8', timeout: 20000 });
  if (res.status !== 0) {
    return {
      provider: 'bing_web_search',
      status: 'DEGRADED',
      evidence: (res.stderr || res.stdout || 'Bing request failed.').trim(),
      results: []
    };
  }
  try {
    const body = JSON.parse(res.stdout);
    const results = (body.webPages?.value || []).map((r, i) => ({
      observed_position: i + 1,
      title: r.name || '',
      url: r.url || '',
      domain: (() => {
        try {
          return new URL(r.url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })()
    }));
    return {
      provider: 'bing_web_search',
      status: 'AVAILABLE',
      evidence: `Received ${results.length} web results from Bing Web Search.`,
      results
    };
  } catch (err) {
    return {
      provider: 'bing_web_search',
      status: 'DEGRADED',
      evidence: `Bing response was not valid JSON: ${err.message}`,
      results: []
    };
  }
}

function gscTruth() {
  const siteUrl = process.env.GSC_SITE_URL || '';
  const credsFile = process.env.GSC_SERVICE_ACCOUNT_FILE || '';
  const hasInlineCreds = Boolean(process.env.GSC_SERVICE_ACCOUNT_JSON);
  if (!siteUrl || (!credsFile && !hasInlineCreds)) {
    return {
      provider: 'google_search_console',
      status: 'UNAVAILABLE',
      evidence: 'GSC_SITE_URL plus GSC_SERVICE_ACCOUNT_FILE or GSC_SERVICE_ACCOUNT_JSON are required for real GSC truth.',
      source_file: null
    };
  }
  if (process.env.SEARCH_INTELLIGENCE_GSC !== '1') {
    return {
      provider: 'google_search_console',
      status: 'DEGRADED',
      evidence: 'GSC credentials appear configured, but SEARCH_INTELLIGENCE_GSC is not set to 1; no GSC API request made.',
      source_file: null
    };
  }
  const tmpCreds = hasInlineCreds ? path.join(ROOT, '.build', 'gsc-search-intelligence-creds.json') : credsFile;
  if (hasInlineCreds) {
    fs.mkdirSync(path.dirname(tmpCreds), { recursive: true });
    fs.writeFileSync(tmpCreds, process.env.GSC_SERVICE_ACCOUNT_JSON);
  }
  const out = path.join(ROOT, '.build', 'gsc-search-analytics.json');
  const queryFile = path.join(ROOT, '.build', 'search-intelligence-target-queries.txt');
  fs.mkdirSync(path.dirname(queryFile), { recursive: true });
  fs.writeFileSync(queryFile, targets.map((t) => t.query).join('\n') + '\n');
  const res = spawnSync('python3', [
    'distribution_scripts/gsc_search_analytics.py',
    tmpCreds,
    siteUrl,
    today,
    today,
    queryFile,
    out
  ], { encoding: 'utf8', timeout: 60000 });
  if (hasInlineCreds) fs.rmSync(tmpCreds, { force: true });
  if (res.status !== 0) {
    return {
      provider: 'google_search_console',
      status: 'DEGRADED',
      evidence: (res.stderr || res.stdout || 'GSC Search Analytics request failed.').trim(),
      source_file: null
    };
  }
  return {
    provider: 'google_search_console',
    status: 'AVAILABLE',
    evidence: (res.stdout || 'GSC Search Analytics request completed.').trim(),
    source_file: '.build/gsc-search-analytics.json'
  };
}

const observations = targets.map((target) => {
  const bing = liveBingObservation(target.query);
  const ownUrl = `https://porchandparty901.com${target.expected_route}`;
  const expectedUrlInSitemap = sitemapUrls.has(ownUrl);
  const ownObserved = bing.results.filter((r) => /(^|\.)porchandparty901\.com$/.test(r.domain));
  const competitors = bing.results
    .filter((r) => r.domain && !/(^|\.)porchandparty901\.com$/.test(r.domain))
    .slice(0, 5)
    .map((r) => ({ domain: r.domain, observed_position: r.observed_position, url: r.url, title: r.title }));
  return {
    query: target.query,
    expected_route: target.expected_route,
    expected_url_in_sitemap: expectedUrlInSitemap,
    observation_type: 'live_search_observation_not_google_rank',
    bing_status: bing.status,
    bing_evidence: bing.evidence,
    own_site_observed_in_bing_results: ownObserved.length > 0,
    own_site_bing_positions: ownObserved.map((r) => r.observed_position),
    competitor_comparison: bing.status === 'AVAILABLE' ? competitors : [],
    diagnosis: ownObserved.length
      ? 'Own site observed in live Bing results; compare snippet/title/page fit against higher observed competitors before repair.'
      : 'No own-site live observation available; use GSC truth when configured and prepare only bounded page-quality repair candidates.',
    bounded_repair_candidate: {
      status: expectedUrlInSitemap ? 'PREPARED_NOT_PUBLISHED' : 'DEGRADED',
      route: target.expected_route,
      action: expectedUrlInSitemap
        ? 'Improve extractable answer, comparison/checklist structure, and authority/source clarity on the existing route if GSC or live observations justify it.'
        : 'Expected route is not present in sitemap; inspect route ownership before any repair.',
      publishing_cadence_change: false
    },
    same_query_retest_required_after_repair: true
  };
});

const providerTruth = {
  schema_version: '1.0',
  generated_at: generatedAt,
  providers: {
    live_search_observation: {
      status: observations.some((o) => o.bing_status === 'AVAILABLE') ? 'AVAILABLE' : observations[0]?.bing_status || 'UNAVAILABLE',
      provider: 'bing_web_search',
      truth_boundary: 'Bing live-search observation is not literal Google SERP rank.'
    },
    google_search_console: gscTruth(),
    gemini_grounding: {
      status: 'UNAVAILABLE',
      evidence: 'No Gemini/search grounding integration is configured in this repo.',
      truth_boundary: 'Grounded search observations must never be represented as literal Google SERP rank.'
    }
  }
};

const snapshot = {
  schema_version: '1.0',
  repo_id: 'p-n-p',
  generated_at: generatedAt,
  authority_goal: 'maximize probability of verified external citation events without conflating owned surfaces, search visibility, LLM surfacing, or citations',
  hard_rules: {
    live_search_observation_lane: 'supported_with_provider_key_and_explicit_live_flag',
    grounded_search_not_literal_google_rank: true,
    gsc_authority_for_google_own_site_performance: true,
    degraded_provider_never_green: true,
    publishing_cadence_change: false
  },
  query_limit: targets.length,
  target_query_set: targets,
  provider_truth: providerTruth,
  observations,
  repair_loop: 'target query -> live observation/GSC truth -> competitor comparison -> diagnosis -> bounded repair candidate -> existing approval/publishing rules -> same-query retest -> before/after evidence comparison',
  authority_feedback_fields: [
    'source_quality',
    'claim_level_citations',
    'authority_gap_analysis',
    'citation_footprint',
    'entity_source_coverage',
    'llm_search_surfacing_observations',
    'decision_useful_authority'
  ],
  truth_boundary: 'This snapshot is planning and observation evidence. It is not proof of Google rank, indexing, citation, or provider health unless a provider section is AVAILABLE with evidence.'
};

writeJson('data/search_intelligence/provider_truth_snapshot.json', providerTruth);
writeJson('data/search_intelligence/search_intelligence_snapshot.json', snapshot);
console.log(JSON.stringify({
  ok: true,
  target_queries: targets.length,
  live_search_status: providerTruth.providers.live_search_observation.status,
  gsc_status: providerTruth.providers.google_search_console.status,
  publishing_cadence_change: false
}, null, 2));

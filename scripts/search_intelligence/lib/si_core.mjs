// Shared helpers for the Porch & Party search-intelligence lane.
//
// This lane is read-and-prepare only. It never publishes, never mutates queue,
// manifest, freeze, admission, velocity, or sitemap state, and it is not part of
// `authority:cycle`. See data/search_intelligence/search_intelligence_contract.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = process.cwd();
export const SI_DIR = 'data/search_intelligence';
export const CONTRACT_PATH = `${SI_DIR}/search_intelligence_contract.json`;

export const PROVIDER_OK = 'OK';
export const PROVIDER_DEGRADED = 'DEGRADED';
export const PROVIDER_UNAVAILABLE = 'UNAVAILABLE';

export function readJson(rel, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  } catch (err) {
    if (fallback === undefined) throw new Error(`Missing or unreadable required file: ${rel} (${err.message})`);
    return fallback;
  }
}

export function writeJson(rel, value) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(value, null, 2) + '\n');
}

export function loadContract() {
  return readJson(CONTRACT_PATH);
}

// Deterministic run stamp. Reuses the repo's existing AUTHORITY_RUN_* convention
// so search artifacts obey the same deterministic-build law as the authority lane.
export function runStamp() {
  if (process.env.SEARCH_INTELLIGENCE_RUN_AT) return process.env.SEARCH_INTELLIGENCE_RUN_AT;
  if (process.env.AUTHORITY_RUN_AT) return process.env.AUTHORITY_RUN_AT;
  const date = process.env.SEARCH_INTELLIGENCE_RUN_DATE || process.env.AUTHORITY_RUN_DATE;
  if (date) return `${date}T00:00:00.000Z`;
  return '1970-01-01T00:00:00.000Z';
}

export function runDate() {
  return runStamp().slice(0, 10);
}

export function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function shortId(prefix, value) {
  return `${prefix}_${sha256(value).slice(0, 12)}`;
}

/**
 * Resolve the state of a declared provider without contacting it.
 * Absent credentials is UNAVAILABLE, never OK.
 */
export function resolveProviderState(providerConfig, { name }) {
  const credentialEnv = providerConfig.credential_env;
  const fileEnv = providerConfig.credential_file_env;
  const hasInlineCredential = Boolean(credentialEnv && process.env[credentialEnv]);
  const hasFileCredential = Boolean(
    fileEnv && process.env[fileEnv] && fs.existsSync(path.resolve(process.env[fileEnv]))
  );
  const siteEnv = providerConfig.site_url_env;
  const needsSite = Boolean(siteEnv);
  const hasSite = !needsSite || Boolean(process.env[siteEnv]);

  if (!hasInlineCredential && !hasFileCredential) {
    return {
      provider: name,
      provider_id: providerConfig.provider_id,
      state: PROVIDER_UNAVAILABLE,
      reason: 'CREDENTIAL_NOT_PRESENT_IN_ENVIRONMENT',
      required_env: [credentialEnv, fileEnv, siteEnv].filter(Boolean),
      evidence: `No value found for ${[credentialEnv, fileEnv].filter(Boolean).join(' or ')} in the execution environment.`
    };
  }
  if (!hasSite) {
    return {
      provider: name,
      provider_id: providerConfig.provider_id,
      state: PROVIDER_DEGRADED,
      reason: 'CREDENTIAL_PRESENT_BUT_SITE_URL_MISSING',
      required_env: [credentialEnv, fileEnv, siteEnv].filter(Boolean),
      evidence: `${siteEnv} is not set, so the property to query is unknown.`
    };
  }
  return {
    provider: name,
    provider_id: providerConfig.provider_id,
    state: PROVIDER_OK,
    reason: 'CREDENTIAL_PRESENT',
    required_env: [credentialEnv, fileEnv, siteEnv].filter(Boolean),
    evidence: 'Credential material was present in the execution environment at resolution time.'
  };
}

/**
 * Hard Rule 4. Derive an overall status that can never be healthy while a
 * required provider is degraded or unavailable.
 */
export function deriveOverallStatus(providerStates, { requiredProviders = [] } = {}) {
  const relevant = providerStates.filter((p) => requiredProviders.length === 0 || requiredProviders.includes(p.provider));
  if (!relevant.length) return PROVIDER_UNAVAILABLE;
  if (relevant.some((p) => p.state === PROVIDER_UNAVAILABLE)) return PROVIDER_UNAVAILABLE;
  if (relevant.some((p) => p.state === PROVIDER_DEGRADED)) return PROVIDER_DEGRADED;
  return PROVIDER_OK;
}

/**
 * Hard Rule 1. Free-allowance governor for the observation lane.
 * The observer refuses to spend past the declared free allowance rather than billing.
 */
export function resolveAllowance(providerConfig) {
  const allowance = providerConfig.allowance || {};
  const declared = Number(allowance.free_tier_daily_call_budget || 0);
  const overrideRaw = allowance.budget_env ? process.env[allowance.budget_env] : undefined;
  const override = overrideRaw === undefined || overrideRaw === '' ? null : Number(overrideRaw);
  const paidOptIn = allowance.opt_in_env ? process.env[allowance.opt_in_env] === 'true' : false;

  let budget = declared;
  if (override !== null && Number.isFinite(override) && override >= 0) {
    budget = paidOptIn ? override : Math.min(override, declared);
  }
  return {
    mode: allowance.mode || 'FREE_TIER_ONLY_BY_DEFAULT',
    declared_free_tier_daily_call_budget: declared,
    requested_budget: override,
    effective_daily_call_budget: budget,
    paid_spend_opted_in: paidOptIn,
    cost_mode: paidOptIn && budget > declared ? 'PAID_SPEND_OPTED_IN' : 'ZERO_INCREMENTAL_COST',
    note: allowance.zero_incremental_cost_note || ''
  };
}

export function assertNoRankFields(record, context) {
  const forbidden = ['rank', 'position', 'serp_rank', 'serp_position', 'average_position'];
  for (const key of Object.keys(record)) {
    if (forbidden.includes(key)) {
      throw new Error(`Hard Rule 2 violation: grounded observation ${context} may not carry field "${key}".`);
    }
  }
  return record;
}

export function stableSort(items, keyFn) {
  return items
    .map((item, index) => ({ item, index, key: keyFn(item) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index))
    .map((entry) => entry.item);
}

export function printStageSummary(stage, payload) {
  console.log(`PNP SEARCH INTELLIGENCE :: ${stage} :: ${JSON.stringify(payload)}`);
}

/**
 * entity_backlink_watch: the weekly check that the Porch & Party entity in
 * config/entity.json is still true out on the web, with self-heal.
 * (Copied from the sprylabs-hpc-site watch and diverged: one entity, no members.)
 *
 * Every sameAs URL is fetched with a browser user agent and classified:
 *
 *   ok           2xx, and the page names porchandparty901.com (link-back).
 *   no_link_back 2xx on a server-rendered platform, but the page never names
 *                the site: a NAMED STOP naming the exact profile field to edit.
 *   unverifiable 2xx on a JS-rendered platform (Google Maps, Instagram, TikTok,
 *                Nextdoor, Bing Places): resolving is proved, link-back cannot
 *                be. A named state, never counted as a pass. The Google Business
 *                Profile lands here: its website field is checked by the owner
 *                (OpenSEO get_business_profile spends credits; nothing paid).
 *   blocked      403/429/5xx or a timeout: the platform refused a robot. Named,
 *                never removed - a refusal is not proof the profile is gone.
 *   dead         404/410 or a host that does not resolve, twice: REMOVED from
 *                sameAs (--apply), with a note in the report.
 *
 * Pending profiles (profiles_pending) are promoted into sameAs when their URL
 * resolves - and links back, where the platform can show it. A pending entry
 * with url null waits for the owner action it names (a named stop, unless the
 * action starts "None": that profile does not exist yet by plan).
 *
 * --apply writes config/entity.json when something was removed or promoted;
 * the workflow then stops red with that exact change, because the sameAs is
 * on all 99 frozen pages and changing them is a scoped thaw-rebuild-refreeze.
 * The report goes to reports/entity/backlink_watch.json.
 *
 * Rule 0: a run that examined zero profiles fails.
 *
 * Run: npm run watch:entity-backlinks [-- --apply] [-- --offline-fixture <json>]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// Facebook answers 400 to a bare browser UA without the rest of a browser's
// headers, and 200 with the Page HTML to an honest robot UA; the retry uses it.
const BOT_UA = 'p-n-p-entity-watch/1.0 (+https://porchandparty901.com)';
const JS_RENDERED = ['google.com', 'maps.app.goo.gl', 'g.page', 'instagram.com', 'tiktok.com', 'nextdoor.com', 'bing.com', 'linkedin.com'];
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argVal = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const CFG_PATH = path.resolve(ROOT, argVal('config', 'config/entity.json'));
const REPORT = path.resolve(ROOT, argVal('report', 'reports/entity/backlink_watch.json'));
const fixtureArg = argVal('offline-fixture', null);
// A fixture maps URL -> {status, body}; used by the self-test so the
// classification logic is exercised without the network.
const FIXTURE = fixtureArg ? JSON.parse(fs.readFileSync(fixtureArg, 'utf8')) : null;

const cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
const HOSTS = cfg.own_hosts || [];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const isJsRendered = (u) => JS_RENDERED.some((h) => hostOf(u) === h || hostOf(u).endsWith(`.${h}`));

async function fetchOnce(url, ua = UA) {
  if (FIXTURE) {
    const f = FIXTURE[url];
    if (!f) return { status: 0, body: '', error: 'ENOTFOUND (fixture)' };
    return { status: f.status, body: f.body || '' };
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': ua, accept: 'text/html,*/*' } });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: '', error: String(e.cause?.code || e.name || e.message) };
  } finally { clearTimeout(t); }
}

async function probe(url) {
  let r = await fetchOnce(url);
  if (!(r.status >= 200 && r.status < 300)) r = await fetchOnce(url, BOT_UA); // one retry, honest robot UA
  const dead = r.status === 404 || r.status === 410 || (r.status === 0 && /ENOTFOUND|EAI_AGAIN|NXDOMAIN/.test(r.error || ''));
  if (dead) return { url, state: 'dead', status: r.status, error: r.error };
  if (!(r.status >= 200 && r.status < 300)) return { url, state: 'blocked', status: r.status, error: r.error };
  if (isJsRendered(url)) return { url, state: 'unverifiable', status: r.status };
  const body = r.body.toLowerCase();
  return HOSTS.some((h) => body.includes(h)) ? { url, state: 'ok', status: r.status } : { url, state: 'no_link_back', status: r.status };
}

const report = { checked_at: new Date().toISOString(), apply: APPLY, profiles: [], promoted: [], removed: [], named_stops: [] };
let changed = false;
const keep = [];
for (const url of cfg.sameAs || []) {
  const r = await probe(url);
  report.profiles.push(r);
  if (r.state === 'dead') { report.removed.push({ url, why: `answered ${r.status || r.error} twice` }); changed = true; continue; }
  if (r.state === 'no_link_back') report.named_stops.push(`The profile ${url} does not link to ${HOSTS[0]}. Owner: add https://${HOSTS[0]} to that profile's website field.`);
  if (r.state === 'unverifiable' && hostOf(url).endsWith('google.com')) report.named_stops.push(`Google Business Profile ${url} resolves; its link-back cannot be read by a robot. Owner: confirm the profile's Website field is https://${HOSTS[0]} (business.google.com > Edit profile > Contact).`);
  keep.push(url);
}
const stillPending = [];
for (const p of cfg.profiles_pending || []) {
  if (!p.url) { stillPending.push(p); if (!/^None/.test(p.owner_action)) report.named_stops.push(`${p.platform} not claimed yet. Owner: ${p.owner_action}`); continue; }
  const r = await probe(p.url);
  report.profiles.push({ pending: true, platform: p.platform, ...r });
  if (r.state === 'ok' || r.state === 'unverifiable') {
    keep.push(p.url);
    report.promoted.push({ platform: p.platform, url: p.url, state: r.state });
    changed = true;
  } else {
    stillPending.push(p);
    if (r.state === 'no_link_back') report.named_stops.push(`Pending ${p.platform} profile ${p.url} resolves but does not link to ${HOSTS[0]}. Owner: add https://${HOSTS[0]} to its website field.`);
  }
}
cfg.sameAs = keep;
cfg.profiles_pending = stillPending;

const examined = report.profiles.length;
report.summary = {
  examined,
  ok: report.profiles.filter((p) => p.state === 'ok').length,
  unverifiable: report.profiles.filter((p) => p.state === 'unverifiable').length,
  no_link_back: report.profiles.filter((p) => p.state === 'no_link_back').length,
  blocked: report.profiles.filter((p) => p.state === 'blocked').length,
  removed: report.removed.length,
  promoted: report.promoted.length,
  named_stops: report.named_stops.length,
  config_changed: changed,
};
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
if (changed && APPLY) fs.writeFileSync(CFG_PATH, `${JSON.stringify(cfg, null, 2)}\n`);

for (const p of report.profiles) console.log(`[entity-watch] ${p.state.padEnd(13)} ${p.url}`);
for (const r of report.removed) console.log(`[entity-watch] REMOVED ${r.url} (${r.why})`);
for (const r of report.promoted) console.log(`[entity-watch] PROMOTED ${r.platform} ${r.url}`);
for (const s of report.named_stops) console.log(`[entity-watch] NAMED STOP ${s}`);
if (!examined) { console.error('[entity-watch] FAIL Rule 0: 0 profiles examined'); process.exit(1); }
console.log(`[entity-watch] ${JSON.stringify(report.summary)}`);

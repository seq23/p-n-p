/**
 * Proves entity_backlink_watch's self-heal rules offline, against a fixture, so
 * the weekly job cannot quietly stop removing dead profiles, promoting live
 * pending ones or naming a missing link-back. Each case is a negative proof:
 * a watch that skipped the rule would leave a visible difference this fails on.
 *
 * Run: npm run self-test:entity-backlink-watch
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WATCH = 'scripts/entity/entity_backlink_watch.mjs';
const real = JSON.parse(fs.readFileSync('config/entity.json', 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity-watch-'));
const GBP = 'https://www.google.com/maps?cid=1';
const cfg = structuredClone(real);
cfg.sameAs = ['https://dead.example.org/pnp', GBP, 'https://nolink.example.org/pnp', 'https://blocked.example.org/pnp'];
cfg.profiles_pending = [
  { platform: 'Test pending', url: 'https://pending.example.org/pnp', owner_action: 'test' },
  { platform: 'Unclaimed', url: null, owner_action: 'Claim it.' },
  { platform: 'Not yet by plan', url: null, owner_action: 'None until it exists.' },
];
const fixture = {
  [GBP]: { status: 200, body: '<div id=app></div>' },
  'https://pending.example.org/pnp': { status: 200, body: 'see porchandparty901.com' },
  'https://nolink.example.org/pnp': { status: 200, body: 'nothing here' },
  'https://blocked.example.org/pnp': { status: 403 },
  'https://dead.example.org/pnp': { status: 404 },
};
const cfgPath = path.join(dir, 'entity.json');
const fixPath = path.join(dir, 'fixture.json');
const repPath = path.join(dir, 'report.json');
fs.writeFileSync(cfgPath, JSON.stringify(cfg));
fs.writeFileSync(fixPath, JSON.stringify(fixture));
const r = spawnSync(process.execPath, [WATCH, '--apply', '--config', cfgPath, '--report', repPath, '--offline-fixture', fixPath], { encoding: 'utf8' });
const fails = [];
if (r.status !== 0) fails.push(`watch exited ${r.status}: ${r.stderr}`);
const out = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const rep = JSON.parse(fs.readFileSync(repPath, 'utf8'));
const stateOf = (u) => rep.profiles.find((p) => p.url === u)?.state;
if (out.sameAs.includes('https://dead.example.org/pnp')) fails.push('a 404 profile was not removed from sameAs');
if (!out.sameAs.includes('https://pending.example.org/pnp')) fails.push('a resolving, linking-back pending profile was not promoted');
if (out.profiles_pending.some((p) => p.platform === 'Test pending')) fails.push('the promoted profile is still pending');
if (!out.sameAs.includes(GBP) || stateOf(GBP) !== 'unverifiable') fails.push('the Google listing (JS-rendered) was removed or not classed unverifiable');
if (!rep.named_stops.some((s) => s.includes(GBP) && /Website field/.test(s))) fails.push('the Google listing link-back was not a named stop for the owner');
if (!out.sameAs.includes('https://blocked.example.org/pnp') || stateOf('https://blocked.example.org/pnp') !== 'blocked') fails.push('a 403 profile was removed or not classed blocked');
if (!rep.named_stops.some((s) => s.includes('nolink.example.org'))) fails.push('a profile with no link-back was not a named stop');
if (!rep.named_stops.some((s) => s.startsWith('Unclaimed'))) fails.push('an unclaimed pending profile was not a named stop');
if (rep.named_stops.some((s) => s.startsWith('Not yet by plan'))) fails.push('a "None until" pending profile was raised as a named stop');
// Without --apply the config is never written.
fs.writeFileSync(cfgPath, JSON.stringify(cfg));
spawnSync(process.execPath, [WATCH, '--config', cfgPath, '--report', repPath, '--offline-fixture', fixPath], { encoding: 'utf8' });
if (JSON.parse(fs.readFileSync(cfgPath, 'utf8')).sameAs.includes('https://dead.example.org/pnp') === false) fails.push('the watch wrote config/entity.json without --apply');
// Rule 0: a config with nothing to examine must fail.
fs.writeFileSync(cfgPath, JSON.stringify({ ...structuredClone(real), sameAs: [], profiles_pending: [] }));
const z = spawnSync(process.execPath, [WATCH, '--config', cfgPath, '--report', repPath, '--offline-fixture', fixPath], { encoding: 'utf8' });
if (z.status === 0) fails.push('Rule 0: a run that examined nothing exited 0');
fs.rmSync(dir, { recursive: true, force: true });
for (const f of fails) console.error(`[self-test:entity-backlink-watch] FAIL ${f}`);
if (fails.length) process.exit(1);
console.log('[self-test:entity-backlink-watch] PASS - 10 self-heal rules and Rule 0 proved offline');

#!/usr/bin/env node
/**
 * npm run library:pins:check — re-checks every pin in data/admin/design-library/pins.json
 * through Pinterest's public oEmbed (https://www.pinterest.com/oembed.json?url=<pin url>).
 * A pin that no longer resolves is dropped from its group; the picture URL, credit and title
 * are refreshed from the oEmbed answer. Never scrapes Pinterest. Then run npm run library:sync.
 * Needs the network, so it is not part of CI; validate:admin-design-library checks the file offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data/admin/design-library/pins.json');
const P = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const ids = [...new Set(Object.values(P.groups).flat())];
const alive = new Set();
let i = 0;
async function one(id) {
  const url = `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(`https://www.pinterest.com/pin/${id}/`)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'PorchAndPartyAdmin/1.0 (pin check)' } });
    if (!r.ok) return;
    const o = await r.json();
    if (!/^https:\/\/i\.pinimg\.com\//.test(o.thumbnail_url || '')) return;
    P.pins[id] = { img: o.thumbnail_url, w: o.thumbnail_width, h: o.thumbnail_height, by: o.author_name || '', t: String(o.title || '').trim().slice(0, 100) };
    alive.add(id);
  } catch { /* unreachable counts as not alive */ }
}
const workers = Array.from({ length: 8 }, async () => { while (i < ids.length) await one(ids[i++]); });
await Promise.all(workers);
if (!alive.size) { console.error('library:pins:check: no pin resolved; is the network up? Nothing written.'); process.exit(1); }
for (const g of Object.keys(P.groups)) P.groups[g] = P.groups[g].filter((id) => alive.has(id));
for (const id of Object.keys(P.pins)) if (!alive.has(id)) delete P.pins[id];
P.checked = new Date().toISOString().slice(0, 10);
fs.writeFileSync(FILE, JSON.stringify(P, null, 1) + '\n');
const thin = Object.entries(P.groups).filter(([, v]) => v.length < 3).map(([g, v]) => `${g} (${v.length})`);
console.log(`library:pins:check: ${alive.size}/${ids.length} pins resolve${thin.length ? `; groups under 3 pins: ${thin.join(', ')}` : ''}`);

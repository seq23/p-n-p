#!/usr/bin/env node
/**
 * The request form's first question as picture tiles (owner-approved mock-up, 20 Oct 2026;
 * functions/_lib/request-form.mjs renderForm page 1).
 *
 * Fails when:
 *  1. a tile is not the label around a real radio with the same name and value as before
 *     (service = porch | party | grazing | rentals | multi; multi = the tick boxes), so the form
 *     would stop working without JavaScript or change what /admin and the emails receive;
 *  2. a tile lacks its approved words, its picture, alt text, srcset (240w + 480w), sizes, width
 *     and height; the "more than one" tick tiles are not lazy;
 *  3. a picture file is missing, the wrong size, too heavy, or a placeholder drawing;
 *  4. the help line, "I want more than one of these", the green "You picked" echo (aria-live),
 *     "Go back to one choice" or the "Not sure?" line is missing;
 *  5. the layout is not 4 across on a laptop and list rows on a phone;
 *  6. request.html does not carry the same first question (the generator was not re-run).
 * Rule 0: fewer than 50 checks is a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { mod } from './lib/admin_harness.mjs';

const ROOT = process.cwd();
const F = await mod('functions/_lib/request-form.mjs');
const { PRICE_TABLE } = await mod('functions/_lib/prices.mjs');
const { PLACEHOLDERS } = createRequire(import.meta.url)(path.join(ROOT, 'scripts/lib/placeholder_images.js'));
const offers = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/offers/services.json'), 'utf8'));
const errors = [];
let checks = 0;
const must = (ok, msg) => { checks += 1; if (!ok) errors.push(msg); };
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const q1Of = (html) => { const i = html.indexOf('id="q-service"'); return i < 0 ? '' : html.slice(i, html.indexOf('</fieldset>', i)); };

const choices = F.serviceChoices(offers, PRICE_TABLE);
must(choices.map((c) => c.key).join(',') === F.SERVICE_KEYS.join(','), 'tiles are not in the canonical order');
const blank = F.renderForm({ offers, table: PRICE_TABLE });
const q1 = q1Of(blank);
const tiles = [...q1.matchAll(/<label class="rq-tile rq-service[^"]*" data-tile="([a-z]+)"[^>]*>([\s\S]*?)<\/label>/g)];
must(tiles.map((m) => m[1]).join(',') === F.SERVICE_KEYS.join(','), `radio tiles: ${tiles.map((m) => m[1]).join(',')}`);
for (const c of choices) {
  const t = (tiles.find((m) => m[1] === c.key) || [])[2] || '';
  must((t.match(/<input /g) || []).length === 1 && new RegExp(`<input type="radio" name="service" value="${c.key}" required`).test(t), `${c.key}: the tile is not the label around one real radio (name=service value=${c.key})`);
  must(t.includes(`<strong>${escHtml(c.label)}</strong>`) && t.includes(`<span class="rq-what">${c.whatHtml}</span>`) && t.includes(`<span class="rq-eg">${escHtml(c.eg)}</span>`), `${c.key}: the approved words are missing`);
  must(new RegExp(`<img src="/assets/img/form/${c.key}-240\\.webp" srcset="/assets/img/form/${c.key}-240\\.webp 240w, /assets/img/form/${c.key}-480\\.webp 480w" sizes="\\(min-width: 700px\\) 160px, 96px" width="240" height="180" alt="${reEsc(escHtml(c.alt))}" decoding="async">`).test(t), `${c.key}: the picture lacks srcset / sizes / width / height / alt`);
  must(c.alt.length > 15 && !/^(image|photo|picture)/i.test(c.alt), `${c.key}: the alt text says nothing`);
  must(!/\$\d/.test(t), `${c.key}: the tile shows a price`);
  for (const w of [240, 480]) {
    const p = path.join(ROOT, `assets/img/form/${c.key}-${w}.webp`);
    const ok = fs.existsSync(p);
    must(ok, `${p} is missing`);
    if (!ok) continue;
    const b = fs.readFileSync(p);
    let width = 0;
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8 ') width = b.readUInt16LE(26) & 0x3fff;
      else if (kind === 'VP8L') width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      else if (kind === 'VP8X') width = 1 + b.readUIntLE(24, 3);
    }
    must(width === w, `${c.key}-${w}.webp is ${width} px wide, not ${w}`);
    must(b.length < (w === 240 ? 30000 : 80000), `${c.key}-${w}.webp is too heavy (${b.length} bytes)`);
    const h = crypto.createHash('sha1').update(b).digest('hex');
    must(!Object.values(PLACEHOLDERS).some((x) => x.sha1 === h), `${c.key}-${w}.webp is a placeholder drawing`);
  }
}
must(/<label class="rq-more rq-service"><input type="radio" name="service" value="multi" required> <strong>I want more than one of these<\/strong><\/label>/.test(q1), 'no "I want more than one of these" radio');
const multi = q1.slice(q1.indexOf('data-multi'));
const ticks = [...multi.matchAll(/<label class="rq-tile rq-sq[^"]*" data-tile="([a-z]+)"[^>]*><input type="checkbox" name="multi" value="([a-z]+)">(<img [^>]*>)/g)];
must(ticks.map((m) => m[2]).join(',') === F.SERVICE_KEYS.join(',') && ticks.every((m) => m[1] === m[2]), 'the "more than one" tick tiles are not the four services (name=multi)');
must(ticks.length === 4 && ticks.every((m) => / loading="lazy"/.test(m[3]) && / alt="[^"]{16,}"/.test(m[3])), 'the tick-tile pictures are not lazy with alt text');
must(/<p class="rq-help">Tick every picture you want\.<\/p>/.test(multi) && /<button type="button" class="rq-back1" data-one>Go back to one choice<\/button>/.test(multi), 'the tick tiles lack "Tick every picture you want." or "Go back to one choice"');
must(q1.includes(`<p class="rq-help" id="help-service">${F.SERVICE_HELP}</p>`) && F.SERVICE_HELP === 'Tap the picture that looks like what you want.', 'the help line is not "Tap the picture that looks like what you want."');
must(/<p class="rq-echo" data-echo aria-live="polite" hidden><\/p>/.test(q1), 'no green "You picked" line (aria-live)');
must(q1.includes(`<p class="rq-unsure">${escHtml(F.UNSURE_LINE)}</p>`) && F.UNSURE_LINE === "Not sure? Pick the closest one. We'll talk it through with you before anything is booked.", 'no "Not sure? Pick the closest one" line');
must(q1.indexOf('class="rq-echo"') > q1.indexOf('data-multi') && q1.indexOf('class="rq-unsure"') > q1.indexOf('class="rq-echo"'), 'the echo and "Not sure?" lines are out of order');
must(!/\$\d/.test(q1), 'the first question shows a price');

// The echo, the picked highlight and the back-to-one button (progressive enhancement).
must(blank.includes("'✓ You picked: '+p.map(lab).join(' + ')+'.'") && blank.includes("' Not right? Tap a different picture.'"), 'the form script does not write "✓ You picked: …. Not right? Tap a different picture."');
must(!/data-echo="/.test(q1) && blank.includes("querySelector('p[data-echo]')") && blank.includes("getAttribute('data-says')") && /classList\.toggle\('rq-on'/.test(blank) && /closest\('\[data-one\]'\)/.test(blank) && /function sync\(\)\{echo\(\);/.test(blank), 'the form script does not mark the picked tile, run the echo on change, or handle Go back to one choice');
must(/\.rq-tile\.rq-on,\.rq-tile:has\(input:checked\)\{border-color:#a8442b;background:#f6e6dc\}/.test(blank), 'the picked tile is not highlighted (with and without :has)');

// Layout: phone list rows, laptop 4 across.
must(/\.rq-tiles\{display:grid;grid-template-columns:1fr;/.test(blank) && /\.rq-tile\{position:relative;display:grid;grid-template-columns:96px 1fr;/.test(blank), 'phone: tiles are not list rows (picture left, words right)');
must(/@media\(min-width:700px\)\{\.rq-tiles\{grid-template-columns:repeat\(4,1fr\)\}/.test(blank), 'laptop: tiles are not 4 across');
must(/\.rq-tile input,\.rq-more input\{position:absolute;top:10px;right:10px;width:26px;height:26px/.test(blank), 'the real radio is not the visible pick circle (works without JS)');

// After an error the picked tile stays picked; multi keeps its ticks.
const back = q1Of(F.renderForm({ offers, table: PRICE_TABLE, values: { service: 'party' } }));
must(/class="rq-tile rq-service rq-on" data-tile="party"[^>]*><input type="radio" name="service" value="party" checked/.test(back), 'a picked tile is not kept after a failed send');
const backM = q1Of(F.renderForm({ offers, table: PRICE_TABLE, values: { service: 'multi', multi: ['grazing', 'party'] } }));
must(/value="multi" checked/.test(backM) && /data-tile="party"[^>]*><input type="checkbox" name="multi" value="party" checked>/.test(backM) && /data-tile="grazing"[^>]*><input type="checkbox" name="multi" value="grazing" checked>/.test(backM), 'the "more than one" ticks are not kept after a failed send');
must(F.chosenServices({ service: 'multi', multi: ['grazing', 'party'] }).join(',') === 'party,grazing' && F.chosenServices({ service: 'rentals' }).join(',') === 'rentals', 'what a submission asks for changed');

// 6. The published page carries the same first question.
const page = fs.readFileSync(path.join(ROOT, 'request.html'), 'utf8');
must(q1Of(page) === q1, 'request.html is stale: run npm run build:request-pages');

if (checks < 50) errors.push(`Rule 0: only ${checks} checks ran`);
if (errors.length) { console.error(`VALIDATION FAIL: request form pictures (${errors.length})\n${errors.map((e) => `- ${e}`).join('\n')}`); process.exit(1); }
console.log(`validate_request_form_pictures: OK (${checks} checks: 4 picture tiles = labels around the real radios (same names/values), approved words, no prices, srcset 240/480 + sizes + alt, files sized and real, lazy tick tiles, echo aria-live, Go back to one choice, Not sure line, 4 across on a laptop / rows on a phone, request.html fresh)`);

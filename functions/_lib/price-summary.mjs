// Quick Pricing Summary (/admin/pricing; owner-approved mock-up, 20 Oct 2026). One block per
// service with every price a customer asks about, ready to text, email or print.
//
// Pure: every number comes from the arguments, which the route fills from the SAME data the
// public site renders from: data/rentals/games.json (through the live inventory, like invoices),
// data/offers/porch_packages.json and data/offers/services.json. Nothing here types a price.
// validate:admin-pricing renders this against the data files AND a perturbed copy.
//
// The yellow "Only you see this" facts live in section.private and NOTHING that leaves the
// admin (the text, the email, the printout) reads that field: smsText / plainSection /
// emailFor only read the public rows. validate:admin-pricing proves none of them carry it.
import INV from '../../scripts/lib/inventory.js';
import { buildPriceTable } from './pricing.mjs';

export const SECTION_KEYS = ['rentals', 'porch', 'party', 'grazing'];
export const SMS_MAX = 300;

const usd = (dollars) => `$${Number(dollars).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const usdC = (cents) => usd(Math.round(cents) / 100);
const fromOf = (price) => Number(String(price || '').replace(/[^0-9.]/g, '')) || 0;
const range = ([a, b]) => (a === b ? String(a) : `${a}–${b}`);
const bare = (url) => String(url || '').replace(/^https?:\/\//, '');

// -> { domain, sections: [{ key, title, short, headline, url, rows, notes, private, sms }] }
export function priceSummary({ games, services, porchPackages, holdHours }) {
  const table = buildPriceTable(games, services, porchPackages);
  const resolved = INV.resolve(games);
  const domain = String(services.domain || '').replace(/\/+$/, '');
  const S = services.services || {};
  const quick = services.invoiceQuickAdds || {};
  const takedown = (services.addOns || {}).takedown || {};
  const pk = porchPackages;
  const pickup = resolved.pickup || {};

  // ---- Game rentals ----------------------------------------------------------------------
  const bundleInfo = (slug) => (resolved.bundles || []).find((b) => b.slug === slug) || {};
  const dayWknd = (d, w) => (w == null ? usdC(d) : `${usdC(d)} day · ${usdC(w)} weekend`);
  const rentRows = [
    { label: 'Any one game', note: 'Fri–Sun counts as a weekend', price: dayWknd(table.dayCents, table.weekendCents) },
    ...table.bundles.map((b) => ({ label: b.name, note: String(bundleInfo(b.slug).includes || ''), price: dayWknd(b.dayCents, b.weekendCents) })),
  ];
  const rentExtras = [
    ...table.items.filter((i) => i.kind === 'extra').map((x) => ({ label: x.name, note: '', price: dayWknd(x.dayCents, x.weekendCents) })),
    { label: 'Damage deposit', note: 'refunded when everything comes back fine', price: usdC(table.damageDepositCents) },
    { label: 'Pickup and return', note: [String(pickup.place || '').split(',')[0], String(pickup.address || '').split(',')[0]].filter(Boolean).join(', '), price: 'free' },
  ];
  const projector = (resolved.adminItems || []).find((x) => x.admin_only && x.availableNow !== false && /projector/i.test(x.name));
  const rentals = {
    key: 'rentals', title: 'Game rentals', short: 'Rentals',
    headline: `${usdC(table.dayCents)} a game for a day · ${usdC(table.weekendCents)} for the weekend`,
    url: `${domain}/rentals/`,
    groups: [{ heading: '', rows: rentRows }, { heading: 'Add-ons and rules', rows: rentExtras }],
    notes: [],
    private: [
      quick.deliveryFee ? `Business delivery ${usd(quick.deliveryFee)}` : '',
      quick.extraGame ? `Extra game on a bundle ${usd(quick.extraGame)} (or complimentary)` : '',
      projector ? `${projector.name} on request` : '',
      Number.isFinite(holdHours) && holdHours > 0 ? `Games held ${holdHours} hours for the deposit` : '',
    ].filter(Boolean),
  };
  const smsBundles = table.bundles.map((b) => `${b.name} ${usdC(b.dayCents)}${b.weekendCents == null ? '' : ` (${usdC(b.weekendCents)} weekend)`}`);
  rentals.sms = fit((n) => `Porch & Party game rentals: ${usdC(table.dayCents)} a game for a day, ${usdC(table.weekendCents)} for the weekend. ${smsBundles.slice(0, n).join(', ')}. ${usdC(table.damageDepositCents)} refundable deposit. Pickup at ${String(pickup.place || '').split(',')[0]}. See them all: ${bare(rentals.url)}`, smsBundles.length);

  // ---- Seasonal porch decorating ---------------------------------------------------------
  const seasons = pk.seasons || [];
  const tierPrice = (t) => seasons.map((s) => `${usd(s.tiers[t].from)}+`).join(' · ');
  const porchRows = pk.tierOrder.map((t) => ({ label: pk.tiers[t].name, note: String(pk.tiers[t].picturing || ''), price: tierPrice(t) }));
  const bundleSeason = seasons.find((s) => s.key === pk.bundle.appliesTo);
  if (pk.bundle && pk.bundle.percentOff) porchRows.push({ label: pk.bundle.checkbox || 'Book both seasons', note: `${seasons.map((s) => s.short).join(' and ')} together${bundleSeason ? `, off the ${bundleSeason.short} package` : ''}`, price: `${pk.bundle.percentOff}% off` });
  const porchTakedown = (takedown.appliesTo || []).includes('porch') && takedown.fromPrice ? [{ label: 'Takedown', note: 'quoted with your setup', price: `from ${usd(takedown.fromPrice)}` }] : [];
  const porch = {
    key: 'porch', title: 'Seasonal porch decorating', short: 'Porch',
    headline: `From ${seasons.map((s) => `${usd(Math.min(...pk.tierOrder.map((t) => s.tiers[t].from)))} (${s.short})`).join(' · ')}`,
    url: `${domain}${(S.porch || {}).slug || ''}`,
    columns: seasons.map((s) => s.short).join(' · '),
    groups: [{ heading: '', rows: porchRows }, ...(porchTakedown.length ? [{ heading: 'Add-ons', rows: porchTakedown }] : [])],
    notes: [pk.addOns && pk.addOns.line, pk.estimateLine].filter(Boolean),
    private: ['Takedown and setup fee and any discount go on the invoice as quick-adds (+ Setup / takedown fee, + Discount).'],
  };
  const porchTiers = pk.tierOrder.map((t) => `${pk.tiers[t].name} ${seasons.map((s) => `${usd(s.tiers[t].from)}+`).join('/')}`);
  porch.sms = fit((n) => `Porch & Party porch decorating, ${seasons.map((s) => s.short).join(' / ')}: ${porchTiers.slice(0, n).join(', ')}.${pk.bundle && pk.bundle.percentOff ? ` Book both seasons for ${pk.bundle.percentOff}% off${bundleSeason ? ` ${bundleSeason.short}` : ''}.` : ''} ${bare(porch.url)}`, porchTiers.length);

  // ---- Celebration setups ----------------------------------------------------------------
  const cel = S.celebration || {};
  const celTakedown = (takedown.appliesTo || []).includes('celebration') && takedown.fromPrice ? [{ label: 'Takedown', note: 'quoted with your setup', price: `from ${usd(takedown.fromPrice)}` }] : [];
  const party = {
    key: 'party', title: 'Celebration setups', short: 'Party & decor',
    headline: `From ${usd(fromOf(cel.price))}`,
    url: `${domain}${cel.slug || ''}`,
    blurb: 'Birthday, hotel room, home and surprise setups. Priced after the call.',
    groups: celTakedown.length ? [{ heading: 'Add-ons', rows: celTakedown }] : [],
    notes: (cel.notes || []).slice(0, 1),
    private: [],
  };
  party.sms = `Porch & Party celebration setups start at ${usd(fromOf(cel.price))} (birthdays, hotel rooms, surprises). ${bare(party.url)}`;

  // ---- Grazing tables --------------------------------------------------------------------
  const gr = S.grazing || {};
  const food = gr.foodPerHead || null;
  const grazeRows = (gr.tiers || []).map((t) => ({ label: t.name, note: `feeds ${range(t.feedsSnack)} (snacks) or ${range(t.feedsMeal)} (a meal)`, price: `${usd(t.from)}+` }));
  if (food) grazeRows.push({ label: 'Food', note: 'a rough estimate per guest, quoted with the menu', price: `${usd(food.low)}–${usd(food.high)}` });
  const grazing = {
    key: 'grazing', title: 'Grazing tables', short: 'Grazing',
    headline: `From ${usd(fromOf(gr.price))}`,
    url: `${domain}${gr.slug || ''}`,
    blurb: 'Showers, corporate gatherings, retreats and small events. Priced by guest count after the call.',
    groups: grazeRows.length ? [{ heading: '', rows: grazeRows }] : [],
    notes: (gr.notes || []).slice(0, 1),
    private: [],
  };
  grazing.sms = `Porch & Party grazing tables start at ${usd(fromOf(gr.price))}, priced by guest count. ${bare(grazing.url)}`;

  return { domain, sections: [rentals, porch, party, grazing] };
}

// The longest text with the first n items that fits in one text message.
function fit(build, n) {
  for (let k = n; k >= 0; k -= 1) { const t = build(k).replace(/ \. /g, ' ').replace(/\s+/g, ' ').trim(); if (t.length <= SMS_MAX) return t; }
  return build(0).slice(0, SMS_MAX);
}

export const sectionOf = (model, key) => model.sections.find((s) => s.key === key) || null;

// "Text it": sms: with no number, so her phone asks who to send it to. Free (her own phone).
export const smsHref = (section) => `sms:?&body=${encodeURIComponent(section.sms)}`;

// The full list for one section as plain text (the email body). Public rows only.
export function plainSection(section) {
  const out = [section.title.toUpperCase(), section.headline];
  if (section.blurb) out.push(section.blurb);
  if (section.columns) out.push(`(${section.columns})`);
  for (const g of section.groups) {
    if (g.heading) out.push('', g.heading);
    for (const r of g.rows) out.push(`- ${r.label}: ${r.price}${r.note ? `\n  ${r.note}` : ''}`);
  }
  for (const n of section.notes) out.push(n);
  out.push(`See it on the website: ${section.url}`);
  return out.join('\n');
}

const escH = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function htmlSection(section) {
  const rows = section.groups.map((g) => `${g.heading ? `<tr><td colspan="2" style="padding:12px 0 4px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5f5148;font-weight:700;">${escH(g.heading)}</td></tr>` : ''}${g.rows.map((r) => `<tr><td style="padding:6px 0;border-top:1px solid #e8dfd4;vertical-align:top;">${escH(r.label)}${r.note ? `<br><span style="color:#5f5148;font-size:13px;">${escH(r.note)}</span>` : ''}</td><td style="padding:6px 0 6px 10px;border-top:1px solid #e8dfd4;text-align:right;font-weight:700;white-space:nowrap;vertical-align:top;">${escH(r.price)}</td></tr>`).join('')}`).join('');
  return `<div style="margin:18px 0 0;padding:14px 0 0;border-top:2px solid #e8dfd4;">
<div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:600;color:#3b302a;">${escH(section.title)}</div>
<div style="font-weight:700;color:#b85f40;margin:2px 0 6px;">${escH(section.headline)}</div>
${section.blurb ? `<div style="color:#5f5148;margin:0 0 6px;">${escH(section.blurb)}</div>` : ''}
${section.columns ? `<div style="text-align:right;color:#5f5148;font-size:13px;">${escH(section.columns)}</div>` : ''}
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:15px;">${rows}</table>` : ''}
${section.notes.map((n) => `<div style="color:#5f5148;font-size:13px;margin:8px 0 0;">${escH(n)}</div>`).join('')}
<div style="margin:10px 0 0;"><a href="${escH(section.url)}" style="color:#b85f40;font-weight:600;">See it on the website</a></div></div>`;
}

// One section ('rentals'...) or 'all' -> { subject, lines, extraHtml, plain } for the email
// (messages.mjs renderPriceList wraps it in the branded email).
export function emailFor(model, which) {
  const sections = which === 'all' ? model.sections : [sectionOf(model, which)].filter(Boolean);
  if (!sections.length) return null;
  const subject = which === 'all' ? 'Porch & Party prices' : `Porch & Party prices: ${sections[0].title}`;
  const lines = [which === 'all' ? 'Here are our current prices for everything we do.' : `Here are our current prices for ${sections[0].title.toLowerCase()}.`];
  const plain = [lines[0], ...sections.map(plainSection)].join('\n\n');
  return { subject, lines, extraHtml: sections.map(htmlSection).join(''), plain };
}

'use strict';
/**
 * The four topic territories this site publishes into, and how a page declares
 * which of them it belongs to.
 *
 * These patterns were already in the repository, inline in
 * scripts/authority_scale/build_territory_health.mjs, matched against a page's
 * own path, <title>, <h1> and meta description. They are lifted here unchanged
 * so that the territory report and the related-pages navigation classify a page
 * the same way, rather than keeping two copies that can drift into disagreeing
 * about what a page is about.
 *
 * Nothing is inferred beyond what the page says about itself: a page is in the
 * porch territory because its own title, heading, description or URL says
 * "porch decorating", not because anything here decided it should be.
 */
const fs = require('fs');
const path = require('path');

const SECTION_DIRS = ['authority', 'answers', 'areas', 'comparisons', 'corporate',
  'events', 'faq', 'guides', 'hubs', 'local', 'seasonal', 'services'];

const TERRITORIES = {
  seasonal_porch_decorating: {
    label: 'seasonal porch decorating',
    patterns: [/porch decorating/, /front porch/, /porch styling/, /wreath/, /pumpkin/,
      /christmas porch/, /fall porch/]
  },
  party_decor: {
    label: 'party and celebration decor',
    patterns: [/party decor/, /birthday/, /celebration setup/, /event decorator/,
      /balloon/, /shower decor/]
  },
  hotel_room_decor: {
    label: 'hotel and room setups',
    patterns: [/hotel room/, /hotel-room/, /romantic room/, /anniversary room/,
      /proposal room/]
  },
  grazing_table_styling: {
    label: 'grazing tables and styled events',
    patterns: [/grazing table/, /grazing and event/, /styled table/, /food table/]
  }
};

/** The lowercased path + title + h1 + description the patterns are matched on. */
function classifiableText(rel, html) {
  const title = (html.match(/<title>([^<]+)/i) || [])[1] || '';
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '';
  const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
    || [])[1] || '';
  return `${rel} ${title} ${h1.replace(/<[^>]+>/g, ' ')} ${desc}`.toLowerCase();
}

function territoriesFor(text) {
  return Object.entries(TERRITORIES)
    .filter(([, t]) => t.patterns.some((re) => re.test(text)))
    .map(([name]) => name);
}

/** Every page under the section directories, classified. */
function classifiedPages(root) {
  const out = [];
  for (const dir of SECTION_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs).filter((n) => n.endsWith('.html')).sort()) {
      const rel = `${dir}/${name}`;
      const html = fs.readFileSync(path.join(root, rel), 'utf8');
      out.push({ rel, dir, html, territories: territoriesFor(classifiableText(rel, html)) });
    }
  }
  return out;
}

module.exports = { SECTION_DIRS, TERRITORIES, classifiableText, territoriesFor, classifiedPages };

'use strict';
/**
 * The sitemap URL inventory the cadence gate reasons over.
 *
 * Extracted so that cadence_gate.js and cadence_accept.js cannot disagree about
 * what the library contains. They used to be the same code in one file because
 * the gate advanced the ledger itself; now that accepting is a separate,
 * deliberate command, both sides have to read the world the same way or an
 * acceptance would record a different URL set than the one that was blocked on.
 */
const fs = require('fs');
const path = require('path');

function sitemapUrls(ROOT) {
  const found = new Map();
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (/^(node_modules|\.git|\.pages-output|coverage)$/.test(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/^sitemap.*\.xml$/i.test(e.name)) {
        const xml = fs.readFileSync(full, 'utf8');
        for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
          const loc = (m[1].match(/<loc>(.*?)<\/loc>/) || [])[1];
          if (!loc) continue;
          const lm = (m[1].match(/<lastmod>(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
          const prev = found.get(loc);
          if (prev === undefined || (lm && (!prev || lm > prev))) found.set(loc, lm);
        }
      }
    }
  };
  walk(ROOT);
  return found;
}

module.exports = { sitemapUrls, LEDGER_REL: 'data/cadence/known_urls.json' };

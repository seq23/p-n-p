'use strict';
/**
 * The one definition of what Porch & Party is, in words (owner-approved
 * 2026-10-18): four services, one service sentence, one identity sentence.
 *
 * Every summary surface is written from this module, never retyped:
 *   - scripts/install_brand_surfaces.js stamps the homepage <title>, meta /
 *     og / twitter descriptions and titles, H1, definition paragraph, Quick
 *     Answer, Organization + WebPage JSON-LD, the root pages' meta
 *     descriptions, site.webmanifest and the llms*.txt identity lines;
 *   - scripts/lib/site_chrome.js puts SERVICE_SENTENCE in every footer;
 *   - scripts/generators/build_section_indexes.js titles /services/ from it;
 *   - scripts/validators/validate_service_coverage.js fails when any of those
 *     surfaces lacks one of the four SERVICES.
 *
 * Prices are never written here: they come from data/offers/services.json
 * (porch, celebration, grazing) and data/rentals/games.json (games), through
 * PRICES below.
 */
const path = require('path');
const offers = require(path.join(__dirname, '../../data/offers/services.json'));
const games = require(path.join(__dirname, '../../data/rentals/games.json'));

const SERVICES = Object.freeze([
  Object.freeze({ key: 'porch', label: 'porch decorating', aliases: Object.freeze(['porch decorating', 'porch decorator', 'porch styling', 'porch decor']) }),
  Object.freeze({ key: 'party', label: 'party planning & decor', aliases: Object.freeze(['party planning', 'party planner', 'party decor', 'celebration setups']) }),
  Object.freeze({ key: 'grazing', label: 'grazing tables', aliases: Object.freeze(['grazing table', 'grazing tables']) }),
  Object.freeze({ key: 'rentals', label: 'party game rentals', aliases: Object.freeze(['party game rentals', 'party game rental', 'game rentals', 'game rental']) })
]);

/** "porch decorating, party planning & decor, grazing tables, and party game rentals" */
const SERVICE_LIST = `${SERVICES.slice(0, -1).map((s) => s.label).join(', ')}, and ${SERVICES[SERVICES.length - 1].label}`;
const SERVICE_SENTENCE = `Memphis ${SERVICE_LIST}.`;
const IDENTITY_SENTENCE = `Porch & Party is a Memphis-based company for ${SERVICE_LIST}.`;
const CITY_LINE = 'Memphis, TN · by appointment';

/** Whole-dollar starting numbers, read from the data files ("$350+" -> 350). */
const dollars = (p) => Number(String(p).replace(/[^0-9.]/g, ''));
const PRICES = Object.freeze({
  porch: dollars(offers.services.porch.price),
  party: dollars(offers.services.celebration.price),
  grazing: dollars(offers.services.grazing.price),
  gameDay: games.rates.day,
  bundleFrom: Math.min(...games.bundles.map((b) => b.dayPrice))
});

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** True when `text` names the service (label or alias), case-insensitive, entities decoded. */
function names(text, service) {
  const t = String(text || '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').toLowerCase();
  return [service.label, ...service.aliases].some((a) => t.includes(a.toLowerCase()));
}
/** The services `text` does not name. */
const missing = (text) => SERVICES.filter((s) => !names(text, s));

module.exports = { SERVICES, SERVICE_LIST, SERVICE_SENTENCE, IDENTITY_SENTENCE, CITY_LINE, PRICES, esc, names, missing };
